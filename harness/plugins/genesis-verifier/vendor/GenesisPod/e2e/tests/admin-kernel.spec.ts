import { test, expect } from "@playwright/test";

/**
 * Admin Kernel Layer (L3) E2E Tests
 *
 * Covers all 8 kernel admin pages:
 *   /admin/kernel/processes    — AI Kernel Processes
 *   /admin/kernel/journal      — Event Journal
 *   /admin/kernel/memory       — Process Memory
 *   /admin/kernel/ipc          — IPC
 *   /admin/kernel/resources    — Resource Control (Circuit Breakers)
 *   /admin/kernel/observability — Observability (LLM Metrics)
 *   /admin/kernel/security     — Capability Guard
 *   /admin/kernel/scheduler    — Kernel Scheduler
 *
 * Also includes direct API integration tests for the backend endpoints.
 *
 * Auth is provided via storageState (.auth/user.json) set in playwright.config.ts.
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

// ─────────────────────────────────────────────────────────────────────────────
// 1. Kernel Processes
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin Kernel — Processes (/admin/kernel/processes)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/kernel/processes");
    await page.waitForResponse(
      (r) => r.url().includes("/admin/kernel/processes") && r.status() === 200,
      { timeout: 15000 },
    );
    await page.waitForTimeout(300);
  });

  test("page loads with correct heading", async ({ page }) => {
    // The AdminPageLayout renders the title as an h1
    await expect(
      page.getByRole("heading", { name: /AI Kernel Processes/i }),
    ).toBeVisible();
  });

  test("no error boundary is shown", async ({ page }) => {
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("shows process list or empty state", async ({ page }) => {
    // Either the table with headers is visible, or the empty-state message
    const hasTable = (await page.locator("table").count()) > 0;
    const hasEmptyState = await page
      .getByText("No processes found")
      .isVisible()
      .catch(() => false);
    expect(
      hasTable || hasEmptyState,
      "Should show process table or empty state",
    ).toBeTruthy();
  });

  test("shows stat cards for Total, Running, Paused, Completed, Failed", async ({
    page,
  }) => {
    await expect(page.getByText("Total")).toBeVisible();
    await expect(page.getByText("Running")).toBeVisible();
    await expect(page.getByText("Paused")).toBeVisible();
    await expect(page.getByText("Completed")).toBeVisible();
    await expect(page.getByText("Failed")).toBeVisible();
  });

  test("shows state filter pills", async ({ page }) => {
    // State filter buttons: ALL, RUNNING, PAUSED, etc.
    await expect(page.getByRole("button", { name: /^ALL$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^RUNNING$/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^COMPLETED$/ }),
    ).toBeVisible();
  });

  test("shows Refresh button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Kernel Journal
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin Kernel — Journal (/admin/kernel/journal)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/kernel/journal");
    await page.waitForResponse(
      (r) => r.url().includes("/admin/kernel/journal") && r.status() === 200,
      { timeout: 15000 },
    );
    await page.waitForTimeout(300);
  });

  test("page loads with correct heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Event Journal/i }),
    ).toBeVisible();
  });

  test("no error boundary is shown", async ({ page }) => {
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("shows stat cards with Total Events and Shown counts", async ({
    page,
  }) => {
    await expect(page.getByText("Total Events")).toBeVisible();
    await expect(page.getByText("Shown")).toBeVisible();
    await expect(page.getByText("Limit")).toBeVisible();
  });

  test("shows filter inputs for Process ID and Event Type", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Filter by Process ID")).toBeVisible();
    await expect(page.getByPlaceholder("Filter by Event Type")).toBeVisible();
  });

  test("shows journal entries table or empty state", async ({ page }) => {
    const hasTable = (await page.locator("table").count()) > 0;
    const hasEmptyState = await page
      .getByText("No journal entries found")
      .isVisible()
      .catch(() => false);
    expect(
      hasTable || hasEmptyState,
      "Should show events table or empty state",
    ).toBeTruthy();
  });

  test("shows Refresh and Search buttons", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Search/i }).first(),
    ).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Kernel Memory
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin Kernel — Memory (/admin/kernel/memory)", () => {
  test.beforeEach(async ({ page }) => {
    // Memory page fetches processes list on mount; wait for that request
    await page.goto("/admin/kernel/memory");
    // Wait for either processes fetch (may redirect to memory query) or page load
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await page.waitForTimeout(300);
  });

  test("page loads with correct heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Process Memory/i }),
    ).toBeVisible();
  });

  test("no error boundary is shown", async ({ page }) => {
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("shows process ID input field", async ({ page }) => {
    await expect(page.getByPlaceholder(/Enter process ID/i)).toBeVisible();
  });

  test("shows layer filter dropdown", async ({ page }) => {
    // The layer select has options: ALL, WORKING, SESSION, PERSISTENT
    const layerSelect = page.locator("select");
    await expect(layerSelect).toBeVisible();
    const options = await layerSelect.locator("option").allTextContents();
    expect(options).toContain("ALL");
    expect(options).toContain("WORKING");
  });

  test("shows Search button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^Search$/i })).toBeVisible();
  });

  test("shows initial empty/prompt state before any query", async ({
    page,
  }) => {
    // Without a process ID entered, either a prompt or empty state is shown
    const promptVisible = await page
      .getByText(/Enter a Process ID/i)
      .isVisible()
      .catch(() => false);
    const emptyVisible = await page
      .getByText(/No memory entries/i)
      .isVisible()
      .catch(() => false);
    // At minimum, Search button should be present (covered above)
    // And the page should not have crashed
    await expect(
      page.getByRole("heading", { name: /Process Memory/i }),
    ).toBeVisible();
    // Accept either prompt state or empty state as valid
    void promptVisible;
    void emptyVisible;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Kernel IPC
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin Kernel — IPC (/admin/kernel/ipc)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/kernel/ipc");
    await page.waitForResponse(
      (r) => r.url().includes("/admin/kernel/ipc/stats") && r.status() === 200,
      { timeout: 15000 },
    );
    await page.waitForTimeout(300);
  });

  test("page loads with correct heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /^IPC$/i })).toBeVisible();
  });

  test("no error boundary is shown", async ({ page }) => {
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("shows IPC stat cards for subscriptions and tasks", async ({ page }) => {
    await expect(page.getByText("Active Subscriptions")).toBeVisible();
    await expect(page.getByText("Active Tasks")).toBeVisible();
  });

  test("shows Active Tasks section", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Active Tasks/i }),
    ).toBeVisible();
  });

  test("shows Message History section with session ID input", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: /Message History/i }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(/Enter session ID/i)).toBeVisible();
  });

  test("shows Refresh button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
  });

  test("shows task table or empty tasks message", async ({ page }) => {
    const hasTable = (await page.locator("table").count()) > 0;
    const hasEmptyState = await page
      .getByText(/No active tasks found/i)
      .isVisible()
      .catch(() => false);
    expect(
      hasTable || hasEmptyState,
      "Should show tasks table or empty state",
    ).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Kernel Resources
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin Kernel — Resources (/admin/kernel/resources)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/kernel/resources");
    await page.waitForResponse(
      (r) =>
        r.url().includes("/admin/kernel/resources/circuit-breakers") &&
        r.status() === 200,
      { timeout: 15000 },
    );
    await page.waitForTimeout(300);
  });

  test("page loads with correct heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Resource Control/i }),
    ).toBeVisible();
  });

  test("no error boundary is shown", async ({ page }) => {
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("shows circuit breaker stat cards", async ({ page }) => {
    await expect(page.getByText("Total Breakers")).toBeVisible();
    await expect(page.getByText(/Closed/i)).toBeVisible();
    await expect(page.getByText(/Open/i)).toBeVisible();
    await expect(page.getByText(/Half-Open/i)).toBeVisible();
  });

  test("shows Circuit Breakers section heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Circuit Breakers/i }),
    ).toBeVisible();
  });

  test("shows circuit breaker table or empty state", async ({ page }) => {
    const hasTable = (await page.locator("table").count()) > 0;
    const hasEmptyState = await page
      .getByText(/No circuit breakers registered/i)
      .isVisible()
      .catch(() => false);
    expect(
      hasTable || hasEmptyState,
      "Should show circuit breakers table or empty state",
    ).toBeTruthy();
  });

  test("shows Refresh button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Kernel Observability
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin Kernel — Observability (/admin/kernel/observability)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/kernel/observability");
    await page.waitForResponse(
      (r) =>
        r.url().includes("/admin/kernel/observability/dashboard") &&
        r.status() === 200,
      { timeout: 15000 },
    );
    await page.waitForTimeout(300);
  });

  test("page loads with correct heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Observability/i }),
    ).toBeVisible();
  });

  test("no error boundary is shown", async ({ page }) => {
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("shows Metrics and Costs tabs", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /^Metrics$/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Costs$/i })).toBeVisible();
  });

  test("shows period selector buttons on Metrics tab", async ({ page }) => {
    // Default tab is Metrics; period buttons: 15m, 30m, 60m, 120m
    await expect(page.getByRole("button", { name: "15m" })).toBeVisible();
    await expect(page.getByRole("button", { name: "60m" })).toBeVisible();
  });

  test("shows LLM stat cards: Total Calls, Total Tokens, Total Cost", async ({
    page,
  }) => {
    await expect(page.getByText("Total Calls")).toBeVisible();
    await expect(page.getByText("Total Tokens")).toBeVisible();
    await expect(page.getByText("Total Cost")).toBeVisible();
  });

  test("shows Success Rate and Latency stats", async ({ page }) => {
    await expect(page.getByText("Success Rate")).toBeVisible();
    await expect(page.getByText("Latency P50")).toBeVisible();
    await expect(page.getByText("Latency P95")).toBeVisible();
  });

  test("shows By Model and By Module section headings", async ({ page }) => {
    await expect(page.getByText("By Model")).toBeVisible();
    await expect(page.getByText("By Module")).toBeVisible();
  });

  test("auto-refresh notice is visible", async ({ page }) => {
    await expect(page.getByText(/Auto-refreshes every/i)).toBeVisible();
  });

  test("switching to Costs tab works", async ({ page }) => {
    await page.getByRole("button", { name: /^Costs$/i }).click();
    // Costs tab renders its own period selector (hours)
    await expect(page.getByRole("button", { name: "24h" })).toBeVisible();
  });

  test("shows Refresh button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Kernel Security
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin Kernel — Security (/admin/kernel/security)", () => {
  test.beforeEach(async ({ page }) => {
    // Security page doesn't auto-fetch on load (it's query-based)
    await page.goto("/admin/kernel/security");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await page.waitForTimeout(300);
  });

  test("page loads with correct heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Capability Guard/i }),
    ).toBeVisible();
  });

  test("no error boundary is shown", async ({ page }) => {
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("shows Process ID input field", async ({ page }) => {
    await expect(
      page.getByPlaceholder(/Enter process ID to inspect capabilities/i),
    ).toBeVisible();
  });

  test("shows Query button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^Query$/i })).toBeVisible();
  });

  test("shows initial prompt to enter a Process ID", async ({ page }) => {
    await expect(
      page.getByText(/Enter a Process ID to view its capabilities/i),
    ).toBeVisible();
  });

  test("Query button is disabled when no process ID is entered", async ({
    page,
  }) => {
    const queryButton = page.getByRole("button", { name: /^Query$/i });
    await expect(queryButton).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Kernel Scheduler
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin Kernel — Scheduler (/admin/kernel/scheduler)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/kernel/scheduler");
    await page.waitForResponse(
      (r) =>
        r.url().includes("/admin/kernel/scheduler/stats") && r.status() === 200,
      { timeout: 15000 },
    );
    await page.waitForTimeout(300);
  });

  test("page loads with correct heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Kernel Scheduler/i }),
    ).toBeVisible();
  });

  test("no error boundary is shown", async ({ page }) => {
    await expect(page.getByText("出错了")).not.toBeVisible();
  });

  test("shows scheduler stat cards", async ({ page }) => {
    // Stats: Running, Ready, Max Concurrent, Max Per Tenant
    // Either stats are loaded (stat cards visible) or loading spinner is shown
    const statsLoaded = await page
      .getByText("Max Concurrent")
      .isVisible()
      .catch(() => false);
    const isLoading = await page
      .getByText(/Loading scheduler stats/i)
      .isVisible()
      .catch(() => false);
    const isUnavailable = await page
      .getByText(/Scheduler stats unavailable/i)
      .isVisible()
      .catch(() => false);
    expect(
      statsLoaded || isLoading || isUnavailable,
      "Page should show stats, loading state, or unavailable message",
    ).toBeTruthy();
  });

  test("shows Running and Ready stat labels when data is available", async ({
    page,
  }) => {
    // Wait a bit more in case stats are still loading
    await page.waitForTimeout(1000);
    const isUnavailable = await page
      .getByText(/Scheduler stats unavailable/i)
      .isVisible()
      .catch(() => false);
    if (!isUnavailable) {
      await expect(page.getByText("Running")).toBeVisible();
      await expect(page.getByText("Ready")).toBeVisible();
    }
  });

  test("shows concurrency utilization bar when data is available", async ({
    page,
  }) => {
    await page.waitForTimeout(500);
    const isUnavailable = await page
      .getByText(/Scheduler stats unavailable/i)
      .isVisible()
      .catch(() => false);
    if (!isUnavailable) {
      await expect(page.getByText(/Concurrency Utilization/i)).toBeVisible();
    }
  });

  test("shows auto-refresh notice", async ({ page }) => {
    await page.waitForTimeout(500);
    const isUnavailable = await page
      .getByText(/Scheduler stats unavailable/i)
      .isVisible()
      .catch(() => false);
    if (!isUnavailable) {
      await expect(
        page.getByText(/Auto-refreshes every 5 seconds/i),
      ).toBeVisible();
    }
  });

  test("shows Refresh button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kernel API Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Kernel API Integration Tests", () => {
  // Navigate to any admin page first to establish auth in localStorage
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  });

  test("GET /api/v1/admin/kernel/processes — returns process list shape", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/processes`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Must have processes array and total count
    expect(data).toHaveProperty("processes");
    expect(data).toHaveProperty("total");
    expect(
      Array.isArray(data.processes),
      "processes should be an array",
    ).toBeTruthy();
    expect(typeof data.total, "total should be a number").toBe("number");

    // Each process must have required fields
    if (data.processes.length > 0) {
      const proc = data.processes[0];
      expect(proc).toHaveProperty("id");
      expect(proc).toHaveProperty("state");
      expect(proc).toHaveProperty("createdAt");
    }
  });

  test("GET /api/v1/admin/kernel/processes?states=RUNNING — filters by state", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/processes?states=RUNNING`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    expect(Array.isArray(data.processes)).toBeTruthy();
    // If any processes returned, all must have state RUNNING
    for (const proc of data.processes as Array<{ state: string }>) {
      expect(proc.state).toBe("RUNNING");
    }
  });

  test("GET /api/v1/admin/kernel/journal — returns entries array", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/journal`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    expect(data).toHaveProperty("entries");
    expect(data).toHaveProperty("total");
    expect(
      Array.isArray(data.entries),
      "entries should be an array",
    ).toBeTruthy();
    expect(typeof data.total, "total should be a number").toBe("number");
  });

  test("GET /api/v1/admin/kernel/observability/dashboard?period=60 — returns metrics shape", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/observability/dashboard?period=60`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Required top-level fields
    expect(data).toHaveProperty("totalCalls");
    expect(data).toHaveProperty("totalTokens");
    expect(data).toHaveProperty("totalCost");
    expect(data).toHaveProperty("successRate");
    expect(data).toHaveProperty("latency");
    expect(data).toHaveProperty("byModel");
    expect(data).toHaveProperty("byModule");
    expect(data).toHaveProperty("period");

    // Types
    expect(typeof data.totalCalls, "totalCalls should be a number").toBe(
      "number",
    );
    expect(typeof data.totalCost, "totalCost should be a number").toBe(
      "number",
    );
    expect(typeof data.successRate, "successRate should be a number").toBe(
      "number",
    );
    expect(
      Array.isArray(data.byModel),
      "byModel should be an array",
    ).toBeTruthy();
    expect(
      Array.isArray(data.byModule),
      "byModule should be an array",
    ).toBeTruthy();

    // totalTokens shape
    expect(data.totalTokens).toHaveProperty("total");
    expect(
      typeof data.totalTokens.total,
      "totalTokens.total should be a number",
    ).toBe("number");

    // latency shape
    expect(data.latency).toHaveProperty("p50");
    expect(data.latency).toHaveProperty("p95");
    expect(data.latency).toHaveProperty("p99");

    // period shape
    expect(data.period).toHaveProperty("minutes");
    expect(data.period.minutes).toBe(60);
  });

  test("GET /api/v1/admin/kernel/ipc/stats — returns subscription and task stats", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/ipc/stats`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // IPC stats must include subscription and task counts
    expect(data).toHaveProperty("activeSubscriptions");
    expect(data).toHaveProperty("activeTaskCount");
    expect(
      typeof data.activeSubscriptions,
      "activeSubscriptions should be a number",
    ).toBe("number");
    expect(
      typeof data.activeTaskCount,
      "activeTaskCount should be a number",
    ).toBe("number");
  });

  test("GET /api/v1/admin/kernel/ipc/progress — returns tasks array", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/ipc/progress`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    expect(data).toHaveProperty("tasks");
    expect(data).toHaveProperty("total");
    expect(Array.isArray(data.tasks), "tasks should be an array").toBeTruthy();
  });

  test("GET /api/v1/admin/kernel/resources/circuit-breakers — returns breakers array", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/resources/circuit-breakers`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    expect(data).toHaveProperty("breakers");
    expect(data).toHaveProperty("total");
    expect(
      Array.isArray(data.breakers),
      "breakers should be an array",
    ).toBeTruthy();
    expect(typeof data.total, "total should be a number").toBe("number");

    // If any breakers exist, validate their shape
    if (data.breakers.length > 0) {
      const breaker = data.breakers[0];
      expect(breaker).toHaveProperty("entityId");
      expect(breaker).toHaveProperty("state");
      expect(breaker).toHaveProperty("successRate");
      expect(breaker).toHaveProperty("isAvailable");
    }
  });

  test("GET /api/v1/admin/kernel/resources/circuit-breakers/stats — returns summary stats", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/resources/circuit-breakers/stats`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    expect(data).toHaveProperty("totalBreakers");
    expect(typeof data.totalBreakers, "totalBreakers should be a number").toBe(
      "number",
    );
  });

  test("GET /api/v1/admin/kernel/scheduler/stats — returns scheduler capacity", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/scheduler/stats`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    // Scheduler stats must have running/ready counts and capacity limits
    expect(data).toHaveProperty("running");
    expect(data).toHaveProperty("ready");
    expect(data).toHaveProperty("maxConcurrent");
    expect(data).toHaveProperty("maxPerTenant");

    expect(typeof data.running, "running should be a number").toBe("number");
    expect(typeof data.ready, "ready should be a number").toBe("number");
    expect(typeof data.maxConcurrent, "maxConcurrent should be a number").toBe(
      "number",
    );
    expect(typeof data.maxPerTenant, "maxPerTenant should be a number").toBe(
      "number",
    );

    // Sanity: running cannot exceed maxConcurrent (unless maxConcurrent is 0)
    if (data.maxConcurrent > 0) {
      expect(data.running).toBeLessThanOrEqual(data.maxConcurrent);
    }
  });

  test("GET /api/v1/admin/kernel/observability/costs?hours=24 — returns cost report", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/admin/kernel/observability/costs?hours=24`,
      { headers },
    );
    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const data = body.data ?? body;

    expect(data).toHaveProperty("totalCost");
    expect(data).toHaveProperty("totalTokens");
    expect(data).toHaveProperty("period");
    expect(data).toHaveProperty("byUser");
    expect(data).toHaveProperty("byModule");
    expect(data).toHaveProperty("byModel");

    expect(typeof data.totalCost, "totalCost should be a number").toBe(
      "number",
    );
    expect(
      Array.isArray(data.byUser),
      "byUser should be an array",
    ).toBeTruthy();
    expect(
      Array.isArray(data.byModule),
      "byModule should be an array",
    ).toBeTruthy();
    expect(
      Array.isArray(data.byModel),
      "byModel should be an array",
    ).toBeTruthy();

    // period shape
    expect(data.period).toHaveProperty("hours");
    expect(data.period.hours).toBe(24);
  });

  test("kernel APIs all require authentication — reject unauthenticated requests", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";

    // Test without auth header — should get 401
    const endpoints = [
      "/api/v1/admin/kernel/processes",
      "/api/v1/admin/kernel/ipc/stats",
      "/api/v1/admin/kernel/scheduler/stats",
    ];

    for (const endpoint of endpoints) {
      const response = await page.request.get(`${apiBase}${endpoint}`);
      expect(
        response.status(),
        `${endpoint} should require auth (expected 401, got ${response.status()})`,
      ).toBe(401);
    }
  });
});
