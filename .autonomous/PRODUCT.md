# Current Product Strategy

Status: technical feasibility; controlled browser-to-backend correlation proven

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
2. Prove trustworthy source-code attribution with a small Node.js/TypeScript
   fixture, including source maps where relevant.
3. Produce the smallest compelling visual prototype from observed evidence.
4. Measure setup friction.
5. Only then expand supported technologies.

## Evidence and limits

The initial local fixture and Chromium experiment now demonstrate two serialized
button actions correlated with real auto-instrumented Node.js HTTP spans and
explicit asynchronous service spans. Parent IDs, trace IDs, request headers,
durations, and visible completion are tested. See
[`docs/correlation-proof.md`](../docs/correlation-proof.md).

This establishes the controlled boundary, not generic interaction attribution or
automatic application-code capture. Overlapping actions, cross-origin requests,
redirects, databases, and source locations remain unproven. AppMap and Jaeger are
useful reference points; the proof does not establish a comparative advantage.

This file is intentionally mutable.
Update it when evidence changes the product strategy.
