import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProof } from './run.js';

const stage = value => process.send?.({ type: 'stage', value });
let childPid;
const run = runProof({
  childProgram: fileURLToPath(new URL('./lifecycle-fixture.js', import.meta.url)),
  spawn: (...args) => {
    const child = spawn(...args);
    childPid = child.pid;
    process.send?.({ type: 'server', pid: childPid });
    return child;
  },
  launchBrowser: async () => {
    stage('launch');
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      newPage: async () => { throw new Error('intentional fixture stop'); },
      close: async () => {
        stage('close');
        await new Promise(resolve => setTimeout(resolve, 500));
        process.send?.({ type: 'browser-closed' });
      },
    };
  },
  output: false,
});

run.then(() => process.exitCode = 0, error => {
  process.send?.({ type: 'result', error: error.message });
  process.exitCode = 1;
});
