import { test, expect } from "@playwright/test";

/**
 * AI Planning Flow — E2E Tests
 *
 * Planning module crossing L4 -> L2 layers:
 * - L4 AI Apps: Plan creation, milestone management
 * - L3 AI Engine: LLM-powered planning
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
// 1. UI Tests — AI Planning Main Page
// ---------------------------------------------------------------------------

test.describe("AI Planning UI (/ai-planning)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-planning", { waitUntil: "domcontentloaded" });
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

  test("plan list or empty state renders", async ({ page }) => {
    const planCards = page.locator(
      "[class*='plan'], [class*='card'], [class*='project'], table",
    );
    const emptyState = page.getByText(
      /no.*plan|empty|get started|create|new plan/i,
    );

    const hasPlans = (await planCards.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasPlans || hasEmptyState,
      "Planning page should show plans or empty state",
    ).toBe(true);
  });

  test("create plan option exists", async ({ page }) => {
    const createButton = page.getByRole("button", {
      name: /new|create|start|plan/i,
    });
    const createLink = page.getByRole("link", {
      name: /new|create|plan/i,
    });

    const hasCreate =
      (await createButton.count()) > 0 || (await createLink.count()) > 0;
    expect(hasCreate, "Planning page should have a create plan option").toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. API Contract Tests — Plans
// ---------------------------------------------------------------------------

test.describe("Planning API — Plans", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-planning", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /planning/plans — list plans", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/planning/plans`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /planning/plans returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.plans ?? []);
    expect(Array.isArray(list), "Plans should be an array").toBe(true);
  });

  test("POST /planning/plans — create plan", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(
      `${apiBase}/api/v1/planning/plans`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          title: "E2E Test Plan",
          goal: "Test planning automation",
          depth: "standard",
        },
        timeout: 15000,
      },
    );

    expect(
      [200, 201, 202].includes(response.status()),
      `POST /planning/plans returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /planning/plans/:id — get plan detail", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(`${apiBase}/api/v1/planning/plans`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.plans ?? []);
    if (list.length === 0) return;

    const planId = list[0].id ?? list[0]._id;
    const response = await page.request.get(
      `${apiBase}/api/v1/planning/plans/${planId}`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /planning/plans/:id returned ${response.status()}`,
    ).toBeTruthy();
  });

  test("GET /planning/templates — list plan templates", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/planning/templates`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 404].includes(response.status()),
      `GET /planning/templates returned ${response.status()}`,
    ).toBe(true);
  });
});
