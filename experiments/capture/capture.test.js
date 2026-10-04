import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { startCapture } from './session.js';
import { parseArtifact, buildTrails } from '../viewer/model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromProject = createRequire(resolve(root, 'package.json'));
const apiPath = requireFromProject.resolve('@opentelemetry/api');
const allowedKeys = ['durationMs', 'kind', 'name', 'parentSpanId', 'path', 'source', 'spanId', 'statusCode', 'traceId'];
function bounded(promise, label, ms = 8000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]).finally(() => clearTimeout(timer));
}

async function fixture(contents) {
  const cwd = await mkdtemp(resolve(tmpdir(), 'spantrail-capture-'));
  const entry = resolve(cwd, 'app.cjs');
  await writeFile(entry, contents);
  return { cwd, entry };
}

async function waitForOutput(child, marker) {
  let output = '';
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes(marker)) return output;
  }
  throw new Error(`child exited before output readiness ${marker}; output=${output}`);
}

const appSource = (port) => `const {createRequire}=require('node:module'); const req=createRequire(${JSON.stringify(resolve(root, 'package.json'))}); const express=req('express'); const {trace,SpanStatusCode}=req(${JSON.stringify(apiPath)}); const app=express(); const tracer=trace.getTracer('fixture'); app.get('/checkout-unique',async(_q,res)=>{await tracer.startActiveSpan('PRIVATE_INTERNAL_NAME',async s=>{await new Promise(r=>setTimeout(r,8)); s.end()});res.json({ok:true})}); app.get('/oops-unique',async(_q,res)=>{await tracer.startActiveSpan('PRIVATE_FAILURE_NAME',async s=>{s.setStatus({code:SpanStatusCode.ERROR,message:'SECRET_ERROR'});s.end()});res.status(500).send('SECRET_ERROR')}); app.get('/recover-unique',(_q,res)=>res.json({ok:true})); app.get('/__private',(_q,res)=>res.end('private')); app.listen(${port},'127.0.0.1',function(){console.log('APP_READY PORT='+this.address().port)}); setInterval(()=>{},1000);`;

async function get(origin, path, headers = {}) {
  const response = await fetch(new URL(path, origin), { headers });
  return { response, body: await response.text() };
}

async function start(contents, options = {}) {
  const temp = await fixture(contents);
  const capture = await bounded(startCapture({ entry: temp.entry, cwd: root, env: {}, execArgv: [], ...options }), 'capture startup');
  return { ...temp, capture };
}

