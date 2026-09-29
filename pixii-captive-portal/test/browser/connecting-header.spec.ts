import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
  test(`connecting status stays readable beside the logo at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("http://127.0.0.1:8787/preview/connecting");
    const status = page.locator("#status-message");
    await expect(status).toHaveText("Connecting");
    await expect(page.locator("#ad-progress")).not.toHaveAttribute("aria-valuenow", "0");
    await expect(status).toHaveCSS("font-size", "16px");
    const geometry = await page.evaluate(() => {
      const logo = document.querySelector(".flyby-brand .logo")!.getBoundingClientRect();
      const state = document.querySelector(".flyby-header .connection-state")!.getBoundingClientRect();
      const text = document.querySelector("#status-message")!.getBoundingClientRect();
      const dot = document.querySelector(".flyby-header .status-dot")!.getBoundingClientRect();
      return { centerDifference: Math.abs(logo.y + logo.height / 2 - state.y - state.height / 2), dotDifference: Math.abs(text.y + text.height / 2 - dot.y - dot.height / 2), gap: state.x - logo.right, right: state.right, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.centerDifference).toBeLessThan(2);
    expect(geometry.dotDifference).toBeLessThan(2);
    expect(geometry.gap).toBeGreaterThan(12);
    expect(geometry.right).toBeLessThanOrEqual(viewport.width - 16);
    expect(geometry.overflow).toBe(false);
    // Startup and the looping preview must not restore the old, wrapping label.
    await expect(page.locator("#ad-progress")).toHaveAttribute("aria-valuenow", "100", { timeout: 15000 });
    await expect(status).toHaveText("Connecting");
  });
}
