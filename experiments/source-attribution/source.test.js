import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const experiments = join(root, 'experiments');
const sourceFile = join(experiments, 'source-attribution/service.cts');
const sourceText = await readFile(sourceFile, 'utf8');
const markers = {
  'action.service': '// SOURCE:service',
  'action.after-await': '// SOURCE:after-await',
  'action.unexecuted': '// SOURCE:unexecuted',
};

function expectedLocations(text = sourceText) {
  const lines = text.split(/\r?\n/);
  return Object.fromEntries(Object.entries(markers).map(([name, marker]) => {
    const line = lines.findIndex(value => value.includes(marker));
    assert.notEqual(line, -1, `fixture has ${marker}`);
    const column = lines[line].indexOf('withSourceSpan(');
    assert.notEqual(column, -1, `${marker} is on the explicit source call`);
    return [name, { status: 'mapped', file: 'experiments/source-attribution/service.cts', line: line + 1, column: column + 1 }];
  }));
}

function start(script, cwd) {
  return spawn(process.execPath, [script], { cwd, env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: '', OTEL_TRACES_EXPORTER: 'none', OTEL_METRICS_EXPORTER: 'none', OTEL_LOGS_EXPORTER: 'none' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
}

async function withServer(experimentDirectory, callback) {
  const child = start(join(experimentDirectory, 'correlation/server-entry.js'), dirname(experimentDirectory));
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
  let port;
  try {
    port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error(`server readiness timed out: ${stderr}`)), 5000);
      child.on('message', message => {
        if (message?.type !== 'ready') return;
        clearTimeout(timer);
        resolvePort(message.port);
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`server exited before readiness (${code ?? signal}): ${stderr}`)); });
    });
    await callback(port);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      let timer;
      try {
        await Promise.race([once(child, 'exit'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`server shutdown timed out: ${stderr}`)), 3000); })]);
      } catch (error) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await Promise.race([once(child, 'exit').catch(() => {}), new Promise(resolveExit => setTimeout(resolveExit, 1000))]);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

function get(port, path, headers) {
  return fetch(`http://127.0.0.1:${port}${path}`, { headers, signal: AbortSignal.timeout(3000) });
}

async function diagnostics(port) {
  const response = await get(port, '/__spans');
  assert.equal(response.status, 200);
  return response.json();
}

async function spansForTrace(port, traceId, predicate) {
  const deadline = Date.now() + 3000;
  let all;
  do {
    all = (await diagnostics(port)).filter(span => span.traceId === traceId);
    if (predicate(all)) return all;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  } while (Date.now() < deadline);
  return all;
}

const completedAction = (path, names) => spans =>
  spans.some(span => span.kind === 1 && span.path === path) &&
  names.every(name => spans.some(span => span.name === name));

