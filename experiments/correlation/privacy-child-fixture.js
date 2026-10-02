const [{ NodeSDK }, { logs }] = await Promise.all([
  import('@opentelemetry/sdk-node'),
  import('@opentelemetry/api-logs'),
]);

const sdk = new NodeSDK({
  autoDetectResources: false,
});
process.send?.({ type: 'stage', stage: 'before-start' });
await sdk.start();
process.send?.({ type: 'stage', stage: 'started' });
const meter = (await import('@opentelemetry/api')).metrics.getMeter('privacy-negative-control');
meter.createCounter('privacy.fixture').add(1);
logs.getLogger('privacy-negative-control').emit({ body: 'negative control' });
await new Promise(resolve => setTimeout(resolve, 150));
await sdk.shutdown();
process.send?.({ type: 'stage', stage: 'shutdown' });
process.send?.({ type: 'done' });
process.exit(0);
