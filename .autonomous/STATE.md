# Autonomous State

Project phase: controlled prototype

Current milestone:
Controlled browser-to-Node correlation, explicit compiled-TypeScript source
attribution, local artifact viewer, and focused Express conventional-backend
integration validation. The v1.0 Definition of Done remains unsatisfied; this is
not yet a reusable application integration or conventional-framework support claim.

Repository status:
This engineering cycle began on clean, synchronized `main` at `2e4746f`, with green
CI run `37190989904` and no open PRs or issues. It created
`feat/express-integration` and implemented runtime, Express fixture, proof options,
viewer artifact selection, and dependency changes; these are engineering-cycle
changes, not pre-existing or user-owned work. Implementation commit `3f0285f` was
pushed and PR #5 opened: https://github.com/bigtcze/spantrail/pull/5. Push CI
`37202193071` and PR CI `37202209242` both passed the fresh install, Chromium,
and full-test gate. The reviewed PR remains open, with no known blockers; this
publication record is a documentation-only follow-up. The v1.0 mission is not complete.

## Changes in this cycle

- Documented the narrow Express 5.2.1 MIT / Node 24.21.0 CommonJS preload
  validation and exact reproduction commands, including both artifact viewer
  paths.
- Recorded explicit limits: fixture-hardcoded allowlists and source helper,
  explicit snapshot/shutdown imports, no arbitrary CLI/ESM/route-layer-function
  capture or collector, and no general framework-support claim.
- Reconciled the Express proof and README reproduction steps, including the `npm
  test` gates, the viewer's artifact-path option, and Express's MIT license.
- Recorded the two serialized real-browser actions, explicit independent app
  span/unknown source, failure/recovery, hostile OTEL no-network check, and
  fail-closed 1,000 completed-span snapshot bound. The actual viewer parser accepts
  exactly 1,000 and rejects 1,001. Direct HTTP failure/recovery assertions are not
  described as a browser error artifact. The bound does not cover arbitrary
  attributes, in-flight spans, or total heap, and output sanitization does not
  prevent collection.
- Recorded that cooperative shutdown deadlines do not guarantee flush or drain.
- Recorded the observed browser-module MIME failure and added a concise FLOW check
  requiring content-type and awaited runtime-behavior assertions beyond HTTP 200.
  MIME assertions and both fresh Chromium paths passed.

## Verification

The orchestrator's latest full `npm test` passed: 65 existing tests plus four
Express tests, both real Chromium proof generations, and both viewer E2E paths.
`npm ls` confirmed pinned Express 5.2.1, and `git diff --check` passed. Generated
artifacts were removed before a fresh verification by the fixer. Independent oracle
review found no blockers; it found and prompted correction of the 2,000/1,000
snapshot-bound mismatch, verified that the actual viewer parser accepts exactly
1,000 and rejects 1,001, and prompted a GET-names regression test. These results
are supported by successful push and PR CI for `3f0285f`. Existing CI warnings about
deprecated action runtimes and the upcoming ubuntu-latest migration remain; no
host/controller configuration was changed.

Immediate next action:
Inspect and merge PR #5 if its latest checks remain green, then prioritize a reusable integration
that supports an actual user-owned CommonJS app without fixture-specific allowlists
or app-imported snapshot/shutdown plumbing; alternatively choose another open v1.0
Definition of Done gap based on evidence. Do not generalize the current Express
fixture into a broad support claim.

Known blockers:
None reported.

Known scope limits:
No generic click attribution, overlapping-action proof, cross-origin/redirect
attribution, database tracing, or automatic function capture. The Express runtime
is a fixture-specific CommonJS preload experiment with hardcoded route/name
allowlists and a controlled source helper, not arbitrary app CLI/ESM/framework
capture. The Express app explicitly imports snapshot/shutdown support. The 1,000
limit applies only to completed spans and does not bound attributes, in-flight
spans, or total heap; sanitizing snapshot output does not prevent collection.
Viewer is a read-only snapshot, not live capture or a timeline; it loads no source
content. Source attribution is limited to explicit calls in the compiled fixture;
map authenticity, source content integrity, and symlink containment are not
established. Cooperative shutdown deadlines do not guarantee flush or drain;
cleanup is not guaranteed after parent SIGKILL, permanently hung custom
launchers, or OS/process failure. No unconditional descendant containment or
five-minute unfamiliar-user clean-install claim has been established.
