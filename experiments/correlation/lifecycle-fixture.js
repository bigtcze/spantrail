import { setTimeout as sleep } from 'node:timers/promises';

const mode = process.argv[2];
if (mode === 'never-ready') await sleep(30000);
else {
  if (mode !== 'exit-before-ready') process.send?.({ type: 'ready', port: 34567 });
  if (mode === 'exit-before-ready') process.exit(17);
  if (mode === 'ignore-term') process.on('SIGTERM', () => {});
  await sleep(30000);
}
