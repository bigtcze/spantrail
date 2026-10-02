# Current Product Strategy

Status: discovery / bootstrap

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

1. Research the exact technical feasibility and closest competitors.
2. Build a disposable reference application for experiments.
3. Prove reliable browser -> backend trace correlation.
4. Prove source-code attribution.
5. Produce the smallest compelling visual prototype.
6. Measure setup friction.
7. Only then expand supported technologies.

This file is intentionally mutable.
Update it when evidence changes the product strategy.
