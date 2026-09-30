import { CONSENT_TEXT } from "./config";
import { connectingContent as flybyContent, CONNECTING_STYLES } from "./connecting";
import { APP_THEME_STYLES } from "./app-theme";
import examples from "libphonenumber-js/examples.mobile.json";
import {
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  isSupportedCountry,
  type CountryCode
} from "libphonenumber-js/min";
import type { RegistrationAdminRow } from "./repository";

const PRIVACY_URL = "https://www.pixii.ai/privacy/";
export const PIXII_CTA_URL =
  "https://www.pixii.ai/ads/?utm_source=event_wifi&utm_medium=captive_portal&utm_campaign=amazon_unboxed_sf_2026";

// Kept identical to the pinned, approved SVG in src/assets/pixii-logo.svg so
// browser tests can import this renderer without a non-JavaScript asset loader.
const PIXII_LOGO_SVG = `<svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 823.75 219.27"><defs><style>.cls-1,.cls-2{fill:#d65831;}.cls-2{fill-rule:evenodd;}</style></defs><path class="cls-1" d="M39,381.41H7.65v-206H73.2c55.39,0,91.4,24.9,91.4,72.85,0,49.19-36.62,73.78-89.86,73.78H39ZM74.12,204.34H39v88.54H74.12c33.85,0,58.17-13.22,58.17-44.58C132.29,218.18,108.9,204.34,74.12,204.34Z" transform="translate(-7.65 -162.14)"/><path class="cls-1" d="M202.32,230.78h30.47V381.41H202.32Z" transform="translate(-7.65 -162.14)"/><path class="cls-1" d="M312.89,381.41H278.42l38.16-57.18c4.62-6.76,6.77-12.6,6.77-18.14,0-5.22-1.85-10.45-6.15-16.9l-38.78-58.41h34.47l30.77,45.8a47.22,47.22,0,0,1,6.77,15.07h16.31a55.46,55.46,0,0,1,6.77-15.07L404,230.78h34.78L400,289.19c-4.31,6.45-6.16,11.68-6.16,16.9,0,5.54,2.16,11.38,6.78,18.14l38.16,57.18H404.29l-30.78-45.5a57.26,57.26,0,0,1-7.38-16.6H351.05a57,57,0,0,1-7.39,16.6Z" transform="translate(-7.65 -162.14)"/><path class="cls-1" d="M484.52,230.78H515V381.41H484.52Z" transform="translate(-7.65 -162.14)"/><path class="cls-1" d="M570.78,230.78h30.46V381.41H570.78Z" transform="translate(-7.65 -162.14)"/><path class="cls-2" d="M505.41,166.49a24.71,24.71,0,0,0,19.12,19.11,5.47,5.47,0,0,1,0,10.72,24.71,24.71,0,0,0-19.12,19.11,5.49,5.49,0,0,1-10.74,0,24.69,24.69,0,0,0-19.12-19.1,5.47,5.47,0,0,1,0-10.72,24.72,24.72,0,0,0,19.13-19.11,5.48,5.48,0,0,1,10.73,0Zm-4.9,16.78-8.16,8.16,8.16,8.15,8.16-8.15Z" transform="translate(-7.65 -162.14)"/><path class="cls-2" d="M590,166.49a24.72,24.72,0,0,0,19.12,19.11,5.47,5.47,0,0,1,0,10.72A24.72,24.72,0,0,0,590,215.43a5.49,5.49,0,0,1-10.74,0,24.69,24.69,0,0,0-19.12-19.1,5.47,5.47,0,0,1,0-10.72,24.72,24.72,0,0,0,19.13-19.11,5.48,5.48,0,0,1,10.73,0Zm-4.9,16.78L577,191.43l8.16,8.15,8.16-8.15Z" transform="translate(-7.65 -162.14)"/><path class="cls-1" d="M653.25,381.41H621.77V349.26h31.48Z" transform="translate(-7.65 -162.14)"/><path class="cls-1" d="M778.22,379.13h-17.4a27.48,27.48,0,0,1-10.15-1.87,16.78,16.78,0,0,1-7.77-6.12q-3-4.25-3-11.51V324.57l.83-4.15q0-9.33-3.11-14.52t-13.46-5.18a34.86,34.86,0,0,0-18,4.87,43.3,43.3,0,0,0-13.67,12.55l-14.92-21.57a61.53,61.53,0,0,1,12.22-10.38,68.63,68.63,0,0,1,16.47-7.78,64.17,64.17,0,0,1,20-3q19.26,0,29.93,10.06t10.66,29.14v34.85c0,2.22.45,3.77,1.35,4.67a5.48,5.48,0,0,0,4,1.35h6ZM707,381.41q-11.81,0-19.26-6.33t-7.45-18.56q0-11.62,7.35-18.78t21.64-12.13L743,313l2.69,17.64L718.36,342q-6,2.49-8.38,4.87a7.35,7.35,0,0,0-2.39,5.29,6.53,6.53,0,0,0,2.59,5.5q2.6,2,7.77,2a30,30,0,0,0,9.32-1.35,19.31,19.31,0,0,0,6.94-3.84,16.24,16.24,0,0,0,4.24-6,21.68,21.68,0,0,0,1.45-8.3l.62,10a57.38,57.38,0,0,1-5.07,14,34.4,34.4,0,0,1-10.56,12.24Q717.95,381.4,707,381.41Z" transform="translate(-7.65 -162.14)"/><path class="cls-1" d="M831.39,267.73H801.78V242.42h29.61Zm0,113.68H801.78V279.76h29.61Z" transform="translate(-7.65 -162.14)"/></svg>`;

