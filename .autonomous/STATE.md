# Autonomous State

Project phase: controlled prototype

Current milestone:
Controlled browser-to-Node correlation, explicit compiled-TypeScript source
attribution, local artifact viewer, Express validation, reusable CommonJS capture,
scoped programmatic Chromium capture, and an experimental repo-local capture
command. The v1.0 Definition of Done remains unsatisfied. This is not a public
package or broad framework-support claim.

Repository status:
This cycle began clean on `feat/scoped-browser-capture` at `6b34c66`. PR #7's
latest push and PR checks were green (`37225732643`, `37225736469`); its prior
independent review was recorded in STATE. Merged PR #7 as `03c13c5`, then created
`feat/capture-command` from synchronized main. Main CI `37239605572` passed.
There were no open issues, unrelated open PRs, or releases. All new implementation,
tests, and documentation below are this cycle's work. Publication and remote CI
will be recorded after pushing the coherent implementation commit.

## Changes in this cycle

- Added `npm run capture -- ...` with an existing `.cjs` entry, explicit loopback
  page/endpoint URLs, CSS click/completion selectors, expected text, and a new
  artifact path. Help, bounded decimal timeouts, optional headed Chromium, and
  artifact-only `--no-viewer` mode are supported.
- Validates inputs and output preflight before starting the app. Waits for page
  availability, installs the existing scoped capture before creating a page,
  rejects an already-complete marker, and performs one automated trusted click.
  Awaits the matching response's completion and exact changed UI text, verifies
  trace headers and an observed SERVER parent, then validates sanitized ended-span
  evidence for that action only.
- Stops the app/browser before exclusive mode-0600 publication. Requires positive
  SDK shutdown acknowledgement separately from observed child exit. Existing
  outputs are not overwritten; unsuccessful capture produces no new artifact.
  Default mode serves the unchanged viewer on an ephemeral loopback port; normal
  viewer interruption preserves the published artifact.
- Owns terminal signals rather than letting Playwright exit the command before app
  cleanup. Bounds action/response/disposal waits, clears timeout timers, attempts
  remaining cleanup after failures, and emits stage-only command diagnostics.
- Added three parser tests and eleven real-CLI scenarios with temporary apps,
  actual Chromium viewer inspection, parentage/isolation, output protection,
  stale completion rejection, readiness and active-request interruption, stalled
  page publication, SDK shutdown rejection, existing trace-context rejection,
  unfinished response rejection, and timely artifact-only success.
- Updated README, proof documentation, PRODUCT, FLOW, and LEARNINGS with usage,
  explicit limitations, unconfounded boundary checks, and active-browser signal
  ownership. No dependencies, UI files, capture-session/browser APIs, GUARDRAILS,
  or controller/host settings changed.

## Verification

The orchestrator ran the final full `npm test`: 65 existing unit tests, four
Express tests, and 34 capture tests passed (103 total). Both legacy artifacts
were freshly generated and both viewer Chromium E2E gates passed. The new CLI
viewer scenario generates its own temporary artifact and inspects actual span
evidence in Chromium. `npm run capture -- --help` and `git diff --check` passed.

Independent oracle review first reproduced an active-SIGINT app orphan, stalled
page waits, publication after SDK shutdown rejection, and a retained timeout timer
despite an earlier green full gate. Those findings were fixed with concrete
runtime regressions. Final independent review passed all 14 focused assertions
and reran active/stalled SIGINT, busy-page/microtask, negative acknowledgement,
artifact permissions/preservation, port closure, and prompt-success probes.
No blocking review finding or known regression remains in the documented scope.
After review, the response-header wait was made interruptible and the final full
gate was rerun successfully. Navigation/click cancellation may still wait for
the configured operation timeout; this is documented, not hard containment.

Immediate next action:
Inspect the capture-command PR's fresh-install CI and merge independently reviewed
work only while green. Then prioritize the next v1.0 gap: a deterministic
application/database/cache/outbound-service reference flow or minimal validated
framework execution/source capture. Avoid claiming public installation or the
five-minute unfamiliar-user gate from this repo-local configured command.

Known blockers:
None.

Known scope limits:
The command automates one configured top-frame click in Chromium; it does not
record manual browsing or wrap arbitrary `npm run dev` commands. HTTP loopback
`.cjs` app only, exact eligible fetch endpoint, literal CSS selectors and changed
completion text. Readiness establishes availability, not app identity. Capture
blocks service workers and rejects selected redirects, changing app behavior.
Application spans require explicit OpenTelemetry calls and report unknown source.
Evidence contains spans ended at snapshot time; later-ending or unfinished work
is not guaranteed even after positive SDK shutdown. No generic async causality,
XHR/navigation, overlapping-action proof, ESM, database tracing, automatic function
capture, general source mapping, or broad framework support.

App stdout/stderr remain raw. App/page outbound traffic is not sandboxed; existing
capture privacy tests establish no default exporter traffic, not restriction of
the app's own network behavior. The completed-span limit is not a total heap bound.
Shutdown is cooperative and cannot guarantee descendants, drain, or containment
after parent SIGKILL/OS failure. Browser acquisition waits for owned promises;
operation timeouts are not a whole-command deadline. The viewer is a read-only
snapshot. Distribution, full-stack/database golden scenarios, performance,
unfamiliar-user onboarding, and v1.0 completion remain unestablished.
