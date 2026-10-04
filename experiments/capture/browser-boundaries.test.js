import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createBrowserCaptureContext, installBrowserCapture } from './browser-context.js';

async function fixture() {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); res.end(); }
      else if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(server.html); }
      else if (req.url === '/redirect') { res.writeHead(302, { location: server.redirectTo || '/sink', 'access-control-allow-origin': '*' }); res.end(); }
      else { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }); res.end('ok'); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.requests = requests;
  server.origin = `http://127.0.0.1:${server.address().port}`;
  server.html = '<!doctype html><button id="go">go</button>';
  server.closeFixture = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return server;
}

async function resources(t, { page = true, html } = {}) {
  const a = await fixture(), b = await fixture();
  a.html = (html || a.html).replaceAll('__A__', a.origin).replaceAll('__B__', b.origin);
  let browser, context;
  try {
    browser = await chromium.launch({ headless: true });
    context = await createBrowserCaptureContext(browser);
    t.after(async () => { try { await context.close(); } finally { try { await browser.close(); } finally { await Promise.all([a.closeFixture(), b.closeFixture()]); } } });
    return { a, b, browser, context, page: null, openPage: page ? () => context.newPage() : null };
  } catch (error) {
    try { await context?.close(); } finally { try { await browser?.close(); } finally { await Promise.all([a.closeFixture(), b.closeFixture()]); } }
    throw error;
  }
}

async function install(context, origin) { return installBrowserCapture(context, { origin, endpoint: `${origin}/collect` }); }

test('trusted fetch boundaries preserve bypass requests and only selected endpoint is instrumented', { timeout: 20000 }, async t => {
  const { a, b, openPage, context } = await resources(t, { html: `<!doctype html><button id="go">go</button><script>
    document.querySelector('#go').onclick=()=>{ window.done=Promise.all([
      fetch(new Request('/collect',{method:'POST',body:'request-trace',headers:{traceparent:'00-11111111111111111111111111111111-1111111111111111-01'}})),
      ...[new Headers([['x-kind','headers'],['tracestate','']]),[['x-kind','array'],['tracestate','']],{'x-kind':'object','tracestate':''}].map((headers,i)=>fetch('/collect',{method:'POST',body:'init-'+i,headers})),
      fetch(new Request('/collect',{method:'POST',body:'empty-init',headers:{'x-kind':'empty'}}),{headers:{}}),
      fetch(new Request('/elsewhere',{method:'POST',body:'offscope',headers:{'x-old':'yes'}}),{headers:{'x-replaced':'yes'}}),
      fetch(new Request('__B__/collect',{method:'POST',body:'foreign',headers:{'x-old':'yes'}}),{headers:{'x-replaced':'yes'}}),
      fetch('/redirect'),
      fetch('/redirect',{method:'POST',body:'bypass-redirect',headers:{'x-kind':'unselected'}})
    ]) };
  </script>` });
  const capture = await install(context, a.origin); t.after(() => capture.dispose());
  const page = await openPage(); await page.goto(a.origin); await page.locator('#go').click(); await page.evaluate(() => window.done);
  const responses = await page.evaluate(() => window.done.then(values => Promise.all(values.map(value => value.text()))));
  assert.equal(responses.length, 9);
  const req = a.requests.filter(r => r.method !== 'OPTIONS');
  const body = x => req.find(r => r.body === x);
  assert.ok(body('request-trace').headers.traceparent.startsWith('00-11111111111111111111111111111111-'));
  for (const name of ['init-0','init-1','init-2']) assert.equal(body(name).headers.traceparent, undefined, name);
  for (const name of ['init-0','init-1','init-2']) assert.equal(body(name).headers.tracestate, '');
  assert.ok(body('empty-init').headers.traceparent);
  assert.equal(body('empty-init').headers['x-kind'], undefined);
  assert.equal(body('offscope').headers['x-replaced'], 'yes');
  assert.equal(body('offscope').headers['x-old'], undefined);
  assert.equal(b.requests.filter(r=>r.body==='foreign').length, 1);
  assert.equal(b.requests.find(r=>r.body==='foreign').headers['x-replaced'], 'yes');
  assert.equal(b.requests.find(r=>r.body==='foreign').headers['x-old'], undefined);
  assert.ok(req.some(r=>r.url==='/redirect' && r.method==='GET' && !r.headers.traceparent));
  assert.ok(body('bypass-redirect') && !body('bypass-redirect').headers.traceparent);
  assert.ok(req.some(r=>r.url==='/sink' && !r.headers.traceparent));
  assert.equal((await capture.actions()).length, 1);
});

