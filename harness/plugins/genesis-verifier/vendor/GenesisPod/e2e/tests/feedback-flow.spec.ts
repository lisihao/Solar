import { test, expect } from "@playwright/test";

/**
 * Feedback Flow — E2E Tests
 *
 * Feedback submission and history pages
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
// 1. Feedback Main Page
// ---------------------------------------------------------------------------

test.describe("Feedback Page (/feedback)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/feedback", { waitUntil: "domcontentloaded" });
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

  test("feedback form or list renders", async ({ page }) => {
    const formElements = page.locator("input, textarea, select");
    const cards = page.locator(
      "[class*='feedback'], [class*='card'], [class*='form']",
    );
    const emptyState = page.getByText(
      /no.*feedback|submit.*feedback|share.*feedback/i,
    );

    const hasForm = (await formElements.count()) > 0;
    const hasCards = (await cards.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasForm || hasCards || hasEmptyState,
      "Feedback page should show form, list, or empty state",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Feedback History Page
// ---------------------------------------------------------------------------

test.describe("Feedback History (/feedback/history)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/feedback/history", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("history list or empty state renders", async ({ page }) => {
    const historyItems = page.locator(
      "[class*='history'], [class*='feedback'], [class*='card'], table",
    );
    const emptyState = page.getByText(/no.*feedback|no.*history|empty/i);

    const hasHistory = (await historyItems.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasHistory || hasEmptyState,
      "Feedback history should show items or empty state",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. API Contract Tests — Feedback
// ---------------------------------------------------------------------------

test.describe("Feedback API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/feedback", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /feedback — list feedback", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/feedback`, {
      headers,
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /feedback returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.feedbacks ?? []);
    expect(Array.isArray(list), "Feedback should be an array").toBe(true);
  });

  test("POST /feedback — submit feedback", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(`${apiBase}/api/v1/feedback`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {
        type: "suggestion",
        message: "E2E test feedback - please ignore",
        rating: 5,
      },
      timeout: 15000,
    });

    expect(
      [200, 201].includes(response.status()),
      `POST /feedback returned ${response.status()}`,
    ).toBe(true);
  });
});
