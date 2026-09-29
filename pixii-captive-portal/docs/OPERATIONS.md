# Pixii Event Wi-Fi Operations

This runbook is for Pixii developers. Monte does not run these commands. Run commands from `pixii-captive-portal/`; never paste secret values into tickets, chat, terminal transcripts, or Git.

## Preflight and identity

```sh
npx wrangler whoami
npx wrangler d1 migrations list pixii-event-wifi-production --local
npx wrangler d1 migrations list pixii-event-wifi-production --remote
```

The authenticated Cloudflare account must be `9423b9bb3bc960f803d00c7718b78cad`, which owns `joinpixii.com`. Confirm `wrangler.jsonc` contains the production D1 UUID before any remote command.

## Database migrations

```sh
npx wrangler d1 migrations apply pixii-event-wifi-production --local
npx wrangler d1 migrations apply pixii-event-wifi-production --remote
```

Apply locally and run the complete test suite first. Remote migration output must show only the expected migration names.

## Worker secrets and collection notice

Enter each value only at Wrangler's hidden prompt:

```sh
npx wrangler secret put FAS_KEY
npx wrangler secret put FORM_SIGNING_KEY
npx wrangler secret put BOOTSTRAP_HMAC_KEY
npx wrangler secret put PREVIEW_TEST_PASSWORD
```

The collection notice is part of the Worker bundle. It states the collected fields, Wi-Fi and marketing-communications purposes, 365-day retention, and links to Pixii's Privacy Policy. The mandatory checkbox wording is versioned in `src/config.ts`; a wording change requires a new consent version and a complete test run. Generic marketing consent is not recorded as separate SMS-specific permission.

The signup screen contains no product example. After submission, the connecting screen shows the full-screen Fly By Jing showcase: listings (0–3 seconds), A+ (3–5), then the opening two seconds of the supplied video (5–7). The silent clip and optimized artwork are static assets under `/assets/flybyjing/v1/`, served by the `ASSETS` binding on the same Wi-Fi hostname, including through the Pages gateway. Do not embed the clip in the Worker JavaScript bundle. Bump the versioned asset path when replacing an immutable asset.

Apply additive migration `0005_visible_ad_gate.sql` before deploying. New submissions opt into `ad_gate_required = 1`; existing rows default to `0` and retain the old release behavior. Signed, same-origin POSTs to `/router/fas/ad/start` acknowledge the first loaded artwork and checkpoint visible progress in D1. `/router/fas/ad/complete` cannot succeed until seven server seconds have elapsed and the browser reports seven visible seconds. Both operations are idempotent. Authmon delivery and ACK acceptance require ad completion; the browser shows “Finishing connection…” until the real router acknowledges access. Public/test submissions run the same ad gate but never enqueue Wi-Fi access.

The countdown pauses in a hidden tab. Refresh uses the signed `/router/fas/wait/:id` GET address, D1 progress and an optional session-storage checkpoint, rather than posting the form twice. Router requests still expire after 90 seconds and show the existing rejoin message. No browser/backend mechanism proves attention; this enforces the normal flow, not actual viewing. JavaScript is required to complete the ad step. Autoplay refusal shows the supplied still without blocking access.

## Preview, deploy, Pages gateway, DNS, and TLS

```sh
npm run check
npx wrangler versions upload
npx wrangler versions list
npx wrangler versions deploy
cd ../pixii-pages-gateway
CLOUDFLARE_ACCOUNT_ID=9423b9bb3bc960f803d00c7718b78cad ../pixii-captive-portal/node_modules/.bin/wrangler pages deploy public --project-name pixii-wifi-gateway --branch main
cd ../pixii-captive-portal
dig +short wifi.pixii.ai CNAME
curl --fail --silent --show-error --dump-header - https://wifi.pixii.ai/health
node scripts/smoke-production.mjs https://wifi.pixii.ai
```

The Pages project `pixii-wifi-gateway` forwards every request to the existing
`pixii-event-wifi` Worker through the private `PORTAL` service binding. Route 53
must contain a simple, non-alias CNAME named `wifi` whose value is
`pixii-wifi-gateway.pages.dev` and TTL is `300`. Confirm the Pages custom-domain
and certificate statuses are active, TLS validates without overrides, `/health`
returns only `{"ok":true}`, and the smoke script passes. Keep
`wifi.joinpixii.com` attached as the rollback endpoint until the Route 53 cutover
and physical-router rehearsal both pass.

The main URL `/` serves a working public form without a password or preview banner. It writes `submission_source = 'public_web'` and uses the shared connecting and online screens. These direct website registrations do not create router authorization records; only signed router sessions can unlock event Wi-Fi. For `public_web` and `team_test`, an acknowledged status represents saved signup data and completion of the website flow, not router authorization.

The team can inspect the public form and post-submit states at `/preview`, `/preview/connecting`, and `/preview/connected`. The connecting showcase repeats listings → A+ → video while authorization is pending; seven seconds is the minimum, not the animation's total lifetime. The countdown stays at zero during later loops. Its preview repeats too, without authorizing anything. A+ uses the supplied seamless portrait composition on all screen sizes. `/preview/test` is password-free, writes rows to the production `registrations` table with `submission_source = 'team_test'`, and never creates an `auth_queue` row or authorizes Wi-Fi. `/preview/data` remains protected with HTTP Basic authentication using username `pixii` and the `PREVIEW_TEST_PASSWORD` secret because it displays personal information. Its table includes `public_web`, `team_test`, and real `wifi` registrations with their status. Apply migration `0004_public_web_source.sql` before deploying the public root form; it retains the original source column as `submission_source_legacy` to avoid rebuilding the registration table and its foreign keys.

