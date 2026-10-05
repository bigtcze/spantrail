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
background requests, redirects, or cross-origin traffic. Database tracing is
covered only by the separate narrow PostgreSQL proof below; this legacy proof
does not cover it. Application service spans are explicit instrumentation, not
inferred function-level execution. The integrated test suite also exercises a
separate compiled TypeScript source-attribution fixture; that narrow evidence and its limits are
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

## PostgreSQL 18.6 CommonJS integration proof

A separate real-database Chromium proof exercises PostgreSQL 18.6-bookworm, `pg`
8.23.1, and `@opentelemetry/instrumentation-pg` 0.74.0 through the reusable local
CommonJS capture preload. The fixture uses Express 5.2.1 and Node.js 24.21.0; this
is one narrowly scoped integration, not general PostgreSQL, Redis, or framework
support. The PostgreSQL CLIENT span receives the fixed display name `PostgreSQL`
only after the sanitizer's installed instrumentation-scope, span-kind, and database
system checks. This label is not an authenticity boundary against a malicious app.

Run the dedicated integration gate after installing dependencies and Chromium:

```sh
npm run proof:postgres
node --test experiments/postgres/harness.test.js
```

The harness tests use their own disposable Docker containers, including when the
integration proof uses a supplied database. They cover delayed startup, a real
aborted exporter attempt, rejected SDK shutdown, shutdown exporter attempts,
cleanup failure, repeated active-request interruption, and URL rejection before
startup. Docker is required for this separate harness gate.

Locally, the command requires Docker and starts a disposable `postgres:18.6-bookworm`
container published only on a dynamically allocated loopback port; it removes that
container on completion. Alternatively, set `SPANTRAIL_POSTGRES_URL` to an existing
dedicated loopback test instance. The URL must contain no query parameters. The supplied
instance is not stopped or removed. The fixture performs only `SELECT` queries and does not mutate tables. CI runs this
as a separate explicit PostgreSQL integration step with a PostgreSQL service;
it is not part of the default `npm test` command. The repository pins `pg` 8.23.1
(MIT) and `@opentelemetry/instrumentation-pg` 0.74.0 (Apache-2.0).

Three serialized Chromium actions execute a parameterized successful query with
`pg_sleep`, a real invalid-parameter query failure, then a successful recovery.
Each action has a fresh trace and the tested path asserts exactly one HTTP SERVER
span parented to the browser CLIENT action, one explicit app INTERNAL span parented
to SERVER, and one PostgreSQL CLIENT span parented to INTERNAL. The PostgreSQL
source attribution is explicitly unknown. Successful `pg_sleep` duration is
asserted from the observed span; failure status and subsequent recovery are also
checked. The unchanged viewer is inspected in Chromium for each action, including
the PostgreSQL name, unknown source, observed duration/status, and HTTP request
parent. The test verifies that the served sanitized artifact omits its sentinel
result and connection credentials, and that hostile OTEL exporter settings cause
no outbound HTTP(S) exporter attempts through shutdown.

Sanitized records/artifacts exclude SQL text, parameters, database credentials,
query results, and errors. This is output sanitization, not collection prevention:
raw OpenTelemetry span attributes, including `db.query.text`, may exist in process
memory before serialization. This is not a sandbox or heap bound, and does not
establish a fully drained trace or general PostgreSQL/`pg` coverage. Shutdown is
cooperative. The runner requires a positive SDK shutdown acknowledgement and observed
child exit before reporting success; cleanup errors reject success. This is not evidence
of a fully drained trace. It makes no performance, onboarding, or full-stack golden
flow claim.

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
npm wrapper, or arbitrary browser injector. Its preload auto-instruments Node HTTP
and PostgreSQL `pg` when required before app load; the separate PostgreSQL integration
proof covers only its narrow tested fixture, not this helper as a general database
support claim. It forks the app with the local
CommonJS preload. Application readiness is caller-managed: the helper does not
infer that the server is listening. Child stdout/stderr remain raw application
output and are not redacted by the capture schema. Applications may use the
OpenTelemetry API explicitly to create application spans. The scoped browser
context helper below supplies context for eligible fetches without app-side
trace-context code. The viewer's temporary artifact is used for the
actual browser gate; no capture artifact is retained by default.

