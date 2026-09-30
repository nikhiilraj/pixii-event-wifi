import { expect, test } from "@playwright/test";

const base = `http://127.0.0.1:${process.env.PIXII_BROWSER_PORT || "8787"}`;
const destination = "https://www.pixii.ai/?utm_source=event_wifi&utm_medium=captive_portal&utm_campaign=amazon_unboxed_sf_2026";
const platforms = [
  { name: "iPhone", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", prefix: "x-safari-https://", label: "Safari" },
  { name: "iPad desktop mode", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15", prefix: "x-safari-https://", label: "Safari" },
  { name: "Mac", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15", prefix: "x-safari-https://", label: "Safari" },
  { name: "Android", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36", prefix: "intent://", label: "browser" },
  { name: "Windows", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", prefix: "microsoft-edge:https://", label: "Edge" }
];

// These verify our platform routing and fallback, not OS permission to launch an app.
for (const platform of platforms) {
  test(`${platform.name}: tap requests the browser and leaves a usable fallback if blocked`, async ({ browser }) => {
    const context = await browser.newContext({ userAgent: platform.ua });
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(base + "/preview/connected");
    const cta = page.locator(".arrow-cta");
    const href = await cta.getAttribute("href");
    expect(href?.startsWith(platform.prefix)).toBe(true);
    expect(href).toContain("www.pixii.ai/");
    expect(href).toContain("utm_campaign=amazon_unboxed_sf_2026");
    await expect(page.locator("#browser-action")).not.toBeVisible();
    if (platform.name === "Android") {
      expect(href).toContain("action=android.intent.action.VIEW;");
      expect(href).toContain("S.browser_fallback_url=" + encodeURIComponent(destination));
    }
    // Simulate the OS refusing the native navigation; still execute the real click handler.
    await page.evaluate(() => document.addEventListener("click", event => event.preventDefault(), { capture: true, once: true }));
    await cta.click();
    await expect(page.locator("#browser-fallback")).toBeVisible();
    await expect(page.locator("#open-here")).toHaveAttribute("href", destination);
    await expect(page.locator("#redirect-note")).toContainText("didn’t open");
    await page.clock.runFor(10000);
    await expect(page).toHaveURL(base + "/preview/connected");
    await context.route("https://www.pixii.ai/**", route => route.fulfill({ body: "Pixii destination" }));
    await page.locator("#open-here").click();
    await expect(page).toHaveURL(destination);
    await context.close();
  });

  test(`${platform.name}: doing nothing redirects in the same window, never to a native scheme`, async ({ browser }) => {
    const context = await browser.newContext({ userAgent: platform.ua });
    await context.route("https://www.pixii.ai/**", route => route.fulfill({ body: "Pixii destination" }));
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(base + "/preview/connected");
    await page.clock.runFor(4900);
    await expect(page).toHaveURL(base + "/preview/connected");
    await page.clock.runFor(200);
    await expect(page).toHaveURL(destination);
    expect(context.pages()).toHaveLength(1);
    await context.close();
  });
}

test("unknown platform opens an isolated browser tab and cancels the original countdown", async ({ browser }) => {
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0" });
  await context.route("https://www.pixii.ai/**", route => route.fulfill({ body: "Pixii destination" }));
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(base + "/preview/connected");
  const popupPromise = context.waitForEvent("page");
  await page.locator(".arrow-cta").click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(destination);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await page.clock.runFor(10000);
  await expect(page).toHaveURL(base + "/preview/connected");
  await context.close();
});

test("copy link preserves attribution and offers manual copy if permission is denied", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("Denied")) } }));
  await page.clock.install();
  await page.goto(base + "/preview/connected");
  await page.evaluate(() => document.addEventListener("click", event => event.preventDefault(), { capture: true, once: true }));
  await page.locator(".arrow-cta").click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("textbox", { name: "Pixii website link" })).toHaveValue(destination);
  await expect(page.locator("#copy-status")).toContainText("Copy this link");
  await page.clock.runFor(10000);
  await expect(page).toHaveURL(base + "/preview/connected");
});

test("copy link writes the real attributed destination when clipboard permission is granted", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await page.goto(base + "/preview/connected");
  await page.evaluate(() => document.addEventListener("click", event => event.preventDefault(), { capture: true, once: true }));
  await page.locator(".arrow-cta").click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator("#copy-status")).toHaveText("Link copied. Paste it into your browser.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(destination);
});

test("without JavaScript the CTA remains an ordinary safe HTTPS link", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route("https://www.pixii.ai/**", route => route.fulfill({ body: "Pixii destination" }));
  const page = await context.newPage();
  await page.goto(base + "/preview/connected");
  await expect(page.locator(".arrow-cta")).toHaveAttribute("href", destination);
  const opened = context.waitForEvent("page");
  await page.locator(".arrow-cta").click();
  await expect(await opened).toHaveURL(destination);
  await context.close();
});
