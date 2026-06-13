import { test, expect } from "@playwright/test";

/**
 * AI Store & Skills — E2E Tests
 *
 * Store marketplace and skills management pages
 */

// ---------------------------------------------------------------------------
// 1. AI Store Page
// ---------------------------------------------------------------------------

test.describe("AI Store UI (/ai-store)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-store", { waitUntil: "domcontentloaded" });
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

  test("store items or categories render", async ({ page }) => {
    const storeItems = page.locator(
      "[class*='store'], [class*='card'], [class*='marketplace'], [class*='grid']",
    );
    const categories = page.locator(
      "[class*='category'], [class*='tab'], [class*='filter']",
    );
    const emptyState = page.getByText(
      /no.*item|empty|coming soon|browse|explore/i,
    );

    const hasItems = (await storeItems.count()) > 0;
    const hasCategories = (await categories.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasItems || hasCategories || hasEmptyState,
      "Store page should show items, categories, or empty state",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. AI Skills Page
// ---------------------------------------------------------------------------

test.describe("AI Skills UI (/ai-skills)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-skills", { waitUntil: "domcontentloaded" });
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

  test("skills list or empty state renders", async ({ page }) => {
    const skillCards = page.locator(
      "[class*='skill'], [class*='card'], [class*='grid'], table",
    );
    const emptyState = page.getByText(/no.*skill|empty|get started|install/i);

    const hasSkills = (await skillCards.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasSkills || hasEmptyState,
      "Skills page should show skills or empty state",
    ).toBe(true);
  });
});
