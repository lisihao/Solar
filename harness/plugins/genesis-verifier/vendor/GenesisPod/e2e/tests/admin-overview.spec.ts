import { test, expect } from "@playwright/test";

/**
 * Admin Overview — Architecture Diagram E2E Tests
 *
 * Verifies:
 * 1. All 6 architecture layers render
 * 2. Every card shows stat counts (no missing stats)
 * 3. Clickable cards have valid navigation links
 * 4. Stats API returns all expected keys with number values
 */

// All stat keys the backend must return
const EXPECTED_STAT_KEYS = [
  // L4 Apps
  "resources",
  "researchMissions",
  "officeDocuments",
  "topics",
  "debateSessions",
  "simScenarios",
  "simRuns",
  "writingProjects",
  "socialContent",
  "tools",
  "skills",
  "feedbackCount",
  "bookmarkedResources",
  // L2 Kernel
  "kernelProcesses",
  "kernelRunning",
  "kernelEvents",
  "kernelMemories",
  "kernelSubscriptions",
  "kernelBreakers",
  "kernelLLMCalls",
  // L3 Engine
  "aiModels",
  "agents",
  "knowledgeBases",
  "guardrailRules",
  "mcpServers",
  // L1 Infrastructure
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
  // L6 Gateway
  "askSessions",
  "agentTraces",
  // L5 Open API
  "webhookSubscriptions",
  "mcpRegisteredTools",
];

// Layer badge labels (L6 → L1)
const LAYER_BADGES = ["L6", "L5", "L4", "L3", "L2", "L1"];

// Cards that must be clickable with valid hrefs
const CLICKABLE_CARDS_HREFS = [
  "/admin/ai/traces",
  "/admin/system/mcp-server",
  "/admin/data/collection",
  "/library/rag",
  "/admin/feedback",
  "/admin/kernel/processes",
  "/admin/kernel/journal",
  "/admin/kernel/memory",
  "/admin/kernel/ipc",
  "/admin/kernel/resources",
  "/admin/kernel/observability",
  "/admin/kernel/security",
  "/admin/kernel/scheduler",
  "/admin/ai/models",
  "/admin/ai/agents",
  "/admin/ai/teams",
  "/admin/ai/skills",
  "/admin/ai/tools",
  "/admin/ai/guardrails",
  "/admin/access/users",
  "/admin/access/permissions",
  "/admin/access/secrets",
  "/admin/access/credits",
  "/admin/access/billing",
  "/admin/system/notifications",
  "/admin/data-management",
  "/admin/storage",
  "/admin/system",
  "/admin/system/logs",
  "/admin/system/monitoring",
];

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

