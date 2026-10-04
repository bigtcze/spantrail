# Autonomous State

Project phase: controlled prototype

Current milestone:
Controlled browser-to-Node correlation, explicit compiled-TypeScript source
attribution, local artifact viewer, Express validation, reusable CommonJS capture,
and narrowly scoped programmatic Chromium browser-context capture. The v1.0
Definition of Done remains unsatisfied. This is not a public package or broad
framework-support claim.

Repository status:
This cycle began clean on `feat/scoped-browser-capture` at `262e447`, synchronized
with main after PR #6 had already merged. Main CI `37220098988` passed; there were
no open issues or pull requests. All implementation, tests, documentation, and
mutable autonomous-file changes below belong to this engineering cycle, not
pre-existing or user-owned work. Implementation commit `b35e4e9` was pushed and
PR #7 opened: https://github.com/bigtcze/spantrail/pull/7. Push CI `37225588387`
and PR CI `37225609117` both passed the fresh-install, Chromium, and full test
gate. This publication record is a documentation-only follow-up. The independently
reviewed PR remains open; the v1.0 mission is not complete.

## Changes in this cycle

- Added `createBrowserCaptureContext(browser, options)` and
  `installBrowserCapture(context, {origin, endpoint})`. The Chromium context blocks
  service workers; installation must finish before pages are created.
- Ordinary application fetch calls need no app-side trace-context code. Trusted
  top-frame click dispatch, including observed Chromium dispatch-time microtasks,
  creates one action ID pair per eligible event and injects it only to one exact
  configured loopback endpoint. Timers, pending-await work, synthetic events,
  frames, other URLs, and pre-existing trace contexts bypass injection.
- Selected fetches reject redirects, including same-origin redirects, rather than
  allowing generated headers to leak to redirect destinations. The ID-only
  collector validates publishers and payloads, copies records, and fails closed
  above 100 actions or after observed publication failure. It is not a malicious
  page authenticity boundary.
- Preserved Request bodies, header replacement semantics, one-shot header
  iterators, inherited/non-enumerable RequestInit fields, and getter receivers on
  both selected and bypass paths. Disposal is memoized, disables existing hooks,
  removes future hooks, preserves later application wrappers, and reports failure.
- Added eight focused real-Chromium boundary tests. Reworked the existing integrated
  capture browser test to observe ordinary fetches, actual backend parentage,
  unrelated request isolation, and a fresh temporary artifact in the unchanged
  viewer, retaining exporter privacy checks.
- Updated README, proof documentation, and PRODUCT with programmatic usage and
  explicit limitations. FLOW and LEARNINGS record observed wrapper-semantics and
  bounded delegated-QA lessons. GUARDRAILS and host/controller configuration are
  unchanged; no dependencies or UI files changed.

## Verification

The orchestrator ran the final full `npm test`: 65 existing unit tests, four
Express tests, and 20 capture tests passed (89 total). Both legacy artifacts were
freshly generated, and both viewer Chromium E2E gates passed. The capture browser
test also generated its own temporary artifact and exercised the actual viewer.
Independent oracle review reproduced body/header/dictionary regressions despite
prior green suites; fixes and concrete browser/server assertions now cover them.
Its final review passed all nine focused browser tests and independently verified
the prior inherited/non-enumerable, window-capture, and single-use-iterator
counterexamples. `git diff --check` passed. No known test regression or blocking
review finding remains within the documented narrow scope.

Immediate next action:
Inspect the latest checks on PR #7 and merge the independently reviewed work if
all remain green, before unrelated work. Next prioritize a bounded end-user
command workflow connecting CommonJS capture, browser-context capture, readiness,
and artifact inspection, or another open v1.0 gate. This remains groundwork, not
`npx spantrail -- npm run dev` or the five-minute unfamiliar-user gate.

Known blockers:
None.

Known scope limits:
Chromium-only programmatic capture, top-frame active trusted-click dispatch and
fetch-only to one configured endpoint. No XHR/navigation capture, generic async
causality, overlapping-action proof, cross-origin/redirect attribution, database
tracing, automatic function/source capture, public package/CLI, or broad framework
support. Application spans require explicit OpenTelemetry calls. Readiness and
application completion are caller-managed. Install, flush/actions, and disposal
must be sequential; callers await requests and publication before navigating or
closing capturing pages. Pending-publication navigation and concurrent lifecycle
operations have no completion guarantee. Failed cleanup requires closing the
context. Selected redirects and blocked service workers change app behavior.
Unmatched action IDs must not be passed to the viewer parser as complete trails;
the browser collector records IDs, not completed spans or DOM/source/body content.
CommonJS capture remains `.cjs`-only; app stdout/stderr are raw. The 1,000 completed
span limit is not a bound on raw SDK collection, in-flight spans, or total heap.
SDK shutdown is cooperative and does not guarantee draining or descendant
containment after escalation, parent SIGKILL, or OS failure. The viewer is a
read-only snapshot. General source-map authenticity/containment, performance,
full-stack/database golden scenarios, distribution, and v1.0 completion remain
unestablished.
