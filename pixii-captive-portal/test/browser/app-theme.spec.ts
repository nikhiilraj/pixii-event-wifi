import { expect, test } from "@playwright/test";

const base = `http://127.0.0.1:${process.env.PIXII_BROWSER_PORT || "8787"}`;

test("signup uses the app fonts and one capsule phone field without changing validation", async ({ page }) => {
  await page.goto(base + "/");
  await expect(page.getByRole("heading", { name: "Get free, fast Wi-Fi." })).toBeVisible();
  await expect(page.locator(".sponsor")).toContainText("Wi-Fi powered by");
  await expect(page.locator(".sponsor-copy")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [...document.fonts].filter(font => font.status === "loaded").map(font => font.family))).toEqual(expect.arrayContaining(["Cabinet Grotesk", "Switzer"]));
  await expect(page.locator("#fullName")).toHaveCSS("border-radius", "999px");
  await expect(page.locator(".phone-control")).toHaveCSS("border-radius", "999px");
  await expect(page.locator("#phoneCountry")).toHaveCSS("border-right-width", "0px");
  await expect(page.locator("#phoneCountry")).toHaveCSS("background-image", /chevron-down\.svg/);
  await expect(page.getByText("For Pixii updates and offers.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".required-marker")).toHaveCount(0);
  await expect(page.locator("#phone")).toHaveAttribute("aria-describedby", "phone-error");
  for (const link of ["Privacy Policy", "Notice of Collection"]) await expect(page.getByRole("link", { name: link, exact: true })).toHaveCSS("text-decoration-line", "none");
  await page.locator("#connect-button").click();
  await expect(page.locator("#fullName")).toBeFocused();
  for (const field of ["fullName", "email", "phone", "consent"]) await expect(page.locator("#" + field)).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(base + "/");
});

test("signup and success keep their aligned readable layout across viewport sizes", async ({ browser }, testInfo) => {
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 700 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.clock.install();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const [path, name] of [["/", "signup"], ["/preview/connected", "connected"]]) {
      await page.goto(base + path);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const action = page.locator(name === "signup" ? "#connect-button" : ".arrow-cta");
      await expect(action).toBeVisible();
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await page.screenshot({ path: testInfo.outputPath(`${viewport.width}-${name}.png`), fullPage: true, scale: "css" });
    }
    expect(errors).toEqual([]);
    await context.close();
  }
});

test("artwork headings change without moving the stage or claiming the A+ and Ads timing", async ({ page }) => {
  await page.goto(base + "/preview/connecting");
  await expect(page.getByRole("heading", { name: "Pixii designs Listings" })).toBeVisible();
  await expect(page.locator(".sponsor, .flyby-brand, .logo")).toHaveCount(0);
  const stage = await page.locator(".flyby-stage").boundingBox();
  await expect(page.locator("#ad-subtitle")).toBeVisible();
  for (const [scene, label] of [["aplus", "A+"], ["video", "Ads"]]) {
    await expect(page.locator(`[data-scene="${scene}"]`)).toHaveClass(/is-active/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Pixii designs " + label })).toBeVisible();
    await expect(page.locator("#ad-subtitle")).not.toBeVisible();
    expect(await page.locator(".flyby-stage").boundingBox()).toEqual(stage);
  }
  await expect(page.locator('[data-scene="listings"]')).toHaveClass(/is-active/, { timeout: 5000 });
  await expect(page.locator("#ad-subtitle")).toBeVisible();
});

test("connected page groups the shorter action and neutral countdown without a second sponsor", async ({ page }) => {
  await page.clock.install();
  await page.goto(base + "/preview/connected");
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You’re online" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "You’re online" })).toHaveAccessibleDescription("Opening Pixii in 5 seconds...");
  await expect(page.getByRole("heading", { name: "You’re online" })).toHaveCSS("outline-style", "none");
  await expect(page.getByRole("heading", { name: "Now try Pixii on your product", exact: true })).toBeVisible();
  await expect(page.locator(".arrow-cta")).toHaveAccessibleName("Design my ads");
  await expect(page.getByText("Design Amazon ads, videos, or listings, instantly", { exact: true })).toBeVisible();
  await expect(page.getByText("Free. No credit card needed. Results in 2 minutes.", { exact: true })).toBeVisible();
  await expect(page.locator(".sponsor, .logo")).toHaveCount(0);
  const geometry = await page.evaluate(() => {
    const cta = document.querySelector(".arrow-cta")!;
    const note = document.querySelector(".cta-note")!.getBoundingClientRect();
    const redirect = document.querySelector(".redirect-note")!.getBoundingClientRect();
    const bar = document.querySelector(".cta-progress")!;
    return { outsideButton: !cta.contains(bar), gap: redirect.top - note.bottom, barHeight: bar.getBoundingClientRect().height, barColor: getComputedStyle(bar.querySelector("span")!).backgroundColor, buttonColor: getComputedStyle(cta).backgroundColor };
  });
  expect(geometry.outsideButton).toBe(true);
  expect(geometry.gap).toBeLessThanOrEqual(24);
  expect(geometry.barHeight).toBeLessThanOrEqual(3);
  expect(geometry.barColor).not.toBe(geometry.buttonColor);
});
