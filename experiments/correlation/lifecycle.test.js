import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { startChild, stopChild, runProof } from './run.js';

const fixture = fileURLToPath(new URL('./lifecycle-fixture.js', import.meta.url));
const interruptFixture = fileURLToPath(new URL('./interrupt-fixture.js', import.meta.url));
const withMode = mode => (...args) => {
  args[1] = [...args[1], mode];
  return nodeSpawn(...args);
};
const dead = pid => {
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
};

test('child exit before readiness rejects without hanging and is reaped', async () => {
  const state = startChild({ childProgram: fixture, spawn: withMode('exit-before-ready') });
  const pid = state.child.pid;
  await assert.rejects(state.ready, /exited before readiness/);
  await stopChild(state);
  assert.equal(dead(pid), true);
});

test('startup timeout cleans a child that never sends ready', async () => {
  const state = startChild({ childProgram: resolve(fixture), startupTimeout: 100, spawn: withMode('never-ready') });
  const pid = state.child.pid;
  await assert.rejects(state.ready, /startup timed out/);
  await stopChild(state);
  assert.equal(dead(pid), true);
});

test('SIGTERM-resistant child is killed within bounded time', async () => {
  const state = startChild({ childProgram: fixture, spawn: withMode('ignore-term') });
  await state.ready;
  const pid = state.child.pid;
  const started = Date.now();
  await stopChild(state, { termTimeout: 100, killTimeout: 1000 });
  assert.ok(Date.now() - started < 1500);
  assert.equal(dead(pid), true);
});

test('browser launch rejection and run assertion failure both clean child process', async () => {
  let pid;
  await assert.rejects(runProof({
    childProgram: fixture,
    spawn: (...args) => { const processChild = withMode('never-ready')(...args); pid = processChild.pid; return processChild; },
    startupTimeout: 50, output: false,
  }), /startup timed out/);
  assert.equal(dead(pid), true);

  await assert.rejects(runProof({
    childProgram: fixture,
    spawn: (...args) => { const processChild = withMode('ready')(...args); pid = processChild.pid; return processChild; },
    launchBrowser: async () => { throw new Error('simulated browser launch failure'); }, output: false,
  }), /simulated browser launch failure/);
  assert.equal(dead(pid), true);

  await assert.rejects(runProof({
    childProgram: fixture,
    spawn: (...args) => { const processChild = withMode('ready')(...args); pid = processChild.pid; return processChild; },
    launchBrowser: async () => ({ newPage: async () => { throw new Error('simulated assertion failure'); }, close: async () => {} }), output: false,
  }), /simulated assertion failure/);
  assert.equal(dead(pid), true);
});

test('spawn errors reject readiness without leaking unhandled errors', async () => {
  const expected = new Error('simulated spawn error');
  const state = startChild({ spawn: () => {
    const child = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => child.emit('error', expected));
    return child;
  } });
  await assert.rejects(state.ready, error => error === expected);
});

test('SIGTERM during delayed browser launch retains cleanup and rejects', async () => {
  await assertInterruptedCleanup('launch', 'SIGTERM');
});

test('repeated SIGTERM during delayed browser close retains cleanup and rejects', async () => {
  await assertInterruptedCleanup('close', 'SIGTERM', true);
});

async function assertInterruptedCleanup(targetStage, signal, repeat = false) {
  const child = nodeSpawn(process.execPath, [interruptFixture], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const messages = [];
  let serverPid;
  let sawTarget = false;
  child.on('message', message => {
    messages.push(message);
    if (message.type === 'server') serverPid = message.pid;
    if (message.type === 'stage' && message.value === targetStage && !sawTarget) {
      sawTarget = true;
      child.kill(signal);
      if (repeat) setTimeout(() => child.kill(signal), 50);
    }
  });
  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('interrupt fixture timed out')); }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, terminationSignal) => {
      clearTimeout(timer);
      resolve({ code, terminationSignal });
    });
  });
  assert.ok(Date.now() - started < 5000, 'interrupt cleanup must be bounded');
  assert.equal(result.code, 1, `runner must reject interruption: ${JSON.stringify(result)}`);
  assert.ok(messages.some(message => message.type === 'browser-closed'), 'browser close must complete');
  assert.ok(serverPid, 'fixture must report server PID');
  assert.equal(dead(serverPid), true, 'server process must be dead');
}
