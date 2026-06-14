import { test, expect } from "@playwright/test";

/**
 * AI Office Flow — E2E Tests
 *
 * Office module (slides, documents) crossing L4 -> L2 -> L1 layers:
 * - L4 AI Apps: Office module (slides generation, document creation)
 * - L3 AI Engine: LLM service (content generation)
 * - L1 Infrastructure: Credits consumed during generation
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
// 1. UI Tests — AI Office Main Page
// ---------------------------------------------------------------------------

test.describe("AI Office UI (/ai-office)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-office", { waitUntil: "domcontentloaded" });
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

  test("slide list or empty state renders", async ({ page }) => {
    const slideCards = page.locator(
      "[class*='slide'], [class*='card'], [class*='office'], [class*='presentation'], table",
    );
    const emptyState = page.getByText(
      /no.*slide|no.*presentation|empty|get started|create/i,
    );

    const hasSlides = (await slideCards.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasSlides || hasEmptyState,
      "Office page should show slides or empty state",
    ).toBe(true);
  });

  test("create option exists", async ({ page }) => {
    const createButton = page.getByRole("button", {
      name: /new|create|generate|start/i,
    });
    const createLink = page.getByRole("link", {
      name: /new|create|generate/i,
    });

    const hasCreate =
      (await createButton.count()) > 0 || (await createLink.count()) > 0;
    expect(hasCreate, "Office page should have a create option").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. UI Tests — Slides Sub-Page
// ---------------------------------------------------------------------------

test.describe("AI Office Slides UI (/ai-office/slides)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-office/slides", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("slides page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("slides page has heading", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });
});

// ---------------------------------------------------------------------------
// 3. API Contract Tests — Office Slides
// ---------------------------------------------------------------------------

test.describe("Office API — Slides", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-office", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /office/slides — list slides returns array", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/office/slides`, {
      headers,
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /office/slides returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.slides ?? []);
    expect(Array.isArray(list), "Slides should be an array").toBe(true);
  });

  test("POST /office/slides — create slide deck", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(
      `${apiBase}/api/v1/office/slides`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          title: "E2E Test Slide Deck",
          topic: "Testing automation",
          slideCount: 5,
        },
        timeout: 15000,
      },
    );

    // Accept 200, 201, or 202 (async generation)
    expect(
      [200, 201, 202].includes(response.status()),
      `POST /office/slides returned ${response.status()}`,
    ).toBe(true);
  });

  test("POST /office/slides — validation: reject empty title", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(
      `${apiBase}/api/v1/office/slides`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { slideCount: 5 },
        timeout: 15000,
      },
    );

    expect(
      [400, 422].includes(response.status()),
      `Missing title should return 400/422, got ${response.status()}`,
    ).toBe(true);
  });
});
