const BINDING = '__spantrailCapturePublish_v1';
const MAX_ACTIONS = 100;
const factoryContexts = new WeakSet();

function validateOrigin(value) {
  if (typeof value !== 'string') throw new TypeError('origin must be a string');
  const match = /^(https?):\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?(\/)?$/.exec(value);
  if (!match) throw new TypeError('origin must be an exact loopback HTTP(S) origin');
  const url = new URL(value);
  if (url.origin !== value.replace(/\/$/, '')) throw new TypeError('origin must not contain URL normalization ambiguity');
  return url.origin;
}

function validateEndpoint(value) {
  if (typeof value !== 'string') throw new TypeError('endpoint must be a valid absolute URL');
  let url;
  try { url = new URL(value); } catch { throw new TypeError('endpoint must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[?#]/.test(value) || url.href !== value) {
    throw new TypeError('endpoint must be an absolute HTTP(S) URL without credentials, query, or fragment');
  }
  return url;
}

function validId(value, length) {
  return typeof value === 'string' && value.length === length * 2 && /^[0-9a-f]+$/.test(value) && /[1-9a-f]/.test(value);
}

export async function createBrowserCaptureContext(browser, options = {}) {
  if (!browser || browser.browserType?.().name() !== 'chromium') throw new TypeError('browser capture requires Playwright Chromium');
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  factoryContexts.add(context);
  return context;
}

export async function installBrowserCapture(context, { origin, endpoint } = {}) {
  const browser = context?.browser?.();
  if (!browser || browser.browserType().name() !== 'chromium') throw new TypeError('browser capture requires a Playwright Chromium context');
  if (!factoryContexts.has(context)) throw new TypeError('browser capture requires a context created by createBrowserCaptureContext');
  const exactOrigin = validateOrigin(origin);
  const endpointUrl = validateEndpoint(endpoint);
  if (endpointUrl.origin !== exactOrigin) throw new TypeError('endpoint must have the configured origin');
  if (context.pages().length) throw new Error('browser capture must be installed before creating any pages');

  const published = new Map();
  let active = true;
  let overflow = false;
  let bindingHandle;
  let initScriptHandle;

  let failure = null;
  const publish = async (source, payload) => {
    if (failure) throw failure;
    if (!active) throw new Error('browser capture is inactive');
    try {
      const frame = source?.frame;
      const page = frame?.page?.();
      let sourceOrigin;
      try { sourceOrigin = new URL(frame.url()).origin; } catch { throw new Error('invalid browser capture publisher'); }
      if (!page || frame !== page.mainFrame() || sourceOrigin !== exactOrigin) throw new Error('invalid browser capture publisher');
      if (!Array.isArray(payload) || payload.length !== 1) throw new Error('invalid browser capture publication');
      const item = payload[0];
      if (!item || Object.keys(item).sort().join(',') !== 'spanId,traceId' || !validId(item.traceId, 16) || !validId(item.spanId, 8)) throw new Error('invalid browser capture identifiers');
      const prior = published.get(item.traceId);
      if (prior && prior !== item.spanId) throw new Error('conflicting browser capture identifiers');
      if (!prior && published.size >= MAX_ACTIONS) { overflow = true; throw new Error('browser capture action limit exceeded'); }
      published.set(item.traceId, item.spanId);
    } catch (error) {
      failure ||= error;
      throw error;
    }
  };

  const init = ({ origin, endpoint, bindingName }) => {
    if (window.top !== window || location.origin !== origin) return;
    const state = { active: true, actions: new WeakMap(), publishedEvents: new WeakSet(), pending: new Set(), failure: null };
    let actionEvent = null;
    const observer = event => {
      if (!state.active || !event.isTrusted || event.type !== 'click' || event.eventPhase === 0 || window.event !== event) return;
      actionEvent = event;
    };
    window.addEventListener('click', observer, { capture: true, passive: true });
    const nativeFetch = window.fetch;
    const wrapper = function(input, init) {
      let args = arguments;
      const event = window.event;
      const bypass = () => nativeFetch.apply(this, args);
      if (!state.active || !event?.isTrusted || event.type !== 'click' || event.eventPhase === 0) return bypass();
      let requestConstructed = false;
      try {
        const inputURL = typeof input === 'string' ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : null;
        if (inputURL === null || new URL(inputURL, location.href).href !== endpoint) return bypass();
        if (input instanceof Request && (input.headers.has('traceparent') || input.headers.has('tracestate'))) return bypass();
        let dispatchInit = init;
        if (init?.headers != null) {
          const supplied = new Headers(init.headers);
          const initWithHeaders = new Proxy(Object.create(null), {
            get(_target, key) {
              return key === 'headers' ? supplied : Reflect.get(Object(init), key, init);
            }
          });
          args = [input, initWithHeaders];
          if (supplied.has('traceparent') || supplied.has('tracestate')) return bypass();
          dispatchInit = initWithHeaders;
        }
        let selectedAction = state.actions.get(event);
        if (!selectedAction && actionEvent === event) {
          const bytes = new Uint8Array(24);
          crypto.getRandomValues(bytes);
          const hex = value => Array.from(value, x => x.toString(16).padStart(2, '0')).join('');
          selectedAction = { traceId: hex(bytes.subarray(0, 16)), spanId: hex(bytes.subarray(16)) };
          if (/^0+$/.test(selectedAction.traceId) || /^0+$/.test(selectedAction.spanId)) return bypass();
        }
        if (!selectedAction) return bypass();
        const request = new Request(input, dispatchInit);
        requestConstructed = true;
        state.actions.set(event, selectedAction);
        if (!state.publishedEvents.has(event)) {
          state.publishedEvents.add(event);
          const promise = Promise.resolve().then(() => window[bindingName]([{ traceId: selectedAction.traceId, spanId: selectedAction.spanId }])).catch(error => {
            state.failure = error || new Error('browser capture publication failed');
            throw state.failure;
          });
          state.pending.add(promise);
          promise.then(() => state.pending.delete(promise), () => state.pending.delete(promise));
        }
        const headers = new Headers(request.headers);
        headers.set('traceparent', `00-${selectedAction.traceId}-${selectedAction.spanId}-01`);
        return nativeFetch.call(this, request, { redirect: 'error', headers });
      } catch (error) {
        if (requestConstructed) throw error;
        return bypass();
      }
    };
    window.fetch = wrapper;
    Object.defineProperty(window, '__spantrailCaptureDispose', { configurable: true, value: () => {
      state.active = false;
      window.removeEventListener('click', observer, true);
      if (window.fetch === wrapper) window.fetch = nativeFetch;
    }});
    Object.defineProperty(window, '__spantrailCaptureFlush', { configurable: true, value: async () => {
      await Promise.all([...state.pending]);
      if (state.failure) throw state.failure;
    }});
  };

  try {
    bindingHandle = await context.exposeBinding(BINDING, publish);
    initScriptHandle = await context.addInitScript(init, { origin: exactOrigin, endpoint: endpointUrl.href, bindingName: BINDING });
  } catch (error) {
    active = false;
    try { await initScriptHandle?.dispose(); } catch {}
    try { await bindingHandle?.dispose(); } catch {}
    throw error;
  }
  if (context.pages().length) {
    active = false;
    try { await initScriptHandle.dispose(); } catch {}
    for (const page of context.pages()) { try { await page.evaluate(() => window.__spantrailCaptureDispose?.()); } catch {} }
    try { await bindingHandle.dispose(); } catch {}
    throw new Error('browser capture installation requires sequential context lifecycle');
  }

  let disposePromise = null;
  return {
    async actions() {
      if (!active || overflow || failure) throw failure || new Error(overflow ? 'browser capture action limit exceeded' : 'browser capture unavailable');
      for (const page of context.pages()) {
        if (page.isClosed()) continue;
        await page.evaluate(() => window.__spantrailCaptureFlush?.());
        if (!active || failure) throw failure || new Error('browser capture unavailable');
      }
      if (overflow || failure) throw failure || new Error('browser capture action limit exceeded');
      return [...published].map(([traceId, spanId]) => ({ traceId, spanId }));
    },
    dispose() {
      if (disposePromise) return disposePromise;
      active = false;
      disposePromise = (async () => {
        const errors = [];
        try { await initScriptHandle.dispose(); } catch (error) { if (!/closed/i.test(String(error))) errors.push(error); }
        for (const page of context.pages()) {
          if (page.isClosed()) continue;
          try { await page.evaluate(() => window.__spantrailCaptureDispose?.()); } catch (error) { if (!/closed/i.test(String(error))) errors.push(error); }
        }
        try { await bindingHandle.dispose(); } catch (error) { if (!/closed/i.test(String(error))) errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'browser capture cleanup failed');
      })();
      return disposePromise;
    }
  };
}
