import { expect, test, type Page } from "@playwright/test";
import { renderWaitingPage } from "../../src/portal";

const base = "http://127.0.0.1:8787";
const destination = "https://www.pixii.ai/?utm_source=event_wifi&utm_medium=captive_portal&utm_campaign=amazon_unboxed_sf_2026";
async function hide(page: Page, hidden: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
async function interceptDestination(page: Page) {
  await page.route("https://www.pixii.ai/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Pixii destination</h1>" }));
}

test("connecting progress fills across seven visible seconds and labels match the shown scene", async ({ page }) => {
  await page.goto(base + "/preview/connecting");
  const progress = page.getByRole("progressbar", { name: "Connecting to Wi-Fi" });
  await expect(progress).toBeVisible();
  await expect.poll(async () => Number(await progress.getAttribute("aria-valuenow"))).toBeGreaterThan(10);
  await hide(page, true);
  await page.waitForTimeout(100);
  const paused = Number(await progress.getAttribute("aria-valuenow"));
  await page.waitForTimeout(1200);
  expect(Number(await progress.getAttribute("aria-valuenow"))).toBe(paused);
  await hide(page, false);
  for (const [scene, label] of [["aplus", "A+"], ["video", "Ads"]]) {
    await expect(page.locator(`[data-scene="${scene}"]`)).toHaveClass(/is-active/, { timeout: 8000 });
    await expect(page.locator("#ad-category")).toHaveText(label);
  }
  await expect(progress).toHaveAttribute("aria-valuenow", "100", { timeout: 8000 });
  await expect(page.locator('[data-scene="listings"]')).toHaveClass(/is-active/);
  await expect(page.locator("#ad-category")).toHaveText("Listings");
  await expect(progress.locator("span")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
});

test("connected neutral progress fills for five seconds then opens Pixii with attribution", async ({ page }, testInfo) => {
  await interceptDestination(page);
  await page.clock.install();
  await page.goto(base + "/preview/connected");
  await expect(page.getByText("Free, no credit card needed.", { exact: true })).toBeVisible();
  await page.clock.runFor(2400);
  await expect(page).toHaveURL(base + "/preview/connected");
  const progress = page.getByRole("progressbar", { name: "Opening Pixii" });
  const halfway = Number(await progress.getAttribute("aria-valuenow"));
  expect(halfway).toBeGreaterThan(40);
  expect(halfway).toBeLessThan(60);
  await page.screenshot({ path: testInfo.outputPath("connected-half-filled.png") });
  await hide(page, true);
  const paused = Number(await progress.getAttribute("aria-valuenow"));
  await page.clock.runFor(10000);
  await expect(page).toHaveURL(base + "/preview/connected");
  expect(Number(await progress.getAttribute("aria-valuenow"))).toBe(paused);
  await hide(page, false);
  await page.clock.runFor(2000);
  await expect(page).toHaveURL(base + "/preview/connected");
  await page.clock.runFor(1000);
  await expect(page).toHaveURL(destination);
});

test("connected CTA can request the browser immediately without waiting for its fill", async ({ page }) => {
  await page.clock.install();
  await page.goto(base + "/preview/connected");
  await page.evaluate(() => document.addEventListener("click", event => event.preventDefault(), { capture: true, once: true }));
  await page.locator(".arrow-cta").click();
  await expect(page.locator("#browser-fallback")).toBeVisible();
  await page.clock.runFor(6000);
  await expect(page).toHaveURL(base + "/preview/connected");
});

test("pending connections never redirect and dynamically confirmed connections start a fresh five seconds", async ({ page }) => {
  let connected = false;
  await interceptDestination(page);
  await page.route("**/router/fas/status/**", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ status: connected ? "connected" : "pending" })
  }));
  await page.goto(base + "/");
  await page.fill("#fullName", "Progress TEST");
  await page.fill("#email", "progress-test@example.com");
  await page.fill("#phone", "4155550123");
  await page.check("#consent");
  await page.click("#connect-button");
  await expect(page.locator("#status-message")).toHaveText("Finishing connection…", { timeout: 14000 });
  await page.waitForTimeout(5200);
  await expect(page).toHaveURL(/\/router\/fas\/wait\//);
  await expect(page.getByRole("progressbar", { name: "Opening Pixii" })).toHaveCount(0);
  connected = true;
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeVisible();
  const confirmedAt = Date.now();
  await expect(page).toHaveURL(destination, { timeout: 7000 });
  expect(Date.now() - confirmedAt).toBeGreaterThan(4500);
});

test("a late connected runtime still initializes the visible connected page", async ({ page }) => {
  await interceptDestination(page);
  await page.route("**/assets/connected-v3.js", async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.goto(base + "/preview/connected");
  await expect(page).toHaveURL(destination, { timeout: 7500 });
});

test("an expired connection ignores an older in-flight connected response and never redirects", async ({ page }) => {
  let finishing = false, held = false;
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  await interceptDestination(page);
  page.on("request", request => { if (request.url().endsWith("/ad/complete")) finishing = true; });
  await page.route("**/router/fas/status/**", async route => {
    let status = "pending";
    if (finishing && !held) {
      held = true;
      await released;
      status = "connected";
    } else if (finishing) status = "expired";
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status }) });
  });
  await page.goto(base + "/");
  await page.fill("#fullName", "Expired Progress TEST");
  await page.fill("#email", "expired-progress-test@example.com");
  await page.fill("#phone", "4155550123");
  await page.check("#consent");
  await page.click("#connect-button");
  await expect(page.locator("#status-message")).toContainText("expired", { timeout: 14000 });
  release();
  await page.waitForTimeout(6000);
  await expect(page).toHaveURL(/\/router\/fas\/wait\//);
  await expect(page.getByRole("heading", { name: "You’re online" })).toHaveCount(0);
  await expect(page.locator("#status-message")).toContainText("expired");
});

test("legacy waiting sessions also initialize the CTA after their existing confirmation delay", async ({ page }) => {
  await interceptDestination(page);
  await page.route(base + "/__test/legacy", route => route.fulfill({ contentType: "text/html", body: renderWaitingPage("legacy-test", "local-test-token", false) }));
  await page.route("**/router/fas/status/**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "connected" }) }));
  await page.goto(base + "/__test/legacy");
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("progressbar", { name: "Opening Pixii" })).toBeVisible();
  await expect(page).toHaveURL(destination, { timeout: 6500 });
});

test("a failed A+ image retains the Listings label with the visible listing artwork", async ({ page }) => {
  await page.route("**/aplus-mobile.webp", route => route.abort("failed"));
  await page.goto(base + "/preview/connecting");
  const progress = page.getByRole("progressbar", { name: "Connecting to Wi-Fi" });
  await expect.poll(async () => Number(await progress.getAttribute("aria-valuenow"))).toBeGreaterThan(50);
  await hide(page, true);
  await expect(page.locator('[data-scene="listings"]')).toHaveClass(/is-active/);
  await expect(page.locator("#ad-category")).toHaveText("Listings");
});