const STYLES = `
:root{color-scheme:light;--orange:#d65831;--orange-dark:#b74725;--ink:#17110f;--muted:#6b625e;--line:#d8d2ce;--soft:#f7f5f3;--error:#b42318;--green:#17823b;--amber:#c56b12}
*{box-sizing:border-box}
html,body{margin:0;min-width:0;overflow-x:hidden}
body{background:#fff;color:var(--ink);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.42;padding:28px 20px 48px}
main{margin:0 auto;width:min(100%,560px)}
.card{background:transparent;border:0;border-radius:0;box-shadow:none;padding:0}
.logo{display:block;line-height:0;margin:0 0 30px;width:118px}.logo svg{display:block;height:auto;width:100%}
.eyebrow{color:var(--orange);font-size:.8rem;font-weight:800;letter-spacing:.08em;margin:0 0 10px;text-transform:uppercase}
.hero{border-bottom:1px solid var(--line);margin-bottom:26px;padding-bottom:24px}
h1{margin:0}.hero-title{display:block;font-size:clamp(3rem,15vw,4.6rem);font-weight:850;letter-spacing:-.068em;line-height:.88}.hero-byline{display:block;font-size:clamp(1.3rem,6vw,1.75rem);font-weight:760;letter-spacing:-.036em;line-height:1.08;margin-top:18px;max-width:21ch}
.showcase-listings{margin:26px 0 20px}.showcase-listings img{display:block;height:auto;width:100%}
.proof{align-items:end;display:grid;gap:6px 16px;grid-template-columns:1fr auto;margin:0}.proof-input,.proof-time{font-size:.76rem;font-weight:850;letter-spacing:.075em;line-height:1.2;text-transform:uppercase}.proof-time{color:var(--orange);grid-column:2;grid-row:1;text-align:right}.proof-output{font-size:clamp(1.7rem,7.6vw,2.35rem);font-weight:850;grid-column:1/-1;grid-row:2;letter-spacing:-.05em;line-height:.96}
form,.preview-form{border:0;padding:0}
.field{display:block;margin:0 0 18px}.field-label{display:block;font-size:.88rem;font-weight:750;margin:0 0 7px}.required-marker{color:var(--orange-dark);font-weight:850;margin-left:.16em}
input[type=text],input[type=email],input[type=tel],select{appearance:none;background:#fff;border:1px solid #8f8782;border-radius:2px;color:var(--ink);font:inherit;font-size:1rem;min-height:50px;padding:12px 13px;width:100%}
input::placeholder{color:#8b837e;opacity:1}
input:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid rgba(214,88,49,.24);outline-offset:2px}
input[aria-invalid=true],select[aria-invalid=true],.phone-control:has(input[aria-invalid=true]){border-color:var(--error);box-shadow:inset 0 0 0 1px var(--error)}
.phone-control{align-items:stretch;border:1px solid #8f8782;border-radius:2px;display:flex;min-height:50px}.phone-control:focus-within{outline:3px solid rgba(214,88,49,.24);outline-offset:2px}.phone-control select{background-color:var(--soft);background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 15px) 22px,calc(100% - 10px) 22px;background-repeat:no-repeat;background-size:5px 5px;border:0;border-right:1px solid var(--line);flex:0 0 108px;font-size:.88rem;font-weight:750;min-height:48px;padding:11px 26px 11px 10px}.phone-control input{border:0;min-width:0}.phone-control input:focus-visible,.phone-control select:focus-visible{outline:0}
.consent-row{align-items:flex-start;display:flex;gap:11px;margin:4px 0 20px;min-height:44px}.consent-row input{accent-color:var(--orange);border-radius:0;flex:0 0 auto;height:22px;margin:1px 0 0;width:22px}.consent-row input[aria-invalid=true]{outline:2px solid var(--error);outline-offset:2px}.consent-copy{font-size:.83rem;line-height:1.42}
.links{color:#757575;font-size:.76rem;line-height:1.5;margin:14px 0 0}.links a,.notice a{color:inherit;font-weight:400}.links a{text-decoration:none}
.error{color:var(--error);font-size:.8rem;font-weight:650;margin:6px 0 0}.error[hidden]{display:none}.form-error{border-left:3px solid var(--error);margin:0 0 18px;padding:7px 10px}
button,.button{align-items:center;background:var(--orange);border:1px solid var(--orange);border-radius:2px;color:#fff;cursor:pointer;display:inline-flex;font:inherit;font-weight:800;justify-content:center;min-height:50px;padding:12px 18px;text-decoration:none;width:100%}
button:hover,.button:hover{background:var(--orange-dark);border-color:var(--orange-dark)}button:disabled{cursor:wait;opacity:.68}
.status{align-items:center;display:flex;flex-direction:column;justify-content:center;min-height:calc(100vh - 76px);text-align:center}.status .logo{margin-left:auto;margin-right:auto}.status h1{font-size:clamp(2.25rem,11vw,3.4rem)}.status p{color:var(--muted);margin:12px 0 26px}.connection-state{align-items:center;color:var(--ink)!important;display:inline-flex;font-size:.86rem;font-weight:800;gap:8px;letter-spacing:.02em;margin:0 0 14px!important}.status-dot{background:var(--amber);border-radius:50%;display:inline-block;height:10px;width:10px}.status-dot.is-connected{background:var(--green);box-shadow:0 0 0 4px rgba(23,130,59,.12)}.status-dot.is-denied{background:var(--error)}
.sponsor{align-items:center;display:flex;gap:8px;margin:20px 0 7px;color:var(--muted);font-size:.8rem;line-height:1;white-space:nowrap}.sponsor .logo{flex:0 0 auto;margin:0;width:72px}.sponsor-copy{color:var(--muted);font-size:.9rem;line-height:1.5;margin:0;max-width:34ch}.signup-title{font-size:clamp(2.25rem,9vw,3.2rem);font-weight:800;letter-spacing:-.05em;line-height:1.06;max-width:13ch}.signup-header{margin-bottom:30px}
.connecting-ad{padding-top:8px;text-align:left}.connecting-ad .connection-state{border-bottom:1px solid var(--line);color:var(--muted)!important;display:flex;font-size:.8rem;font-weight:600;gap:9px;letter-spacing:0;margin:0!important;padding-bottom:20px;width:100%}.connecting-ad .status-dot{height:7px;width:7px;flex:0 0 auto}.ad-story{padding-top:32px}.ad-story .sponsor{margin-top:0}.ad-story .sponsor-copy{max-width:none}.connecting-ad .proof{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-top:34px;text-align:left}.connecting-ad .proof-input{color:var(--muted);font-size:.88rem;font-weight:500;letter-spacing:0;text-transform:none}.connecting-ad .proof-output{font-size:clamp(2.25rem,10vw,3.6rem);font-weight:800;letter-spacing:-.055em;line-height:1.02;max-width:13ch}.connecting-ad .proof-time{color:var(--orange-dark);font-size:1rem;font-weight:650;letter-spacing:0;margin-top:4px;text-transform:none}.connecting-ad .showcase-listings{width:100%;margin:26px 0 0}
.status.online{align-items:stretch;text-align:left;min-height:calc(100svh - 76px)}.online .logo{margin:0 0 48px;width:88px}.online .connection-state{font-size:.8rem;font-weight:600;gap:9px;letter-spacing:0;margin-bottom:12px!important}.online .status-dot{height:8px;width:8px}.online h1{font-size:clamp(2.75rem,12vw,4.2rem);font-weight:800;letter-spacing:-.055em;line-height:1.04}
.arrow-cta{position:relative;overflow:hidden;align-items:center;background:var(--orange-dark);border:1px solid var(--orange-dark);border-radius:2px;color:#fff;cursor:pointer;display:grid;gap:18px;grid-template-columns:minmax(0,1fr) 42px;margin-top:40px;padding:22px 20px;text-decoration:none;transition:background .15s ease,border-color .15s ease}
.arrow-cta:hover{background:#9e3e20;border-color:#9e3e20}.arrow-cta:active{background:#89351b;border-color:#89351b}.arrow-cta:focus-visible{outline:3px solid var(--ink);outline-offset:4px}
.cta-copy{display:flex;flex-direction:column;font-size:clamp(1.15rem,5vw,1.45rem);font-weight:650;letter-spacing:-.02em;line-height:1.3}.arrow-cta small{color:#fff;font-size:.85rem;font-weight:400;letter-spacing:0;margin-top:9px}.cta-arrow{color:currentColor;height:30px;width:42px;transition:transform .15s ease}.arrow-cta:hover .cta-arrow{transform:translateX(4px)}@media(prefers-reduced-motion:reduce){.cta-arrow,.arrow-cta{transition:none}}
.cta-progress{position:absolute;bottom:0;left:0;width:100%;height:5px;background:rgba(255,255,255,.2);overflow:hidden}.cta-progress span{display:block;width:100%;height:100%;background:#fff;transform:scaleX(0);transform-origin:left center}.status.online .redirect-note{color:var(--muted);font-size:.75rem;font-weight:400;margin:12px 0 0}
.online .browser-action{display:none}.online .browser-fallback{margin-top:8px;font-size:.8rem}.online .browser-fallback[hidden]{display:none}.online .browser-fallback a,.online .browser-fallback button{color:var(--ink);font:inherit;text-decoration:underline;text-underline-offset:3px}.online .browser-fallback button{background:none;border:0;border-radius:0;display:inline-block;min-height:44px;width:auto;padding:8px 12px;margin-left:8px}.online .browser-fallback p{font-size:.75rem;margin:4px 0}.online .browser-fallback input{font-size:.75rem;margin-top:8px}
.notice h1{font-size:2.25rem}.notice h2{font-size:1.05rem;margin:24px 0 6px}.notice p{margin:0 0 12px}.fine{color:var(--muted);font-size:.78rem}
.preview-banner{color:var(--muted);font-size:.82rem;margin:0 0 22px;text-align:center}.preview-banner strong{color:var(--orange)}
.team-nav{display:flex;gap:12px;margin:0 0 14px}.team-nav a{color:var(--orange-dark);font-size:.82rem;font-weight:750}.team-note{border-left:3px solid var(--orange);color:#74402c;font-size:.82rem;margin:0 0 22px;padding:7px 10px}.data-card{width:min(100%,900px)}.data-wrap{overflow-x:auto}table{border-collapse:collapse;font-size:.82rem;width:100%}th,td{border-bottom:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top;white-space:nowrap}th{color:var(--muted);font-size:.72rem;letter-spacing:.05em;text-transform:uppercase}.empty{color:var(--muted)}
@media (max-width:359px){body{padding:22px 14px 36px}.hero-title{font-size:2.75rem}.hero-byline{font-size:1.2rem}.proof-output{font-size:1.55rem}.phone-control select{flex-basis:96px;padding-left:8px}}
`;

