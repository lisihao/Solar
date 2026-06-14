import { test, expect } from "@playwright/test";

/**
 * Auth Flow — E2E Tests
 *
 * Authentication pages: callback, login/register UI
 */

// ---------------------------------------------------------------------------
// 1. Auth Callback Page
// ---------------------------------------------------------------------------

test.describe("Auth Callback (/auth/callback)", () => {
  test("callback page renders without crash", async ({ page }) => {
    // Auth callback without params should redirect or show error
    await page.goto("/auth/callback", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    // Should not show application error
    const appError = page.getByText(/application error/i);
    await expect(appError).not.toBeVisible();
  });

  test("callback with invalid code handles gracefully", async ({ page }) => {
    await page.goto("/auth/callback?code=invalid_code_xyz", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    // Should not crash, may redirect to login or show error
    const appError = page.getByText(/application error/i);
    await expect(appError).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Unauthenticated Access
// ---------------------------------------------------------------------------

test.describe("Unauthenticated Access", () => {
  // Use a fresh context without auth state
  test.use({ storageState: { cookies: [], origins: [] } });

  test("protected pages redirect to login or show auth prompt", async ({
    page,
  }) => {
    await page.goto("/ai-research", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    // Should either redirect to login or show auth prompt
    const loginPrompt = page.getByText(
      /sign in|log in|login|authenticate|unauthorized/i,
    );
    const loginButton = page.getByRole("button", { name: /sign in|log in/i });
    const loginLink = page.getByRole("link", { name: /sign in|log in/i });

    const currentUrl = page.url();
    const isRedirected =
      currentUrl.includes("login") || currentUrl.includes("auth");
    const hasLoginPrompt = (await loginPrompt.count()) > 0;
    const hasLoginButton = (await loginButton.count()) > 0;
    const hasLoginLink = (await loginLink.count()) > 0;

    // At least one auth mechanism should be present
    expect(
      isRedirected || hasLoginPrompt || hasLoginButton || hasLoginLink,
      "Protected page should redirect to login or show auth prompt",
    ).toBe(true);
  });

  test("share pages accessible without auth", async ({ page }) => {
    // Share pages should be accessible without authentication
    await page.goto("/share/writing/test-id", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    // Should not show application error (may show "not found")
    const appError = page.getByText(/application error/i);
    await expect(appError).not.toBeVisible();
  });
});
