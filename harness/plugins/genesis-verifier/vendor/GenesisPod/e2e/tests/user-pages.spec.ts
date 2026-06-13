import { test, expect } from "@playwright/test";

/**
 * User Pages — E2E Tests
 *
 * User-facing pages: profile, credits, notifications
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
// 1. Profile Page
// ---------------------------------------------------------------------------

test.describe("Profile Page (/profile)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("profile information is visible", async ({ page }) => {
    // Profile page should show user info
    const profileContent = page.locator(
      "[class*='profile'], [class*='user'], [class*='account'], [class*='settings']",
    );
    const heading = page.locator("h1, h2").first();

    const hasProfile = (await profileContent.count()) > 0;
    const hasHeading = (await heading.count()) > 0;

    expect(
      hasProfile || hasHeading,
      "Profile page should show user information",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Credits Page
// ---------------------------------------------------------------------------

test.describe("Credits Page (/credits)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/credits", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("credits information is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("credits balance or usage is displayed", async ({ page }) => {
    const creditInfo = page.locator(
      "[class*='credit'], [class*='balance'], [class*='usage'], [class*='billing']",
    );
    const text = page.getByText(/credit|balance|usage|plan/i);

    const hasCreditInfo = (await creditInfo.count()) > 0;
    const hasText = (await text.count()) > 0;

    expect(
      hasCreditInfo || hasText,
      "Credits page should show credit information",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Notifications Page
// ---------------------------------------------------------------------------

test.describe("Notifications Page (/notifications)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("notifications list or empty state renders", async ({ page }) => {
    const notifications = page.locator(
      "[class*='notification'], [class*='alert'], [class*='message'], [class*='card']",
    );
    const emptyState = page.getByText(
      /no.*notification|empty|all caught up|no new/i,
    );

    const hasNotifications = (await notifications.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasNotifications || hasEmptyState,
      "Notifications page should show notifications or empty state",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. API Contract Tests — User
// ---------------------------------------------------------------------------

test.describe("User API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /auth/me — get current user", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/auth/me`, {
      headers,
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /auth/me returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const user = body.data ?? body;
    expect(user, "User object should be truthy").toBeTruthy();
  });

  test("GET /credits/balance — get credit balance", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/credits/balance`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /credits/balance returned ${response.status()}`,
    ).toBeTruthy();
  });

  test("GET /credits/usage — get credit usage history", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/credits/usage`, {
      headers,
      timeout: 15000,
    });

    expect(
      [200, 404].includes(response.status()),
      `GET /credits/usage returned ${response.status()}`,
    ).toBe(true);
  });
});
