# Autonomous Learning Log

Record process improvements, disproved assumptions and durable lessons here.

Do not turn this into a raw activity log. Only record information that should
change future behaviour.

## 2026-10-05 — Failure probes must fail for the real guard

- Recovery of unfinished PostgreSQL work found an active-request probe that crashed
  because Node 24 had no `.cjs` extension handler, then inserted middleware inside
  a route where it could not execute. A privacy probe passed by injecting a parent
  throw while its child watched the wrong IPC direction. Repairs exercise the real
  route and a real aborted HTTP attempt observed after snapshot collection. Final
  independent in-memory mutations removed privacy verdict checks and made both
  aborted-request and shutdown-export probes succeed, showing that the ordinary
  failures depend on those checks. FLOW now requires reached-boundary evidence and
  a focused guard-removal control when an injected failure could mask the claim.
- The unfinished CI change replaced `npm test` instead of adding the database gate.
  Restoring it and comparing old/new workflow steps preserved the existing 106-test
  and browser evidence path. FLOW now requires this comparison for gate additions.
- A loopback URL authority does not establish the destination used by `pg`: query
  parameters can override the host or trigger SSL-file handling. The narrow proof
  rejects all query delimiters before acquisition; four otherwise-valid loopback
  rejection cases now exercise this boundary without connecting or printing the
  supplied credentials. Validate the effective library configuration, or restrict
  its unsupported override syntax, rather than trusting URL authority alone.

## 2026-10-05 — Keep capture CLI boundary checks unconfounded

- During the capture-command test cycle, URL parser cases appended replacement
  flags without removing the original, so duplicate-option rejection masked every
  intended URL-boundary assertion. A combined integration scenario also used an
  already-existing output path, causing preflight rejection before its readiness
  signal could be exercised. FLOW now calls out these concrete CLI patterns:
  keep one instance of each required option, vary only the boundary under test,
  and satisfy preflight conditions unrelated to the scenario. This prevents false
  confidence from tests that never reach the intended code path.

## 2026-10-05 — Regressions need lifecycle boundary assertions

- Despite a green nine-test browser lane and 98-test full gate, an oracle reproduced
  active SIGINT orphaning the app, an unbounded `page.evaluate` hook wait, a retained
  10-second race timer, and stop resolving despite a negative SDK shutdown
  acknowledgement. Green counts did not exercise these boundaries. The command now
  disables Playwright signal handlers where it owns cleanup, bounds and clears
  waits with fallback cleanup, and distinguishes SDK acknowledgement from child
  exit. A follow-up accidentally made the stale-marker guard reject any nonempty
  text, and several negative tests passed at that earlier boundary. Failure tests
  now observe the intended request/shutdown markers and stage, rather than only a
  nonzero exit. Final independent review passed 14 focused assertions and reran
  the original lifecycle probes. The final integrated gate passed 103 tests plus
  fresh proof generation and both viewer browser gates. Future workflows should
  carry existing signal-ownership lessons into every new browser orchestrator,
  and bind failure assertions to the actual boundary rather than green counts.

## 2026-10-04 — Preserve browser wrapper semantics and bound QA lanes

- A real Chromium probe showed resolved-promise continuations can run during active
  trusted click dispatch. The capture contract now names that observed boundary,
  rather than claiming synchronous-only causality or using a latest-click timer.
  Playwright routing header overrides persist across redirects; the narrow fetch
  hook instead rejects selected redirects and uses factory-owned contexts with
  service workers blocked. Both redirect destinations are tested for zero delivery.
- Green browser tests still missed ordinary application regressions: inspecting a
  Request consumed its body before bypass; inspecting single-use headers exhausted
  them; spreading RequestInit discarded inherited/non-enumerable method and body
  properties. Independent review reproduced each defect. Eligibility now precedes
  Request construction, headers normalize once, and a headers-only proxy preserves
  dictionary reads and original getter receivers. Executed server observations cover
  both injected and bypass requests. FLOW now requires these wrapper controls.
- Several broad QA passes returned incomplete or contradictory scenarios. Splitting
  the lane into three dispatch tests and four boundary tests produced runnable
  evidence; follow-ups added concrete review counterexamples. Repeatedly reissuing
  a broad list wasted time. Future passes should own a few explicit scenarios and
  complete their focused run before acceptance. Documentation's double post-click
  response wait was also caught by review; the example now subscribes once before
  the click and separately awaits application completion.
- Final independent review passed all nine focused browser tests and reproduced
  the repaired dictionary/body/iterator cases. The final complete gate passed 89
  tests plus fresh legacy proofs and both viewer browser gates. These establish
  only sequential, top-frame Chromium fetch capture to one exact loopback endpoint.

## 2026-10-04 — Reconcile capture contracts and delegated test scope

- OpenTelemetry's exporter contract is mixed: `export` uses a callback, while
  `forceFlush` and `shutdown` return promises. An overbroad correction broke export;
  inspecting the installed declarations and implementation resolved the mismatch.
- Initial coverage confused SIGTERM exit with successful SDK shutdown and used
  `process.exit` to test natural exit. A malformed-status case actually used valid
  ERROR code 2, and a browser test searched for a random trace ID it never sent.
  Concrete acknowledgement, finite-app, valid/invalid metadata, and actual browser
  context assertions now cover these boundaries. Exact startup span counts replaced
  existential checks that independent review proved could pass despite omission.
