import { test, expect } from "@playwright/test";

/**
 * AI Insights Flow — E2E Tests
 *
 * Topic Insights module crossing L4 -> L2 -> L1 layers:
 * - L4 AI Apps: Topic insights dashboard and research
 * - L3 AI Engine: LLM research and analysis
 * - L1 Infrastructure: Credits consumed
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
// 1. UI Tests — AI Insights Dashboard
// ---------------------------------------------------------------------------

test.describe("AI Insights UI (/ai-insights)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-insights", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors or error boundary", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("topic list or empty state renders", async ({ page }) => {
    const topicCards = page.locator(
      "[class*='topic'], [class*='card'], [class*='insight'], table",
    );
    const emptyState = page.getByText(
      /no.*topic|no.*insight|empty|get started|create/i,
    );

    const hasTopics = (await topicCards.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasTopics || hasEmptyState,
      "Insights page should show topics or empty state",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. UI Tests — Topic Research Page
// ---------------------------------------------------------------------------

test.describe("AI Insights Topic Research UI (/ai-insights/topic-research)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-insights/topic-research", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);
  });

  test("research page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("research form or input is visible", async ({ page }) => {
    const inputs = page.locator("input, textarea");
    const buttons = page.getByRole("button");
    expect(
      (await inputs.count()) > 0 || (await buttons.count()) > 0,
      "Research page should have form elements",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. API Contract Tests — Topics
// ---------------------------------------------------------------------------

test.describe("Insights API — Topics", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-insights", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /topic-insights/topics — list topics", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/topic-insights/topics`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /topic-insights/topics returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.topics ?? []);
    expect(Array.isArray(list), "Topics should be an array").toBe(true);
  });

  test("POST /topic-insights/topics — create topic", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(
      `${apiBase}/api/v1/topic-insights/topics`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          name: "E2E Test Topic",
          type: "TECHNOLOGY",
          description: "Test topic created by Playwright E2E",
        },
        timeout: 15000,
      },
    );

    expect(
      [200, 201].includes(response.status()),
      `POST /topic-insights/topics returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /topic-insights/topics/:id — get topic detail", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(
      `${apiBase}/api/v1/topic-insights/topics`,
      { headers, timeout: 15000 },
    );
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.topics ?? []);
    if (list.length === 0) return;

    const topicId = list[0].id ?? list[0]._id;
    const response = await page.request.get(
      `${apiBase}/api/v1/topic-insights/topics/${topicId}`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /topic-insights/topics/:id returned ${response.status()}`,
    ).toBeTruthy();
  });

  test("DELETE /topic-insights/topics/:id — delete topic", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Create topic to delete
    const createRes = await page.request.post(
      `${apiBase}/api/v1/topic-insights/topics`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          title: "E2E Delete Test Topic",
          description: "Will be deleted",
        },
        timeout: 15000,
      },
    );
    if (![200, 201].includes(createRes.status())) return;

    const createBody = await createRes.json();
    const topic = createBody.data ?? createBody;
    const topicId = topic.id ?? topic._id;
    if (!topicId) return;

    const deleteRes = await page.request.delete(
      `${apiBase}/api/v1/topic-insights/topics/${topicId}`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 204].includes(deleteRes.status()),
      `DELETE /topic-insights/topics/:id returned ${deleteRes.status()}`,
    ).toBe(true);
  });
});
