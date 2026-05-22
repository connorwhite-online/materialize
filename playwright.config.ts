import { defineConfig, devices } from "@playwright/test";

// PLAYWRIGHT_BASE_URL + PLAYWRIGHT_NO_WEBSERVER let the pr-browser-
// review agent (and any other off-localhost caller) point this config
// at a remote URL — e.g. a Vercel preview — without booting a local
// dev server. Defaults are unchanged for normal `npm run e2e`.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const skipWebServer = process.env.PLAYWRIGHT_NO_WEBSERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: "CRAFTCLOUD_USE_MOCK=true npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
      },
});
