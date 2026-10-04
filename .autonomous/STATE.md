# Autonomous State

Project phase: controlled prototype

Current milestone:
Controlled browser action -> Node.js HTTP -> asynchronous service correlation,
explicit compiled-TypeScript source attribution, local artifact viewer, and a
single-command controlled demo are verified together. The v1.0 Definition of Done
is not satisfied; this remains a controlled fixture, not application integration.

Repository status:
This cycle began clean on `feat/controlled-demo` at `ad157f9`. The original demo
implementation PR #4 passed CI at its published head; a follow-up regression fix
is now in the local tracked patch and remains pending publication, current-head CI,
and merge. Do not treat it as merged. Original-head push run `37188453440` and
PR run `37188455979` passed; they are not evidence for the follow-up patch.
No open issues or other PRs were found. No known blockers.

## Changes in this cycle

- Recorded a cold Linux amd64 Debian 12 / Node 24 setup observation from a pinned
  `node:24-bookworm` image (`node@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4`), with a fresh source archive plus tracked patch and no host dependency/browser caches.
- The full gate passed cold: 65 tests, fresh proof generation, and integrated viewer
  Chromium E2E. A separate awaited production viewer inspection verified two
  actions, the `/api/action` -> service -> after-await source chain and exact
  `service.cts:25:20` attribution; switching to action 2 showed unknown source.
- Sequential setup measured `npm ci` at 1.589s, `npx playwright install
  --with-deps chromium` at 23.561s, and demo launch through awaited browser
  inspection at 2.288s. Start-to-inspection total was 27.531s, including browser
  close. This scoped machine observation excludes image/source provisioning,
  preinstalled Node/npm, and a human manually opening the URL; setup downloads
  depend on network. It is not a benchmark or evidence for the five-minute human
  unfamiliar-developer v1 gate. A plain-install missing `libnspr4.so` probe was
  resolved by the documented `--with-deps` installation fallback.
- The follow-up cleanup-first regression previously failed with intent 130 rather
  than 1; it now passes. Cleanup exceptions notify `onFailure` immediately while
  preserving `AggregateError` and signal/operation-first exit-intent order.
  Independent review of the original PR found no blockers (36 focused / 64 all);
  follow-up review found no blockers (31 focused), with added falsy-rejection and
  observer assertions.
- README and viewer guide clarify that users open the printed URL manually.
  FLOW/LEARNINGS now require timestamped sequential measurement harnesses, awaited
   decisive assertions, saved raw logs/machine timings, and environment snapshots.
   Guardrails, host configuration, authentication, and controller remain unchanged.

## Verification

Cold image: Debian 12 bookworm, Node `v24.21.0`, npm `11.19.0`, Playwright
Chromium `153.0.8010.12`; pinned image digest above.

- `npm test` cold: all 65 tests passed, fresh Chromium tracing proof generated,
  and integrated real-artifact viewer Chromium E2E passed.
- Awaited production viewer probe validated two actions and exact nested
  HTTP/service/after-await evidence/source plus action switching and unknown
  attribution. Child SIGINT cleanup stopped HTTP and released the exact port.
- Final cold demo-child SIGINT exited 130 and released the port; prior QA separately
  verified SIGTERM exit 143 and port release.
- Raw QA logs and probe outputs are retained in `/tmp/opencode` on this machine;
  those ephemeral paths are evidence for this run, not portable repository assets
  or a reproducibility guarantee.

Immediate next action:
Publish the PR #4 follow-up, wait for CI on its exact head, and merge only after it
passes. Then prioritize validating a reusable conventional Node backend
application integration to close the Definition of Done gap; do not claim framework
support before validation.

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
failure. No unconditional descendant containment or five-minute unfamiliar-user
clean-install claim has been established.
