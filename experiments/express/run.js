import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runProof } from '../correlation/run.js';

const dir = dirname(fileURLToPath(import.meta.url));
runProof({
  preload: resolve(dir, '../runtime/local-tracing.cjs'),
  childProgram: resolve(dir, 'entry.cjs'),
  artifactPath: resolve(dir, 'artifacts/express-proof.json'),
}).catch(error => { console.error(error); process.exitCode = 1; });
