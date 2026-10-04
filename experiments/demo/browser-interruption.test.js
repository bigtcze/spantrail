import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const fixture = fileURLToPath(new URL('./browser-interruption-fixture.js', import.meta.url));
const timeout = 30000;

function waitForMessage(child, messages, type, diagnostics = () => '') {
  if (messages.has(type)) return Promise.resolve(messages.get(type));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${type}; messages=${JSON.stringify([...messages])}`)), timeout);
    const onMessage = message => {
      if (message?.type === type) finish(null, message);
      else if (message?.type === 'caught' && type !== 'caught') finish(new Error(`Fixture failed waiting for ${type}: ${JSON.stringify(message)}; ${diagnostics()}`));
    };
    const onExit = (code, signal) => finish(new Error(`Child exited (${code ?? signal}) waiting for ${type}; messages=${JSON.stringify([...messages])}; ${diagnostics()}`));
    function finish(error, value) {
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      child.removeListener('exit', onExit);
      if (error) reject(error);
      else resolve(value);
    }
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}

async function isPortClosed(port) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve(true)));
  });
}

function processState(pid) {
  try {
    process.kill(pid, 0);
    const status = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return status.slice(status.lastIndexOf(')') + 2).split(' ')[0];
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return 'gone';
    throw error;
  }
}

function isProcessGone(pid) {
  const state = processState(pid);
  return state === 'gone';
}

function assertProcessAlive(pid, description) {
  assert.notEqual(processState(pid), 'gone', `${description} ${pid} is gone before interruption`);
  assert.notEqual(processState(pid), 'Z', `${description} ${pid} is already a zombie before interruption`);
}

function assertRunnerAlive(child) {
  assert.equal(child.exitCode, null, 'fixture runner must remain alive during cleanup assertions');
  assert.equal(child.signalCode, null, 'fixture runner must remain alive during cleanup assertions');
}

async function terminateOwned(pid) {
  if (!pid || isProcessGone(pid)) return;
  try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (await waitForProcessGone(pid)) return;
  try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  assert.ok(await waitForProcessGone(pid), `process ${pid} remains after SIGKILL`);
}

async function waitForProcessGone(pid) {
  const deadline = Date.now() + 5000;
  while (!isProcessGone(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  return isProcessGone(pid);
}

test('browser/CDP setup failure closes acquired resources while fixture runner remains alive', { timeout: timeout + 5000 }, async () => {
  const child = fork(fixture, [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, SPANTRAIL_FAIL_AFTER_BROWSER_ACQUISITION: '1' },
  });
  const messages = new Map();
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.on('message', message => { if (message?.type) messages.set(message.type, message); });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let fixturePid;
  let port;
  let browserPid;
  try {
    const ready = await waitForMessage(child, messages, 'fixture-ready', () => `stdout=${stdout}; stderr=${stderr}`);
    fixturePid = ready.pid;
    port = ready.port;
    const failed = await waitForMessage(child, messages, 'setup-failed', () => `stdout=${stdout}; stderr=${stderr}`);
    browserPid = failed.browserPid;
    const descendantPids = failed.descendantPids ?? [];
    assert.match(failed.message, /injected failure after browser\/CDP acquisition/);
    assert.equal(failed.errorMessage, failed.message, 'runProof preserves the original post-acquisition operation error');
    assert.ok(Number.isInteger(browserPid), 'acquired Chromium PID is reported');
    assert.ok(descendantPids.length > 0, 'acquired renderer PIDs are reported');
    assert.equal(messages.has('viewer-started'), false, 'viewer must not start after setup failure');
    assertRunnerAlive(child);
    assert.ok(await waitForProcessGone(fixturePid), `fixture process ${fixturePid} remains; stdout=${stdout}; stderr=${stderr}`);
    assertRunnerAlive(child);
    assert.ok(await waitForProcessGone(browserPid), `Chromium process ${browserPid} remains; stdout=${stdout}; stderr=${stderr}`);
    assertRunnerAlive(child);
    for (const pid of descendantPids) {
      assert.ok(await waitForProcessGone(pid), `Chromium renderer ${pid} remains; stdout=${stdout}; stderr=${stderr}`);
      assertRunnerAlive(child);
    }
    assert.equal(await isPortClosed(port), true, `fixture port ${port} remains open`);
    assertRunnerAlive(child);
    child.send({ type: 'release-runner' });
    const result = await exited;
    assert.equal(result.code, 1, `stdout=${stdout}; stderr=${stderr}`);
    assert.equal(result.signal, null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.send({ type: 'release-runner' }, () => {});
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await terminateOwned(browserPid);
    await terminateOwned(fixturePid);
    if (port) await isPortClosed(port);
  }
});

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`real Chromium and fixture are cleaned up after ${signal} during proof`, { timeout: timeout + 5000 }, async () => {
    const child = fork(fixture, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const messages = new Map();
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('message', message => { if (message?.type) messages.set(message.type, message); });
    const exited = new Promise(resolve => child.once('exit', (code, termSignal) => resolve({ code, signal: termSignal })));
    let fixturePid;
    let browserPid;
    let descendantPids = [];
    let port;
    try {
      const fixtureReady = await waitForMessage(child, messages, 'fixture-ready', () => `stdout=${stdout}; stderr=${stderr}`);
      fixturePid = fixtureReady.pid;
      port = fixtureReady.port;
      const browserReady = await waitForMessage(child, messages, 'browser-ready', () => `stdout=${stdout}; stderr=${stderr}`);
      browserPid = browserReady.pid;
      descendantPids = browserReady.descendantPids ?? [];
      assert.ok(Number.isInteger(browserPid), 'real Chromium PID is reported');
      assert.ok(Array.isArray(descendantPids) && descendantPids.length > 0, 'at least one renderer descendant is observed');
      assertProcessAlive(browserPid, 'Chromium browser');
      for (const pid of descendantPids) assertProcessAlive(pid, 'Chromium renderer');
      child.kill(signal);
      const acknowledged = await waitForMessage(child, messages, 'signal-acknowledged');
      assert.equal(acknowledged.signal, signal);
      child.send({ type: 'release' });
      const caught = await waitForMessage(child, messages, 'caught');
      assert.equal(caught.code, exitCode, `stdout=${stdout}; stderr=${stderr}`);
      assertRunnerAlive(child);
      assert.equal(caught.fixturePid, fixturePid);
      assert.equal(caught.browserPid, browserPid);
      assert.ok(await waitForProcessGone(fixturePid), `fixture process ${fixturePid} remains; stdout=${stdout}; stderr=${stderr}`);
      const browserGone = await waitForProcessGone(browserPid);
      assertRunnerAlive(child);
      assert.ok(browserGone, `Chromium process ${browserPid} remains; stdout=${stdout}; stderr=${stderr}`);
      for (const pid of descendantPids) {
        const descendantGone = await waitForProcessGone(pid);
        assertRunnerAlive(child);
        assert.ok(descendantGone, `Chromium descendant ${pid} remains; stdout=${stdout}; stderr=${stderr}`);
      }
      const portClosed = await isPortClosed(port);
      assertRunnerAlive(child);
      assert.equal(portClosed, true, `fixture port ${port} remains open`);
      assert.equal(messages.has('viewer-started'), false, 'viewer must not start after interruption');
      assert.equal(messages.has('completed'), false, 'interrupted demo must not report completion');
      child.send({ type: 'release-runner' });
      const result = await exited;
      assert.equal(result.signal, null, `stdout=${stdout}; stderr=${stderr}`);
      assert.equal(result.code, exitCode, `stdout=${stdout}; stderr=${stderr}`);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        if (child.connected) {
          child.send({ type: 'release' }, () => {});
          child.send({ type: 'release-runner' }, () => {});
        }
        const gracefulDeadline = Date.now() + 3000;
        while (child.exitCode === null && child.signalCode === null && Date.now() < gracefulDeadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      if (child.exitCode === null && child.signalCode === null) await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
      await terminateOwned(browserPid);
      for (const pid of descendantPids) await terminateOwned(pid);
      await terminateOwned(fixturePid);
      if (port) await isPortClosed(port);
    }
  });
}