test('compiled TypeScript source maps attribute executed calls and preserve async context after failure', async () => {
  const expected = expectedLocations();
  await withServer(experiments, async port => {
    const failureTraceId = '11111111111111111111111111111111';
    const failureParentId = '2222222222222222';
    const failed = await get(port, '/api/failure', { traceparent: `00-${failureTraceId}-${failureParentId}-01` });
    assert.equal(failed.status, 500);
    const failureBody = await failed.text();
    assert.equal(/stack|service\.cts|Error:|SOURCE:/i.test(failureBody), false, 'failure response is generic and does not leak diagnostics');
    const failureSpans = await spansForTrace(port, failureTraceId, completedAction('/api/failure', ['action.service', 'action.after-await']));
    const failureServer = failureSpans.find(span => span.kind === 1 && span.path === '/api/failure');
    assert.ok(failureServer, 'failure HTTP SERVER span emitted');
    assert.equal(failureServer.parentSpanId, failureParentId, 'failure HTTP span preserves supplied parent');
    assert.equal(failureServer.traceId, failureTraceId);
    for (const name of ['action.service', 'action.after-await']) {
      const span = failureSpans.find(item => item.name === name && item.traceId === failureTraceId);
      assert.ok(span, `failure emitted ${name}`);
      assert.deepEqual(span.source, expected[name]);
      assert.equal(span.statusCode, 2, 'failed spans carry OpenTelemetry ERROR status');
    }
    const failedOuter = failureSpans.find(span => span.name === 'action.service' && span.traceId === failureTraceId);
    const failedNested = failureSpans.find(span => span.name === 'action.after-await' && span.traceId === failureTraceId);
    assert.equal(failedOuter.parentSpanId, failureServer.spanId, 'failure outer span is a child of its HTTP SERVER span');
    assert.equal(failedNested.traceId, failedOuter.traceId);
    assert.equal(failedNested.parentSpanId, failedOuter.spanId);
    assert.equal(failureSpans.some(span => span.name === 'action.unexecuted'), false);
    const successTraceId = '33333333333333333333333333333333';
    const successParentId = '4444444444444444';
    const action = await get(port, '/api/action', { traceparent: `00-${successTraceId}-${successParentId}-01` });
    assert.equal(action.status, 200);
    const actionBody = await action.json();
    const responseTraceId = actionBody.traceId;
    assert.equal(responseTraceId, successTraceId, 'response JSON carries the actual success trace ID');
    const spans = await spansForTrace(port, responseTraceId, completedAction('/api/action', ['action.service', 'action.after-await']));
    assert.ok(responseTraceId && responseTraceId !== failureTraceId, 'success request has a distinct trace');
    const outer = spans.find(span => span.name === 'action.service' && span.traceId === responseTraceId);
    const nested = spans.find(span => span.name === 'action.after-await' && span.traceId === responseTraceId);
    assert.ok(outer && nested, 'compiled service emitted both spans');
    const successServer = spans.find(span => span.kind === 1 && span.path === '/api/action');
    assert.ok(successServer, 'success HTTP SERVER span emitted');
    assert.equal(successServer.parentSpanId, successParentId, 'success HTTP span preserves supplied parent');
    assert.equal(successServer.traceId, responseTraceId);
    assert.equal(outer.parentSpanId, successServer.spanId, 'success outer span is a child of its HTTP SERVER span');
    assert.deepEqual(outer.source, expected['action.service']);
    assert.deepEqual(nested.source, expected['action.after-await']);
    assert.equal(outer.statusCode, 0, 'later success has UNSET status after failure');
    assert.equal(nested.statusCode, 0, 'later nested success has UNSET status after failure');
    assert.equal(nested.traceId, outer.traceId);
    assert.equal(nested.parentSpanId, outer.spanId);
    assert.ok(outer.durationMs > 0 && nested.durationMs > 0);
    assert.ok(Number.isInteger(outer.statusCode) && Number.isInteger(nested.statusCode));
    assert.equal(spans.some(span => span.name === 'action.unexecuted'), false, 'unexecuted alternative is not falsely attributed/emitted');
  });
});

