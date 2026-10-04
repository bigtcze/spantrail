import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fork } from 'node:child_process';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const runtime = fileURLToPath(new URL('../runtime/local-tracing.cjs', import.meta.url));
const root = fileURLToPath(new URL('../..', import.meta.url));
const entry = fileURLToPath(new URL('./entry.cjs', import.meta.url));
const observer = fileURLToPath(new URL('../correlation/privacy-observer.cjs', import.meta.url));
const allowedSpanKeys = ['durationMs', 'kind', 'name', 'parentSpanId', 'path', 'source', 'spanId', 'statusCode', 'traceId'];

function bounded(promise, milliseconds, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })]).finally(() => clearTimeout(timer));
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

async function runRuntime(code) {
  const { stdout } = await execFileAsync(process.execPath, ['--require', runtime, '-e', code], {
    cwd: root,
    timeout: 8000,
    env: { ...process.env },
  });
  return JSON.parse(stdout);
}

test('runtime sanitizes unapproved API span names and query paths', async () => {
  const result = await runRuntime(`
    const { trace } = require('@opentelemetry/api');
    (async () => {
      await require(${JSON.stringify(runtime)}).ready;
      const tracer = trace.getTracer('privacy-test');
      const span = tracer.startSpan('SECRET_DYNAMIC_SPAN_NAME', { kind: 1, attributes: { 'http.target': '/private/path?token=SECRET_QUERY', 'http.request.method': 'SECRET_METHOD' } });
      span.end();
      await new Promise(resolve => setTimeout(resolve, 30));
      const spans = require(${JSON.stringify(runtime)}).snapshot();
      await require(${JSON.stringify(runtime)}).shutdown();
      process.stdout.write(JSON.stringify(spans));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
  assert.ok(result.some(span => span.name === 'SERVER' && span.path === 'other'));
  assert.ok(result.every(span => !JSON.stringify(span).includes('SECRET_DYNAMIC_SPAN_NAME')));
  assert.ok(result.every(span => !JSON.stringify(span).includes('SECRET_METHOD')));
  assert.ok(result.every(span => !JSON.stringify(span).includes('SECRET_QUERY')));
  assert.ok(result.every(span => !JSON.stringify(span).includes('/private/path')));
  assert.ok(result.every(span => Object.keys(span).sort().join(',') === 'durationMs,kind,name,parentSpanId,path,source,spanId,statusCode,traceId'));
});

test('Express entry stays memory-only under hostile exporter settings and preserves trace/privacy guarantees', async () => {
  const tripwireRequests = [];
  const tripwire = createServer((incoming, response) => {
    tripwireRequests.push({ url: incoming.url, headers: incoming.headers });
    response.writeHead(200).end();
  });
  tripwire.listen(0, '127.0.0.1');
  await bounded(once(tripwire, 'listening'), 3000, 'tripwire listen');
  const tripwireEndpoint = `http://127.0.0.1:${tripwire.address().port}/must-not-export`;
  const child = fork(entry, [], {
    cwd: root,
    execArgv: ['--require', observer, '--require', runtime],
    env: {
      ...process.env,
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
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const outbound = [];
  child.on('message', message => { if (message?.type === 'outbound') outbound.push(message.request); });
  let port;
  let exit;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Express readiness timed out')), 5000);
    child.on('message', message => {
      if (message?.type !== 'ready') return;
      clearTimeout(timer);
      port = message.port;
      resolve();
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { exit = { code, signal }; clearTimeout(timer); reject(new Error(`Express exited before readiness (${code ?? signal})`)); });
  });
  try {
    await ready;
    const marker = 'EXPRESS_PRIVACY_MARKER_42';
    const traceId = '0123456789abcdef0123456789abcdef';
    const parentId = '0123456789abcdef';
    const headers = { traceparent: `00-${traceId}-${parentId}-01`, authorization: `Bearer ${marker}`, 'x-private-marker': marker };
    const success = await bounded(get(port, '/success?token=' + marker, headers), 3000, 'success request');
    assert.equal(success.status, 200);
    const failureTrace = 'fedcba9876543210fedcba9876543210';
    const failure = await bounded(get(port, '/failure?token=' + marker, { ...headers, traceparent: `00-${failureTrace}-fedcba9876543210-01` }), 3000, 'failure request');
    assert.equal(failure.status, 500);
    assert.doesNotMatch(failure.body, new RegExp(`${marker}|private failure detail|Error|stack`));
    const recovery = await bounded(get(port, '/success?token=' + marker, { ...headers, traceparent: `00-${failureTrace}-fedcba9876543210-01` }), 3000, 'recovery request');
    assert.equal(recovery.status, 200);
    assert.notEqual(failureTrace, traceId);

    let spans;
    const deadline = Date.now() + 3000;
    do {
      const diagnostics = await bounded(get(port, '/__spans'), 1500, 'diagnostics request');
      assert.equal(diagnostics.status, 200);
      spans = JSON.parse(diagnostics.body);
      if (spans.filter(span => span.kind === 1).length >= 3 && spans.filter(span => span.kind === 0).length >= 5) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.ok(spans.filter(span => span.kind === 1).length >= 3, 'all HTTP server spans completed');
    assert.ok(spans.filter(span => span.kind === 0).length >= 5, 'application spans completed');
    const successServer = spans.find(span => span.kind === 1 && span.path === '/success' && span.traceId === traceId);
    const appSuccess = spans.find(span => span.name === 'app.service' && span.traceId === traceId);
    const failedServer = spans.find(span => span.kind === 1 && span.path === '/failure');
    const failedApp = spans.find(span => span.name === 'app.failure' && span.traceId === failureTrace);
    assert.ok(successServer && appSuccess && failedServer && failedApp);
    assert.equal(successServer.name, 'GET');
    assert.equal(failedServer.name, 'GET');
    assert.equal(successServer.parentSpanId, parentId);
    assert.equal(appSuccess.parentSpanId, successServer.spanId);
    assert.equal(failedApp.parentSpanId, failedServer.spanId);
    assert.equal(failedApp.statusCode, 2);
    assert.ok(spans.every(span => span.source?.status === 'unknown'));
    assert.ok(spans.every(span => Object.keys(span).sort().join(',') === allowedSpanKeys.join(',')));
    assert.doesNotMatch(JSON.stringify(spans), /EXPRESS_PRIVACY_MARKER_42|token=|authorization|private failure detail|stack|error/i);
    assert.ok(spans.every(span => span.path !== '/__spans'));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      try { const [code, signal] = await bounded(once(child, 'exit'), 3000, 'Express shutdown'); exit = { code, signal }; }
      catch { child.kill('SIGKILL'); const [code, signal] = await bounded(once(child, 'exit'), 1500, 'forced Express shutdown'); exit = { code, signal }; }
    }
    tripwire.close();
    await bounded(once(tripwire, 'close'), 3000, 'tripwire close');
  }
  assert.deepEqual(tripwireRequests, [], 'no OTLP request reached loopback tripwire, including SDK shutdown');
  assert.deepEqual(outbound, [], 'observer saw no outbound HTTP(S) requests through shutdown');
  assert.deepEqual(exit, { code: 0, signal: null });
});

test('runtime fails closed when completed spans exceed its fixed memory bound', async () => {
  const result = await runRuntime(`
    const { trace } = require('@opentelemetry/api');
    (async () => {
      const runtime = require(${JSON.stringify(runtime)});
      const { parseArtifact } = await import(${JSON.stringify(new URL('../viewer/model.js', import.meta.url).href)});
      await runtime.ready;
      const tracer = trace.getTracer('overflow-test');
      for (let index = 0; index < 1000; index++) tracer.startSpan('secret-' + index).end();
      await new Promise(resolve => setTimeout(resolve, 50));
      const snapshot = runtime.snapshot();
      const parsed = parseArtifact({ actions: [], spans: snapshot });
      tracer.startSpan('secret-overflow').end();
      await new Promise(resolve => setTimeout(resolve, 50));
      let message = '';
      try { runtime.snapshot(); } catch (error) { message = error.message; }
      await runtime.shutdown();
      process.stdout.write(JSON.stringify({ validCount: parsed.spans.length, message }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
  assert.equal(result.validCount, 1000);
  assert.match(result.message, /span limit exceeded/);
});