test('bounded CommonJS capture traces an arbitrary Express app, keeps a strict private schema, and stops cooperatively', async t => {
  const held = await start(appSource(0));
  t.after(async () => { await held.capture.stop(); await rm(held.cwd, { recursive: true, force: true }); });
  const { child } = held.capture;
  const acknowledgements = [];
  child.on('message', message => { if (message?.protocol === 'spantrail-capture-v1' && message.ok === true && !('spans' in message)) acknowledgements.push(message); });
  const output = waitForOutput(child, 'APP_READY');
  const readyText = await bounded(output, 'app output readiness');
  assert.match(readyText, /APP_READY/);
  const portMatch = readyText.match(/PORT=(\d+)/);
  assert.ok(portMatch, 'app readiness output includes its listening port');
  const address = Number(portMatch[1]);
  const origin = `http://127.0.0.1:${address}`;
  const traceId = '1234567890abcdef1234567890abcdef';
  const parentId = '1234567890abcdef';
  const failureTraceId = '2234567890abcdef1234567890abcdef';
  const recoveryTraceId = '3234567890abcdef1234567890abcdef';
  const privateTraceId = '4234567890abcdef1234567890abcdef';
  assert.equal((await get(origin, '/checkout-unique?private=SECRET_QUERY', { traceparent: `00-${traceId}-${parentId}-01`, authorization: 'SECRET_HEADER' })).response.status, 200);
  assert.equal((await get(origin, '/oops-unique?private=SECRET_QUERY', { traceparent: `00-${failureTraceId}-2234567890abcdef-01` })).response.status, 500);
  assert.equal((await get(origin, '/recover-unique', { traceparent: `00-${recoveryTraceId}-3234567890abcdef-01` })).response.status, 200);
  assert.equal((await get(origin, '/__private', { traceparent: `00-${privateTraceId}-4234567890abcdef-01` })).response.status, 200);
  const snapshot = await bounded(held.capture.snapshot(), 'capture snapshot');
  assert.ok(snapshot.length >= 4, 'unknown application routes and explicit spans are retained');
  assert.ok(snapshot.every(span => Object.keys(span).sort().join(',') === allowedKeys.join(',')));
  assert.ok(snapshot.every(span => span.path === null && span.source?.status === 'unknown'));
  assert.ok(snapshot.every(span => ['SERVER', 'CLIENT', 'INTERNAL', 'GET'].includes(span.name)));
  assert.ok(snapshot.every(span => Number.isFinite(span.durationMs) && span.durationMs >= 0));
  assert.doesNotMatch(JSON.stringify(snapshot), /checkout-unique|oops-unique|recover-unique|__private|PRIVATE_|SECRET_|authorization|private=/);
  const correlated = snapshot.filter(span => span.traceId === traceId);
  const server = correlated.find(span => span.kind === 1);
  const internal = correlated.find(span => span.kind === 0);
  assert.ok(server && internal, 'an explicitly created async API span is captured independent of name allowlists');
  assert.equal(server.parentSpanId, parentId);
  assert.equal(internal.parentSpanId, server.spanId);
  assert.equal(internal.statusCode, 0);
  assert.ok(internal.durationMs > 0);
  const failureServer = snapshot.find(span => span.traceId === failureTraceId && span.kind === 1);
  const failureInternal = snapshot.find(span => span.traceId === failureTraceId && span.kind === 0);
  const recoveryServer = snapshot.find(span => span.traceId === recoveryTraceId && span.kind === 1);
  const privateServer = snapshot.find(span => span.traceId === privateTraceId && span.kind === 1);
  assert.ok(failureServer && failureInternal && recoveryServer && privateServer);
  assert.equal(failureServer.parentSpanId, '2234567890abcdef');
  assert.equal(failureInternal.parentSpanId, failureServer.spanId);
  assert.equal(failureInternal.statusCode, 2);
  assert.equal(recoveryServer.parentSpanId, '3234567890abcdef');
  assert.equal(recoveryServer.statusCode, 0);
  assert.equal(privateServer.parentSpanId, '4234567890abcdef');
  const actions = [traceId, failureTraceId, recoveryTraceId, privateTraceId].map(id => ({ traceId: id, spanId: id.slice(0, 16) }));
  const artifact = parseArtifact({ actions, spans: snapshot });
  const trails = buildTrails({ actions, spans: snapshot });
  assert.equal(artifact.spans.length, snapshot.length);
  assert.equal(trails.length, 4);
  assert.deepEqual(trails.map(trail => trail.spanCount), [2, 2, 1, 1]);
  const stopped = await bounded(held.capture.stop(), 'capture stop');
  assert.ok(acknowledgements.some(message => message.protocol === 'spantrail-capture-v1' && message.ok === true && !('spans' in message)), 'shutdown protocol acknowledges success');
  assert.equal(stopped.code, null);
  assert.equal(stopped.signal, 'SIGTERM');
  assert.deepEqual(await bounded(held.capture.stop(), 'repeated capture stop'), stopped);
});

test('capture lifecycle handles natural exit without process.exit and startup failure without orphaning children', async () => {
  const temp = await fixture('setTimeout(()=>{},40);');
  let capture;
  try {
    capture = await startCapture({ entry: temp.entry, cwd: root, env: {}, execArgv: [] });
    const exitPromise = once(capture.child, 'exit');
    const [code, signal] = await bounded(exitPromise, 'natural app exit', 15000);
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.deepEqual(await capture.stop(), { code: 0, signal: null });
  } finally {
    if (capture && capture.child.exitCode === null && capture.child.signalCode === null) { capture.child.kill('SIGKILL'); await bounded(once(capture.child, 'exit'), 'natural exit cleanup').catch(() => {}); }
    await rm(temp.cwd, { recursive: true, force: true });
  }
  const invalid = await fixture('process.exit(0)');
  const syntax = await fixture('const = ;');
  try {
    await assert.rejects(bounded(startCapture({ entry: resolve(invalid.cwd, 'missing.cjs'), cwd: root, env: {}, execArgv: [] }), 'failed startup'), /entry|ENOENT|start|child/i);
    await assert.rejects(bounded(startCapture({ entry: syntax.entry, cwd: root, env: {}, execArgv: [] }), 'syntax startup'), /exit|ready|syntax|disconnected/i);
  } finally { await rm(invalid.cwd, { recursive: true, force: true }); await rm(syntax.cwd, { recursive: true, force: true }); }
});

