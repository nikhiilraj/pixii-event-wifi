# Analytics production rollout — 2026-09-30

User authorized deployment. LinkedIn remains excluded. Code and the additive schema are deployed; first-party analytics and all advertising switches remain off pending the privacy approval and vendor checks. No router reinstall or DNS change.

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

## Release result

- Applied only `0006_analytics.sql` remotely. No historical enrollment or destructive schema changes.
- Deployed tracking-disabled Worker version `e16601c1-bd3b-47f0-8de9-a5a5c1ffc8fd`, then securely supplied the existing PostHog ingestion key. Active Worker version after that secret update: `108bbada-a9c8-4fcd-8e8c-fff829a41846` (2026-09-30 16:20:50 UTC). Existing router/authentication secrets were preserved.
- `ANALYTICS_ENABLED`, `PRIVACY_US_REVIEWED` and every pixel flag remain false; `ANALYTICS_ROLLOUT_AT` remains empty. The five-minute retry cron is installed but collection/delivery stay disabled.
- Website [PR 150](https://github.com/pixii-technology/pixii-website/pull/150) merged at `558d8f022f1743adb0c0b565e52f03e295b2acfc`. Cloudflare production deployment `daf5d723-403e-4505-9fa6-a9d824640438` succeeded at 2026-09-30 16:27:01 UTC. The latest homepage redesign was preserved.
- Live HTTPS checks: signup and previews return 200; unauthenticated `/connected` returns 403 as intended; all three new immutable runtime assets return 200. No vendor policy was added to signup/connecting documents.
- Live mobile-emulated team test: empty submission rejected; one clearly labelled `DEPLOY TEST 2026-09-30` record saved as `team_test`; D1 confirms 7,000 visible ad milliseconds and completed gate; final screen and automatic website redirect worked. No advertising requests fired. Team-test authorization is not evidence of physical-router acknowledgement.
- D1 analytics visits/outbox remain empty while tracking is disabled. The report cannot show a production attribution journey until activation.
- Live marketing HTML confirms handoff removal bootstrap precedes GTM, global `gtag` remains available, and the unguarded GTM iframe is absent.
- Live marketing browser check with a suppressed Wi-Fi handoff: fragment removed, homepage rendered, zero analytics/advertising requests, and temporary suppression did not create a permanent opt-out.

## Remaining activation checks

1. Obtain explicit approval of the existing privacy notice and US-only eligibility rule, then set an actual rollout timestamp and enable first-party analytics only.
2. Reconcile a newly eligible router journey between D1 and PostHog. Do not upload old leads.
3. Complete real iPhone and Android tests; browser emulation does not prove captive-browser behavior.
4. Keep Meta, Google and RB2B disabled until each vendor's configuration, privacy eligibility, browser requests and dashboard receipt are verified. LinkedIn remains out of scope.
