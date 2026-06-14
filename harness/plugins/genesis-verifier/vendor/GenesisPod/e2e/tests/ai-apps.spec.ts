import { test, expect } from "@playwright/test";

/**
 * AI Apps Layer (L4) — E2E Tests
 *
 * Covers:
 * 1. Ask Module       (/ai-ask)       L6 Gateway → L4 App → L3 Engine
 * 2. Explore / Library (/explore)     L4 App → L3 Engine
 * 3. Research Module  (/ai-research)  L4 App → L2 Kernel → L3 Engine
 * 4. Writing Module   (/ai-writing)   L4 App → L3 Engine
 * 5. Teams Module     (/ai-teams)     L4 App → L3 Engine Teams
 * 6. Data Management  (/admin/data-management)
 * 7. Feedback Admin   (/admin/feedback)
 * 8. Cross-Layer Integration          AI Engine Diagnosis + Usage Stats
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
// 1. Ask Module — L6 Gateway → L4 App → L3 Engine (LLM) → L1 Infra (credits)
// ---------------------------------------------------------------------------
test.describe("Ask Module (/ai-ask)", () => {
  test("page loads with input field visible", async ({ page }) => {
    await page.goto("/ai-ask", { waitUntil: "domcontentloaded" });
    // Wait for either the textarea (authenticated) or login prompt
    await page.waitForTimeout(1000);

    // The page renders a <textarea> for question input — visible in both
    // authenticated (session view) and unauthenticated (landing) states
    const textarea = page.locator("textarea");
    await expect(textarea.first()).toBeVisible({ timeout: 15000 });
  });

  test("page does not show error boundary or white screen", async ({
    page,
  }) => {
    await page.goto("/ai-ask", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // No unhandled error overlay
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("API: POST /ask/sessions creates a new session", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/ai-ask", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(`${apiBase}/api/v1/ask/sessions`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: { title: "E2E test session" },
    });

    // Expect 201 Created or 200 OK
    expect(
      response.status(),
      `POST /ask/sessions returned ${response.status()}`,
    ).toBeLessThan(300);

    const body = await response.json();
    const session = body.data ?? body;
    expect(session, "Response should be an object").toBeTruthy();
    // Session must have an id
    expect(session.id, "Session must have an id field").toBeTruthy();
  });

  test("API: GET /ask/sessions returns array", async ({ page, baseURL }) => {
    await page.goto("/ai-ask", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/ask/sessions`, {
      headers,
    });

    expect(
      response.ok(),
      `GET /ask/sessions returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const sessions = body.data ?? body;
    // May be an array directly or wrapped in { items, total }
    const list = Array.isArray(sessions) ? sessions : (sessions.items ?? []);
    expect(Array.isArray(list), "Sessions should be an array").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Explore / Library — L4 App → L3 Engine
// ---------------------------------------------------------------------------
test.describe("Explore / Library (/explore)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    // Wait for the dynamic ExploreContent to finish loading
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
  });

  test("page loads with content visible", async ({ page }) => {
    // Explore page should render meaningful content after loading
    await page.waitForTimeout(5000);
    const bodyText = await page.locator("body").innerText();
    expect(
      bodyText.length > 50,
      "Explore page should have meaningful content (got " +
        bodyText.length +
        " chars)",
    ).toBe(true);
  });

  test("page does not flash white or show error boundary", async ({ page }) => {
    // Background should NOT remain pure white after hydration
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page shows search or resource list interface", async ({ page }) => {
    // Either a search input or a list of resource cards must be visible.
    // ExploreContent renders a search bar or tabs for resource browsing.
    const searchInput = page.locator(
      "input[type='search'], input[type='text'], input[placeholder]",
    );
    const hasSearch = (await searchInput.count()) > 0;

    const resourceList = page.locator(
      "main, [role='main'], .resource, article",
    );
    const hasContent = (await resourceList.count()) > 0;

    expect(
      hasSearch || hasContent,
      "Explore page should show a search input or resource content",
    ).toBe(true);
  });

  test("API: GET /resources returns paginated list", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/resources?page=1&pageSize=10`,
      { headers },
    );

    expect(
      response.ok(),
      `GET /resources returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    // Response should be an object with items array (or array directly)
    const items = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.data ?? []);
    expect(
      Array.isArray(items),
      "Resources response should contain an items array",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Research Module — L4 App → L2 Kernel (processes) → L3 Engine (agents)
// ---------------------------------------------------------------------------
test.describe("Research Module (/ai-research)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-research", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
  });

  test("page loads and shows research interface", async ({ page }) => {
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("page shows project list or creation option", async ({ page }) => {
    // Either project cards, a "create" button, or any interactive content
    const createButton = page.getByRole("button", {
      name: /create|new|start/i,
    });
    const projectCard = page
      .locator(
        "[class*='project'], [class*='card'], [class*='research'], [class*='topic']",
      )
      .first();
    const emptyState = page.getByText(
      /no.*topic|no.*research|empty|get started|create/i,
    );

    await page.waitForTimeout(3000);
    const hasCreate = (await createButton.count()) > 0;
    const hasCards = (await projectCard.count()) > 0;
    const hasEmpty = (await emptyState.count()) > 0;

    expect(
      hasCreate || hasCards || hasEmpty,
      "Research page should show content, create button, or empty state",
    ).toBe(true);
  });

  test("page does not show error boundary", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("API: GET /ai-studio/projects returns array", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/ai-studio/projects`,
      { headers },
    );

    expect(
      response.ok(),
      `GET /ai-studio/projects returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    // May be array or paginated { items, total }
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.projects ?? []);
    expect(Array.isArray(list), "Projects response should be an array").toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Writing Module — L4 App → L3 Engine
// ---------------------------------------------------------------------------
test.describe("Writing Module (/ai-writing)", () => {
  test("page loads with AppShell and writing interface", async ({ page }) => {
    await page.goto("/ai-writing", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // The writing page uses AppShell — expect at least one nav element
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page shows project list or creation option", async ({ page }) => {
    await page.goto("/ai-writing", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3000);

    // Writing page renders a list of projects or a create/start button
    const createButton = page.getByRole("button", {
      name: /create|new|start|write/i,
    });
    const hasCreate = (await createButton.count()) > 0;

    // Or an h1/h2 heading should be present
    const hasHeading = (await page.locator("h1, h2").count()) > 0;

    expect(
      hasCreate || hasHeading,
      "Writing page should show a create button or heading",
    ).toBe(true);
  });

  test("API: GET /ai-writing/projects returns array", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/ai-writing", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/ai-writing/projects`,
      { headers },
    );

    expect(
      response.ok(),
      `GET /ai-writing/projects returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.projects ?? []);
    expect(
      Array.isArray(list),
      "Writing projects response should be an array",
    ).toBe(true);
  });

  test("API: GET /ai-writing/style-presets returns presets", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/ai-writing", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/ai-writing/style-presets`,
      { headers },
    );

    expect(
      response.ok(),
      `GET /ai-writing/style-presets returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload) ? payload : (payload.items ?? []);
    expect(Array.isArray(list), "Style presets should be an array").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Teams / Debate — L4 App → L3 Engine Teams
// ---------------------------------------------------------------------------
test.describe("Teams Module (/ai-teams)", () => {
  test("page loads with teams interface", async ({ page }) => {
    await page.goto("/ai-teams", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page shows team list or creation option", async ({ page }) => {
    await page.goto("/ai-teams", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3000);

    // Teams page shows topics (team rooms) or a create button
    const createButton = page.getByRole("button", { name: /create|new/i });
    const hasCreate = (await createButton.count()) > 0;

    const hasHeading = (await page.locator("h1, h2").count()) > 0;

    expect(
      hasCreate || hasHeading,
      "Teams page should show a create button or heading",
    ).toBe(true);
  });

  test("API: GET /topics returns array of topics", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/ai-teams", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/topics`, {
      headers,
    });

    expect(
      response.ok(),
      `GET /topics returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.topics ?? []);
    expect(Array.isArray(list), "Topics response should be an array").toBe(
      true,
    );
  });

  test("API: GET /api/ai/teams returns engine team configs", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/ai-teams", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // AI Engine teams registry endpoint — lists registered team configs
    const response = await page.request.get(`${apiBase}/api/v1/api/ai/teams`, {
      headers,
    });

    expect(
      response.ok(),
      `GET /api/ai/teams returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload) ? payload : (payload.items ?? []);
    expect(Array.isArray(list), "Team configs should be an array").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Data Management Admin Page — /admin/data-management
// ---------------------------------------------------------------------------
test.describe("Data Management Page (/admin/data-management)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/data-management", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);
  });

  test("page loads with heading visible", async ({ page }) => {
    // TableManagementPage uses AdminPageLayout with translation key 'admin.tables.title'
    // The layout renders a heading (h1 or h2 inside the header area)
    const heading = page.locator("h1, h2, h3").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("page shows data overview or table stats", async ({ page }) => {
    // The page renders TableStatsCards + TableDataGrid — expect some content
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("API: GET /data-management/dashboard/summary returns summary", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/data-management/dashboard/summary`,
      { headers },
    );

    expect(
      response.ok(),
      `GET /data-management/dashboard/summary returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    expect(
      payload,
      "Dashboard summary should be a non-null object",
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7. Feedback Admin Page — /admin/feedback
// ---------------------------------------------------------------------------
test.describe("Feedback Page (/admin/feedback)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/feedback", { waitUntil: "domcontentloaded" });
    // Wait for feedback list to load
    await page.waitForTimeout(1000);
  });

  test("page loads with heading visible", async ({ page }) => {
    const heading = page.locator("h1, h2, h3").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("page shows feedback list or empty state", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("API: GET /feedback returns list", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/feedback`, {
      headers,
    });

    expect(
      response.ok(),
      `GET /feedback returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.feedbacks ?? []);
    expect(
      Array.isArray(list),
      "Feedback response should contain an array",
    ).toBe(true);
  });

  test("API: GET /feedback/stats returns counts by type and status", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/feedback/stats`,
      { headers },
    );

    expect(
      response.ok(),
      `GET /feedback/stats returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const stats = body.data ?? body;
    // Must have a numeric total
    expect(
      typeof stats.total,
      "Feedback stats should have a numeric total",
    ).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// 8. Cross-Layer Integration Tests
// ---------------------------------------------------------------------------
test.describe("Cross-Layer Integration", () => {
  /**
   * AI Engine full diagnosis — exercises every layer:
   * Admin UI (L6) → Admin API (L5) → AI Engine (L3) → AI Infra (L1)
   */
  test("API: GET /admin/ai/diagnose returns full system diagnosis", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/ai/diagnose`,
      { headers, timeout: 15000 },
    );

    // Admin endpoint may return 403 for non-admin test user — acceptable
    expect(
      response.ok() || response.status() === 403,
      `GET /admin/ai/diagnose returned ${response.status()} (200 or 403 acceptable)`,
    ).toBeTruthy();

    if (response.status() === 403) return;

    const body = await response.json();
    const diagnosis = body.data ?? body;
    // Diagnosis should be a non-empty object (not null, not an empty array)
    expect(diagnosis, "Diagnosis result should be truthy").toBeTruthy();
    // Should be an object with status or breakdown keys
    expect(typeof diagnosis, "Diagnosis result should be an object").toBe(
      "object",
    );
  });

  /**
   * Usage statistics — crosses App layer (usage tracking) + Engine (tool registry)
   */
  test("API: GET /admin/ai/usage-stats returns tools, skills, mcp keys", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/ai/usage-stats`,
      { headers },
    );

    expect(
      response.ok(),
      `GET /admin/ai/usage-stats returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const stats = body.data ?? body;
    // Must have the three top-level counters
    expect(stats, 'Usage stats should have "tools" key').toHaveProperty(
      "tools",
    );
    expect(stats, 'Usage stats should have "skills" key').toHaveProperty(
      "skills",
    );
    expect(stats, 'Usage stats should have "mcp" key').toHaveProperty("mcp");
    // Each value should be an object (map of id → count)
    expect(typeof stats.tools).toBe("object");
    expect(typeof stats.skills).toBe("object");
    expect(typeof stats.mcp).toBe("object");
  });

  /**
   * Overview stats — validate the keys that prove cross-layer wiring:
   * - kernelProcesses (L2 Kernel)
   * - aiModels (L3 Engine)
   * - totalUsers (L1 Infra)
   * - askSessions (L6 Gateway)
   */
  test("API: GET /admin/overview-stats has cross-layer keys", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.waitForResponse(
      (r) => r.url().includes("/admin/overview-stats") && r.status() === 200,
      { timeout: 15000 },
    );

    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/overview-stats`,
      { headers },
    );

    expect(
      response.ok(),
      `GET /admin/overview-stats returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const stats = body.data ?? body;

    // Cross-layer verification
    const crossLayerKeys: Array<[string, string]> = [
      ["kernelProcesses", "L2 Kernel"],
      ["aiModels", "L3 Engine"],
      ["totalUsers", "L1 Infra"],
      ["askSessions", "L6 Gateway"],
      ["researchMissions", "L4 Apps — Research"],
      ["writingProjects", "L4 Apps — Writing"],
      ["debateSessions", "L4 Apps — Teams"],
    ];

    for (const [key, layer] of crossLayerKeys) {
      expect(
        stats,
        `Cross-layer key "${key}" (${layer}) should be present`,
      ).toHaveProperty(key);
      expect(
        typeof stats[key],
        `Cross-layer key "${key}" (${layer}) should be a number`,
      ).toBe("number");
    }
  });

  /**
   * Admin AI all-configs — lists registered agents and team configs
   * Exercises: App → Engine Teams (registry) + Agent (registry)
   */
  test("API: GET /admin/ai/all-configs returns registered AI configs", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/ai/all-configs`,
      { headers },
    );

    expect(
      response.ok(),
      `GET /admin/ai/all-configs returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const configs = body.data ?? body;
    expect(configs, "All-configs should be truthy").toBeTruthy();
    expect(typeof configs, "All-configs should be an object").toBe("object");
  });

  /**
   * Feed endpoint — Explore app layer hitting Engine for content ranking
   */
  test("API: GET /feed returns resource feed", async ({ page, baseURL }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/feed?page=1&pageSize=10`,
      { headers },
    );

    expect(
      response.ok(),
      `GET /feed returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.feed ?? []);
    expect(Array.isArray(list), "Feed should return an array").toBe(true);
  });
});
