# SpanTrail

SpanTrail is currently a controlled tracing prototype with a local artifact viewer, not a generally supported tracing product. A Chromium browser trail is integrated with an executed compiled TypeScript fixture that reports source locations only at explicit instrumentation calls. A separate Express 5.2.1 CommonJS fixture validates preload-based request tracing and local artifact viewing; it is not general application capture or a framework-support claim. Everything runs locally.

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

The command builds the compiled TypeScript fixture, runs the existing fresh headless Chromium proof, and starts the read-only local viewer for its artifact. It prints an ephemeral loopback URL and the command-to-viewer startup duration; open the URL manually and stop the viewer with Ctrl+C. It does not install dependencies, automatically open the viewer in your browser, or contact external services. `PORT` optionally selects a port from `0` through `65535`; for example, `PORT=0 npm run demo` requests an ephemeral port. Startup duration excludes installation and the time to open the URL manually. It is a measurement of this command run, not a benchmark or a guarantee that the result takes under 60 seconds. A scoped cold Linux setup observation and its timing boundaries are recorded in the [local viewer guide](docs/local-viewer.md); it does not establish the five-minute unfamiliar-developer gate. SIGINT/SIGTERM cleanup is tested across build, proof, and viewer startup; if a browser-launch promise fulfills late, its browser is disposed when acquired. Shutdown waits only for a bounded time and cannot guarantee process cleanup after parent SIGKILL, a permanently hung custom launcher, or OS/process failure. This is cooperative cleanup, not hard process containment or an unconditional no-orphan guarantee. The local-runtime/no-network statement does not cover the prior `npm ci` or Playwright browser installation, which may download packages and browser binaries.

This is a controlled fixture demonstration, not interactive live tracing: the viewer displays a read-only snapshot of the generated proof, not a live stream or timeline. The proof covers serialized fixture actions and explicit source instrumentation; it does not establish generic TypeScript/framework support, automatic function capture, database tracing, or overlapping-action attribution. The artifact contains compact action/span evidence, not source code, request bodies, or secrets. No collector, LLM, or remote telemetry service is required or contacted.

## Focused proof and viewer workflows

`npm test` builds the fixtures, runs unit/lifecycle/source-attribution, Express, and capture-session tests, generates both legacy Chromium proof artifacts, and runs the viewer E2E against both. The capture-session gate also verifies its own fresh temporary artifact in the actual viewer. The source-attribution proof sends actual requests through the traced server and executes compiled fixture code; failure-path source-map cases use disposable copies. To generate only the correlation proof artifact, run `npm run proof`; it writes `experiments/correlation/artifacts/proof.json`. For the focused Express reproduction commands and limits, see the [browser correlation proof](docs/correlation-proof.md#express-521-commonjs-integration-proof).

To view an already-generated artifact without rerunning the proof, run:

```sh
npm run viewer
```

This existing-artifact viewer defaults to `http://127.0.0.1:4318`; `PORT` selects another port. Select an action, then a span to inspect its parent-linked execution trail, observed duration, identifiers, and mapped source location or explicit unknown attribution. Unrelated requests stay out of the action trails.

The viewer loads no source content and uses no external assets or services. See the [browser correlation proof](docs/correlation-proof.md), [source-attribution proof](docs/source-attribution-proof.md), and [local viewer guide](docs/local-viewer.md) for architecture, validation, privacy, and browser acceptance coverage.

## Local CommonJS capture session

The focused capture lifecycle gate is `npm run test:capture`. Its reusable entry point and precise privacy, shutdown, and support boundaries are documented in the [CommonJS session proof](docs/correlation-proof.md#local-commonjs-session-proof).

## Current scope

The browser evidence covers serialized, same-origin fixture actions and explicitly instrumented asynchronous service work. The separate TypeScript source-attribution fixture verifies locations for explicit `withSourceSpan` calls; it does not establish generic TypeScript or framework support or automatic function capture. The viewer consumes only this controlled proof's artifact shape. Overlapping-action attribution and database tracing are not proven.

The project is MIT-licensed. The pinned Express dependency declares MIT; TypeScript, OpenTelemetry, and Playwright dependencies declare Apache-2.0, while `@types/node` and `@jridgewell/trace-mapping` declare MIT. Consult package metadata for details.
