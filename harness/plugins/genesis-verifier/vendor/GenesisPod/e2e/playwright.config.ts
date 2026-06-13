import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E Test Configuration
 *
 * Usage:
 *   cd e2e && npm test                                 # Run all tests headless
 *   cd e2e && npm run test:ui                          # Interactive UI mode
 *   BASE_URL=https://xxx cd e2e && npm test            # Test remote env
 *   E2E_EMAIL=x E2E_PASSWORD=y cd e2e && npm test      # Custom credentials
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 30_000,

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // Auth setup — runs first, saves browser state
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    // Main test suite — depends on auth setup
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});
