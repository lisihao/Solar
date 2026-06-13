import { test, expect } from "@playwright/test";

/**
 * AI Image Flow — E2E Tests
 *
 * Image module crossing L4 -> L2 layers:
 * - L4 AI Apps: Image generation and gallery
 * - L3 AI Engine: Image generation models
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
// 1. UI Tests — AI Image Gallery
// ---------------------------------------------------------------------------

test.describe("AI Image UI (/ai-image)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-image", { waitUntil: "domcontentloaded" });
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

  test("gallery or empty state renders", async ({ page }) => {
    const gallery = page.locator(
      "[class*='gallery'], [class*='grid'], [class*='image'], [class*='card']",
    );
    const emptyState = page.getByText(
      /no.*image|empty|get started|create|generate/i,
    );

    const hasGallery = (await gallery.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasGallery || hasEmptyState,
      "Image page should show gallery or empty state",
    ).toBe(true);
  });

  test("create/generate option exists", async ({ page }) => {
    const createButton = page.getByRole("button", {
      name: /new|create|generate|start/i,
    });
    const createLink = page.getByRole("link", {
      name: /new|create|generate/i,
    });

    const hasCreate =
      (await createButton.count()) > 0 || (await createLink.count()) > 0;
    expect(hasCreate, "Image page should have a create/generate option").toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. UI Tests — Create Image Page
// ---------------------------------------------------------------------------

test.describe("AI Image Create UI (/ai-image/create)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-image/create", { waitUntil: "domcontentloaded" });
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
// 3. API Contract Tests — Image
// ---------------------------------------------------------------------------

test.describe("Image API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-image", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /image/generations — list generated images", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/image/generations`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /image/generations returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.generations ?? []);
    expect(Array.isArray(list), "Image generations should be an array").toBe(
      true,
    );
  });

  test("GET /image/models — list available models", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/image/models`, {
      headers,
      timeout: 15000,
    });

    // Models endpoint may or may not exist
    expect(
      [200, 404].includes(response.status()),
      `GET /image/models returned ${response.status()}`,
    ).toBe(true);
  });
});
