import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { parseArtifact, buildTrails } from '../viewer/model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = resolve(root, 'experiments/capture/run.js');
const projectRequire = createRequire(resolve(root, 'package.json'));
const apiPath = projectRequire.resolve('@opentelemetry/api');
const within = async (promise, label, ms = 12000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]); }
  finally { clearTimeout(timer); }
};

async function fixture(t, { delayListen = 0, reject = false, initialComplete = false, hangResponse = false, completeBeforeResponseEnd = false, hangFlush = false, rejectShutdown = false, preexistingTraceparent = false } = {}) {
  const dir = await mkdtemp(resolve(tmpdir(), 'spantrail-command-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = resolve(dir, 'app.cjs');
  const portFile = resolve(dir, 'port');
  const startedFile = resolve(dir, 'started');
  const exitedFile = resolve(dir, 'exited');
  const shutdownAttemptFile = resolve(dir, 'shutdown-attempt');
  const html = `<!doctype html><button id="checkout">Checkout</button><output id="status">${initialComplete ? 'checkout complete' : 'idle'}</output><script>${hangFlush ? "Object.defineProperty(window,'__spantrailCaptureFlush',{value:()=>new Promise(()=>{})});" : ''}document.querySelector('#checkout').addEventListener('click',async()=>{try{${completeBeforeResponseEnd ? `fetch('/checkout'${preexistingTraceparent ? ",{headers:{traceparent:'00-11111111111111111111111111111111-2222222222222222-01'}}" : ''}).catch(()=>{});document.querySelector('#status').textContent='checkout complete';` : "const r=await fetch('/checkout');const data=await r.json();document.querySelector('#status').textContent=data.ok?'checkout complete':'checkout failed';"}}catch{document.querySelector('#status').textContent='checkout failed'}});fetch('/unrelated').catch(()=>{});</script>`;
  const source = `const http=require('node:http');const fs=require('node:fs');const {createRequire}=require('node:module');const {trace}=createRequire(${JSON.stringify(resolve(root, 'package.json'))})(${JSON.stringify(apiPath)});const tracer=trace.getTracer('command-fixture');${rejectShutdown ? `const sdk=require(${JSON.stringify(projectRequire.resolve('@opentelemetry/sdk-node'))});sdk.NodeSDK.prototype.shutdown=()=>{fs.writeFileSync(${JSON.stringify(shutdownAttemptFile)},'attempted');return Promise.reject(new Error('PRIVATE_SHUTDOWN_MARKER'))};` : ''}const server=http.createServer(async(req,res)=>{if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(${JSON.stringify(html)});return}if(req.url==='/unrelated'){res.end('ok');return}if(req.url==='/checkout'){fs.writeFileSync(${JSON.stringify(resolve(dir, 'request'))},'requested');${hangResponse ? "res.write('pending');return;" : reject ? "res.writeHead(500);res.end('failed');return;" : `await tracer.startActiveSpan('checkout-internal',async span=>{await new Promise(r=>setTimeout(r,8));span.end()});res.writeHead(200,{'content-type':'application/json'});${completeBeforeResponseEnd ? "res.write('{\\\"ok\\\":true}');" : 'res.end(JSON.stringify({ok:true}));'}`}return}res.writeHead(404);res.end()});fs.writeFileSync(${JSON.stringify(startedFile)},String(process.pid));setTimeout(()=>{server.listen(Number(process.env.PORT),'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(portFile)},String(server.address().port)));},${delayListen});process.on('SIGTERM',()=>server.close(()=>{fs.writeFileSync(${JSON.stringify(exitedFile)},'closed');process.exit(0)}));process.on('SIGINT',()=>server.close(()=>{fs.writeFileSync(${JSON.stringify(exitedFile)},'closed');process.exit(0)}));`;
  await writeFile(entry, source);
  return { dir, entry, portFile, startedFile, exitedFile, shutdownAttemptFile, requestFile: resolve(dir, 'request') };
}

async function stopCli(proc) {
  if (proc.child.exitCode === null) {
    proc.child.kill('SIGINT');
    await within(proc.close, 'CLI cleanup exit');
  }
}

async function assertProcessGone(pid) {
  await assert.rejects(new Promise((resolve, reject) => {
    try { process.kill(pid, 0); resolve(); } catch (error) { reject(error); }
  }), { code: 'ESRCH' });
}

function launch(args, env = {}) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const close = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  return { child, close, diagnostics: () => `stdout:\n${stdout}\nstderr:\n${stderr}`, stdout: () => stdout };
}

async function waitForFile(path, proc, label, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { return await readFile(path, 'utf8'); } catch {}
    if (proc.child.exitCode !== null) throw new Error(`${label}: process exited (${proc.child.exitCode}); ${proc.diagnostics()}`);
    await delay(20);
  }
  throw new Error(`${label} timed out; ${proc.diagnostics()}`);
}

