# Controlled TypeScript source-attribution proof

## Scope

This is a small Node.js fixture proof, integrated into `npm test` and the local
browser-trail experiment. It builds `experiments/source-attribution/service.cts`
to CommonJS with an external source map, then sends real requests through the
OpenTelemetry-instrumented fixture server so the compiled service code actually
executes. Attribution occurs only when code explicitly enters `withSourceSpan`;
it is not generic TypeScript, framework, or function auto-capture, and there is
no trace viewer.

For this controlled fixture, `source.cjs` reads the current synchronous caller
using Node.js 24's `util.getCallSites` with native call-site source mapping
disabled, then uses `node:module` `findSourceMap` / `findOrigin` to resolve the
mapped origin. `@jridgewell/trace-mapping` checks that the generated position has
a same-line source-bearing mapping, preventing attribution from a
source-less generated segment. The helper only accepts the expected generated
service and exact fixture source path, resolved relative to its root. It does
not reconstruct asynchronous call history: each explicit call captures its
current synchronous caller, including a call made after an `await`.
Only compiler-owned source-map v3 payloads with syntactically valid Base64 VLQ
segments are considered, and source URLs must use the local `file:` scheme;
unsupported schemes and malformed maps degrade to unknown attribution.

This trusts the compiler-owned map in this controlled fixture. It does not
authenticate hostile source maps, hash source contents, prove map integrity, or
establish symlink containment. It is not a general-purpose source resolver.
Unusable or out-of-scope locations are represented as `{ "status": "unknown" }`;
the callback and span operation continue.

## Reproduce

Use Node.js 24 (tested with 24.21.0) and npm:

```sh
npm ci
npx playwright install chromium
npm test
```

`npm test` invokes the build through lifecycle scripts before unit tests and the
browser proof. `npm run proof` also builds through `preproof`, then runs the
browser trail. TypeScript is pinned to 6.0.3; `.cts` compiles to `.cjs` with an
external `.map`, not inline sources, as configured in
`experiments/source-attribution/tsconfig.json`. `@types/node` is pinned to
24.10.0. Node 24.21.0 was tested. The pinned `@jridgewell/trace-mapping`
dependency declares MIT, TypeScript declares Apache-2.0, and `@types/node`
declares MIT; consult package metadata for the full dependency license set.

## Acceptance-to-test map

| Acceptance | Executed assertion |
| --- | --- |
| Successful HTTP request executes compiled service and nested code after `await`; source locations equal the exact `withSourceSpan` file, line, and column derived from `// SOURCE:` markers in `service.cts` | Main test in `experiments/source-attribution/source.test.js`: `expectedLocations()` derives one-based positions from the actual fixture text, then compares both spans' mapped locations. |
| Correct hierarchy and async trace context | Main test asserts HTTP SERVER parent is the supplied parent, `action.service` is its child, and `action.after-await` is a child of the service span with the same trace ID. It also asserts positive durations and success status. |
| An unexecuted alternative is absent | Main test asserts no `action.unexecuted` span on both failure and success requests. The browser runner also asserts the branch is absent. |
| Failure and recovery | Main test sends `/api/failure`, checks HTTP 500, generic response without stack/source/error detail, parent/trace preservation, and ERROR status on executed application spans. A subsequent successful request checks HTTP 200, a distinct trace, UNSET span statuses, and intact hierarchy. |
| Missing map, malformed map, empty/unmapped map, mapping only on preceding generated line, and source-less segment on the caller line | Disposable-subprocess mutation cases in `source.test.js` assert the callback work still emits spans with `{ status: 'unknown' }` and no unexecuted branch. |
| Unsupported `webpack:`, `node:`, and `data:` sources; version 2 map; invalid VLQ character | Disposable compiled-service mutation cases assert HTTP success, response trace ID, supplied parent and HTTP-to-outer-to-nested hierarchy, positive durations, valid success statuses, unknown source evidence, and no unexecuted branch. |
| Non-local or invalid URL mappings and out-of-root paths | The same disposable cases cover remote `file:` URL, malformed percent escape, and an outside-root relative source; each remains unknown while the request succeeds and retains valid trace hierarchy. |
| External generated caller | A generated caller outside the fixture invokes the approved helper and continues successfully with unknown evidence, without exposing the helper's fixed project source path. |
| Integrated browser trail remains source-aware | `experiments/correlation/run.js` checks each executed action has mapped locations matching source markers, preserves HTTP/service parentage, and keeps HTTP/control spans source-unknown. |

All listed tests run under `npm test`; the source tests exercise the actual
compiled fixture via HTTP, not only a mapping helper. The browser proof remains
the separate real-Chromium correlation path.

## Data boundary and limits

Span evidence exposes only an allowlisted project-relative file identifier,
positive source line and column when mapped, or the unknown status, together
with the controlled proof's span fields including integer status code. The
artifact does not include source text, raw errors, stack traces, or header data.
`statusCode` is the OpenTelemetry span status enum, not an HTTP status: `UNSET=0`,
`OK=1`, and `ERROR=2`.
Failure responses are generic. Runtime traces and artifacts remain local; no
collector, LLM, or remote telemetry service is required or contacted.

This proves attribution only for explicit calls in this compiled fixture. It
does not establish automatic capture of TypeScript functions, generic Node.js or
framework support, adversarial map authenticity, source-content integrity,
symlink containment, or a viewer. See also the broader
[browser-to-backend correlation proof](correlation-proof.md).
