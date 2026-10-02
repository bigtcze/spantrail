# Autonomous State

Project phase: technical feasibility

Current milestone:
Controlled browser action -> Node.js HTTP -> asynchronous service correlation
and explicit compiled-TypeScript source attribution are verified together.
The next product milestone is a small local viewer grounded in this evidence.

Repository status:
PR #1 was merged into `main` as `d6e3837`; its main CI run `37033034104` passed.
At this cycle's start there were no open issues or PRs and no failing latest CI.
Existing uncommitted source-attribution work on
`feat/typescript-source-attribution` took priority over new features. It has
been completed, independently reviewed, and verified locally; publication and
remote CI are the remaining end-of-cycle gates.

## Changes in this cycle

- Completed the compiler-owned external source-map fixture and integrated it
  into the real Chromium trail. Executed explicit calls report exact source
  positions, including a nested call after `await`; unexecuted calls emit no span.
- Verified HTTP/span failure then recovery, parentage, trace IDs, and durations.
  Missing, malformed, unmapped, source-less, unsupported-scheme, invalid-version,
  invalid-VLQ, outside-root, and external-caller cases remain source-unknown
  without breaking the application operation or trace hierarchy.
- Independent review reproduced false attribution from unsupported URL schemes
  and permissive map decoders. Added scheme/version/VLQ guards and real compiled
  subprocess regressions; focused follow-up review found no material issues.
- Extended allowlisted diagnostics and local-only telemetry tripwire assertions
  to failure requests. `statusCode` is explicitly documented as the OpenTelemetry
  status enum, not the HTTP response status.
- Updated setup, acceptance-to-test mapping, product limits, and workflow lessons.
  Guardrails, authentication, global configuration, and the runner are unchanged.

## Verification

Tested with Node.js 24.21.0, npm 11.19.0, TypeScript 6.0.3, and Playwright 1.63.0.

- `npm ci` followed by `npm test`: clean lockfile installation and the full
  integrated gate passed without additional setup or install-script approval.
- `npm test`: all 27 context/lifecycle/privacy/source tests and the real Chromium
  proof passed after integrating both fix lanes.
- `SPANTRAIL_CONTROL_DELAY_MS=200 npm run proof`: passed; two browser actions,
  correct source positions, trace hierarchy, and isolated controls.
- Independent QA ran the original integrated proof; independent review identified
  the missing boundaries, and a follow-up review verified the fixes with all 17
  focused source/privacy tests passing.
- `npm audit`: zero vulnerabilities, including development dependencies.
- `git diff --check`: passed.

Immediate next action:
Resolve publication/PR/CI feedback first. Once this proof is integrated, build the
smallest local viewer from the observed artifact before expanding supported
stacks. Keep exact-location, fail-closed, failure/recovery, and privacy gates.

Known blockers:
None.

Known scope limits: no generic click attribution, overlapping-action proof,
cross-origin/redirect attribution, database tracing, automatic function capture,
general TypeScript/framework support, or viewer. Source attribution is only for
explicit calls in the controlled compiled fixture; map authenticity, source
content integrity, and symlink containment are not established.
