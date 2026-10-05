'use strict';

const express = require('express');
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { Pool } = require('pg');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const http = require('node:http');

const app = express();
const tracer = trace.getTracer('spantrail-postgres-fixture');
const pool = new Pool({ connectionString: process.env.SPANTRAIL_POSTGRES_URL, max: 2, connectionTimeoutMillis: 2000, statement_timeout: 3000 });
let server;
let activeRequests = 0;
let shuttingDown = false;
const requestSockets = new Set();
const tracker = (request, response, next) => {
  activeRequests++;
  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    activeRequests--;
    if (shuttingDown && activeRequests === 0) void closeApplication();
  };
  response.once('finish', complete);
  response.once('close', complete);
  next();
};

function closeApplication() {
  return new Promise(resolveClose => {
    server?.close(() => resolveClose());
    for (const socket of requestSockets) socket.destroy();
  });
}

app.use(tracker);
app.use(express.json());
app.get('/', async (_request, response) => response.type('html').send(await readFile(resolve(__dirname, 'page.html'))));
app.post('/api/action', async (request, response) => {
  const mode = request.body?.mode;
  if (!['success', 'failure', 'recovery'].includes(mode)) return response.status(400).json({ message: 'Invalid action' });
  try {
    const value = await tracer.startActiveSpan(`app.${mode}`, async span => {
      try {
        const result = mode === 'failure'
          ? await pool.query('SELECT $1::integer', ['not-an-integer'])
          : await pool.query('SELECT $1::text AS value, pg_sleep(0.03)', ['SPANTRAIL_SECRET_SENTINEL']);
        return result.rows[0].value;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally { span.end(); }
    });
    response.json({ message: `Completed ${mode}`, value });
  } catch {
    response.status(500).json({ message: 'Controlled query failure' });
  }
});
app.get('/health', (_request, response) => response.json({ ready: true }));

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = Date.now() + 5000;
  while (activeRequests > 0 && Date.now() < deadline) await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
  try { await Promise.race([closeApplication(), new Promise(resolveClose => setTimeout(resolveClose, 1000))]); } catch {}
  try { await pool.end(); } catch {}
  if (process.connected) process.disconnect();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

(async () => {
  await pool.query('SELECT 1');
  server = http.createServer(app);
  server.on('connection', socket => { requestSockets.add(socket); socket.once('close', () => requestSockets.delete(socket)); });
  server.listen(Number(process.env.SPANTRAIL_FIXTURE_PORT), '127.0.0.1', () => {
    if (process.send) process.send({ type: 'ready', port: server.address().port });
    console.log(`SPANTRAIL_APP_READY ${server.address().port}`);
  });
})().catch(() => { process.exitCode = 1; process.disconnect?.(); });
