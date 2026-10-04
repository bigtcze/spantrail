const express = require('express');
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { snapshot } = require('../runtime/local-tracing.cjs');
const { runService } = require('../source-attribution/dist/service.cjs');
const { readFile } = require('node:fs/promises');
const { resolve, sep } = require('node:path');
const correlationDir = resolve(__dirname, '../correlation');
const fixtureFiles = new Map([['/', 'fixture.html'], ['/browser.js', 'browser.js'], ['/context.js', 'context.js']]);
const app = express();
const tracer = trace.getTracer('spantrail-express-fixture');

for (const [route, filename] of fixtureFiles) {
  app.get(route, async (_request, response, next) => {
    try {
      const path = resolve(correlationDir, filename);
      if (!path.startsWith(`${correlationDir}${sep}`)) return response.status(404).end();
      const body = await readFile(path);
      response.type(filename.endsWith('.html') ? 'html' : 'text/javascript').send(body);
    } catch (error) { next(error); }
  });
}
app.get('/api/action', async (_request, response, next) => {
  try { const traceId = await runService(); response.json({ traceId }); }
  catch (error) { next(error); }
});
app.get('/api/failure', async (_request, response, next) => {
  try { const traceId = await runService(true); response.json({ traceId }); }
  catch (error) { next(error); }
});
app.get('/api/control', (_request, response) => response.json({}));

app.get('/success', async (_request, response) => {
  await tracer.startActiveSpan('app.service', async span => {
    await Promise.resolve();
    await tracer.startActiveSpan('app.after-await', async child => { await Promise.resolve(); child.end(); });
    span.end();
  });
  response.json({ ok: true });
});
app.get('/failure', async () => tracer.startActiveSpan('app.failure', async span => {
  try { await Promise.reject(new Error('private failure detail')); }
  catch (error) { span.setStatus({ code: SpanStatusCode.ERROR }); throw error; }
  finally { span.end(); }
}));
app.get('/__spans', (_request, response) => response.json(snapshot()));
app.use((error, _request, response, _next) => { void error; response.status(500).json({ error: 'request failed' }); });

module.exports = app;
