# SpanTrail

SpanTrail is currently a controlled tracing prototype with a local artifact viewer, not a generally supported tracing product. A Chromium browser trail is integrated with an executed compiled TypeScript fixture that reports source locations only at explicit instrumentation calls. Everything runs locally.

## Run the proof

Prerequisites: Node.js 24 (tested with 24.21.0), npm, and the system libraries needed to run Playwright Chromium. From the repository root:

```sh
npm ci
npx playwright install chromium
npm test
npm run proof
```

`npm test` builds the TypeScript fixture, runs unit/lifecycle/source-attribution/viewer tests, generates a fresh real Chromium browser proof, then verifies the viewer in Chromium against that artifact. The source-attribution proof sends actual requests through the traced server and executes compiled fixture code; failure-path source-map cases use disposable copies. `npm run proof` runs the browser experiment and writes its evidence to the ignored path `experiments/correlation/artifacts/proof.json`. The artifact contains compact action/span evidence, not source code, request bodies, or secrets. No collector, LLM, or remote telemetry service is required or contacted.

For Linux CI, install browser system dependencies with `npx playwright install --with-deps chromium` before running the tests. See the [browser correlation proof](docs/correlation-proof.md) and the [source-attribution proof](docs/source-attribution-proof.md) for architecture and limits.

## Inspect the trail

After `npm test` or `npm run proof`, start the viewer:

```sh
npm run viewer
```

Open the printed URL (default `http://127.0.0.1:4318`). Select an action, then a span to inspect its parent-linked execution trail, observed duration, identifiers, and mapped source location or explicit unknown attribution. Unrelated requests stay out of the action trails. Stop with Ctrl+C; use `PORT=4319 npm run viewer` to choose another port.

The viewer is a read-only local snapshot, not a live stream or timeline. It loads no source content and uses no external assets or services. See the [local viewer guide](docs/local-viewer.md) for validation, privacy, and browser acceptance coverage.

## Current scope

The browser evidence covers serialized, same-origin fixture actions and explicitly instrumented asynchronous service work. The separate TypeScript source-attribution fixture verifies locations for explicit `withSourceSpan` calls; it does not establish generic TypeScript or framework support or automatic function capture. The viewer consumes only this controlled proof's artifact shape. Overlapping-action attribution and database tracing are not proven.

The project is MIT-licensed. The pinned TypeScript compiler declares Apache-2.0, `@types/node` and `@jridgewell/trace-mapping` declare MIT, and current OpenTelemetry and Playwright dependencies declare Apache-2.0 licenses; consult package metadata for details.