async function reservePort() {
  const server = await import('node:net').then(({ createServer }) => createServer());
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function assertClosed(port) {
  const net = await import('node:net');
  await within(new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); reject(new Error(`app port ${port} is still open`)); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
  }), `port ${port} closure`);
}

test('default command captures one checkout and serves the real artifact viewer until SIGINT', async t => {
  const app = await fixture(t);
  const port = await reservePort();
  const output = resolve(app.dir, 'capture.json');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output], { PORT: String(port) });
  let browser;
  let viewerLine;
  let artifactBytes;
  let appPid;
  try {
    appPid = Number(await waitForFile(app.startedFile, proc, 'owned app startup marker'));
    const viewerAnnouncement = await within(new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`viewer announcement timed out; ${proc.diagnostics()}`)), 12000);
      const poll = () => { const match = proc.stdout().match(/SpanTrail viewer:\s*(http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } else if (proc.child.exitCode !== null) { clearTimeout(timer); reject(new Error(`CLI exited before viewer; ${proc.diagnostics()}`)); } else setTimeout(poll, 20); };
      poll();
    }), 'viewer URL');
    viewerLine = viewerAnnouncement;
    artifactBytes = await readFile(output);
    assert.equal(proc.child.exitCode, null, 'default viewer mode remains active');
    const artifact = parseArtifact(artifactBytes.toString('utf8'));
    const trails = buildTrails(artifact);
    assert.equal(artifact.actions.length, 1);
    assert.equal(trails.length, 1);
    assert.equal(trails[0].spanCount, 2);
    const server = artifact.spans.find(span => span.kind === 1);
    const internal = artifact.spans.find(span => span.kind === 0);
    assert.ok(server, 'artifact contains the correlated SERVER span');
    assert.ok(internal, 'artifact contains the explicit INTERNAL span');
    assert.equal(server.parentSpanId, artifact.actions[0].spanId);
    assert.equal(internal.parentSpanId, server.spanId);
    assert.equal(server.traceId, artifact.actions[0].traceId);
    assert.equal(internal.traceId, server.traceId);
    assert.equal(artifact.spans.length, 2);
    assert.ok(artifact.spans.every(span => span.traceId === artifact.actions[0].traceId));
    assert.equal(server.source.status, 'unknown');
    assert.equal(internal.source.status, 'unknown');
    assert.ok(artifact.spans.every(span => Number.isFinite(span.durationMs) && span.durationMs >= 0));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await within(page.goto(viewerLine), 'viewer page load');
    await within(page.getByTestId('trail').waitFor(), 'viewer trail render');
    assert.equal(await page.locator('[data-action-index]').count(), 1);
    await page.locator('[data-span-id]').filter({ has: page.locator('.span-kind', { hasText: 'Internal' }) }).click();
    assert.match(await page.getByTestId('span-details').innerText(), /Unknown source/);
  } catch (error) {
    throw new Error(`${error.message}\n${proc.diagnostics()}`);
  } finally {
    if (browser) await browser.close();
    if (proc.child.exitCode === null) {
      proc.child.kill('SIGINT');
      const result = await within(proc.close, 'CLI SIGINT exit');
      assert.equal(result.code, 130, `${proc.diagnostics()}\nsignal exit: ${result.signal}`);
    } else {
      await stopCli(proc);
    }
    assert.deepEqual(await readFile(output), artifactBytes, 'shutdown preserves the published artifact bytes');
    const { mode } = await import('node:fs/promises').then(({ stat }) => stat(output));
    assert.equal(mode & 0o777, 0o600);
    await assert.rejects(fetch(viewerLine), 'viewer listener closes after SIGINT');
    await assertProcessGone(appPid);
    await assertClosed(port);
  }
});

test('checkout response failure does not create artifact and closes app', async t => {
  const app = await fixture(t, { reject: true });
  const port = await reservePort();
  const output = resolve(app.dir, 'absent.json');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output, '--timeout', '1000', '--no-viewer'], { PORT: String(port) });
  let pid;
  try {
    pid = Number(await waitForFile(app.startedFile, proc, 'owned app startup marker'));
    await waitForFile(app.requestFile, proc, 'failed checkout request');
    const result = await within(proc.close, 'failed capture exit', 15000);
    assert.notEqual(result.code, 0, proc.diagnostics());
    assert.match(proc.diagnostics(), /capture: browser action failed/);
    await assert.rejects(access(output), { code: 'ENOENT' }, 'failed capture creates no output');
    await assertProcessGone(pid);
    await assertClosed(port);
  } finally { if (proc.child.exitCode === null) { proc.child.kill('SIGINT'); if (pid) await waitForFile(app.exitedFile, proc, 'owned app cooperative shutdown').catch(() => {}); await stopCli(proc); } }
});

