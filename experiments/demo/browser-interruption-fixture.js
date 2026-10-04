import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runDemo } from './run.js';
import { runProof } from '../correlation/run.js';

let fixturePid;
let browserPid;
let descendantPids = [];
let release;
let signalAcknowledged;
const acknowledgement = new Promise(resolve => { signalAcknowledged = resolve; });
const barrier = new Promise(resolve => { release = resolve; });
let interruptedSignal;
let recoveryClose;
let setupFailure;
let interruptedCode;
const acknowledgeSignal = signal => {
  if (!interruptedSignal) {
    interruptedSignal = signal;
    interruptedCode = signal === 'SIGINT' ? 130 : 143;
    process.send?.({ type: 'signal-acknowledged', signal }, () => signalAcknowledged());
  }
};
process.on('SIGINT', () => acknowledgeSignal('SIGINT'));
process.on('SIGTERM', () => acknowledgeSignal('SIGTERM'));
process.on('message', message => {
  if (message?.type === 'recover-browser') recoveryClose?.();
  if (message?.type === 'release') release();
  if (message?.type === 'release-runner') holdRunner();
});

const disconnectAfterStatus = (message, exitCode) => {
  process.send?.(message, () => {
    process.disconnect();
    process.exitCode = exitCode;
  });
};
process.on('disconnect', () => release());

let holdRunner;
const runnerBarrier = new Promise(resolve => { holdRunner = resolve; });

const run = runDemo({
  proof: options => runProof({
    onFailure: options?.onFailure,
    childProgram: fileURLToPath(new URL('../correlation/server-entry.js', import.meta.url)),
    spawn: (...args) => {
      const child = spawn(...args);
      fixturePid = child.pid;
      child.once('message', message => {
        if (message?.type === 'ready') process.send?.({ type: 'fixture-ready', pid: fixturePid, port: message.port });
      });
      return child;
    },
    launchBrowser: async options => {
      const browser = await chromium.launch(options);
      const originalNewPage = browser.newPage.bind(browser);
      browser.newPage = async (...args) => {
      const page = await originalNewPage(...args);
      await page.goto('about:blank');
      const session = await browser.newBrowserCDPSession();
      const { processInfo } = await session.send('SystemInfo.getProcessInfo');
      browserPid = processInfo.find(item => item.type === 'browser')?.id;
      descendantPids = processInfo.filter(item => item.type === 'renderer').map(item => item.id);
      await session.detach();
      process.send?.({ type: 'browser-ready', pid: browserPid, descendantPids });
      if (process.env.SPANTRAIL_FAIL_AFTER_BROWSER_ACQUISITION === '1') {
        setupFailure = { message: 'injected failure after browser/CDP acquisition', browserPid, descendantPids: [...descendantPids] };
        throw new Error(setupFailure.message);
      }
      await barrier;
      return page;
      };
      return browser;
    },
    output: false,
    browserTimeout: 30000,
  }),
  viewer: async () => { process.send?.({ type: 'viewer-started' }); },
});

run.then(() => {
  disconnectAfterStatus({ type: 'completed' }, 0);
}, async error => {
  if (setupFailure) process.send?.({ type: 'setup-failed', ...setupFailure, errorMessage: error?.message });
  if (setupFailure) await runnerBarrier;
  const exitCode = interruptedCode ?? (error?.code === 130 || error?.code === 143 ? error.code : 1);
  if (exitCode === 130 || exitCode === 143) {
    await acknowledgement;
    process.send?.({ type: 'caught', code: exitCode, message: error?.message, fixturePid, browserPid, descendantPids });
    await runnerBarrier;
  }
  disconnectAfterStatus({ type: 'caught', code: exitCode, message: error?.message, fixturePid, browserPid, descendantPids }, exitCode);
});
