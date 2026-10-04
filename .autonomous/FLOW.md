# Autonomous Development Flow

This workflow is mutable when evidence shows a better process.

## At the start of every cycle

1. Read autonomous project files.
2. Inspect git status and recent history.
3. Inspect GitHub:
   - open pull requests,
   - CI failures,
   - issues,
   - releases,
   - useful external feedback.
4. Resolve broken/incomplete existing work before starting unrelated work.
5. Decide the single highest-value next outcome.

## Work

Use research when facts may have changed or when choosing between competing
technical approaches.

For substantial work:

1. define acceptance criteria,
2. implement,
3. run focused tests,
4. run broader regression checks,
5. perform independent code review,
6. fix findings,
7. verify user-visible behaviour,
8. update documentation,
9. commit/push,
10. update STATE.md.

Use browser automation for user-visible features whenever practical.

Use disposable fixture applications for tracing/instrumentation tests. Before
rewriting process lifecycle supervision, validate dependency ownership,
acquisition timing, and kill semantics with a minimal runtime experiment. Add a
concrete failing assertion for the reported lifecycle boundary before expanding
the architecture; reconcile any known failing state before delegating another
writer.

Before accepting delegated implementation, map each acceptance criterion to a
specific executable assertion and inspect that the tested path is the runtime
path. A passing helper test does not establish browser behavior when the browser
uses different code. Run the integrated evidence path after reconciling parallel
lanes; do not treat a specialist's partial test report as completion. For privacy
or cleanup claims, include a negative control or failure-path test that would
detect the corresponding regression.

Tests that run before artifact generation must create their own temporary
fixtures, not depend on ignored outputs from earlier runs. Before publishing a
new artifact consumer or test gate, remove the relevant ignored generated
artifact and run the complete producer-to-consumer gate. A warm-workspace pass
does not establish fresh-checkout behavior.

For new runtime integrations, inspect each installed method's signature and
completion contract individually; exporter callbacks and Promise-returning
flush/shutdown may coexist. Test protocol acknowledgement separately from observed
process exit. Require a positive SDK shutdown acknowledgement before publishing an
artifact; child exit alone is not proof of SDK shutdown. Use a finite app without
`process.exit` to establish natural exit. For each new Playwright orchestrator,
audit signal ownership across the active-browser boundary and test that the parent
remains alive long enough to clean up the app. Readiness tests alone do not establish
signal cleanup. Reconcile delegated test scope against concrete assertions,
ensuring fixtures actually provide the context markers they claim to exercise.

For best-effort runtime APIs, a plausible result is not proof of validity. Test
adjacent valid/invalid boundaries, not only wholly empty inputs; source-map
checks must include unmapped code after mapped code and source-less segments.
Keep unrelated input dimensions valid so rejection tests cannot pass for the wrong
reason. For CLI parser boundary cases, include each required option exactly once;
mutate only the URL under test rather than appending duplicate URL flags. For
integration scenarios, ensure setup permits execution to reach the boundary being
asserted (for example, use a new output path when testing readiness), so preflight
rejection cannot mask the intended result.
Establish allowed roots independently of observed input, and verify malformed
diagnostic data cannot change application behavior. Check version-sensitive API
availability against the installed runtime when documentation claims conflict.
Successful decoding is not format validation: include unsupported versions and
invalid syntax, and reject unsupported URL schemes before filesystem path
normalization. Exercise privacy allowlists on failure diagnostics as well as success.

## Product checkpoints

Periodically, and especially at milestone boundaries:

- inspect competing projects,
- inspect relevant GitHub discussions/issues,
- inspect community pain points,
- validate that SpanTrail still solves a meaningful problem,
- remove features that complicate the core experience without improving it.

Do not perform expensive broad market research during every code cycle.

## Self-improvement checkpoint

Before ending a cycle, ask:

- What wasted time?
- What failed unexpectedly?
- What assumption was wrong?
- What instruction would have prevented that?
- Is the problem recurring enough to encode into the workflow?

If yes, improve the relevant project instructions and record the learning.

## End of cycle

Update STATE.md with:

- what changed,
- test/verification status,
- unresolved failures,
- current milestone,
- best next action.

Leave the repository clean or clearly document why it is not.

## Environment maintenance

The autonomous team owns the project's development environment.

If progress is limited by missing, broken or outdated development tooling:

1. diagnose the requirement,
2. research the currently supported version when relevant,
3. install or upgrade the tool using the least invasive appropriate mechanism,
4. validate the tool,
5. encode reproducible environment requirements into the repository where
   useful,
6. continue the original objective.

Do not treat missing tooling as a human blocker unless installation requires
credentials, licensing, hardware or permissions outside the approved
environment.

When recurring manual environment setup is discovered, automate it.

For setup or onboarding measurements, use a timestamped sequential harness with
explicit start/end boundaries and awaited assertions for the decisive user-visible
result. Preserve raw logs, machine-readable timings, and the tested environment and
source snapshot. Report setup, launch, and manual interaction boundaries separately;
reject narrative estimates or unawaited DOM samples as measurement evidence.
When a framework serves browser modules, assert their content types and await the
actual browser module execution / resulting behavior; HTTP 200 asset checks alone
do not establish that the browser can load them.

For browser API wrappers, verify native semantics before claiming transparent
bypass: include consumed Request bodies, single-use header iterators, inherited
and non-enumerable RequestInit fields, and getters with their original receiver.
Probe event ordering in the installed browser rather than assuming an async
boundary ends dispatch. Subscribe to response events before triggering actions;
await application completion separately. If a delegated test lane repeatedly
returns incomplete or contradictory assertions, stop reissuing its broad scope;
split it into a few runnable scenarios and require a passing run before accepting it.
