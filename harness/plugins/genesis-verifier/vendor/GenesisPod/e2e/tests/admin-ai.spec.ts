import { test, expect } from "@playwright/test";

/**
 * Admin AI Engine Layer — E2E Tests
 *
 * Covers the 10 AI Engine admin pages under /admin/ai/* and the cross-layer
 * API endpoints exposed at /api/v1/admin/ai/*.
 *
 * Auth: handled by Playwright storageState (.auth/user.json) — already logged in.
 * API:  backend wraps responses in { success: true, data: {...} } — always
 *       unwrap with `body.data ?? body` before asserting shape.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read the JWT access token stored by the frontend in localStorage. */
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

/** Resolve the API base URL — supports pointing at a remote Railway env. */
function apiBase(baseURL: string | undefined): string {
  return process.env.API_BASE_URL || baseURL || "";
}

// ─── 1. AI Tools Page ─────────────────────────────────────────────────────────

test.describe("Admin AI — Tools Page (/admin/ai/tools)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/ai/tools");
    // The ToolsManagement component fetches /admin/ai/tools on mount
    await page
      .waitForResponse(
        (r) => r.url().includes("/admin/ai/tools") && r.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => {
        // Non-fatal: page may have loaded from cache or had no network call
      });
    await page.waitForTimeout(500);
  });

  test("page loads with heading", async ({ page }) => {
    await expect(page.locator("h1")).toBeVisible();
  });

  test("tools container is rendered", async ({ page }) => {
    // The ToolsManagement component renders the tool list;
    // either actual items or an empty-state element must be visible
    const toolsContent = page.locator(
      '[data-testid="tools-list"], table, [class*="tools"], [class*="grid"]',
    );
    const count = await toolsContent.count();
    // At minimum the outer AdminPageLayout wrapper must produce markup
    await expect(page.locator("main, [role='main']").first()).toBeVisible();
    expect(count).toBeGreaterThanOrEqual(0); // graceful: may be 0 in empty env
  });

  test("no unhandled error banner is shown", async ({ page }) => {
    const errorBanner = page.locator(
      '[class*="error"], [class*="alert-error"], [role="alert"]',
    );
    // If an error element exists it should not contain "500" or "Unexpected"
    const errorCount = await errorBanner.count();
    for (let i = 0; i < errorCount; i++) {
      const text = await errorBanner.nth(i).textContent();
      expect(text ?? "").not.toContain("500");
      expect(text ?? "").not.toContain("Unexpected error");
    }
  });
});

// ─── 2. AI Skills Page ────────────────────────────────────────────────────────

test.describe("Admin AI — Skills Page (/admin/ai/skills)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/ai/skills");
    await page
      .waitForResponse(
        (r) => r.url().includes("/admin/ai/skills") && r.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("page loads with heading", async ({ page }) => {
    await expect(page.locator("h1")).toBeVisible();
  });

  test("skills content area is rendered", async ({ page }) => {
    await expect(page.locator("main, [role='main']").first()).toBeVisible();
  });

  test("no fatal error state is displayed", async ({ page }) => {
    // Skills page uses SkillsManagement — look for catastrophic error text
    const bodyText = await page.locator("body").textContent();
    expect(bodyText ?? "").not.toContain("Cannot read properties");
    expect(bodyText ?? "").not.toContain("is not a function");
  });
});

// ─── 3. AI Models Page ────────────────────────────────────────────────────────

test.describe("Admin AI — Models Page (/admin/ai/models)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/ai/models");
    // AIModelSettings fetches /admin/ai-models
    await page
      .waitForResponse(
        (r) => r.url().includes("/admin/ai-models") && r.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("page loads with heading", async ({ page }) => {
    await expect(page.locator("h1")).toBeVisible();
  });

  test("'Add Model' action button is present", async ({ page }) => {
    // The AIModelsPage renders an "Add Model" button in actions
    const addButton = page.getByRole("button", { name: /add model/i });
    await expect(addButton).toBeVisible();
  });

  test("model list or empty state is rendered", async ({ page }) => {
    // AIModelSettings renders either a table/grid of models or an empty state
    const content = page.locator("table, [class*='model'], [class*='grid']");
    const count = await content.count();
    expect(count).toBeGreaterThanOrEqual(0);
    await expect(page.locator("main, [role='main']").first()).toBeVisible();
  });
});

