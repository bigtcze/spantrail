import { spawn as nodeSpawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { SpanKind } from '@opentelemetry/api';
import { validContext } from './context.js';

const dir = dirname(fileURLToPath(import.meta.url));
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const SERVER = SpanKind.SERVER;
const INTERNAL = SpanKind.INTERNAL;
const sourceFixture = resolve(dir, '../source-attribution/service.cts');

async function sourceCallSites() {
  const source = await readFile(sourceFixture, 'utf8');
  const lines = source.split(/\r?\n/);
  const locations = {};
  for (const [name, marker] of Object.entries({
    'action.service': '// SOURCE:service',
    'action.after-await': '// SOURCE:after-await',
    'action.unexecuted': '// SOURCE:unexecuted',
  })) {
    const lineIndex = lines.findIndex(line => line.includes(marker));
    assert.notEqual(lineIndex, -1, `TypeScript fixture contains ${marker}`);
    const columnIndex = lines[lineIndex].indexOf('withSourceSpan(');
    assert.notEqual(columnIndex, -1, `${marker} is on a withSourceSpan invocation`);
    locations[name] = { file: 'experiments/source-attribution/service.cts', line: lineIndex + 1, column: columnIndex + 1 };
  }
  return locations;
}

function bounded(promise, ms, label) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  })]).finally(() => clearTimeout(timer));
}