export interface SignupValues {
  fullName: string;
  email: string;
  phoneCountry: string;
  phone: string;
}

export interface SignupPageInput {
  formState: string;
  analyticsContext?: string;
  fas?: string;
  iv?: string;
  values?: Partial<SignupValues>;
  errors?: Record<string, string>;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function logo(): string {
  return `<div class="logo" role="img" aria-label="Pixii.ai">${PIXII_LOGO_SVG}</div>`;
}

export function documentShell(title: string, content: string, bodyClass = ""): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(title)}</title><style>${STYLES}${bodyClass.split(" ").includes("app-theme") ? APP_THEME_STYLES : ""}${bodyClass.split(" ").includes("flyby-ad") ? CONNECTING_STYLES : ""}</style></head>
<body class="${escapeHtml(bodyClass)}"><main>${content}</main></body></html>`;
}

function fieldError(errors: Record<string, string>, field: string): string {
  const error = errors[field];
  return `<p class="error" id="${field}-error" role="alert" aria-live="polite"${error ? "" : " hidden"}>${escapeHtml(error ?? "")}</p>`;
}

function inputAttributes(errors: Record<string, string>, field: string): string {
  return ` aria-describedby="${field}-error"${errors[field] ? ` aria-invalid="true"` : ""}`;
}

type SignupMode = "live" | "preview" | "team-test" | "public";

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryChoices = getCountries().map((country) => {
  const callingCode = getCountryCallingCode(country);
  const name = countryDisplayNames.of(country) ?? country;
  const example = getExampleNumber(country, examples)?.formatNational() ?? "Phone number";
  return { callingCode, country, example, name };
}).sort((left, right) => left.name.localeCompare(right.name, "en"));

function normalizeSelectedCountry(value: string | undefined): CountryCode {
  const country = (value ?? "US").toUpperCase();
  return isSupportedCountry(country) ? country : "US";
}

function countryOptions(selected: CountryCode): string {
  return countryChoices.map(({ callingCode, country, example, name }) =>
    `<option value="${country}" data-calling-code="+${callingCode}" data-country-name="${escapeHtml(name)}" data-example="${escapeHtml(example)}"${country === selected ? " selected" : ""}>${country} +${callingCode}</option>`
  ).join("");
}

function phoneBehaviorScript(): string {
  return `<script>(()=>{const phoneCountry=document.getElementById("phoneCountry");const phone=document.getElementById("phone");if(!phoneCountry||!phone)return;const updatePhone=()=>{const option=phoneCountry.options[phoneCountry.selectedIndex];phone.dataset.example=option.dataset.example||"Phone number";phone.placeholder=phone.dataset.example;};phoneCountry.addEventListener("change",updatePhone);updatePhone();})();</script>`;
}

function formBehaviorScript(): string {
  return `<script>(()=>{const form=document.getElementById("signup-form");const button=document.getElementById("connect-button");if(!form||!button)return;const messages={fullName:"Enter your full name.",email:"Enter a valid work email.",phone:"Enter a valid phone number."};const field=(id)=>document.getElementById(id);const setError=(id,message)=>{const control=field(id);const output=field(id+"-error");if(!control||!output)return;control.setAttribute("aria-invalid",message?"true":"false");output.textContent=message||"";output.hidden=!message;};const validate=(id)=>{const control=field(id);if(!control)return true;let valid=true;if(id==="consent"){valid=control.checked;control.setAttribute("aria-invalid",valid?"false":"true");return valid;}if(id==="fullName")valid=control.value.trim().length>=2&&control.value.trim().length<=100;if(id==="email")valid=control.value.trim().length>0&&control.validity.valid;if(id==="phone"){const digits=control.value.replace(/\\D/g,"");valid=digits.length>=7&&digits.length<=15;}setError(id,valid?"":messages[id]);return valid;};for(const id of ["fullName","email","phone"]){const control=field(id);control.addEventListener("blur",()=>setTimeout(()=>validate(id),0));control.addEventListener("input",()=>{if(control.getAttribute("aria-invalid")==="true")validate(id);});}field("consent").addEventListener("change",()=>validate("consent"));form.addEventListener("submit",(event)=>{const ids=["fullName","email","phone","consent"];const valid=ids.map(validate).every(Boolean);if(!valid){event.preventDefault();const first=form.querySelector('[aria-invalid="true"]');if(first)first.focus();return;}button.disabled=true;button.textContent="Connecting…";});})();</script>`;
}

function renderSignupCard(input: SignupPageInput, mode: SignupMode): string {
  const values = input.values ?? {};
  const errors = input.errors ?? {};
  const selectedCountry = normalizeSelectedCountry(values.phoneCountry);
  const selectedChoice = countryChoices.find(({ country }) => country === selectedCountry) ?? countryChoices[0]!;
  const formError = errors.form
    ? `<p class="error form-error" role="alert">${escapeHtml(errors.form)}</p>`
    : "";
  const containerStart = mode === "preview"
    ? `<div id="signup-form" class="preview-form" role="group" aria-label="Wi-Fi signup form preview">`
    : `<form id="signup-form" method="post" action="${mode === "public" ? "/" : mode === "team-test" ? "/preview/test" : "/router/fas/submit"}" novalidate>
