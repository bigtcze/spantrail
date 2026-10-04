import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SpanKind } from '@opentelemetry/api';
import { startCapture } from './session.js';
import { createBrowserCaptureContext, installBrowserCapture } from './browser-context.js';
import { parseArtifact } from '../viewer/model.js';
import { startViewer } from '../viewer/server.js';

const HELP = `Usage: npm run capture -- --entry <file.cjs> --url <loopback-http-url> --endpoint <loopback-http-url> --click <selector> --complete <selector> --text <text> --output <new.json> [--timeout 10000] [--headed] [--no-viewer]`;
const required = ['entry', 'url', 'endpoint', 'click', 'complete', 'text', 'output'];

export function parseCaptureArgs(args) {
  const values = new Map(), flags = new Set();
  const flagNames = new Set(['headed', 'no-viewer']);
  const valueNames = new Set([...required, 'timeout']);
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--help') { if (args.length !== 1) throw new Error('arguments'); return { help: true }; }
    if (!name.startsWith('--')) throw new Error('arguments');
    const key = name.slice(2);
    if (flagNames.has(key)) { if (flags.has(key)) throw new Error('arguments'); flags.add(key); continue; }
    if (!valueNames.has(key) || values.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('arguments');
    values.set(key, args[++i]);
  }
  if (required.some(key => !values.has(key))) throw new Error('arguments');
  const timeoutValue = values.get('timeout');
  if (timeoutValue !== undefined && !/^\d+$/.test(timeoutValue)) throw new Error('arguments');
  const timeout = timeoutValue === undefined ? 10000 : Number(timeoutValue);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) throw new Error('arguments');
  const entry = path.resolve(values.get('entry')), output = path.resolve(values.get('output'));
  if (!entry.endsWith('.cjs')) throw new Error('arguments');
  const parseUrl = (input, allowPath) => {
    let url;
    try { url = new URL(input); } catch { throw new Error('arguments'); }
    if (input.includes('#') || input.includes('?') && (!allowPath || input.endsWith('?')) || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash || url.href !== input || (!allowPath && url.search)) throw new Error('arguments');
    return url;
  };
  const url = parseUrl(values.get('url'), true), endpoint = parseUrl(values.get('endpoint'), false);
  if (url.origin !== endpoint.origin) throw new Error('arguments');
  for (const key of ['click', 'complete', 'text']) if (!values.get(key).trim()) throw new Error('arguments');
  return { entry, output, url: url.href, endpoint: endpoint.href, click: values.get('click'), complete: values.get('complete'), text: values.get('text'), timeout, headed: flags.has('headed'), viewer: !flags.has('no-viewer') };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function bounded(promise, ms, message = 'operation timeout') {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}
