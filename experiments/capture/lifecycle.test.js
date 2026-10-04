import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startCapture } from './session.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromProject = createRequire(resolve(root, 'package.json'));
const sdkPath = requireFromProject.resolve('@opentelemetry/sdk-node');
const dead = pid => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } };
function bounded(promise, label, ms = 8000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]).finally(() => clearTimeout(timer));
}
async function fixture(app, spy) {
  const cwd = await mkdtemp(resolve(tmpdir(), 'spantrail-capture-lifecycle-'));
  const entry = resolve(cwd, 'app.cjs');
  const preload = resolve(cwd, 'spy.cjs');
  await writeFile(entry, app);
  if (spy) await writeFile(preload, spy);
  return { cwd, entry, preload };
}
const intervalApp = 'setInterval(()=>{},1000);';
const patchHeader = `const sdkPath=${JSON.stringify(sdkPath)}; const {NodeSDK}=require(sdkPath);`;

async function dispose(temp, capture) {
  if (capture?.child && capture.child.exitCode === null && capture.child.signalCode === null) {
    capture.child.kill('SIGKILL');
    await bounded(new Promise(resolve => capture.child.once('exit', resolve)), 'forced child cleanup').catch(() => {});
  }
  if (temp) await rm(temp.cwd, { recursive: true, force: true });
}

test('stop waits for shutdown acknowledgement, escalates SIGTERM-resistant app, and memoizes actual exit', async () => {
  const temp = await fixture("process.on('SIGTERM',()=>{});setInterval(()=>{},1000);");
  let capture;
  try {
    capture = await bounded(startCapture({ entry: temp.entry, cwd: root }), 'capture startup');
    const pid = capture.child.pid;
    const acknowledgements = [];
    capture.child.on('message', message => { if (message?.protocol === 'spantrail-capture-v1' && message.type !== 'ready') acknowledgements.push(message); });
    const started = Date.now();
    const [first, second] = await bounded(Promise.all([capture.stop(), capture.stop()]), 'concurrent stop');
    assert.ok(Date.now() - started <= 8000);
    assert.deepEqual(first, second);
    assert.equal(first.signal, 'SIGKILL');
    assert.ok(acknowledgements.some(message => message.ok === true), 'shutdown was acknowledged before escalation');
    assert.equal(dead(pid), true);
    assert.deepEqual(await capture.stop(), first);
  } finally { await dispose(temp, capture); }
});

test('startup rejection is generic and waits until SDK-start-failing child is terminated', async () => {
  const pidFile = 'child.pid';
  const temp = await fixture(intervalApp);
  // Keep the marker and PID files inside this fixture directory.
  const pidPath = resolve(temp.cwd, pidFile);
  await writeFile(temp.preload, `${patchHeader}\nrequire('node:fs').writeFileSync(process.env.SPY_PID_FILE,String(process.pid));\nNodeSDK.prototype.start=function(){throw new Error('PRIVATE_STARTUP_MARKER')};`);
  try {
    await assert.rejects(bounded(startCapture({ entry: temp.entry, cwd: root, env: { SPY_PID_FILE: pidPath }, execArgv: ['--require', temp.preload] }), 'failed SDK startup'), error => {
      assert.match(error.message, /capture startup failed/);
      assert.doesNotMatch(error.message, /PRIVATE_STARTUP_MARKER/);
      return true;
    });
    const pid = Number(await readFile(pidPath, 'utf8'));
    assert.ok(Number.isInteger(pid));
    assert.equal(dead(pid), true, 'startup rejection must follow child termination');
  } finally { await dispose(temp); }
});

test('SDK shutdown rejection stays private on IPC and parent error while child is terminated', async () => {
  const temp = await fixture(intervalApp, `${patchHeader}\nNodeSDK.prototype.shutdown=function(){return Promise.reject(new Error('PRIVATE_SHUTDOWN_MARKER'))};`);
  let capture;
  try {
    capture = await bounded(startCapture({ entry: temp.entry, cwd: root, execArgv: ['--require', temp.preload] }), 'capture startup');
    const pid = capture.child.pid;
    const messages = [];
    capture.child.on('message', message => messages.push(message));
    const result = await bounded(capture.stop(), 'shutdown rejection stop');
    assert.equal(result.code, null);
    assert.equal(result.signal, 'SIGTERM');
    assert.equal(messages.some(message => JSON.stringify(message).includes('PRIVATE_SHUTDOWN_MARKER')), false);
    assert.ok(messages.some(message => message?.protocol === 'spantrail-capture-v1' && message.ok === false && message.error === 'shutdown-failed'));
    assert.equal(dead(pid), true);
  } finally { await dispose(temp, capture); }
});

test('retained SDK starts once and snapshots force-flush, including concurrent snapshots', async () => {
  const temp = await fixture("setInterval(()=>{},1000);process.on('message',m=>{if(m?.type==='counts')process.send({type:'counts',start:globalThis.__starts,flush:globalThis.__flushes})});", `${patchHeader}\nconst originalStart=NodeSDK.prototype.start;NodeSDK.prototype.start=function(...args){globalThis.__starts=(globalThis.__starts||0)+1;return originalStart.apply(this,args)};const base=require('node:module').createRequire(${JSON.stringify(sdkPath)});const {SimpleSpanProcessor}=base('@opentelemetry/sdk-trace-base');const originalFlush=SimpleSpanProcessor.prototype.forceFlush;SimpleSpanProcessor.prototype.forceFlush=function(...args){globalThis.__flushes=(globalThis.__flushes||0)+1;return originalFlush.apply(this,args)};`);
  let capture;
  try {
    capture = await bounded(startCapture({ entry: temp.entry, cwd: root, execArgv: ['--require', temp.preload] }), 'capture startup');
    const [a, b, c] = await bounded(Promise.all([capture.snapshot(), capture.snapshot(), capture.snapshot()]), 'concurrent snapshots');
    assert.deepEqual([a, b, c], [[], [], []]);
    const child = capture.child;
    const counts = await bounded(new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.off('message', listener); reject(new Error('SDK counter report timed out')); }, 2000);
      const listener = message => { if (message?.type === 'counts') { clearTimeout(timer); child.off('message', listener); resolve(message); } };
      child.on('message', listener);
      child.send({ type: 'counts' });
    }), 'SDK counter report');
    assert.equal(counts.start, 1);
    assert.ok(counts.flush >= 3);
    const ack = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.off('message', listener); reject(new Error('shutdown acknowledgement timed out')); }, 2000);
      const listener = message => { if (message?.protocol === 'spantrail-capture-v1' && message.type !== 'ready') { clearTimeout(timer); child.off('message', listener); resolve(message); } };
      child.on('message', listener);
    });
    const stopping = capture.stop();
    assert.equal((await bounded(ack, 'shutdown acknowledgement')).ok, true);
    const result = await bounded(stopping, 'capture stop');
    assert.equal(result.code, null);
    assert.equal(result.signal, 'SIGTERM');
  } finally { await dispose(temp, capture); }
});
