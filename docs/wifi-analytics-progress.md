# SDD ledger — plan: docs/wifi-analytics-plan.md

Spec: user-approved Wi-Fi analytics and retargeting plan, 2026-09-30.
Base: 0a21877ac574860335ec954bf328bbadc554028b.
Pre-flight: task 1 visit/outbox interface feeds task 2 and handoff task 3; privacy suppression must be monotonic across all. Task 2 clean HTML must not inherit window.pixiiAd credentials. Task 3 arrival must use website identity, not Wi-Fi identity.
Ruling: retain an operational analytics enrollment marker in additive registration columns, not an outbox row in the mandatory registration transaction. Enqueue is best effort and cron recovers from the saved marker; cost is nullable new columns in the existing table, with no change to authorization semantics.
Ruling: use a fresh isolated marketing clone and clean task-specific Wi-Fi branch; native worktree creation targets the outer workspace rather than the actual nested repositories. No existing website edits are touched.
Ruling: vendor flags and jurisdiction permission stay off until verified configuration and privacy review; no new consent UI is inferred. Cost: no advertising audience until release gates are satisfied.
Baseline: initial Workers test launch blocked by sandbox local sockets; retrying with local-runtime permission.
Task 1: implementation and local recovery checks passing; stable delivery IDs/times, no PII, pending retries, explicit authenticated view-ack marker (signed list response is NOT proof of connection).
Task 2: clean cookie-gated final page and first-party telemetry implemented. 276 unit tests passed; signed-router analytics integration passed separately. Browser regressions running on 8791 to preserve existing preview on 8787.
Task 3: isolated website branch codex/wifi-attribution from fresh origin/master. Inline fragment removal before GTM; guarded direct/vendor loaders; existing PostHog identity retained. 48 unit tests passed.
Ruling: remove the website GTM noscript iframe because a static noscript tag cannot honor GPC/fragment opt-outs. Cost: no GTM collection with JavaScript disabled.
Ruling: suppress tracking on failed Wi-Fi redemption for the current visit, but persist only actual opt-outs. Cost: a failed handoff loses attribution/ads for that visit; navigation still works.
Ruling: browser tests gain an optional port override so an existing 8787 preview is not stopped. Defaults unchanged.
Ruling: URL assertions decode HTML entities after introducing safe dynamic destination escaping; actual destination is unchanged.
Verification limits: baseline website Vitest command incorrectly collects four Playwright suites; targeted src/lib + src/data 48/48 pass. Astro check has pre-existing src/data/events.ts:132 tuple error. Full website build compiled source then failed copying public assets (ENOSPC); removed only generated dist, 358 MB, reproducible by rebuild. Native outer-workspace worktree creation failed; no attached worktree resulted.
Task 4: report and release documentation in progress. No production operations.
Task 4: report created and SQL executed successfully (empty pre-rollout): PostHog insight 12378388 / UMsPJ8c6. Release checklist in docs/wifi-analytics-release.md includes vendor gates and rollback. Production remains unchanged.
Verification: typecheck, generated Wrangler types, 280 Worker tests, 8 issuer/runtime tests, 2 gateway tests and 51 targeted website unit tests passed. Initial 86 browser regressions plus 4 new clean-transition/fallback tests passed; final combined 90-case rerun in progress. Worker dry-run build passed with all flags false. Website full-check/build limits remain documented above.
Final review: fresh gpt-6-astra reviewer found two Important issues and no Critical or Minor findings.
Final: fixed temporary suppression becoming durable opt-out — distinguish genuine preference from session-only eligibility suppression across portal/website; cross-runtime tests RED→GREEN, Worker 280/280, runtime 8/8, website 51/51.
Final: fixed wrapper removing window.gtag used by existing signup clicks — exact Google inline-script regression RED→GREEN, website 51/51. Global function remains inside the privacy permission gate.
Final: Ruling: physical captive-browser behavior — preserve existing code and require real iPhone/Android tests before release; emulation cannot establish OS handoff or router behavior, so activation remains gated.
Final: Ruling: vendor dashboard receipt and GTM duplicates — leave integrations disabled pending actual account diagnostics; source and intercepted-request tests are not receipt evidence, so marketing audiences are not yet live.
Final: Ruling: production migration/deployment — stop before remote mutations per explicit user release gate; cost is implementation not live yet.
Final: Ruling: full website build — retain original source and retry when disk space is available, not remove user data; cost if the environment remains blocked is an outstanding release check. RESOLVED: retry built all 176 pages successfully. Existing Astro tuple/test-collection issues remain separate.
Final verification: 281/281 Worker tests (including injected outbox failure during ad completion and signed router ACK), 8/8 issuer/runtime, 90/90 browser, 2/2 gateway, 51/51 website targeted units; Worker typecheck and dry-run pass; website production build 176 pages pass. Reviewer findings fixed; no deferred minors. All runtime assets remain unpublished new versions; product repos untouched; no migration/deploy/push performed.
Tasks 1–4: implementation complete, production release and external vendor/device verification remain intentionally gated. Permanent record is this versioned ledger rather than the empty helper scratch directory.
