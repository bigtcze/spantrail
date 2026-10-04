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
function auto-capture. Overlapping actions, cross-origin requests, redirects,
and databases remain unproven.

The local viewer consumes the real proof artifact: action selection, parent-linked
backend span trees, durations, identifiers, mapped source positions, and explicit
unknown attribution. Its integrated Chromium gate verifies isolation, evidence
details, switching actions, hostile text, empty/error states, and reload recovery.
It binds to loopback and loads no source content or external assets. This is a
read-only snapshot, not a live capture UI or timeline; correlation action roots
have IDs only, not synthetic observed spans. See
[`docs/local-viewer.md`](../docs/local-viewer.md).

The next product step is validating a reusable conventional Node backend
application integration to close a v1.0 Definition of Done gap, after completing
the pending controlled-demo PR follow-up and its CI. Do not claim framework
support before validation. A cold machine setup observation is documented in the
[local viewer guide](../docs/local-viewer.md), but it is not a benchmark and does not
establish the five-minute unfamiliar-developer gate. AppMap and Jaeger are useful
reference points; these proofs establish no comparative advantage.

This file is intentionally mutable.
Update it when evidence changes the product strategy.
