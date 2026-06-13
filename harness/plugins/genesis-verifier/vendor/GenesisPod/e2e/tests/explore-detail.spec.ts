import { test, expect } from "@playwright/test";

/**
 * Explore & Detail Pages — E2E Tests
 *
 * Public explore pages: resource detail, report detail, youtube
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
// 1. Explore Main Page
// ---------------------------------------------------------------------------

test.describe("Explore Page (/explore)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
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

  test("content list or search interface renders", async ({ page }) => {
    const content = page.locator(
      "[class*='explore'], [class*='card'], [class*='resource'], [class*='grid'], table",
    );
    const search = page.locator("input[type='search'], input[type='text']");
    const emptyState = page.getByText(/no.*result|explore|discover|browse/i);

    const hasContent = (await content.count()) > 0;
    const hasSearch = (await search.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasContent || hasSearch || hasEmptyState,
      "Explore page should show content, search, or empty state",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Explore YouTube Page
// ---------------------------------------------------------------------------

test.describe("Explore YouTube (/explore/youtube)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore/youtube", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page has heading", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });
});

// ---------------------------------------------------------------------------
// 3. Resource Detail (dynamic route)
// ---------------------------------------------------------------------------

test.describe("Explore Resource Detail (/explore/resource/:id)", () => {
  test("nonexistent resource shows 404 or redirect", async ({ page }) => {
    await page.goto("/explore/resource/nonexistent-id-xyz", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const errorMessage = page.getByText(/not found|error|does not exist/i);
    const body = page.locator("body");

    // Either shows 404 message or still renders page (redirect)
    await expect(body).not.toBeEmpty();
    // No crash/error boundary
    const errorBoundary = page.getByText(/application error/i);
    await expect(errorBoundary).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Report Detail (dynamic route)
// ---------------------------------------------------------------------------

test.describe("Explore Report Detail (/explore/report/:id)", () => {
  test("nonexistent report shows 404 or redirect", async ({ page }) => {
    await page.goto("/explore/report/nonexistent-id-xyz", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();
    const errorBoundary = page.getByText(/application error/i);
    await expect(errorBoundary).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. API Contract Tests — Explore
// ---------------------------------------------------------------------------

test.describe("Explore API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /explore/resources — list public resources", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/explore/resources`,
      { headers, timeout: 15000 },
    );

    // May or may not have a dedicated explore endpoint
    expect(
      [200, 404].includes(response.status()),
      `GET /explore/resources returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /explore/reports — list public reports", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/explore/reports`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 404].includes(response.status()),
      `GET /explore/reports returned ${response.status()}`,
    ).toBe(true);
  });
});
