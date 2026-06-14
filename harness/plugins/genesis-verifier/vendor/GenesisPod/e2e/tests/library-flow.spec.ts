import { test, expect } from "@playwright/test";

/**
 * Library Flow — E2E Tests
 *
 * Library and RAG module crossing multiple layers:
 * - L4 AI Apps: Resource library, RAG management
 * - L3 AI Engine: RAG / embedding
 * - L1 Infrastructure: Storage
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
// 1. UI Tests — Library Main Page
// ---------------------------------------------------------------------------

test.describe("Library UI (/library)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
  });

  test("page loads without errors or error boundary", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    // Library page uses h3/h4 headings, not h1/h2
    const heading = page.locator("h1, h2, h3, [class*='title']").first();
    await expect(heading).toBeVisible({ timeout: 30000 });
  });

  test("resource list or empty state renders", async ({ page }) => {
    const resourceCards = page.locator(
      "[class*='resource'], [class*='library'], [class*='card'], [class*='item'], table",
    );
    const emptyState = page.getByText(
      /no.*resource|no.*item|empty|get started|upload|import/i,
    );

    const hasResources = (await resourceCards.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasResources || hasEmptyState,
      "Library page should show resources or empty state",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. UI Tests — RAG Page
// ---------------------------------------------------------------------------

test.describe("Library RAG UI (/library/rag)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library/rag", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("RAG page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("RAG page has heading", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });
});

// ---------------------------------------------------------------------------
// 3. API Contract Tests — Resources
// ---------------------------------------------------------------------------

test.describe("Library API — Resources", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /resources — list resources", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/resources`, {
      headers,
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /resources returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.resources ?? []);
    expect(Array.isArray(list), "Resources should be an array").toBe(true);
  });

  test("GET /resources — supports pagination parameters", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/resources?page=1&limit=5`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /resources with pagination returned ${response.status()}`,
    ).toBeTruthy();
  });

  test("GET /resources/:id — reject invalid id", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/resources/nonexistent-resource-id-xyz`,
      { headers, timeout: 15000 },
    );

    expect(
      [400, 404].includes(response.status()),
      `Invalid resource id should return 400/404, got ${response.status()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. API Contract Tests — RAG
// ---------------------------------------------------------------------------

test.describe("Library API — RAG", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library/rag", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /rag/collections — list RAG collections", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/rag/collections`,
      { headers, timeout: 15000 },
    );

    // RAG may or may not be configured
    expect(
      [200, 404].includes(response.status()),
      `GET /rag/collections returned ${response.status()}`,
    ).toBe(true);
  });
});