export function startChild({ spawn = nodeSpawn, childProgram = resolve(dir, 'server-entry.js'), startupTimeout = 10000 } = {}) {
  const child = spawn(process.execPath, [childProgram], {
    cwd: dir,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OTEL_'))), OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  let settled = false;
  let exitInfo;
  let resolveExit;
  const exit = new Promise(resolveExitPromise => { resolveExit = resolveExitPromise; });
  const state = { child, exit, get exited() { return settled; }, get exitInfo() { return exitInfo; } };
  const markExit = (type, value) => { if (settled) return; settled = true; exitInfo = { type, value }; resolveExit(exitInfo); };
  child.once('exit', (code, signal) => markExit('exit', { code, signal }));
  child.once('error', error => markExit('error', error));
  const ready = new Promise((resolveReady, rejectReady) => {
    const onMessage = message => { if (message?.type === 'ready') { cleanup(); resolveReady(message); } };
    const onExit = info => { cleanup(); rejectReady(info.type === 'error' ? info.value : new Error('Server exited before readiness')); };
    const timer = setTimeout(() => { cleanup(); rejectReady(new Error(`Server startup timed out after ${startupTimeout}ms`)); }, startupTimeout);
    const cleanup = () => { clearTimeout(timer); child.removeListener('message', onMessage); };
    child.on('message', onMessage);
    exit.then(onExit);
  });
  return Object.assign(state, { ready });
}

export async function stopChild(childState, { termTimeout = 500, killTimeout = 1500 } = {}) {
  if (!childState || childState.exited) return;
  childState.child.kill('SIGTERM');
  try { await bounded(childState.exit, termTimeout, 'Child shutdown'); }
  catch {
    if (!childState.exited) childState.child.kill('SIGKILL');
    await bounded(childState.exit, killTimeout, 'Child kill');
  }
}

async function fetchSpans(origin, timeoutMs) {
  const response = await fetch(`${origin}/__spans`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Span diagnostics returned ${response.status}`);
  return bounded(response.json(), timeoutMs, 'Span diagnostics body');
}

export async function runProof({ spawn, childProgram, launchBrowser = options => chromium.launch(options), startupTimeout = 10000,
  browserTimeout = 15000, diagnosticTimeout = 2000, pollTimeout = 12000, childStopOptions, output = true } = {}) {
  let childState;
  let browser;
  let interrupted;
  const interrupt = signal => { interrupted ??= new Error(`Interrupted by ${signal}`); };
  const onInt = () => interrupt('SIGINT');
  const onTerm = () => interrupt('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    childState = startChild({ spawn, childProgram, startupTimeout });
    const message = await childState.ready;
    if (interrupted) throw interrupted;
    const origin = `http://127.0.0.1:${message.port}`;
    browser = await launchBrowser({ headless: true, timeout: browserTimeout });
    if (interrupted) throw interrupted;
    const page = await browser.newPage();
    const actions = [];
    const requests = [];
    page.on('request', request => { requests.push({ url: request.url(), headers: request.headers() }); });
    await page.exposeFunction('__recordAction', event => actions.push(event));
    await page.addInitScript(() => addEventListener('spantrail:action', async event => {
      await globalThis.__recordAction(event.detail);
      globalThis.__actionCount = (globalThis.__actionCount ?? 0) + 1;
    }));
    await page.goto(origin, { waitUntil: 'load', timeout: browserTimeout });
    await page.waitForSelector('#run-action', { timeout: browserTimeout });
    for (let index = 1; index <= 2; index += 1) {
      if (interrupted) throw interrupted;
      await page.click('#run-action');
      await page.waitForFunction(expected => document.querySelector('#result').textContent === `Action ${expected} complete`, index);
      await page.waitForFunction(expected => globalThis.__actionCount === expected, index);
      await page.waitForFunction(async expected => {
        const spans = await (await fetch('/__spans')).json();
        return spans.filter(span => span.kind === 1 && span.path === '/api/action').length === expected
          && spans.filter(span => span.kind === 0 && span.name === 'action.service').length === expected
          && spans.filter(span => span.kind === 1 && span.path === '/api/control').length === expected;
      }, index, { timeout: pollTimeout });
    }
    if (interrupted) throw interrupted;
    const spans = await bounded(fetchSpans(origin, diagnosticTimeout), diagnosticTimeout + 100, 'Span diagnostics');
    const sourceLocations = await sourceCallSites();
    assert.equal(actions.length, 2, 'both browser actions must be observed');
    assert.ok(actions.every(action => validContext(action) && action.traceId === action.serverTraceId), JSON.stringify(actions));
    assert.notEqual(actions[0].traceId, actions[1].traceId, 'each action must have a fresh trace');
    assert.notEqual(actions[0].spanId, actions[1].spanId, 'each action must have a distinct parent span');
    const servers = spans.filter(span => span.kind === SERVER && span.path === '/api/action');
    const services = spans.filter(span => span.kind === INTERNAL && span.name === 'action.service');
    const afterAwait = spans.filter(span => span.kind === INTERNAL && span.name === 'action.after-await');
    const controls = spans.filter(span => span.kind === SERVER && span.path === '/api/control');
    assert.equal(servers.length, 2, 'exactly two action SERVER spans');
    assert.equal(services.length, 2, 'exactly two action.service INTERNAL spans');
    assert.equal(afterAwait.length, 2, 'exactly two nested action.after-await spans');
    assert.equal(spans.some(span => span.name === 'action.unexecuted'), false, 'the unexecuted source branch emits no span');
    assert.equal(controls.length, 2, 'exactly two control SERVER spans');
    for (const action of actions) {
      const serverSpan = servers.find(span => span.traceId === action.traceId);
      const serviceSpan = services.find(span => span.traceId === action.traceId);
      assert.ok(serverSpan && serviceSpan, 'expected server and service spans');
      const nestedSpan = afterAwait.find(span => span.traceId === action.traceId);
      assert.ok(nestedSpan, 'expected nested after-await span');
      assert.equal(serverSpan.parentSpanId, action.spanId);
      assert.equal(serviceSpan.parentSpanId, serverSpan.spanId);
      assert.equal(nestedSpan.parentSpanId, serviceSpan.spanId);
      assert.equal(serviceSpan.source.status, 'mapped');
      assert.equal(serviceSpan.source.file, sourceLocations['action.service'].file);
      assert.equal(serviceSpan.source.line, sourceLocations['action.service'].line);
      assert.equal(serviceSpan.source.column, sourceLocations['action.service'].column);
      assert.equal(nestedSpan.source.status, 'mapped');
      assert.equal(nestedSpan.source.file, sourceLocations['action.after-await'].file);
      assert.equal(nestedSpan.source.line, sourceLocations['action.after-await'].line);
      assert.equal(nestedSpan.source.column, sourceLocations['action.after-await'].column);
      assert.ok(Number.isInteger(serverSpan.statusCode));
      assert.ok(Number.isInteger(serviceSpan.statusCode));
      assert.ok(Number.isInteger(nestedSpan.statusCode));
      assert.ok(serverSpan.durationMs > 0 && serviceSpan.durationMs > 0 && nestedSpan.durationMs > 0);
    }
    assert.ok(spans.filter(span => span.kind === SERVER).every(span => span.source.status === 'unknown'), 'HTTP spans have no user-source attribution');
    assert.ok(controls.every(span => span.parentSpanId === null && !actions.some(action => action.traceId === span.traceId)), 'control requests must be root spans outside action traces');
    const actionRequests = requests.filter(request => new URL(request.url).pathname === '/api/action');
    assert.equal(actionRequests.length, 2, 'browser must make exactly two action requests');
    for (const [index, request] of actionRequests.entries()) assert.equal(request.headers.traceparent, `00-${actions[index].traceId}-${actions[index].spanId}-01`, 'action request must carry its emitted context');
    assert.ok(requests.filter(request => new URL(request.url).pathname !== '/api/action').every(request => !('traceparent' in request.headers)), 'non-action requests must not carry traceparent');
    const artifact = { actions: actions.map(({ traceId, spanId }) => ({ traceId, spanId })), spans: spans.map(({ name, kind, path, traceId, spanId, parentSpanId, durationMs, source, statusCode }) => ({ name, kind, path, traceId, spanId, parentSpanId, durationMs, source, statusCode })) };
    await mkdir(resolve(dir, 'artifacts'), { recursive: true });
    await writeFile(resolve(dir, 'artifacts/proof.json'), `${JSON.stringify(artifact, null, 2)}\n`);
    if (output) console.log(`Wrote ${resolve(dir, 'artifacts/proof.json')}`);
    return artifact;
  } finally {
    const cleanupErrors = [];
    if (browser) try { await bounded(browser.close(), 3000, 'Browser close'); } catch (error) { cleanupErrors.push(error); }
    try { await stopChild(childState, childStopOptions); } catch (error) { cleanupErrors.push(error); }
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Cleanup failed');
    if (interrupted) throw interrupted;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProof().catch(error => { console.error(error); process.exitCode = 1; });
}
