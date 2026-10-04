import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startCapture } from './session.js';
import { createBrowserCaptureContext, installBrowserCapture } from './browser-context.js';
import { parseArtifact, buildTrails } from '../viewer/model.js';
import { startViewer } from '../viewer/server.js';
import { fileURLToPath as toPath } from 'node:url';
import { writeFile as writeArtifact } from 'node:fs/promises';

const observer = toPath(new URL('../correlation/privacy-observer.cjs', import.meta.url));

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const projectRequire = createRequire(resolve(root, 'package.json'));
const expressPath = projectRequire.resolve('express');
const apiPath = projectRequire.resolve('@opentelemetry/api');
function within(promise, label, ms = 12000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]).finally(() => clearTimeout(timer));
}

test('scoped generated trusted-dispatch context correlates real Chromium actions through the backend and viewer', async t => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'spantrail-capture-browser-'));
  const entry = resolve(cwd, 'app.cjs');
  const portFile = resolve(cwd, 'port.txt');
  const page = `<!doctype html><button id="checkout">Checkout</button><output id="status">idle</output><script>const button=document.querySelector('#checkout'),status=document.querySelector('#status');window.backendHeaders=[];button.addEventListener('click',async()=>{const response=await fetch('/checkout-unique');window.backendHeaders.push((await response.json()).traceparent);status.textContent=response.ok?'checkout complete':'checkout failed';});</script>`;
  await writeFile(resolve(cwd, 'page.html'), page);
  await writeFile(entry, `const {createRequire}=require('node:module');const express=createRequire(${JSON.stringify(resolve(root, 'package.json'))})(${JSON.stringify(expressPath)});const app=express();app.get('/',(_q,r)=>r.sendFile(${JSON.stringify(resolve(cwd, 'page.html'))}));const {trace}=createRequire(${JSON.stringify(resolve(root, 'package.json'))})(${JSON.stringify(apiPath)});const tracer=trace.getTracer('browser-fixture');app.get('/checkout-unique',async(q,r)=>{await tracer.startActiveSpan('app-async-work',async span=>{await new Promise(resolve=>setTimeout(resolve,5));span.end()});r.json({ok:true,traceparent:q.headers.traceparent})});app.get('/unrelated-unique',(_q,r)=>r.json({ok:true,traceId:trace.getActiveSpan().spanContext().traceId}));app.listen(0,'127.0.0.1',function(){require('node:fs').writeFileSync(${JSON.stringify(portFile)},String(this.address().port));console.log('APP_READY')});`);
  let capture;
  let browser;
  let browserCapture;
  const outbound = [];
  const unrelatedRequests = [];
  try {
    capture = await within(startCapture({ entry, cwd: root, env: { PRIVACY_TRIPWIRE_PORT: '1', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318', OTEL_METRICS_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp', OTEL_METRIC_EXPORT_INTERVAL: '20' }, execArgv: ['--require', observer] }), 'capture startup');
    capture.child.on('message', message => { if (message?.type === 'outbound') outbound.push(message.request); });
    let output = '';
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`app stdout readiness timed out: ${output}`)), 8000);
      capture.child.stdout.on('data', chunk => { output += chunk; if (output.includes('APP_READY')) { clearTimeout(timer); resolve(); } });
    });
    await ready;
    const { readFile } = await import('node:fs/promises');
    const port = Number(await within(readFile(portFile, 'utf8'), 'server port file'));
    const origin = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ headless: true });
    const context = await createBrowserCaptureContext(browser);
    browserCapture = await installBrowserCapture(context, { origin, endpoint: `${origin}/checkout-unique` });
    const tab = await context.newPage();
    tab.on('request', request => { if (new URL(request.url()).pathname === '/unrelated-unique') unrelatedRequests.push(request.headers()); });
    await tab.goto(origin);
    for (let index = 0; index < 2; index++) {
      await tab.locator('#checkout').click();
      await tab.waitForFunction(() => document.querySelector('#status').textContent === 'checkout complete', null, { timeout: 8000 });
      await tab.locator('#status').evaluate(element => { element.textContent = 'idle'; });
    }
    const actionIds = await browserCapture.actions();
    assert.equal(actionIds.length, 2, 'only the two intended trusted click events are recorded');
    const backendHeaders = await tab.evaluate(() => window.backendHeaders);
    const serverActionIds = backendHeaders.map(header => { const parts = header.split('-'); return { traceId: parts[1], spanId: parts[2] }; });
    assert.equal(serverActionIds.length, 2);
    assert.deepEqual(serverActionIds, actionIds);
    assert.equal(new Set(actionIds.map(action => action.traceId)).size, 2);
    const unrelatedResponse = await tab.evaluate(async () => { const response = await fetch('/unrelated-unique'); return { status: response.status, ...(await response.json()) }; });
    assert.equal(unrelatedResponse.status, 200);
    assert.equal(unrelatedRequests.length, 1);
    assert.equal(unrelatedRequests[0]['traceparent'], undefined, 'unrelated browser request has no traceparent');
    const checkoutRequests = await tab.evaluate(() => performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname === '/checkout-unique').length);
    assert.equal(checkoutRequests, 2, 'both intended requests were made by actual click handlers');
    assert.ok(actionIds.every(action => /^[0-9a-f]{32}$/.test(action.traceId) && /^[0-9a-f]{16}$/.test(action.spanId)));
    const deadline = Date.now() + 8000;
    let spans;
    do {
      spans = await within(capture.snapshot(), 'browser snapshot');
      if (spans.some(span => span.traceId === unrelatedResponse.traceId && span.kind === 1)) break;
      if (Date.now() >= deadline) throw new Error('unrelated SERVER span did not appear before deadline');
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (true);
    for (const action of actionIds) {
      const tree = spans.filter(span => span.traceId === action.traceId);
      const server = tree.find(span => span.kind === 1);
      assert.ok(server, `captured server span for ${action.traceId}`);
      assert.equal(server.parentSpanId, action.spanId);
      const internal = tree.find(span => span.kind === 0);
      assert.ok(internal, 'actual app INTERNAL span is captured in browser action trace');
      assert.equal(internal.parentSpanId, server.spanId);
      const artifact = parseArtifact({ actions: [action], spans });
      assert.equal(artifact.spans.filter(span => span.traceId === action.traceId).length, 2);
    }
    const unrelatedTree = spans.filter(span => span.traceId === unrelatedResponse.traceId);
    assert.equal(unrelatedTree.length, 1, 'unrelated request has exactly one captured SERVER span');
    assert.equal(unrelatedTree[0].kind, 1);
    assert.equal(unrelatedTree[0].parentSpanId, null);
    assert.ok(!actionIds.some(action => action.traceId === unrelatedTree[0].traceId));
    const trails = buildTrails({ actions: actionIds, spans });
    assert.equal(trails.length, 2);
    assert.ok(trails.every(trail => trail.spanCount === 2));
    const artifactPath = resolve(cwd, 'capture-artifact.json');
    await writeArtifact(artifactPath, JSON.stringify({ actions: actionIds, spans }));
    const viewer = await startViewer({ artifactPath, port: 0 });
    try {
      const viewerPage = await context.newPage();
      await viewerPage.goto(viewer.origin);
      await viewerPage.getByTestId('trail').waitFor();
      const actionButtons = viewerPage.locator('[data-action-index]');
      assert.equal(await actionButtons.count(), 2);
      await actionButtons.nth(1).click();
      assert.equal(await viewerPage.getByTestId('trail').getAttribute('aria-label'), 'Action 2 observed trail');
      assert.equal(await viewerPage.locator('.span-kind').first().innerText(), 'SERVER');
      await viewerPage.locator('[data-span-id]').filter({ has: viewerPage.locator('.span-kind', { hasText: 'Internal' }) }).click();
      assert.match(await viewerPage.getByTestId('span-details').innerText(), /INTERNAL SPAN/);
      assert.match(await viewerPage.getByTestId('span-details').innerText(), /Unknown source/);
    } finally { await viewer.close(); }
  } finally {
    if (typeof browserCapture !== 'undefined') await browserCapture.dispose();
    if (browser) await browser.close();
    if (capture) await within(capture.stop(), 'capture cleanup');
    assert.deepEqual(outbound, [], 'no HTTP(S) exporter traffic, including during SDK shutdown');
    await rm(cwd, { recursive: true, force: true });
  }
});
