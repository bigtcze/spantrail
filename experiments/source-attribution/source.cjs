'use strict';

const { getCallSites } = require('node:util');
const { setSourceMapsSupport, findSourceMap } = require('node:module');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { TraceMap, traceSegment } = require('@jridgewell/trace-mapping');

setSourceMapsSupport(true);

function sourceEvidence() {
  try {
    if (typeof getCallSites !== 'function') return undefined;

    const caller = getCallSites(3, { sourceMap: false })[2];
    if (!caller || typeof caller.scriptName !== 'string') return undefined;
    if (!Number.isInteger(caller.lineNumber) || caller.lineNumber < 1 ||
        !Number.isInteger(caller.columnNumber) || caller.columnNumber < 1) return undefined;

    const fixtureDirectory = path.basename(__dirname) === 'dist'
      ? path.resolve(__dirname, '..')
      : path.resolve(__dirname);
    const generatedService = path.resolve(fixtureDirectory, 'dist', 'service.cjs');
    if (path.resolve(caller.scriptName) !== generatedService) return undefined;

    const sourceMap = findSourceMap(generatedService);
    if (!sourceMap) return undefined;
    const payload = sourceMap.payload;
    if (!payload || payload.version !== 3 || typeof payload.mappings !== 'string' ||
        !Array.isArray(payload.sources) || !Array.isArray(payload.names) ||
        !validMappings(payload.mappings)) return undefined;
    const segment = traceSegment(new TraceMap(payload), caller.lineNumber - 1, caller.columnNumber - 1);
    if (!segment || segment.length < 4) return undefined;

    const origin = sourceMap.findOrigin(caller.lineNumber, caller.columnNumber);
    if (!origin || typeof origin.fileName !== 'string') return undefined;
    let sourcePath;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(origin.fileName)) {
      if (!origin.fileName.startsWith('file:')) return undefined;
      sourcePath = path.resolve(fileURLToPath(origin.fileName));
    } else {
      sourcePath = path.resolve(path.dirname(generatedService), origin.fileName);
    }
    const expectedSource = path.resolve(fixtureDirectory, 'service.cts');
    if (sourcePath !== expectedSource) return undefined;

    const { lineNumber: line, columnNumber: column } = origin;
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) return undefined;

    return {
      'spantrail.source.file': 'experiments/source-attribution/service.cts',
      'spantrail.source.line': line,
      'spantrail.source.column': column,
    };
  } catch {
    return undefined;
  }
}

// Validate the source-map v3 Base64 VLQ grammar before the permissive decoder.
function validMappings(mappings) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (mappings === '') return true;
  for (const line of mappings.split(';')) {
    if (line === '') continue;
    for (const segment of line.split(',')) {
      if (segment === '') return false;
      let values = 0;
      let continued = false;
      for (const character of segment) {
        const digit = alphabet.indexOf(character);
        if (digit < 0) return false;
        continued = (digit & 32) !== 0;
        if (!continued) values++;
      }
      if (continued || (values !== 1 && values !== 4 && values !== 5)) return false;
    }
  }
  return true;
}

function withSourceSpan(name, callback) {
  let evidence;
  try {
    evidence = sourceEvidence();
  } catch {
    evidence = undefined;
  }
  return callback(evidence, name);
}

function sourceFromSpan(span) {
  const attributes = span?.attributes ?? {};
  const file = attributes['spantrail.source.file'];
  const line = attributes['spantrail.source.line'];
  const column = attributes['spantrail.source.column'];
  if (file === 'experiments/source-attribution/service.cts' && Number.isInteger(line) && line > 0 && Number.isInteger(column) && column > 0) {
    return { status: 'mapped', file, line, column };
  }
  return { status: 'unknown' };
}

module.exports = { withSourceSpan, sourceFromSpan };
