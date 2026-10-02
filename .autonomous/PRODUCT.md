# Current Product Strategy

Status: technical feasibility; controlled browser-to-backend correlation and TypeScript source attribution proofs integrated

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
3. Build the smallest compelling viewer from the observed local artifact.
4. Measure setup friction.
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
function auto-capture, nor a viewer. Overlapping actions, cross-origin requests,
redirects, and databases remain unproven. The next product step is a small viewer
grounded in the observed local artifact, not broad stack expansion. AppMap and
Jaeger are useful reference points; these proofs establish no comparative
advantage.

This file is intentionally mutable.
Update it when evidence changes the product strategy.
