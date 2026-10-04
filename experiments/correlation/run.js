import { spawn as nodeSpawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { SpanKind } from '@opentelemetry/api';
import { validContext } from './context.js';

const dir = dirname(fileURLToPath(import.meta.url));
const SERVER = SpanKind.SERVER;
const INTERNAL = SpanKind.INTERNAL;
const sourceFixture = resolve(dir, '../source-attribution/service.cts');

async function sourceCallSites() {
  const source = await readFile(sourceFixture, 'utf8');
  const lines = source.split(/\r?\n/);
  const locations = {};
  for (const [name, marker] of Object.entries({ 'action.service': '// SOURCE:service', 'action.after-await': '// SOURCE:after-await', 'action.unexecuted': '// SOURCE:unexecuted' })) {
    const lineIndex = lines.findIndex(line => line.includes(marker));
    assert.notEqual(lineIndex, -1, `TypeScript fixture contains ${marker}`);
    const columnIndex = lines[lineIndex].indexOf('withSourceSpan(');
    assert.notEqual(columnIndex, -1, `${marker} is on a withSourceSpan invocation`);
    locations[name] = { file: 'experiments/source-attribution/service.cts', line: lineIndex + 1, column: columnIndex + 1 };
  }
  return locations;
}

export class BoundedTimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'BoundedTimeoutError';
  }
}

function bounded(promise, ms, label) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(new BoundedTimeoutError(label, ms)), ms); })]).finally(() => clearTimeout(timer));
}

