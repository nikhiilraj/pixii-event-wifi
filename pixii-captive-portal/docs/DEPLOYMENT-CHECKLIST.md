# Pixii Captive Portal Deployment Checklist

This record contains dates, commit SHA, non-secret resource IDs, tester names,
and PASS/FAIL only. Never paste tokens, keys, guest data, router passwords, or
complete client identifiers here.

## Release record

- Date (UTC): 2026-09-25
- Source state: reviewed working tree; final commit pending
- Cloudflare account ID (non-secret): `9423b9bb3bc960f803d00c7718b78cad`
- Worker name: `pixii-event-wifi`
- Worker version: `aa8bf30a-c7fb-41ef-ab1a-7d1331809f58`
- Pages gateway: `pixii-wifi-gateway` / `pixii-wifi-gateway.pages.dev`
- D1 database name and ID (non-secret): `pixii-event-wifi-production` / `7355bd32-98f0-41c9-9781-24c9c38e410f`
- Tester(s): automated technical verification complete; Monte physical rehearsal pending
- Technical approver: ____________________

## Production gates

- [x] PASS — Product owner approved the exact mandatory marketing-consent wording and collection notice in conversation on 2026-09-24 IST.
- [x] PASS — Correct Cloudflare account and `joinpixii.com` zone access confirmed.
- [x] PASS — D1 production database created and migration `0001_initial.sql` applied exactly once.
- [x] PASS — `FAS_KEY`, `BOOTSTRAP_HMAC_KEY`, and `FORM_SIGNING_KEY` installed as production secrets; no secret is present in Git or this record.
- [x] PASS — Legacy rollback hostname `wifi.joinpixii.com` remains attached; valid TLS certificate and HTTP/2 confirmed at `2026-09-23T20:33:36Z`.
- [x] PASS — The no-payment Pages gateway is deployed, its private `PORTAL` service binding reaches `pixii-event-wifi`, and `/health` plus `/preview` pass through `pixii-wifi-gateway.pages.dev`.
- [x] PASS — Route 53 publishes the CNAME `wifi` → `pixii-wifi-gateway.pages.dev`; the Pages custom domain is active with SSL enabled. TLS, security headers, and the production smoke check pass through `wifi.pixii.ai`; `/` redirects on the same hostname to `/preview`.
- [x] PASS — Event `amazon-unboxed-sf-2026` and router `rtr_puli` inserted and read back with the expected profile, gateway name/hash, dates, retention, and enabled state.
- [x] PASS — Fresh bootstrap token issued to a mode-600 local file; hash suffix `b5487b79`, expiry `2026-10-02T06:59:59Z`, and `exchange_count = 0` confirmed without recording the raw value. The bootstrap key was rotated before this issuance, invalidating earlier packages.
- [x] PASS — All automated suites passed: 155 Worker tests, 4 issuer tests, 6 mobile-browser tests, 14 provisioner suites, 2 Pages gateway tests, and the Wrangler deployment dry-run.
- [x] PASS — Production health/notice/TLS/header smoke, missing-FAS denial, unknown-bootstrap rejection, signed Authmon health, and unsigned Authmon fail-closed behavior passed. Scheduled cleanup is attached at `17 9 * * *` and is covered by automated tests; its first production run is pending.
- [x] PASS — A fresh token with `exchange_count = 0` was used to build and inspect Monte's single-use supervised rehearsal package before sending.
- [x] PASS — ZIP filename: `Pixii-Puli-Setup.zip`  SHA-256: `b68b011f29029f05d3530c6e3348f3bae1b58655e3ce71e6f4bbc7561c87014d`
- [ ] PASS / FAIL — Monte received only that private rehearsal ZIP and completed the seven README actions while supervised; the package must not be reused after an installation attempt.
- [ ] PASS / FAIL — Full physical-router rehearsal passes on the exact Puli, SIM, Monte's Mac, current iPhone, and current Android; after this pass, the installed router is approved for the event and no second package is required.
- [ ] PASS / FAIL — If restore or reinstallation is required, revoke the rehearsal token, issue a fresh token, confirm `exchange_count = 0`, then build and inspect a replacement ZIP before sending it.

Current deployment status: CLOUDFLARE AND DNS READY — PHYSICAL ROUTER REHEARSAL PENDING

Date/time: `2026-09-25`  Final physical approver: ____________________

## Latest SSID-only release - 2026-09-29

The earlier release record above is historical. The current founder package is
**v1.0.1**, `Pixii-Puli-Setup-unBoxed2026-v1.0.1.zip`, in
`outputs/unboxed2026-v1.0.1-2026-09-29/`, with its matching Monte Codex prompt.
SSID: `unBoxed2026 - Fast` on both bands; backend: `https://wifi.pixii.ai`.
The matching backend setting is published in Worker version
`0b55acf1-2ecd-42f0-832d-cb9a3d76d014`.

All 14 installer suites, 170 backend tests, four issuer tests and 26 browser
tests passed. A labelled production signup was read back from D1, with the
seven-second gate completed and no router queue entry created by the website
test. The existing founder credential remains unused and expires at
`2026-10-02T06:59:59Z`. Physical router rehearsal is still pending.
Full evidence: `pixii-puli-provisioner/docs/RELEASE-2026-09-29-v1.0.1.md`.
