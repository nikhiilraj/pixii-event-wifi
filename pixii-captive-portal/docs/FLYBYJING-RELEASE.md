# Fly By Jing connecting ad - 2026-09-29

Scope: connecting screen and timing only; signup, consent wording, final CTA and router installation package are unchanged.

## Source artwork

Listing folder: supplied `Listing - B08Y659BX2`. Hero is PT01, “Electric Chengdu Street Heat”; thumbnails are MAIN and PT01–PT06. A+ source is `Listing - B08Y659BX2 2/A_PLUS_PREMIUM_1` (four original panels plus the supplied portrait preview). Video is the supplied nested `FLYBYJING B08Y659BX2 1.mp4`. Its first two seconds are encoded at 1280×720, H.264, with no audio track; size 272,737 bytes. All image exports preserve source proportions. Some A+ panels already have text cut at their source edges; the portal does not add cropping.

`scripts/prepare-flybyjing-media.mjs` reproduces the image/video optimization using cwebp and ffmpeg. It does not generate new artwork or a new film.

## Deploy order

1. Run `npm run check`, `npm run test:browser -- --workers=2` and a Wrangler deployment dry run.
2. Apply only pending migration `0005_visible_ad_gate.sql` to production D1.
3. Deploy the Worker with its `public` static assets. The existing Pages service binding and DNS need no change.
4. Check `/preview/connecting`, first artwork, A+ portrait, clip and script through both Wi-Fi hostnames. Check that the signup and final screen remain unchanged.

Rollback: roll back the Worker version. Leave the additive columns in D1; do not drop or rewrite lead records. Old code ignores the extra columns. New active ad sessions can revert to old queue release behavior after a rollback.

## Verification record

Local backend: 170 tests plus 4 issuer tests passed, including early completion, signature/origin rejection, idempotency, persistent progress, expiry, legacy opt-out, transient database failures, and router delivery/ACK gating. Type checking, the deployment dry run and diff whitespace checks passed.

All 22 browser tests passed. Checks cover the real local signed-router flow and public flow, 320px phone, desktop, landscape, slow or failed first image, stalled A+ loading and expiry, backgrounding, refresh, blocked autoplay, actual muted playback, and the unchanged signup/final page. Final-run screenshots are under `test-results/flyby-release/`.

Production: additive migration `0005_visible_ad_gate.sql` applied successfully. Worker version `862f9b10-f4d3-49ee-b17d-b64e7a2804aa` deployed with the same-domain static assets. Prior version for rollback: `6a63327c-c5f7-4dc1-bda7-6464620c78e4`.

Live checks passed through both `https://wifi.pixii.ai` and `https://wifi.joinpixii.com`, including artwork, video and client script delivery. One clearly labelled team-test signup verified signed start, rejection of premature completion, completion after the delay, idempotent retry and connected status. Test record `00d762ff-5707-47f2-bf90-d7b3ccbd102e` persisted `ad_visible_ms=7000` and server elapsed time of 10,269ms. It created no router authorization queue entry and does not send messages. The standard production smoke check also passed.

Physical router, SIM and native iOS/Android captive window testing still requires Monte's hardware. Browser device emulation is not a physical-router test.

## Follow-up: continuous A+ artwork and looping wait

The A+ stage now uses the supplied seamless portrait preview on every viewport, with all four panels in one continuous image. The artwork sequence repeats after seven seconds while authorization is pending, including restarting the supplied video. The countdown remains at zero and the real flow displays “Finishing connection…” until confirmation; preview mode also repeats. Background pauses and refresh recovery retain their existing behavior. No backend timing, database or router-package changes were needed.

The new client is served as `experience-v2.js`, preserving the previous immutable asset for already-open pages. Type checking, 170 backend tests, 26 browser tests and the deployment dry run passed. Browser checks explicitly cover delayed authorization, second-loop video playback, preview looping and a single uncropped portrait A+ image on desktop, narrow phones and landscape. Screenshots are in `test-results/flyby-loop/`.

Deployed version: `2eb332c7-2701-4840-9253-446e0c197ad0`. Previous version: `862f9b10-f4d3-49ee-b17d-b64e7a2804aa`.

## Follow-up: Pixii orange branding