## Read-only registration checks

Recent registrations, without printing consent text:

```sh
npx wrangler d1 execute pixii-event-wifi-production --remote --command "SELECT id, event_id, router_id, email_normalized, phone_country, phone_e164, submission_source, consent_email_marketing, consent_version, consented_at, created_at, authorization_status FROM registrations ORDER BY created_at DESC LIMIT 25;"
```

Event totals:

```sh
npx wrangler d1 execute pixii-event-wifi-production --remote --command "SELECT event_id, COUNT(*) AS registrations FROM registrations GROUP BY event_id ORDER BY event_id;"
```

Lookup by normalized email. Replace the example only in your local terminal and do not save the command output publicly:

```sh
npx wrangler d1 execute pixii-event-wifi-production --remote --command "SELECT id, event_id, router_id, email_normalized, consent_email_marketing, consented_at, authorization_status FROM registrations WHERE email_normalized = 'person@example.com' ORDER BY created_at DESC;"
```

Authorization totals:

```sh
npx wrangler d1 execute pixii-event-wifi-production --remote --command "SELECT authorization_status, COUNT(*) AS registrations FROM registrations GROUP BY authorization_status ORDER BY authorization_status;"
```

These developer-only queries and the password-protected `/preview/data` view are the initial data-access methods. There is no public admin or export endpoint.

## Redacted logs

```sh
npx wrangler tail pixii-event-wifi --format pretty
```

Expected application logs contain only request IDs, coarse outcomes, and maintenance counts. Stop and investigate if a form value, FAS/IV material, client identifier, raw Authmon payload, bootstrap token, or key appears.

The production router uses the Pixii poll service installed by the founder package. It HMAC-signs every Authmon request with `FAS_KEY`; the Worker performs no queue read or mutation for unsigned or incorrectly signed polls. The stock openNDS compatibility poll may continue to run, but it receives only an empty response.

## Installed-router compatibility (2026-09-29)

Monte/Addison report a working GL guest-network installation using GL firmware
4.8.3, OpenWrt 21.02/fw3 and openNDS 9.8.0. Preserve that installation. Do not
rerun the original installer or replace it with the unreconciled Wi-Fi package;
first obtain their patched source files (without credentials or diagnostics)
before producing another installer for this hardware.

The FAS parser accepts the upstream `gatewayurl`, `version`, `authdir`, and
`themespec` metadata, including an empty optional `themespec` and one final
comma-space separator. It still rejects unknown fields, duplicates, empty
required values, control characters, and invalid client HIDs. Browser signup
identity comes from the decrypted gateway name, not a `gatewayhash` query value.

Signed Authmon accepts either the canonical 64-hex gateway identity or its
unambiguous first 32 characters. This is compatibility for the reported local
variant, not a claim that upstream openNDS 9.8 truncates SHA-256. Signatures cover
the exact received ID; alias resolution happens only after signature validation.
Unknown, disabled, or ambiguous aliases fail closed, including collisions with
disabled routers. Polling, ACKs, and clear all use the canonical stored identity.
Client HID, return hashes, signatures, and database identities remain full length.

Run `npm test -- test/opennds98-compatibility.test.ts test/authmon.test.ts test/opennds.test.ts`
for regression coverage, followed by `npm run check` and
`npm run test:browser`. The compatibility test uses real local Worker handlers
and D1 with synthetic router traffic; it does not prove physical router unlock.

After deployment, use a phone with cellular data off: forget and rejoin
`unBoxed2026 - Fast`, submit a fresh clearly marked test signup, keep the ad
visible, then confirm ordinary internet access and guest isolation. Opening the
bare website or `/preview/test` does not test a router session. Check for a new
`submission_source = 'wifi'` registration and its acknowledged canonical
`auth_queue` row before calling the physical end-to-end setup verified.

## Issue and revoke a bootstrap token

Create a mode-600 local file containing the same `BOOTSTRAP_HMAC_KEY` value used by the Worker, then issue a token:

```sh
node scripts/issue-bootstrap-token.mjs --hmac-secret-file /secure/path/bootstrap-hmac --output-token-file /secure/path/pixii-puli-token --router-id rtr_puli --profile-id gl-xe3000-stock-v1 --expires-at 2030-01-01T00:00:00Z --database pixii-event-wifi-production --remote
```

The script prints only the output path and the last eight hash characters. Revoke a token only by its full 64-character hash obtained through the controlled issuance record:

```sh
npx wrangler d1 execute pixii-event-wifi-production --remote --command "DELETE FROM bootstrap_tokens WHERE token_hash = 'FULL_64_CHARACTER_HASH';"
```

Deleting that row is the only mutating SQL command in this runbook.

## Scheduled cleanup verification

The cron runs daily at `09:17 UTC`. Verify only aggregate state:

```sh
npx wrangler d1 execute pixii-event-wifi-production --remote --command "SELECT state, COUNT(*) AS rows FROM auth_queue GROUP BY state ORDER BY state;"
npx wrangler d1 execute pixii-event-wifi-production --remote --command "SELECT MIN(created_at) AS oldest_registration, MAX(created_at) AS newest_registration FROM registrations;"
```

One scheduled invocation processes at most ten batches of 100 rows. A structured `outcome: ok` log includes expired, deleted, and registration-deletion counts.

## Rollback and incident response

```sh
npx wrangler versions list
npx wrangler versions deploy
```

Select the last known-good version interactively. If authorization behavior is unsafe, disable the router row through the Cloudflare D1 console, revoke outstanding bootstrap tokens, preserve redacted logs, and keep the founder package unreleased until the end-to-end rehearsal passes again.
