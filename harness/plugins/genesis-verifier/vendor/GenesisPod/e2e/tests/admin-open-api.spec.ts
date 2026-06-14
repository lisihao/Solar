import { test, expect } from "@playwright/test";

/**
 * Admin Open API Layer (L5) E2E Tests
 *
 * Covers:
 * 1. MCP Server management (admin page + APIs)
 * 2. Webhooks API contracts
 * 3. Public API health
 * 4. Agent traces (L6 Gateway → L5 Open API)
 * 5. Quota management APIs
 * 6. Cache management APIs
 */

/** Read JWT from localStorage for direct API calls */
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
// MCP Server Admin Page
// ---------------------------------------------------------------------------

test.describe("MCP Server Admin Page", () => {
  test("page loads with heading and server list", async ({ page }) => {
    await page.goto("/admin/system/mcp-server");
    await page.waitForLoadState("networkidle");

    // Should have heading
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible();

    // No error boundary
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("shows MCP server stats after API load", async ({ page }) => {
    await page.goto("/admin/system/mcp-server");

    // Wait for MCP data to load
    try {
      await page.waitForResponse(
        (r) => r.url().includes("/admin/ai/mcp-servers") && r.status() === 200,
        { timeout: 15000 },
      );
    } catch {
      // Page may have loaded from cache
    }

    await page.waitForTimeout(500);

    // Should show server list or empty state
    const hasContent =
      (await page
        .locator("table, [class*='card'], [class*='server']")
        .count()) > 0 || (await page.getByText(/no.*server/i).count()) > 0;
    expect(hasContent).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MCP Server Admin API
// ---------------------------------------------------------------------------

test.describe("MCP Server Admin API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await page.waitForTimeout(500);
  });

  test("GET /admin/ai/mcp-servers returns server list", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase}/api/v1/admin/ai/mcp-servers`,
      { headers, timeout: 15000 },
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;
    expect(Array.isArray(data)).toBeTruthy();

    if (data.length > 0) {
      expect(data[0]).toHaveProperty("serverId");
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("transport");
      expect(data[0]).toHaveProperty("enabled");
    }
  });

  test("GET /admin/ai/mcp-servers/diagnose returns diagnostics", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase}/api/v1/admin/ai/mcp-servers/diagnose`,
      { headers, timeout: 15000 },
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;
    expect(data).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Webhooks API (L5 Open API)
// ---------------------------------------------------------------------------

test.describe("Webhooks API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await page.waitForTimeout(500);
  });

  test("GET /webhooks/subscriptions returns webhook list", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase}/api/v1/webhooks/subscriptions`,
      { headers, timeout: 15000 },
    );

    // May return 200 with list or 404 if not configured
    expect([200, 404].includes(res.status())).toBeTruthy();

    if (res.ok()) {
      const body = await res.json();
      const data = body.data ?? body;
      expect(Array.isArray(data) || typeof data === "object").toBeTruthy();
    }
  });

  test("GET /webhooks/events returns event types", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(`${apiBase}/api/v1/webhooks/events`, {
      headers,
      timeout: 15000,
    });

    // May return 200 or 404
    expect([200, 404].includes(res.status())).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Public API (L5 Open API)
// ---------------------------------------------------------------------------

test.describe("Public API Endpoints", () => {
  test("health check endpoint is accessible", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const res = await page.request.get(`${apiBase}/api/v1/health`, {
      timeout: 15000,
    });
    // Health endpoint should be public
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;
    expect(data).toHaveProperty("status");
  });

  test("unauthenticated admin requests return 401", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    // No auth header — should get 401
    const res = await page.request.get(
      `${apiBase}/api/v1/admin/overview-stats`,
      { timeout: 15000 },
    );
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Agent Traces (L6 Gateway)
// ---------------------------------------------------------------------------

test.describe("Agent Traces Page", () => {
  test("page loads with heading", async ({ page }) => {
    await page.goto("/admin/ai/traces");
    await page.waitForLoadState("networkidle");

    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible();
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("traces API returns data", async ({ page, baseURL }) => {
    await page.goto("/admin");
    await page.waitForTimeout(500);

    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/traces`,
      { headers, timeout: 15000 },
    );

    // May return 200 with traces or empty
    if (res.ok()) {
      const body = await res.json();
      const data = body.data ?? body;
      expect(data).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Quota Management API
// ---------------------------------------------------------------------------

test.describe("Quota Management API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await page.waitForTimeout(500);
  });

  test("GET /admin/quota/providers returns provider quotas", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase}/api/v1/admin/quota/providers`,
      { headers, timeout: 15000 },
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;
    expect(data).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cache Admin API
// ---------------------------------------------------------------------------

test.describe("Cache Admin API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await page.waitForTimeout(500);
  });

  test("GET /admin/cache/status returns cache health", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(`${apiBase}/api/v1/admin/cache/status`, {
      headers,
      timeout: 15000,
    });
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;
    expect(data).toHaveProperty("timestamp");
    expect(data).toHaveProperty("cacheType");
  });
});

// ---------------------------------------------------------------------------
// Cross-Layer: Full AI System Diagnosis
// ---------------------------------------------------------------------------

test.describe("Cross-Layer AI System Diagnosis", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await page.waitForTimeout(500);
  });

  test("GET /admin/ai/diagnose returns full system health", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(`${apiBase}/api/v1/admin/ai/diagnose`, {
      headers,
      timeout: 15000,
    });
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;

    // Diagnosis should cover multiple layers
    expect(data).toBeDefined();
    expect(typeof data).toBe("object");
  });

  test("GET /admin/ai/tools/diagnose returns tool health", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase}/api/v1/admin/ai/tools/diagnose`,
      { headers, timeout: 15000 },
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;

    // Should have tools array and summary
    expect(data).toHaveProperty("tools");
    expect(data).toHaveProperty("summary");
    expect(typeof data.summary.total).toBe("number");
    expect(typeof data.summary.healthy).toBe("number");
  });

  test("GET /admin/ai/external-tools/diagnose returns external tool health", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase}/api/v1/admin/ai/external-tools/diagnose`,
      { headers, timeout: 15000 },
    );
    expect(res.ok()).toBeTruthy();
  });

  test("GET /admin/ai/all-configs returns aggregated configs", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase}/api/v1/admin/ai/all-configs`,
      { headers, timeout: 15000 },
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;

    // Aggregated response should include tools, skills, and MCP servers
    expect(data).toHaveProperty("tools");
    expect(data).toHaveProperty("skills");
    expect(data).toHaveProperty("mcpServers");
  });

  test("GET /admin/ai/usage-stats returns cross-layer stats", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase}/api/v1/admin/ai/usage-stats`,
      { headers, timeout: 15000 },
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;

    // Usage stats span AI Engine + AI Apps
    expect(data).toHaveProperty("tools");
    expect(data).toHaveProperty("skills");
    expect(data).toHaveProperty("mcp");
  });
});
