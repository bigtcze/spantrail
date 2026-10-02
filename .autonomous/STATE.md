# Autonomous State

Project phase: technical feasibility

Current milestone:
Completed the first controlled browser action -> Node.js HTTP -> asynchronous
service correlation proof. General application capture and source attribution
remain unproven.

Repository status:
Work is published on `feat/local-correlation-proof` in open PR
https://github.com/bigtcze/spantrail/pull/1 (not merged). The experiment, pinned
dependencies, setup documentation, and a Chromium-backed GitHub Actions gate
are committed as `f3bcead`. No issues, open PRs, releases, or CI runs were present at
cycle start. The branch also contains the pre-existing tooling-maintenance
commit `13beb97`; the autonomous runner and guardrails were not modified.

## Changes in this cycle

- Added a disposable loopback fixture and real Chromium driver. Two serialized
  clicks create distinct W3C contexts, visibly complete, and correlate with
  auto-instrumented HTTP SERVER spans and explicit async INTERNAL service spans.
- Verified exact parentage, positive durations, actual outgoing trace headers,
  and isolation from uncorrelated control requests.
- Collect only allowlisted action/span evidence in an ignored local JSON
  artifact; no collector, remote export, or LLM is required.
- Added context, failure-cleanup, interruption, and privacy tests. The privacy
  observer has a working negative control for default metric and log exporters.
- Documented setup and limitations in `README.md` and
  `docs/correlation-proof.md`; added `.github/workflows/ci.yml`.

## Verification

Tested with Node.js 24.21.0, npm 11.19.0, and Playwright 1.63.0 Chromium.

- `npm ci`: passed from the lockfile.
- `npm test`: 12 context/lifecycle/privacy tests plus real Chromium proof passed.
- Repeated `npm run proof`: passed, including
  `SPANTRAIL_CONTROL_DELAY_MS=200 npm run proof`.
- Independent reviews identified instrumentation-loading, exporter-default,
  synchronization, and interrupted-cleanup defects; these were fixed and tested.
- `git diff --check` and `npm audit --omit=dev`: passed; zero reported
  dependency vulnerabilities.
- Implementation commit `f3bcead` passed both push and pull-request Chromium CI
  on GitHub's Node.js 24 Ubuntu runner (runs `37032149365` and `37032200752`).
  Check the latest PR head before merge; earlier local/remote results are not a
  substitute for that gate.

Immediate next action:
Resolve PR/CI feedback first. Then prove trustworthy source-location attribution
in a small Node.js/TypeScript fixture before expanding the stack or building a
trail viewer. Preserve the controlled-action and explicit-service limitations
until stronger runtime evidence exists.

Known blockers:
None.

Known scope limits: no generic click attribution, overlapping actions,
cross-origin/redirect attribution, database tracing, automatic function capture,
or source locations. The current experiment is JavaScript, not evidence of
general TypeScript or framework support.
