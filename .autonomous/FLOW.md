# Development flow

Follow AGENTS authority and LEARNINGS' concrete runtime/test controls; avoid duplicating their detail.

## Cycle

1. Inspect repository/Git status and history, issues, PRs, CI, releases, feedback and tools. Resolve broken/incomplete existing work before unrelated work; post-merge main failures take priority over unrelated work or publishing.
2. Select one highest-value DoD gap. Research acceptance and uncertain facts. Reconcile dependency installation before API-dependent implementation. Use the configured Oh My OpenAgent Slim orchestrator and available specialists where they improve research, implementation, review or QA; reconcile delegated lanes before integration.
3. Create/use a feature branch before implementation or commits intended for upstream. Map acceptance to actual-runtime assertions. Implement one outcome; run focused then broader checks, preserving existing gates. For CI gate additions, compare prior and proposed workflow steps to retain every existing check. Browser-test user-visible behavior.
4. Integrate only after parallel/dependency lanes are reconciled; verify integrated evidence, independently review, fix findings, validate user-visible behavior and update docs. Before publication, update STATE and affected docs with accurate facts, verification status, failures, milestone and next action.
5. Commit/push the feature branch and use a PR for every change reaching main, including docs. Never commit/push directly to main or force-push shared branches. Review all PR commits and complete diff; merge only with latest-head CI green, then verify post-merge main CI.
6. Record post-merge facts in a separate feature branch and PR or a later cycle; never leave an uncommitted final update or commit directly to main.

## Periodic checkpoints

At milestone boundaries, review competitors, discussions/issues and community pain; validate product value and remove harmful complexity. Avoid expensive market research every cycle. Use the AGENTS self-improvement checkpoint only for observed problems.

## Tooling and evidence

Tool choice, compatibility, validation and setup automation are governed by AGENTS. Consult LEARNINGS for measurement and browser-module evidence rules.
