const http = require('node:http');
const app = require('./app.cjs');
const runtime = require('../runtime/local-tracing.cjs');
(async () => {
  await runtime.ready;
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.send?.({ type: 'ready', port: server.address().port });
  let stopping;
  function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      const bounded = promise => Promise.race([promise, new Promise(resolve => setTimeout(resolve, 1500))]);
      await bounded(new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); }));
      await bounded(runtime.shutdown());
      process.exit(0);
    })().catch(error => { console.error(error); process.exitCode = 1; });
    return stopping;
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
})().catch(error => { console.error(error); process.exit(1); });
