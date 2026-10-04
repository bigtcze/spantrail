import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createBrowserCaptureContext, installBrowserCapture } from './browser-context.js';

async function fixture() {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      requests.push({ url: request.url, method: request.method, headers: request.headers, body });
      if (request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(server.html);
      } else if (request.url === '/frame') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' });
        response.end(server.frameHtml);
      } else {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
        response.end('ok');
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.requests = requests;
  server.origin = `http://127.0.0.1:${server.address().port}`;
  server.html = '<!doctype html><button id="go">go</button>';
  server.frameHtml = '';
  server.closeFixture = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return server;
}

async function setup(t, html = '<!doctype html><button id="go">go</button>') {
  const a = await fixture();
  const b = await fixture();
  a.html = html.replaceAll('__OTHER__', b.origin).replaceAll('__SAME__', a.origin);
  a.frameHtml = '<!doctype html><button id="frame">frame</button><script>document.querySelector("#frame").onclick=()=>{window.done=fetch("/collect",{method:"POST",body:"frame"})}</script>';
  b.frameHtml = a.frameHtml;
  let browser, context, capture;
  try {
    browser = await chromium.launch({ headless: true });
    context = await createBrowserCaptureContext(browser);
    capture = await installBrowserCapture(context, { origin: a.origin, endpoint: `${a.origin}/collect` });
    t.after(async () => {
      try { await capture.dispose(); } finally {
        try { await context.close(); } finally {
          try { await browser.close(); } finally { await Promise.all([a.closeFixture(), b.closeFixture()]); }
        }
      }
    });
    const page = await context.newPage();
    await page.goto(a.origin);
    return { a, b, browser, context, page, capture };
  } catch (error) {
    try { await capture?.dispose(); } finally {
      try { await context?.close(); } finally {
        try { await browser?.close(); } finally { await Promise.all([a.closeFixture(), b.closeFixture()]); }
      }
    }
    throw error;
  }
}

test('trusted dispatch shares action across immediate and microtask fetches; nested synthetic events, timers, and awaited continuations are excluded', { timeout: 15000 }, async t => {
  const { a, page, capture } = await setup(t, `<!doctype html><button id="go">go</button><script>
    document.querySelector('#go').addEventListener('click', () => {
      const immediate=fetch('/collect',{method:'POST',body:'immediate'});
      const microtask=Promise.resolve().then(()=>fetch('/collect',{method:'POST',body:'microtask'}));
      const timer=new Promise(resolve=>setTimeout(()=>resolve(fetch('/collect',{method:'POST',body:'timer'})),0));
      const awaited=(async()=>{await new Promise(resolve=>setTimeout(resolve,0));return fetch('/collect',{method:'POST',body:'awaited'})})();
      const nested=document.createElement('button');nested.addEventListener('click',()=>{window.nested=fetch('/collect',{method:'POST',body:'nested'})});document.body.append(nested);nested.click();
      const outer=fetch('/collect',{method:'POST',body:'outer'});
      window.done=Promise.allSettled([immediate,microtask,timer,awaited,window.nested,outer]);
    });
  </script>`);
  await page.locator('#go').click();
  await page.evaluate(() => window.done);
  const requests = a.requests.filter(item => item.url === '/collect');
  const byBody = Object.fromEntries(requests.map(item => [item.body, item]));
  for (const body of ['immediate', 'microtask', 'outer']) assert.ok(byBody[body].headers.traceparent, `${body} carries generated context`);
  for (const body of ['timer', 'awaited', 'nested']) assert.equal(byBody[body].headers.traceparent, undefined, `${body} is outside trusted dispatch`);
  assert.equal(byBody.immediate.headers.traceparent, byBody.microtask.headers.traceparent);
  assert.equal(byBody.outer.headers.traceparent, byBody.immediate.headers.traceparent);
  const actions = await capture.actions();
  assert.equal(actions.length, 1);
  assert.deepEqual(byBody.immediate.headers.traceparent.split('-').slice(1, 3), [actions[0].traceId, actions[0].spanId]);
  await page.evaluate(() => { document.querySelector('#go').click(); });
  await page.evaluate(() => window.done);
  const afterSynthetic = a.requests.filter(item => item.url === '/collect');
  assert.equal(afterSynthetic.length, 12);
  assert.ok(afterSynthetic.slice(6).every(item => !item.headers.traceparent), 'all fetches from the synthetic event have no context');
  assert.equal((await capture.actions()).length, 1);
});

