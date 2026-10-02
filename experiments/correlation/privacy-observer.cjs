const http = require('node:http');
const https = require('node:https');
const { syncBuiltinESMExports } = require('node:module');
const { URL, urlToHttpOptions } = require('node:url');
const nativeHttpRequest = http.request;
const port = Number(process.env.PRIVACY_TRIPWIRE_PORT);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PRIVACY_TRIPWIRE_PORT must identify the local tripwire');
}
delete process.env.PRIVACY_TRIPWIRE_PORT;

for (const [client, defaultProtocol] of [[http, 'http:'], [https, 'https:']]) {
  client.request = function observedRequest(input, second, third) {
    let options;
    if (typeof input === 'string' || input instanceof URL) {
      const target = typeof input === 'string' ? new URL(input) : input;
      options = {
        ...urlToHttpOptions(target),
        ...(typeof second === 'object' && second !== null ? second : {}),
      };
    } else {
      options = { ...input };
    }

    const callback = typeof second === 'function' ? second : third;
    const protocol = options.protocol ?? defaultProtocol;
    const hostname = options.hostname ?? options.host ?? 'localhost';
    const target = `${protocol}//${hostname}${options.port ? `:${options.port}` : ''}${options.path ?? options.pathname ?? '/'}`;
    process.send?.({ type: 'outbound', request: target });

    return nativeHttpRequest.call(http, {
      ...options,
      protocol: 'http:',
      hostname: '127.0.0.1',
      host: undefined,
      port,
      agent: false,
      socketPath: undefined,
      createConnection: undefined,
    }, callback);
  };

  client.get = (...args) => {
    const request = client.request(...args);
    request.end();
    return request;
  };
}

syncBuiltinESMExports();