<input type="hidden" name="state" value="${escapeHtml(input.formState)}">
<input type="hidden" name="fas" value="${escapeHtml(input.fas ?? "")}">
<input type="hidden" name="iv" value="${escapeHtml(input.iv ?? "")}">${input.analyticsContext ? `<input type="hidden" name="analyticsContext" value="${escapeHtml(input.analyticsContext)}">` : ""}`;
  const button = mode === "preview"
    ? `<button type="button">Connect to Wi-Fi</button>`
    : `<button id="connect-button" type="submit">Connect to Wi-Fi</button>`;
  const containerEnd = mode === "preview" ? "</div>" : `</form>${formBehaviorScript()}`;

  return `<section class="card">
<header class="signup-header">
<div class="sponsor"><span>Wi-Fi powered by</span>${logo()}</div>
<h1 class="signup-title">Get free, fast Wi-Fi.</h1>
</header>
${formError}
${containerStart}
<label class="field" for="fullName"><span class="field-label">Full name</span><input id="fullName" name="fullName" type="text" autocomplete="name" maxlength="100" required value="${escapeHtml(values.fullName ?? "")}"${inputAttributes(errors, "fullName")}>${fieldError(errors, "fullName")}</label>
<label class="field" for="email"><span class="field-label">Work email</span><input id="email" name="email" type="email" autocomplete="email" maxlength="254" required value="${escapeHtml(values.email ?? "")}"${inputAttributes(errors, "email")}>${fieldError(errors, "email")}</label>
<label class="field" for="phone"><span class="field-label">Phone number</span><span class="phone-control"><select id="phoneCountry" name="phoneCountry" aria-label="Country calling code" required${inputAttributes(errors, "phoneCountry")}>${countryOptions(selectedCountry)}</select><input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="32" required value="${escapeHtml(values.phone ?? "")}" placeholder="${escapeHtml(selectedChoice.example)}" data-example="${escapeHtml(selectedChoice.example)}"${inputAttributes(errors, "phone")}></span>${fieldError(errors, "phoneCountry")}${fieldError(errors, "phone")}</label>
<label class="consent-row" for="consent"><input id="consent" name="consent" type="checkbox" value="accepted" required${errors.consent ? ' aria-invalid="true"' : ""}><span class="consent-copy">${escapeHtml(CONSENT_TEXT)}</span></label>
${button}
<p class="links"><a href="${PRIVACY_URL}">Privacy Policy</a><span aria-hidden="true">·</span><a href="/notice">Notice of Collection</a></p>
${containerEnd}
${phoneBehaviorScript()}
${input.analyticsContext ? `<script>window.pixiiTracking={context:${safeScriptJson(input.analyticsContext)},page:"form"};</script><script src="/assets/analytics-v1.js" defer></script>` : ""}
</section>`;
}

export function renderSignupPage(input: SignupPageInput): string {
  return documentShell("Connect to event Wi-Fi | Pixii", renderSignupCard(input, "live"), "app-theme");
}

export function renderPublicSignupPage(input: SignupPageInput): string {
  return documentShell("Connect to event Wi-Fi | Pixii", renderSignupCard(input, "public"), "app-theme");
}

export function renderPreviewPage(): string {
  const content = `<p class="preview-banner"><strong>Form preview</strong> — details entered here are not submitted.</p>
