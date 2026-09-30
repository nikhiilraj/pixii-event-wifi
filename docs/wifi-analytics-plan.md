# Wi-Fi analytics implementation (approved 2026-09-30)

## Global constraints
Only this Wi-Fi project and an isolated checkout of marketing website master change. No product frontend/backend, router, DNS, production migration, deployment, or historical uploads. Preserve existing authorization/ad/redirect behavior. Advertising fails closed; analytics failures fail open for Wi-Fi. Payments mean recorded browser events, not verified billing revenue.

## Task 1: Analytics storage and recovery
Add additive visits/outbox/handoffs schema; stable event IDs, original timestamps, bounded retry/reconciliation, rollout floor, privacy suppression. Test first against local D1. Five-minute cron distinct from existing daily cleanup. Expected: new recovery tests and existing suite pass.

## Task 2: Safe portal integration
First-party form/open telemetry with signed contexts, bounded payloads, dedupe/abuse limits. Server saved-registration and authenticated-ack facts only. Clean final document via short-lived signed HttpOnly cookie after gate; no router state in clean HTML. Immutable runtime versions, failure fallback, preserved timers. Independent pixel switches, same website IDs, unresolved integrations off. Expected: privacy/security/flow tests pass.

## Task 3: Website handoff
Opaque short-lived single-use fragment removed before all trackers, restrictive redemption origin, existing PostHog identity and first touch retained. Preserve suppression. No email identity merging, no product edits. Expected: bootstrap tests pass including expiry/storage/network failures.

## Task 4: Report and handoff
30-day PostHog report joining opaque reference to existing website person identity and signup/payment events; separate unlinked, public/test and existing payers. Read-only schema checks; no synthetic production capture. Run full suites, final independent review, document missing external receipt/router tests. Stop at production release approval.

## Review focus
Fail-open registration/authorization, no sensitive request data to vendors, no replay escalation, suppression before website GTM, legacy sessions and immutable assets, stable reporting dedupe, no inferred billing revenue. Verify vendor configurations rather than inventing IDs.
