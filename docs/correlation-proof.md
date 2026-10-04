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
background requests, redirects, cross-origin traffic, or databases. Application
service spans are explicit instrumentation, not inferred function-level
execution. The integrated test suite also exercises a separate compiled
TypeScript source-attribution fixture; that narrow evidence and its limits are
documented in [Source attribution proof](source-attribution-proof.md).

## Reproduce locally

Use Node.js 24 (tested with 24.21.0) and npm. Install dependencies and the
Chromium browser, then run the tests and standalone proof:

```sh
npm ci
npx playwright install chromium
npm test
npm run proof
```

The test command builds the TypeScript fixture, includes unit/lifecycle and
source-attribution checks, generates both real Chromium proof artifacts, and runs
the viewer E2E against both. The standalone command writes
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

Source mapping cases and their assertions are mapped separately in
[`docs/source-attribution-proof.md`](source-attribution-proof.md). A separate,
narrow conventional-backend integration proof is documented below.

## Express 5.2.1 CommonJS integration proof

This disposable fixture validates Express 5.2.1 (MIT) on Node.js 24.21.0 using
CommonJS preload instrumentation. It is a validation experiment, not a reusable
production SDK or general Express support claim. The fixed span-name and route
allowlists and explicit controlled-fixture source helper in
`experiments/runtime/local-tracing.cjs` do not capture arbitrary application
routes, functions, or source locations. The app explicitly imports the local
runtime's snapshot and shutdown support. This is not an arbitrary app CLI
wrapper, ESM integration, or Express route/layer/function auto-capture; it adds
no collector.

Reproduce from the repository root with dependencies and Chromium already
installed:

```sh
npm run test:express
npm run proof:express
npm run test:viewer:express
SPANTRAIL_ARTIFACT_PATH=experiments/express/artifacts/express-proof.json npm run test:viewer
```

`test:express` runs the Node tests (and builds first); `proof:express` runs the
real browser proof and writes the Express artifact; `test:viewer:express` runs
the viewer browser gate against that artifact. The final command independently
selects it through the viewer's existing `SPANTRAIL_ARTIFACT_PATH` option.
`npm test` includes these Express and viewer gates. The artifact is ignored local
output; generate it before invoking either viewer gate directly.

The executed checks cover two real serialized Chromium actions through Express
and the same mapped controlled TypeScript service spans as the existing proof,
plus an independent ordinary app request with explicit spans and an unknown
source result. They verify parentage, an Express 5 generic promise rejection
returning a sanitized 500 and recovery on a later request, hostile OTEL exporter
settings producing no HTTP(S) attempts through SDK shutdown (with an existing
working negative control), and a fail-closed snapshot boundary: 1,000 completed
spans are accepted by the actual viewer parser, while span 1,001 makes snapshot
fail as incomplete. HTTP failure/recovery is tested directly; it is not represented
as a browser error artifact. The viewer is exercised against both correlation and
Express artifacts. These are fixture assertions, not broader UX, setup-time, or
performance claims.

`SPANTRAIL_ARTIFACT_PATH` selects the artifact for viewer E2E tests; it does not
configure the normal interactive viewer command. The 1,000 bound is on completed
span count only; it does not bound arbitrary span attributes, in-flight spans, or
total process heap. Snapshot output sanitization is not collection prevention.
Cooperative shutdown deadlines do not guarantee flush or drain. Mapped source
attribution remains limited to the explicitly instrumented controlled TypeScript
fixture and its approved source map; other spans report unknown.

## Local CommonJS session proof

`experiments/capture/session.js` exports the programmatic `startCapture` entry
point for an existing absolute `.cjs` application entry and working directory:

```js
import { startCapture } from './experiments/capture/session.js';

const capture = await startCapture({ entry: '/absolute/path/to/app.cjs', cwd: '/path/to/app' });
// The caller starts/awaits application readiness using its own application contract.
const spans = await capture.snapshot(); // sanitized spans only
const exit = await capture.stop(); // resolves when the child exit is observed
```

This is a local CommonJS session helper, not a published package, generic CLI,
npm wrapper, or arbitrary browser injector. It forks the app with the local
CommonJS preload. Application readiness is caller-managed: the helper does not
infer that the server is listening. Child stdout/stderr remain raw application
output and are not redacted by the capture schema. Applications may use the
OpenTelemetry API explicitly to create application spans; browser tests must
supply their own trace contexts. The viewer's temporary artifact is used for the
actual browser gate; no capture artifact is retained by default.

Completed records are sanitized: generic span names, null paths, and unknown
source; arbitrary application names, attributes, error messages, paths, headers,
and bodies are not returned. Existing `OTEL_` environment variables are cleared
in the child. The in-memory exporter uses the installed SDK's callback-style
export and Promise-returning `forceFlush`/`shutdown` contracts. A working
loopback tripwire negative control verifies detection of remote-export attempts;
the capture test verifies hostile exporter settings do not result in HTTP(S)
attempts. These are test-bound privacy claims, not an OS sandbox.

The fail-closed limit is 1,000 completed spans. It is not a total heap bound,
in-flight span limit, or bound on raw application-side collection. Shutdown
requests cooperative SDK flush/shutdown and waits for observed child exit, with
SIGTERM/SIGKILL deadlines of 1/6/9 seconds. Those deadlines do not guarantee a
flush, descendant containment, or sandboxing. The application owns readiness,
server semantics, and its process behavior; this proof adds no source attribution.

`npm run test:capture` exercises the entry point and lifecycle/schema boundaries.
The section documents this narrow integration, not broad framework support.

## Implementation boundary

The fixture browser creates a fresh W3C trace context for each serialized,
same-origin action and injects it only to the intended API endpoint. In the
server process, the OpenTelemetry Node SDK starts before the HTTP module is
loaded; explicit `createRequire` loading after SDK startup activates the
CommonJS instrumentation hook. An explicitly instrumented asynchronous service
operation provides the application span. The browser-correlation server remains
a narrow JavaScript/CommonJS experiment, not general ESM instrumentation. The
integrated suite separately executes compiled TypeScript application fixture
code for the limited explicit source-attribution proof; it is not general
TypeScript application support.
There is no external collector, LLM, or remote telemetry exporter in this
proof.

## What this does not prove

This is a serialized, controlled action rather than generic click attribution.
It does not establish correct attribution for overlapping actions, background
requests, redirects, or cross-origin traffic; trace databases; or recover
inferred function-level execution. It does not demonstrate framework or broad
language coverage. The application span is explicitly added, not automatically
inferred. Source-location behavior is limited to the controlled fixture and
described in the linked proof; it is not general source capture.

## References

- [OpenTelemetry JavaScript tracing](https://opentelemetry.io/docs/languages/js/instrumentation/)
- [OpenTelemetry JavaScript context propagation](https://opentelemetry.io/docs/languages/js/propagation/)
- [OpenTelemetry JavaScript Node.js getting started](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
- [AppMap](https://appmap.io/) is a comparison point for application-level runtime recording; this experiment makes no comparative market or capability claim.
- [Jaeger](https://www.jaegertracing.io/) is a distributed tracing backend; this local proof does not require a Jaeger deployment or collector.
