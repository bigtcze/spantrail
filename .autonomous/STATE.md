# Autonomous State

Project phase: controlled prototype

Current milestone:
Controlled browser-to-Node correlation, explicit compiled-TypeScript source
attribution, local artifact viewer, Express validation, reusable CommonJS capture,
scoped programmatic Chromium capture, experimental repo-local capture command, and
a narrow real PostgreSQL integration proof. The v1.0 Definition of Done remains
unsatisfied. This is not a public package or broad framework-support claim.

## Repository and cycle priority

This cycle began on `feat/postgres-capture-proof` at `6c3e2e4` with unfinished
PostgreSQL implementation, tests, dependencies, CI, and documentation already in
the working tree. STATE still described the previous capture-command cycle.
PR #8 was already merged; main CI `37242209477` was green. There were no open PRs,
issues, or releases. The highest-value outcome was to recover, independently
review, repair, verify, and publish this unfinished work rather than add another
integration. Initial files were preserved and completed, not discarded.

## Completed work

- Added pinned `pg` 8.23.1 and PostgreSQL instrumentation 0.74.0 to the reusable
  CommonJS preload, alongside HTTP and explicit app spans. Extracted the runtime
  sanitizer with three tests; recognized PostgreSQL CLIENT spans receive a fixed
  safe display label and unknown source. SQL, parameters, results, credentials,
  attributes, events, and error messages are not serialized.
- Added a real Express/PostgreSQL fixture and `npm run proof:postgres`. Three
  serialized Chromium actions exercise parameterized success with `pg_sleep`, a
  real invalid-integer query failure, and recovery. Assertions establish exact
  browser action -> SERVER -> explicit INTERNAL -> PostgreSQL CLIENT parentage,
  isolated trace IDs, count, duration, status, and action-specific viewer evidence.
- Runs against an owned ephemeral loopback Docker container or an explicit
  dedicated loopback test instance. Supplied URL query delimiters are rejected
  before acquisition, preventing `pg` host/SSL overrides. Supplied instances are
  not removed. The fixture performs SELECT-only queries.
- Requires positive SDK shutdown acknowledgement separately from observed child
  exit, attempts remaining cleanup after failures, and rejects success on cleanup
  errors or exporter attempts/deliveries through shutdown.
- Added six subprocess harness tests covering URL override rejection, ordinary
  success, delayed startup, real aborted HTTP attempts after snapshot collection,
  SDK shutdown rejection/export attempts/cleanup failure, and repeated SIGINT
  during a real active request with PID, closed-port, and owned-container checks.
- Restored the existing `npm test` CI step, which the unfinished change had replaced,
  and retained separate PostgreSQL service/proof/harness gates. Corrected dependency
  licenses and scope/shutdown documentation. FLOW and LEARNINGS record the observed
  false-positive probe and missing-regression-gate lessons.

## Verification and independent review

- Initial real PostgreSQL proof passed, but the active-request harness test failed.
  Independent oracle review found the undefined `.cjs` loader handler and unreachable
  middleware, an artificial parent throw masking an inert child privacy probe,
  URL query-host override, and license/shutdown documentation errors.
- Repairs were verified after removing a redundant stale loader source anchor.
  `node --test experiments/postgres/harness.test.js`: 6/6 passed.
  `npm run proof:postgres`: real Docker PostgreSQL, Chromium, and viewer passed.
- Fresh `npm ci` succeeded, audited 164 packages, and reported zero vulnerabilities.
  Final full `npm test` passed 65 unit tests, four Express tests, and 37 capture
  tests (106 total), regenerated both legacy artifacts, and passed both viewer
  Chromium E2E gates. `git diff --check` passed.
- Final independent oracle accepted the documented narrow integration, reran the
  six harness tests, three sanitizer tests, and real PostgreSQL/browser/viewer proof.
  In-memory mutations removing privacy verdict checks caused both aborted-request
  and shutdown-export probes to succeed, proving their ordinary failures depend
  on the actual checks rather than unrelated injected errors. No blocking finding
  remains within the documented scope.
- Four pre-existing SpanTrail PostgreSQL containers dated before this cycle were
  observed and left untouched. Current harness/review-owned containers were removed;
  the interruption test asserts removal of its uniquely named container.

## Publication

Implementation commit `5c709da` was pushed on `feat/postgres-capture-proof` and
PR #9 opened: https://github.com/bigtcze/spantrail/pull/9.
Push CI `37260206902` and PR CI `37260210081` passed fresh installation, the full
existing test/browser gate, PostgreSQL service integration, and Docker-owned
subprocess harness tests. This publication record is a documentation-only
follow-up. The independently reviewed PR remains open; inspect latest checks
before merging. The autonomous v1.0 mission is not complete.

## Immediate next action

Inspect the PostgreSQL proof PR's CI and merge independently reviewed work only
while green. Then extend the deterministic reference flow with Redis and a
controlled loopback outbound HTTP service, including error/recovery and actual
viewer evidence. This targets the v1.0 functional gate rather than isolated
optional features. Public installation and unfamiliar-developer onboarding remain
unproven.

Known blockers: None.

## Scope limits

This is one CommonJS `pg` integration, not general database/ESM/framework support.
Application spans remain explicit; PostgreSQL source is unknown. The separate
capture CLI has no end-to-end PostgreSQL gate. Raw SQL may exist in OpenTelemetry
span memory before sanitization; the fixed label is not an authenticity boundary
against a malicious app. App output remains raw, app traffic is not sandboxed,
and the completed-span limit is not a total heap bound. SDK acknowledgement and
child exit do not guarantee full trace drain or descendant containment. Snapshot
publication and cooperative cleanup are not hard containment against SIGKILL,
permanently stalled dependencies, or OS failure. The viewer remains read-only.
Redis, the full-stack golden flow, automatic execution/source capture, broader
framework validation, performance, distribution, onboarding, and v1.0 completion
remain unestablished. PROJECT_COMPLETE must not be created.
