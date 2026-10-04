import { fork } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArtifact } from '../viewer/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(__dirname, 'preload.cjs');
const PROTOCOL = 'spantrail-capture-v1';
const MAX_MESSAGE = 1024 * 1024;
const START_TIMEOUT = 10000;
const REQUEST_TIMEOUT = 10000;

async function startCapture({ entry, cwd, env = {}, execArgv = [] }) {
  if (typeof entry !== 'string' || !path.isAbsolute(entry) || !entry.endsWith('.cjs')) throw new TypeError('entry must be an absolute .cjs file');
  const stat = await fs.stat(entry).catch(() => null);
  if (!stat?.isFile()) throw new Error('entry must be an existing file');
  const child = fork(entry, [], { cwd, env: { ...process.env, ...env }, execArgv: [...execArgv, '--require', PRELOAD], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let exited = null, disconnected = false, errored = false;
  let startupSettled = false, startupResolve, startupReject;
  const pending = new Map();
  let stopping = false, stopPromise;
  const startup = new Promise((resolve, reject) => { startupResolve = resolve; startupReject = reject; });
  function failAll(reason) {
    if (!startupSettled) { startupSettled = true; startupReject(reason); }
    for (const [id, item] of pending) { clearTimeout(item.timer); item.reject(reason); pending.delete(id); }
  }
  child.on('message', message => {
    if (!message || message.protocol !== PROTOCOL) return;
    if (message.type === 'ready' && !startupSettled) { startupSettled = true; startupResolve(); return; }
    if (message.type === 'startup-error' && !startupSettled) { startupSettled = true; startupReject(new Error('capture startup failed')); return; }
    if (typeof message.id !== 'string') return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.ok !== true) item.reject(new Error('capture request failed'));
    else item.resolve(message);
  });
  child.on('error', () => { errored = true; failAll(new Error('capture child error')); });
  child.on('disconnect', () => { disconnected = true; failAll(new Error('capture child disconnected')); });
  child.on('exit', (code, signal) => { exited = { code, signal }; failAll(new Error('capture child exited')); });
  let startTimer = setTimeout(() => { if (!startupSettled) { startupSettled = true; startupReject(new Error('capture startup timed out')); } }, START_TIMEOUT);
  try { await startup; }
  catch (error) {
    const timer = setTimeout(() => { if (!exited) child.kill('SIGTERM'); }, 1000);
    const killTimer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 6000);
    try { await waitExit(9000); } catch { /* Bounded cleanup; startup error remains authoritative. */ }
    clearTimeout(timer); clearTimeout(killTimer);
    throw error;
  } finally { clearTimeout(startTimer); }

  function request(type, timeout = REQUEST_TIMEOUT) {
    if (exited || errored || disconnected) return Promise.reject(new Error('capture child unavailable'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('capture request timed out')); }, timeout);
      pending.set(id, { resolve, reject, timer });
      try { child.send({ protocol: PROTOCOL, id, type }, error => { if (error) { const item = pending.get(id); if (item) { pending.delete(id); clearTimeout(timer); reject(new Error('capture IPC failed')); } } }); }
      catch { const item = pending.get(id); if (item) { pending.delete(id); clearTimeout(timer); reject(new Error('capture IPC failed')); } }
    });
  }
  async function waitExit(timeout) {
    if (exited) return exited;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('capture child did not exit')); }, timeout);
      const onExit = () => { cleanup(); resolve(exited); };
      const cleanup = () => { clearTimeout(timer); child.off('exit', onExit); };
      child.once('exit', onExit);
      if (exited) onExit();
    });
  }
  return {
    child,
    async snapshot() {
      if (stopping || exited) throw new Error('capture snapshot unavailable');
      const response = await request('snapshot');
      try {
        if (!Array.isArray(response.spans) || response.spans.length > 1000 || Buffer.byteLength(JSON.stringify({ actions: [], spans: response.spans })) > MAX_MESSAGE) throw new Error();
        const allowedNames = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'CLIENT', 'SERVER', 'INTERNAL']);
        for (const span of response.spans) {
          if (!span || typeof span !== 'object' || Array.isArray(span) || !allowedNames.has(span.name) || span.path !== null || !span.source || typeof span.source !== 'object' || Array.isArray(span.source) || span.source.status !== 'unknown' || Object.keys(span.source).length !== 1) throw new Error();
        }
        return parseArtifact({ actions: [], spans: response.spans }).spans;
      } catch { throw new Error('invalid capture snapshot'); }
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopping = true;
      stopPromise = (async () => {
        if (exited) return exited;
        let forceTimer, killTimer, finalTimer;
        const escalation = new Promise((_, reject) => {
          forceTimer = setTimeout(() => { if (!exited) child.kill('SIGTERM'); }, 1000);
          killTimer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 6000);
          finalTimer = setTimeout(() => reject(new Error('capture child exit was not observed')), 9000);
        });
        try {
          const cooperative = request('shutdown', 9000).catch(() => null);
          await Promise.race([waitExit(9000), escalation]);
          await cooperative;
          if (!exited) throw new Error('capture child exit was not observed');
          return exited;
        } finally { clearTimeout(forceTimer); clearTimeout(killTimer); clearTimeout(finalTimer); }
      })();
      return stopPromise;
    },
  };
}

export { startCapture };
