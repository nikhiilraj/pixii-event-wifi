# FAS rejection diagnostics - September 30, 2026 IST

## Release scope

User-approved diagnostic-only release. The physical router's reported 403 is
not yet reproduced; this release identifies its rejection boundary on the next
real phone attempt. No new compatibility bypass, router reinstall, SSID change,
secret rotation, database migration/write, or successful-page redesign.

- Worker: `pixii-event-wifi`, serving `wifi.pixii.ai` through the existing Pages binding.
- Released version: `d20bab23-d4de-4294-a6a8-6ba3df6decfa` (100%).
- Deployment time: September 29, 2026 at 20:08:52 UTC.
- Previous version / code rollback target: `96c76052-8966-46c3-998e-cdec5f1ad3c0`.
- Release tag: `fas-diagnostics-20260929`.
- Deployment preserved dashboard variables; no static assets needed uploading.

## What changed

Rejected GET `/router/fas` and authentication failures on POST
`/router/fas/submit` now emit one structured `pixii_fas_rejected` custom warning.
It contains only a random reference, fixed route, validation stage, and finite
reason code. The same reference is shown on the denied page and returned in
`X-Pixii-Request-ID`. Internal reasons are not disclosed publicly.

No raw request URL, ciphertext, IV, client identifiers, submitted form data,
keys, exception messages, or stacks are passed to the logger. Console-sink
failure does not change rejection behavior. Accepted hand-offs are not logged.

Cloudflare configuration, verified via the production API after deployment:

- Overall observability and persisted custom logs enabled, sampling 100%.
- Query-string redaction enabled.
- Automatic invocation logs disabled.
- Traces disabled.

Existing cryptography, field validation, signed form checks, enabled-router
lookup, Authmon authentication, canonical queue identity, and seven-second ad
gate remain unchanged. POST form-state subreasons are intentionally coarse:
`form_state / invalid_input`; investigate deeper only if the real failure
reaches that boundary.

## Verification evidence

- Test-first: 20 new diagnostic cases failed before implementation; the accepted
  9.8 control passed. All 21 diagnostic cases passed after implementation.
- Full typecheck passed; 225 Worker/D1 tests, 4 issuer tests and 26 phone-browser
  tests passed: **255 tests total**.
- Browser checks cover form completion, consent/validation, seven-second gate,
  loading failures, background pause, refresh recovery, looping, video fallback,
  and phone/landscape/desktop layout.
- Generated bindings check and deployment dry run passed.
- Independent read-only review found no critical or important issue.
- Live `/health`, all three previews, and same-domain experience asset returned 200.
- Signup, connecting, and connected preview SHA-256 fingerprints are identical
  before and after deployment.
- Controlled invalid GET through `wifi.pixii.ai` returned 403 and reference
  `d86d72ff-642a-4bd6-b095-3cb7eaa28d52`. A live Worker log matched that reference
  with `stage=decrypt`, `reason=outer_base64`; the reason stayed hidden in HTML.
  The unique test query marker was absent from the entire received tail event.
  This is a deliberately invalid probe, **not evidence of Monte's failure reason**.
- A first filtered CLI tail did not capture the probe. Verification succeeded
  through the same authenticated tail API with an explicitly ready, unfiltered
  WebSocket. Raw events remained in memory only; temporary tail was deleted.
- Read-only production aggregate check: 5 public-web + 8 team-test acknowledged
  registrations, no `wifi` registrations, authorization queue empty, router enabled.

### Local verification environment

macOS marked several original dependency launchers, one SQL migration, and
`.assetsignore` as dataless; reads hung. No originals were deleted or overwritten.
Exact locked dependencies were installed into `/tmp/pixii-fas-test-runtime.o2VPjl`.
All 72 source/test/artwork/lock/config files used for validation were hashed
against the project copies and matched. The temporary test database's unavailable
53-byte migration was reconstructed as `ALTER TABLE auth_queue ADD COLUMN
available_at TEXT;`, matching the existing application's schema requirement.
The temporary empty assets-ignore file had no effect on the verified asset set;
Cloudflare reported no updated asset files. The production release used these
verified identical source/config/assets from the temporary runtime; no migrations
were run against production.

## Next real test

1. Monte uses a phone with cellular data off, forgets and rejoins
   `unBoxed2026 - Fast`. Do not reinstall or change router settings.
2. Let the router open the captive signup automatically; if needed visit an HTTP
   page to trigger it. Do not test by manually visiting the public homepage.
3. If denied, send the reference shown on the page and the attempt time/timezone.
   A cropped screenshot is fine; do not share the encrypted address-bar URL.
4. In the production Worker dashboard, Observability -> Logs, search that
   reference or `pixii_fas_rejected`. The stage/reason is the next evidence.
5. If signup opens, submit an obviously labeled test, wait through the ad and
   router confirmation, then verify internet access with cellular still off and
   check the new `wifi` registration/acknowledgement in D1.

Only after capturing the actual failure should a regression test and the
smallest compatible fix be written. Do not call the physical flow fixed yet.

If rolling back code, recheck logging settings independently: script-level
observability may not roll back with a Worker version. No schema rollback needed.
