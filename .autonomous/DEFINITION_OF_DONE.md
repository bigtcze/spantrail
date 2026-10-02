# SpanTrail v1.0 Definition of Done

SpanTrail has a finite autonomous development objective.

The project is complete when a trustworthy public v1.0.0 release exists and
the conditions below are supported by reproducible evidence.

The objective is not endless improvement.

## Product promise

A developer can run SpanTrail with a supported Node.js/TypeScript web
application, perform a meaningful browser action, and inspect the real runtime
trail caused by that action:

browser interaction
-> HTTP request
-> application code
-> database/cache/external services
-> response
-> resulting application behaviour.

The trail is derived from runtime evidence rather than inferred by an LLM.

The desired user experience is conceptually:

    npx spantrail -- npm run dev

followed by a useful interactive trail with minimal configuration.

## v1.0 scope

The required ecosystem is Node.js / TypeScript.

The v1.0 product must demonstrate strong support for:

- browser/user interaction correlation,
- HTTP server requests,
- application execution,
- source attribution where technically possible,
- PostgreSQL,
- Redis,
- outbound HTTP calls,
- errors and latency,
- interactive visualization.

At least one representative modern full-stack framework and one conventional
Node.js backend framework must be validated.

Additional languages and ecosystems are explicitly not required for v1.0.

## User experience gate

A competent developer unfamiliar with SpanTrail must be able to obtain the
first useful trail from documented installation instructions in no more than
five minutes on a supported clean environment.

The normal happy path must not require prior OpenTelemetry expertise.

## Functional gate

A deterministic reference application must contain a realistic flow involving:

browser interaction
-> backend request
-> application functions
-> PostgreSQL
-> Redis
-> outbound HTTP call
-> resulting response.

SpanTrail must correctly visualize that flow.

Errors introduced at known points in the fixture must be visible at the
correct place in the execution trail.

## Evidence gate

Critical product claims must be covered by automated or reproducible
verification.

Maintain fixture applications and golden scenarios.

CI must exercise meaningful unit, integration and end-to-end behaviour.

Do not mark unsupported or unverified capabilities as supported.

## Reliability gate

All supported golden scenarios must pass consistently.

There must be no known critical or high-severity defect that makes the primary
supported workflow unusable or materially misleading.

## Performance gate

Create a reproducible benchmark measuring SpanTrail instrumentation overhead.

Set an evidence-based acceptable limit before v1.0 and document the result.

Do not hide unacceptable overhead merely to reach release status.

## Privacy gate

The core product is local-first.

Application source, runtime traces and captured data must not be sent to a
third-party service unless the user explicitly configures that behaviour.

The core tracing and visualization path must work without an LLM or cloud AI
service.

## Distribution gate

Before completion SpanTrail must have:

- a public installable package,
- a tagged v1.0.0 release,
- automated release/build validation,
- a clear license,
- useful README,
- less-than-five-minute quickstart,
- troubleshooting documentation,
- architecture documentation,
- privacy/security documentation,
- contributing guidance.

## Demonstration gate

The repository must contain a high-quality visual demonstration showing the
core value proposition quickly.

A developer seeing the demonstration should be able to understand the basic
purpose of SpanTrail without reading a long explanation.

## Product quality review

Before declaring completion, conduct a final independent product, engineering,
security and UX review using appropriate specialist agents.

Critical findings must be resolved.

Do not lower acceptance criteria simply to declare the project complete.

## Product hypothesis escape hatch

If evidence collected during development demonstrates that an implementation
assumption is wrong, the autonomous team may change architecture,
implementation strategy or exact framework selection.

If evidence demonstrates that the current product approach cannot provide
useful runtime understanding, perform a documented product review.

The project must remain focused on making real web application runtime
behaviour easy for developers to understand.

Do not silently transform SpanTrail into an unrelated product.

## Completion procedure

Only when all v1.0 gates are satisfied:

1. perform the final independent reviews,
2. execute the complete release test matrix,
3. publish/tag v1.0.0,
4. verify installation from the public release on a clean environment,
5. update documentation,
6. record evidence for each Definition of Done gate,
7. create:

   .autonomous/PROJECT_COMPLETE

The completion file must contain:

- release version,
- release commit,
- completion date,
- evidence summary,
- known non-critical limitations,
- deferred post-v1.0 opportunities.

PROJECT_COMPLETE must never be created merely because development became
difficult or because no obvious task was found.

After PROJECT_COMPLETE exists, continuous autonomous feature development must
stop.

Post-v1.0 maintenance is a separate operating mode and is not part of this
autonomous development mission.
