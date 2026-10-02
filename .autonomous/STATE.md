# Autonomous State

Project phase: controlled prototype

Current milestone:
Controlled browser action -> Node.js HTTP -> asynchronous service correlation,
explicit compiled-TypeScript source attribution, and a local artifact viewer
are verified together. The next milestone is lower-friction controlled-demo setup.

Repository status:
At cycle start, the worktree was clean, no issues were open, and PR #2's latest
push/pull-request checks were green with no feedback outstanding. Integrated
the independently reviewed source-attribution work by merging PR #2 as `a7299b8`;
main CI run `37048994770` passed. Viewer work is on
`feat/local-artifact-viewer`; publication details will be recorded after pushing.

## Changes in this cycle

- Built a read-only local viewer for the actual proof artifact: action selector,
  parent-linked backend span tree, and selectable duration/ID/source evidence.
  Mapped positions and unknown attribution are explicit; correlation action roots
  are IDs only, not synthetic observed spans. OTel unset is not labeled success.
- Added a loopback-only static server with fixed routes, no source-file reads,
  no external assets/services, CSP, exact loopback authority checks, sanitized
  artifact responses, and generic missing/malformed errors.
- Added shared browser/backend validation and action-trace graph bounds. Reads
  use one bounded buffer, handle partial reads, and share concurrent work.
- Added a real-artifact Chromium viewer gate to `npm test`, including parent DOM
  hierarchy, source/evidence details, action reset, hostile text, dropped fields,
  error/retry, empty state, keyboard/mobile behavior, and a network negative control.
- Independent review found stale-artifact-dependent tests, late size checking,
  parser/builder depth disagreement, identity collisions, zero/type-coerced IDs,
  and unbounded source metadata. Fixed the findings with executable regressions;
  follow-up independent review found no material residual issues.
- Updated scope/setup documentation and encoded clean-start artifact verification
  in FLOW with observed lessons. No dependencies were added. Guardrails, host
  authentication/configuration, controller, and runner are unchanged.

## Verification

Tested with Node.js 24.21.0, npm 11.19.0, TypeScript 6.0.3, and Playwright 1.63.0.

- Removed the ignored `proof.json`, then ran `npm test`: all 37
  context/lifecycle/privacy/source/model/server tests passed before a fresh tracing
  proof and integrated viewer Chromium E2E passed. Existing gates remain green.
- Independent QA implemented and ran the runtime browser assertions. Follow-up
  review independently ran all 10 focused viewer tests and viewer Chromium E2E.
- Independent diagnostics checked exact 1 MiB / 1 MiB + 1 byte reads and verified
  20 overlapping requests used one artifact read, with later reload reading afresh.
- Model regressions cover depths 63/64/65, identity collisions, consistent zero
  and non-string IDs, count limits, and adjacent source-path bounds.
- Viewer CLI served the real two-action artifact and exited cleanly on SIGTERM;
  the final 10 focused viewer tests passed after documentation/copy cleanup.
- `git diff --check`: passed. Latest viewer branch CI will be checked on publication.

Immediate next action:
Resolve viewer PR/CI feedback and integrate it first. Then measure installation
and time to the controlled viewer result; reduce the proof-plus-viewer command
friction before expanding supported stacks. Keep clean-start, exact-location,
fail-closed, failure/recovery, and privacy gates.

Known blockers:
None.

Known scope limits: no generic click attribution, overlapping-action proof,
cross-origin/redirect attribution, database tracing, automatic function capture,
or general TypeScript/framework support. Viewer is a read-only snapshot of the
controlled artifact, not live capture or a timeline; it loads no source content.
Only action-trace graph completeness/cycles/depth are validated; unrelated spans
are schema-validated and excluded. Depth-64 usability is not browser-proven.
Source attribution is only for explicit calls in the controlled compiled fixture;
map authenticity, source content integrity, and symlink containment are not established.