test('preexisting completion marker fails without artifact', async t => {
  const app = await fixture(t, { initialComplete: true });
  const port = await reservePort();
  const output = resolve(app.dir, 'stale.json');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output, '--timeout', '1000', '--no-viewer'], { PORT: String(port) });
  let pid;
  try {
    pid = Number(await waitForFile(app.startedFile, proc, 'owned app startup marker'));
    const result = await within(proc.close, 'stale marker exit', 15000);
    assert.notEqual(result.code, 0, proc.diagnostics());
    assert.match(proc.diagnostics(), /capture: page navigation failed/);
    await assert.rejects(access(app.requestFile), { code: 'ENOENT' }, 'stale initial marker prevents checkout request');
    await assert.rejects(access(output), { code: 'ENOENT' });
    await assertProcessGone(pid);
    await assertClosed(port);
  } finally { if (proc.child.exitCode === null) { proc.child.kill('SIGINT'); if (pid) await waitForFile(app.exitedFile, proc, 'owned app cooperative shutdown').catch(() => {}); await stopCli(proc); } }
});

test('existing output is preserved and prevents app launch', async t => {
  const app = await fixture(t);
  const port = await reservePort();
  const output = resolve(app.dir, 'sentinel.json');
  await writeFile(output, 'sentinel-preserved');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output, '--timeout', '10000', '--no-viewer'], { PORT: String(port) });
  try {
    const result = await within(proc.close, 'existing-output exit', 12000);
    assert.equal(result.code, 1, proc.diagnostics());
    assert.equal(await readFile(output, 'utf8'), 'sentinel-preserved');
    await assert.rejects(readFile(app.startedFile, 'utf8'), { code: 'ENOENT' });
    await assertClosed(port);
  } finally { await stopCli(proc); }
});

test('SIGINT during delayed app readiness kills the owned process', async t => {
  const app = await fixture(t, { delayListen: 5000 });
  const port = await reservePort();
  const output = resolve(app.dir, 'absent.json');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output, '--timeout', '10000', '--no-viewer'], { PORT: String(port) });
  try {
    const pid = Number(await waitForFile(app.startedFile, proc, 'owned app startup marker'));
    assert.ok(Number.isInteger(pid) && pid > 0, `fixture wrote valid owned PID; ${proc.diagnostics()}`);
    proc.child.kill('SIGINT');
    const result = await within(proc.close, 'readiness interruption exit', 12000);
    assert.equal(result.code, 130, proc.diagnostics());
    await assert.rejects(access(output), { code: 'ENOENT' });
    await assertProcessGone(pid);
    await assertClosed(port);
  } finally { await stopCli(proc); }
});

test('SIGINT during an active pending checkout terminates CLI and app', async t => {
  const app = await fixture(t, { hangResponse: true });
  const port = await reservePort();
  const output = resolve(app.dir, 'absent.json');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output, '--timeout', '10000', '--no-viewer'], { PORT: String(port) });
  let pid;
  try {
    pid = Number(await waitForFile(app.startedFile, proc, 'owned app startup marker'));
    await waitForFile(app.requestFile, proc, 'pending checkout request');
    proc.child.kill('SIGINT');
    const result = await within(proc.close, 'active checkout SIGINT exit', 5000);
    assert.equal(result.code, 130, proc.diagnostics());
    await assert.rejects(access(output), { code: 'ENOENT' });
    await assertProcessGone(pid);
    await assertClosed(port);
  } finally {
    if (proc.child.exitCode === null) proc.child.kill('SIGKILL');
    await stopCli(proc);
    if (pid) await assertProcessGone(pid);
  }
});

test('hanging page flush fails within a bound without publishing an artifact', async t => {
  const app = await fixture(t, { hangFlush: true });
  const port = await reservePort();
  const output = resolve(app.dir, 'absent.json');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output, '--timeout', '1000', '--no-viewer'], { PORT: String(port) });
  let pid;
  const started = Date.now();
  try {
    pid = Number(await waitForFile(app.startedFile, proc, 'owned app startup marker'));
    await waitForFile(app.requestFile, proc, 'completed checkout request');
    const result = await within(proc.close, 'hanging flush exit', 8000);
    assert.notEqual(result.code, 0, proc.diagnostics());
    assert.match(proc.diagnostics(), /capture: browser action failed/);
    assert.ok(Date.now() - started <= 8000, `flush failure exceeded bound; ${proc.diagnostics()}`);
    await assert.rejects(access(output), { code: 'ENOENT' });
    await assertProcessGone(pid);
    await assertClosed(port);
  } finally {
    if (proc.child.exitCode === null) proc.child.kill('SIGKILL');
    await stopCli(proc);
    if (pid) await assertProcessGone(pid);
  }
});