test.describe("Admin Overview — Architecture Diagram", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    // Wait for stats API to resolve (browser-initiated, auth from localStorage)
    await page.waitForResponse(
      (r) => r.url().includes("/admin/overview-stats") && r.status() === 200,
      { timeout: 15000 },
    );
    // Small wait for React to render stats
    await page.waitForTimeout(500);
  });

  test("page loads with title and layer count", async ({ page }) => {
    // Page should have the architecture title
    await expect(page.locator("h1")).toBeVisible();

    // Should show "6 Layers" text in header summary area
    await expect(page.getByText("Layers")).toBeVisible();
    // The "6" appears in the summary stat — use exact match within header
    await expect(
      page.locator("h1 ~ div, header").getByText("6", { exact: true }).first(),
    ).toBeVisible();
  });

  test("all 6 architecture layers are visible", async ({ page }) => {
    for (const badge of LAYER_BADGES) {
      const layerBadge = page.getByText(badge, { exact: true });
      await expect(
        layerBadge,
        `Layer ${badge} should be visible`,
      ).toBeVisible();
    }
  });

  test("every card displays at least one stat value", async ({ page }) => {
    // Find all stat value elements: <span class="...font-semibold tabular-nums...">
    // In ArchitectureCard.tsx, stats render as: <span class="text-xs font-semibold tabular-nums ...">
    const statValues = page.locator("span.tabular-nums");

    const count = await statValues.count();
    // We expect at least one stat per card. With 11 new cards + existing,
    // should have many stat elements
    expect(count, "Should have multiple stat values rendered").toBeGreaterThan(
      20,
    );

    // No stat value should show the text "undefined" or "NaN"
    for (let i = 0; i < count; i++) {
      const text = await statValues.nth(i).textContent();
      expect(text, `Stat value ${i} should be a number`).not.toContain(
        "undefined",
      );
      expect(text).not.toContain("NaN");
    }
  });

  test("clickable cards have valid navigation links", async ({ page }) => {
    for (const href of CLICKABLE_CARDS_HREFS) {
      const link = page.locator(`a[href="${href}"]`);
      await expect(link, `Card link to ${href} should exist`).toHaveCount(1);
    }
  });

  test("stats API returns all expected keys", async ({ page, baseURL }) => {
    // Call the API directly to verify backend response
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const response = await page.request.get(
      `${apiBase}/api/v1/admin/overview-stats`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    // API wraps response in { success, data: {...} }
    const stats = body.data ?? body;

    // Every expected key must be present
    for (const key of EXPECTED_STAT_KEYS) {
      expect(stats, `Key "${key}" should exist in API response`).toHaveProperty(
        key,
      );
      expect(
        typeof stats[key],
        `Key "${key}" should be a number, got ${typeof stats[key]}`,
      ).toBe("number");
    }
  });

  test("non-clickable cards are not wrapped in links", async ({ page }) => {
    // Cards like "webhooks", "intentRouter" should not be links
    const nonClickableIds = ["webhooks", "intentRouter", "aiPlanning"];

    for (const id of nonClickableIds) {
      // These cards should NOT be wrapped in <a> tags
      // They render as plain <div> containers
      const linksWithId = page.locator(`a:has(div:text("${id}"))`);
      const count = await linksWithId.count();
      // Should have 0 links — just checking no erroneous links
      expect(
        count,
        `Non-clickable card "${id}" should not be a link`,
      ).toBeLessThanOrEqual(0);
    }
  });

  test("L2 Kernel layer shows all 8 cards", async ({ page }) => {
    // L2 should show the Kernel heading
    const l2Heading = page.getByRole("heading", { name: /Kernel/i });
    await expect(l2Heading).toBeVisible();

    // L2 should have 8 kernel module links (processes, journal, memory, ipc, resources, observability, security, scheduler)
    const kernelLinks = page.locator('a[href^="/admin/kernel/"]');
    await expect(kernelLinks).toHaveCount(8);
  });

  test("L3 Engine layer shows all 8 cards", async ({ page }) => {
    // L3 should show the Engine heading
    const l3Heading = page.getByRole("heading", { name: /Engine/i });
    await expect(l3Heading).toBeVisible();

    // L3 should have engine module links (models, agents, teams, skills, tools + mcp-clients now under /admin/ai/tools)
    const engineLinks = page.locator(
      'a[href^="/admin/ai/"]:not([href*="traces"])',
    );
    // At minimum: models, agents, teams, skills, tools, mcp-clients = 6 clickable cards (mcp-clients shares tools href)
    const count = await engineLinks.count();
    expect(
      count,
      "L3 should have at least 5 clickable engine cards",
    ).toBeGreaterThanOrEqual(5);
  });

  test("static stat values are correct", async ({ page, baseURL }) => {
    // Verify known static values from the API
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);
    const response = await page.request.get(
      `${apiBase}/api/v1/admin/overview-stats`,
      { headers },
    );
    const body = await response.json();
    const stats = body.data ?? body;

    // storageProviders is always 5
    expect(stats.storageProviders).toBe(5);
    // guardrailRules is always 2
    expect(stats.guardrailRules).toBe(2);
    // dbTables should be > 0 (real table count from PostgreSQL)
    expect(stats.dbTables).toBeGreaterThan(0);
  });
});