for (const [label, mutate] of [
  ['missing', async (directory) => rm(join(directory, 'source-attribution/dist/service.cjs.map'))],
  ['malformed', async directory => writeFile(join(directory, 'source-attribution/dist/service.cjs.map'), '{not-json')],
  ['unsupported webpack scheme', async directory => mutateSource(directory, ['webpack:../../../service.cts'])],
  ['unsupported node scheme', async directory => mutateSource(directory, ['node:../../../service.cts'])],
  ['unsupported data scheme', async directory => mutateSource(directory, ['data:../../../service.cts'])],
  ['version 2 map', async directory => mutateMap(directory, map => { map.version = 2; })],
  ['invalid VLQ character', async directory => mutateMap(directory, map => { map.mappings = map.mappings.replace(/[A-Za-z0-9+/]/, '!'); })],
  ['unmapped', async directory => writeFile(join(directory, 'source-attribution/dist/service.cjs.map'), JSON.stringify({ version: 3, file: 'service.cjs', sources: ['../service.cts'], names: [], mappings: '' }))],
  ['generated line one only', async directory => writeFile(join(directory, 'source-attribution/dist/service.cjs.map'), JSON.stringify({ version: 3, file: 'service.cjs', sources: ['../service.cts'], names: [], mappings: 'AAAA;' }))],
  ['source-less segment after a source-bearing segment on the caller line', async directory => writeFile(join(directory, 'source-attribution/dist/service.cjs.map'), JSON.stringify({ version: 3, file: 'service.cjs', sources: ['../service.cts'], names: [], mappings: ';;;;;;;AAAA,W;' }))],
  ['remote file URL', async directory => {
    const mapPath = join(directory, 'source-attribution/dist/service.cjs.map');
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    map.sources = ['file://remote-host/service.cts'];
    await writeFile(mapPath, JSON.stringify(map));
  }],
  ['malformed file URL escape', async directory => {
    const mapPath = join(directory, 'source-attribution/dist/service.cjs.map');
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    map.sources = ['file:///bad%ZZ/service.cts'];
    await writeFile(mapPath, JSON.stringify(map));
  }],
  ['outside-root', async directory => {
    const mapPath = join(directory, 'source-attribution/dist/service.cjs.map');
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    map.sources = ['../../../../outside/service.cts'];
    await writeFile(mapPath, JSON.stringify(map));
  }],
]) {
  test(`compiled source attribution is unknown with ${label} maps in a disposable subprocess copy`, async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'spantrail-source-map-'));
    try {
      const copiedExperiments = join(temporary, 'experiments');
      await writeFile(join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
      await cp(join(experiments, 'correlation'), join(copiedExperiments, 'correlation'), { recursive: true });
      await cp(join(experiments, 'source-attribution'), join(copiedExperiments, 'source-attribution'), { recursive: true });
      await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
      await mutate(copiedExperiments);
      await withServer(copiedExperiments, async port => {
        const expectedTraceId = '66666666666666666666666666666666';
        const parentId = '5555555555555555';
        const response = await get(port, '/api/action', { traceparent: `00-${expectedTraceId}-${parentId}-01` });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.traceId, expectedTraceId, 'response includes supplied trace ID');
        const spans = await spansForTrace(port, body.traceId, completedAction('/api/action', ['action.service', 'action.after-await']));
        const server = spans.find(item => item.kind === 1 && item.path === '/api/action');
        const outer = spans.find(item => item.name === 'action.service');
        const nested = spans.find(item => item.name === 'action.after-await');
        assert.ok(server && outer && nested);
        assert.equal(server.parentSpanId, parentId);
        assert.equal(outer.parentSpanId, server.spanId);
        assert.equal(nested.parentSpanId, outer.spanId);
        for (const span of [server, outer, nested]) {
          assert.equal(span.traceId, expectedTraceId);
          assert.ok(span.durationMs > 0);
          assert.ok([0, 1, 2].includes(span.statusCode));
        }
        assert.equal(server.statusCode, 0);
        assert.equal(outer.statusCode, 0);
        assert.equal(nested.statusCode, 0);
        for (const name of ['action.service', 'action.after-await']) {
          const span = spans.find(item => item.name === name);
          assert.ok(span, `compiled fixture emitted ${name}`);
          assert.deepEqual(span.source, { status: 'unknown' });
        }
        assert.equal(spans.some(span => span.name === 'action.unexecuted'), false);
      });
    } finally {
      await rm(temporary, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
    }
  });
}

async function mutateMap(directory, mutation) {
  const mapPath = join(directory, 'source-attribution/dist/service.cjs.map');
  const map = JSON.parse(await readFile(mapPath, 'utf8'));
  mutation(map);
  await writeFile(mapPath, JSON.stringify(map));
}

async function mutateSource(directory, sources) {
  await mutateMap(directory, map => { map.sources = sources; });
}

test('external generated callers cannot attribute source through the approved helper', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'spantrail-external-caller-'));
  try {
    const generated = join(temporary, 'outside-app', 'dist');
    await mkdir(generated, { recursive: true });
    await writeFile(join(temporary, 'outside-app', 'service.cts'), 'export {}\n');
    const helper = join(experiments, 'source-attribution/source.cjs');
    const map = { version: 3, file: 'service.cjs', sources: ['../service.cts'], names: [], mappings: ';AAAA' };
    const script = `const { withSourceSpan } = require(${JSON.stringify(helper)});\nconsole.log(JSON.stringify(withSourceSpan('external', evidence => evidence ?? { status: 'unknown' })));\n//# sourceMappingURL=service.cjs.map\n`;
    const generatedFile = join(generated, 'service.cjs');
    await writeFile(generatedFile, script);
    await writeFile(`${generatedFile}.map`, JSON.stringify(map));
    const child = spawn(process.execPath, [generatedFile], { cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), { status: 'unknown' });
    assert.equal(stdout.includes('experiments/source-attribution'), false, 'external evidence does not expose a fixed project source path');
  } finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
  }
});