test('synchronous preload captures top-level application spans and outbound HTTP spans', async t => {
  const source = `const {createRequire}=require('node:module');const req=createRequire(${JSON.stringify(resolve(root, 'package.json'))});const {trace,SpanKind}=req(${JSON.stringify(apiPath)});const http=req('node:http');const tracer=trace.getTracer('startup');tracer.startSpan('top-level').end();const server=http.createServer((_q,r)=>r.end('ok')).listen(0,'127.0.0.1',()=>{const port=server.address().port;tracer.startActiveSpan('startup-parent',async parent=>{const client=tracer.startSpan('startup-client',{kind:SpanKind.CLIENT});http.get({host:'127.0.0.1',port},response=>{response.resume();response.on('end',()=>{client.end();parent.end();console.log('APP_READY');});});});});setInterval(()=>{},1000);`;
  const app = await start(source);
  t.after(async () => { await app.capture.stop(); await rm(app.cwd, { recursive: true, force: true }); });
  await bounded(waitForOutput(app.capture.child, 'APP_READY'), 'top-level app readiness');
  const spans = await bounded(app.capture.snapshot(), 'top-level snapshot');
  assert.equal(spans.filter(span => span.kind === 0).length, 2,
    'captures both top-level and later INTERNAL spans');
  assert.equal(spans.filter(span => span.kind === 2).length, 2,
    'captures explicit CLIENT and auto-instrumented outbound HTTP CLIENT');
  assert.equal(spans.filter(span => span.kind === 1).length, 1,
    'captures the real HTTP SERVER span');
});

test('capture accepts exactly 1000 completed API spans and rejects 1001 atomically', async t => {
  const source = `const {createRequire}=require('node:module');const req=createRequire(${JSON.stringify(resolve(root, 'package.json'))});const {trace}=req(${JSON.stringify(apiPath)});console.log('APP_READY');process.on('message',m=>{if(m?.type!=='generate')return;const tracer=trace.getTracer('bound');for(let i=0;i<m.count;i++)tracer.startSpan('opaque-'+i).end();process.send({protocol:'spantrail-capture-v1',type:'generated',count:m.count})});setInterval(()=>{},1000);`;
  const fixtureApp = await start(source);
  t.after(async () => { await fixtureApp.capture.stop(); await rm(fixtureApp.cwd, { recursive: true, force: true }); });
  await bounded(waitForOutput(fixtureApp.capture.child, 'APP_READY'), 'bound app readiness');
  const requestGeneration = count => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('generation IPC timed out')), 5000);
    const listener = message => { if (message?.protocol === 'spantrail-capture-v1' && message?.type === 'generated' && message.count === count) { clearTimeout(timer); fixtureApp.capture.child.off('message', listener); resolve(); } };
    fixtureApp.capture.child.on('message', listener);
    fixtureApp.capture.child.send({ protocol: 'spantrail-capture-v1', id: 'generate-'+count, type: 'generate', count });
  });
  await requestGeneration(1000);
  const first = await bounded(fixtureApp.capture.snapshot(), '1000-span snapshot');
  const concurrent = await Promise.all([fixtureApp.capture.snapshot(), fixtureApp.capture.snapshot()]);
  assert.equal(first.length, 1000);
  assert.deepEqual(concurrent.map(snapshot => snapshot.map(span => span.spanId).sort()), [first.map(span => span.spanId).sort(), first.map(span => span.spanId).sort()]);
  await requestGeneration(1);
  await assert.rejects(fixtureApp.capture.snapshot(), /capture request failed/i);
  await assert.rejects(fixtureApp.capture.snapshot(), /capture request failed/i);
});

