import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { parsePort } from './run.js';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run.js', import.meta.url));
const timeout = 7000;

test('PORT accepts only decimal integers in range and defaults to ephemeral', () => {
  assert.equal(parsePort(undefined), 0);
  assert.equal(parsePort(''), 0);
  for (const value of ['0', '1', '65535']) assert.equal(parsePort(value), Number(value));
  for (const value of ['-1', '+1', '1.5', ' 1', '01', '65536', '1e2', 'x', '0x10']) assert.throws(() => parsePort(value), /PORT/);
});

async function scenario(source, { signals = [], expectExit = 0, env = {} } = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env, SPANTRAIL_DEMO_TEST_RUNNER_PATH: runner } });
  let stdout = '';
  let stderr = '';
  let pending = '';
  const markers = new Map();
  const seen = new Map();
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
    pending += chunk;
    for (;;) {
      const index = pending.indexOf('\n');
      if (index < 0) break;
      const [key, ...parts] = pending.slice(0, index).split(':');
      pending = pending.slice(index + 1);
      const value = parts.join(':');
      seen.set(key, value);
      const listeners = markers.get(key);
      if (listeners) { markers.delete(key); for (const listener of listeners) listener(value); }
    }
  });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const waitFor = key => {
    if (seen.has(key)) return Promise.resolve(seen.get(key));
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        child.removeListener('exit', onExit);
        markers.set(key, (markers.get(key) ?? []).filter(item => item !== listener));
      };
      const listener = value => { cleanup(); resolve(value); };
      const onExit = (code, signal) => { cleanup(); reject(new Error(`Child exited (${code ?? signal}) waiting for ${key}; stdout=${stdout}; stderr=${stderr}`)); };
      if (!markers.has(key)) markers.set(key, []);
      markers.get(key).push(listener);
      child.once('exit', onExit);
      timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${key}; stdout=${stdout}; stderr=${stderr}`)); }, timeout);
    });
  };
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve([code, signal])));
  const deadline = setTimeout(() => child.kill('SIGKILL'), timeout);
  try {
    for (const [key, signal] of signals) {
      await waitFor(key);
      child.kill(signal);
    }
    const [code, signal] = await exited;
    assert.equal(signal, null, `stdout=${stdout}; stderr=${stderr}`);
    assert.equal(code, expectExit, `stdout=${stdout}; stderr=${stderr}`);
    return { stdout, stderr };
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
}

const importRun = `import assert from 'node:assert/strict'; import { pathToFileURL } from 'node:url'; const { runDemo } = await import(pathToFileURL(process.env.SPANTRAIL_DEMO_TEST_RUNNER_PATH));`;
const fakeBuild = `const { EventEmitter } = await import('node:events'); const build = new EventEmitter(); build.exitCode = null; build.signalCode = null;`;
const completeBuild = `launch: () => { const child = new (await import('node:events')).EventEmitter(); child.exitCode = null; child.signalCode = null; queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0, null); }); return child; }`;

test('build rejection and synchronous/asynchronous spawn errors preserve original errors and prevent later stages', async () => {
  const result = await scenario(`${importRun}