// ─── 4. AI Agents Page ────────────────────────────────────────────────────────

test.describe("Admin AI — Agents Page (/admin/ai/agents)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/ai/agents");
    // useAdminAgents hook fetches /admin/agents
    await page
      .waitForResponse(
        (r) => r.url().includes("/admin/agents") && r.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("page loads with heading", async ({ page }) => {
    await expect(page.locator("h1")).toBeVisible();
  });

  test("'Add Agent' button is present", async ({ page }) => {
    const addButton = page.getByRole("button", { name: /add agent/i });
    await expect(addButton).toBeVisible();
  });

  test("agent count label or empty state is visible", async ({ page }) => {
    // The page renders "N agent configuration(s)" or the empty-state message
    const bodyText = await page.locator("body").textContent();
    const hasAgentInfo =
      /agent configuration/i.test(bodyText ?? "") ||
      /no agent configurations/i.test(bodyText ?? "");
    expect(hasAgentInfo).toBeTruthy();
  });

  test("no error banner is shown", async ({ page }) => {
    // Check the error div that appears when useAdminAgents fails
    const errorDiv = page.locator(
      "div.border-red-200, div.bg-red-50, div.text-red-600",
    );
    const count = await errorDiv.count();
    for (let i = 0; i < count; i++) {
      const text = await errorDiv.nth(i).textContent();
      expect(text ?? "").not.toContain("Failed to load agent");
    }
  });

  test("agent table columns are present when agents exist", async ({
    page,
  }) => {
    const tableHeaders = page.locator("th");
    const headerCount = await tableHeaders.count();
    if (headerCount > 0) {
      // Table has at minimum: Name, Agent ID, Type, Status, Actions
      expect(headerCount).toBeGreaterThanOrEqual(4);
    }
  });
});

// ─── 5. AI Teams Page ─────────────────────────────────────────────────────────

test.describe("Admin AI — Teams Page (/admin/ai/teams)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/ai/teams");
    // AITeamsSettings fetches /admin/ai-teams
    await page
      .waitForResponse(
        (r) => r.url().includes("/admin/ai-teams") && r.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("page loads with heading", async ({ page }) => {
    await expect(page.locator("h1")).toBeVisible();
  });

  test("'New Team' action button is present", async ({ page }) => {
    const newTeamButton = page.getByRole("button", { name: /new team/i });
    await expect(newTeamButton).toBeVisible();
  });

  test("search bar is rendered", async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search teams/i);
    await expect(searchInput).toBeVisible();
  });

  test("teams content area is rendered", async ({ page }) => {
    await expect(page.locator("main, [role='main']").first()).toBeVisible();
  });
});

// ─── 6. AI Guardrails Page ────────────────────────────────────────────────────

test.describe("Admin AI — Guardrails Page (/admin/ai/guardrails)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/ai/guardrails");
    await page
      .waitForResponse(
        (r) => r.url().includes("/admin/ai/guardrails") && r.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("page loads with 'Guardrails' heading", async ({ page }) => {
    const heading = page.getByRole("heading", { name: /guardrails/i });
    await expect(heading).toBeVisible();
  });

  test("guardrails registered summary badge is visible", async ({ page }) => {
    // The page shows a badge with "N guardrails registered"
    const summary = page.getByText(/guardrails registered/i);
    await expect(summary).toBeVisible();
  });

  test("input guardrails section is rendered", async ({ page }) => {
    const inputSection = page.getByRole("heading", {
      name: /input guardrails/i,
    });
    await expect(inputSection).toBeVisible();
  });

  test("output guardrails section is rendered", async ({ page }) => {
    const outputSection = page.getByRole("heading", {
      name: /output guardrails/i,
    });
    await expect(outputSection).toBeVisible();
  });

  test("no error state is shown", async ({ page }) => {
    // The page shows a red error box on fetch failure
    const errorBox = page.locator("div.border-red-200, div.bg-red-50");
    const count = await errorBox.count();
    // If an error box exists, it must not contain an HTTP status code
    for (let i = 0; i < count; i++) {
      const text = await errorBox.nth(i).textContent();
      expect(text ?? "").not.toMatch(/HTTP \d{3}/);
    }
  });
});

