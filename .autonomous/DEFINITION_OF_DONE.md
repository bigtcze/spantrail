# SpanTrail v1.0 Definition of Done

Finite objective: trustworthy public v1.0.0, supported by reproducible evidence. Do not turn completion into endless improvement.

## Product promise and scope

A developer runs SpanTrail with a supported Node.js/TypeScript web app, performs a meaningful browser action and inspects its real runtime trail: browser → HTTP → app code → database/cache/external services → response → resulting app behavior. Evidence, not LLM inference. Conceptual command: `npx spantrail -- npm run dev`; useful interactive trail, minimal configuration.

Required strong support: browser/user correlation, HTTP server requests, app execution, source attribution where technically possible, PostgreSQL, Redis, outbound HTTP, errors, latency and interactive visualization. Validate one representative modern full-stack framework and one conventional Node.js backend framework. Other ecosystems are not required.

## Gates

- **User experience:** competent developer unfamiliar with SpanTrail gets a first useful trail from documented installation on a supported clean environment in ≤5 minutes; happy path requires no prior OpenTelemetry expertise.
- **Functional:** deterministic realistic reference app covers browser → backend → app functions → PostgreSQL → Redis → outbound HTTP → response; visualization is correct. Known fixture errors appear at the correct trail location.
- **Evidence:** critical claims automated/reproducibly verified; maintain fixtures/golden scenarios; CI exercises meaningful unit, integration and E2E. Never mark unsupported or unverified capabilities as supported.
- **Reliability:** all supported golden scenarios pass consistently; no known critical/high defect makes primary workflow unusable or materially misleading.
- **Performance:** reproducible instrumentation-overhead benchmark; evidence-based acceptable limit set before v1.0 and result documented. Do not hide unacceptable overhead.
- **Privacy:** local-first. Application source, runtime traces and captured data are not sent to third parties unless the user explicitly configures that behaviour. Core tracing and visualization work without LLM or cloud AI.
- **Distribution:** public installable package, tagged v1.0.0, automated release/build validation, clear license, useful README, <5-minute quickstart, troubleshooting, architecture, privacy/security and contributing docs.
- **Demonstration:** repository contains a high-quality visual demo that quickly conveys core value without long explanation.
- **Final quality:** final independent product, engineering, security and UX reviews using appropriate specialist agents; resolve critical findings. Never lower criteria.

## Product hypothesis escape hatch

Evidence may change architecture, implementation strategy or framework. If the approach cannot provide useful runtime understanding, conduct a documented product review; remain focused on making real web-app runtime behavior understandable. Never silently change product category.

## Exact completion procedure

Only after every gate is satisfied, in order: (1) final independent reviews; (2) complete release test matrix; (3) publish/tag v1.0.0; (4) verify public-release installation on clean environment; (5) update docs; (6) record evidence for every gate; (7) create `.autonomous/PROJECT_COMPLETE` containing release version, release commit, completion date, evidence summary, known non-critical limits and deferred post-v1.0 opportunities.

Never create the marker because work became difficult or no task is obvious. After it exists, stop feature development; maintenance is separate.