test('valid ERROR status messages are redacted while malformed span metadata fails closed and latches the capture', async t => {
  const valid = await start(`const {createRequire}=require('node:module');const req=createRequire(${JSON.stringify(resolve(root, 'package.json'))});const {trace,SpanStatusCode}=req(${JSON.stringify(apiPath)});console.log('APP_READY');process.on('message',m=>{if(m?.type==='valid'){const span=trace.getTracer('valid').startSpan('valid-name');span.setStatus({code:SpanStatusCode.ERROR,message:'PRIVATE_VALID_ERROR'});span.end();process.send({type:'valid-done'});}});setInterval(()=>{},1000);`);
  const protocol = [];
  valid.capture.child.on('message', message => { if (message?.protocol === 'spantrail-capture-v1') protocol.push(message); });
  t.after(async () => { await valid.capture.stop(); await rm(valid.cwd, { recursive: true, force: true }); });
  await bounded(waitForOutput(valid.capture.child, 'APP_READY'), 'valid status app readiness');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('valid span IPC timed out')), 5000);
    const listener = message => { if (message?.type === 'valid-done') { clearTimeout(timer); valid.capture.child.off('message', listener); resolve(); } };
    valid.capture.child.on('message', listener);
    valid.capture.child.send({ type: 'valid' });
  });
  const validSnapshot = await bounded(valid.capture.snapshot(), 'valid status snapshot');
  assert.equal(validSnapshot.length, 1);
  assert.equal(validSnapshot[0].statusCode, 2);
  assert.doesNotMatch(JSON.stringify(validSnapshot), /PRIVATE_VALID_ERROR/);
  assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE_VALID_ERROR/);

  for (const [field, marker, makeSpan] of [
    ['kind', 'PRIVATE_KIND_MARKER', `tracer.startSpan('valid-name',{kind:'PRIVATE_KIND_MARKER'}).end()`],
    ['statusCode', 'PRIVATE_STATUS_MARKER', `const span=tracer.startSpan('valid-name');span.setStatus({code:'PRIVATE_STATUS_MARKER',message:'PRIVATE_STATUS_MARKER'});span.end()`],
  ]) {
    const source = `const {createRequire}=require('node:module');const req=createRequire(${JSON.stringify(resolve(root, 'package.json'))});const {trace}=req(${JSON.stringify(apiPath)});console.log('APP_READY');process.on('message',m=>{if(m?.type==='malformed'){const tracer=trace.getTracer('malformed');${makeSpan};process.send({type:'malformed-done'});}if(m?.type==='valid'){trace.getTracer('malformed').startSpan('valid-name').end();process.send({type:'valid-done'});}});setInterval(()=>{},1000);`;
    const fixtureApp = await start(source);
    const protocol = [];
    fixtureApp.capture.child.on('message', message => { if (message?.protocol === 'spantrail-capture-v1') protocol.push(message); });
    t.after(async () => { await fixtureApp.capture.stop(); await rm(fixtureApp.cwd, { recursive: true, force: true }); });
    await bounded(waitForOutput(fixtureApp.capture.child, 'APP_READY'), 'malformed app readiness');
    const send = type => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${type} IPC timed out`)), 5000);
      const listener = message => { if (message?.type === `${type}-done`) { clearTimeout(timer); fixtureApp.capture.child.off('message', listener); resolve(); } };
      fixtureApp.capture.child.on('message', listener);
      fixtureApp.capture.child.send({ type });
    });
    await send('malformed');
    await assert.rejects(fixtureApp.capture.snapshot(), /capture request failed/i);
    assert.doesNotMatch(JSON.stringify(protocol), new RegExp(marker));
    await send('valid');
    await assert.rejects(fixtureApp.capture.snapshot(), /capture request failed/i);
    assert.doesNotMatch(JSON.stringify(protocol), new RegExp(marker));
    assert.ok(['kind', 'statusCode'].includes(field));
  }
});
