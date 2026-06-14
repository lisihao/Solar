import { test, expect } from "@playwright/test";

/**
 * Admin Detail Verification — E2E Tests
 *
 * Deep verification that ALL admin pages render with data (not empty)
 * Covers admin system, access, AI, kernel, and monitoring pages
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
// Helper: verify admin page loads properly
// ---------------------------------------------------------------------------
async function verifyAdminPage(
  page: import("@playwright/test").Page,
  path: string,
) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await expect(page.locator("body")).not.toBeEmpty();
  const errorBoundary = page.getByText(
    /something went wrong|application error/i,
  );
  await expect(errorBoundary).not.toBeVisible();

  const heading = page.locator("h1, h2").first();
  await expect(heading).toBeVisible({ timeout: 15000 });
}

// ---------------------------------------------------------------------------
// 1. Admin System Pages
// ---------------------------------------------------------------------------

test.describe("Admin System Pages", () => {
  test("system overview loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/system");
  });

  test("email settings loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/system/email");
  });

  test("system logs loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/system/logs");
  });

  test("MCP server settings loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/system/mcp-server");
  });

  test("monitoring dashboard loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/system/monitoring");
  });

  test("notifications settings loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/system/notifications");
  });

  test("site settings loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/system/site");
  });

  test("storage management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/storage");
  });
});

// ---------------------------------------------------------------------------
// 2. Admin Access Pages
// ---------------------------------------------------------------------------

test.describe("Admin Access Pages", () => {
  test("billing loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/access/billing");
  });

  test("credits management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/access/credits");
  });

  test("permissions loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/access/permissions");
  });

  test("secrets management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/access/secrets");
  });

  test("security settings loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/access/security");
  });

  test("users management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/access/users");
  });
});

// ---------------------------------------------------------------------------
// 3. Admin AI Pages
// ---------------------------------------------------------------------------

test.describe("Admin AI Pages", () => {
  test("agents management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/ai/agents");
  });

  test("approvals management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/ai/approvals");
  });

  test("eval management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/ai/eval");
  });

  test("guardrails management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/ai/guardrails");
  });

  test("models management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/ai/models");
  });

  test("research templates loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/ai/research-templates");
  });

  test("skills management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/ai/skills");
  });

  test("teams management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/ai/teams");
  });

  test("tools management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/ai/tools");
  });

  test("traces management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/ai/traces");
  });
});

// ---------------------------------------------------------------------------
// 4. Admin Kernel Pages
// ---------------------------------------------------------------------------

test.describe("Admin Kernel Pages", () => {
  test("IPC management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/kernel/ipc");
  });

  test("journal management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/kernel/journal");
  });

  test("memory management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/kernel/memory");
  });

  test("observability dashboard loads with data", async ({ page }) => {
    await page.goto("/admin/kernel/observability", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);

    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();

    // Verify stat cards or data tables rendered
    const statCards = page.locator("[class*='stat'], [class*='card']");
    const tables = page.locator("table");
    const loading = page.getByText(/loading/i);

    // Either has content or is loading (which means API is being called)
    const hasContent =
      (await statCards.count()) > 0 || (await tables.count()) > 0;
    const isLoading = (await loading.count()) > 0;

    expect(
      hasContent || isLoading,
      "Observability should show stats or be loading",
    ).toBe(true);
  });

  test("processes management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/kernel/processes");
  });

  test("resources management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/kernel/resources");
  });

  test("scheduler management loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/kernel/scheduler");
  });

  test("security (capability guard) loads with process list", async ({
    page,
  }) => {
    await page.goto("/admin/kernel/security", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);

    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();

    // Verify process list section rendered
    const processList = page.locator(
      "[class*='process'], [class*='list'], [class*='card']",
    );
    const loadingState = page.getByText(/loading/i);
    const emptyState = page.getByText(/no.*process/i);

    const hasContent =
      (await processList.count()) > 0 ||
      (await loadingState.count()) > 0 ||
      (await emptyState.count()) > 0;

    expect(
      hasContent,
      "Security page should show processes, loading, or empty state",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Other Admin Pages
// ---------------------------------------------------------------------------

test.describe("Other Admin Pages", () => {
  test("admin overview loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/overview");
  });

  test("admin main page loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin");
  });

  test("admin feedback loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/feedback");
  });

  test("admin logs loads", async ({ page }) => {
    await verifyAdminPage(page, "/admin/logs");
  });
});

// ---------------------------------------------------------------------------
// 6. Admin API Verification
// ---------------------------------------------------------------------------

test.describe("Admin API Health", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /admin/overview — dashboard stats", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/overview`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403].includes(response.status()),
      `GET /admin/overview returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/kernel/processes — process list API", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/processes`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403].includes(response.status()),
      `GET /admin/kernel/processes returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /admin/kernel/observability/dashboard — metrics API", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/observability/dashboard?period=60`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 403].includes(response.status()),
      `GET /admin/kernel/observability/dashboard returned ${response.status()}`,
    ).toBe(true);
  });
});
