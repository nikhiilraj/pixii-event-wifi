# Design QA - B / Capsule

final result: passed

Scope: implementation candidate only. No production deployment has happened.

## Source and comparison

- Selected source: B / Capsule, the middle row of `exec-719a0c78-b4e4-41a7-8701-adb9a0d7a90a.png` from this chat's generated-image directory.
- Token/font authority: actual `pixii-ai-app-frontend` production source at `cda4a4ae72bb8e8c907f67d450b9206e6eca9212`, not the generated image's approximate typefaces or blue-grey tint.
- Source B and rendered three-screen screenshots were displayed together on the local comparison board (`outputs/app-theme-review/serve.mjs` in the parent workspace, loopback port 8789). Source screen widths were normalized to 390px for comparison; the mockup is a concept board, not a specified device viewport.
- Working signup was also inspected in the Codex in-app browser. Local browser test captures cover the complete actual flow and additional states.

## Reviewed areas

| Area | Result |
| --- | --- |
| Typography | Actual Cabinet Grotesk medium and Switzer files load from the same origin. Neutral supporting text, app-medium buttons, restrained heading hierarchy. |
| Composition | Sponsor only above signup; status above connecting title; short action grouped with its supporting text and neutral timer. No added enclosing cards, shadows or decorative borders. |
| Form | B capsule field shape retained. Country selector has one shared outer border and a visible library chevron. Consent has 24px separation above/below; no invented access-code or demo-message promise. |
| Status and icons | Green dot centred beside Connecting; real Lucide check and arrow at the app's 1.5px stroke. The short CTA fits narrow phones. |
| Artwork | Real hero and six original thumbnails; one complete A+ image; both videos/posters remain intact, using contain rather than cropping or stretching. |
| Phase changes | Listings/A+/Ads labels match loaded artwork. Subtitle space is reserved; failed A+ loading retains the correct Listings label. |
| Progress | Connecting still has the seven-second horizontal bar. Success has a 3px neutral bar separate from the sole orange action. |
| Responsive | Signup/success captured at 320, 390, 768, 844-landscape and 1440px. All connecting phases captured at 320, 844-landscape and 1440px. No page overflow, clipping, overlaps or missing artwork observed at those sizes. |
| Interactions | Labels, required markers, keyboard focus/error focus, consent error outline, country changes, loading, autoplay fallback, expiry, redirect and click fallback covered by local browser checks. |

## Findings addressed

- The inherited background shorthand initially removed the country dropdown chevron. Replaced it with the app's Lucide ChevronDown asset and added a regression check.
- Keeping the old connected script's button-local progress lookup would break after moving the bar. The new immutable v3 runtime queries the enclosing success screen; handoff, pause and redirect tests pass.
- A+/Ads must not shift the stage or inherit the two-minute listing claim. Visibility and accessibility state change together without removing the subtitle's layout space.
- Independent review found that replacing the connecting screen needed an accessible success announcement. The new connected runtime focuses the online heading once with the redirect description; it avoids repeated countdown announcements and does not steal existing control focus. Covered on both direct success and the router-acknowledged transition.

## Deliberate source constraints and limitations

- User requested the exact app-default orange/white CTA treatment. It is retained, not relabelled as a new WCAG-AA-certified colour palette; thin input borders and button text contrast inherit the app's existing tokens. This is a source-fidelity pass, not an accessibility certification.
- The supplied image proportions, real vector logo and native app fonts override artifacts in the AI concept board. Full capsule buttons follow the frontend component; generated rectangular button corners were not copied.
- Final CTA differs only as newly requested: `Design my listing`.
- Physical router and native Safari/Android captive-webview launch checks require those devices. Local synthetic flow passes; no physical-device claim is made.
- No unresolved blocking implementation finding in the reviewed design scope. Future P3 polish should not change the approved copy, timing or artwork.
