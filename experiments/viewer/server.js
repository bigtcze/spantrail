import { createServer } from 'node:http';
import { open, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { parseArtifact } from './model.js';

const root = dirname(fileURLToPath(import.meta.url));
const defaultArtifact = resolve(root, '../correlation/artifacts/proof.json');
const staticFiles = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/styles.css', 'styles.css'], ['/model.js', 'model.js']]);
const csp = "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
export const MAX_BYTES = 1024 * 1024;
export async function readBoundedArtifact(path, openFile = open) {
  const handle = await openFile(path, 'r');
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_BYTES) { const error = new Error('Artifact too large'); error.code = 'ETOOBIG'; throw error; }
    return buffer.subarray(0, total);
  } finally { await handle.close(); }
}
const send = (res, status, body, type = 'application/json; charset=utf-8', method = 'GET') => { res.writeHead(status, { 'content-type': type, 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }); res.end(method === 'HEAD' ? undefined : body); };

export async function startViewer({ artifactPath = defaultArtifact, port = 0, closeTimeout = 500 } = {}) {
  let inFlightArtifact;
  const server = createServer(async (req, res) => {
    const method = req.method;
    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, JSON.stringify({ error: 'Method not allowed' }), undefined, method);
    const host = req.headers.host;
    const expectedPort = server.address()?.port;
    if (typeof host !== 'string' || !new RegExp(`^(127\\.0\\.0\\.1|localhost):${expectedPort}$`, 'i').test(host)) return send(res, 403, JSON.stringify({ error: 'Forbidden' }), undefined, method);
    const origin = req.headers.origin;
    if (origin && !new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${expectedPort}$`, 'i').test(origin)) return send(res, 403, JSON.stringify({ error: 'Forbidden' }), undefined, method);
    let pathname;
    try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; } catch { return send(res, 404, JSON.stringify({ error: 'Not found' }), undefined, method); }
    if (pathname === '/artifact.json') {
      try {
        if (!inFlightArtifact) inFlightArtifact = readBoundedArtifact(artifactPath);
        let file;
        try { file = await inFlightArtifact; } finally { inFlightArtifact = undefined; }
        let artifact;
        try { artifact = parseArtifact(file.toString('utf8')); } catch { return send(res, 422, JSON.stringify({ error: 'Invalid artifact' }), undefined, method); }
        return send(res, 200, JSON.stringify(artifact), undefined, method);
      } catch (error) { return send(res, error?.code === 'ETOOBIG' ? 413 : error?.code === 'ENOENT' ? 404 : 500, JSON.stringify({ error: error?.code === 'ETOOBIG' ? 'Artifact too large' : error?.code === 'ENOENT' ? 'Artifact unavailable' : 'Artifact read failed' }), undefined, method); }
    }
    const asset = staticFiles.get(pathname);
    if (!asset) return send(res, 404, JSON.stringify({ error: 'Not found' }), undefined, method);
    try { const body = await readFile(resolve(root, asset)); send(res, 200, body, asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', method); }
    catch { send(res, 404, JSON.stringify({ error: 'Not found' }), undefined, method); }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  const address = server.address();
  let closePromise;
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = new Promise((resolveClose, reject) => {
      let timer;
      const finish = error => { clearTimeout(timer); error ? reject(error) : resolveClose(); };
      server.close(finish);
      timer = setTimeout(() => server.closeAllConnections(), closeTimeout);
      timer.unref?.();
    });
    return closePromise;
  };
  return { server, origin: `http://127.0.0.1:${address.port}`, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const viewerPort = Number(process.env.PORT || 4318);
  startViewer({ port: viewerPort }).then(viewer => {
    console.log(`SpanTrail viewer: ${viewer.origin}`);
    let closing = false;
    const stop = () => { if (closing) return; closing = true; viewer.close().then(() => process.exit(0), () => process.exit(1)); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }).catch(() => { console.error('Viewer failed to start'); process.exitCode = 1; });
}
