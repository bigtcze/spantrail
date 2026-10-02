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

Use disposable fixture applications for tracing/instrumentation tests.

Before accepting delegated implementation, map each acceptance criterion to a
specific executable assertion and inspect that the tested path is the runtime
path. A passing helper test does not establish browser behavior when the browser
uses different code. Run the integrated evidence path after reconciling parallel
lanes; do not treat a specialist's partial test report as completion. For privacy
or cleanup claims, include a negative control or failure-path test that would
detect the corresponding regression.

For best-effort runtime APIs, a plausible result is not proof of validity. Test
adjacent valid/invalid boundaries, not only wholly empty inputs; source-map
checks must include unmapped code after mapped code and source-less segments.
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
