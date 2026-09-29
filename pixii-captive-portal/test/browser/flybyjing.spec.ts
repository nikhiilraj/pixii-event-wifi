import { expect, test, type Page } from "@playwright/test";
const base = "http://127.0.0.1:8787";

async function signup(page: Page) {
  await page.goto(base + "/");
  await page.fill("#fullName", "Fly By Jing Browser TEST");
  await page.fill("#email", "flybyjing-test@example.com");
  await page.fill("#phone", "4155550123");
  await page.check("#consent");
  await page.click("#connect-button");
}
async function visibility(page: Page, value: "visible" | "hidden") {
  await page.evaluate(state => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}

test("waits for the first image and start acknowledgement, not just page load", async ({ page }) => {
  let started = false;
  page.on("request", req => { if (req.url().endsWith("/ad/start")) started = true; });
  await page.route("**/listing-hero*.webp", async route => {
    await new Promise(resolve => setTimeout(resolve, 2200));
    await route.continue();
  });
  await signup(page);
  await page.waitForTimeout(1200);
  await expect(page.locator("#ad-progress")).toHaveAttribute("aria-valuenow", "0");
  expect(started).toBe(false);
  await expect(page).toHaveURL(/\/router\/fas\/wait\//);
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeVisible({ timeout: 12000 });
});

test("recovers a failed first image instead of retrying the same broken element forever", async ({ page }) => {
  let attempts = 0;
  await page.route("**/listing-hero*.webp*", async route => {
    attempts++;
    if (attempts === 1) await route.abort("failed");
    else await route.continue();
  });
  await signup(page);
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeVisible({ timeout: 16000 });
  expect(attempts).toBeGreaterThan(1);
});

test("detects expiration even when later artwork never finishes loading", async ({ page }) => {
  await page.route("**/aplus-*.webp", async route => {
    await new Promise(resolve => setTimeout(resolve, 12000));
    await route.abort();
  });
  await page.route("**/router/fas/status/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "expired" }) }));
  await signup(page);
  await expect(page.locator("#status-message")).toHaveText("This connection request expired. Rejoin the Wi-Fi and try again.", { timeout: 10000 });
  await expect(page.getByRole("heading", { name: "You’re online" })).toHaveCount(0);
});

test("pauses while backgrounded and refresh resumes the saved remainder", async ({ page }) => {
  test.setTimeout(35000);
  await signup(page);
  await expect(page).toHaveURL(/\/router\/fas\/wait\//);
  const session = page.url();
  await expect.poll(async () => Number(await page.locator("#ad-progress").getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(29);
  await visibility(page, "hidden");
  await page.waitForTimeout(100);
  const paused = await page.locator("#ad-progress").getAttribute("aria-valuenow");
  await page.waitForTimeout(7500);
  await expect(page.locator("#ad-progress")).toHaveAttribute("aria-valuenow", paused!);
  await expect(page.locator(".flyby-experience")).toBeVisible();
  await visibility(page, "visible");
  await page.reload();
  await expect(page).toHaveURL(session);
  await expect.poll(async () => Number(await page.locator("#ad-progress").getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(Number(paused));
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeVisible({ timeout: 10000 });
});

test("keeps the still artwork visible when autoplay is blocked", async ({ page }, testInfo) => {
  await page.addInitScript(() => { HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError")); });
  await signup(page);
  await expect(page.locator('[data-scene="video"]')).toHaveClass(/is-active/, { timeout: 10000 });
  await expect(page.locator(".flyby-film")).toHaveCount(2);
  for (const film of await page.locator(".flyby-film").all()) await expect(film).not.toHaveClass(/is-playing/);
  await expect.poll(() => page.locator(".flyby-film img").evaluateAll(imgs => imgs.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("video-fallback.png") });
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeVisible({ timeout: 5000 });
});

test("fills desktop, narrow phone and landscape without cropping or page overflow", async ({ browser }, testInfo) => {
  test.setTimeout(45000);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 700 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/preview/connecting");
    await expect(page.locator('[data-scene="listings"] img')).toHaveCount(7);
    await expect(page.locator(".flyby-thumbnails img")).toHaveCount(6);
    await expect.poll(() => page.locator("#ad-first-artwork").evaluate((img: HTMLImageElement) => img.naturalWidth > 0)).toBe(true);
    for (const scene of ["listings", "aplus", "video"]) {
      await expect(page.locator(`[data-scene="${scene}"]`)).toHaveClass(/is-active/, { timeout: 10000 });
      await expect(page.locator(`[data-scene="${scene}"]`)).toHaveCSS("opacity", "1");
      if (scene === "aplus") {
        const artwork = page.locator('[data-scene="aplus"] img');
        await expect(artwork).toHaveCount(1);
        await expect(artwork).toHaveCSS("object-fit", "contain");
        expect(await artwork.evaluate((img: HTMLImageElement) => img.naturalHeight > img.naturalWidth)).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await expect(page.locator(".flyby-header")).toBeVisible();
      await expect(page.locator("#ad-progress")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${viewport.width}-${scene}.png`) });
    }
    expect(errors).toEqual([]);
    await context.close();
  }
});

test("plays both supplied silent clips during the Ads stage", async ({ page }, testInfo) => {
  await page.goto(base + "/preview/connecting");
  await expect(page.locator('[data-scene="video"]')).toHaveClass(/is-active/, { timeout: 10000 });
  await expect(page.locator(".flyby-film")).toHaveCount(2);
  for (const film of await page.locator(".flyby-film").all()) await expect(film).toHaveClass(/is-playing/);
  await expect.poll(() => page.locator("video").first().evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(.4);
  expect(await page.locator("video").evaluateAll(videos => videos.length === 2 && videos.every(video => (video as HTMLVideoElement).muted && (video as HTMLVideoElement).currentTime > 0))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("video-playing.png") });
});

test("loops after the minimum until the router confirms, without resetting the progress bar", async ({ page }) => {
  test.setTimeout(30000);
  let connected = false;
  let completions = 0;
  page.on("request", request => { if (request.url().endsWith("/ad/complete")) completions++; });
  await page.route("**/router/fas/status/**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ status: connected ? "connected" : "pending" })
  }));
  await signup(page);
  await expect(page.locator("#status-message")).toHaveText("Finishing connection…", { timeout: 14000 });
  await expect(page.locator("#ad-progress")).toHaveAttribute("aria-valuenow", "100");
  for (const scene of ["listings", "aplus", "video"]) {
    await expect(page.locator(`[data-scene="${scene}"]`)).toHaveClass(/is-active/, { timeout: 6000 });
    await expect(page.locator("#ad-progress")).toHaveAttribute("aria-valuenow", "100");
  }
  await expect.poll(() => page.locator("video").first().evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(.4);
  expect(completions).toBe(1);
  connected = true;
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".flyby-experience")).toHaveCount(0);
});

test("the connecting preview also repeats the artwork after seven seconds", async ({ page }) => {
  await page.goto(base + "/preview/connecting");
  await expect(page.locator("#ad-progress")).toHaveAttribute("aria-valuenow", "100", { timeout: 12000 });
  await expect(page.locator('[data-scene="listings"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-scene="aplus"]')).toHaveClass(/is-active/, { timeout: 5000 });
  await expect(page.locator('[data-scene="video"]')).toHaveClass(/is-active/, { timeout: 4000 });
  await expect.poll(() => page.locator("video").first().evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(.4);
});
