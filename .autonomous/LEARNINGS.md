# Autonomous Learning Log

Record process improvements, disproved assumptions and durable lessons here.

Do not turn this into a raw activity log. Only record information that should
change future behaviour.

## 2026-10-02 — Make the correlation evidence path binding

- Native ESM loading of `node:http` did not activate the installed OpenTelemetry
  require hook even after SDK startup. Explicit `createRequire` loading after
  initialization produced real SERVER spans. Keep that order tested; do not
  claim general ESM support from this fixture.
- An in-memory trace exporter alone does not prevent NodeSDK's default metric
  and log exporters. Explicit empty readers/processors and environment isolation
  are required for this experiment. A loopback-only observer now detects both
  default exporters in a negative control and none in the real server.
- Early implementations passed helper or normal-path tests while omitting
  requested runtime assertions. Browser code initially duplicated the tested
  helper; parallel lanes disagreed about an optional DOM element and span kinds.
  FLOW now requires acceptance-to-assertion mapping and integrated verification
  after reconciliation. This was validated by the shared-context browser proof
  and its lifecycle/privacy regression tests, not just unit test summaries.
- Signals during browser cleanup could orphan the child server when listeners
  were removed too early. Keep handlers until all cleanup attempts finish and
  test interruption in a subprocess, including repeated signals.
- A test HTTP observer dropped the URL-overload callback when normalizing to
  options, stalling SDK shutdown. Preserve native request signatures and validate
  observers with a working negative control. Capture diagnostics at failure
  time: arrays interpolated before a wait misleadingly reported no activity.
