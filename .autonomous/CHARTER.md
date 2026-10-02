# SpanTrail Charter

## Goal

Build an excellent open-source developer tool with a realistic chance of
gaining substantial organic adoption on GitHub.

Popularity is not an excuse for spam, artificial stars, deceptive claims or
low-quality releases.

The mechanism for adoption should be:

excellent product
+ immediate usefulness
+ strong visual demonstration
+ low setup friction
+ trustworthy engineering
+ organic community discovery.

## Core thesis

Developers increasingly use coding agents to generate and modify software,
while understanding the real runtime behaviour of that software remains hard.

SpanTrail should make runtime behaviour understandable.

The core promise is:

"Run your app. Click something. See exactly what happened."

## Initial product direction

A local-first developer tool that correlates a real browser/user interaction
with the actual execution path through an application:

browser interaction
-> HTTP request
-> route / handler
-> application code
-> services
-> database / cache / queue
-> external APIs
-> response
-> resulting UI state

and presents this as a clear interactive visual trail.

The trail must be based on observed runtime evidence, not an LLM-generated
guess.

## Initial target

Start with modern web applications.

Prioritize an extremely strong experience for one stack before claiming broad
support.

A likely initial stack is:

- TypeScript / Node.js
- Playwright
- OpenTelemetry
- common HTTP frameworks
- PostgreSQL
- Redis

Python support may follow after the core experience is excellent.

## Success characteristics

Optimize for:

- useful result in under 60 seconds from installation,
- minimal or zero instrumentation configuration,
- excellent visual output,
- deterministic tracing,
- easy local installation,
- privacy,
- reproducible demo applications,
- excellent documentation,
- a compelling animated demo / screenshot,
- stable releases.

## Product evolution

The exact implementation and feature roadmap are not fixed.

The autonomous team may change architecture, priorities, UI and supported
stacks when real evidence supports the decision.

Large product-direction changes must be documented in PRODUCT.md with the
evidence and reasoning.

Do not drift into an unrelated product category merely because implementation
is easier.
