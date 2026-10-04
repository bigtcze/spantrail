# Autonomous State

Project phase: controlled prototype

Current milestone:
Controlled browser action -> Node.js HTTP -> asynchronous service correlation,
explicit compiled-TypeScript source attribution, local artifact viewer, and a
single-command controlled demo are verified together. The v1.0 Definition of Done
is not satisfied; this remains a controlled fixture, not application integration.

Repository status:
Cycle began on main at `321e4bc` with incomplete, uncommitted demo work. No open
GitHub issues or pull requests; main CI run `37066371601` passed. Completed demo
implementation `0f4b3eb` is published on `feat/controlled-demo` in open PR
https://github.com/bigtcze/spantrail/pull/4. Its push and pull-request CI passed.
This publication-record commit changes only this state file; check the latest
head gate before merging.

## Changes in this cycle

- Finished `npm run demo`: build the TypeScript fixture, generate a fresh headless
  browser proof, and serve its read-only viewer on an ephemeral loopback URL.
  Prints command-to-viewer startup time, excluding installation and manual opening.
- Added signal-aware cleanup for build, proof, and viewer stages. Build shutdown
  escalates to SIGKILL and reaps the owned child; viewer shutdown closes stalled
  incomplete-header connections. Browser acquisition uses direct Chromium launch,
  retains ownership for late results, and closes each acquired browser once.
- Preserved operation failures, arbitrary/falsy rejection values, cleanup errors,
  and first-observed demo exit intent through later/repeated signals.
- Independent review exposed acquisition/cleanup boundary defects. An attempted
  supervised process-group rewrite introduced regressions and was removed; the
  final implementation provides tested cooperative cleanup, not hard containment.
- Updated quickstart and viewer documentation with timing, installation, snapshot,
  privacy, and cleanup limits. FLOW/LEARNINGS now require concrete dependency
  lifecycle experiments and failing boundary assertions before lifecycle rewrites.
- No dependencies added. Guardrails, controller, runner, host authentication,
  configuration, and security controls are unchanged.

## Verification

Node.js 24.21.0, npm 11.19.0, TypeScript 6.0.3, Playwright 1.63.0 on Linux.

- Independent QA removed only the ignored proof artifact and ran `npm test`:
  64 unit/lifecycle/privacy/source/model/server/demo tests passed, followed by
  fresh Chromium tracing proof generation and real-artifact viewer Chromium E2E.
- Final independent review found no material issue within the cooperative-cleanup
  contract and independently ran 31 focused lifecycle/demo/shutdown tests.
- Added regressions cover acquisition after settlement timeout, exactly-once
  disposal, falsy/non-Error/frozen rejection values, child reaping/listener recovery,
  operation failure followed by cleanup signals, and first signal exit intent.
- Real-browser interruption tests check Chromium, renderer, and fixture PID
  disappearance and released fixture port while the test runner remains alive.
- Manual production-demo Chromium QA inspected two actions and actual linked HTTP,
  service, and after-await source evidence; switching actions reset span selection.
  One observed startup was 1.15 seconds. This is not a clean-install benchmark.
- Follow-up shutdown QA resolved an ambiguous earlier probe: direct CLI and
  npm-launched demo served HTTP 200, exited 130/143 after SIGINT/SIGTERM, stopped
  responding, and allowed rebinding their exact ports. For npm runs, signals went
  to the owned Node demo child, not an assumed signal-forwarding npm wrapper.
- `git diff --check`: passed. Implementation `0f4b3eb` passed GitHub push CI
  run `37188360104` and pull-request CI run `37188373848`, including fresh
  lockfile installation, browser setup, and the full integrated `npm test` gate.

Immediate next action:
Resolve this demo PR/CI first. Then measure documented installation and time to a
useful viewer result on a supported clean environment before broadening support.
Prioritize the v1.0 Definition of Done gaps over optional features. Preserve fresh
artifact, exact-location, fail-closed, failure/recovery, and privacy gates.

Known blockers:
None.

Known scope limits:
No generic click attribution, overlapping-action proof, cross-origin/redirect
attribution, database tracing, automatic function capture, or general
TypeScript/framework support. Viewer is a read-only snapshot, not live capture or
a timeline; it loads no source content. Only action-trace graph completeness,
cycles, and depth are validated; unrelated spans are schema-validated and excluded.
Depth-64 usability is not browser-proven. Source attribution is only for explicit
calls in the compiled fixture; map authenticity, source content integrity, and
symlink containment are not established. Cooperative shutdown does not guarantee
cleanup after parent SIGKILL, permanently hung custom launchers, or OS/process
failure. No unconditional descendant containment or five-minute clean-install
claim has been established.
