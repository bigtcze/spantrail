import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startViewer, readBoundedArtifact, MAX_BYTES } from './server.js';

const valid = JSON.stringify({ actions: [], spans: [], secret: true });
async function fixture(contents = valid) { const dir = await mkdtemp(join(tmpdir(), 'spantrail-viewer-')); const path = join(dir, 'artifact.json'); await writeFile(path, contents); return { dir, path }; }
function rawHostStatus(origin, host) { return new Promise((resolve, reject) => { const req = request(origin, { headers: { host } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); }); }

test('serves allowlisted routes and sanitized fixture; ignores query path and enforces request authority', async () => {
  const file = await fixture(); const viewer = await startViewer({ artifactPath: file.path });
  try {
    const get = (path, options = {}) => fetch(`${viewer.origin}${path}`, options);
    for (const path of ['/', '/index.html', '/app.js', '/styles.css', '/model.js']) assert.equal((await get(path)).status, 200);
    const model = await get('/model.js'); assert.match(model.headers.get('content-security-policy'), /connect-src 'self'/);
    const response = await get('/artifact.json?path=/etc/passwd'); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { actions: [], spans: [] });
    assert.equal((await get('/artifact.json', { method: 'HEAD' })).status, 200);
    assert.equal((await get('/artifact.json', { method: 'POST' })).status, 405);
    assert.equal(await rawHostStatus(viewer.origin, '127.0.0.1:1'), 403);
    assert.equal(await rawHostStatus(viewer.origin, 'evil.example'), 403);
    assert.equal((await get('/', { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await get('/', { headers: { origin: `${viewer.origin.replace(/:\d+$/, ':1')}` } })).status, 403);
    assert.equal((await get('/', { headers: { origin: 'http://evil.example' } })).status, 403);
    assert.equal((await get('/not-allowlisted')).status, 404);
  } finally { await viewer.close(); await rm(file.dir, { recursive: true, force: true }); }
});

test('generic missing and malformed artifact errors', async () => {
  const missing = await startViewer({ artifactPath: '/no/such/private/path.json' });
  try { const response = await fetch(`${missing.origin}/artifact.json`); assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: 'Artifact unavailable' }); } finally { await missing.close(); }
  const file = await fixture('{'); const viewer = await startViewer({ artifactPath: file.path });
  try { const response = await fetch(`${viewer.origin}/artifact.json`); assert.equal(response.status, 422); assert.deepEqual(await response.json(), { error: 'Invalid artifact' }); } finally { await viewer.close(); await rm(file.dir, { recursive: true, force: true }); }
});

test('bounded artifact read requests at most limit plus one byte and rejects growing/oversized files', async () => {
  let requested = 0;
  await assert.rejects(readBoundedArtifact('fake', async () => ({ read: async (buffer, offset, length) => { requested = length; buffer.fill(1); return { bytesRead: length }; }, close: async () => {} })), { code: 'ETOOBIG' });
  assert.equal(requested, MAX_BYTES + 1);
  const file = await fixture(); await truncate(file.path, MAX_BYTES + 2); const viewer = await startViewer({ artifactPath: file.path });
  try { const response = await fetch(`${viewer.origin}/artifact.json`); assert.equal(response.status, 413); assert.deepEqual(await response.json(), { error: 'Artifact too large' }); } finally { await viewer.close(); await rm(file.dir, { recursive: true, force: true }); }
});

test('bounded reader accumulates short reads and closes handles on success and oversize failure', async () => {
  const bytes = Buffer.from('complete content'); let position = 0, calls = 0, closed = false;
  const complete = await readBoundedArtifact('fake', async () => ({
    read: async (buffer, offset, length, filePosition) => { calls++; assert.equal(filePosition, position); const size = Math.min(2, length, bytes.length - position); bytes.copy(buffer, offset, position, position + size); position += size; return { bytesRead: size }; },
    close: async () => { closed = true; }
  }));
  assert.deepEqual(complete, bytes); assert.ok(calls > 1); assert.equal(closed, true);

  let overPosition = 0, requestedTotal = 0, returnedTotal = 0, requests = 0, oversizeClosed = false;
  await assert.rejects(readBoundedArtifact('fake', async () => ({
    read: async (buffer, offset, length, filePosition) => { requests++; assert.equal(filePosition, overPosition); requestedTotal += length; const size = Math.min(2, length); buffer.fill(1, offset, offset + size); overPosition += size; returnedTotal += size; return { bytesRead: size }; },
    close: async () => { oversizeClosed = true; }
  })), { code: 'ETOOBIG' });
  assert.ok(requests > 1); assert.equal(returnedTotal, MAX_BYTES + 1); assert.ok(requestedTotal >= MAX_BYTES + 1); assert.equal(oversizeClosed, true);
});
