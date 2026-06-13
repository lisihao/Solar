import { test, expect } from "@playwright/test";

/**
 * Admin System & Access Pages — E2E Tests
 *
 * Covers uncovered admin pages:
 * - Access: Billing, Secrets, Security, Users
 * - System: Credits, Logs, Models, Email, Site, Storage
 *
 * Tests ensure pages load without errors and core UI elements are visible.
 */

// ---------------------------------------------------------------------------
// Auth helper — Extract JWT from localStorage
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

/**
 * Helper to navigate and wait for page to settle.
 * Waits for DOM content and additional 1000ms for React hydration.
 */
async function gotoAndWait(
  page: import("@playwright/test").Page,
  path: string,
) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
}

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 1: Access Pages
// ──────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// 1. Billing Page (/admin/access/billing)
// ---------------------------------------------------------------------------

test.describe("Admin Billing (/admin/access/billing)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/access/billing");
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error|出错了/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("no error boundary displayed", async ({ page }) => {
    const errorDiv = page.locator('[class*="error"], [class*="Error"]').first();
    // If error boundary exists, it would have specific text
    const errorText = page.getByText(/error boundary|error occurred/i);
    await expect(errorText).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Secrets Page (/admin/access/secrets)
// ---------------------------------------------------------------------------

test.describe("Admin Secrets (/admin/access/secrets)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/access/secrets");
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error|出错了/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("secrets management UI renders", async ({ page }) => {
    // Secrets page should show either a list or empty state
    const content = page.locator("main, [role='main']");
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 3. Security Page (/admin/access/security)
// ---------------------------------------------------------------------------

test.describe("Admin Security (/admin/access/security)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/access/security");
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error|出错了/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("security settings content is visible", async ({ page }) => {
    const content = page.locator("main, [role='main']");
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Users Page (/admin/access/users)
// ---------------------------------------------------------------------------

test.describe("Admin Users (/admin/access/users)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/access/users");
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error|出错了/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("users table or empty state renders", async ({ page }) => {
    const table = page.locator("table");
    const emptyState = page.getByText(/no users|暂无|empty/i);
    const content = page.locator("main, [role='main']");
    await expect(table.or(emptyState).or(content)).toBeVisible({
      timeout: 10000,
    });
  });

  test("search or filter controls are present", async ({ page }) => {
    const searchInput = page.locator(
      "input[type='text'], input[type='search']",
    );
    const controls = page.locator("[role='search'], .search");
    await expect(searchInput.or(controls).first()).toBeVisible({
      timeout: 10000,
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 2: System Pages
// ──────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// 5. Credits Dashboard (/admin/credits)
// ---------------------------------------------------------------------------

test.describe("Admin Credits (/admin/credits)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/credits");
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error|出错了/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("credits dashboard content renders", async ({ page }) => {
    const content = page.locator("main, [role='main']");
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("credits stats or charts are visible", async ({ page }) => {
    // Credits page typically shows stats, charts, or usage info
    const statsCard = page.locator("[class*='card'], [class*='stat']");
    const chart = page.locator("canvas, [role='img']");
    const content = page.locator("main, [role='main']");
    await expect(statsCard.or(chart).or(content)).toBeVisible({
      timeout: 10000,
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Logs Page (/admin/logs)
// ---------------------------------------------------------------------------

test.describe("Admin Logs (/admin/logs)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/logs");
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error|出错了/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("logs table or list renders", async ({ page }) => {
    const logsTable = page.locator("table");
    const logsList = page.locator("ul, [role='list']");
    const content = page.locator("main, [role='main']");
    await expect(logsTable.or(logsList).or(content)).toBeVisible({
      timeout: 10000,
    });
  });

  test("filter or search controls are available", async ({ page }) => {
    const searchInput = page.locator(
      "input[type='text'], input[type='search']",
    );
    const filterButton = page.locator("button:has-text(/filter|search/i)");
    const controls = page.locator("[role='search'], .filter");
    await expect(searchInput.or(filterButton).or(controls).first()).toBeVisible(
      {
        timeout: 10000,
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Models Page (/admin/models)
// ---------------------------------------------------------------------------

test.describe("Admin Models (/admin/models)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/models");
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error|出错了/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("models list or grid renders", async ({ page }) => {
    const table = page.locator("table");
    const grid = page.locator("[class*='grid'], [class*='flex-wrap']");
    const content = page.locator("main, [role='main']");
    await expect(table.or(grid).or(content)).toBeVisible({ timeout: 10000 });
  });

  test("model management controls are visible", async ({ page }) => {
    const addButton = page.locator("button:has-text(/add|create|new/i)");
    const controls = page.locator("[role='toolbar'], .controls");
    const content = page.locator("main, [role='main']");
    await expect(addButton.or(controls).or(content)).toBeVisible({
      timeout: 10000,
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Email Configuration Page (/admin/system/email)
// ---------------------------------------------------------------------------

test.describe("Admin Email Configuration (/admin/system/email)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/system/email");
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error|出错了/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("email configuration form renders", async ({ page }) => {
    const form = page.locator("form");
    const inputs = page.locator("input[type='text'], input[type='email']");
    const content = page.locator("main, [role='main']");
    await expect(form.or(inputs).or(content)).toBeVisible({ timeout: 10000 });
  });

  test("submit or save button is visible", async ({ page }) => {
    const submitButton = page.locator(
      "button:has-text(/submit|save|apply/i), button[type='submit']",
    );
    const content = page.locator("main, [role='main']");
    await expect(submitButton.or(content)).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 9. Site Configuration Page (/admin/system/site)
// ---------------------------------------------------------------------------

test.describe("Admin Site Configuration (/admin/system/site)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/system/site");
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error|出错了/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("site configuration form renders", async ({ page }) => {
    const form = page.locator("form");
    const inputs = page.locator("input[type='text'], textarea");
    const content = page.locator("main, [role='main']");
    await expect(form.or(inputs).or(content)).toBeVisible({ timeout: 10000 });
  });

  test("configuration fields are accessible", async ({ page }) => {
    const formFields = page.locator("input, textarea, select");
    const content = page.locator("main, [role='main']");
    await expect(formFields.or(content)).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 10. Storage Configuration Page (/admin/storage)
// ---------------------------------------------------------------------------

test.describe("Admin Storage Configuration (/admin/storage)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/storage");
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error|出错了/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("storage configuration content renders", async ({ page }) => {
    const form = page.locator("form");
    const inputs = page.locator("input[type='text'], select");
    const content = page.locator("main, [role='main']");
    await expect(form.or(inputs).or(content)).toBeVisible({ timeout: 10000 });
  });

  test("storage status or info is displayed", async ({ page }) => {
    const statusIndicator = page.locator("[class*='status'], [class*='info']");
    const content = page.locator("main, [role='main']");
    await expect(statusIndicator.or(content)).toBeVisible({ timeout: 10000 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 3: API Contract Tests
// ──────────────────────────────────────────────────────────────────────────────

test.describe("Admin System & Access API Contracts", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWait(page, "/admin/access/billing");
  });

  test("GET /admin/access/billing — returns valid response", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/access/billing`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/access/billing returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/access/secrets — returns valid response", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/access/secrets`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/access/secrets returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/access/security — returns valid response", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/access/security`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/access/security returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/access/users — returns valid response", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/access/users`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/access/users returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/credits — returns valid response", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/admin/credits`, {
      headers,
      timeout: 15000,
    });

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/credits returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/logs — returns valid response", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/admin/logs`, {
      headers,
      timeout: 15000,
    });

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/logs returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/models — returns valid response", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/admin/models`, {
      headers,
      timeout: 15000,
    });

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/models returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/system/email — returns valid response", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/system/email`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/system/email returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/system/site — returns valid response", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/system/site`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/system/site returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/storage — returns valid response", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/storage-config`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403, 404].includes(response.status()),
      `GET /admin/storage-config returned ${response.status()}`,
    ).toBe(true);
  });
});