import { EventEmitter } from 'node:events';
const failures = [new Error('sync spawn'), Object.assign(new Error('async spawn'), { async: true })];
for (const launch of [() => { throw failures[0]; }, () => { const child = new EventEmitter(); child.exitCode = undefined; child.signalCode = undefined; queueMicrotask(() => child.emit('error', failures[1])); return child; }]) {
  const calls = [];
  try { await runDemo({ launch: (...args) => { calls.push('build'); return launch(...args); }, proof: async () => calls.push('proof'), viewer: async () => calls.push('viewer') }); process.exitCode = 4; }
  catch (error) { assert.ok(failures.includes(error), 'original spawn error must be propagated'); }
  assert.deepEqual(calls, ['build']);
}
const failed = new EventEmitter(); failed.exitCode = null; failed.signalCode = null;
queueMicrotask(() => { failed.exitCode = 7; failed.emit('exit', 7, null); });
try { await runDemo({ launch: () => failed }); process.exitCode = 5; }
catch (error) { assert.equal(error.message, 'Build failed (7)'); }
`);
  assert.equal(result.stdout, '');
});

test('proof failure prevents viewer startup and preserves its error', async () => {
  await scenario(`${importRun}\n${fakeBuild}\nqueueMicrotask(() => { build.exitCode = 0; build.emit('exit', 0, null); }); try { await runDemo({ launch: () => build, proof: async () => { throw new Error('proof failed'); }, viewer: async () => { console.log('BAD_VIEWER'); } }); process.exitCode = 4; } catch (error) { assert.equal(error.message, 'proof failed'); }`);
});

test('proof rejection latches exit code 1 for every falsy thrown value', async () => {
  await scenario(`${importRun}\nimport { EventEmitter } from 'node:events';\nfor (const reason of [null, undefined, false, 0, '']) { const intent = { code: undefined }; let caught = false; const build = new EventEmitter(); build.exitCode = null; build.signalCode = null; try { await runDemo({ intent, launch: () => { queueMicrotask(() => { build.exitCode = 0; build.emit('exit', 0, null); }); return build; }, proof: async () => { throw reason; }, viewer: async () => { console.log('BAD_VIEWER'); } }); process.exitCode = 4; } catch (error) { caught = true; assert.equal(error, reason); assert.equal(intent.code, 1); } assert.equal(caught, true); }`);
});

test('proof cleanup AggregateError remains the rejection while exit intent is latched', async () => {
  await scenario(`${importRun}
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const runnerURL = pathToFileURL(process.env.SPANTRAIL_DEMO_TEST_RUNNER_PATH);
const proofURL = new URL('../correlation/run.js', runnerURL);
const lifecycleURL = new URL('../correlation/lifecycle-fixture.js', runnerURL);
const { runProof } = await import(proofURL);
import { EventEmitter } from 'node:events';
const operation = Object.freeze(new Error('browser operation'));
const cleanup = Object.freeze(new Error('browser cleanup'));
let viewerCalls = 0;
const intent = { code: undefined };
const build = new EventEmitter(); build.exitCode = null; build.signalCode = null;
try { await runDemo({ intent, launch: () => { queueMicrotask(() => { build.exitCode = 0; build.emit('exit', 0, null); }); return build; }, proof: options => runProof({ ...options, childProgram: fileURLToPath(lifecycleURL), spawn: (exe, args, opts) => nodeSpawn(exe, [...args, 'ready'], opts), output: false, launchBrowser: async () => ({ newPage: async () => { throw operation; }, close: async () => { process.emit('SIGINT'); process.emit('SIGTERM'); throw cleanup; } }) }), viewer: async () => { viewerCalls++; } }); process.exitCode = 4; }
catch (error) { assert.ok(error instanceof AggregateError); assert.ok(error.errors.includes(operation)); assert.ok(error.errors.includes(cleanup)); assert.equal(error.cause, operation); assert.equal(intent.code, 1); }
assert.equal(viewerCalls, 0); assert.equal(operation.code, undefined);`);
});

test('first browser cleanup failure latches exit intent before a later signal', async () => {
  await scenario(`${importRun}
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
const runnerURL = pathToFileURL(process.env.SPANTRAIL_DEMO_TEST_RUNNER_PATH);
const { runProof } = await import(new URL('../correlation/run.js', runnerURL));
const lifecycleURL = new URL('../correlation/lifecycle-fixture.js', runnerURL);
const cleanup = Object.freeze(new Error('browser cleanup'));
let viewerCalls = 0;
const intent = { code: undefined };
const build = new EventEmitter(); build.exitCode = null; build.signalCode = null;
queueMicrotask(() => { build.exitCode = 0; build.emit('exit', 0, null); });
try {
  await runDemo({ intent, launch: () => build, proof: options => runProof({ ...options, childProgram: fileURLToPath(lifecycleURL), spawn: (exe, args, opts) => nodeSpawn(exe, [...args, 'ready'], opts), output: false, skipProofOperations: true, launchBrowser: async () => ({ newPage: async () => ({}), close: async () => { setImmediate(() => process.emit('SIGINT')); throw cleanup; } }) }), viewer: async () => { viewerCalls++; } });
  process.exitCode = 4;
} catch (error) {
  assert.ok(error instanceof AggregateError);
  assert.ok(error.errors.includes(cleanup));
  assert.equal(intent.code, 1);
}
assert.equal(viewerCalls, 0);
`);
});

test('signal-first proof failure preserves signal intent and final rejection', async () => {
  await scenario(`${importRun}\n${fakeBuild}\nqueueMicrotask(() => { build.exitCode = 0; build.emit('exit', 0, null); }); const intent = { code: undefined }; const later = new Error('late proof failure'); try { await runDemo({ intent, launch: () => build, proof: options => { process.emit('SIGTERM'); options.onFailure(later); throw later; }, viewer: async () => { console.log('BAD_VIEWER'); } }); process.exitCode = 4; } catch (error) { assert.equal(error, later); assert.equal(intent.code, 143); }`);
});

test('SIGINT during build stops and reaps real child, prevents later stages, and propagates 130', async () => {
  const source = `${importRun}
import { spawn } from 'node:child_process';
let child;
const run = runDemo({ launch: () => { child = spawn(process.execPath, ['-e', 'console.log("CHILD_READY"); setInterval(()=>{},1000)'], { stdio: ['ignore','pipe','ignore'] }); child.stdout.once('data', () => { console.log('PID:' + child.pid); process.kill(process.pid, 'SIGINT'); }); return child; }, proof: async () => console.log('BAD_PROOF'), viewer: async () => console.log('BAD_VIEWER') });
try { await run; } catch (error) { if (error.code !== 130) process.exitCode = 2; else process.exitCode = error.code; }
if (!child || child.exitCode === null && child.signalCode === null) process.exitCode = 3;
`;
  const result = await scenario(source, { expectExit: 130 });
  assert.match(result.stdout, /PID:\d+/);
  assert.doesNotMatch(result.stdout, /BAD_(PROOF|VIEWER)/);
});

test('SIGTERM during build escalates for TERM-resistant real child and propagates 143', async () => {
  const source = `${importRun}