Completed records are sanitized: generic span names, null paths, and unknown
source; recognized PostgreSQL CLIENT spans use the fixed `PostgreSQL` label.
The preload auto-instruments `pg` only when loaded before the app. Arbitrary
application names, attributes, error messages, paths, headers, and bodies are not
returned. Raw span attributes (including SQL query text) may still exist in
memory before sanitization; this is not collection prevention or an authenticity
boundary against a malicious app. Existing `OTEL_` environment variables are cleared
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

## Repo-local capture command

The experimental repo-local `npm run capture` command joins a CommonJS capture session to one configured Chromium click and the existing viewer. It is not a published package or general `npx`/npm command wrapper. From the repository root, with Node.js 24, npm dependencies installed, and Playwright Chromium installed, start an instrumented app through the command (it inherits the current environment):

```sh
PORT=3000 npm run capture -- --entry ./app.cjs --url http://127.0.0.1:3000/ --endpoint http://127.0.0.1:3000/checkout --click '#checkout' --complete '#status' --text 'checkout complete' --output ./checkout.json
```

Optional flags are `--timeout 10000`, `--headed`, and `--no-viewer`. The entry must be an existing `.cjs` file supplied by the user; this repository does not provide an `app.cjs` fixture. It starts with the current working directory and inherited environment. The app must be explicitly OpenTelemetry-instrumented for application spans. The URL and endpoint must be same-origin loopback HTTP URLs, and the endpoint must exactly match an eligible fetch from the configured click. This automates that configured trusted click; it does not record manual browsing or wrap arbitrary npm/npx commands. Selectors are used literally as CSS selectors; the required completion element's exact `textContent` must not already equal the requested text before clicking. Readiness requires a 200–299 response, navigation must succeed, and the app must reach the exact completion text. An HTTP error response from the configured endpoint can still be accepted if the app displays the configured completion text; its observed span status is not synthesized.

The artifact contains spans ended at snapshot time, after the endpoint response finishes and the completion marker changes. Later-ending application work is not guaranteed to appear, even if SDK shutdown succeeds. Readiness establishes page availability, not application identity. Cleanup is cooperative: signals are owned by the command, but navigation/click operations may finish or reach their configured timeout before cleanup proceeds. Parent SIGKILL, OS failure, and descendant containment remain outside this guarantee.

`--timeout` defaults to 10000 and accepts 100–60000 milliseconds per stage, not as an overall command deadline; the underlying capture stop uses its own bounded deadlines. The output parent must already exist and the target must be new: the command will not overwrite an existing path. It requires positive SDK shutdown acknowledgement and stops its capture app and browser before writing a validated artifact with mode 0600, limited to 1 MiB and containing filtered actions/spans; child exit alone does not establish SDK shutdown. App stdout/stderr are raw and not redacted. No source or request bodies are exported. By default it starts the existing loopback read-only viewer on an ephemeral port, prints its URL for manual opening, and waits for Ctrl+C; a normal viewer stop leaves the persisted artifact in place. `--no-viewer` saves the artifact and exits. `--headed` opens the actual automated capture browser; it does not hand control over for an arbitrary user flow.

Command failure diagnostics name the failed stage without including the underlying exception text. If later cleanup also fails, the original stage remains visible alongside fixed cleanup-operation labels (for example, `capture: browser action failed; cleanup failed: capture hooks`). Cleanup failure remains a nonzero result; these sanitized command diagnostics do not redact the app's own stdout/stderr.

This is local artifact handling, not a sandbox: the app's own outbound calls and its loaded page assets are not restricted. Fetch-only capture, rejected endpoint redirects, and blocked service workers can change application semantics. XHR, navigation, arbitrary async causality, generic database capture beyond the separate narrow PostgreSQL proof, generic source/function capture, ESM entries, and broad framework support are out of scope. The core flow does not require an LLM. This command does not establish the five-minute unfamiliar-developer gate or public installability.

