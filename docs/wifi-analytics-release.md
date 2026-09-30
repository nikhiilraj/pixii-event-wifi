# Wi-Fi analytics: implementation and gated release

Status: **schema, Worker and marketing code deployed on 2026-09-30; analytics and advertising remain disabled** pending privacy approval and integration verification. See [the production release record](releases/2026-09-30-analytics.md) for exact versions and rollback points. No router reinstall or DNS change. Product frontend and backend are untouched. Marketing edits were rebased onto the latest homepage and merged through [PR 150](https://github.com/pixii-technology/pixii-website/pull/150). Wi-Fi changes are on `codex/wifi-analytics` (base `0a21877ac574860335ec954bf328bbadc554028b`).

## What is measured

- `wifi_form_viewed`: visible form, signed browser context.
- `wifi_signup_completed`: saved registration, recoverable from D1.
- `wifi_connected`: explicit authenticated router acknowledgement after the ad gate. An Authmon list response alone is not proof of connection.
- `wifi_pixii_open_requested`: actual button/automatic navigation attempt, not proof that another browser opened.
- `wifi_website_arrived`: marketing page redeemed the opaque handoff and attached its reference to the **existing** PostHog identity.

Only newly enrolled, post-rollout visits are eligible. Previews/team tests are not enrolled. Public web submissions have `wifi_source=public_web`, cannot produce `wifi_connected`, and do not receive portal advertising pixels.

No name, email, phone, MAC, FAS payload, router identifier or authorization token is added to analytics. Third-party code is absent from the credential-bearing form/connecting documents. `/connected` uses a short-lived signed HttpOnly session cookie and the same final design. It has no router-session data in HTML or URL. If its availability probe fails, the existing final screen and website link continue without pixels.

## Report

[Wi-Fi journey → customer activity (30 days, rollout only)](https://us.posthog.com/project/149831/insights/UMsPJ8c6), insight `12378388`. Query: `wifi-conversion-report.sql`.

The query was executed successfully against the current schema and is empty until rollout. It deduplicates stable event IDs, counts journeys (not unique customer accounts), uses a 30-day conversion window and a 60-day rolling journey cohort, separates missing/ambiguous website identity links, and checks prior recorded purchases in the available 365-day lookback. `payment_made` means a recorded browser payment event, **not billing-verified revenue**. Unknown/isolated browser storage cannot be repaired without product changes. No checkout hardcoded source is used. Older cohorts require widening the SQL time range.

## Configuration and unresolved external checks

| Integration | Existing identifier | Release condition |
|---|---|---|
| PostHog | project 149831, US ingestion | Existing project ingestion token is configured securely as `POSTHOG_PROJECT_TOKEN`. Privacy approval, activation and reconciliation of one approved production test against D1 remain pending. Never use a personal API key for ingestion. |
| Meta | `571544668799364` | Verify account ownership, privacy eligibility and Events Manager receipt. Automatic configuration disabled in portal code. |
| Google | GA4 `G-FRVEG530RV`, `G-E1JECZVBRZ`; Ads `AW-18294844879` | Tag Assistant/GA4 receipt; inspect GTM `GTM-K97PHX6H` for duplicate direct tags and automatic outbound-click collection. No new GTM migration. |
| LinkedIn | **Excluded for now** | Disabled at the user's request. No partner ID has been invented or configured. |
| RB2B | `GOYPYH4421OX` | Verify `wifi.pixii.ai` is authorized and inspect runtime network dependencies. Add only verified collector origins to clean-page CSP. Current loader allowlist alone is not a verified working integration. |

All switches ship false: `ANALYTICS_ENABLED`, `PRIVACY_US_REVIEWED`, `PIXELS_ENABLED`, `META_ENABLED`, `GOOGLE_ENABLED`, `LINKEDIN_ENABLED`, `RB2B_ENABLED`, `RB2B_DOMAIN_VERIFIED`. `ANALYTICS_ROLLOUT_AT` is empty. Unknown/non-US locations and GPC/recorded opt-outs suppress tracking. US permission requires explicit privacy review; the marketing-message checkbox is **not** blanket tracking consent. No additional consent UI was introduced.

For each enabled vendor, check browser requests **and** dashboard receipt, with GPC off/on, storage denied and opt-out set. Inspect payloads for URL fragments, handoff tokens, form values and router identifiers. Disable automatic/enhanced outbound-link collection that could capture a handoff URL; do not enable the integration without proving this. The scoped CSP is intentionally restrictive, not a wildcard vendor allowlist.

## Production release gates (require explicit approval)

1. Confirm intended code SHAs, Worker `pixii-event-wifi`, account `9423b9bb3bc960f803d00c7718b78cad`, and D1 `pixii-event-wifi-production`. Record the **currently active** Worker version using `npx wrangler deployments list`; do not assume the local base commit is the deployed version. Confirm D1 recovery availability before migration.
2. Review additive `migrations/0006_analytics.sql`, then explicitly approve/apply it remotely. It adds nullable registration/acknowledgement markers plus three analytics tables and indexes. Even a tracking-disabled code deploy requires this migration first because operational SQL now names the nullable columns. Do not edit/reapply earlier migrations.
3. Deploy Worker with every tracking switch false. Keep the previous version ID for rollback; do not overwrite live auth secrets. Confirm existing Wi-Fi flow before proceeding. Additive columns can remain if rolling code back; no destructive down migration.
4. Deploy the narrow marketing change through its normal reviewed process. It removes handoff fragments synchronously before GTM/direct trackers and preserves PostHog identity/first touch. No product deployment.
5. Configure ingestion token securely; choose the actual UTC rollout timestamp (never backdate it); approve the US eligibility rule; enable first-party analytics only. Reconcile D1 to PostHog by `wifi_event_id`, `wifi_attribution_id`, `wifi_source`, and original timestamps. Keep all pixels off.
6. Resolve each vendor's table above; enable verified integrations one at a time. Keep unresolved ones off. Platform audience rules: portal `/connected`/`WifiConnected` or `wifi_connected`, never a product-account signup or purchase. Previews and public web are excluded.
7. Complete real iPhone **and** Android tests through the router: required validation, seven visible ad seconds, background/refresh, actual internet access, five-second redirect and click-only native-browser request, final website arrival, saved D1 record and PostHog receipt. Emulation/signed fixtures are not physical-router proof.

## Recovery and kill switches

`ANALYTICS_ENABLED=false` disables enrollment, collection, reconciliation/delivery and the clean-page transition. Existing Wi-Fi connection/fallback links remain. `PIXELS_ENABLED=false` leaves first-party analytics working but disables all portal vendors; individual flags disable one. Website opt-out suppression still runs before its existing trackers.

Outbox deliveries use stable UUIDs/original timestamps; non-2xx/timeout failures retry every five minutes. Reconciliation reconstructs saved signup and explicit ACK facts when an enqueue fails. Daily cleanup remains `17 9 * * *`; analytics retry is a distinct `*/5 * * * *` trigger. Analytics visit/outbox retention is 30 days; unredeemed handoff tokens expire after 10 minutes and are cleaned daily. Monitor oldest pending outbox age/count, attempts and generic `wifi_analytics_deferred` warnings; never log payloads or contact data.

## Validation limitations

Verified: 281 Worker tests, 8 issuer/runtime tests, 90 browser checks, 2 gateway tests and 51 targeted website unit tests pass. Worker typecheck/generated types and tracking-disabled dry-run build pass. Website production build passed on retry (176 pages) after space became available; the earlier ENOSPC attempt is superseded. Its full `pnpm test --run` still collects four pre-existing Playwright suites incorrectly; `pnpm check` still reports the existing `src/data/events.ts:132` tuple error. Vendor account receipt and physical-device tests remain outstanding.