test('two completed trusted click POSTs preserve bodies and have distinct action IDs', { timeout: 15000 }, async t => {
  const { a, page, capture } = await setup(t, '<!doctype html><button id="go">go</button><script>document.querySelector("#go").onclick=()=>{window.done=fetch(new Request("/collect",{method:"POST",body:"payload"})).then(r=>r.text())}</script>');
  await page.locator('#go').click(); await page.evaluate(() => window.done);
  await page.locator('#go').click(); await page.evaluate(() => window.done);
  const reqs = a.requests.filter(item => item.url === '/collect');
  assert.deepEqual(reqs.map(item => item.body), ['payload', 'payload']);
  const actions = await capture.actions();
  assert.equal(actions.length, 2);
  assert.notEqual(actions[0].traceId, actions[1].traceId);
  assert.deepEqual(reqs.map(item => item.headers.traceparent.split('-').slice(1, 3)), actions.map(action => [action.traceId, action.spanId]));
});

test('window capture fetches are observed before app handlers and native Request bodies survive', { timeout: 15000 }, async t => {
  const { a, page, capture } = await setup(t, `<!doctype html><button id="go">go</button><script>
    document.querySelector('#go').addEventListener('click', () => {
      const headers = new Headers([['x-original','kept'],['content-type','application/x-custom']]);
      const inheritedInit = Object.create({method:'POST',body:'selected-inherited'});
      inheritedInit.headers = {'x-proof':'kept'};
      window.selectedInherited = fetch('/collect', inheritedInit);
      const getterInit = {headers:{}};
      Object.defineProperty(getterInit, 'method', {get(){ if(this !== getterInit) throw new Error('wrong getter receiver'); return 'POST'; }});
      Object.defineProperty(getterInit, 'body', {value:'selected-nonenumerable'});
      window.selectedNonenumerable = fetch('/collect', getterInit);
      window.selected = fetch('/collect',{method:'POST',body:'window-capture-body',headers:headers.entries()});
      const existing = new Headers([['traceparent','00-11111111111111111111111111111111-2222222222222222-01']]);
      window.existing = fetch('/collect',{method:'POST',body:'existing-context',headers:existing.entries()});
      const emptyState = new Headers([['tracestate','']]);
      window.emptyState = fetch('/collect',{method:'POST',body:'empty-tracestate',headers:emptyState.entries()});
      const bypassInit = Object.create({method:'POST',body:'inherited-tracestate'});
      bypassInit.headers = emptyState.entries();
      window.inheritedTracestate = fetch('/collect', bypassInit);
      const nonenumerableBypass = {headers:emptyState.entries()};
      Object.defineProperties(nonenumerableBypass, {method:{value:'POST'},body:{value:'nonenumerable-tracestate'}});
      window.nonenumerableTracestate = fetch('/collect', nonenumerableBypass);
      const replaced = fetch(new Request('/collect',{method:'POST',body:'original-body',headers:{traceparent:'00-11111111111111111111111111111111-2222222222222222-01'}}),{method:'POST',body:'replaced-body',headers:{}});
      window.replaced = replaced;
    }, {capture:true});
  </script>`);
  await page.evaluate(() => window.addEventListener('click', event => {
    if (event.target.id !== 'go') return;
    window.fromWindow = fetch(new Request('/collect',{method:'POST',body:'native-body'}));
  }, {capture:true}));
  await page.locator('#go').click();
  await page.evaluate(() => Promise.all([window.fromWindow, window.selected, window.selectedInherited, window.selectedNonenumerable, window.existing, window.emptyState, window.inheritedTracestate, window.nonenumerableTracestate, window.replaced]));
  const requests = Object.fromEntries(a.requests.filter(item => item.url === '/collect').map(item => [item.body, item]));
  assert.equal(requests['selected-inherited'].method, 'POST');
  assert.equal(requests['selected-inherited'].body, 'selected-inherited');
  assert.equal(requests['selected-inherited'].headers['x-proof'], 'kept');
  assert.ok(requests['selected-inherited'].headers.traceparent);
  assert.equal(requests['selected-nonenumerable'].method, 'POST');
  assert.equal(requests['selected-nonenumerable'].body, 'selected-nonenumerable');
  assert.ok(requests['selected-nonenumerable'].headers.traceparent);
  assert.ok(requests['window-capture-body'].headers.traceparent);
  assert.equal(requests['window-capture-body'].headers['x-original'], 'kept');
  assert.equal(requests['window-capture-body'].headers['content-type'], 'application/x-custom');
  assert.equal(requests['native-body'].body, 'native-body');
  assert.ok(requests['native-body'].headers.traceparent);
  assert.equal(requests['empty-tracestate'].headers.tracestate, '');
  assert.equal(requests['empty-tracestate'].headers.traceparent, undefined);
  for (const body of ['inherited-tracestate', 'nonenumerable-tracestate']) {
    assert.equal(requests[body].method, 'POST');
    assert.equal(requests[body].headers.tracestate, '');
    assert.equal(requests[body].headers.traceparent, undefined);
  }
  assert.equal(requests['replaced-body'].body, 'replaced-body');
  assert.equal(requests['replaced-body'].headers.traceparent, undefined);
  assert.equal(requests['existing-context'].headers.traceparent, '00-11111111111111111111111111111111-2222222222222222-01');
  assert.equal((await capture.actions()).length, 1);
});