export function startChild({ spawn = nodeSpawn, childProgram = resolve(dir, 'server-entry.js'), preload, startupTimeout = 10000 } = {}) {
  const child = spawn(process.execPath, [...(preload ? ['--require', preload] : []), childProgram], { cwd: dir, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OTEL_'))), OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  let settled = false;
  let exitInfo;
  let resolveExit;
  const exit = new Promise(resolveExitPromise => { resolveExit = resolveExitPromise; });
  const state = { child, exit, get exited() { return settled; }, get exitInfo() { return exitInfo; } };
  const markExit = (type, value) => { if (!settled) { settled = true; exitInfo = { type, value }; resolveExit(exitInfo); } };
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
  catch { if (!childState.exited) childState.child.kill('SIGKILL'); await bounded(childState.exit, killTimeout, 'Child kill'); }
}

async function fetchSpans(origin, timeoutMs, signal) {
  const response = await fetch(`${origin}/__spans`, { signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Span diagnostics returned ${response.status}`);
  return bounded(response.json(), timeoutMs, 'Span diagnostics body');
}

export async function runProof(options = {}) {
  const { spawn, childProgram, preload, artifactPath = resolve(dir, 'artifacts/proof.json'), skipProofOperations = false, startupTimeout = 10000, browserTimeout = 15000, diagnosticTimeout = 2000, pollTimeout = 12000, childStopOptions, output = true, onFailure } = options;
  let launchBrowser = options.launchBrowser;
  if (!launchBrowser) launchBrowser = async launchOptions => { const { chromium } = await import('playwright'); return chromium.launch(launchOptions); };
  let childState;
  let browser;
  let launch;
  let interrupted;
  let wakeInterrupt;
  let operationFailed = false;
  const interruption = new Promise(resolveInterrupt => { wakeInterrupt = resolveInterrupt; });
  const interruptible = promise => Promise.race([promise, interruption.then(error => { throw error; })]);
  const interrupt = signal => { interrupted ??= new Error(`Interrupted by ${signal}`); wakeInterrupt(interrupted); };
  const onInt = () => interrupt('SIGINT');
  const onTerm = () => interrupt('SIGTERM');
  const onHup = () => interrupt('SIGHUP');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm); process.on('SIGHUP', onHup);
  let primaryError;
  let cleanupStarted = false;
  let closePromise;
  const closeOwned = acquired => {
    if (!acquired) return Promise.resolve();
    if (!closePromise) closePromise = bounded(Promise.resolve().then(() => acquired.close()), 3000, 'Browser close');
    return closePromise;
  };
  try {
    childState = startChild({ spawn, childProgram, preload, startupTimeout });
    const message = await interruptible(childState.ready);
    if (interrupted) throw interrupted;
    const origin = `http://127.0.0.1:${message.port}`;
    launch = Promise.resolve().then(() => launchBrowser({ headless: true, timeout: browserTimeout, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }));
    const acquisition = launch.then(acquired => {
      browser = acquired;
      if (cleanupStarted) closeOwned(acquired).catch(error => {
        try { options.onCleanupFailure?.(error); } catch { console.error('Late browser cleanup failed'); }
      });
      return acquired;
    });
    browser = await interruptible(acquisition);
    if (interrupted) throw interrupted;
    const page = await interruptible(browser.newPage());
    if (skipProofOperations) return {};
    const actions = [];
    const requests = [];
    page.on('request', request => requests.push({ url: request.url(), headers: request.headers() }));
    await interruptible(page.exposeFunction('__recordAction', event => actions.push(event)));
    await interruptible(page.addInitScript(() => addEventListener('spantrail:action', async event => { await globalThis.__recordAction(event.detail); globalThis.__actionCount = (globalThis.__actionCount ?? 0) + 1; })));
    await interruptible(page.goto(origin, { waitUntil: 'load', timeout: browserTimeout }));
    await interruptible(page.waitForSelector('#run-action', { timeout: browserTimeout }));
    for (let index = 1; index <= 2; index += 1) {
      if (interrupted) throw interrupted;
      await interruptible(page.click('#run-action', { timeout: browserTimeout }));
      await interruptible(page.waitForFunction(expected => document.querySelector('#result').textContent === `Action ${expected} complete`, index, { timeout: browserTimeout }));
      await interruptible(page.waitForFunction(expected => globalThis.__actionCount === expected, index, { timeout: browserTimeout }));
      await interruptible(page.waitForFunction(async ({ expected, timeoutMs }) => {
        const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try { const spans = await (await fetch('/__spans', { signal: controller.signal })).json(); return spans.filter(span => span.kind === 1 && span.path === '/api/action').length === expected && spans.filter(span => span.kind === 0 && span.name === 'action.service').length === expected && spans.filter(span => span.kind === 1 && span.path === '/api/control').length === expected; }
        finally { clearTimeout(timeout); }
      }, { expected: index, timeoutMs: browserTimeout }, { timeout: Math.min(pollTimeout, browserTimeout) }));
    }
    const spans = await interruptible(bounded(fetchSpans(origin, diagnosticTimeout), diagnosticTimeout + 100, 'Span diagnostics'));
    const sourceLocations = await interruptible(sourceCallSites());
    assert.equal(actions.length, 2, 'both browser actions must be observed');
    assert.ok(actions.every(action => validContext(action) && action.traceId === action.serverTraceId), JSON.stringify(actions));
    assert.notEqual(actions[0].traceId, actions[1].traceId);
    assert.notEqual(actions[0].spanId, actions[1].spanId);
    const servers = spans.filter(span => span.kind === SERVER && span.path === '/api/action');
    const services = spans.filter(span => span.kind === INTERNAL && span.name === 'action.service');
    const afterAwait = spans.filter(span => span.kind === INTERNAL && span.name === 'action.after-await');
    const controls = spans.filter(span => span.kind === SERVER && span.path === '/api/control');
    assert.equal(servers.length, 2); assert.equal(services.length, 2); assert.equal(afterAwait.length, 2);
    assert.equal(spans.some(span => span.name === 'action.unexecuted'), false); assert.equal(controls.length, 2);
    for (const action of actions) {
      const serverSpan = servers.find(span => span.traceId === action.traceId); const serviceSpan = services.find(span => span.traceId === action.traceId); const nestedSpan = afterAwait.find(span => span.traceId === action.traceId);
      assert.ok(serverSpan && serviceSpan && nestedSpan);
      assert.equal(serverSpan.parentSpanId, action.spanId); assert.equal(serviceSpan.parentSpanId, serverSpan.spanId); assert.equal(nestedSpan.parentSpanId, serviceSpan.spanId);
      for (const [span, name] of [[serviceSpan, 'action.service'], [nestedSpan, 'action.after-await']]) { assert.equal(span.source.status, 'mapped'); assert.equal(span.source.file, sourceLocations[name].file); assert.equal(span.source.line, sourceLocations[name].line); assert.equal(span.source.column, sourceLocations[name].column); }
      for (const span of [serverSpan, serviceSpan, nestedSpan]) { assert.ok(Number.isInteger(span.statusCode)); assert.ok(span.durationMs > 0); }
    }
    assert.ok(spans.filter(span => span.kind === SERVER).every(span => span.source.status === 'unknown'));
    assert.ok(controls.every(span => span.parentSpanId === null && !actions.some(action => action.traceId === span.traceId)));
    const actionRequests = requests.filter(request => new URL(request.url).pathname === '/api/action');
    assert.equal(actionRequests.length, 2);
    for (const [index, request] of actionRequests.entries()) assert.equal(request.headers.traceparent, `00-${actions[index].traceId}-${actions[index].spanId}-01`);
    assert.ok(requests.filter(request => new URL(request.url).pathname !== '/api/action').every(request => !('traceparent' in request.headers)));
    if (interrupted) throw interrupted;
    const artifact = { actions: actions.map(({ traceId, spanId }) => ({ traceId, spanId })), spans: spans.map(({ name, kind, path, traceId, spanId, parentSpanId, durationMs, source, statusCode }) => ({ name, kind, path, traceId, spanId, parentSpanId, durationMs, source, statusCode })) };
    await mkdir(dirname(artifactPath), { recursive: true }); await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    if (output) console.log(`Wrote ${artifactPath}`);
    return artifact;
  } catch (error) { operationFailed = true; primaryError = error; try { onFailure?.(error); } catch {} throw error; }
  finally {
    cleanupStarted = true;
    const cleanupErrors = [];
    const recordCleanupFailure = error => {
      cleanupErrors.push(error);
      try { onFailure?.(error); } catch {}
    };
    if (launch && !browser) { try { browser = await bounded(launch, browserTimeout + 100, 'Browser launch settlement'); } catch (error) { if (error instanceof BoundedTimeoutError) recordCleanupFailure(error); } }
    if (browser) { try { await closeOwned(browser); } catch (error) { recordCleanupFailure(error); } }
    try { await stopChild(childState, childStopOptions); } catch (error) { recordCleanupFailure(error); }
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); process.removeListener('SIGHUP', onHup);
    if (cleanupErrors.length) { const primary = operationFailed ? primaryError : interrupted; throw new AggregateError([...(operationFailed || interrupted ? [primary] : []), ...cleanupErrors], 'Operation failed; cleanup failed', { cause: primary }); }
    if (interrupted && !operationFailed) throw interrupted;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runProof().catch(error => { console.error(error); process.exitCode = 1; });
