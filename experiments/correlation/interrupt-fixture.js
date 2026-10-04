import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
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
  launchBrowser: async options => {
    const browser = await chromium.launch(options);
    stage('launch');
    const close = browser.close.bind(browser);
    let closing;
    browser.close = () => closing ??= (async () => { stage('close'); await new Promise(resolve => setTimeout(resolve, 100)); await close(); process.send?.({ type: 'browser-closed' }); })();
    return browser;
  },
  browserTimeout: 15000,
  skipProofOperations: true,
  output: false,
});

run.then(() => process.exitCode = 0, error => {
  process.send?.({ type: 'result', error: error?.message });
  process.exitCode = error?.code === 130 || error?.code === 143 ? error.code : 1;
});
