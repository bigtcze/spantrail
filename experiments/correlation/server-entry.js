for (const key of Object.keys(process.env)) {
  if (key.startsWith('OTEL_')) delete process.env[key];
}

const [{ NodeSDK }, { InMemorySpanExporter, SimpleSpanProcessor }, { HttpInstrumentation }] = await Promise.all([
  import('@opentelemetry/sdk-node'),
  import('@opentelemetry/sdk-trace-base'),
  import('@opentelemetry/instrumentation-http'),
]);

const exporter = new InMemorySpanExporter();
const sdk = new NodeSDK({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
  metricReaders: [],
  logRecordProcessors: [],
  autoDetectResources: false,
  instrumentations: [new HttpInstrumentation({ ignoreIncomingRequestHook: request => request.url?.startsWith('/__') ?? false })],
});
await sdk.start();
const { startServer } = await import('./server.js');
const server = await startServer(exporter);
process.send?.({ type: 'ready', port: server.address().port });

let stopping;
function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeIdleConnections?.();
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 1000))]);
    try {
      await Promise.race([sdk.shutdown(), new Promise(resolve => setTimeout(resolve, 1000))]);
    } catch {
      // Shutdown failure must not become an unhandled rejection.
    }
    process.exit(0);
  })();
  return stopping;
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