test('SDK shutdown rejection fails capture without exposing its error or publishing', async t => {
  const app = await fixture(t, { rejectShutdown: true });
  const port = await reservePort();
  const output = resolve(app.dir, 'absent.json');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output, '--timeout', '1000', '--no-viewer'], { PORT: String(port) });
  let pid;
  try {
    pid = Number(await waitForFile(app.startedFile, proc, 'owned app startup marker'));
    await waitForFile(app.requestFile, proc, 'checkout before SDK shutdown');
    const result = await within(proc.close, 'SDK shutdown rejection exit', 8000);
    await waitForFile(app.shutdownAttemptFile, proc, 'SDK shutdown override invocation');
    assert.notEqual(result.code, 0, proc.diagnostics());
    assert.match(proc.diagnostics(), /capture: resource shutdown failed/);
    assert.doesNotMatch(proc.diagnostics(), /PRIVATE_SHUTDOWN_MARKER/);
    await assert.rejects(access(output), { code: 'ENOENT' });
    await assertProcessGone(pid);
    await assertClosed(port);
  } finally {
    if (proc.child.exitCode === null) proc.child.kill('SIGKILL');
    await stopCli(proc);
    if (pid) await assertProcessGone(pid);
  }
});

test('preexisting traceparent rejects checkout capture and closes app', async t => {
  const app = await fixture(t, { completeBeforeResponseEnd: true, preexistingTraceparent: true });
  const port = await reservePort();
  const output = resolve(app.dir, 'absent.json');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output, '--timeout', '1000', '--no-viewer'], { PORT: String(port) });
  let pid;
  try {
    pid = Number(await waitForFile(app.startedFile, proc, 'owned app startup marker'));
    await waitForFile(app.requestFile, proc, 'request preserving preexisting traceparent');
    const result = await within(proc.close, 'preexisting traceparent exit', 8000);
    assert.notEqual(result.code, 0, proc.diagnostics());
    assert.match(proc.diagnostics(), /capture: browser action failed/);
    await assert.rejects(access(output), { code: 'ENOENT' });
    await assertProcessGone(pid);
    await assertClosed(port);
  } finally {
    if (proc.child.exitCode === null) proc.child.kill('SIGKILL');
    await stopCli(proc);
    if (pid) await assertProcessGone(pid);
  }
});

test('unfinished checkout response fails rather than accepting the UI marker', async t => {
  const app = await fixture(t, { completeBeforeResponseEnd: true });
  const port = await reservePort();
  const output = resolve(app.dir, 'absent.json');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output, '--timeout', '1000', '--no-viewer'], { PORT: String(port) });
  let pid;
  try {
    pid = Number(await waitForFile(app.startedFile, proc, 'owned app startup marker'));
    await waitForFile(app.requestFile, proc, 'checkout request with unfinished response');
    const result = await within(proc.close, 'unfinished response exit', 8000);
    assert.notEqual(result.code, 0, proc.diagnostics());
    await assert.rejects(access(output), { code: 'ENOENT' });
    await assertProcessGone(pid);
    await assertClosed(port);
  } finally {
    if (proc.child.exitCode === null) proc.child.kill('SIGKILL');
    await stopCli(proc);
    if (pid) await assertProcessGone(pid);
  }
});

test('no-viewer capture exits successfully and stops the app', async t => {
  const app = await fixture(t);
  const port = await reservePort();
  const output = resolve(app.dir, 'capture.json');
  const proc = launch(['--entry', app.entry, '--url', `http://127.0.0.1:${port}/`, '--endpoint', `http://127.0.0.1:${port}/checkout`, '--click', '#checkout', '--complete', '#status', '--text', 'checkout complete', '--output', output, '--timeout', '10000', '--no-viewer'], { PORT: String(port) });
  try {
    const pid = Number(await waitForFile(app.startedFile, proc, 'owned app startup marker'));
    const started = Date.now();
    const result = await within(proc.close, 'no-viewer capture exit', 15000);
    assert.equal(result.code, 0, proc.diagnostics());
    assert.ok(Date.now() - started < 6500, `no-viewer capture retained configured timeout; ${proc.diagnostics()}`);
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.ok(parseArtifact(await readFile(output, 'utf8')).actions.length === 1);
    await assertProcessGone(pid);
    await assertClosed(port);
  } finally { await stopCli(proc); }
});
