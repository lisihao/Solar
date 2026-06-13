import { test, expect } from "@playwright/test";

/**
 * Admin Infrastructure (L1) and System Pages — E2E Tests
 *
 * Covers:
 * 1. Access / Infrastructure pages: Users, Permissions, Secrets, Credits, Billing, Security
 * 2. System pages: MCP Server, Notifications, Storage, Logs, Monitoring, Email, Site
 * 3. Cross-layer API contract tests (direct HTTP assertions)
 */

/** Helper: read JWT from localStorage for direct API calls */
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

/**
 * Navigate to a page and wait for it to settle.
 * Returns after the network is idle or 3 s, whichever comes first.
 */
async function gotoAndWait(
  page: import("@playwright/test").Page,
  path: string,
) {
  await page.goto(path);
  // Allow React to hydrate and data fetches to complete
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(600);
}

// ──────────────────────────────────────────────────────────────────────────────
// Access / Infrastructure Pages
// ──────────────────────────────────────────────────────────────────────────────

test.describe("Admin Infrastructure — Access Pages", () => {
  // ── Users Page ──────────────────────────────────────────────────────────────

  test.describe("Users Page (/admin/access/users)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/users");

      // Heading should be visible (h1 rendered by AdminPageLayout)
      await expect(page.locator("h1")).toBeVisible();

      // No error boundary
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("users table renders after data load", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/users");

      // Wait for at least one table row or empty-state message
      const table = page.locator("table");
      const emptyState = page.getByText(/no users|暂无|empty/i);
      await expect(table.or(emptyState)).toBeVisible({ timeout: 10000 });
    });

    test("search bar is present", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/users");

      // UsersSearchBar renders an <input>
      await expect(
        page.locator("input[type='text'], input[type='search']").first(),
      ).toBeVisible();
    });
  });

  // ── Permissions Page ─────────────────────────────────────────────────────────

  test.describe("Permissions Page (/admin/access/permissions)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/permissions");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("stats cards render after data load", async ({ page }) => {
      await page.goto("/admin/access/permissions");
      // Wait for API response
      await page.waitForResponse(
        (r) =>
          r.url().includes("/admin/permissions/overview") && r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      // 4 stat cards should be visible
      const statCards = page.locator(".rounded-xl.border.bg-white");
      await expect(statCards.first()).toBeVisible();
    });

    test("admin list table is present", async ({ page }) => {
      await page.goto("/admin/access/permissions");
      await page.waitForResponse(
        (r) =>
          r.url().includes("/admin/permissions/overview") && r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      const table = page.locator("table");
      await expect(table).toBeVisible();
    });

    test("Add Admin button is present", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/permissions");

      // The page renders a button to add admin users
      const addButton = page.getByRole("button", {
        name: /add admin|添加管理员/i,
      });
      await expect(addButton).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Secrets Page ─────────────────────────────────────────────────────────────

  test.describe("Secrets Page (/admin/access/secrets)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/secrets");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("page shows 'Secret Management' heading text", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/secrets");
      // The page hardcodes title "Secret Management"
      await expect(
        page.getByText("Secret Management", { exact: false }),
      ).toBeVisible({ timeout: 10000 });
    });

    test("Add Secret button is present", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/secrets");
      const addButton = page.getByRole("button", { name: /add secret/i });
      await expect(addButton).toBeVisible();
    });

    test("secrets list or empty state renders", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/secrets");

      // SecretsManager renders a list or empty-state
      const listOrEmpty = page
        .locator("table, [data-testid='secrets-list'], .rounded-xl")
        .first();
      await expect(listOrEmpty).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Credits Page ─────────────────────────────────────────────────────────────

  test.describe("Credits Page (/admin/access/credits)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/credits");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("credit accounts table renders after data load", async ({ page }) => {
      await page.goto("/admin/access/credits");
      await page.waitForResponse(
        (r) =>
          r.url().includes("/admin/credits/accounts") && r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      const table = page.locator("table");
      const emptyState = page.getByText(/no accounts|暂无|empty/i);
      await expect(table.or(emptyState)).toBeVisible();
    });

    test("balance-related column headers visible", async ({ page }) => {
      await page.goto("/admin/access/credits");
      await page.waitForResponse(
        (r) =>
          r.url().includes("/admin/credits/accounts") && r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      // Table should show balance header (case-insensitive)
      const balanceHeader = page.getByText(/balance|余额/i).first();
      await expect(balanceHeader).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Billing Page ──────────────────────────────────────────────────────────────

  test.describe("Billing Page (/admin/access/billing)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/billing");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("billing content area renders", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/billing");

      // Page should show some billing or cost content
      const content = page
        .locator("main, [role='main'], .admin-page-content, article")
        .first();
      await expect(content).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Security Page ─────────────────────────────────────────────────────────────

  test.describe("Security Page (/admin/access/security)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/security");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("authentication settings card is visible", async ({ page }) => {
      await gotoAndWait(page, "/admin/access/security");
      // Page renders "Authentication Settings" card (hardcoded)
      await expect(
        page.getByText("Authentication Settings", { exact: false }),
      ).toBeVisible({ timeout: 10000 });
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// System Pages
// ──────────────────────────────────────────────────────────────────────────────

test.describe("Admin Infrastructure — System Pages", () => {
  // ── MCP Server Page ──────────────────────────────────────────────────────────

  test.describe("MCP Server Page (/admin/system/mcp-server)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/system/mcp-server");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("MCP server list or empty state renders", async ({ page }) => {
      await page.goto("/admin/system/mcp-server");
      await page.waitForResponse(
        (r) => r.url().includes("/admin/ai/mcp-servers") && r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      // Should show a list or empty state
      const listOrEmpty = page
        .locator("table, [data-testid='mcp-list']")
        .or(page.getByText(/no servers|no mcp|暂无|empty/i));
      await expect(listOrEmpty.first()).toBeVisible({ timeout: 10000 });
    });

    test("external MCP server section is rendered", async ({ page }) => {
      await page.goto("/admin/system/mcp-server");
      await page.waitForResponse(
        (r) => r.url().includes("/admin/ai/mcp-servers") && r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      // The page renders both own MCP server status and external MCP list
      // External section uses an "Add" or similar action button
      const addButton = page
        .getByRole("button", { name: /add|新增|connect/i })
        .first();
      await expect(addButton).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Notifications Page ───────────────────────────────────────────────────────

  test.describe("Notifications Page (/admin/system/notifications)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/system/notifications");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("notifications list or empty state renders after data load", async ({
      page,
    }) => {
      await page.goto("/admin/system/notifications");
      await page.waitForResponse(
        (r) =>
          (r.url().includes("/admin/notifications/stats") ||
            r.url().includes("/admin/notifications/recent")) &&
          r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      // Should show list, stats cards, or empty state
      const content = page.locator("table, .rounded-xl").first();
      await expect(content).toBeVisible({ timeout: 10000 });
    });

    test("Broadcast button is present", async ({ page }) => {
      await gotoAndWait(page, "/admin/system/notifications");

      const broadcastBtn = page
        .getByRole("button", { name: /broadcast|send|发送/i })
        .first();
      await expect(broadcastBtn).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Storage Page ─────────────────────────────────────────────────────────────

  test.describe("Storage Page (/admin/storage)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/storage");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("storage settings content renders", async ({ page }) => {
      await gotoAndWait(page, "/admin/storage");

      // StorageSettings component should render some content
      const content = page.locator("main, .admin-page-content").first();
      await expect(content).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Logs Page ────────────────────────────────────────────────────────────────

  test.describe("Logs Page (/admin/system/logs)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/system/logs");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("log stats render after data load", async ({ page }) => {
      await page.goto("/admin/system/logs");
      await page.waitForResponse(
        (r) => r.url().includes("/admin/logs/stats") && r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      // Stat values should be visible (totalLogins, todayLogins, etc.)
      const statsArea = page.locator(".rounded-xl.border, .grid").first();
      await expect(statsArea).toBeVisible();
    });

    test("login history section is present", async ({ page }) => {
      await page.goto("/admin/system/logs");
      await page.waitForResponse(
        (r) => r.url().includes("/admin/logs/stats") && r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      // Page shows login history tab or section
      const loginSection = page
        .getByText(/login history|登录记录|login/i)
        .first();
      await expect(loginSection).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Monitoring Page ──────────────────────────────────────────────────────────

  test.describe("Monitoring Page (/admin/system/monitoring)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/system/monitoring");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("monitoring dashboard renders after error stats load", async ({
      page,
    }) => {
      await page.goto("/admin/system/monitoring");
      await page.waitForResponse(
        (r) =>
          r.url().includes("/admin/monitoring/errors") && r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      // Dashboard should show metric cards
      const dashboard = page.locator(".rounded-xl, .grid").first();
      await expect(dashboard).toBeVisible();
    });

    test("error stats section is visible", async ({ page }) => {
      await page.goto("/admin/system/monitoring");
      await page.waitForResponse(
        (r) =>
          r.url().includes("/admin/monitoring/errors") && r.status() === 200,
        { timeout: 15000 },
      );
      await page.waitForTimeout(500);

      // Page renders "Error" related heading
      const errorSection = page.getByText(/error|错误/i).first();
      await expect(errorSection).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Email Page ───────────────────────────────────────────────────────────────

  test.describe("Email Page (/admin/system/email)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/system/email");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("email settings content renders", async ({ page }) => {
      await gotoAndWait(page, "/admin/system/email");

      // EmailSettings component should render
      const content = page
        .locator("main, .admin-page-content, .rounded-xl")
        .first();
      await expect(content).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Site Settings Page ───────────────────────────────────────────────────────

  test.describe("Site Settings Page (/admin/system/site)", () => {
    test("page loads and shows heading", async ({ page }) => {
      await gotoAndWait(page, "/admin/system/site");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("出错了")).not.toBeVisible();
    });

    test("system settings content renders", async ({ page }) => {
      await gotoAndWait(page, "/admin/system/site");

      // SystemSettings component should render
      const content = page
        .locator("main, .admin-page-content, .rounded-xl")
        .first();
      await expect(content).toBeVisible({ timeout: 10000 });
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Cross-Layer API Tests
// ──────────────────────────────────────────────────────────────────────────────

test.describe("Cross-Layer Admin API Contracts", () => {
  // Navigate first so localStorage has the auth token
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");
  });

  // ── GET /api/v1/admin/users ──────────────────────────────────────────────────

  test("GET /admin/users — returns user list with expected shape", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/admin/users`, {
      headers,
      timeout: 15000,
    });
    expect(
      response.ok(),
      `GET /admin/users returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Should return users array (possibly empty) and total
    expect(data).toHaveProperty("users");
    expect(Array.isArray(data.users)).toBe(true);
    expect(data).toHaveProperty("total");
    expect(typeof data.total).toBe("number");

    // Each user should have id, email, role
    if (data.users.length > 0) {
      const user = data.users[0];
      expect(user).toHaveProperty("id");
      expect(user).toHaveProperty("email");
      expect(user).toHaveProperty("role");
    }
  });

  // ── GET /api/v1/admin/secrets ────────────────────────────────────────────────

  test("GET /admin/secrets — returns secrets array with masked values", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/admin/secrets`, {
      headers,
      timeout: 15000,
    });
    expect(
      response.ok(),
      `GET /admin/secrets returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Must be an array
    expect(Array.isArray(data)).toBe(true);

    // Each secret should have expected shape
    if (data.length > 0) {
      const secret = data[0];
      expect(secret).toHaveProperty("name");
      expect(secret).toHaveProperty("category");
      // Masked value: should NOT expose the raw secret
      expect(secret).toHaveProperty("maskedValue");
    }
  });

  // ── GET /api/v1/admin/credits/accounts ───────────────────────────────────────

  test("GET /admin/credits/accounts — returns paged credit accounts", async ({
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

    // Should return accounts array and total
    expect(data).toHaveProperty("accounts");
    expect(Array.isArray(data.accounts)).toBe(true);
    expect(data).toHaveProperty("total");
    expect(typeof data.total).toBe("number");

    // Each account should have balance
    if (data.accounts.length > 0) {
      const account = data.accounts[0];
      expect(account).toHaveProperty("userId");
      expect(account).toHaveProperty("balance");
      expect(typeof account.balance).toBe("number");
    }
  });

  // ── GET /api/v1/admin/ai/mcp-servers ────────────────────────────────────────

  test("GET /admin/ai/mcp-servers — returns MCP server list", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/ai/mcp-servers`,
      { headers, timeout: 15000 },
    );
    expect(
      response.ok(),
      `GET /admin/ai/mcp-servers returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Must be an array
    expect(Array.isArray(data)).toBe(true);

    // Each server should have expected shape
    if (data.length > 0) {
      const server = data[0];
      expect(server).toHaveProperty("serverId");
      expect(server).toHaveProperty("name");
      expect(server).toHaveProperty("transport");
      expect(server).toHaveProperty("enabled");
    }
  });

  // ── GET /api/v1/admin/cache/status ───────────────────────────────────────────

  test("GET /admin/cache/status — returns cache health info", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/cache/status`,
      { headers, timeout: 15000 },
    );
    expect(
      response.ok(),
      `GET /admin/cache/status returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Must have timestamp and cacheType
    expect(data).toHaveProperty("timestamp");
    expect(data).toHaveProperty("cacheType");
    expect(["redis", "memory"]).toContain(data.cacheType);

    // Must have prefixes array
    expect(data).toHaveProperty("prefixes");
    expect(Array.isArray(data.prefixes)).toBe(true);
  });

  // ── GET /api/v1/admin/overview-stats ─────────────────────────────────────────

  test("GET /admin/overview-stats — returns L1 infrastructure stats", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/overview-stats`,
      { headers, timeout: 15000 },
    );
    expect(
      response.ok(),
      `GET /admin/overview-stats returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const stats = body.data ?? body;

    // L1 Infrastructure keys
    const l1Keys = [
      "totalUsers",
      "activeUsers",
      "adminUsers",
      "secrets",
      "creditAccounts",
      "creditTransactions",
      "notifications",
      "dbTables",
      "storageProviders",
      "systemSettings",
      "totalLogins",
      "monitoringErrors",
    ];

    for (const key of l1Keys) {
      expect(
        stats,
        `L1 key "${key}" must be present in overview-stats`,
      ).toHaveProperty(key);
      expect(typeof stats[key], `L1 key "${key}" must be a number`).toBe(
        "number",
      );
    }

    // L5 Open API keys that relate to MCP infrastructure
    expect(stats).toHaveProperty("mcpServers");
    expect(typeof stats.mcpServers).toBe("number");
  });

  // ── GET /api/v1/admin/logs/stats ─────────────────────────────────────────────

  test("GET /admin/logs/stats — returns log statistics", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/logs/stats`,
      { headers, timeout: 15000 },
    );
    expect(
      response.ok(),
      `GET /admin/logs/stats returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Must include login and task counters
    expect(data).toHaveProperty("totalLogins");
    expect(data).toHaveProperty("todayLogins");
    expect(data).toHaveProperty("totalTasks");
    expect(data).toHaveProperty("failedTasks");

    expect(typeof data.totalLogins).toBe("number");
    expect(typeof data.todayLogins).toBe("number");
    expect(typeof data.totalTasks).toBe("number");
    expect(typeof data.failedTasks).toBe("number");
  });

  // ── GET /api/v1/admin/monitoring/errors ──────────────────────────────────────

  test("GET /admin/monitoring/errors — returns error list", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/monitoring/errors`,
      { headers, timeout: 15000 },
    );
    expect(
      response.ok(),
      `GET /admin/monitoring/errors returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Should return an array (possibly empty in a fresh environment)
    expect(Array.isArray(data)).toBe(true);
  });

  // ── GET /api/v1/admin/notifications/stats ────────────────────────────────────

  test("GET /admin/notifications/stats — returns notification statistics", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/notifications/stats`,
      { headers, timeout: 15000 },
    );
    expect(
      response.ok(),
      `GET /admin/notifications/stats returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Must include count fields
    expect(data).toHaveProperty("totalCount");
    expect(data).toHaveProperty("todayCount");
    expect(typeof data.totalCount).toBe("number");
    expect(typeof data.todayCount).toBe("number");
  });

  // ── GET /api/v1/admin/permissions/overview ────────────────────────────────────

  test("GET /admin/permissions/overview — returns permissions data", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/permissions/overview`,
      { headers, timeout: 15000 },
    );
    expect(
      response.ok(),
      `GET /admin/permissions/overview returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Must include user counts and admin list
    expect(data).toHaveProperty("totalUsers");
    expect(data).toHaveProperty("adminCount");
    expect(data).toHaveProperty("activeUsers");
    expect(data).toHaveProperty("admins");
    expect(Array.isArray(data.admins)).toBe(true);

    expect(typeof data.totalUsers).toBe("number");
    expect(typeof data.adminCount).toBe("number");
  });

  // ── GET /api/v1/admin/billing/overview ───────────────────────────────────────

  test("GET /admin/billing/overview — returns billing overview", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/billing/overview`,
      { headers, timeout: 15000 },
    );
    expect(
      response.ok(),
      `GET /admin/billing/overview returned ${response.status()}`,
    ).toBeTruthy();

    // Response must be valid JSON
    const body = await response.json();
    expect(body).toBeTruthy();
  });
});
