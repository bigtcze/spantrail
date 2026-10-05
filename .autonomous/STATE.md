# Autonomous State

Project phase: controlled prototype

Current milestone:
Controlled browser-to-Node correlation, explicit compiled-TypeScript source
attribution, local artifact viewer, Express validation, reusable CommonJS capture,
scoped programmatic Chromium capture, experimental repo-local capture command, and
a narrow real PostgreSQL integration proof. The v1.0 Definition of Done remains
unsatisfied. This is not a public package or broad framework-support claim.

## Repository and cycle priority

This cycle began clean on `feat/postgres-capture-proof` at `632cab6`.
PR #9 had green latest head checks and prior independent acceptance; there were
no issues or releases. Inspected its commits/diff and merged it at `5f8869c`.
Node 24.21.0, npm 11.19.0, gh, Docker, and Chromium were available.

Initial exploration targeted a deterministic PostgreSQL/Redis/HTTP reference flow.
Research confirmed Redis client/instrumentation compatibility and a BSD-licensed
Redis 7.2 patch. However, the post-merge main CI run `37260789118` failed the
existing capture command test. Its setup succeeded; the failure combined header
rejection with an unfinished response and reported cleanup instead of the original
browser-action failure. Resolving that gate took priority. All cycle-created,
unverified reference/dependency/UI prototype changes were removed, npm dependencies
restored with `npm ci`, and the branch renamed `fix/capture-ci-diagnostics`.
No Redis capability or full-reference-flow claim is established by this cycle.

## Completed work

- Made the preexisting-trace-header fixture send its header on the finite,
  awaited-response path instead of depending on an unfinished response. Retained
  the separate unfinished-response regression.
- Preserve the original capture failure stage when later cleanup also fails.
  Cleanup-operation labels are fixed and sanitized; raw exceptions are not exposed,
  cleanup remains fail-closed, and remaining cleanup attempts are retained.
- Added persistent real Chromium disposal-failure tests. The page awaits a server
  marker before rejecting; the dual-failure case also verifies the exact header
  received by the backend. Assertions cover exact sanitized diagnostics, no private
  sentinel/AggregateError text, no artifact publication, dead app PID, and closed port.
- Updated command diagnostics documentation. FLOW and LEARNINGS record the observed
  dependency-handoff failure and post-merge CI priority, not speculative tuning.

## Verification and independent review

- Initial finite-header fix passed five focused repetitions and the capture suite.
- Independent review reproduced the runtime dual-failure case and required a
  persistent assertion; that finding was repaired with reached-boundary probes.
- Final independent oracle accepted the two-file implementation/test diff, reran
  all 12 command tests, and found no blocking issue.
- Final `npm test` passed 65 unit tests, four Express tests, and 38 capture tests
  (107 total), regenerated both legacy artifacts, and passed both viewer Chromium
  E2E gates. No checks were disabled or relaxed.
- `npm run proof:postgres` passed real Docker PostgreSQL, Chromium, and viewer.
  PostgreSQL subprocess harness passed 6/6, including repeated active-request
  interruption and privacy/shutdown probes.
- Fresh `npm ci` audited 164 packages with zero reported vulnerabilities.
  `git diff --check` passed. No reference-proof containers remained.

## Publication

PR #9 is merged. The focused CI repair is ready for commit and publication on
`fix/capture-ci-diagnostics`; inspect its new GitHub checks before merging.
The autonomous v1.0 mission is not complete.

## Immediate next action

Publish and verify the CI repair, restoring main green before unrelated feature
work. Then begin the reference-flow gap with a bounded real Redis SET/GET tracing
proof and exact parentage/error/privacy assertions. Only after that contract passes,
compose PostgreSQL, Redis, and a controlled loopback `http.request` service into
five golden scenarios (success, PostgreSQL error, Redis error, HTTP error, recovery)
with exact sibling-client parentage and viewer evidence. Gate dependency inspection
on installation completion rather than dispatching blocked implementation.

Known blockers: None outside repository work. Main's latest CI is failed pending
publication of the reviewed fix; local gates are green.

## Scope limits

The PostgreSQL proof remains one CommonJS `pg` integration, not general database,
ESM, or framework support. Application spans remain explicit; PostgreSQL source is
unknown. The separate capture CLI has no end-to-end PostgreSQL gate. Raw SQL may
exist in OpenTelemetry span memory before sanitization; the fixed label is not an
authenticity boundary against a malicious app. App output remains raw, app traffic
is not sandboxed, and the completed-span limit is not a total heap bound. SDK
acknowledgement and child exit do not guarantee full trace drain or descendant
containment. Snapshot publication and cooperative cleanup are not hard containment
against SIGKILL, permanently stalled dependencies, or OS failure. Viewer is read-only.
Redis, the full-stack golden flow, automatic execution/source capture, broader
framework validation, performance, distribution, onboarding, and v1.0 completion
remain unestablished. PROJECT_COMPLETE must not be created.
