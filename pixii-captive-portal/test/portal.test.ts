import { describe, expect, it } from "vitest";
import logoSource from "../src/assets/pixii-logo.svg";
import {
  renderConnectedPage,
  renderDeniedPage,
  renderNoticePage,
  renderSignupPage,
  renderWaitingPage
} from "../src/portal";

const ctaUrl =
  "https://www.pixii.ai/?utm_source=event_wifi&utm_medium=captive_portal&utm_campaign=amazon_unboxed_sf_2026";

describe("signup portal", () => {
  it("keeps signup focused on connecting and shows product proof only after signup", () => {
    const html = renderSignupPage({ formState: "signed-state" });
    const hierarchy = [
      "Get free, fast Wi-Fi.",
      "Wi-Fi powered by"
    ];

    for (const copy of hierarchy) expect(html.replace(/<[^>]*>/gu, "")).toContain(copy);
    expect(html).toContain('aria-label="Pixii.ai"');
    expect(html).toContain(logoSource);
    expect(html).toContain('action="/router/fas/submit"');
    expect(html).not.toContain('src="/assets/dr-squatch-complete-listing.webp"');
    const waiting = renderWaitingPage("registration-id", "status-token");
    expect(waiting).toContain('src="/assets/flybyjing/v1/listing-hero-product.webp"');
    expect(waiting).toContain("Fly By Jing Sichuan Chili Crisp product photo");
    expect(waiting).toContain('Pixii designs <strong id="ad-category">Listings</strong>');
    expect(html).toContain('name="state" value="signed-state"');
    expect(html).not.toContain("clientip=");
    expect(html).not.toContain("Pixii—the");
    expect(html).not.toContain("Mobile A+");
    expect(html).not.toContain("Premium A+");
    expect(html).not.toContain("showcase-aplus");
    expect(html).not.toContain("stanley-one-to-seven.webp");
    expect(html).not.toContain("stanley-premium-aplus.webp");
    expect(html).not.toContain("pixii-listing-showcase.webp");
    expect(html).not.toContain("2.5 minutes");
    expect(html).not.toContain("Big brands. Busy creative teams.");
    expect(html).not.toMatch(/<(?:img|script|link)[^>]+(?:src|href)="https?:/u);
  });

  it("integrates the country selector into the phone field and keeps consent accessible", () => {
    const html = renderSignupPage({ formState: "state" });
    expect(html).toMatch(/name="fullName"[^>]+autocomplete="name"/u);
    expect(html).toMatch(/name="email"[^>]+autocomplete="email"/u);
    expect(html).toMatch(/name="phone"[^>]+autocomplete="tel"[^>]+inputmode="tel"/u);
    expect(html).toMatch(/<select[^>]+id="phoneCountry"[^>]+name="phoneCountry"/u);
    expect(html).toMatch(/<option value="US"[^>]+selected/u);
    expect(html).toContain('<option value="GB"');
    expect(html).toContain('class="phone-control"');
    expect(html).toContain('aria-label="Country calling code"');
    expect(html).not.toContain('<span class="field-label">Country</span>');
    expect(html).toMatch(/name="consent"[^>]+value="accepted"[^>]+required/u);
    expect(html.match(/name="consent"[^>]*>/u)?.[0]).not.toContain("checked");
    expect(html).toContain('href="https://www.pixii.ai/privacy/"');
    expect(html).toContain('href="/notice"');
    expect(html).toContain("I agree to receive marketing communications from Pixii.ai. Unsubscribe anytime.");
    expect(html).not.toContain("Required to connect.");
    expect(html.match(/class="required-marker"/gu)).toHaveLength(4);
    expect(html.match(/class="required-marker" aria-hidden="true">\*<\/span>/gu)).toHaveLength(4);
  });

  it("includes inline field errors while marking consent required without an error sentence", () => {
    const html = renderSignupPage({ formState: "state" });

    expect(html).toContain("Enter your full name.");
    expect(html).toContain("Enter a valid work email.");
    expect(html).toContain("Enter a valid phone number.");
    expect(html).not.toContain("Please check the box to connect to Wi-Fi.");
    expect(html).not.toContain('id="consent-error"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('replace(/\\D/g,"")');
  });

  it("updates the calling code and example when the selected country changes", () => {
    const html = renderSignupPage({ formState: "state" });
    expect(html).toContain("phoneCountry.addEventListener");
    expect(html).toContain("phone.dataset.example");
    expect(html).toContain("phone.placeholder");
  });

  it("escapes every echoed value and field error", () => {
    const attack = `\"><script>alert('x')&</script>`;
    const html = renderSignupPage({
      formState: attack,
      values: { fullName: attack, email: attack, phone: attack },
      errors: { fullName: attack, email: attack, phone: attack, consent: attack, form: attack }
    });

    expect(html).not.toContain(attack);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&amp;&lt;/script&gt;");
  });

  it("provides a disabled connecting state and a no-JavaScript retry explanation", () => {
    const signup = renderSignupPage({ formState: "state" });
    const waiting = renderWaitingPage("registration-id", "status-token");
    expect(signup).toContain("Connecting…");
    expect(waiting).toContain("Connecting");
    expect(waiting).toContain("<noscript>");
    expect(waiting).toContain("refresh this page");
    expect(waiting).toContain("/router/fas/status/registration-id?token=status-token");
  });
});

describe("portal result pages", () => {
  it("renders the connected page and intentional Pixii CTA", () => {
    const html = renderConnectedPage();
    expect(html).toContain("You’re online</h2>");
    expect(html).not.toContain("Enjoy the fast Wi-Fi.");
    expect(html).toContain('class="arrow-cta"');
    expect(html).toContain("Design my listing");
    expect(html).toContain('class="status-dot is-connected"');
    expect(html.replaceAll("&amp;", "&")).toContain(ctaUrl);
  });

  it("renders a generic denial without echoing a supplied reason", () => {
    expect(renderDeniedPage()).toContain("We couldn’t connect you yet.");
    expect(renderDeniedPage()).not.toContain("client");
  });
});

describe("Notice at Collection", () => {
  it("contains collection categories, purposes, and retention", () => {
    const html = renderNoticePage();
    expect(html).toContain("name, work email, and phone number");
    expect(html).toContain("Wi-Fi access");
    expect(html).toContain("Pixii marketing communications");
    expect(html).toContain("365 days");
    expect(html).not.toContain("does not give Pixii permission to send SMS or MMS messages");
    expect(html).not.toContain("Sale or sharing");
    expect(html).toContain('href="https://www.pixii.ai/privacy/"');
  });

});