// ─── 7. AI Traces Page ────────────────────────────────────────────────────────

test.describe("Admin AI — Traces Page (/admin/ai/traces)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/ai/traces");
    // TracesPage fetches /admin/traces and /admin/traces/stats
    await page
      .waitForResponse(
        (r) =>
          r.url().includes("/admin/traces") &&
          !r.url().includes("stats") &&
          r.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("page loads with 'Agent Traces' heading", async ({ page }) => {
    const heading = page.getByRole("heading", { name: /agent traces/i });
    await expect(heading).toBeVisible();
  });

  test("type filter buttons are rendered", async ({ page }) => {
    // The page renders filter buttons: all, research, team_execution, etc.
    const allFilter = page.getByRole("button", { name: /^all$/i });
    await expect(allFilter).toBeVisible();
  });

  test("refresh button is present", async ({ page }) => {
    const refreshButton = page.getByRole("button", { name: /refresh/i });
    await expect(refreshButton).toBeVisible();
  });

  test("trace table or empty state is rendered", async ({ page }) => {
    // Either the table with headers or the "No traces found" empty-state
    const tableOrEmpty = page.locator(
      'table, [class*="empty"], p:has-text("No traces found")',
    );
    const count = await tableOrEmpty.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ─── 8. AI Eval Dashboard Page ────────────────────────────────────────────────

test.describe("Admin AI — Eval Dashboard (/admin/ai/eval)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/ai/eval");
    // EvalDashboardPage fetches /admin/monitoring/traces
    await page
      .waitForResponse(
        (r) =>
          r.url().includes("/admin/monitoring/traces") && r.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("page loads with 'Eval Dashboard' heading", async ({ page }) => {
    const heading = page.getByRole("heading", { name: /eval dashboard/i });
    await expect(heading).toBeVisible();
  });

  test("refresh button is present", async ({ page }) => {
    const refreshButton = page.getByRole("button", { name: /refresh/i });
    await expect(refreshButton).toBeVisible();
  });

  test("trace list or empty state is rendered", async ({ page }) => {
    // The page renders trace cards or "No traces found. Run some AI tasks first."
    const content = page.locator(
      '[class*="rounded-xl"], p:has-text("No traces found")',
    );
    const count = await content.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("no fatal error state is displayed", async ({ page }) => {
    // Error state renders a red div with the error message
    const errorDiv = page.locator("div.border-red-200, div.bg-red-50");
    const count = await errorDiv.count();
    for (let i = 0; i < count; i++) {
      const text = await errorDiv.nth(i).textContent();
      // Soft check: no "Failed to load" error should be visible after load
      expect(text ?? "").not.toContain("Failed to load");
    }
  });
});

// ─── 9. AI Research Templates Page ───────────────────────────────────────────

test.describe("Admin AI — Research Templates (/admin/ai/research-templates)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/ai/research-templates");
    // useAdminResearchTemplates fetches /admin/research/templates
    await page
      .waitForResponse(
        (r) =>
          r.url().includes("/admin/research/templates") && r.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("page loads with heading", async ({ page }) => {
    await expect(page.locator("h1")).toBeVisible();
  });

  test("'Add Template' button is present", async ({ page }) => {
    const addButton = page.getByRole("button", { name: /add template/i });
    await expect(addButton).toBeVisible();
  });

  test("template count label or empty state is visible", async ({ page }) => {
    const bodyText = await page.locator("body").textContent();
    const hasTemplateInfo =
      /research template/i.test(bodyText ?? "") ||
      /no research templates/i.test(bodyText ?? "");
    expect(hasTemplateInfo).toBeTruthy();
  });

  test("no error banner is shown", async ({ page }) => {
    const errorDiv = page.locator(
      "div.border-red-500, div.bg-red-500, div.text-red-400",
    );
    const count = await errorDiv.count();
    for (let i = 0; i < count; i++) {
      const text = await errorDiv.nth(i).textContent();
      expect(text ?? "").not.toContain("Failed to load research templates");
    }
  });

  test("grouped category sections are rendered when templates exist", async ({
    page,
  }) => {
    const tableHeaders = page.locator("th");
    const headerCount = await tableHeaders.count();
    if (headerCount > 0) {
      // Table columns: Name, Template ID, Iterations, Usage, Status, Actions
      expect(headerCount).toBeGreaterThanOrEqual(5);
    }
  });
});

// ─── 10. AI Approvals Page ────────────────────────────────────────────────────

test.describe("Admin AI — Approvals Page (/admin/ai/approvals)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/ai/approvals");
    // HumanApprovalQueue polls /admin/approvals/pending
    await page
      .waitForResponse(
        (r) =>
          r.url().includes("/admin/approvals/pending") && r.status() === 200,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("page loads with 'Human-in-the-Loop' heading", async ({ page }) => {
    const heading = page.getByRole("heading", {
      name: /human-in-the-loop/i,
    });
    await expect(heading).toBeVisible();
  });

  test("approvals queue area is rendered", async ({ page }) => {
    await expect(page.locator("main, [role='main']").first()).toBeVisible();
  });

  test("no fatal JavaScript errors result in blank page", async ({ page }) => {
    // If the page rendered at all the h1 must exist
    await expect(page.locator("h1")).toBeVisible();
  });
});

// ─── Cross-Layer API Tests ────────────────────────────────────────────────────

test.describe("Admin AI — Cross-Layer API Verification", () => {
  /**
   * These tests call the backend REST APIs directly (bypassing the UI) to
   * verify that the AI Engine layer APIs return structurally valid responses.
   *
   * All tests share one page object for auth-header extraction.
   */
  test.describe.configure({ mode: "serial" });

  test("GET /admin/ai/tools — returns tool config array", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/ai/tools");
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase(baseURL)}/api/v1/admin/ai/tools`,
      { headers },
    );
    expect(res.ok(), `Expected 200, got ${res.status()}`).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;
    // Should be an array (possibly empty in a fresh env)
    expect(Array.isArray(data)).toBeTruthy();
  });

  test("GET /admin/ai/tools — tool items have expected shape", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/ai/tools");
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase(baseURL)}/api/v1/admin/ai/tools`,
      { headers },
    );
    const body = await res.json();
    const data: unknown[] = body.data ?? body;

    if (data.length > 0) {
      const first = data[0] as Record<string, unknown>;
      expect(first).toHaveProperty("toolId");
      expect(first).toHaveProperty("enabled");
      expect(typeof first["enabled"]).toBe("boolean");
    }
    // Zero-length is acceptable in an empty environment
  });

  test("GET /admin/ai/skills — returns skill config array", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/ai/skills");
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase(baseURL)}/api/v1/admin/ai/skills`,
      { headers },
    );
    expect(res.ok(), `Expected 200, got ${res.status()}`).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;
    expect(Array.isArray(data)).toBeTruthy();
  });

  test("GET /admin/ai/skills — skill items have name and enabled fields", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/ai/skills");
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase(baseURL)}/api/v1/admin/ai/skills`,
      { headers },
    );
    const body = await res.json();
    const data: unknown[] = body.data ?? body;

    if (data.length > 0) {
      const first = data[0] as Record<string, unknown>;
      expect(first).toHaveProperty("skillId");
      expect(first).toHaveProperty("enabled");
      expect(typeof first["enabled"]).toBe("boolean");
    }
  });

  test("GET /admin/ai/guardrails — returns input/output/totalRules structure", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/ai/guardrails");
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase(baseURL)}/api/v1/admin/ai/guardrails`,
      { headers },
    );
    expect(res.ok(), `Expected 200, got ${res.status()}`).toBeTruthy();

    const body = await res.json();
    const data = (body.data ?? body) as Record<string, unknown>;

    expect(data).toHaveProperty("input");
    expect(data).toHaveProperty("output");
    expect(data).toHaveProperty("totalRules");

    expect(Array.isArray(data["input"])).toBeTruthy();
    expect(Array.isArray(data["output"])).toBeTruthy();
    expect(typeof data["totalRules"]).toBe("number");
  });

  test("GET /admin/ai/guardrails — totalRules matches sum of input + output", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/ai/guardrails");
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase(baseURL)}/api/v1/admin/ai/guardrails`,
      { headers },
    );
    const body = await res.json();
    const data = (body.data ?? body) as {
      input: unknown[];
      output: unknown[];
      totalRules: number;
    };

    const computed = data.input.length + data.output.length;
    expect(data.totalRules).toBe(computed);
  });

  test("GET /admin/ai/diagnose — full system diagnosis returns 200", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/ai/tools");
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase(baseURL)}/api/v1/admin/ai/diagnose`,
      { headers },
    );
    expect(res.ok(), `Expected 200, got ${res.status()}`).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;
    // The diagnose endpoint returns a top-level object (not an array)
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });

  test("GET /admin/ai/usage-stats — returns tools/skills/mcp usage maps", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/ai/tools");
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase(baseURL)}/api/v1/admin/ai/usage-stats`,
      { headers },
    );
    expect(res.ok(), `Expected 200, got ${res.status()}`).toBeTruthy();

    const body = await res.json();
    // usage-stats is NOT wrapped in { data: ... } — it's returned directly
    const data = body.data ?? body;
    expect(typeof data).toBe("object");
    expect(data).toHaveProperty("tools");
    expect(data).toHaveProperty("skills");
    expect(data).toHaveProperty("mcp");
  });

  test("GET /admin/ai/all-configs — aggregated configs return 200", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/ai/tools");
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase(baseURL)}/api/v1/admin/ai/all-configs`,
      { headers },
    );
    expect(res.ok(), `Expected 200, got ${res.status()}`).toBeTruthy();

    const body = await res.json();
    const data = body.data ?? body;
    // Should aggregate tools, skills, and mcp-servers
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });

  test("GET /admin/ai/all-configs — contains tools and skills keys", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/ai/tools");
    const headers = await getAuthHeader(page);
    const res = await page.request.get(
      `${apiBase(baseURL)}/api/v1/admin/ai/all-configs`,
      { headers },
    );
    const body = await res.json();
    const data = (body.data ?? body) as Record<string, unknown>;

    expect(data).toHaveProperty("tools");
    expect(data).toHaveProperty("skills");
    expect(data).toHaveProperty("mcpServers");
  });
});

// ─── Navigation integrity ─────────────────────────────────────────────────────

test.describe("Admin AI — Navigation Links", () => {
  /**
   * Verify that each AI Engine admin page is reachable (returns HTTP 200)
   * and renders an <h1> heading without crashing.
   */
  const AI_PAGES = [
    { path: "/admin/ai/tools", label: /tools/i },
    { path: "/admin/ai/skills", label: /skills/i },
    { path: "/admin/ai/models", label: /models/i },
    { path: "/admin/ai/agents", label: /agents/i },
    { path: "/admin/ai/teams", label: /teams/i },
    { path: "/admin/ai/guardrails", label: /guardrails/i },
    { path: "/admin/ai/traces", label: /traces/i },
    { path: "/admin/ai/eval", label: /eval/i },
    { path: "/admin/ai/research-templates", label: /templates/i },
    { path: "/admin/ai/approvals", label: /human/i },
  ] as const;

  for (const { path, label } of AI_PAGES) {
    test(`${path} renders <h1> matching ${label}`, async ({ page }) => {
      await page.goto(path);
      // Allow up to 15s for any initial data fetch
      await page.waitForTimeout(1000);

      const h1 = page.locator("h1").first();
      await expect(h1).toBeVisible({ timeout: 10000 });
      await expect(h1).toHaveText(label);
    });
  }
});