- Several delegated passes returned only part of their requested test scope.
  Reconcile each criterion to its actual assertion and narrow follow-up ownership;
  don't repeatedly reissue broad task lists. FLOW now records the signature and
  lifecycle checks. The full 81-test gate and browser/viewer paths passed, and the
  final strengthened startup assertion passed separately.

## 2026-10-04 — Measure onboarding with awaited evidence

- Two delegated QA passes failed to capture the required full elapsed clock or
  preserve raw logs; unawaited DOM samples could also be stale. A replacement
  timestamped sequential probe with awaited viewer assertions recorded setup,
  inspection, shutdown, environment, and a clean source snapshot. The measured
  27.531 seconds is one machine observation, not a benchmark or the human
  unfamiliar-developer five-minute gate. FLOW now requires this evidence format
  and separates manual URL opening from measured automation.

## 2026-10-04 — Verify browser-served module behavior, not only status codes

- A framework fixture's asset checks passed with HTTP 200 while incorrect
  JavaScript MIME types caused real Chromium module loading to time out. The
  Express checks now assert content types, and both fresh Chromium proof/viewer
  paths passed. FLOW requires MIME assertions plus awaited browser execution and
  resulting behavior for framework-served modules, preventing a status-only
  server test from being mistaken for a working browser integration.

## 2026-10-04 — Keep process cleanup claims cooperative

- Supervising Playwright's default detached children added complexity and regressions: forcing `detached: false` conflicts with Playwright's internal negative-PGID kills. Removing that attempted containment was safer than claiming hard containment. Cleanup tests must also cover a launch promise that fulfills after its shutdown deadline and a falsy rejection; a broad suite (51 tests) had missed those boundaries, while later regression verification covered 64 unit tests, fresh proof, and viewer. A fake that reused an already-exited emitter left an await unsettled, and an inline test had invalid JavaScript, so validate test harnesses against real lifecycle semantics.
- Before lifecycle rewrites, use a minimal runtime experiment to establish dependency ownership/acquisition and kill semantics; add the concrete failing boundary assertion before expanding architecture, and reconcile known failures before delegating a new writer. This narrows speculative supervision work and makes the required boundary observable first.

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

## 2026-10-02 — Source-map attribution must fail closed

- Passing exact-location and empty-map tests did not establish trustworthy
  attribution: Node 24's native source-map lookup extrapolated into an unmapped
  generated line. Independent review reproduced this and malformed file URLs
  that changed successful requests into HTTP 500. A same-line source-bearing
  segment guard and fully contained diagnostic failures now have executable
  counterexamples. FLOW now requires adjacent valid/invalid boundary tests;
  this was verified through real compiled-service subprocesses, not only mocks.
- Approved paths must originate from the fixture configuration/helper location,
  not from the observed caller. A caller-derived root could falsely identify an
  external service as the project's fixture. Keep that negative control and
  report unsupported or unusable mappings as unknown rather than relabeling JS.
- Documentation research incorrectly reported Node 24 source-map APIs absent;
  the installed runtime exposes `setSourceMapsSupport` and `findOrigin`.
  Validate version-sensitive availability locally before accepting such claims.

## 2026-10-02 — Validate before permissive decoding and normalization

- Independent review of the unfinished proof found that Node and trace-mapping
  accepted version 2 and invalid VLQ characters, while filesystem normalization
  collapsed opaque `webpack:`, `node:`, and `data:` sources into an approved path.
  Explicit version/VLQ and URL-scheme guards now have real compiled-service
  counterexamples. FLOW records this boundary: decoder success and path equality
  alone do not prove usable local attribution.
- The initial privacy test covered successful diagnostics only. Failure requests
  now pass through the same exporter tripwire and schema/content allowlist.
  Verification preserved generic failure responses and trace hierarchy; this
  strengthens the existing failure-path rule without expanding product scope.

## 2026-10-02 — Verify artifact consumers from a clean start

- The viewer's first server test passed locally because an ignored proof artifact
  already existed, but `npm test` runs unit tests before generating it. Independent
  review found this fresh-checkout failure despite a passing browser gate. Server
  tests now own temporary fixtures; FLOW requires removing the relevant ignored
  output before verifying new artifact consumers. Removing `proof.json` and running
  the full gate passed: 37 tests, a fresh tracing proof, and viewer Chromium E2E.
- The first validator tests again accepted invalid inputs through a confound:
  changing only the action trace to zero failed for missing matching spans, not
  invalid identity. Consistent zero IDs now have regressions independent of graph
  errors. Depth 63/64/65 and correlation/exported-ID collisions bind parser and
  builder acceptance. Keep invalid-input tests valid in unrelated dimensions.
- A size check after `readFile` did not bound resource use. The viewer now reads
  at most 1 MiB + 1 byte, handles short reads, closes file handles, and shares
  concurrent reads. Tests exercise short/growing inputs; independent diagnostics
  checked exact-size boundaries and overlapping requests. Limits must apply at
  the resource boundary, not only after parsing.
