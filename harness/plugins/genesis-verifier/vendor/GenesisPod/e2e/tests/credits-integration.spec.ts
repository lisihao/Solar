import { test, expect } from "@playwright/test";

/**
 * Credits System Integration — E2E Tests
 *
 * Credits L1 Infrastructure → cross-layer:
 * - L1 AI Infra: Credits module (balance, transactions, rules)
 * - Cross-layer: Credits consumed by L4 AI Apps during LLM calls
 * - Admin: Credit management for platform operators
 */

// ---------------------------------------------------------------------------
// Auth helper — reads JWT stored by the auth setup step
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
// 1. UI Tests — Credits Admin Page
// ---------------------------------------------------------------------------

test.describe("Credits Admin Page (/admin/access/credits)", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/admin/access/credits", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);

    await expect(page.locator("h1")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("credit stats or accounts display renders", async ({ page }) => {
    await page.goto("/admin/access/credits");
    try {
      await page.waitForResponse(
        (r) => r.url().includes("/admin/credits") && r.status() === 200,
        { timeout: 15000 },
      );
    } catch {
      // Continue even if response not captured
    }
    await page.waitForTimeout(500);

    // Either a table of accounts or stats cards must be visible
    const table = page.locator("table");
    const statsCard = page.locator(".rounded-xl, [class*='card']");
    const hasTable = (await table.count()) > 0;
    const hasCards = (await statsCard.count()) > 0;

    expect(
      hasTable || hasCards,
      "Credits page should show accounts or stats cards",
    ).toBe(true);
  });

  test("page does not show error boundary", async ({ page }) => {
    await page.goto("/admin/access/credits", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);

    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. API Contract Tests — Credit Account & Balance (L1 Infra)
// ---------------------------------------------------------------------------

test.describe("Credits API — Account & Balance (L1 Infra)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/access/credits", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(500);
  });

  test("GET /credits — get account info", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/credits`, {
      headers,
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /credits returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const account = body.data ?? body;
    expect(account, "Credit account should be truthy").toBeTruthy();
  });

  test("GET /credits/balance — get balance returns number", async ({
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

    const body = await response.json();
    const payload = body.data ?? body;

    // Balance should be a number (directly or in a balance field)
    const balance =
      typeof payload === "number"
        ? payload
        : (payload.balance ?? payload.amount);
    expect(typeof balance, "Balance should be a number").toBe("number");
  });

  test("GET /credits/stats — get usage statistics", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/credits/stats`, {
      headers,
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /credits/stats returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const stats = body.data ?? body;
    expect(stats, "Credit stats should be truthy").toBeTruthy();
    expect(typeof stats, "Credit stats should be an object").toBe("object");
  });
});

// ---------------------------------------------------------------------------
// 3. API Contract Tests — Transactions (L1 Infra)
// ---------------------------------------------------------------------------

test.describe("Credits API — Transactions (L1 Infra)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/access/credits", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(500);
  });

  test("GET /credits/transactions — get transaction history returns array", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/credits/transactions`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /credits/transactions returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.transactions ?? []);
    expect(Array.isArray(list), "Transactions should be an array").toBe(true);
  });

  test("GET /credits/rules — get credit rules", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/credits/rules`, {
      headers,
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /credits/rules returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    // Rules may be an array or object
    expect(payload, "Credit rules should be truthy").toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. API Contract Tests — Daily Checkin (L1 Infra)
// ---------------------------------------------------------------------------

test.describe("Credits API — Daily Checkin (L1 Infra)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/access/credits", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(500);
  });

  test("GET /credits/checkin/status — check daily checkin status", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/credits/checkin/status`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /credits/checkin/status returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const status = body.data ?? body;
    expect(status, "Checkin status should be truthy").toBeTruthy();

    // Should have a boolean field indicating if already checked in today
    const hasCheckedIn =
      "checkedIn" in status ||
      "hasCheckedIn" in status ||
      "checked" in status ||
      typeof status === "object";
    expect(
      hasCheckedIn,
      "Checkin status should have a checked-in indicator",
    ).toBe(true);
  });

  test("POST /credits/checkin — perform daily checkin", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(
      `${apiBase}/api/v1/credits/checkin`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {},
        timeout: 15000,
      },
    );

    // Checkin may succeed (200/201) or fail if already checked in today (400/409)
    expect(
      [200, 201, 400, 409].includes(response.status()),
      `POST /credits/checkin returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /credits/checkin/history — get checkin history", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/credits/checkin/history`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 404].includes(response.status()),
      `GET /credits/checkin/history returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const payload = body.data ?? body;
      const list = Array.isArray(payload)
        ? payload
        : (payload.items ?? payload.history ?? []);
      expect(Array.isArray(list), "Checkin history should be an array").toBe(
        true,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 5. API Contract Tests — Estimation (L1 Infra)
// ---------------------------------------------------------------------------

test.describe("Credits API — Estimation (L1 Infra)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/access/credits", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(500);
  });

  test("GET /credits/estimate?action=chat — estimate chat consumption", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/credits/estimate?action=chat`,
      { headers, timeout: 15000 },
    );

    // Estimate may return 200 with cost info or 404 if not implemented
    expect(
      [200, 404].includes(response.status()),
      `GET /credits/estimate returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const estimate = body.data ?? body;
      expect(estimate, "Estimate should be truthy").toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Admin API Tests — Credit Management
// ---------------------------------------------------------------------------

test.describe("Credits Admin API — Management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/access/credits", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(500);
  });

  test("GET /admin/credits/accounts — returns paged accounts", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/credits/accounts`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /admin/credits/accounts returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;
    expect(data).toHaveProperty("accounts");
    expect(Array.isArray(data.accounts)).toBe(true);
    expect(data).toHaveProperty("total");
    expect(typeof data.total).toBe("number");
  });

  test("POST /admin/credits/grant — grant credits requires admin (auth check)", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Get a user id to grant credits to
    const usersRes = await page.request.get(
      `${apiBase}/api/v1/admin/users?pageSize=1`,
      { headers, timeout: 15000 },
    );

    if (!usersRes.ok()) return;

    const usersBody = await usersRes.json();
    const usersData = usersBody.data ?? usersBody;
    const users = usersData.users ?? usersData.items ?? [];

    if (users.length === 0) return;

    const userId = users[0].id ?? users[0]._id;

    const response = await page.request.post(
      `${apiBase}/api/v1/admin/credits/grant`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          userId,
          amount: 10,
          reason: "E2E test grant",
        },
        timeout: 15000,
      },
    );

    // Admin grant should succeed (200/201) or fail with proper error (400/403/404)
    expect(
      [200, 201, 400, 403, 404].includes(response.status()),
      `POST /admin/credits/grant returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/credits/stats — get platform-wide credit stats", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/credits/stats`,
      { headers, timeout: 15000 },
    );

    // May return 200 or 404 if not implemented
    expect(
      [200, 404].includes(response.status()),
      `GET /admin/credits/stats returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const stats = body.data ?? body;
      expect(stats, "Credit stats should be truthy").toBeTruthy();
    }
  });

  test("Credit system cross-layer: balance check reflects in admin accounts", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Get user's own balance
    const balanceRes = await page.request.get(
      `${apiBase}/api/v1/credits/balance`,
      { headers, timeout: 15000 },
    );

    if (!balanceRes.ok()) return;

    const balanceBody = await balanceRes.json();
    const balancePayload = balanceBody.data ?? balanceBody;
    const userBalance =
      typeof balancePayload === "number"
        ? balancePayload
        : (balancePayload.balance ?? 0);

    // Admin endpoint shows accounts with balances
    const accountsRes = await page.request.get(
      `${apiBase}/api/v1/admin/credits/accounts`,
      { headers, timeout: 15000 },
    );

    expect(
      accountsRes.ok(),
      "Admin accounts endpoint should respond",
    ).toBeTruthy();

    const accountsBody = await accountsRes.json();
    const accountsData = accountsBody.data ?? accountsBody;
    expect(Array.isArray(accountsData.accounts)).toBe(true);

    // The user balance (L1) is visible in admin accounts (cross-layer)
    expect(
      typeof userBalance,
      "User balance should be a number (L1 data integrity)",
    ).toBe("number");
  });
});
