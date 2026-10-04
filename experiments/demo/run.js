import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function parsePort(value) {
  if (value === undefined || value === '') return 0;
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('PORT must be an integer from 0 to 65535');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
  return port;
}

export async function runDemo({ env = process.env, launch = spawn, proof = options => import('../correlation/run.js').then(module => module.runProof(options)), viewer = port => import('../viewer/server.js').then(module => module.startViewer({ port })), stdout = console.log, now = () => performance.now(), termTimeout = 500, killTimeout = 1500, intent = { code: undefined } } = {}) {
  let interrupted;
  let primaryFailure = false;
  let viewerState;
  let child;
  let stage = 'build';
  let failure;
  const start = now();
  let wakeHold;
  let wakeBuild;
  const onSignal = signal => {
    if (!interrupted) {
      interrupted = Object.assign(new Error(`Interrupted by ${signal}`), { code: signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143 });
      if (intent.code === undefined) intent.code = interrupted.code;
      if (child && child.exitCode == null && child.signalCode == null && child.pid != null) {
        try { child.kill('SIGTERM'); } catch {}
      }
      wakeHold?.();
      wakeBuild?.();
    }
  };
  const onInt = () => onSignal('SIGINT');
  const onTerm = () => onSignal('SIGTERM');
  const onHup = () => onSignal('SIGHUP');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  process.on('SIGHUP', onHup);
  const latchFailure = error => {
    failure = error;
    primaryFailure = true;
    if (intent.code === undefined) intent.code = 1;
  };
  const checkInterrupted = () => { if (interrupted) throw interrupted; };
  const bounded = (promise, ms, label) => new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(Object.assign(new Error(`${label} timed out after ${ms}ms`), { name: 'BoundedTimeoutError' })), ms);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolvePromise(value); }, error => { clearTimeout(timer); rejectPromise(error); });
  });
  const stopBuild = async () => {
    if (!child || child.exitCode != null || child.signalCode != null || child.pid == null) return;
    try { child.kill('SIGTERM'); } catch (error) { if (!childExitSettled) throw error; }
    let termTimedOut = false;
    try { await bounded(childExitObserved, termTimeout, 'Build shutdown'); }
    catch (error) {
      if (error?.name !== 'BoundedTimeoutError') throw error;
      termTimedOut = true;
    }
    if (!termTimedOut || childExitSettled) return;
    if (child.exitCode == null && child.signalCode == null && child.pid != null) {
      try { child.kill('SIGKILL'); } catch (error) { if (!childExitSettled) throw error; }
    }
    await bounded(childExitObserved, killTimeout, 'Build kill');
  };
  let childExitObserved;
  let childExitSettled = false;
  let childBuildSuccess;
  try {
    const port = parsePort(env.PORT);
    checkInterrupted();
    child = launch(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'experiments/source-attribution/tsconfig.json')], { cwd: root, stdio: 'inherit' });
    childExitObserved = new Promise(resolveExit => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; childExitSettled = true; resolveExit(value); } };
      child.once('error', error => finish({ error }));
      child.once('exit', (code, signal) => finish({ code, signal }));
    });
    childBuildSuccess = childExitObserved.then(result => {
      if (result.error) throw result.error;
      if (result.code !== 0 || result.signal) throw new Error(result.signal ? `Build failed (${result.signal})` : `Build failed (${result.code})`);
    });
    childBuildSuccess.catch(() => {});
    checkInterrupted();
    await Promise.race([childBuildSuccess, new Promise(resolveBuild => { wakeBuild = resolveBuild; if (interrupted) resolveBuild(); })]);
    wakeBuild = undefined;
    checkInterrupted();
    stage = 'proof';
    checkInterrupted();
    await proof({ onFailure: error => { if (!interrupted) latchFailure(error); } });
    checkInterrupted();
    stage = 'viewer';
    checkInterrupted();
    viewerState = await viewer(port);
    checkInterrupted();
    stdout(`SpanTrail demo: ${viewerState.origin}`);
    stdout(`Startup: ${((now() - start) / 1000).toFixed(2)} seconds`);
    stdout('Press Ctrl+C to stop.');
    await new Promise(resolveWait => { wakeHold = resolveWait; if (interrupted) resolveWait(); });
    checkInterrupted();
  } catch (error) { latchFailure(error); }
  const cleanupErrors = [];
  try { await stopBuild(); } catch (error) { cleanupErrors.push(error); }
  if (viewerState) try { await viewerState.close(); } catch (error) { cleanupErrors.push(error); }
  process.removeListener('SIGINT', onInt);
  process.removeListener('SIGTERM', onTerm);
  process.removeListener('SIGHUP', onHup);
  if (primaryFailure || cleanupErrors.length || interrupted) {
    const primary = primaryFailure ? failure : interrupted ?? failure;
    if (cleanupErrors.length) throw new AggregateError([...(primaryFailure || interrupted ? [primary] : []), ...cleanupErrors], 'Demo failed during execution or cleanup', { cause: primary });
    throw primary;
  }
  checkInterrupted();
  return stage;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const intent = { code: undefined };
  runDemo({ intent }).catch(error => { console.error(error); process.exitCode = intent.code ?? 1; });
}
