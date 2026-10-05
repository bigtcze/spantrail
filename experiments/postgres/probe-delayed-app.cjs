'use strict';

const Module = require('node:module');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const entry = resolve(__dirname, 'app.cjs');
const original = Module._extensions['.cjs'];
Module._extensions['.cjs'] = function(module, filename) {
  if (resolve(filename) !== entry) return original(module, filename);
  const source = readFileSync(filename, 'utf8');
  const anchor = "  await pool.query('SELECT 1');";
  if (!source.includes(anchor)) throw new Error('PostgreSQL probe source anchor missing: app readiness');
  module._compile(source.replace(anchor, "  await new Promise(resolveDelay => setTimeout(resolveDelay, 1800));\n  process.stdout.write('SPANTRAIL_PROBE delayed-startup-ready\\n');\n" + anchor), filename);
};
require(entry);
