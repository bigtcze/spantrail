# SpanTrail

SpanTrail is currently a controlled tracing prototype with a local artifact viewer, not a generally supported tracing product. A Chromium browser trail is integrated with an executed compiled TypeScript fixture that reports source locations only at explicit instrumentation calls. Everything runs locally.

## Quick start: controlled demo

Prerequisites: Node.js 24 (tested with 24.21.0), npm, and the system libraries needed to run Playwright Chromium. Install dependencies and Chromium once from the repository root:

```sh
npm ci
npx playwright install chromium
```

On Linux, if required browser libraries are missing, install them with `npx playwright install --with-deps chromium`. Then run the complete controlled demo:

```sh
npm run demo
```

The command builds the compiled TypeScript fixture, runs the existing fresh headless Chromium proof, and starts the read-only local viewer for its artifact. It prints an ephemeral loopback URL and the command-to-viewer startup duration; open the URL manually and stop the viewer with Ctrl+C. It does not install dependencies, open a browser, or contact external services. `PORT` optionally selects a port from `0` through `65535`; for example, `PORT=0 npm run demo` requests an ephemeral port. Startup duration excludes installation and the time to open the URL manually. It is a measurement of this command run, not a benchmark or a guarantee that the result takes under 60 seconds. SIGINT/SIGTERM cleanup is tested across build, proof, and viewer startup; if a browser-launch promise fulfills late, its browser is disposed when acquired. Shutdown waits only for a bounded time and cannot guarantee process cleanup after parent SIGKILL, a permanently hung custom launcher, or OS/process failure. This is cooperative cleanup, not hard process containment or an unconditional no-orphan guarantee. The local-runtime/no-network statement does not cover the prior `npm ci` or Playwright browser installation, which may download packages and browser binaries.

This is a controlled fixture demonstration, not interactive live tracing: the viewer displays a read-only snapshot of the generated proof, not a live stream or timeline. The proof covers serialized fixture actions and explicit source instrumentation; it does not establish generic TypeScript/framework support, automatic function capture, database tracing, or overlapping-action attribution. The artifact contains compact action/span evidence, not source code, request bodies, or secrets. No collector, LLM, or remote telemetry service is required or contacted.

## Focused proof and viewer workflows

`npm test` builds the fixture, runs unit/lifecycle/source-attribution/viewer tests, generates a fresh real Chromium browser proof, then verifies the viewer in Chromium against that artifact. The source-attribution proof sends actual requests through the traced server and executes compiled fixture code; failure-path source-map cases use disposable copies. To generate only the proof artifact, run `npm run proof`; it writes `experiments/correlation/artifacts/proof.json`.

To view an already-generated artifact without rerunning the proof, run:

```sh
npm run viewer
```

This existing-artifact viewer defaults to `http://127.0.0.1:4318`; `PORT` selects another port. Select an action, then a span to inspect its parent-linked execution trail, observed duration, identifiers, and mapped source location or explicit unknown attribution. Unrelated requests stay out of the action trails.

The viewer loads no source content and uses no external assets or services. See the [browser correlation proof](docs/correlation-proof.md), [source-attribution proof](docs/source-attribution-proof.md), and [local viewer guide](docs/local-viewer.md) for architecture, validation, privacy, and browser acceptance coverage.

## Current scope

The browser evidence covers serialized, same-origin fixture actions and explicitly instrumented asynchronous service work. The separate TypeScript source-attribution fixture verifies locations for explicit `withSourceSpan` calls; it does not establish generic TypeScript or framework support or automatic function capture. The viewer consumes only this controlled proof's artifact shape. Overlapping-action attribution and database tracing are not proven.

The project is MIT-licensed. The pinned TypeScript compiler declares Apache-2.0, `@types/node` and `@jridgewell/trace-mapping` declare MIT, and current OpenTelemetry and Playwright dependencies declare Apache-2.0 licenses; consult package metadata for details.
