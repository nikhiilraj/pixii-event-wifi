# Pixii event Wi-Fi

Source for the live portal at **https://wifi.pixii.ai**. Start with [Monte's guide](MONTE.md).

This private repository contains the Cloudflare portal, optimized artwork/video, local tests, database migrations, and the Pages domain gateway. It does **not** contain lead records, production credentials, database exports, or router installation packages.

## Architecture

`wifi.pixii.ai` → Pages `pixii-wifi-gateway` → Worker `pixii-event-wifi` → D1 `pixii-event-wifi-production`

The Pages gateway forwards requests through the `PORTAL` service binding; it does not redirect visitors to a different hostname. The Worker also retains `wifi.joinpixii.com` as an existing custom domain. Do not replace that configuration merely because the public hostname is `wifi.pixii.ai`.

The router sends an encrypted openNDS handoff to `/router/fas`. Signup saves a registration; the connecting ad enforces a seven-second minimum in the normal visible-page flow. Router authorization stays gated until completion. The final page appears after router acknowledgement. Direct visits to `/` or `/preview/test` save public/test registrations but **cannot unlock a Wi-Fi client**.

## Source map

| Area | File |
| --- | --- |
| Connecting layout, artwork and CSS | `pixii-captive-portal/src/connecting.ts` |
| Signup, connected page and shared styles | `pixii-captive-portal/src/portal.ts` |
| Connecting browser runtime | `pixii-captive-portal/public/assets/flybyjing/v1/experience-v5.js` |
| Connected CTA and five-second redirect | `pixii-captive-portal/public/assets/connected-v2.js` |
| Images and video | `pixii-captive-portal/public/assets/` |
| Routes and security headers | `pixii-captive-portal/src/http.ts` |
| Router compatibility and auth | `pixii-captive-portal/src/opennds.ts`, `src/fas.ts` |
| Ad gating | `pixii-captive-portal/src/ad-gate.ts` |
| Database access and schema | `pixii-captive-portal/src/repository.ts`, `migrations/` |
| Deployment settings | `pixii-captive-portal/wrangler.jsonc` |
| Domain gateway | `pixii-pages-gateway/` |

## Local setup (no production keys needed)

Use a current supported Node.js version (24 or newer), npm and Git.

```sh
git clone https://github.com/nikhiilraj/pixii-event-wifi.git
cd pixii-event-wifi/pixii-captive-portal
npm ci
npx playwright install chromium
npm run dev:browser
```

Open `http://127.0.0.1:8787/preview`, `/preview/connecting`, or `/preview/connected`. The local command seeds only an isolated local database with synthetic fixtures. It never resets the production database. Stop this server before running browser tests, which start their own server on the same port.

```sh
npm run typecheck
npm test -- --maxWorkers=1
npm run test:issuer
npm run test:browser -- --workers=2 --trace=off
cd ../pixii-pages-gateway
npm test
```

Pre-optimized media is committed; the media-preparation scripts are optional utilities and may reference original files on Nikhil's Mac. They are not build or deployment prerequisites.

## Publishing an approved change

Run from `pixii-captive-portal/`, after pulling the latest code and passing tests:

```sh
npx wrangler login
npx wrangler whoami
npx wrangler deployments list
npx wrangler deploy --dry-run --keep-vars --strict
npx wrangler deploy --keep-vars --strict
```

Confirm the account is `9423b9bb3bc960f803d00c7718b78cad` and Worker is `pixii-event-wifi`. Record the previous active version before deploying. If production has changed since your checkout, coordinate with the other developer before publishing. Existing secrets remain in Cloudflare; never replace them with local fixture keys.

Verify the live previews at https://wifi.pixii.ai after publishing. Browser tests simulate devices; they do not prove that every native captive browser opens Safari/Edge successfully or that a physical router authorizes access. Use a real phone on the event Wi-Fi to verify router behavior when changing authentication.

For rollback, use the Cloudflare deployment history or `npx wrangler rollback <previous-version-id>` after confirming the intended version. UI-only changes require neither a database migration nor a router reinstall nor a Pages deployment. GitHub pushes do **not** automatically deploy this project.

## Safety and maintenance

- Use branches and pull requests. Keep the repo and live deployment synchronized.
- Treat this repo as the source of truth; avoid dashboard-only code edits.
- Keep runtime assets immutable: create the next version and update its references instead of overwriting a previously published file. Retain old runtime files for already-open sessions.
- Preserve the openNDS 9.8 compatibility handling, signed router polling, required validation, and seven-second ad gate.
- Never commit live logs, signup exports, `.wrangler`, `.dev.vars`, tokens, keys, or provisioned router configuration.
- Production database migrations and router changes require separate, explicit review. Existing migrations are included for local setup; do not blindly reapply or edit them on production.
- Historical release notes live in `pixii-captive-portal/docs/`; this README and `MONTE.md` describe the current handoff. Historical notes may describe previous layouts or release procedures.

See [Cloudflare's deployment documentation](https://developers.cloudflare.com/workers/wrangler/commands/workers/) for CLI details.
