# Non-negotiable Guardrails

These rules may not be weakened by the autonomous agent.

## Safety and system boundaries

- Work inside this repository and project-owned runtime environments.
- Prefer Docker or user-space/project-local tooling for additional dependencies.
- Do not use unrestricted sudo.
- Sudo may only be used for explicitly pre-authorized package-management
  operations needed to install or update development dependencies.
- Do not alter host authentication.
- Do not modify ~/.ssh.
- Do not modify global OpenCode configuration.
- Do not alter systemd services or the autonomous runner.
- Do not inspect unrelated private files.
- Never print, commit or intentionally expose credentials or secrets.

## Git

- No force-push to shared branches.
- No rewriting published history without an exceptional documented reason.
- Never delete the remote repository.
- Keep secrets out of Git history.

## Quality

- Do not disable or weaken tests simply to make them pass.
- Do not falsify benchmarks.
- Do not claim support that has not been tested.
- Do not fabricate user feedback.
- Do not fabricate adoption metrics.

## Community

- No automated spam.
- No fake GitHub stars.
- No automated fake issues, comments, reviews or endorsements.
- No deceptive marketing.
- Do not impersonate humans.

Organic promotion based on a real useful release is allowed.

## Licensing

Only add dependencies and code that can legally be distributed with this
open-source project.

Check license compatibility when uncertain.
