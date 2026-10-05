import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, fork } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { startCapture } from '../capture/session.js';
import { createBrowserCaptureContext, installBrowserCapture } from '../capture/browser-context.js';
import { startViewer } from '../viewer/server.js';
import { parseArtifact } from '../viewer/model.js';

const root = resolve('.');
const appEntry = resolve('experiments/postgres/app.cjs');
const image = 'postgres:18.6-bookworm';
const username = 'spantrail_test';
const password = 'spantrail_test_only';
const database = 'spantrail_test';
const timeout = 30000;
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
let containerId;
let containerName = `spantrail-postgres-${crypto.randomUUID()}`;
let ownsDatabase = false;
let interrupted = false;
let success = false;
let failed = null;
let stoppingCapture = false;
const cleanupErrors = [];
const attempts = [];
const deliveries = [];
let shutdownAck = null;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { interrupted = true; });
let capture;
let browser;
let context;
let hooks;
let viewer;
let observer;
let tripwire;
let tripwireSockets;
let temp;
const appEnv = {
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
  OTEL_TRACES_EXPORTER: 'otlp',
  OTEL_METRICS_EXPORTER: 'otlp',
  OTEL_LOGS_EXPORTER: 'otlp',
  OTEL_METRIC_EXPORT_INTERVAL: '20',
};

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}

function docker(args, options = {}) {
  return new Promise((resolveDocker, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 500).unref(); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolveDocker(stdout.trim()) : reject(new Error(`docker ${args[0]} failed (${code}): ${stderr.slice(0, 300)}`)); });
  });
}

async function startDatabase() {
  if (process.env.SPANTRAIL_POSTGRES_URL) {
    const supplied = new URL(process.env.SPANTRAIL_POSTGRES_URL);
    assert.ok(['postgres:', 'postgresql:'].includes(supplied.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(supplied.hostname) && !process.env.SPANTRAIL_POSTGRES_URL.includes('?'), 'external PostgreSQL URL must target loopback without query parameters');
    return process.env.SPANTRAIL_POSTGRES_URL;
  }
  ownsDatabase = true;
  if (interrupted) throw new Error('interrupted before PostgreSQL acquisition');
  await docker(['image', 'inspect', image]).catch(() => docker(['pull', image]));
  if (interrupted) throw new Error('interrupted before PostgreSQL acquisition');
  containerId = await docker(['run', '--detach', '--rm', '--name', containerName, '--publish', '127.0.0.1::5432', '--env', `POSTGRES_USER=${username}`, '--env', `POSTGRES_PASSWORD=${password}`, '--env', `POSTGRES_DB=${database}`, image]);
  if (interrupted) throw new Error('interrupted after PostgreSQL acquisition');
  const portOutput = await docker(['port', containerName, '5432/tcp']);
  const port = Number(portOutput.split(':').at(-1));
  assert.ok(Number.isInteger(port) && port > 0);
  const url = `postgresql://${username}:${password}@127.0.0.1:${port}/${database}`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (interrupted) throw new Error('interrupted during PostgreSQL readiness');
      await docker(['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', username, '-d', database]);
      return url;
    } catch (error) {
      if (interrupted) throw new Error('interrupted during PostgreSQL readiness');
      const state = await docker(['inspect', '--format', '{{.State.Running}}', containerId]).catch(() => 'false');
      if (state !== 'true') throw new Error('PostgreSQL container exited before readiness');
      await delay(250);
    }
  }
  throw new Error('PostgreSQL readiness timed out');
}

async function startTripwire() {
  const sockets = new Set();
  tripwire = createServer((request, response) => {
    deliveries.push(`${request.method} ${request.url}`);
    response.writeHead(200).end();
  });
  tripwireSockets = sockets;
  tripwire.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  tripwire.listen(0, '127.0.0.1');
  await once(tripwire, 'listening');
  const port = tripwire.address().port;
  temp = await mkdtemp(join(tmpdir(), 'spantrail-postgres-'));
  const observerPath = resolve('experiments/correlation/privacy-observer.cjs');
  const observerCode = await readFile(observerPath, 'utf8');
  observer = join(temp, 'privacy-observer.cjs');
  await writeFile(observer, observerCode);
  return { port, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolveClose => tripwire.close(resolveClose)); } };
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error('interrupted');
    const value = await predicate();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`${label} timed out`);
}

