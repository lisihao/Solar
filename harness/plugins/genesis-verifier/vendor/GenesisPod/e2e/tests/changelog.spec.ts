import { test, expect } from "@playwright/test";

/**
 * Changelog Page — E2E Tests
 */

test.describe("Changelog Page (/changelog)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/changelog", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("changelog entries or version list renders", async ({ page }) => {
    const entries = page.locator(
      "[class*='changelog'], [class*='version'], [class*='release'], [class*='entry'], [class*='card']",
    );
    const versionText = page.getByText(/v\d+\.\d+|version|release|update/i);

    const hasEntries = (await entries.count()) > 0;
    const hasVersionText = (await versionText.count()) > 0;

    expect(
      hasEntries || hasVersionText,
      "Changelog page should show version entries",
    ).toBe(true);
  });
});