test('selected redirect rejects and never sends redirected target requests', { timeout: 20000 }, async t => {
  const { a, b, openPage, context } = await resources(t, { html: '<!doctype html><button id="go">go</button><script>document.querySelector("#go").onclick=()=>{window.done=fetch("/redirect").then(()=>false, e=>e instanceof TypeError)}</script>' });
  const capture = await installBrowserCapture(context, { origin: a.origin, endpoint: `${a.origin}/redirect` }); t.after(() => capture.dispose());
  const page = await openPage(); await page.goto(a.origin);
  a.redirectTo = '/sink';
  await page.locator('#go').click(); assert.equal(await page.evaluate(() => window.done), true);
  assert.deepEqual(a.requests.filter(r=>r.url==='/redirect').map(r=>r.method), ['GET']);
  assert.equal(a.requests.filter(r=>r.url==='/sink').length, 0);
  a.redirectTo = `${b.origin}/sink`;
  await page.locator('#go').click(); assert.equal(await page.evaluate(() => window.done), true);
  assert.equal(a.requests.filter(r=>r.url==='/sink').length, 0);
  assert.equal(b.requests.filter(r=>r.url==='/sink').length, 0);
  assert.equal((await capture.actions()).length, 2);
  const actionIds = (await capture.actions()).map(action => action.traceId);
  assert.equal(new Set(actionIds).size, 2);
});

test('dispose is idempotent and disables current, reloaded, and future page capture', { timeout: 20000 }, async t => {
  const { a, context, openPage } = await resources(t, { html: '<!doctype html><button id="go">go</button><script>document.querySelector("#go").onclick=()=>{window.done=fetch("/collect").then(r=>r.text())}</script>' });
  const capture = await install(context, a.origin);
  const page = await openPage(); await page.goto(a.origin); await page.locator('#go').click(); await page.evaluate(() => window.done);
  assert.ok(a.requests.find(r=>r.url==='/collect').headers.traceparent);
  await page.evaluate(() => { const old=fetch; window.appCalls=0; window.fetch=function(...args){window.appCalls++;return old.apply(this,args)} });
  const first = capture.dispose(); assert.strictEqual(capture.dispose(), first); await Promise.all([first, capture.dispose()]);
  await page.locator('#go').click(); await page.evaluate(() => window.done);
  let last = a.requests.filter(r=>r.url==='/collect').at(-1); assert.equal(last.headers.traceparent, undefined);
  assert.equal(await page.evaluate(() => window.appCalls), 1);
  await page.reload(); await page.locator('#go').click(); await page.evaluate(() => window.done);
  last = a.requests.filter(r=>r.url==='/collect').at(-1); assert.equal(last.headers.traceparent, undefined);
  const next = await context.newPage(); await next.goto(a.origin); await next.locator('#go').click(); await next.evaluate(() => window.done);
  last = a.requests.filter(r=>r.url==='/collect').at(-1); assert.equal(last.headers.traceparent, undefined);
  await assert.rejects(capture.actions());
});

test('configuration and publication validation, capacity, and copied action records', { timeout: 20000 }, async t => {
  const { a, context, browser } = await resources(t, { page: false });
  await assert.rejects(installBrowserCapture(await browser.newContext(), { origin:a.origin, endpoint:`${a.origin}/collect` }));
  const existing = await createBrowserCaptureContext(browser); await existing.newPage();
  await assert.rejects(install(existing, a.origin));
  const fresh = await createBrowserCaptureContext(browser);
  for (const [origin, endpoint] of [[a.origin,`${a.origin}/collect?`],[a.origin,`${a.origin}/collect#`],[a.origin,`${a.origin}/collect?x=1`],[a.origin,`${a.origin}/collect#x`],[`${a.origin}/path`,`${a.origin}/collect`],[a.origin.replace('127.0.0.1','localhost'),`${a.origin}/collect`]]) await assert.rejects(installBrowserCapture(fresh,{origin,endpoint}));
  await assert.rejects(installBrowserCapture(fresh,{origin:a.origin,endpoint:`${a.origin.replace(/:\d+$/,'')}/collect`}));
  const failed = await install(fresh, a.origin); const p = await fresh.newPage(); await p.goto(a.origin);
  await assert.rejects(p.evaluate(() => window.__spantrailCapturePublish_v1([{traceId:'bad',spanId:'bad'}])));
  await p.reload(); await assert.rejects(failed.actions()); await failed.dispose(); await fresh.close();

  const capped = await createBrowserCaptureContext(browser); const controller = await install(capped, a.origin); const page = await capped.newPage(); await page.goto(a.origin);
  await page.evaluate(async () => { for(let i=1;i<=100;i++){const traceId=i.toString(16).padStart(32,'0'), spanId=(i+256).toString(16).padStart(16,'0'); await window.__spantrailCapturePublish_v1([{traceId,spanId}]);} });
  const records = await controller.actions(); assert.equal(records.length,100); assert.deepEqual(Object.keys(records[0]).sort(),['spanId','traceId']);
  records[0].traceId='mutated'; assert.notEqual((await controller.actions())[0].traceId,'mutated');
  await assert.rejects(page.evaluate(() => window.__spantrailCapturePublish_v1([{traceId:(101).toString(16).padStart(32,'0'),spanId:(357).toString(16).padStart(16,'0')}])) , /limit/i);
  await assert.rejects(controller.actions()); await controller.dispose(); await capped.close();
  t.after(async()=>{ await Promise.all([existing.close(), fresh.close().catch(()=>{}), capped.close().catch(()=>{})]); });
});
