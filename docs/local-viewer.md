# Local proof viewer

## Controlled demo

The shortest end-to-end path is `npm run demo`, after installing dependencies and
Playwright Chromium as described in the [README](../README.md). It builds the
compiled TypeScript fixture, runs the existing fresh headless Chromium proof, and
starts the viewer for the resulting artifact. The command prints an ephemeral
loopback URL and command-to-viewer startup duration. Open the URL manually; stop
the viewer with Ctrl+C. It does not install dependencies, open a browser, or
contact external services. `PORT` optionally selects a port from `0` through
`65535`; `PORT=0 npm run demo` requests an ephemeral port. The reported duration
excludes installation and manual URL opening; it is neither a benchmark nor a
general under-60-seconds guarantee. SIGINT/SIGTERM cleanup is tested across build,
proof, and viewer startup; if a browser-launch promise fulfills late, its browser
is disposed when acquired. Shutdown waits only for a bounded time and cannot
guarantee process cleanup after parent SIGKILL, a permanently hung custom
launcher, or OS/process failure. This is cooperative cleanup, not hard process
containment or an unconditional no-orphan guarantee. The local-runtime/no-network
statement does not cover the prior `npm ci` or Playwright browser installation,
which may download packages and browser binaries.

This is a controlled fixture proof followed by a read-only snapshot, not
interactive live tracing or a live stream/timeline. The viewer loads no source
content, external assets, collectors, or LLMs.

## Focused viewer and proof commands

To inspect an existing artifact without regenerating it, run from the repository
root:

```sh
npm run viewer
```

This command defaults to `http://127.0.0.1:4318`; `PORT` can choose another port.
Select an action and then a span to inspect its evidence. Use **Reload artifact**
after regenerating the proof. Stop the server with Ctrl+C. The focused
`npm run proof` command generates a fresh proof artifact; `npm run test:viewer`
runs only the viewer browser gate and consumes
`experiments/correlation/artifacts/proof.json` (run `npm run proof` first if it is
missing or stale).

`npm test` runs the full gate: unit/model/server tests, a fresh real Chromium
correlation proof, then viewer Chromium E2E against that proof artifact.

## Local boundaries and limits

The server binds only to `127.0.0.1` and serves a fixed asset allowlist plus
`/artifact.json`. It reads only the configured artifact, not source files. Request
URLs cannot select a different artifact: query parameters are ignored. No source
content, external assets, collectors, or LLMs are loaded. Host and supplied Origin
must use a loopback name and the actual bound port; no CORS access is granted.

The viewer is read-only and displays a local snapshot, not a live trace stream or
timeline. It consumes the controlled proof's artifact shape, not an arbitrary OTLP
export. Action span IDs are correlation parents, not observed spans; no synthetic
evidence is created. Durations may overlap and are not summed into action latency.
OTel status is not an HTTP response code, and unset does not establish success.

The backend validates and strips the artifact to `{ actions, spans }`:

- String, nonzero, lowercase trace/span IDs and unique action traces/span identities.
- Finite nonnegative durations, supported numeric kinds/statuses, bounded text,
  and mapped source metadata with safe relative paths up to 256 characters.
- At most 100 actions and 1,000 spans, with at most 64 observed levels per trail.
- Complete acyclic action-trace graphs rooted at the corresponding correlation
  parent, with no exported span occupying that parent's identity.
- At most 1 MiB input, read using one buffer capped at 1 MiB + 1 byte, including
  partial reads; overlapping requests share the in-flight read.

Only spans belonging to actions appear in trails. The sanitized artifact retains
unrelated control spans, but their graph completeness/cycles/depth are not checked.
Source locations are displayed only when marked mapped; otherwise attribution is
unknown. Display does not establish source-map authenticity or source-content
integrity. Depth-64 usability is not browser-proven.

## Acceptance evidence

| Test path | Executable evidence |
| --- | --- |
| `experiments/viewer/model.test.js` | Shuffled parent-child evidence, isolated controls, empty input, nonzero/type-safe IDs, graph failures and correlation-ID collisions, depths 63/64 accepted and 65 rejected, source paths at 256/257 characters, count boundaries, and field stripping. |
| `experiments/viewer/server.test.js` | Temporary artifacts independent of ignored proof output; static allowlist, sanitized content, fixed artifact selection despite query parameters, partial/oversized bounded reads and handle closure, GET/HEAD/other methods, bound-port Host/Origin checks, policy headers, and generic missing/malformed errors. |
| `experiments/viewer/e2e.js` | Real proof artifact through the actual server/static page: two actions, exact nested HTTP/service/after-await DOM, selectable name/path/IDs/duration/source evidence, OTel UNSET semantics, unknown HTTP source, and Action 2 selection reset. |
| Same browser gate, adverse cases | Literal HTML-hostile text without execution or injected elements; dropped fields absent from API/DOM; missing/malformed errors and reload recovery; valid empty state; keyboard focus and activation; 375-pixel overflow check; no uncaught page errors; same-origin request observation with an explicitly blocked external-request negative control. |

Browser adverse cases use temporary file-backed artifacts, not test-only server
endpoints. Tests use ephemeral ports and clean up files, browsers, and servers.