${renderSignupCard({ formState: "" }, "preview")}`;
  return documentShell("Form preview | Pixii", content, "app-theme preview-page");
}

function safeScriptJson(value: string): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c").replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
}

export function renderWaitingPage(registrationId: string, statusToken: string, requiresGate = true): string {
  const endpoint = `/router/fas/status/${encodeURIComponent(registrationId)}?token=${encodeURIComponent(statusToken)}`;
  if (requiresGate) {
    const content = `${flybyContent()}<noscript><p class="flyby-noscript">Please enable JavaScript, then refresh this page to finish connecting.</p></noscript><script>const endpoint=${safeScriptJson(endpoint)};window.pixiiAd={endpoint,registrationId:${safeScriptJson(registrationId)},token:${safeScriptJson(statusToken)},connectedHtml:${safeScriptJson(connectedContent())},preview:false};</script><script src="/assets/connected-v3.js" defer></script><script src="/assets/flybyjing/v1/experience-v7.js" defer></script>`;
    return documentShell("Connecting | Pixii", content, "app-theme flyby-ad");
  }
  const content = `${connectingContent()}<noscript><p>JavaScript is off. Wait a moment, then refresh this page to check your connection.</p></noscript>
<script src="/assets/connected-v3.js" defer></script><script>(()=>{const endpoint=${safeScriptJson(endpoint)};const shownAt=performance.now();const check=async()=>{try{const response=await fetch(endpoint,{headers:{accept:"application/json"},cache:"no-store"});if(!response.ok)throw new Error();const data=await response.json();if(data.status==="connected"&&performance.now()-shownAt>=6000){document.querySelector("main").innerHTML=${safeScriptJson(connectedContent())};document.title="You\u2019re online | Pixii";document.body.classList.add("app-theme");document.dispatchEvent(new Event("pixii:connected"));return;}if(data.status==="expired"){document.getElementById("status-message").textContent="This connection request expired. Rejoin the Wi-Fi and try again.";return;}setTimeout(check,500);}catch{setTimeout(check,1800);}};setTimeout(check,700);})();</script>`;
  // Load the scoped theme for the eventual success view without changing legacy waiting screens.
  return documentShell("Connecting | Pixii", `<style>${APP_THEME_STYLES}</style>${content}`);
}

function sponsor(description: string): string {
  return `<div class="sponsor"><span>Brought to you by</span>${logo()}</div><p class="sponsor-copy">${description}</p>`;
}

function connectingContent(): string {
  return `<section class="card connecting-ad"><p class="connection-state" id="status-message"><span class="status-dot" aria-hidden="true"></span>Connecting you to the Wi-Fi</p><div class="ad-story">${sponsor("AI that designs Amazon listings and ads")}<p class="proof"><span class="proof-input">One product photo.</span><span class="proof-output">Seven editable visuals.</span></p><figure class="showcase-listings"><img src="/assets/dr-squatch-complete-listing.webp" width="1800" height="900" alt="Complete Dr. Squatch example: one product photo, seven Amazon listing images, a video preview, Premium A+ content, and Mobile A+ content created with Pixii." decoding="async" fetchpriority="high"></figure></div></section>`;
}

export function connectedContent(destination = PIXII_CTA_URL): string {
  // CircleCheck and ArrowRight paths from lucide-react (ISC), matching the app's 1.5px icons.
  return `<section class="card status online"><h2 class="connection-state" tabindex="-1" aria-describedby="redirect-note"><svg class="status-dot is-connected" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>You’re online</h2><h1>Now try Pixii on your product</h1><p class="online-subtitle">Design Amazon ads, videos, or listings, instantly</p><div class="online-action"><a class="arrow-cta" href="${escapeHtml(destination)}" target="_blank" rel="noopener noreferrer" aria-describedby="redirect-note"><span class="cta-copy">Design my ads<span class="browser-action" id="browser-action">Open in your browser</span></span><svg class="cta-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a><p class="cta-note">Free. No credit card needed. Results in 2 minutes.</p><p class="redirect-note" id="redirect-note">Opening Pixii in <span id="redirect-seconds">5</span> seconds...</p><div class="cta-progress" role="progressbar" aria-label="Opening Pixii" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span aria-hidden="true"></span></div><div class="browser-fallback" id="browser-fallback" hidden><a id="open-here" href="${escapeHtml(destination)}">Open Pixii here</a><button type="button" id="copy-pixii-link">Copy link</button><p id="copy-status" role="status"></p><input id="pixii-link" type="text" readonly aria-label="Pixii website link" hidden></div></div></section>`;
}