async function main(args) {
  let options;
  try { options = parseCaptureArgs(args); } catch { throw new Error('invalid arguments'); }
  if (options.help) { process.stdout.write(`${HELP}\n`); return; }
  const entryStat = await fs.stat(options.entry).catch(() => null);
  if (!entryStat?.isFile()) throw new Error('entry validation failed');
  const parent = await fs.stat(path.dirname(options.output)).catch(() => null);
  if (!parent?.isDirectory()) throw new Error('output validation failed');
  try { await fs.lstat(options.output); throw new Error('output validation failed'); } catch (error) { if (error.message === 'output validation failed') throw error; if (error.code !== 'ENOENT') throw new Error('output validation failed'); }
  let interrupted = 0;
  const signalCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  const handlers = Object.entries(signalCodes).map(([signal, code]) => { const handler = () => { interrupted ||= code; }; process.on(signal, handler); return [signal, handler]; });
  let capture, browser, context, hooks, viewer, artifactCreated = false, publicationComplete = false, stopping = false;
  let failed = null, stage = 'application startup';
  const check = () => {
    if (interrupted) throw new Error('interrupted');
    if (!stopping && capture?.child.exitCode !== null && capture?.child.exitCode !== undefined) throw new Error('application failed');
    if (!stopping && capture?.child.signalCode) throw new Error('application failed');
  };
  const interruptible = promise => Promise.race([promise, new Promise((_, reject) => {
    const poll = setInterval(() => { if (interrupted) { clearInterval(poll); reject(new Error('interrupted')); } }, 20);
    promise.finally(() => clearInterval(poll)).catch(() => {});
  })]);
  try {
    check();
    capture = await startCapture({ entry: options.entry, cwd: process.cwd() });
    capture.child.stdout?.pipe(process.stdout); capture.child.stderr?.pipe(process.stderr);
    check();
    const deadline = Date.now() + options.timeout;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      check();
      if (capture.child.exitCode !== null || capture.child.signalCode) throw new Error('application failed');
      try { const response = await fetch(options.url, { redirect: 'error', signal: AbortSignal.timeout(Math.min(500, Math.max(1, deadline - Date.now()))) }); ready = response.status >= 200 && response.status < 300; await bounded(Promise.race([response.body?.cancel(), delay(100)]), 60000); check(); } catch { check(); }
      check();
      if (!ready) await delay(100);
    }
    if (!ready) throw new Error('readiness failed');
    stage = 'browser launch';
    const { chromium } = await import('playwright');
    check();
    browser = await chromium.launch({ headless: !options.headed, timeout: options.timeout, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }); check();
    context = await createBrowserCaptureContext(browser); check();
    hooks = await installBrowserCapture(context, { origin: new URL(options.url).origin, endpoint: options.endpoint }); check();
    const page = await context.newPage(); page.setDefaultTimeout(options.timeout); page.setDefaultNavigationTimeout(options.timeout);
    stage = 'page navigation'; await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: options.timeout }); check();
    const selector = `css=${options.complete}`;
    const marker = page.locator(selector); await marker.waitFor({ state: 'attached', timeout: options.timeout }); check();
    if (await interruptible(bounded(marker.textContent(), options.timeout)) === options.text) throw new Error('completion validation failed'); check();
    let actions = null;
    const responsePromise = page.waitForResponse(response => response.url() === options.endpoint, { timeout: options.timeout });
    responsePromise.catch(() => {});
    stage = 'browser action'; await page.locator(`css=${options.click}`).click({ timeout: options.timeout }); check();
    actions = await interruptible(bounded(hooks.actions(), options.timeout)); check();
    const response = await interruptible(responsePromise); check();
    const responseHeaders = response.request().headers();
    const traceparent = responseHeaders.traceparent && /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i.exec(responseHeaders.traceparent);
    if (!actions.some(action => traceparent && traceparent[1] === action.traceId && traceparent[2] === action.spanId)) throw new Error('response validation failed');
    const finishError = await interruptible(bounded(response.finished(), options.timeout, 'response timeout'));
    check(); if (finishError) throw new Error('response validation failed');
    await interruptible(page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent === text, { selector: options.complete, text: options.text }, { timeout: options.timeout })); check();
    if (actions.length !== 1) throw new Error('action validation failed');
    stage = 'trace validation';
    const until = Date.now() + options.timeout;
    let spans = [], hasParent = false;
    while (Date.now() < until) {
      check(); spans = await capture.snapshot(); check();
      const parents = spans.filter(span => span.traceId === actions[0].traceId && span.kind === SpanKind.SERVER && span.parentSpanId === actions[0].spanId);
      hasParent = parents.length === 1;
      if (hasParent) break;
      await delay(100); check();
    }
    if (!hasParent) throw new Error('trace validation failed');
    const artifact = parseArtifact({ actions, spans: spans.filter(span => span.traceId === actions[0].traceId) });
    const body = JSON.stringify(artifact);
    if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('artifact validation failed');
    stage = 'resource shutdown';
    check();
    let disposeFailed = false;
    try { await bounded(hooks.dispose(), options.timeout); } catch { disposeFailed = true; }
    hooks = null;
    try { await bounded(context.close(), options.timeout); } catch { disposeFailed = true; }
    context = null;
    try { await bounded(browser.close(), options.timeout); } catch { disposeFailed = true; }
    browser = null;
    if (disposeFailed) throw new Error('resource shutdown failed');
    check();
    let shutdownAck = null;
    const onMessage = message => { if (message?.protocol === 'spantrail-capture-v1' && typeof message.id === 'string') shutdownAck = message; };
    capture.child.on('message', onMessage);
    stopping = true;
    try { await capture.stop(); } finally { capture.child.off('message', onMessage); stopping = false; }
    capture = null;
    if (!shutdownAck || shutdownAck.ok !== true) throw new Error('resource shutdown failed');
    check();
    stage = 'artifact publication'; check();
    const handle = await fs.open(options.output, 'wx', 0o600); artifactCreated = true;
    try { check(); await handle.writeFile(body); check(); await handle.close(); check(); publicationComplete = true; }
    catch (error) { await handle.close().catch(() => {}); await fs.rm(options.output, { force: true }); artifactCreated = false; throw error; }
    if (options.viewer) {
      stage = 'viewer startup'; viewer = await startViewer({ artifactPath: options.output, port: 0 }); check();
      process.stdout.write(`Artifact: ${options.output}\nSpanTrail viewer: ${viewer.origin}\nPress Ctrl+C to exit.\n`);
      stage = 'viewer shutdown'; while (!interrupted) await delay(100);
    } else process.stdout.write(`Artifact: ${options.output}\n`);
  } catch (error) { failed = interrupted ? new Error('interrupted') : error; }
  const cleanupErrors = [];
  try { await bounded(hooks?.dispose(), options.timeout); } catch { if (hooks) cleanupErrors.push(true); }
  hooks = null;
  try { await bounded(context?.close(), options.timeout); } catch { if (context) cleanupErrors.push(true); }
  context = null;
  try { await bounded(browser?.close(), options.timeout); } catch { if (browser) cleanupErrors.push(true); }
  browser = null;
  try { stopping = true; await capture?.stop(); } catch { cleanupErrors.push(true); } finally { capture = null; stopping = false; }
  try { await viewer?.close(); } catch { cleanupErrors.push(true); }
  for (const [signal, handler] of handlers) process.off(signal, handler);
  if ((failed || cleanupErrors.length || interrupted) && artifactCreated && !publicationComplete) await fs.rm(options.output, { force: true }).catch(() => {});
  if (failed || cleanupErrors.length || interrupted) {
    if (interrupted) { process.exitCode = interrupted; return; }
    throw new Error(cleanupErrors.length ? 'cleanup failed' : `${stage} failed`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`capture: ${error.message === 'invalid arguments' ? 'invalid arguments' : error.message}\n`); process.exitCode = error.message === 'interrupted' ? 130 : 1; });
}
