import { test, expect } from "@playwright/test";

/**
 * AI Social Flow — E2E Tests
 *
 * Social content module crossing L4 -> L2 -> L1 layers:
 * - L4 AI Apps: Social content creation and publishing
 * - L3 AI Engine: Content generation
 * - L1 Infrastructure: Credits and integrations
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
// 1. UI Tests — AI Social Main Page
// ---------------------------------------------------------------------------

test.describe("AI Social UI (/ai-social)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-social", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors or error boundary", async ({ page }) => {
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

  test("content list or empty state renders", async ({ page }) => {
    const contentCards = page.locator(
      "[class*='social'], [class*='card'], [class*='content'], [class*='post'], table",
    );
    const emptyState = page.getByText(
      /no.*content|no.*post|empty|get started|create/i,
    );

    const hasContent = (await contentCards.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasContent || hasEmptyState,
      "Social page should show content or empty state",
    ).toBe(true);
  });

  test("create content option exists", async ({ page }) => {
    const createButton = page.getByRole("button", {
      name: /new|create|generate|write|start/i,
    });
    const createLink = page.getByRole("link", {
      name: /new|create|generate/i,
    });

    const hasCreate =
      (await createButton.count()) > 0 || (await createLink.count()) > 0;
    expect(hasCreate, "Social page should have a create option").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. UI Tests — Create Social Content Page
// ---------------------------------------------------------------------------

test.describe("AI Social Create UI (/ai-social/create)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-social/create", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("create page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("create page has form elements", async ({ page }) => {
    const inputs = page.locator("input, textarea, select");
    const buttons = page.getByRole("button");
    expect(
      (await inputs.count()) > 0 || (await buttons.count()) > 0,
      "Create page should have form elements",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. API Contract Tests — Social Content
// ---------------------------------------------------------------------------

test.describe("Social API — Content", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-social", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /social/contents — list social content", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/social/contents`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /social/contents returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.contents ?? []);
    expect(Array.isArray(list), "Social contents should be an array").toBe(
      true,
    );
  });

  test("GET /social/connections — list platform connections", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/social/connections`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /social/connections returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.connections ?? []);
    expect(Array.isArray(list), "Connections should be an array").toBe(true);
  });

  test("POST /social/contents — create content", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(
      `${apiBase}/api/v1/social/contents`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          title: "E2E Test Social Content",
          content: "This is a test social post created by Playwright E2E",
          platform: "wechat",
        },
        timeout: 15000,
      },
    );

    expect(
      [200, 201, 202].includes(response.status()),
      `POST /social/contents returned ${response.status()}`,
    ).toBe(true);
  });
});
