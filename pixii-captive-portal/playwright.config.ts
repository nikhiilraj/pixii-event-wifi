import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  outputDir: "./test-results/browser",
  webServer: {
    command: "npm run dev:browser",
    url: `http://127.0.0.1:${process.env.PIXII_BROWSER_PORT || "8787"}/health`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "iphone-13", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "pixel-7", use: { ...devices["Pixel 7"], browserName: "chromium" } }
  ]
});
