import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
  test(`connecting status stays aligned above the headline at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("http://127.0.0.1:8787/preview/connecting");
    const status = page.locator("#status-message");
    await expect(status).toHaveText("Connecting");
    await expect(page.locator("#ad-progress")).not.toHaveAttribute("aria-valuenow", "0");
    await expect(status).toHaveCSS("font-size", "16px");
    const geometry = await page.evaluate(() => {
      const heading = document.querySelector(".flyby-tagline")!.getBoundingClientRect();
      const state = document.querySelector(".flyby-header .connection-state")!.getBoundingClientRect();
      const text = document.querySelector("#status-message")!.getBoundingClientRect();
      const dot = document.querySelector(".flyby-header .status-dot")!.getBoundingClientRect();
      return { leftDifference: Math.abs(heading.x - state.x), dotDifference: Math.abs(text.y + text.height / 2 - dot.y - dot.height / 2), gap: heading.top - state.bottom, right: state.right, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.leftDifference).toBeLessThan(2);
    expect(geometry.dotDifference).toBeLessThan(2);
    expect(geometry.gap).toBeGreaterThanOrEqual(8);
    expect(geometry.right).toBeLessThanOrEqual(viewport.width - 16);
    expect(geometry.overflow).toBe(false);
    // Startup and the looping preview must not restore the old, wrapping label.
    await expect(page.locator("#ad-progress")).toHaveAttribute("aria-valuenow", "100", { timeout: 15000 });
    await expect(status).toHaveText("Connecting");
  });
}
