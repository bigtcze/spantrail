# Browser-to-backend correlation proof

## Scope

This bootstrap experiment tests one boundary: an observed browser button click
can be joined to real Node.js HTTP and application spans without an external
collector or an LLM. It is not yet the SpanTrail product or a claim of general
framework support.

## Acceptance criteria

- A Playwright-driven Chromium click invokes a same-origin loopback HTTP API
  and visibly updates the fixture page after a successful response.
- Each action receives a fresh W3C trace ID and parent span ID. Only the exact
  fixture origin and intended API endpoint receive the injected context.
- OpenTelemetry HTTP auto-instrumentation, initialized before the server loads
  `node:http`, creates a SERVER span parented to the injected context.
- An explicitly instrumented asynchronous service operation is a child of that
  server span, with the same trace ID and valid duration evidence.
- Repeated actions have different trace IDs and no cross-action parentage.
  An uncorrelated control request is not assigned to a browser action.
- Tests exercise the real browser and server, not just mocked span objects.
- Normal completion and failures close the browser and child server. Runtime
  data stays on loopback and local disk; no exporter contacts a remote service.
- A runnable experiment emits a small JSON artifact of observed action and span
  evidence. No request bodies, source code, or secrets are collected.

## Evidence path

Run the disposable server in a separate Node.js process. Use an in-memory
OpenTelemetry exporter and a loopback-only diagnostics endpoint to inspect
finished spans. Drive clicks with Chromium, then assert trace IDs, parent span
IDs, kinds, durations, response, and resulting DOM state. Unit tests cover
context generation and strict injection scope. Repeat the browser experiment
and retain a local artifact for inspection.

This establishes causal linkage for a deliberately controlled, serialized
interaction. It does not establish attribution for overlapping actions,
background requests, redirects, cross-origin traffic, databases, or source
locations. Application service spans are explicit instrumentation, not inferred
function-level execution.

## Reproduce locally

Use Node.js 24 (tested with 24.21.0) and npm. Install dependencies and the
Chromium browser, then run the tests and standalone proof:

```sh
npm ci
npx playwright install chromium
npm test
npm run proof
```

The test command includes unit/lifecycle checks and a real Chromium run against
the disposable local server. The standalone command writes
`experiments/correlation/artifacts/proof.json` (ignored by Git). On Ubuntu CI,
install Chromium and its system dependencies with
`npx playwright install --with-deps chromium`; the workflow then runs `npm
test`. No artifact upload is needed. Evidence is intentionally compact and
excludes request bodies, source code, and secrets.

### Acceptance-to-test map

| Claim | Executable evidence |
| --- | --- |
| Real clicks, visible completion, fresh contexts, exact header scope | Chromium assertions in `experiments/correlation/run.js` |
| HTTP auto-instrumentation, server/service parentage, durations, control isolation | Finished-span assertions in the same runner |
| Shared context generation and strict URL scope | `context.test.js`; the browser imports the tested module |
| Cleanup after startup/launch/run failure and interrupted shutdown | `lifecycle.test.js`, including real child/subprocess termination |
| No outbound telemetry and no raw request data in evidence | `privacy.test.js`, with a working default-exporter negative control redirected to loopback |

All of these execute through `npm test`. Repeating the standalone proof with
`SPANTRAIL_CONTROL_DELAY_MS=200 npm run proof` also exercises delayed control
completion without changing the attribution model.

## Implementation boundary

The fixture browser creates a fresh W3C trace context for each serialized,
same-origin action and injects it only to the intended API endpoint. In the
server process, the OpenTelemetry Node SDK starts before the HTTP module is
loaded; explicit `createRequire` loading after SDK startup activates the
CommonJS instrumentation hook. An explicitly instrumented asynchronous service
operation provides the application span. This is a narrow JavaScript/CommonJS
experiment, not general ESM instrumentation or TypeScript application support.
There is no external collector, LLM, or remote telemetry exporter in this
proof.

## What this does not prove

This is a serialized, controlled action rather than generic click attribution.
It does not establish correct attribution for overlapping actions, background
requests, redirects, or cross-origin traffic; trace databases; or recover
source locations or inferred function-level execution. It does not demonstrate
framework or language coverage. The application span is explicitly added, not
automatically inferred.

## References

- [OpenTelemetry JavaScript tracing](https://opentelemetry.io/docs/languages/js/instrumentation/)
- [OpenTelemetry JavaScript context propagation](https://opentelemetry.io/docs/languages/js/propagation/)
- [OpenTelemetry JavaScript Node.js getting started](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
- [AppMap](https://appmap.io/) is a comparison point for application-level runtime recording; this experiment makes no comparative market or capability claim.
- [Jaeger](https://www.jaegertracing.io/) is a distributed tracing backend; this local proof does not require a Jaeger deployment or collector.
