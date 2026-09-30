import { expect, test } from "@playwright/test";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import vector from "../fixtures/opennds-level3-v10.3.json" with { type: "json" };

const baseUrl = `http://127.0.0.1:${process.env.PIXII_BROWSER_PORT || "8787"}`;
const ctaUrl =
  "https://www.pixii.ai/ads/?utm_source=event_wifi&utm_medium=captive_portal&utm_campaign=amazon_unboxed_sf_2026";

function portalUrl(fas = vector.fas): string {
  const url = new URL("/router/fas", baseUrl);
  url.searchParams.set("fas", fas);
  url.searchParams.set("iv", vector.iv);
  return url.toString();
}

function signedAuthmonForm(action: string, payloadText: string): Record<string, string> {
  const payload = btoa(payloadText);
  return {
    auth_get: action,
    gatewayhash: vector.gatewayHash,
    payload,
    signature: createHmac("sha256", vector.key)
      .update(`${action}\n${vector.gatewayHash}\n${payload}`)
      .digest("hex")
  };
}

test("completes the live local Worker flow with the confirmed router null suffix on a phone viewport", async ({ page, request }, testInfo) => {
  // Each browser has its own guest session; one device's ACK must not consume another's queue record.
  const hid = randomBytes(32).toString("hex");
  const rhid = createHash("sha256").update(hid + vector.key).digest("hex");
  const cipher = createCipheriv("aes-256-cbc", Buffer.from(vector.key).subarray(0, 32), Buffer.from(vector.iv));
  const plaintext = `${vector.plaintext.replace(vector.fields.hid, hid)}, gatewayurl=http%3A%2F%2F192.168.9.1, version=9.8.0, authdir=opennds_auth, themespec=, (null)(null)(null)(null)`;
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const fas = Buffer.from(ciphertext.toString("base64")).toString("base64");
  const requests: string[] = [];
  page.on("request", (outgoing) => requests.push(outgoing.url()));
  await page.goto(portalUrl(fas));

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator(".signup-title")).toHaveText("Get free, fast Wi-Fi.");
  await expect(page.locator(".sponsor")).toContainText("Wi-Fi powered by");
  await expect(page.locator(".required-marker")).toHaveCount(0);
  await expect(page.getByText("Required to connect.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".showcase-listings img")).toHaveCount(0);
  await expect(page.locator(".showcase-aplus")).toHaveCount(0);
  await expect(page.getByText("Premium A+ content", { exact: true })).toHaveCount(0);
  await expect(page.locator("#consent")).not.toBeChecked();
  await expect(page.locator("#phoneCountry")).toHaveValue("US");
  await expect(page.locator("#phoneCountry option:checked")).toHaveText("US +1");
  const usExample = await page.locator("#phone").getAttribute("placeholder");
  await page.selectOption("#phoneCountry", "GB");
  await expect(page.locator("#phoneCountry option:checked")).toHaveText("GB +44");
  await expect(page.locator("#phone")).not.toHaveAttribute("placeholder", usExample ?? "");
  await page.selectOption("#phoneCountry", "US");
  await page.screenshot({ path: testInfo.outputPath("signup.png"), fullPage: true });

  await page.fill("#fullName", "Ada Lovelace");
  await page.fill("#email", "ada@example.com");
  await page.fill("#phone", "4155550123");
  await page.click("#connect-button");
  await expect(page.locator("#consent")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Please check the box to connect to Wi-Fi.", { exact: true })).toHaveCount(0);
  const consentErrorStyle = await page.locator("#consent").evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(consentErrorStyle).toEqual({ color: "rgb(180, 35, 24)", style: "solid", width: "2px" });
  await expect(page.locator("#connect-button")).toBeEnabled();

  await page.check("#consent");
  await page.fill("#phone", "abcdefgh");
  await page.click("#connect-button");
  await expect(page.locator("#phone-error")).toHaveText("Enter a valid phone number.");
  await expect(page.locator("#consent")).toBeChecked();

  await page.fill("#fullName", "A");
  await page.fill("#phone", "4155550123");
  await page.click("#connect-button");
  await expect(page.locator("#fullName")).toHaveValue("A");
  await expect(page.locator("#fullName-error")).toBeVisible();
  await expect(page.locator("#fullName")).toHaveCSS("border-color", "rgb(180, 35, 24)");
  await expect(page.locator("#consent")).toBeChecked();
  await expect(page.locator("#consent-error")).toBeHidden();

  await page.fill("#fullName", "Ada Lovelace");
  await page.check("#consent");
  await page.click("#connect-button");
  await expect(page.locator("#status-message")).toHaveText("Connecting");
  await expect(page.locator("#ad-first-artwork")).toBeVisible();
  const shownAt = Date.now();
  await expect.poll(() => page.locator("#ad-first-artwork").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.locator("#ad-first-artwork").evaluate((image: HTMLImageElement) => image.decode());
  await page.screenshot({ path: testInfo.outputPath("connecting.png"), fullPage: true });

  const earlyView = await request.post(`${baseUrl}/router/fas`, { form: signedAuthmonForm("view", "none") });
  expect(await earlyView.text()).not.toContain(rhid);
  await expect.poll(async () => {
    const response = await request.post(`${baseUrl}/router/fas`, { form: signedAuthmonForm("view", "none") });
    return (await response.text()).includes(rhid);
  }, { timeout: 12_000, intervals: [500] }).toBe(true);
  await expect(page.locator("#status-message")).toHaveText("Finishing connection…");
  await expect(page.locator("#ad-progress")).toHaveAttribute("aria-valuenow", "100");

  const view = await request.post(`${baseUrl}/router/fas`, {
    form: signedAuthmonForm("view", "none")
  });
  expect(view.status()).toBe(200);
  const records = (await view.text()).slice(2).split(" ").map(decodeURIComponent);
  expect(records.some((record) => record.startsWith(rhid + " "))).toBe(true);
  const acknowledged = await request.post(`${baseUrl}/router/fas`, {
    form: signedAuthmonForm("view", `* ${rhid}`)
  });
  expect(acknowledged.status()).toBe(200);

  await expect(page.getByRole("heading", { name: "You’re online" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeFocused();
  expect(Date.now() - shownAt).toBeGreaterThanOrEqual(7_000);
  await expect(page.locator(".status-dot.is-connected")).toBeVisible();
  await expect(page.locator("#open-here")).toHaveAttribute("href", ctaUrl);
  await page.screenshot({ path: testInfo.outputPath("connected.png"), fullPage: true });

  expect(requests.every((url) => new URL(url).origin === baseUrl)).toBe(true);
});

test("runs the public root form through the same screens without a password", async ({ page }) => {
  const response = await page.goto(baseUrl + "/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("#signup-form")).toHaveAttribute("action", "/");
  await expect(page.locator(".preview-banner,.team-note,.team-nav")).toHaveCount(0);
  await page.fill("#fullName", "Public Browser TEST");
  await page.fill("#email", "public-browser@example.com");
  await page.fill("#phone", "4155550123");
  await page.check("#consent");
  await page.click("#connect-button");
  await expect(page.locator("#status-message")).toHaveText("Connecting");
  await expect(page.locator("#ad-first-artwork")).toBeVisible();
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeVisible({ timeout: 12_000 });
  await expect(page.locator("#open-here")).toHaveAttribute("href", ctaUrl);
});

test("keeps the core message without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(portalUrl());
  await expect(page.locator(".signup-title")).toHaveText("Get free, fast Wi-Fi.");
  await expect(page.locator(".sponsor")).toContainText("Wi-Fi powered by");
  await expect(page.locator("#consent")).not.toBeChecked();
  await context.close();
});

test("has no horizontal overflow at 320 pixels", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 700 } });
  const page = await context.newPage();
  await page.goto(portalUrl());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const selector of ["#fullName", "#email", "#phoneCountry", "#phone", "#consent", "#connect-button"]) {
    const control = page.locator(selector);
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("signup-320.png"), fullPage: true });
  await context.close();
});
