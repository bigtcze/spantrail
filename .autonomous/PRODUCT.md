# Product strategy and evidence

Status: controlled prototype; v1.0 incomplete. These are bounded proofs, not general support claims.

## Hypothesis and priority

Local-first tool turns a real web-app interaction into an inspectable runtime trail. Desired demo: start example app → browser opens → meaningful click → real frontend/network/backend/database trail → node reveals source, duration, evidence → short understandable GIF.

Priority: (1) keep controlled correlation proof green; (2) compiled TypeScript attribution, unknown fallback, failure/recovery; (3) real-artifact local viewer and fail-closed validation; (4) measure/reduce setup friction toward controlled one-command demo; (5) then expand technologies. Evidence-based direction changes belong here.

## Established evidence and exact limits

**Legacy correlation/source proof.** Chromium fixture correlates two serialized button actions with real auto-instrumented Node HTTP spans and explicit async service spans; asserts parent/trace IDs, headers, duration and visible completion. Separate executed compiled TypeScript fixture maps explicit `withSourceSpan`, including nested-after-await, and tests failure/recovery. Accepts only controlled fixture compiler-owned external source map and project-relative source location; no generic TS/framework/function auto-capture. Overlapping actions, cross-origin requests and redirects are unproven for this legacy proof. [Proof](../docs/correlation-proof.md)

**Viewer.** Real artifact: action selection, parent-linked backend trees, durations, IDs, mapped positions and unknown attribution. Chromium gate tests isolation, evidence details, switching, hostile text, empty/error states and reload recovery. Loopback, read-only snapshot; no source content or external assets. Not live capture or timeline; action roots have IDs, not observed spans. [Guide](../docs/local-viewer.md)

**Express fixture.** Express 5.2.1 (MIT), Node 24.21.0: CommonJS preload HTTP tracing, two serialized browser actions, mapped TS spans, explicit app spans with unknown source, promise rejection/recovery, hostile-OTEL privacy, fail-closed completed-span overflow, viewer on both artifacts. Narrow integration only: fixture-hardcoded route/name allowlists and app-imported snapshot/shutdown support; not conventional-framework v1 gate, arbitrary CLI apps, ESM or route/layer/function capture. [Proof](../docs/correlation-proof.md)

**CommonJS session.** Reusable local session for temporary app processes, absolute `.cjs` entry; readiness caller-owned. Removes fixture-specific route/name allowlists and app-imported snapshot/shutdown plumbing. Preload auto-instruments Node HTTP and PostgreSQL `pg` if required before app load, plus explicit OTel app spans. Redacts names/paths and reports unknown source. The fixed PostgreSQL CLIENT label is a sanitized display classification, not an authenticity boundary against a malicious app. Sanitization omits SQL, parameters, credentials/results/errors, but raw attributes such as `db.query.text` may exist in memory first. [Proof](../docs/correlation-proof.md#local-commonjs-session-proof)

**Repo-local `npm run capture`.** Experimental, not published npm wrapper/generic CLI. Requires existing `.cjs` app, Node 24, npm dependencies, Chromium. Command composes CommonJS session, configured Chromium click, artifact validation/publication and viewer; app must explicitly instrument OTel spans. Readiness and exact completion text required. Snapshot includes spans ended at snapshot time, not later-ending work. Stage timeout and output bounds apply. Not five-minute gate. [Proof](../docs/correlation-proof.md#repo-local-capture-command)

**Programmatic browser capture.** Chromium context blocks service workers; install before pages. Trusted top-frame click dispatch (including Chromium-resolved-promise microtasks) publishes action IDs to exact configured loopback fetch endpoint. Timers, pending-await continuations, synthetic/frame/background requests bypass. Fetch-only, `redirect: 'error'`; preexisting trace header bypasses injection; fail-closed 100-action ID-only bound. Not CLI, app instrumentation or malicious-page authenticity. Await actions/requests and join IDs to actual backend spans; unmatched rejected. Sequential install/flush/dispose; failed cleanup requires context close. Successful checkout uses existing viewer; no error-artifact/broader-support proof. [Browser proof](../docs/correlation-proof.md#programmatic-browser-context-capture)

**PostgreSQL proof.** `npm run proof:postgres`: PostgreSQL 18.6-bookworm, `pg` 8.23.1, `@opentelemetry/instrumentation-pg` 0.74.0; CommonJS, SELECT-only, separate from `npm test`. Ephemeral loopback Docker or dedicated loopback `SPANTRAIL_POSTGRES_URL`, no query parameters. Chromium success/query-failure/recovery; exact SERVER → explicit INTERNAL → PostgreSQL CLIENT parentage, unknown source, real `pg_sleep` duration, privacy-filtered evidence and unchanged viewer. Positive SDK shutdown acknowledgement and observed child exit required; cleanup errors reject success. Not general PostgreSQL/framework support; no end-to-end PostgreSQL capture-CLI gate. [Proof](../docs/correlation-proof.md#postgresql-186-commonjs-integration-proof)

## Shared limits

Where relevant: app output remains raw; app traffic is not sandboxed. Sanitization is not collection prevention; completed-span limits are not total heap bounds. SDK acknowledgement and child exit do not guarantee full trace drain or descendant containment. Snapshot publication and cooperative cleanup are not hard containment against SIGKILL, permanently stalled dependencies or OS failure.

## Unproven boundaries

Automatic execution/source capture, broader framework validation, ESM, Redis, full-stack reference flow, performance, distribution, onboarding and v1.0 completion remain unproven. Cold setup is one observation, not the five-minute gate, benchmark or comparative advantage; AppMap and Jaeger are reference points only. Do not broaden claims from recommendations. Detailed next scenarios live in STATE.