try {
  const databaseUrl = await startDatabase();
  const tripwireInfo = await startTripwire();
  const controlAttempts = [];
  const controlEnv = { ...process.env };
  for (const key of Object.keys(controlEnv)) if (key.startsWith('OTEL_')) delete controlEnv[key];
  Object.assign(controlEnv, {
    PRIVACY_TRIPWIRE_PORT: String(tripwireInfo.port),
    OTEL_SDK_DISABLED: 'false',
    OTEL_METRIC_EXPORT_INTERVAL: '25',
  });
  const controlChild = fork(resolve('experiments/correlation/privacy-child-fixture.js'), {
    execArgv: ['--require', observer],
    env: controlEnv,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  controlChild.stderr.resume();
  controlChild.on('message', message => { if (message?.type === 'outbound') controlAttempts.push(message.request); });
  let controlExit;
  let controlTimer;
  try {
    controlExit = await Promise.race([
      once(controlChild, 'exit'),
      new Promise((_, reject) => { controlTimer = setTimeout(() => reject(new Error('privacy negative control timed out')), 5000); }),
    ]);
  } finally {
    clearTimeout(controlTimer);
    if (controlChild.exitCode === null && controlChild.signalCode === null) {
      controlChild.kill('SIGKILL');
      await once(controlChild, 'exit');
    }
  }
  assert.deepEqual(controlExit, [0, null], 'privacy negative control exits cleanly');
  for (const path of ['/v1/metrics', '/v1/logs']) {
    assert.ok(controlAttempts.some(item => item.includes(`localhost:4318${path}`)), `negative control observed exporter destination ${path}`);
    assert.ok(deliveries.some(item => item.endsWith(path)), `negative control reached tripwire ${path}`);
  }
  deliveries.length = 0;
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const appPort = reserve.address().port;
  await new Promise((resolveClose, reject) => reserve.close(error => error ? reject(error) : resolveClose()));
  capture = await startCapture({
    entry: appEntry,
    cwd: root,
    env: { ...appEnv, SPANTRAIL_POSTGRES_URL: databaseUrl, SPANTRAIL_FIXTURE_PORT: String(appPort), PRIVACY_TRIPWIRE_PORT: String(tripwireInfo.port) },
    execArgv: ['--require', observer],
  });
  capture.child.on('message', message => {
    if (message?.type === 'outbound') {
      attempts.push(message.request);
      if (process.env.SPANTRAIL_POSTGRES_PROBE === 'abort-http-after-snapshot' && message.request.includes('/aborted-export')) process.stdout.write('SPANTRAIL_PROBE observed-aborted-export-attempt\\n');
    }
    if (message?.type === 'probe-shutdown-rejected') process.stdout.write('SPANTRAIL_PROBE rejecting-sdk-shutdown\\n');
    if (message?.protocol !== 'spantrail-capture-v1' || typeof message.id !== 'string') return;
    if (Array.isArray(message.spans)) {
      try {
        for (const span of message.spans) {
          assert.deepEqual(Object.keys(span).sort(), ['durationMs', 'kind', 'name', 'parentSpanId', 'path', 'source', 'spanId', 'statusCode', 'traceId']);
          assert.ok(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'CONNECT', 'TRACE', 'CLIENT', 'SERVER', 'INTERNAL', 'PostgreSQL'].includes(span.name));
          assert.equal(span.path, null);
          assert.deepEqual(span.source, { status: 'unknown' });
          assert.doesNotMatch(JSON.stringify(span), /SELECT|pg_sleep|not-an-integer|invalid input syntax|SPANTRAIL_SECRET_SENTINEL|postgresql:\/\/|spantrail_test_only|spantrail_test/i);
        }
      } catch (error) { failed ??= error; }
      return;
    }
    if (stoppingCapture && !('spans' in message)) shutdownAck = message;
  });
  let appReadyResolve;
  const appReady = new Promise(resolveReady => { appReadyResolve = resolveReady; });
  let appStdout = '';
  capture.child.stdout?.on('data', chunk => { appStdout += String(chunk); if (appStdout.includes('SPANTRAIL_APP_READY')) appReadyResolve(true); });
  capture.child.stderr?.resume();
  const origin = `http://127.0.0.1:${appPort}`;
  await waitFor(async () => { if (interrupted) throw new Error('interrupted'); if (capture.child.exitCode !== null) throw new Error('fixture app exited before readiness'); return Promise.race([appReady, delay(50).then(() => false)]); }, 'fixture app readiness');
  if (interrupted) throw new Error('interrupted');
  browser = await chromium.launch({ headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  context = await createBrowserCaptureContext(browser);
  hooks = await installBrowserCapture(context, { origin, endpoint: `${origin}/api/action` });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  if (interrupted) throw new Error('interrupted');

  const outcomes = [];
  for (const mode of ['success', 'failure', 'recovery']) {
    const index = outcomes.length;
    const expected = mode === 'failure' ? 'Controlled query failure' : `Completed ${mode}`;
    if (interrupted) throw new Error('interrupted');
    const responsePromise = page.waitForResponse(response => response.url() === `${origin}/api/action`);
    await page.locator('#mode').selectOption(mode);
    await page.locator('#action').click();
    const response = await responsePromise;
    assert.equal(response.status(), mode === 'failure' ? 500 : 200);
    assert.deepEqual(await response.json(), mode === 'failure' ? { message: expected } : { message: expected, value: 'SPANTRAIL_SECRET_SENTINEL' });
    await page.locator('#result').getByText(expected, { exact: true }).waitFor();
    assert.equal(await page.locator('#result').innerText(), expected);
    const actionList = await hooks.actions();
    assert.equal(actionList.length, index + 1);
    const action = actionList[index];
    const traceparent = response.request().headers().traceparent;
    assert.ok(traceparent?.includes(action.traceId) && traceparent.includes(action.spanId));
    const spans = await waitFor(async () => {
      const current = await capture.snapshot();
      const related = current.filter(span => span.traceId === action.traceId);
      return related.some(span => span.kind === SpanKind.CLIENT) ? related : null;
    }, `${mode} spans`);
    outcomes.push({ mode, action, spans });
  }

  if (process.env.SPANTRAIL_POSTGRES_PROBE === 'abort-http-after-snapshot') {
    capture.child.send({ type: 'probe-abort-export' });
    await waitFor(() => attempts.some(item => item.includes('127.0.0.1:4318/aborted-export')), 'aborted exporter observer attempt');
    process.stdout.write('SPANTRAIL_PROBE http-aborted-after-snapshot\\n');
  }
  const allSpans = outcomes.flatMap(outcome => outcome.spans);
  assert.equal(new Set(allSpans.map(span => span.traceId)).size, 3);
  for (const { mode, action, spans } of outcomes) {
    const server = spans.filter(span => span.kind === SpanKind.SERVER);
    const internal = spans.filter(span => span.kind === SpanKind.INTERNAL);
    const client = spans.filter(span => span.kind === SpanKind.CLIENT);
    assert.equal(server.length, 1, `${mode} has one SERVER span`);
    assert.equal(server[0].parentSpanId, action.spanId);
    assert.equal(internal.length, 1, `${mode} has one explicit INTERNAL span`);
    assert.equal(internal[0].parentSpanId, server[0].spanId);
    assert.equal(client.length, 1, `${mode} has one PostgreSQL CLIENT span`);
    assert.equal(client[0].name, 'PostgreSQL');
    assert.equal(client[0].parentSpanId, internal[0].spanId);
    assert.equal(client[0].source.status, 'unknown');
    if (mode !== 'failure') assert.ok(client[0].durationMs >= 20, 'real query duration reflects pg_sleep');
    assert.equal(client[0].statusCode, mode === 'failure' ? SpanStatusCode.ERROR : SpanStatusCode.UNSET);
    assert.equal(internal[0].statusCode, mode === 'failure' ? SpanStatusCode.ERROR : SpanStatusCode.UNSET);
    assert.deepEqual(spans.map(span => span.kind).sort(), [SpanKind.INTERNAL, SpanKind.CLIENT, SpanKind.SERVER].sort());
  }

  const actionRecords = outcomes.map(({ action }) => action);
  const artifactSpans = outcomes.flatMap(({ spans }) => spans);
  const artifact = parseArtifact({ actions: actionRecords, spans: artifactSpans });
  const artifactText = JSON.stringify(artifact);
  assert.doesNotMatch(artifactText, /SPANTRAIL_SECRET_SENTINEL|postgresql:\/\/|spantrail_test_only|spantrail_test/);
  const artifactPath = join(temp, 'postgres-proof.json');
  await writeFile(artifactPath, artifactText, { mode: 0o600, flag: 'wx' });
  viewer = await startViewer({ artifactPath, port: 0 });
  const viewerBrowser = await chromium.launch({ headless: true, handleSIGINT: false, handleSIGTERM: false });
  try {
    const viewerPage = await viewerBrowser.newPage();
    viewerPage.setDefaultTimeout(timeout);
    await viewerPage.goto(viewer.origin);
    await viewerPage.getByTestId('trail').waitFor();
    for (let index = 0; index < outcomes.length; index++) {
      if (interrupted) throw new Error('interrupted');
      const outcome = outcomes[index];
      await viewerPage.locator(`[data-action-index="${index}"]`).click();
      const chosenIds = await viewerPage.locator('[data-testid="trail"] [data-span-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-span-id')));
      assert.deepEqual(chosenIds.sort(), outcome.spans.map(span => span.spanId).sort());
      const client = outcome.spans.find(span => span.kind === SpanKind.CLIENT);
      const server = outcome.spans.find(span => span.kind === SpanKind.SERVER);
      await viewerPage.locator(`[data-span-id="${client.spanId}"]`).click();
      assert.equal(await viewerPage.locator('.inspector-heading h3').innerText(), 'PostgreSQL');
      assert.equal(await viewerPage.getByTestId('source-location').innerText(), 'Unknown source');
      assert.match(await viewerPage.getByTestId('span-details').innerText(), /Observed duration/);
      assert.equal(await viewerPage.getByTestId('span-details').locator('.badge').innerText(), outcome.mode === 'failure' ? 'OTel Error' : 'OTel Unset');
      await viewerPage.locator(`[data-span-id="${server.spanId}"]`).click();
      assert.equal(await viewerPage.locator('.inspector-heading h3').innerText(), 'POST');
    }
    const servedArtifact = await (await viewerPage.request.get(`${viewer.origin}/artifact.json`)).text();
    assert.doesNotMatch(servedArtifact, /SPANTRAIL_SECRET_SENTINEL|postgresql:\/\/|spantrail_test_only|spantrail_test/);
  } finally { await viewerBrowser.close(); }
  assert.deepEqual(attempts, [], 'no outbound HTTP attempts during success/failure/recovery');
  assert.deepEqual(deliveries, [], 'no outbound HTTP deliveries during success/failure/recovery');
} catch (error) {
  failed = error;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  for (const cleanup of [() => hooks?.dispose(), () => context?.close(), () => browser?.close(), async () => {
    if (!capture) return;
    try { stoppingCapture = true; await capture.stop(); } catch (error) { cleanupErrors.push(error); } finally { stoppingCapture = false; }
    if (!shutdownAck || shutdownAck.ok !== true || 'spans' in shutdownAck) cleanupErrors.push(new Error('SDK shutdown acknowledgement missing or rejected'));
    if (capture.child.exitCode === null && capture.child.signalCode === null) cleanupErrors.push(new Error('capture child exit was not observed'));
  }, () => viewer?.close(), async () => { if (tripwire && tripwireSockets) for (const socket of tripwireSockets) socket.destroy(); if (tripwire) await new Promise((resolveClose, reject) => tripwire.close(error => error ? reject(error) : resolveClose())); }, async () => { if (ownsDatabase) await docker(['rm', '--force', containerName]); }, () => temp && rm(temp, { recursive: true, force: true })]) {
    try { await cleanup(); } catch (error) { cleanupErrors.push(error); }
  }
  if (interrupted) cleanupErrors.push(new Error('interrupted'));
  if (attempts.length || deliveries.length) cleanupErrors.push(new Error('unexpected exporter HTTP attempts or deliveries'));
  if (failed === null && !interrupted && cleanupErrors.length === 0 && attempts.length === 0 && deliveries.length === 0) success = true;
  else process.exitCode = 1;
  if (success) console.log('PostgreSQL browser integration passed: real PostgreSQL parameterized queries, isolated traces, privacy and viewer evidence.');
  for (const error of cleanupErrors) console.error(`cleanup failed: ${error.message}`);
}
