import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection, createServer } from 'node:net';
import { once } from 'node:events';
import { startViewer } from './server.js';

test('close is idempotent and bounded with a client stalled in incomplete HTTP headers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spantrail-shutdown-'));
  const artifactPath = join(dir, 'proof.json');
  await writeFile(artifactPath, JSON.stringify({ actions: [], spans: [] }));
  let viewer;
  let clientSocket;
  let serverSocket;
  try {
    viewer = await startViewer({ artifactPath, closeTimeout: 100 });
    const port = Number(new URL(viewer.origin).port);
    let acceptConnection;
    const accepted = new Promise(resolve => { acceptConnection = resolve; });
    viewer.server.once('connection', connection => {
      serverSocket = connection;
      acceptConnection();
    });
    clientSocket = createConnection(port, '127.0.0.1');
    await once(clientSocket, 'connect');
    await accepted;
    const headersReceived = new Promise(resolve => {
      serverSocket.once('data', chunk => resolve(chunk.toString()));
    });
    clientSocket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-Incomplete: `);
    const receivedHeaders = await headersReceived;
    assert.match(receivedHeaders, /X-Incomplete: $/, 'server must receive the intentionally incomplete header');
    const started = Date.now();
    const first = viewer.close();
    const second = viewer.close();
    assert.equal(first, second);
    let deadline;
    try {
      await Promise.race([
        first,
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Viewer close exceeded test deadline')), 1500); }),
      ]);
    } finally {
      clearTimeout(deadline);
      clientSocket.destroy();
      serverSocket?.destroy();
    }
    assert.ok(Date.now() - started < 1500, 'close should complete within the bounded timeout');
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  } finally {
    clientSocket?.destroy();
    serverSocket?.destroy();
    if (viewer) await viewer.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
