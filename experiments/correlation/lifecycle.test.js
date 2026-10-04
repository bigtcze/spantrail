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

test('Playwright signal handling is disabled so runProof owns terminal cleanup signals', async () => {
  let launchOptions;
  await assert.rejects(runProof({
    childProgram: fixture,
    spawn: (...args) => withMode('ready')(...args),
    launchBrowser: async options => { launchOptions = options; throw new Error('stop after launch options'); },
    output: false,
  }), /stop after launch options/);
  assert.equal(launchOptions.handleSIGINT, false);
  assert.equal(launchOptions.handleSIGTERM, false);
});

test('SIGTERM during pending launch waits for late server acquisition and closes it', async () => {
  let pid;
  let closeCalled = false;
  let resolveLaunch;
  let markLaunchEntered;
  const launchGate = new Promise(resolve => { resolveLaunch = resolve; });
  const launchEntered = new Promise(resolve => { markLaunchEntered = resolve; });
  const run = runProof({
    childProgram: fixture,
    spawn: (...args) => { const processChild = withMode('ready')(...args); pid = processChild.pid; return processChild; },
    launchBrowser: () => { markLaunchEntered(); return launchGate; },
    output: false,
  });
  let completed = false;
  run.finally(() => { completed = true; }).catch(() => {});
  await launchEntered;
  process.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false, 'runProof must not complete before pending launch settles');
  resolveLaunch({ close: async () => { closeCalled = true; } });
  await assert.rejects(run, /Interrupted by SIGTERM/);
  assert.equal(closeCalled, true, 'late-acquired browser server must be closed');
  assert.equal(dead(pid), true, 'child process must be reaped');
});

test('browser acquired after bounded launch settlement is closed exactly once', async () => {
  let pid;
  let resolveLaunch;
  let closeCalls = 0;
  const launch = new Promise(resolve => { resolveLaunch = resolve; });
  let markLaunchEntered;
  const launchEntered = new Promise(resolve => { markLaunchEntered = resolve; });
  const listeners = Object.fromEntries(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, process.listenerCount(signal)]));
  const run = runProof({ childProgram: fixture, spawn: (...args) => { const child = withMode('ready')(...args); pid = child.pid; return child; }, browserTimeout: 3000, launchBrowser: () => { markLaunchEntered(); return launch; }, output: false });
  await launchEntered;
  process.emit('SIGTERM');
  let caught = false;
  try { await run; } catch (error) { caught = true; assert.ok(error instanceof AggregateError); }
  assert.equal(caught, true);
  const acquired = { close: async () => { closeCalls += 1; } };
  resolveLaunch(acquired);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closeCalls, 1);
  assert.equal(dead(pid), true);
  for (const signal of Object.keys(listeners)) assert.equal(process.listenerCount(signal), listeners[signal]);
});

test('falsey and frozen launch rejections preserve identity and cleanup listeners', async t => {
  for (const expected of [null, undefined, false, 0, '', {}, Object.freeze(new Error('frozen'))]) {
    await t.test(String(expected), async () => {
      let pid;
      const listeners = Object.fromEntries(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, process.listenerCount(signal)]));
      let caught = false;
      try {
        await runProof({
          childProgram: fixture,
          spawn: (...args) => { const child = withMode('ready')(...args); pid = child.pid; return child; },
          launchBrowser: async () => { throw expected; }, output: false,
        });
      } catch (reason) {
        caught = true;
        assert.equal(reason, expected);
      }
      assert.equal(caught, true);
      assert.equal(dead(pid), true);
      for (const signal of Object.keys(listeners)) assert.equal(process.listenerCount(signal), listeners[signal]);
    });
  }
});

test('browser close interruption does not replace operation failure', async () => {
  const operation = new Error('new page failed');
  let pid;
  const listeners = Object.fromEntries(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, process.listenerCount(signal)]));
  let caught;
  try {
    await runProof({
      childProgram: fixture,
      spawn: (...args) => { const child = withMode('ready')(...args); pid = child.pid; return child; },
      launchBrowser: async () => ({ newPage: async () => { throw operation; }, close: async () => { process.emit('SIGINT'); } }),
      output: false,
    });
  } catch (reason) { caught = reason; }
  assert.equal(caught, operation);
  assert.equal(dead(pid), true);
  for (const signal of Object.keys(listeners)) assert.equal(process.listenerCount(signal), listeners[signal]);
});

test('operation failure remains available when browser cleanup also fails', async () => {
  const operation = new Error('primary operation failure');
  const cleanup = new Error('primary close failure');
  await assert.rejects(runProof({
    childProgram: fixture,
    spawn: (...args) => withMode('ready')(...args),
    startupTimeout: 1000,
    launchBrowser: async () => ({ newPage: async () => { throw operation; }, close: async () => { throw cleanup; }, kill: async () => { throw new Error('kill failure'); } }),
    output: false,
  }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, operation, 'primary operation error is preserved as cause');
    assert.ok(error.errors.includes(operation), 'primary operation error remains in aggregate members');
    assert.ok(error.errors.some(item => item.message === 'primary close failure'), 'cleanup error remains in aggregate members');
    return true;
  });
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
