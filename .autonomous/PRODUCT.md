# Current Product Strategy

Status: controlled prototype; browser-to-backend correlation, explicit TypeScript source attribution, and local artifact viewer integrated

## Current hypothesis

SpanTrail visualizes the real end-to-end execution trail caused by a user
interaction in a web application.

Desired first-demo experience:

1. Developer runs one SpanTrail command around an example application.
2. Browser opens.
3. Developer clicks a meaningful UI action.
4. SpanTrail shows the real trail through frontend/network/backend/database.
5. Clicking a node reveals source location, duration and relevant evidence.
6. The result is visually strong enough to understand from a short GIF.

## Current priorities

1. Keep the controlled correlation proof green locally and in CI.
2. Keep the controlled TypeScript source-attribution proof green, including
   unknown-location fallback and failure/recovery behavior.
3. Keep the local viewer's real-artifact browser gate and fail-closed validation green.
4. Measure and reduce setup friction toward a single-command controlled demo.
5. Only then expand supported technologies.

## Evidence and limits

The initial local fixture and Chromium experiment demonstrate two serialized
button actions correlated with real auto-instrumented Node.js HTTP spans and
explicit asynchronous service spans. Parent IDs, trace IDs, request headers,
durations, and visible completion are tested. A separate executed compiled
TypeScript fixture in the same test suite verifies source locations for explicit
`withSourceSpan` calls, including a nested call after `await`, and its HTTP/span
failure and later recovery behavior. See
[`docs/correlation-proof.md`](../docs/correlation-proof.md).

The TypeScript fixture uses Node.js native call-site/source-map APIs and accepts
only the controlled fixture's compiler-owned external source map and project
relative source location. It does not provide generic TypeScript, framework, or
function auto-capture. Overlapping actions, cross-origin requests, and redirects remain unproven by this legacy proof. A separate narrow real PostgreSQL proof now covers one CommonJS pg integration; general database support, Redis, and the full-stack golden flow remain unproven.

The local viewer consumes the real proof artifact: action selection, parent-linked
backend span trees, durations, identifiers, mapped source positions, and explicit
unknown attribution. Its integrated Chromium gate verifies isolation, evidence
details, switching actions, hostile text, empty/error states, and reload recovery.
It binds to loopback and loads no source content or external assets. This is a
read-only snapshot, not a live capture UI or timeline; correlation action roots
have IDs only, not synthetic observed spans. See
[`docs/local-viewer.md`](../docs/local-viewer.md).

A focused Express 5.2.1 (MIT) / Node 24.21.0 conventional-backend fixture now
validates CommonJS preload-based HTTP tracing, two real serialized browser actions
through Express, the controlled mapped TypeScript spans, independent explicit app
spans with unknown source, generic promise rejection and recovery, privacy under
hostile OTEL settings, fail-closed completed-span overflow, and the viewer against
both artifacts. See the reproduction commands and precise limits in
[`docs/correlation-proof.md`](../docs/correlation-proof.md). This closes a narrow
integration validation step, not the v1.0 conventional-framework gate: the runtime
has fixture-hardcoded route/name allowlists, the app explicitly imports snapshot
and shutdown support, and it does not support arbitrary CLI apps, ESM, or route,
layer, and function capture.

A separate reusable local CommonJS session removes fixture-specific route/name
allowlists and app-imported snapshot/shutdown plumbing for temporary app processes.
It accepts an absolute `.cjs` entry and leaves readiness to the caller. Its preload
auto-instruments Node HTTP and PostgreSQL `pg` when those modules are required before
app load, alongside explicit OpenTelemetry application spans; it redacts names/paths,
uses a fixed PostgreSQL CLIENT label, and reports unknown source. The PostgreSQL
label is a sanitized display classification, not an authenticity boundary against
a malicious app. Sanitized records exclude SQL, parameters, DB credentials/results,
and errors, but raw span attributes such as `db.query.text` can exist in memory before
sanitization. This is not collection prevention, a sandbox, a heap bound, or a drain
guarantee. The narrow PostgreSQL proof validates only its tested fixture; the
repo-local capture command has no end-to-end PostgreSQL CLI gate.

An experimental repo-local `npm run capture` command composes the CommonJS capture session, a configured Chromium click, artifact validation/publication, and the existing viewer. It is usable as a repo-local command, not a published npm wrapper. It requires an existing `.cjs` app entry, Node 24, installed npm dependencies/Chromium, and explicit app OpenTelemetry instrumentation for application spans. It is narrowly configured, not a generic command wrapper or public package; readiness and exact completion text are required. It captures spans ended at snapshot time, not a fully drained trace or all later-ending work. Its output handling and bounds, per-stage timeout, viewer behavior, and app-network privacy limits are documented in the [capture command proof](../docs/correlation-proof.md#repo-local-capture-command). The capture command itself has no end-to-end PostgreSQL CLI gate; the separate narrow proof does not establish the five-minute onboarding gate.

A narrow programmatic Chromium browser-context capture now creates the context with
service workers blocked and installs before pages are created. Trusted top-frame
click dispatch (including Chromium-resolved-promise microtasks) can publish generated
action IDs and propagate them only to an exact configured fetch endpoint. Timers,
pending-await continuations, synthetic/frame/background requests bypass it. It is
fetch-only, imposes `redirect: 'error'`, preserves pre-existing trace headers by
bypassing injection, and has a fail-closed 100-action ID-only collector. This is not
a CLI, app instrumentation, or authenticity boundary against a malicious page.
Callers must await requests/actions and join IDs to actual backend spans before
parsing artifacts; unmatched actions are rejected. Application spans still require
explicit OpenTelemetry instrumentation. The successful checkout proof uses the
existing viewer; it does not prove error artifacts or broader support. Installation,
flush, and disposal are sequential, and failed cleanup requires closing the context.
See the [browser-context proof](../docs/correlation-proof.md#programmatic-browser-context-capture)
and [session proof](../docs/correlation-proof.md#local-commonjs-session-proof).

A cold machine setup observation is documented in the [local viewer guide](../docs/local-viewer.md),
but it is not a benchmark and does not establish the five-minute
unfamiliar-developer gate. AppMap and Jaeger are useful reference points; these
proofs establish no comparative advantage.

A separate `npm run proof:postgres` integration gate exercises PostgreSQL 18.6-bookworm with `pg` 8.23.1 and `@opentelemetry/instrumentation-pg` 0.74.0 in a CommonJS fixture. Real Chromium actions cover success, query failure, and recovery; assertions establish exact SERVER -> explicit INTERNAL -> PostgreSQL CLIENT parentage, unknown source, real `pg_sleep` duration, privacy-filtered evidence, and inspection in the unchanged viewer. The test is separate from default `npm test`, uses SELECT-only queries, and runs against an ephemeral loopback Docker container or an explicitly configured dedicated loopback test instance. The runner requires a positive SDK shutdown acknowledgement and observed child exit before reporting success; cleanup errors reject success. This does not establish a fully drained trace, collection prevention, heap bound, sandboxing, or general PostgreSQL/framework support. A supplied `SPANTRAIL_POSTGRES_URL` must target a dedicated loopback instance and contain no query parameters. See [`docs/correlation-proof.md`](../docs/correlation-proof.md#postgresql-186-commonjs-integration-proof).

This file is intentionally mutable.
Update it when evidence changes the product strategy.
