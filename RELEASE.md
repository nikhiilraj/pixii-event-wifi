# Initial source handoff - September 30, 2026

Live Worker version: `523992be-e21b-4a55-87e1-3cebd31b3799`.
Previous version / rollback reference: `3b85bedd-67fe-4207-8648-76186c704d09`.

This initial source snapshot matches the deployed portal. The latest approved change shortens the connecting status to “Connecting”, uses 16px semibold text, aligns it with the logo on the right, and centres its status dot. Narrow-phone and landscape layouts remain within the viewport. The new immutable browser asset is `experience-v5.js`; prior runtimes remain available.

No backend API, database, credentials, DNS, Pages deployment, router configuration, seven-second gate, artwork, signup design, or final redirect behavior changed. The standard npm deployment command now explicitly preserves dashboard variables and uses strict mode.

Verification completed:

- Test-first mobile regression failed on the old label before implementation.
- 264 Worker/D1 tests, 4 issuer tests, 78 browser tests and 2 gateway tests passed.
- Type checking, deployment dry run, and staged whitespace checks passed.
- Local screenshots reviewed at 320px, 1440px and 844px landscape; live layout checks also passed at 390px.
- Live `wifi.pixii.ai` serves the exact v5 runtime bytes. Existing connected runtime and v4 bytes remain unchanged.
- Live signup content fingerprint unchanged; final five-second same-window redirect and blocked-launch fallback verified in Chromium.
- Live production security-header smoke checks passed.
- Targeted independent review found no remaining critical or important findings. Credential-pattern and sensitive-file checks found no production secrets or lead exports in the shared snapshot.

Browser checks emulate mobile layouts using Chromium; they do not certify native Safari/Android captive-browser behavior. No physical router was available for this release's verification; its authorization code was unchanged. No production signup records were created by these checks.

The source was copied into a clean repository rather than publishing the old workspace history, which includes unrelated and local-only material. The unavailable local 53-byte migration `0003_connecting_release_time.sql` is the tested runtime copy (`ALTER TABLE auth_queue ADD COLUMN available_at TEXT;`), and the empty `.assetsignore` is the same file used by the verified deployment. No remote migrations were applied.

This file records the initial handoff, not a permanently current production version. Recheck deployment history before subsequent releases.
