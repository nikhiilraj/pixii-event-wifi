# Analytics production rollout — 2026-09-30

User authorized deployment, then confirmed all prerequisites except physical-device testing and explicitly requested activation. LinkedIn remains excluded. First-party analytics was enabled at `2026-09-30T16:41:11.000Z`. Meta and Google activation is recorded below; RB2B remains disabled after its configured script returned HTTP 403. No router reinstall or DNS change.

## Preflight

- Worker account: `9423b9bb3bc960f803d00c7718b78cad` (Monte's account), verified through existing Wrangler login.
- Worker: `pixii-event-wifi`; prior active version `f71c1ffa-ef44-4e6e-9d07-bfc114ce5dd2`, deployment `9e22cd71-8183-485d-a58e-b8a7cda5a143`.
- Wi-Fi source: `86ab7561dc114c4ea246be991b54fe37a2dbc562`.
- D1: `pixii-event-wifi-production`, `7355bd32-98f0-41c9-9781-24c9c38e410f`.
- Pre-migration recovery bookmark: `00000047-00000015-000050f6-dbb1fb9f33235ef4f69f4cf844b2fe4d`.
- Only pending migration: `0006_analytics.sql`. Remote schema verified to have neither new marker column; prior migrations 0001–0005 already applied.
- Website project: `pixii-website` in the same account, normal Git production branch `master`.
- Prior website production deployment: `6c1d4b56-0281-4d3e-a8e4-2f89cc54d933`, commit `61843e5c46b52546b30afb808393052096547167`.
- Website analytics commit rebased onto that latest homepage redesign: `0e73c85`. No homepage/design files changed by the analytics patch.
- Fresh local preflight: 281 Worker + 8 runtime tests, Worker typecheck/dry-run and 51 website unit tests pass.

## Rollback

If the Worker release fails, roll back code to the verified prior Worker version above. Keep additive schema in place. Do not restore the entire database automatically: that could discard new registrations after the recovery bookmark.

Website rollback uses the recorded prior Pages production deployment. Coordinate rollback with the Worker tracking switch. No router or DNS changes are included.

## Initial tracking-disabled release result

- Applied only `0006_analytics.sql` remotely. No historical enrollment or destructive schema changes.
- Deployed tracking-disabled Worker version `e16601c1-bd3b-47f0-8de9-a5a5c1ffc8fd`, then securely supplied the existing PostHog ingestion key. Active Worker version after that secret update: `108bbada-a9c8-4fcd-8e8c-fff829a41846` (2026-09-30 16:20:50 UTC). Existing router/authentication secrets were preserved.
- `ANALYTICS_ENABLED`, `PRIVACY_US_REVIEWED` and every pixel flag remain false; `ANALYTICS_ROLLOUT_AT` remains empty. The five-minute retry cron is installed but collection/delivery stay disabled.
- Website [PR 150](https://github.com/pixii-technology/pixii-website/pull/150) merged at `558d8f022f1743adb0c0b565e52f03e295b2acfc`. Cloudflare production deployment `daf5d723-403e-4505-9fa6-a9d824640438` succeeded at 2026-09-30 16:27:01 UTC. The latest homepage redesign was preserved.
- Live HTTPS checks: signup and previews return 200; unauthenticated `/connected` returns 403 as intended; all three new immutable runtime assets return 200. No vendor policy was added to signup/connecting documents.
- Live mobile-emulated team test: empty submission rejected; one clearly labelled `DEPLOY TEST 2026-09-30` record saved as `team_test`; D1 confirms 7,000 visible ad milliseconds and completed gate; final screen and automatic website redirect worked. No advertising requests fired. Team-test authorization is not evidence of physical-router acknowledgement.
- D1 analytics visits/outbox remain empty while tracking is disabled. The report cannot show a production attribution journey until activation.
- Live marketing HTML confirms handoff removal bootstrap precedes GTM, global `gtag` remains available, and the unguarded GTM iframe is absent.
- Live marketing browser check with a suppressed Wi-Fi handoff: fragment removed, homepage rendered, zero analytics/advertising requests, and temporary suppression did not create a permanent opt-out.

## Activation follow-up

- User confirmed the review/verification prerequisites and requested activation; no additional consent inference from the marketing checkbox was made.
- First-party activation Worker: `6c3d4842-7bd5-41b2-9c43-fe73cc3460ae`. Rollout floor is the actual activation time, not historical enrollment.
- The isolated signed-router browser run saved a synthetic signup in local D1, held authorization for 7,000 visible milliseconds, required the signed router ACK, emitted exactly four stable first-party event IDs, redeemed the website handoff once and rejected its replay. It is not a physical-router test.
- Sent the four original serialized events under the separate `wifi_tracking_verification` QA name, `wifi_source=team_test`, `wifi_test=true`, and QA run `245f70da-067f-4c9f-b5ea-806fc10cd20e`. PostHog project 149831 confirmed all four with one row/UUID each despite two deliveries. These events are excluded from the production conversion query.
- Real Meta/Google JavaScript was exercised in visible Chromium with collector requests intercepted. Meta emitted `PageView` and `WifiConnected`; both GA4 IDs and the Ads ID emitted `wifi_connected`. Both automatic and click/fallback paths are checked for private-data leakage. No vendor libraries or collectors load before signed acknowledgement.
- Testing found a full session URL in `document.referrer`. Connecting responses now send only their origin as referrer. The clean page also suppresses pixels when an old/cached document supplies any unsafe referrer. Existing Wi-Fi flow and fallback remain usable. Added a regression test.
- Added the exact observed Google collector origins and an image-only regional Google redirect dependency; no wildcard permission was added. Final checks require zero CSP violations and no form values, router-session references or handoff tokens in vendor requests.
- Meta suppresses headless bot traffic; its events were verified using normal visible Chromium, without changing its bot rules.
- RB2B public loader for `GOYPYH4421OX` returned 403. Its browser dashboard, Meta Events Manager and Google Analytics were signed out in the available browser. Account-side receipt has **not** been independently reverified here; the user's completion statement is not presented as our own dashboard evidence.
- Live reconciliation (activation through 17:08 UTC): all 13 delivered D1 event IDs/names matched PostHog exactly: 4 form views, 3 saved signups, 3 signed router acknowledgements and 3 opening requests. PostHog separately received one `wifi_website_arrived` with `wifi_source=wifi`. These are live records, not the isolated QA event. This verifies real rollout delivery, not the OS/device models involved.
- Physical iPhone/Android router tests remain outstanding. The test runner has an India network address (a Cloudflare browser check was Singapore); production US-only eligibility was not bypassed.
- Final verification: typecheck, enabled-configuration dry run, 282 Worker tests, 8 issuer/runtime tests, 2 gateway tests and all 90 browser tests passed. A concurrent browser run first hit ten timing/timeout failures; five timing assertions reproduced in isolation because the mock clock still advanced during host work. Explicitly paused the two exact-timing fixtures without changing assertions or production timers; the fresh complete two-worker run passed 90/90 in 5.4 minutes.

Activation deployed successfully: Worker version `ca4b8e42-8f51-4f79-83fe-efaf74b02c7d`, source `97f3a2d`. Verified deployment output has first-party analytics, privacy review, Meta and Google enabled; LinkedIn and both RB2B flags remain false. Existing custom domain, service binding, secrets and both cron schedules were preserved.

Post-deploy live smoke check passed on `https://wifi.pixii.ai`. All three previews return 200 with no advertising CSP permission or external vendor script tags. Unauthenticated `/connected` returns 403 and no vendor permission. Source is published in [Wi-Fi PR 2](https://github.com/nikhiilraj/pixii-event-wifi/pull/2).

Rollback for this activation: `108bbada-a9c8-4fcd-8e8c-fff829a41846` restores the tracking-disabled release; `6c3d4842-7bd5-41b2-9c43-fe73cc3460ae` preserves first-party tracking but has all pixels disabled. Keep additive schema and collected registrations.