import { spawn } from 'node:child_process';
let child;
const run = runDemo({ termTimeout: 60, killTimeout: 1000, launch: () => { child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); console.log("RESIST_READY"); setInterval(()=>{},1000)'], { stdio: ['ignore','pipe','ignore'] }); child.stdout.once('data', () => { console.log('PID:' + child.pid); process.kill(process.pid, 'SIGTERM'); }); return child; }, proof: async () => console.log('BAD_PROOF') });
try { await run; } catch (error) { if (error.code !== 143) process.exitCode = 2; else process.exitCode = error.code; }
if (!child || child.exitCode !== null || child.signalCode !== 'SIGKILL') process.exitCode = 3;
`;
  const result = await scenario(source, { expectExit: 143 });
  assert.match(result.stdout, /PID:\d+/);
  assert.doesNotMatch(result.stdout, /BAD_PROOF/);
});

test('signal during proof waits for registered signal acknowledgement before resolving', async () => {
  const result = await scenario(`${importRun}\n${fakeBuild}\nqueueMicrotask(() => { build.exitCode = 0; build.emit('exit', 0, null); }); const run = runDemo({ launch: () => build, proof: () => new Promise(resolve => { const keepalive = setInterval(() => {}, 1000); process.once('SIGTERM', () => { console.log('PROOF_SIGNAL_ACK'); clearInterval(keepalive); resolve(); }); process.on('SIGTERM', () => {}); console.log('PROOF_READY'); }), viewer: async () => console.log('BAD_VIEWER') }); try { await run; } catch (error) { if (error.code !== 143) process.exitCode = 2; else process.exitCode = error.code; }`, { signals: [['PROOF_READY', 'SIGTERM']], expectExit: 143 });
  assert.match(result.stdout, /PROOF_SIGNAL_ACK/);
  assert.doesNotMatch(result.stdout, /BAD_VIEWER/);
});

test('startup signal closes eventual real loopback server without success output', async () => {
  const result = await scenario(`${importRun}
import { createServer } from 'node:net';
${fakeBuild}
let server;
queueMicrotask(() => { build.exitCode = 0; build.emit('exit', 0, null); });
const run = runDemo({ launch: () => build, proof: async () => {}, viewer: async () => { server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; process.once('SIGTERM', () => { console.log('STARTUP_SIGNAL_ACK'); }); console.log('PORT_READY:' + port); await new Promise(resolve => process.once('SIGTERM', resolve)); return { origin: 'http://127.0.0.1:' + port, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }; } });
try { await run; } catch (error) { if (error.code !== 143) process.exitCode = 2; else process.exitCode = error.code; }
if (server?.listening) process.exitCode = 3;`, { signals: [['PORT_READY', 'SIGTERM']], expectExit: 143 });
  assert.match(result.stdout, /STARTUP_SIGNAL_ACK/);
  assert.doesNotMatch(result.stdout, /SpanTrail demo:|Startup:/);
});

test('repeated signals after hold marker preserve SIGINT, close real port, and retain success output order', async () => {
  const source = `${importRun}
import { createServer } from 'node:net';
${fakeBuild}
let port; let closed = false;
queueMicrotask(() => { build.exitCode = 0; build.emit('exit', 0, null); });
const run = runDemo({ launch: () => build, proof: async () => {}, viewer: async () => { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port; return { origin: 'http://127.0.0.1:' + port, close: () => new Promise((resolve, reject) => { process.once('SIGTERM', () => { console.log('CLEANUP_SIGNAL_ACK'); server.close(error => { if (error) reject(error); else { closed = true; resolve(); } }); }); console.log('CLEANUP_STARTED'); }) }; } });
try { await run; } catch (error) { if (error.code !== 130) process.exitCode = 2; else process.exitCode = error.code; }
if (!closed) process.exitCode = 3;
const probe = createServer(); try { await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); }); } finally { if (probe.listening) await new Promise(resolve => probe.close(resolve)); }
`;
  const result = await scenario(source, { signals: [['Press Ctrl+C to stop.', 'SIGINT'], ['CLEANUP_STARTED', 'SIGTERM']], expectExit: 130 });
  assert.match(result.stdout, /SpanTrail demo: http:\/\/127\.0\.0\.1:\d+/);
  assert.match(result.stdout, /Startup: \d+\.\d{2} seconds/);
  assert.ok(result.stdout.indexOf('SpanTrail demo:') < result.stdout.indexOf('Startup:'));
  assert.ok(result.stdout.indexOf('Startup:') < result.stdout.indexOf('Press Ctrl+C to stop.'));
  assert.match(result.stdout, /CLEANUP_SIGNAL_ACK/);
});
