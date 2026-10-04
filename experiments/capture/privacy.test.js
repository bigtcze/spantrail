import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startCapture } from './session.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromProject = createRequire(resolve(root, 'package.json'));
const apiPath = requireFromProject.resolve('@opentelemetry/api');
const negativeFixture = fileURLToPath(new URL('../correlation/privacy-child-fixture.js', import.meta.url));
const observer = fileURLToPath(new URL('../correlation/privacy-observer.cjs', import.meta.url));
const allowedKeys = ['durationMs', 'kind', 'name', 'parentSpanId', 'path', 'source', 'spanId', 'statusCode', 'traceId'];

function bounded(promise, label, ms = 8000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]).finally(() => clearTimeout(timer));
}

function listen(server) {
  server.listen(0, '127.0.0.1');
  return once(server, 'listening');
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, headers }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

function observe(child, outbound) {
  child.on('message', message => { if (message?.type === 'outbound') outbound.push(message.request); });
}

async function stopNegative(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await bounded(once(child, 'exit'), 'negative control exit').catch(async () => {
    child.kill('SIGKILL');
    await bounded(once(child, 'exit'), 'negative control forced exit');
  });
}

test('capture privacy tripwire detects a real exporter request to /v1/metrics and /v1/logs', async () => {
  const requests = [];
  const tripwire = createServer((incoming, response) => { requests.push(incoming.url); response.writeHead(200).end(); });
  await listen(tripwire);
  const outbound = [];
  const child = fork(negativeFixture, [], {
    cwd: root,
    execArgv: ['--require', observer],
    env: { ...process.env, PRIVACY_TRIPWIRE_PORT: String(tripwire.address().port), OTEL_METRICS_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp', OTEL_SDK_DISABLED: 'false', OTEL_METRIC_EXPORT_INTERVAL: '25' },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  observe(child, outbound);
  try {
    const [code, signal] = await bounded(once(child, 'exit'), 'negative fixture completion', 10000);
    assert.equal(code, 0, `negative fixture exits cleanly (${signal})`);
    for (const path of ['/v1/metrics', '/v1/logs']) {
      assert.ok(requests.some(url => url === path), `${path} reached the loopback tripwire: ${JSON.stringify(requests)}`);
      assert.ok(outbound.some(url => url.includes(path)), `${path} was observed: ${JSON.stringify(outbound)}`);
    }
  } finally {
    await stopNegative(child).catch(() => {});
    tripwire.close();
    if (tripwire.listening) await once(tripwire, 'close');
  }
});

test('capture stays private for an arbitrary CommonJS HTTP app under hostile OpenTelemetry environment', async () => {
  const tripwireRequests = [];
  const tripwire = createServer((incoming, response) => { tripwireRequests.push(incoming.url); response.writeHead(200).end(); });
  await listen(tripwire);
  const directory = await mkdtemp(resolve(tmpdir(), 'spantrail-capture-privacy-'));
  const entry = resolve(directory, 'app.cjs');
  await writeFile(entry, `const http=require('node:http');const {createRequire}=require('node:module');const req=createRequire(${JSON.stringify(resolve(root, 'package.json'))});const {trace,SpanKind,SpanStatusCode}=req(${JSON.stringify(apiPath)});http.createServer(async(q,s)=>{const tracer=trace.getTracer('private-fixture');await tracer.startActiveSpan('PRIVATE_INTERNAL_NAME',{kind:SpanKind.INTERNAL},async span=>{await new Promise(r=>setImmediate(r));span.setStatus({code:SpanStatusCode.ERROR,message:'PRIVATE_ERROR_PAYLOAD'});span.end()});s.end('ok')}).listen(0,'127.0.0.1',function(){console.log('APP_READY '+this.address().port)});`);
  const endpoint = `http://127.0.0.1:${tripwire.address().port}/should-not-export`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OTEL_')));
  Object.assign(env, {
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_TRACES_SAMPLER: 'always_off',
    OTEL_PROPAGATORS: 'none',
    OTEL_SDK_DISABLED: 'true',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_METRIC_EXPORT_INTERVAL: '20',
    OTEL_BSP_SCHEDULE_DELAY: '20',
    OTEL_BLRP_SCHEDULE_DELAY: '20',
    PRIVACY_TRIPWIRE_PORT: String(tripwire.address().port),
  });
  let capture;
  let port;
  const outbound = [];
  let shutdownAck;
  let output = '';
  try {
    capture = await bounded(startCapture({ entry, cwd: root, env, execArgv: ['--require', observer] }), 'capture startup');
    capture.child.stdout.on('data', chunk => { output += chunk.toString(); });
    capture.child.on('message', message => {
      if (message?.type === 'outbound') outbound.push(message.request);
      if (message?.protocol === 'spantrail-capture-v1' && message.ok === true && !('spans' in message)) shutdownAck = message;
      if (message?.type === 'app-ready') port = message.port;
    });
    await bounded((async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const match = output.match(/APP_READY (\d+)/);
        if (match) { port = Number(match[1]); return; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(`application readiness timed out: ${output}`);
    })(), 'application readiness');
    const traceId = '0123456789abcdef0123456789abcdef';
    const parentId = '0123456789abcdef';
    const marker = 'CAPTURE_PRIVATE_MARKER';
    assert.equal(await get(port, `/private?token=${marker}`, { traceparent: `00-${traceId}-${parentId}-01`, 'x-private-marker': marker }), 200);
    let snapshot = [];
    await bounded((async () => {
      const deadline = Date.now() + 5000;
      do {
        snapshot = await capture.snapshot();
        if (snapshot.some(span => span.name === 'INTERNAL')) return;
        await new Promise(resolve => { const timer = setTimeout(resolve, 20); });
      } while (Date.now() < deadline);
      throw new Error('completed capture span did not appear');
    })(), 'completed-span polling');
    assert.ok(snapshot.every(span => Object.keys(span).sort().join(',') === allowedKeys.join(',')));
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_|CAPTURE_PRIVATE_MARKER|private\?|token=|authorization|PRIVATE_ERROR_PAYLOAD/);
    const serverSpan = snapshot.find(span => span.kind === 1 && span.traceId === traceId);
    const internalSpan = snapshot.find(span => span.kind === 0 && span.traceId === traceId);
    assert.ok(serverSpan, 'HTTP server span retains the incoming trace context');
    assert.ok(internalSpan, 'explicit INTERNAL span is captured');
    assert.equal(serverSpan.parentSpanId, parentId);
    assert.equal(internalSpan.parentSpanId, serverSpan.spanId);
    assert.equal(internalSpan.statusCode, 2);
    const stopped = await bounded(capture.stop(), 'capture shutdown');
    assert.deepEqual(stopped, { code: null, signal: 'SIGTERM' });
    assert.equal(capture.child.exitCode, null);
    assert.equal(capture.child.signalCode, 'SIGTERM');
    assert.ok(shutdownAck, 'successful shutdown protocol acknowledgement observed');
  } finally {
    if (capture && capture.child.exitCode === null && capture.child.signalCode === null) await bounded(capture.stop(), 'capture cleanup').catch(() => {});
    await rm(directory, { recursive: true, force: true });
    tripwire.close();
    if (tripwire.listening) await once(tripwire, 'close');
  }
  assert.deepEqual(tripwireRequests, [], 'capture and SDK shutdown never contacted hostile OTLP endpoints');
  assert.deepEqual(outbound, [], 'capture and shutdown made no outbound HTTP(S) attempts');
});
