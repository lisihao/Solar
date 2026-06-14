import { test, expect } from "@playwright/test";

/**
 * Admin Data Management — E2E Tests
 *
 * Admin pages: data collection, quality, whitelists, workspace, thumbnails
 */

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
async function getAuthHeader(
  page: import("@playwright/test").Page,
): Promise<Record<string, string>> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem("deepdive_auth_tokens");
    if (!raw) return null;
    try {
      return JSON.parse(raw).accessToken as string;
    } catch {
      return null;
    }
  });
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------------------
// 1. Data Collection Page
// ---------------------------------------------------------------------------

test.describe("Admin Data Collection (/admin/data/collection)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/data/collection", {
      waitUntil: "domcontentloaded",
    });
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
});

// ---------------------------------------------------------------------------
// 2. Data Quality Page
// ---------------------------------------------------------------------------

test.describe("Admin Data Quality (/admin/data/quality)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/data/quality", {
      waitUntil: "domcontentloaded",
    });
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
});

// ---------------------------------------------------------------------------
// 3. Data Whitelists Page
// ---------------------------------------------------------------------------

test.describe("Admin Data Whitelists (/admin/data/whitelists)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/data/whitelists", {
      waitUntil: "domcontentloaded",
    });
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
});

// ---------------------------------------------------------------------------
// 4. Workspace Page
// ---------------------------------------------------------------------------

test.describe("Admin Workspace (/admin/workspace)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/workspace", { waitUntil: "domcontentloaded" });
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
});

// ---------------------------------------------------------------------------
// 5. Thumbnails Page
// ---------------------------------------------------------------------------

test.describe("Admin Thumbnails (/admin/thumbnails)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/thumbnails", { waitUntil: "domcontentloaded" });
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
});

// ---------------------------------------------------------------------------
// 6. Admin Data Management API Tests
// ---------------------------------------------------------------------------

test.describe("Admin Data API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/data/collection", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(500);
  });

  test("GET /admin/data-sources — list data sources", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/data-sources`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/data-sources returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/workspace — get workspace info", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/workspace`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/workspace returned ${response.status()}`,
    ).toBe(true);
  });
});