test('exact endpoint and same-/foreign-origin iframe requests are trusted-click scoped', { timeout: 15000 }, async t => {
  const paths = ['/collect', '/collect?x=1', '/collect#x', '/collect?', '/collect#', '/collect?x=1#y'];
  const { a, b, page, capture } = await setup(t, `<!doctype html><button id="go">go</button><iframe src="__SAME__/frame"></iframe><iframe src="__OTHER__/frame"></iframe><script>document.querySelector('#go').onclick=()=>{window.done=Promise.allSettled(${JSON.stringify(paths)}.map((p,i)=>fetch(p,{method:'POST',body:'url-'+i})))}</script>`);
  const sameFrame = page.frameLocator('iframe').nth(0);
  await sameFrame.locator('#frame').click();
  await sameFrame.locator('#frame').evaluate(async element => { await window.done; });
  const foreignFrame = page.frameLocator('iframe').nth(1);
  await foreignFrame.locator('#frame').click();
  await foreignFrame.locator('#frame').evaluate(async element => { await window.done; });
  await page.locator('#go').click(); await page.evaluate(() => window.done);
  const urls = a.requests.filter(request => request.body.startsWith('url-'));
  assert.equal(urls.length, 6);
  assert.deepEqual(urls.map(request => request.body).sort(), paths.map((_, i) => `url-${i}`).sort());
  assert.ok(urls.find(request => request.body === 'url-0').headers.traceparent);
  assert.ok(urls.filter(request => request.body !== 'url-0').every(request => !request.headers.traceparent));
  assert.ok(a.requests.some(request => request.body === 'frame' && !request.headers.traceparent));
  assert.ok(b.requests.some(request => request.body === 'frame' && !request.headers.traceparent));
  assert.equal((await capture.actions()).length, 1);
});


