import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./server-entry.js', import.meta.url));
const exporterFixture = fileURLToPath(new URL('./privacy-child-fixture.js', import.meta.url));
const observer = fileURLToPath(new URL('./privacy-observer.cjs', import.meta.url));
const allowedSpanKeys = ['durationMs', 'kind', 'name', 'parentSpanId', 'path', 'spanId', 'traceId'];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function bounded(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

function startChild(script, env) {
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (key.startsWith('OTEL_')) delete childEnv[key];
  Object.assign(childEnv, env);
  for (const [key, value] of Object.entries(childEnv)) if (value === null) delete childEnv[key];
  return fork(script, [], {
    cwd: new URL('../..', import.meta.url),
    execArgv: ['--require', observer],
    env: childEnv,
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
}

async function stopChild(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await bounded(once(child, 'exit'), 3000, `${label} shutdown`).catch(async () => {
    child.kill('SIGKILL');
    await bounded(once(child, 'exit'), 1500, `${label} forced shutdown`);
  });
}

function observeOutbound(child, requests) {
  child.on('message', message => {
    if (message?.type === 'outbound') requests.push(message.request);
  });
}

test('configured OTLP metric and log exporters are detected by the child tripwire', async () => {
  const tripwireRequests = [];
  const tripwire = createServer((incoming, response) => {
    tripwireRequests.push({ url: incoming.url, headers: incoming.headers });
    response.writeHead(200).end();
  });
  tripwire.listen(0, '127.0.0.1');
  await once(tripwire, 'listening');
  const child = startChild(exporterFixture, {
    PRIVACY_TRIPWIRE_PORT: String(tripwire.address().port),
    OTEL_METRICS_EXPORTER: null,
    OTEL_LOGS_EXPORTER: null,
    OTEL_SDK_DISABLED: 'false',
    OTEL_METRIC_EXPORT_INTERVAL: '25',
  });
  const observed = [];
  const stages = [];
  observeOutbound(child, observed);
  child.on('message', message => { if (message?.type === 'stage') stages.push(message.stage); });
  let childExit;
  try {
    childExit = await bounded(once(child, 'exit'), 5000, 'exporter fixture completion');
  } finally {
    await stopChild(child, 'exporter fixture').catch(() => {});
    tripwire.close();
    await once(tripwire, 'close');
  }
  assert.deepEqual(childExit, [0, null], `fixture exits cleanly (stages=${JSON.stringify(stages)}, observed=${JSON.stringify(observed)}, tripwire=${JSON.stringify(tripwireRequests)})`);
  for (const path of ['/v1/metrics', '/v1/logs']) {
    assert.ok(observed.some(item => item.includes(`localhost:4318${path}`)), `observed default exporter destination ${path}: ${JSON.stringify(observed)}`);
    assert.ok(tripwireRequests.some(item => item.url === path), `default exporter path ${path} reached tripwire: ${JSON.stringify(tripwireRequests)}`);
  }
});

test('direct server entry keeps telemetry memory-only and diagnostics privacy-allowlisted', async () => {
  const tripwireRequests = [];
  const tripwire = createServer((incoming, response) => {
    tripwireRequests.push({ url: incoming.url, headers: incoming.headers });
    response.writeHead(200).end();
  });
  tripwire.listen(0, '127.0.0.1');
  await once(tripwire, 'listening');

  const tripwireEndpoint = `http://127.0.0.1:${tripwire.address().port}/must-not-export`;
  const child = startChild(entry, {
      OTEL_EXPORTER_OTLP_ENDPOINT: tripwireEndpoint,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: tripwireEndpoint,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: tripwireEndpoint,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: tripwireEndpoint,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_METRIC_EXPORT_INTERVAL: '20',
      OTEL_BSP_SCHEDULE_DELAY: '20',
      OTEL_BLRP_SCHEDULE_DELAY: '20',
      OTEL_TRACES_SAMPLER: 'always_off',
      OTEL_PROPAGATORS: 'none',
      OTEL_SDK_DISABLED: 'true',
      PRIVACY_TRIPWIRE_PORT: String(tripwire.address().port),
  });
  const observed = [];
  observeOutbound(child, observed);

  let port;
  let childExit;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server readiness timed out')), 5000);
    child.on('message', message => {
      if (message?.type !== 'ready') return;
      clearTimeout(timer);
      port = message.port;
      resolve();
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      childExit = { code, signal };
      clearTimeout(timer);
      reject(new Error(`server exited before readiness (${code ?? signal})`));
    });
  });

  try {
    await ready;
    const traceId = '0123456789abcdef0123456789abcdef';
    const parentSpanId = '0123456789abcdef';
    const marker = 'PRIVACY_MARKER_7da9';
    const action = await get(port, '/api/action', {
      traceparent: `00-${traceId}-${parentSpanId}-01`,
      authorization: `Bearer ${marker}`,
      'x-private-marker': marker,
    });
    assert.equal(action.status, 200);
    assert.deepEqual(JSON.parse(action.body), { traceId });

    const unrelated = await get(port, `/not-allowed?token=${marker}`, {
      authorization: `Bearer ${marker}`,
      'x-private-marker': marker,
    });
    assert.equal(unrelated.status, 404);

    await delay(120);
    const diagnostics = await get(port, '/__spans');
    assert.equal(diagnostics.status, 200);
    const spans = JSON.parse(diagnostics.body);
    assert.ok(spans.length >= 2, 'finished HTTP and service spans are collected in memory');
    for (const span of spans) {
      assert.deepEqual(Object.keys(span).sort(), allowedSpanKeys);
      assert.equal(JSON.stringify(span).includes(marker), false);
      assert.equal(JSON.stringify(span).includes('token='), false);
    }

    const serverSpan = spans.find(span => span.kind === 1 && span.path === '/api/action');
    const serviceSpan = spans.find(span => span.kind === 0 && span.name === 'action.service');
    assert.ok(serverSpan, 'action produces a server span');
    assert.ok(serviceSpan, 'action produces a service span');
    assert.equal(serverSpan.traceId, traceId, 'the fixed incoming traceparent is extracted despite hostile sampler/propagator settings');
    assert.equal(serverSpan.parentSpanId, parentSpanId);
    assert.equal(serviceSpan.traceId, traceId);
    assert.equal(serviceSpan.parentSpanId, serverSpan.spanId);
    assert.ok(spans.some(span => span.kind === 1 && span.path === 'other' && span.parentSpanId === null), 'unrelated request is represented only by its sanitized path and remains a root');
    assert.ok(spans.every(span => span.path !== '/__spans'), 'the diagnostics request is excluded from tracing');
  } finally {
    await stopChild(child, 'server');
    tripwire.close();
    await once(tripwire, 'close');
  }

  assert.deepEqual(tripwireRequests, [], 'requests and SDK shutdown never export telemetry to the inherited OTLP endpoint');
  assert.deepEqual(observed, [], 'server requests and shutdown make no outbound HTTP(S) export attempts, including defaults');
  assert.deepEqual(childExit, { code: 0, signal: null }, 'server shuts down cleanly after SDK shutdown');
});
