import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve('.');
const harnessPath = resolve(root, 'experiments/postgres/run.js');
const mode = process.env.SPANTRAIL_POSTGRES_PROBE;
const allowed = new Set(['normal', 'delayed-startup', 'abort-http-after-snapshot', 'reject-shutdown', 'shutdown-http', 'signal-active-request', 'fail-cleanup-after-remove']);
if (!allowed.has(mode)) throw new Error('unknown PostgreSQL harness probe');
const require = createRequire(import.meta.url);
const { readFileSync } = require('node:fs');

function exactReplace(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`PostgreSQL probe source anchor missing: ${label}`);
  return source.replace(from, to);
}

registerHooks({
  load(url, context, nextLoad) {
    if (url === pathToFileURL(harnessPath).href) {
      const loaded = nextLoad(url, context);
      let source = loaded.source.toString();
      source = exactReplace(source, 'appStdout += String(chunk);', 'process.stdout.write(chunk); appStdout += String(chunk);', 'app stdout forwarding');
      if (mode === 'delayed-startup') source = exactReplace(source, "const appEntry = resolve('experiments/postgres/app.cjs');", "const appEntry = resolve('experiments/postgres/probe-delayed-app.cjs');", 'delayed app entry');
      if (['abort-http-after-snapshot', 'reject-shutdown', 'shutdown-http', 'signal-active-request'].includes(mode)) {
        const captureStart = source.indexOf('capture = await startCapture(');
        if (captureStart < 0) throw new Error('PostgreSQL probe source anchor missing: capture start');
        const captureSource = source.slice(captureStart);
        const patchedCapture = exactReplace(captureSource, "env: { ...appEnv, SPANTRAIL_POSTGRES_URL: databaseUrl, SPANTRAIL_FIXTURE_PORT: String(appPort), PRIVACY_TRIPWIRE_PORT: String(tripwireInfo.port) },\n    execArgv: ['--require', observer],", "env: { ...appEnv, SPANTRAIL_POSTGRES_URL: databaseUrl, SPANTRAIL_FIXTURE_PORT: String(appPort), PRIVACY_TRIPWIRE_PORT: String(tripwireInfo.port) },\n    execArgv: ['--require', observer, '--require', resolve('experiments/postgres/probe-child.cjs')],", 'capture child preload');
        const postCaptureSource = patchedCapture.replace("    execArgv: ['--require', observer, '--require', resolve('experiments/postgres/probe-child.cjs')],", "    execArgv: ['--require', observer, '--require', resolve('experiments/postgres/probe-child.cjs')],");
        if (!postCaptureSource.includes('execArgv:')) throw new Error('PostgreSQL probe source anchor missing: capture preload validation');
        source = source.slice(0, captureStart) + patchedCapture;
      }

      if (mode === 'signal-active-request') {
        source = exactReplace(source, "let containerName = `spantrail-postgres-${crypto.randomUUID()}`;", "let containerName = `spantrail-postgres-${crypto.randomUUID()}`;\nprocess.stdout.write(`SPANTRAIL_PROBE container=${containerName}\\n`);", 'container name marker');
      }

      if (mode === 'fail-cleanup-after-remove') {
        source = exactReplace(source, 'if (ownsDatabase) await docker([\'rm\', \'--force\', containerName]);', "if (ownsDatabase) { await docker(['rm', '--force', containerName]); throw new Error('probe cleanup failure after removal'); }", 'database removal boundary');
      }
      return { ...loaded, source };
    }
    return nextLoad(url, context);
  },
});