export function renderConnectedPage(): string {
  return documentShell("You're online | Pixii", connectedContent() + '<script src="/assets/connected-v3.js" defer></script>', "app-theme");
}

export function renderConnectingPreviewPage(): string {
  const content = `${flybyContent()}<script>window.pixiiAd={preview:true,registrationId:"preview"};</script><script src="/assets/flybyjing/v1/experience-v6.js" defer></script>`;
  return documentShell("Connecting preview | Pixii", content, "app-theme flyby-ad");
}

export function renderTeamTestPage(input: SignupPageInput): string {
  const content = `<nav class="team-nav" aria-label="Team test"><a href="/preview">Public preview</a><a href="/preview/data">Test submissions</a></nav><p class="team-note"><strong>Team test:</strong> this writes to the production registrations database as <code>team_test</code>, but it does not unlock Wi-Fi.</p>${renderSignupCard(input, "team-test")}`;
  return documentShell("Team form test | Pixii", content, "app-theme preview-page");
}


export function renderTeamTestDataPage(rows: readonly RegistrationAdminRow[]): string {
  const body = rows.length === 0
    ? `<p class="empty">No Wi-Fi registrations yet.</p>`
    : `<div class="data-wrap"><table><thead><tr><th>Created</th><th>Name</th><th>Email</th><th>Country</th><th>Phone</th><th>Source</th><th>Status</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.createdAt)}</td><td>${escapeHtml(row.fullName)}</td><td>${escapeHtml(row.email)}</td><td>${escapeHtml(row.phoneCountry)}</td><td>${escapeHtml(row.phoneE164)}</td><td>${escapeHtml(row.submissionSource)}</td><td>${escapeHtml(row.authorizationStatus)}</td></tr>`).join("")}</tbody></table></div>`;
  const content = `<nav class="team-nav" aria-label="Team test"><a href="/preview/test">Test the form</a><a href="/preview">Public preview</a></nav><section class="card data-card">${logo()}<p class="eyebrow">Developer view</p><h1>Wi-Fi registrations</h1><p class="fine">Production database rows from both the team test and the router. Newest first.</p>${body}</section>`;
  return documentShell("Wi-Fi registrations | Pixii", content, "preview-page");
}

export function renderDeniedPage(reference?: string): string {
  const supportReference = reference ? `<p class="fine">Reference: ${escapeHtml(reference)}</p>` : "";
  const content = `<section class="card status">${logo()}<p class="connection-state"><span class="status-dot is-denied" aria-hidden="true"></span>Not connected</p><h1>We couldn’t connect you yet.</h1><p>Rejoin the event Wi-Fi and try the form again.</p>${supportReference}</section>`;
  return documentShell("Try again | Pixii", content);
}

export function renderNoticePage(): string {
  const content = `<article class="card notice">${logo()}<p class="eyebrow">Event Wi-Fi</p><h1>Notice at Collection</h1><h2>What we collect</h2><p>We collect your name, work email, and phone number.</p><h2>Why we collect it</h2><p>We use this information to provide Wi-Fi access and send Pixii marketing communications that you agreed to receive.</p><h2>Analytics and advertising</h2><p>When permitted, we measure this Wi-Fi journey using random references in PostHog. After connection, enabled Meta, Google, LinkedIn and RB2B integrations may collect device and browsing information for measurement and advertising. We do not send your form details or router credentials in these analytics events. Agreeing to marketing messages is not permission for all tracking. We honor Global Privacy Control and recorded tracking opt-outs; where required permission is unavailable, advertising trackers stay off.</p><h2>How long we keep it</h2><p>We retain this event registration for 365 days. Local analytics delivery records are kept for up to 30 days and handoff tokens expire after 10 minutes. Vendor retention follows the settings and policies described in our Privacy Policy.</p><p>Read the full <a href="${PRIVACY_URL}">Pixii Privacy Policy</a>.</p><p class="fine">Wi-Fi powered by Pixii</p></article>`;
  return documentShell("Notice at Collection | Pixii", content);
}
