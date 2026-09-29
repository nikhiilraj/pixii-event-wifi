# Installed-router backend compatibility release

Released 2026-09-29 at 16:50 UTC. Approved backend-only fix for Monte/Addison's
already configured router; no installer run or router mutation performed.

## Target and rollback

- Public hostname: https://wifi.pixii.ai through the existing Pages service binding.
- Worker: `pixii-event-wifi`, account `9423b9bb3bc960f803d00c7718b78cad`.
- D1: `pixii-event-wifi-production`, `7355bd32-98f0-41c9-9781-24c9c38e410f`.
- Active version: `96c76052-8966-46c3-998e-cdec5f1ad3c0` at 100%.
- Tag: `opennds98-compat-20260929`.
- Previous version / rollback target: `de81c56b-bbaa-4fd1-bf0e-62add6bf0104`.
- Deployed using `wrangler deploy --keep-vars --strict` with the tag and release message.
- No migrations, secret changes, DNS changes, Pages deployment, or asset changes.

If this release introduces a regression, deploy the previous version using
Wrangler's version deployment/rollback workflow, then repeat the live smoke
check. Rolling back restores the known compatibility failures as well; it is
not a solution to the installed router's original problem.

## Narrow source changes

- `src/opennds.ts`: accept standard `gatewayurl`, `version`, `authdir`, and
  `themespec` fields, empty optional `themespec`, and one final separator.
  Preserve strict field allowlisting, duplicate/control checks, full-length HID,
  encrypted payload validation, and gateway-name identity matching.
- `src/fas.ts`: support exactly 32 or 64 lowercase hex gateway IDs. Authenticate
  the received value first; use the resolved canonical 64-character ID for all
  queue operations.
- `src/repository.ts`: resolve a short prefix only if exactly one router matches,
  including disabled routers in collision detection. Keep exact full-ID lookup.

No signup, connecting, confirmation, installer, or timing behavior was changed.
The email's claim that upstream 9.8 always truncates hashes is not established:
upstream source uses SHA-256 without that truncation. Short-ID support is a
bounded compatibility measure for the reported local/vendor variant. The
browser form already identifies its router by the encrypted gateway name, not
by a query-string hash. The additional standard fields and trailing delimiter
were independently reproduced as rejected inputs before this fix.

Upstream reference: [openNDS v9.8.0 encrypted metadata construction](https://github.com/openNDS/openNDS/blob/v9.8.0/src/http_microhttpd.c#L1332-L1375).

## Verification evidence

- Original diagnosis: 7 of 9 tests failed before the fix, for unsupported standard
  metadata, trailing delimiter, and short signed gateway ID. Two controls passed.
- Expanded red run: 17 failing / 54 passing tests before production code changed.
- Scoped green run: 71 passing tests.
- Full `npm run check`: typecheck passed; 204 Worker/D1 tests and 4 issuer tests passed.
- `npm run test:browser`: all 26 tests passed, including phone flow, ad timing,
  backgrounding, refresh, blocked autoplay, layout, and looping.
- Independent read-only review: no Critical, Important, or Minor findings in the
  scoped patch. Physical hardware was explicitly outside the review evidence.
- Wrangler dry-run succeeded; deployment reported no updated asset files.
- Live production smoke check passed on `wifi.pixii.ai`.
- Live 32- and 64-character unsigned/forged-signature health requests returned
  empty responses, granting nothing; malformed 31-character IDs returned 400;
  malformed encrypted captive-session requests returned 403. Before deployment,
  the same 32-character forged-signature format was rejected at parsing with 400.
- Before/after response fingerprints for `/preview`, `/preview/connecting`, and
  `/preview/connected` were identical: no page-design change.
- Production router `rtr_puli` is enabled and has the expected canonical hash.
  Remote D1 verification used read-only queries; no real or test lead was added
  to production by this release.

The new local integration tests execute real Worker handlers and local D1:
encrypted 9.8-format form -> consent validation -> saved `wifi` registration ->
canonical queue -> seven-second gate (early completion rejected) -> signed
poll -> signed ACK -> connected. Both full and short gateway identities pass;
retries do not duplicate a lead, and invalid callers cannot mutate the queue.

## Remaining physical acceptance check

The post-deployment production query still showed **0 real `wifi` registrations**
and an empty authorization queue. This is NOT yet proof of an on-device unlock.
No production FAS secret was retrieved and no router traffic was fabricated in
production. Synthetic integration and browser tests cannot validate the actual
radio, internet uplink, captive browser, or installed router ACK service.

Have Monte forget/rejoin `unBoxed2026 - Fast` on a phone with cellular off, use
the automatically opened captive form with a fresh TEST email, keep the ad
visible, verify ordinary internet access, and confirm `192.168.8.1` is blocked.
Then check the new production `wifi` registration and its acknowledged queue
row. The public root form and previews do not prove router authorization.

Shareable checklist: `../../outputs/Monte - WiFi retest after backend fix.txt`.
Do not rerun either installer. Obtain Addison's patched sources (without
credentials/logs/backups) before reconciling a future installer release.