Connecting-only CSS now uses the logo's exact `#D65831` orange across the body, header, artwork stage, footer and safe areas. The scoped white logo is 132px on desktop and 110px on phones, with its description below in every orientation. Dark supporting text (`#17110F`) has a measured 4.72:1 contrast ratio against the background. Artwork colors and proportions, the continuous A+ image, timing and looping are unchanged. No API, database, signup, final-screen or router-package changes were made.

Type checking, the deployment dry run and all 26 existing browser tests passed. Visual review covered all three scenes at desktop, 320px portrait and phone landscape sizes. Screenshots from the full run are under `test-results/pixii-orange/`; the final landscape-header refinement is checked separately under `test-results/pixii-orange-final-layout/`.

The final layout check passed. Published version `bd164c6f-cb22-4c84-8fc6-8be73a40d305`; previous version `2eb332c7-2701-4840-9253-446e0c197ad0`. Live checks passed on both Wi-Fi domains for the connecting page and media delivery, and confirmed that the orange styles are absent from signup and final confirmation.

## Follow-up: white bands around the orange stage

Per user direction, restored crisp white header/footer bands and the orange Pixii logo while retaining the orange artwork stage. The full-orange treatment is superseded. Type checking, deployment dry run and the existing viewport-layout and delayed-connection looping checks passed. Screenshots are under `test-results/pixii-white-bands/`. Published version: `6e626cb1-565d-4496-930a-83115073a5f4`; previous version: `bd164c6f-cb22-4c84-8fc6-8be73a40d305`. Five generated layout concepts are for user selection only and have not been implemented.

## Selected concept: Gallery Wall

The user selected concept 4. The listing scene now contains seven unique artworks: the PT01 hero plus MAIN and PT02–PT06 as a tight three-column, two-row gallery. Desktop places the hero beside the gallery; portrait phones place the hero above it. The white bands, orange stage, complete A+ composition and looping video sequence remain. Source images retain their proportions and text without additional cropping.

Type checking, 170 backend tests, the viewport-layout browser check, the delayed-connection loop check and deployment dry run passed. Reviewed desktop, 320px portrait and phone-landscape screenshots are under `test-results/pixii-gallery-wall/`.

Published version: `fe7d9ce6-476f-486d-a787-47c368d2b06b`; previous version: `6e626cb1-565d-4496-930a-83115073a5f4`.

## Selected background: orange lower band

The user selected background concept 3. The shared artwork stage now has a flat ivory (`#FFF7ED`) upper two thirds and solid Pixii orange (`#D65831`) lower third, separated by a crisp horizontal edge. This applies throughout listings, A+ and video. Gallery geometry, artwork, white header/footer and connection timing remain unchanged. Type checking, the existing desktop/phone/landscape layout test and deployment dry run passed; screenshots are under `test-results/pixii-lower-band/`.

Published version: `649f9b3f-4b8b-44a6-a59a-7251be511709`; previous version: `635c2a85-2af5-4019-afec-87cc8b04a690`.

## Follow-up: balanced sponsor header

Reduced the connecting header logo to 88px on desktop and 76px on phones and landscape. The sponsor prefix is quieter at 12px in muted ink, with the 13px medium-weight description grouped underneath. Consistent spacing keeps the header compact without changing copy, artwork, the selected background or connection behavior.

Type checking, whitespace checks, deployment dry run and the existing desktop/320px-phone/landscape layout test passed. Reviewed screenshots are under `test-results/pixii-header-hierarchy/`. Live read-only smoke checks passed for the page and same-domain artwork/video/script; the public domain serves the updated header styles.

Published version: `82d9cd9a-5ca9-47b5-956d-f4218765cca9`; previous version: `649f9b3f-4b8b-44a6-a59a-7251be511709`.

## Follow-up: continuous beige header

Changed only the connecting header background from white to `#FFF7ED`, matching the upper artwork-stage background. The footer remains white. Typography, artwork, signup, connection behavior and router package are unchanged. Type checking, desktop/narrow-phone/landscape layout verification and the deployment dry run passed; screenshots are under `test-results/beige-header/`.

Published version: `a1fd827f-b924-4a33-8743-a23ad19074a2`; previous version: `0b55acf1-2ecd-42f0-832d-cb9a3d76d014`.
