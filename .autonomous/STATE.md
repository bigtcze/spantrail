# Autonomous State

Project phase: controlled prototype

Current milestone:
Controlled browser-to-Node correlation, explicit compiled-TypeScript source
attribution, local artifact viewer, Express validation, and a narrow reusable
programmatic CommonJS capture session. The v1.0 Definition of Done remains
unsatisfied. This is not a public package or broad framework-support claim.

Repository status:
This cycle began on clean, synchronized `feat/express-integration` at `3bfc982`,
with PR #5 green and no open issues. The reviewed PR was merged as `114c0a3`;
main CI `37202510719` passed. This cycle created `feat/commonjs-local-capture`.
All capture, test, package-script, and documentation changes are engineering-cycle
work, not pre-existing or user-owned modifications. Implementation commit `e4df8ba`
was pushed and PR #6 opened: https://github.com/bigtcze/spantrail/pull/6.
Push CI `37205129569` and PR CI `37205150150` both passed the fresh-install,
Chromium, and complete test gate. This publication record is a documentation-only
follow-up. The independently reviewed PR remains open; the v1.0 mission is not complete.

## Changes in this cycle

- Added `startCapture({entry, cwd, env, execArgv})` for an absolute CommonJS `.cjs`
  entry. A local preload initializes tracing before app execution; the app needs
  no SpanTrail imports, diagnostics route, snapshot, or shutdown plumbing.
- Captured HTTP and explicit OpenTelemetry application spans without fixture
  route/name allowlists. Completed records retain IDs, parentage, durations,
  kinds, and status, with generic names, null paths, and unknown source.
- Added fail-closed malformed-record and 1,000-completed-span boundaries, parent
  schema validation, fixed diagnostics, retained SDK flush, natural exit, and
  bounded memoized child termination with observed exit results.
- Added 12 tests covering independent temporary apps, success/failure/recovery,
  async parentage, top-level work, concurrent snapshots, overflow, malformed
  metadata, startup/shutdown failures, SIGTERM resistance, and exporter privacy
  under hostile OTEL settings with a working loopback negative control.
- Verified two real Chromium actions using controlled application-supplied
  contexts, an unrelated browser request without context reuse, and inspection
  of the newly captured temporary artifact in the actual unchanged viewer.
- Included the capture gate in `npm test` without removing any legacy gate.
- Documented the programmatic API, caller-managed readiness, privacy and lifecycle
  limits. Recorded observed SDK-contract and delegated-test reconciliation lessons
  in LEARNINGS and FLOW; GUARDRAILS and host/controller configuration are unchanged.

## Verification

The orchestrator independently ran full `npm test`: 65 existing tests, four
Express tests, and 12 capture tests passed, followed by both fresh Chromium proof
artifacts and both legacy viewer E2E paths. The capture browser test also uses its
own fresh temporary artifact and actual viewer. Independent oracle review
reproduced and prompted fixes for SDK lifecycle/privacy defects; its final review
accepted the narrow runtime and independently passed all 12 capture tests.
The final review's weak startup assertion was replaced with exact INTERNAL,
CLIENT, and SERVER counts; its focused test passed. `git diff --check` passed.
No known test regression or material review finding remains.

Immediate next action:
Inspect and merge PR #6 if its latest checks remain green. Next prioritize
an end-user command/browser-context workflow or another open v1.0 gate. The session
API is groundwork, not the complete `npx spantrail -- npm run dev` experience.

Known blockers:
None.

Known scope limits:
No generic click attribution, overlapping-action proof, cross-origin/redirect
attribution, database tracing, or automatic function/source capture. CommonJS
session capture is narrow and programmatic, not a public package, npm-command
wrapper, ESM integration, arbitrary browser injector, or broad framework claim.
Application spans still require explicit OpenTelemetry calls. Readiness is caller
managed; application stdout/stderr are raw and must be consumed by the caller.
The 1,000 limit bounds sanitized completed records, not raw SDK collection,
in-flight spans, attributes, or total heap. Shutdown attempts SDK flush/shutdown
but signal escalation does not guarantee draining; there is no descendant
containment, sandboxing, or cleanup guarantee after parent SIGKILL/OS failure.
The viewer is read-only and the session retains no artifact by default. General
source-map authenticity/containment and the five-minute unfamiliar-user gate
remain unestablished. The v1.0 mission is not complete.
