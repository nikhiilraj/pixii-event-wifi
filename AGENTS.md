# Working on Pixii event Wi-Fi

Read README.md and MONTE.md first. This repository targets an existing live event network; keep edits narrow.

- Portal source: `pixii-captive-portal/`. Domain gateway: `pixii-pages-gateway/`.
- Production Worker: `pixii-event-wifi`; account: `9423b9bb3bc960f803d00c7718b78cad`; D1: `pixii-event-wifi-production`.
- Public domain is `wifi.pixii.ai`, forwarded by Pages `pixii-wifi-gateway` via its `PORTAL` service binding. Preserve the Worker's existing `wifi.joinpixii.com` custom-domain configuration.
- Never read or commit secrets, local state, lead exports, raw FAS payloads, or live request query strings. Synthetic keys in local test configuration are not production keys.
- Do not replace production secrets, alter DNS, run remote migrations/writes, or reinstall routers for a visual change.
- Version changed immutable assets instead of overwriting published URLs. Retain old runtimes for already-open pages.
- Preserve openNDS 9.8 compatibility, including its exact tolerated terminal null suffix, signed Authmon handling, and seven-second visible ad gating.
- Use test-first changes, run the unit/issuer/type checks and browser tests, and visually review affected desktop, narrow-phone and landscape states.
- Local `npm run dev:browser` seeds only local synthetic data. Live `/preview/test` writes production registrations. Do not confuse them.
- Get explicit approval before production deployment. Verify account, Worker, active version, bindings, and the latest repository state first; use `--keep-vars --strict` and record the rollback version. Report actual live verification, not just build success.
- GitHub does not auto-deploy. Keep source and production synchronized through reviewed branches/PRs. Do not claim physical router or native OS browser-launch verification from Chromium device emulation alone.