## Programmatic browser-context capture

`experiments/capture/browser-context.js` adds a narrow Playwright Chromium API, usable programmatically and by the experimental repo-local capture command documented above. That command is not a published npm wrapper. Create the context with `createBrowserCaptureContext(browser)`, install capture before creating pages, and use the exact loopback origin and absolute endpoint URL:

```js
import { chromium } from 'playwright';
import { createBrowserCaptureContext, installBrowserCapture } from './experiments/capture/browser-context.js';

const browser = await chromium.launch();
const context = await createBrowserCaptureContext(browser);
const capture = await installBrowserCapture(context, {
  origin: 'http://127.0.0.1:4318',
  endpoint: 'http://127.0.0.1:4318/api/checkout'
});
const page = await context.newPage();
try {
  await page.goto('http://127.0.0.1:4318');
  const responseReady = page.waitForResponse('http://127.0.0.1:4318/api/checkout');
  await page.getByRole('button', { name: 'Checkout' }).click();
  const response = await responseReady;
  await response.finished();
  // Await the application's own completion signal before taking the snapshot.
  await page.getByText('checkout complete', { exact: true }).waitFor();
  const actions = await capture.actions();
  // After the response and application completion signal, snapshot ended-span evidence.
  const spans = await session.snapshot();
  const matchingActions = actions.filter(action => spans.some(span => span.traceId === action.traceId));
  const artifact = parseArtifact({ actions: matchingActions, spans });
} finally {
  try { await capture.dispose(); } catch { await context.close(); }
  await browser.close();
}
```

Here `session` is an independently started local capture session and `parseArtifact` is imported from `experiments/viewer/model.js`; startup/readiness is caller-managed. Await the actual request and application completion signal before snapshotting ended-span evidence or navigating/closing the page. This does not prove the trace is fully drained: unrelated spans may end later, and unfinished work is not established by the snapshot. Install, flush via `actions()`, and dispose sequentially; concurrent lifecycle use is not guaranteed. The installer forces service workers to `block`; it does not change routing or cache behavior beyond the fetch hook.

Only a trusted top-frame click's active dispatch can generate IDs and propagate them to the configured exact endpoint. Chromium-resolved-promise microtasks in that dispatch are covered; timers, pending-await continuations, synthetic clicks, frame requests, and background requests bypass capture. Only string, URL, or Request fetch inputs are considered; this is fetch-only, not XHR or navigation. Requests to the endpoint must match its exact `href`, with no query or fragment; credentials are rejected. An original Request containing `traceparent` or `tracestate`, or either header supplied in `init`, bypasses capture even if later overridden. Selected requests use `redirect: 'error'`, blocking same- and cross-origin redirects and potentially changing application behavior.

The browser binding publishes generated IDs only, not completed spans, and is callable from the page realm; it is not an authenticity boundary against a malicious application. The fail-closed collector allows at most 100 actions; observed publication failures are latched. Join returned actions only to IDs having real backend spans before calling `parseArtifact`: actions without matching spans (for example, aborted requests before reaching the backend) are rejected by the parser. Unrelated spans may remain in the snapshot but do not appear in action trails; captured spans retain explicit unknown source. No span completion is fabricated. The integrated proof verifies successful checkout actions in the unchanged viewer, not error artifacts. The disposer disables capture in existing pages, removes the new-page init script, and awaits cleanup. If cleanup fails, close the context; no concurrent cleanup guarantee is made.

`npm run test:capture` includes the integrated browser-context tests via test auto-discovery. They exercise trusted dispatch/microtasks and bypass cases, exact endpoint matching, header preservation, lifecycle and a successful checkout through the existing viewer. The programmatic API does not generate application spans: explicit OpenTelemetry instrumentation is still required for application spans. It reuses the local capture session and unchanged viewer, and adds no UI or broader product/framework support claim.

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
requests, redirects, or cross-origin traffic, or recover inferred function-level
execution. A separate narrow PostgreSQL proof is documented above; neither proof
establishes general database tracing. It does not demonstrate framework or broad
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
