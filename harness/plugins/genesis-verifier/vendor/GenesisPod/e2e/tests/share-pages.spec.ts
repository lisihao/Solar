import { test, expect } from "@playwright/test";

/**
 * Share Pages — E2E Tests
 *
 * Public share pages for writing, image, and topic content
 */

// ---------------------------------------------------------------------------
// 1. Share Writing Page
// ---------------------------------------------------------------------------

test.describe("Share Writing (/share/writing/:id)", () => {
  test("page renders without crash for valid format id", async ({ page }) => {
    await page.goto("/share/writing/test-share-id", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    const appError = page.getByText(/application error/i);
    await expect(appError).not.toBeVisible();
  });

  test("nonexistent share shows error or empty state", async ({ page }) => {
    await page.goto("/share/writing/nonexistent-xyz-123", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    // Should show "not found" or similar, not crash
    const appError = page.getByText(/application error/i);
    await expect(appError).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Share Image Page
// ---------------------------------------------------------------------------

test.describe("Share Image (/share/image/:id)", () => {
  test("page renders without crash", async ({ page }) => {
    await page.goto("/share/image/test-share-id", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    const appError = page.getByText(/application error/i);
    await expect(appError).not.toBeVisible();
  });

  test("nonexistent image share handles gracefully", async ({ page }) => {
    await page.goto("/share/image/nonexistent-xyz-123", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    const appError = page.getByText(/application error/i);
    await expect(appError).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Share Topic Page
// ---------------------------------------------------------------------------

test.describe("Share Topic (/share/topic/:id)", () => {
  test("page renders without crash", async ({ page }) => {
    await page.goto("/share/topic/test-share-id", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    const appError = page.getByText(/application error/i);
    await expect(appError).not.toBeVisible();
  });

  test("nonexistent topic share handles gracefully", async ({ page }) => {
    await page.goto("/share/topic/nonexistent-xyz-123", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    const appError = page.getByText(/application error/i);
    await expect(appError).not.toBeVisible();
  });
});
