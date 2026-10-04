import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptureArgs } from './run.js';

const args = ['--entry', 'app.cjs', '--url', 'http://127.0.0.1:3000/', '--endpoint', 'http://127.0.0.1:3000/checkout', '--click', '#checkout', '--complete', '#status', '--text', 'done', '--output', 'result.json'];

test('parses bounded defaults and optional flags', () => {
  const parsed = parseCaptureArgs(args);
  assert.equal(parsed.timeout, 10000);
  assert.equal(parsed.viewer, true);
  assert.equal(parsed.headed, false);
  assert.equal(parseCaptureArgs([...args, '--timeout', '100', '--headed', '--no-viewer']).timeout, 100);
});

test('help is accepted without required options', () => assert.deepEqual(parseCaptureArgs(['--help']), { help: true }));

function replaceOption(option, value) {
  const copy = [...args];
  copy[copy.indexOf(option) + 1] = value;
  return copy;
}

test('rejects malformed flags, URLs and timeout boundaries', () => {
  for (const bad of [
    [...args, '--wat'], [...args, '--click', '#again'], [...args, '--timeout', '99'],
    [...args, '--timeout', '60001'], [...args, '--timeout', '1e3'], [...args, '--timeout', '0x3e8'], [...args.slice(0, 2), 'bad', ...args.slice(2)],
    replaceOption('--url', 'http://127.0.0.1:3000/../x'),
    replaceOption('--endpoint', 'http://127.0.0.1:3000/checkout?x=1'),
    replaceOption('--url', 'http://example.com/'),
    replaceOption('--url', 'http://user@127.0.0.1:3000/'),
    replaceOption('--url', 'https://127.0.0.1:3000/'),
    replaceOption('--url', 'http://127.0.0.1:3000/#'),
    replaceOption('--url', 'http://127.0.0.1:3000/?'),
    replaceOption('--endpoint', 'http://127.0.0.1:3001/checkout'),
    replaceOption('--url', 'http://127.0.0.1/'),
  ]) assert.throws(() => parseCaptureArgs(bad), `expected rejection: ${bad.join(' ')}`);
  const canonical = replaceOption('--url', 'http://127.0.0.1:3000/checkout');
  assert.equal(parseCaptureArgs(canonical).url, 'http://127.0.0.1:3000/checkout');
});
