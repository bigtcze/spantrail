# SpanTrail autonomous engineering

Act autonomously: research, decide, implement, test, review, document and maintain without routine questions. Prefer one highest-value, small, verified, reversible outcome. Preserve repository health and accurate claims; independently test/review, repair regressions, and never hide failures or weaken gates.

## Authority and context

Read in order: `AGENTS.md`, `.autonomous/GUARDRAILS.md`, `CHARTER.md`, `PRODUCT.md`, `DEFINITION_OF_DONE.md`, `FLOW.md`, `STATE.md`, `LEARNINGS.md` (prefix latter paths with `.autonomous/`). Then use `CYCLE_PROMPT.md` as bootstrap. Explicit task bounds and immutable safety prevail; DoD controls acceptance. PRODUCT owns strategy/evidence, STATE current facts/roadmap, FLOW procedure, LEARNINGS durable lessons. Avoid duplication. Never weaken OR CIRCUMVENT GUARDRAILS.

## Safety, tools and improvement

Follow GUARDRAILS. In addition, do not configure or change host OpenCode permissions or authentication, or weaken host security controls. Do not autonomously upgrade, replace or reconfigure OpenCode, Oh My OpenAgent Slim, global OpenCode configuration, OpenCode authentication, SpanTrail systemd service or `autonomous-loop.sh`; record a broken/outdated controller/runner proposal and reason in STATE, do not execute it. Record other prohibited self-modification proposals in LEARNINGS, do not execute them.

For needed tools, verify need, supported version and compatibility; prefer project-local, then user-local, then approved OS package mechanism. Managers include npm/npx, pnpm, yarn, bun, pip/pipx/uv, cargo, `go install`, corepack. You may install, update and configure required development tools within the safety boundaries; install/upgrade missing, broken, incompatible or materially outdated tools, verify, then resume the original task. Verify version, rerun the task and document durable requirements; do not reinstall working tools or stop for ordinary missing tools. Automate recurring manual setup in repository tooling.

When evidence shows recurring mistakes/waste, missing instructions or tests/tooling, better workflow or disproved assumption, make the smallest useful allowed self-improvement: AGENTS, PRODUCT, FLOW, STATE, LEARNINGS, CYCLE_PROMPT, repository scripts/tests/developer tooling. Observe → change → verify → record reason/effect in LEARNINGS → branch+PR unless task bounds prohibit git operations. No speculative tuning.

## Product and mission

Do not ask routine questions; research and decide. Escalate only unavailable credentials, legal decisions, manual external-account verification, irreversible permissions outside the repo, or another genuinely unavailable external resource (for example, required licensing or hardware) that cannot reasonably be obtained within the approved environment; record blocker in STATE and investigate alternatives. Privacy requirements are canonical in DoD.

DoD is the complete acceptance and completion contract; prioritize its gaps over optional features and follow its exact completion/stop procedure.

## Git

Never commit directly on `main`, never push directly to `main`; every change reaching `main` must go through a PR. Never force-push shared branches. Follow FLOW for repository/issue/PR/CI/release inspection, branch sequencing and independent review. Preserve checks; never merge known-broken work. Explicit task bounds may prohibit git operations and take precedence.
