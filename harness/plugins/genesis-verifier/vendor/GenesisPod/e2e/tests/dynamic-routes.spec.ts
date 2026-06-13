import { test, expect } from "@playwright/test";

/**
 * Dynamic Route Pages — E2E Tests
 *
 * Coverage for detail pages with dynamic [id] routes
 * and redirect/alias admin pages
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
// Helper: verify page loads without crash
// ---------------------------------------------------------------------------
async function verifyPageLoads(
  page: import("@playwright/test").Page,
  path: string,
) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await expect(page.locator("body")).not.toBeEmpty();
  const appError = page.getByText(/application error/i);
  await expect(appError).not.toBeVisible();
}

// ---------------------------------------------------------------------------
// 1. Admin Redirect/Alias Pages
// ---------------------------------------------------------------------------

test.describe("Admin Redirect Pages", () => {
  test("/admin/credits loads or redirects", async ({ page }) => {
    await verifyPageLoads(page, "/admin/credits");
  });

  test("/admin/logs loads or redirects", async ({ page }) => {
    await verifyPageLoads(page, "/admin/logs");
  });

  test("/admin/models loads or redirects", async ({ page }) => {
    await verifyPageLoads(page, "/admin/models");
  });

  test("/admin/overview loads", async ({ page }) => {
    await verifyPageLoads(page, "/admin/overview");
  });

  test("/admin/secrets loads or redirects", async ({ page }) => {
    await verifyPageLoads(page, "/admin/secrets");
  });

  test("/admin/users loads or redirects", async ({ page }) => {
    await verifyPageLoads(page, "/admin/users");
  });

  test("/admin/data-management loads", async ({ page }) => {
    await verifyPageLoads(page, "/admin/data-management");
  });
});

// ---------------------------------------------------------------------------
// 2. AI App Detail Pages (with test IDs)
// ---------------------------------------------------------------------------

test.describe("AI App Detail Pages", () => {
  test("/ai-writing/:id handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/ai-writing/test-nonexistent-id");
  });

  test("/ai-writing/report/:missionId handles nonexistent id", async ({
    page,
  }) => {
    await verifyPageLoads(page, "/ai-writing/report/test-nonexistent-id");
  });

  test("/ai-teams/:topicId handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/ai-teams/test-nonexistent-id");
  });

  test("/ai-research/:projectId handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/ai-research/test-nonexistent-id");
  });

  test("/ai-insights/topic/:topicId handles nonexistent id", async ({
    page,
  }) => {
    await verifyPageLoads(page, "/ai-insights/topic/test-nonexistent-id");
  });

  test("/ai-planning/:planId handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/ai-planning/test-nonexistent-id");
  });

  test("/ai-simulation/:id handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/ai-simulation/test-nonexistent-id");
  });

  test("/ai-simulation/edit/:id handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/ai-simulation/edit/test-nonexistent-id");
  });

  test("/ai-simulation/run/:id handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/ai-simulation/run/test-nonexistent-id");
  });

  test("/ai-social/edit/:id handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/ai-social/edit/test-nonexistent-id");
  });
});

// ---------------------------------------------------------------------------
// 3. Explore Detail Pages
// ---------------------------------------------------------------------------

test.describe("Explore Detail Pages", () => {
  test("/explore/resource/:id handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/explore/resource/test-nonexistent-id");
  });

  test("/explore/report/:id handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/explore/report/test-nonexistent-id");
  });

  test("/report/:missionId handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/report/test-nonexistent-id");
  });
});

// ---------------------------------------------------------------------------
// 4. Library Detail Pages
// ---------------------------------------------------------------------------

test.describe("Library Detail Pages", () => {
  test("/library/notion/:pageId handles nonexistent id", async ({ page }) => {
    await verifyPageLoads(page, "/library/notion/test-nonexistent-id");
  });
});

// ---------------------------------------------------------------------------
// 5. API Detail Endpoints
// ---------------------------------------------------------------------------

test.describe("Detail API Endpoints", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /writing/projects/:id — 404 for nonexistent", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/writing/projects/nonexistent-xyz`,
      { headers, timeout: 15000 },
    );

    expect(
      [400, 404].includes(response.status()),
      `Nonexistent project should return 400/404, got ${response.status()}`,
    ).toBe(true);
  });

  test("GET /topic-insights/topics/:id — 404 for nonexistent", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/topic-insights/topics/nonexistent-xyz`,
      { headers, timeout: 15000 },
    );

    expect(
      [400, 404].includes(response.status()),
      `Nonexistent topic should return 400/404, got ${response.status()}`,
    ).toBe(true);
  });
});
