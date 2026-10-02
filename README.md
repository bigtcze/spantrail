# SpanTrail

SpanTrail is currently a bootstrap experiment, not a generally supported tracing product. Its first verified browser-to-backend proof checks whether a deliberately controlled Chromium action can be correlated with Node.js HTTP and application spans, entirely on the local machine.

## Run the proof

Prerequisites: Node.js 24 (tested with 24.21.0), npm, and the system libraries needed to run Playwright Chromium. From the repository root:

```sh
npm ci
npx playwright install chromium
npm test
npm run proof
```

`npm test` runs unit/lifecycle tests and the real Chromium browser proof. `npm run proof` runs the experiment and writes its evidence to the ignored path `experiments/correlation/artifacts/proof.json`. This artifact contains compact action/span evidence, not source code, request bodies, or secrets. No collector, LLM, or remote telemetry service is required or contacted.

For Linux CI, install browser system dependencies with `npx playwright install --with-deps chromium` before running the tests. See [the proof documentation](docs/correlation-proof.md) for architecture, detailed limits, and upstream references.

## Current scope

The evidence covers serialized, same-origin fixture actions and explicitly instrumented asynchronous service work. It is not evidence of generic click attribution, framework support, database tracing, source-location capture, or correct attribution for overlapping actions. The experiment is JavaScript; it does not claim TypeScript application support.

The project is MIT-licensed. Its current OpenTelemetry and Playwright dependencies declare Apache-2.0 licenses; consult their package metadata for details.
