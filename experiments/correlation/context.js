export function createTraceContext() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  const hex = values => [...values].map(value => value.toString(16).padStart(2, '0')).join('');
  const context = { traceId: hex(bytes.subarray(0, 16)), spanId: hex(bytes.subarray(16)) };
  return validContext(context) ? context : createTraceContext();
}

export function injectContext(input, origin, endpoint) {
  let url;
  let base;
  try {
    base = new URL(origin);
    url = new URL(input, base);
  } catch {
    return null;
  }
  if (base.username || base.password || url.username || url.password || url.origin !== base.origin || url.pathname !== endpoint || url.search || url.hash) return null;
  return url;
}

export function validContext({ traceId, spanId }) {
  return /^[0-9a-f]{32}$/.test(traceId) && !/^0+$/.test(traceId)
    && /^[0-9a-f]{16}$/.test(spanId) && !/^0+$/.test(spanId);
}
