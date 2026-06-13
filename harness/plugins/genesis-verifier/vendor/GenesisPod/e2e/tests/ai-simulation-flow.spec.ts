import { test, expect } from "@playwright/test";

/**
 * AI Simulation Flow — E2E Tests
 *
 * Simulation module crossing L4 -> L2 layers:
 * - L4 AI Apps: Scenario simulation and execution
 * - L3 AI Engine: LLM-powered simulation
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
// 1. UI Tests — AI Simulation Main Page
// ---------------------------------------------------------------------------

test.describe("AI Simulation UI (/ai-simulation)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-simulation", { waitUntil: "domcontentloaded" });
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

  test("scenario list or empty state renders", async ({ page }) => {
    const scenarioCards = page.locator(
      "[class*='scenario'], [class*='simulation'], [class*='card'], table",
    );
    const emptyState = page.getByText(
      /no.*scenario|no.*simulation|empty|get started|create/i,
    );

    const hasScenarios = (await scenarioCards.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasScenarios || hasEmptyState,
      "Simulation page should show scenarios or empty state",
    ).toBe(true);
  });

  test("create simulation option exists", async ({ page }) => {
    const createButton = page.getByRole("button", {
      name: /new|create|simulate|start/i,
    });
    const createLink = page.getByRole("link", {
      name: /new|create|simulate/i,
    });

    const hasCreate =
      (await createButton.count()) > 0 || (await createLink.count()) > 0;
    expect(hasCreate, "Simulation page should have a create option").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. API Contract Tests — Simulations
// ---------------------------------------------------------------------------

test.describe("Simulation API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-simulation", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /simulation/scenarios — list scenarios", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/simulation/scenarios`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /simulation/scenarios returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.scenarios ?? []);
    expect(Array.isArray(list), "Scenarios should be an array").toBe(true);
  });

  test("POST /simulation/scenarios — create scenario", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(
      `${apiBase}/api/v1/simulation/scenarios`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          title: "E2E Test Scenario",
          description: "Test scenario created by Playwright E2E",
        },
        timeout: 15000,
      },
    );

    expect(
      [200, 201, 202].includes(response.status()),
      `POST /simulation/scenarios returned ${response.status()}`,
    ).toBe(true);
  });
});
