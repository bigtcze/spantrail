import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const harness = resolve(directory, 'run.js');
const loader = resolve(directory, 'probe-loader.mjs');
const timeout = 60000;

function runProbe(mode, postgresUrl) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--import', loader, harness], {
      cwd: root,
      env: { ...process.env, SPANTRAIL_POSTGRES_URL: postgresUrl, SPANTRAIL_POSTGRES_PROBE: mode },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 1500);
      force.unref();
      if (!finished) {
        finished = true;
        reject(new Error(`${mode} probe exceeded ${timeout}ms\n${stdout}\n${stderr}`));
      }
    }, timeout);
    timer.unref();
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      clearTimeout(timer);
      finished = true;
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      resolveResult({ code, signal, stdout, stderr });
    });
  });
}

function assertDidNotPass(result, diagnostic) {
  assert.doesNotMatch(result.stdout, /PostgreSQL browser integration passed:/);
  assert.match(`${result.stdout}\n${result.stderr}`, diagnostic);
  assert.notEqual(result.code, 0);
}

test('loopback PostgreSQL URLs with query parameters are rejected before startup', async () => {
  for (const query of ['?host=remote', '?host=/var/run/postgresql', '?ssl=true', '?']) {
    const result = await runProbe('normal', `postgresql://user:secret@localhost/db${query}`);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /external PostgreSQL URL must target loopback without query parameters/);
    assert.doesNotMatch(result.stderr, /secret/);
    assert.doesNotMatch(result.stdout, /SPANTRAIL_APP_READY|SPANTRAIL_PROBE container=/);
  }
});

test('normal PostgreSQL harness succeeds in a real subprocess', async () => {
  const result = await runProbe('normal');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /PostgreSQL browser integration passed:/);
});

test('readiness waits for delayed application startup', async () => {
  const result = await runProbe('delayed-startup');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /PostgreSQL browser integration passed:/);
  assert.match(result.stdout, /SPANTRAIL_PROBE delayed-startup-ready/);
});

test('a dropped HTTP request after a snapshot is observed as a failed harness run', async () => {
  const result = await runProbe('abort-http-after-snapshot');
  assertDidNotPass(result, /SPANTRAIL_PROBE http-aborted-after-snapshot/);
  assert.match(result.stdout, /SPANTRAIL_PROBE observed-aborted-export-attempt/);
  assert.match(result.stderr, /unexpected exporter HTTP attempts or deliveries/);
});

test('shutdown rejection and post-removal cleanup failure cannot report success', async () => {
  for (const [mode, marker, diagnostic] of [
    ['reject-shutdown', /SPANTRAIL_PROBE rejecting-sdk-shutdown/, /shutdown acknowledgement missing or rejected|shutdown failed/],
    ['shutdown-http', /SPANTRAIL_PROBE shutdown-http-attempt/, /outbound|privacy|shutdown/],
    ['fail-cleanup-after-remove', null, /cleanup failed/],
  ]) {
    const result = await runProbe(mode);
    if (marker) assert.match(result.stdout, marker);
    assertDidNotPass(result, diagnostic);
  }
});

test('repeated SIGINT during an active request cleans up the app and database', async () => {
  const child = spawn(process.execPath, ['--import', loader, harness], {
    cwd: root,
    env: { ...process.env, SPANTRAIL_POSTGRES_URL: undefined, SPANTRAIL_POSTGRES_PROBE: 'signal-active-request' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once('error', rejectClose);
    child.once('close', (code, signal) => resolveClose([code, signal]));
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
  timer.unref();
  try {
    await new Promise((resolveSignal, reject) => {
      const deadline = Date.now() + 45000;
      const poll = async () => {
        if (output.includes('SPANTRAIL_PROBE active-request PID=')) {
          child.kill('SIGINT');
          await delay(100);
          child.kill('SIGINT');
          resolveSignal();
          return;
        }
        if (child.exitCode !== null || Date.now() >= deadline) {
          reject(new Error(`active-request marker not observed\n${output}`));
          return;
        }
        setTimeout(poll, 25).unref();
      };
      void poll();
    });
    const [code, signal] = await closed;
    assert.notEqual(code, 0, output);
    assert.equal(signal, null, output);
    const appMatch = output.match(/SPANTRAIL_PROBE active-request PID=(\d+) PORT=(\d+)/);
    const containerMatch = output.match(/SPANTRAIL_PROBE container=(spantrail-postgres-[a-f0-9-]+)/);
    assert.ok(appMatch, output);
    assert.ok(containerMatch, output);
    assert.doesNotMatch(output, /PostgreSQL browser integration passed:/);
    assert.throws(() => process.kill(Number(appMatch[1]), 0), error => error.code === 'ESRCH');
    await assert.rejects(new Promise((resolveConnect, rejectConnect) => {
      const socket = createConnection({ host: '127.0.0.1', port: Number(appMatch[2]) });
      socket.once('connect', () => { socket.destroy(); resolveConnect(); });
      socket.once('error', rejectConnect);
    }));
    const inspect = spawn('docker', ['inspect', containerMatch[1]], { stdio: 'ignore' });
    const [inspectCode] = await once(inspect, 'close');
    assert.notEqual(inspectCode, 0, `database container ${containerMatch[1]} leaked`);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});
