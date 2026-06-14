import { test, expect } from "@playwright/test";

/**
 * Public API (L5 Open API) — E2E Tests
 *
 * Covers the L5 Open API layer:
 * - Health check and capability discovery
 * - Tool and model discovery endpoints
 * - Protected endpoints (require MCP API key, not JWT)
 * - Auth requirement verification
 *
 * Note: The Public API uses MCP API key auth, not JWT Bearer tokens.
 * Tests for protected endpoints verify that the auth requirement is enforced
 * (401/403) rather than testing the actual AI functionality.
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
// 1. Health Check & Status (Public, no auth required)
// ---------------------------------------------------------------------------

test.describe("Public API — Health Check (L5 Open API)", () => {
  test("GET /public/status — health check returns status field", async ({
    page,
    baseURL,
  }) => {
    // Navigate first to ensure the page context is initialized
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    const response = await page.request.get(`${apiBase}/api/v1/public/status`, {
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /public/status returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Status endpoint must return a status field
    expect(data, "Status response should be truthy").toBeTruthy();
    expect(data, 'Status response should have a "status" field').toHaveProperty(
      "status",
    );
    expect(
      ["healthy", "ok", "running", "operational"].includes(
        (data.status as string).toLowerCase(),
      ),
      `Status value "${data.status}" should indicate a healthy state`,
    ).toBe(true);
  });

  test("GET /health — global health check is publicly accessible", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    const response = await page.request.get(`${apiBase}/api/v1/health`, {
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /health returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;
    expect(data).toHaveProperty("status");
  });
});

// ---------------------------------------------------------------------------
// 2. Capability Discovery (Public, no auth required)
// ---------------------------------------------------------------------------

test.describe("Public API — Capability Discovery (L5 Open API)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
  });

  test("GET /public/capabilities — list available capabilities", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    const response = await page.request.get(
      `${apiBase}/api/v1/public/capabilities`,
      { timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /public/capabilities returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;
    expect(data, "Capabilities response should be truthy").toBeTruthy();
  });

  test("GET /public/discovery/tools — list tools with schemas", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    const response = await page.request.get(
      `${apiBase}/api/v1/public/discovery/tools`,
      { timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /public/discovery/tools returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;
    // Tools discovery should return an array of tool definitions
    const tools = Array.isArray(data) ? data : (data.tools ?? data.items ?? []);
    expect(Array.isArray(tools), "Tools should be an array").toBe(true);

    // Each tool should have name and schema
    if (tools.length > 0) {
      const tool = tools[0];
      expect(
        tool.name ?? tool.id,
        "Tool should have a name or id",
      ).toBeTruthy();
    }
  });

  test("GET /public/discovery/models — list available models", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    const response = await page.request.get(
      `${apiBase}/api/v1/public/discovery/models`,
      { timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /public/discovery/models returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;
    const models = Array.isArray(data)
      ? data
      : (data.models ?? data.items ?? []);
    expect(Array.isArray(models), "Models should be an array").toBe(true);
  });

  test("GET /public/discovery/capabilities — full capability snapshot", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    const response = await page.request.get(
      `${apiBase}/api/v1/public/discovery/capabilities`,
      { timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /public/discovery/capabilities returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;
    expect(data, "Discovery capabilities should be truthy").toBeTruthy();
    expect(typeof data, "Discovery capabilities should be an object").toBe(
      "object",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Protected Endpoints — Auth Requirement Verification
// ---------------------------------------------------------------------------

test.describe("Public API — Protected Endpoints (MCP API Key Auth)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
  });

  test("POST /public/ask — requires auth (returns 401 or 403 without key)", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    // Send without any auth header — should be rejected
    const response = await page.request.post(`${apiBase}/api/v1/public/ask`, {
      headers: { "Content-Type": "application/json" },
      data: { question: "What is 2+2?" },
      timeout: 15000,
    });

    // Public API requires MCP API key — unauthenticated requests must be rejected
    expect(
      [401, 403].includes(response.status()),
      `POST /public/ask without auth should return 401/403, got ${response.status()}`,
    ).toBe(true);
  });

  test("POST /public/chat — requires auth (returns 401 or 403 without key)", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    const response = await page.request.post(`${apiBase}/api/v1/public/chat`, {
      headers: { "Content-Type": "application/json" },
      data: {
        messages: [{ role: "user", content: "Hello" }],
      },
      timeout: 15000,
    });

    expect(
      [401, 403].includes(response.status()),
      `POST /public/chat without auth should return 401/403, got ${response.status()}`,
    ).toBe(true);
  });

  test("POST /public/research — requires auth (returns 401 or 403 without key)", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    const response = await page.request.post(
      `${apiBase}/api/v1/public/research`,
      {
        headers: { "Content-Type": "application/json" },
        data: { query: "Test research query" },
        timeout: 15000,
      },
    );

    expect(
      [401, 403].includes(response.status()),
      `POST /public/research without auth should return 401/403, got ${response.status()}`,
    ).toBe(true);
  });

  test("POST /public/content/analyze — requires auth (returns 401 or 403 without key)", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    const response = await page.request.post(
      `${apiBase}/api/v1/public/content/analyze`,
      {
        headers: { "Content-Type": "application/json" },
        data: {
          content: "Sample content to analyze",
          type: "text",
        },
        timeout: 15000,
      },
    );

    expect(
      [401, 403].includes(response.status()),
      `POST /public/content/analyze without auth should return 401/403, got ${response.status()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Admin API — Open API Management (JWT Auth)
// ---------------------------------------------------------------------------

test.describe("Admin Open API Management (L5 → Admin)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /admin/open-api/keys — list API keys (admin, JWT auth)", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/open-api/keys`,
      { headers, timeout: 15000 },
    );

    // Admin API keys endpoint may return 200 or 404 if not implemented
    expect(
      [200, 404].includes(response.status()),
      `GET /admin/open-api/keys returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const data = body.data ?? body;
      const keys = Array.isArray(data) ? data : (data.items ?? data.keys ?? []);
      expect(Array.isArray(keys), "API keys should be an array").toBe(true);
    }
  });

  test("GET /admin/quota/providers — list provider quotas", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/quota/providers`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /admin/quota/providers returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;
    expect(data, "Quota providers should be truthy").toBeTruthy();
  });

  test("Open API status: unauthenticated admin requests return 401", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    // No auth header
    const response = await page.request.get(
      `${apiBase}/api/v1/admin/overview-stats`,
      { timeout: 15000 },
    );

    expect(
      response.status(),
      "Unauthenticated admin requests must return 401",
    ).toBe(401);
  });

  test("Webhooks: GET /webhooks/subscriptions returns list or 404", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/webhooks/subscriptions`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 404].includes(response.status()),
      `GET /webhooks/subscriptions returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const data = body.data ?? body;
      expect(
        Array.isArray(data) || typeof data === "object",
        "Webhooks response should be array or object",
      ).toBe(true);
    }
  });

  test("MCP server admin: GET /admin/ai/mcp-servers returns server list", async ({
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
    expect(Array.isArray(data), "MCP servers should be an array").toBe(true);
  });
});
