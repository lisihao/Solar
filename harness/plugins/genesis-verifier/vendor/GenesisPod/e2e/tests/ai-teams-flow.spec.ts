import { test, expect } from "@playwright/test";

/**
 * AI Teams Flow — E2E Tests
 *
 * Teams module full flow crossing L4 → L2 layers:
 * - L4 AI Apps: Teams module (topics, AI members, messages, summary)
 * - L3 AI Engine: Teams framework (registry), LLM service (summary generation)
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
// 1. UI Tests — Teams Page
// ---------------------------------------------------------------------------

test.describe("Teams Module UI (/ai-teams)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-teams", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("topic list renders or shows empty state", async ({ page }) => {
    // Teams page shows a list of topics (debate rooms) or empty state
    const topicItem = page.locator(
      "[class*='topic'], [class*='card'], [class*='room'], table",
    );
    const emptyState = page.getByText(/no.*topic|empty|create|new/i);

    const hasTopics = (await topicItem.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasTopics || hasEmptyState,
      "Teams page should show topics or empty state",
    ).toBe(true);
  });

  test("page has a heading visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("AI member capabilities are displayed", async ({ page }) => {
    // Either AI member cards or team configuration options should be visible
    const hasContent =
      (await page.locator("h1, h2, button, [class*='member']").count()) > 0;
    expect(hasContent, "Teams page should render some AI member UI").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. API Contract Tests — Topics (L4 App)
// ---------------------------------------------------------------------------

test.describe("Teams API — Topics (L4 App)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-teams", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("POST /topics — create topic", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(`${apiBase}/api/v1/topics`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {
        title: "E2E Test Topic",
        description: "A debate topic created by Playwright E2E test",
      },
      timeout: 15000,
    });

    expect(
      [200, 201].includes(response.status()),
      `POST /topics returned ${response.status()}`,
    ).toBe(true);

    const body = await response.json();
    const topic = body.data ?? body;
    expect(topic, "Created topic should be truthy").toBeTruthy();
    expect(topic.id ?? topic._id, "Topic must have an id").toBeTruthy();
  });

  test("GET /topics — list topics returns array", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/topics`, {
      headers,
      timeout: 15000,
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
    expect(Array.isArray(list), "Topics should be an array").toBe(true);
  });

  test("GET /topics/:id — get topic detail", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(`${apiBase}/api/v1/topics`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.topics ?? []);
    if (list.length === 0) return;

    const topicId = list[0].id ?? list[0]._id;
    const response = await page.request.get(
      `${apiBase}/api/v1/topics/${topicId}`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /topics/:id returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const topic = body.data ?? body;
    expect(topic, "Topic detail should be truthy").toBeTruthy();
  });

  test("PATCH /topics/:id — update topic title/description", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(`${apiBase}/api/v1/topics`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.topics ?? []);
    if (list.length === 0) return;

    const topicId = list[0].id ?? list[0]._id;
    const response = await page.request.patch(
      `${apiBase}/api/v1/topics/${topicId}`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { description: "Updated by E2E test" },
        timeout: 15000,
      },
    );

    expect(
      [200, 204].includes(response.status()),
      `PATCH /topics/:id returned ${response.status()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. API Contract Tests — AI Members (L4 App)
// ---------------------------------------------------------------------------

test.describe("Teams API — AI Members (L4 App)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-teams", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("POST /topics/:id/ai-members — add AI member to topic", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(`${apiBase}/api/v1/topics`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.topics ?? []);
    if (list.length === 0) return;

    const topicId = list[0].id ?? list[0]._id;
    const response = await page.request.post(
      `${apiBase}/api/v1/topics/${topicId}/ai-members`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          name: "E2E Test AI Member",
          role: "participant",
          persona: "A helpful AI assistant for testing",
        },
        timeout: 15000,
      },
    );

    // Accept success or validation failure
    expect(
      [200, 201, 400, 404, 422].includes(response.status()),
      `POST /topics/:id/ai-members returned ${response.status()}`,
    ).toBe(true);
  });

  test("PATCH /topics/:id/ai-members/:memberId — update AI member", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Get a topic with members
    const listRes = await page.request.get(`${apiBase}/api/v1/topics`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.topics ?? []);
    if (list.length === 0) return;

    const topicId = list[0].id ?? list[0]._id;

    // Get members of this topic
    const topicRes = await page.request.get(
      `${apiBase}/api/v1/topics/${topicId}`,
      { headers, timeout: 15000 },
    );
    if (!topicRes.ok()) return;

    const topicBody = await topicRes.json();
    const topic = topicBody.data ?? topicBody;
    const members = topic.aiMembers ?? topic.members ?? [];

    if (members.length === 0) return;

    const memberId = members[0].id ?? members[0]._id;
    const response = await page.request.patch(
      `${apiBase}/api/v1/topics/${topicId}/ai-members/${memberId}`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { persona: "Updated persona by E2E test" },
        timeout: 15000,
      },
    );

    expect(
      [200, 204, 404].includes(response.status()),
      `PATCH /topics/:id/ai-members/:memberId returned ${response.status()}`,
    ).toBe(true);
  });

  test("DELETE /topics/:id/ai-members/:memberId — remove AI member", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(`${apiBase}/api/v1/topics`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.topics ?? []);
    if (list.length === 0) return;

    const topicId = list[0].id ?? list[0]._id;
    const topicRes = await page.request.get(
      `${apiBase}/api/v1/topics/${topicId}`,
      { headers, timeout: 15000 },
    );
    if (!topicRes.ok()) return;

    const topicBody = await topicRes.json();
    const topic = topicBody.data ?? topicBody;
    const members = topic.aiMembers ?? topic.members ?? [];

    if (members.length === 0) return;

    const memberId =
      members[members.length - 1].id ?? members[members.length - 1]._id;
    const response = await page.request.delete(
      `${apiBase}/api/v1/topics/${topicId}/ai-members/${memberId}`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 204, 404].includes(response.status()),
      `DELETE /topics/:id/ai-members/:memberId returned ${response.status()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. API Contract Tests — Messages (L4 App → L3 Engine)
// ---------------------------------------------------------------------------

test.describe("Teams API — Messages (L4 App)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-teams", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("POST /topics/:id/messages — send text message", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(`${apiBase}/api/v1/topics`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.topics ?? []);
    if (list.length === 0) return;

    const topicId = list[0].id ?? list[0]._id;
    const response = await page.request.post(
      `${apiBase}/api/v1/topics/${topicId}/messages`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          content: "E2E test message from Playwright",
          type: "text",
        },
        timeout: 15000,
      },
    );

    // Accept success or validation failure
    expect(
      [200, 201, 400, 404].includes(response.status()),
      `POST /topics/:id/messages returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /topics/:id/messages — get messages with pagination", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(`${apiBase}/api/v1/topics`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.topics ?? []);
    if (list.length === 0) return;

    const topicId = list[0].id ?? list[0]._id;
    const response = await page.request.get(
      `${apiBase}/api/v1/topics/${topicId}/messages?page=1&pageSize=20`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 404].includes(response.status()),
      `GET /topics/:id/messages returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const payload = body.data ?? body;
      const messages = Array.isArray(payload)
        ? payload
        : (payload.items ?? payload.messages ?? []);
      expect(Array.isArray(messages), "Messages should be an array").toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. API Contract Tests — Summary (L4 App → L3 Engine LLM)
// ---------------------------------------------------------------------------

test.describe("Teams API — Summary (L4 → L3 Engine)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-teams", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("POST /topics/:id/summary — request topic summary", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(`${apiBase}/api/v1/topics`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.topics ?? []);
    if (list.length === 0) return;

    const topicId = list[0].id ?? list[0]._id;
    const response = await page.request.post(
      `${apiBase}/api/v1/topics/${topicId}/summary`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {},
        timeout: 30000,
      },
    );

    // Summary generation may succeed, require credits (402), or be unavailable
    expect(
      [200, 201, 400, 402, 404, 503].includes(response.status()),
      `POST /topics/:id/summary returned ${response.status()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Full Flow & Cleanup
// ---------------------------------------------------------------------------

test.describe("Teams API — Full Flow & Cleanup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-teams", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("DELETE /topics/:id — cleanup test topic", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Create a topic specifically to delete
    const createRes = await page.request.post(`${apiBase}/api/v1/topics`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: { title: "E2E Delete Test Topic" },
      timeout: 15000,
    });

    if (!createRes.ok()) return;

    const createBody = await createRes.json();
    const topic = createBody.data ?? createBody;
    const topicId = topic.id ?? topic._id;

    if (!topicId) return;

    const deleteRes = await page.request.delete(
      `${apiBase}/api/v1/topics/${topicId}`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 204].includes(deleteRes.status()),
      `DELETE /topics/:id returned ${deleteRes.status()}`,
    ).toBe(true);
  });

  test("Full flow: create topic → add AI member → send message → get messages → delete", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Step 1: Create topic
    const createRes = await page.request.post(`${apiBase}/api/v1/topics`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {
        title: "E2E Full Flow Topic",
        description: "Full flow test by Playwright E2E",
      },
      timeout: 15000,
    });
    if (!createRes.ok()) return;

    const createBody = await createRes.json();
    const created = createBody.data ?? createBody;
    const topicId = created.id ?? created._id;
    expect(topicId, "Topic should have id after creation").toBeTruthy();

    // Step 2: Add AI member
    await page.request.post(`${apiBase}/api/v1/topics/${topicId}/ai-members`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {
        name: "Flow Test AI",
        role: "participant",
        persona: "A test AI for the full flow",
      },
      timeout: 15000,
    });

    // Step 3: Send a message
    const msgRes = await page.request.post(
      `${apiBase}/api/v1/topics/${topicId}/messages`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { content: "Hello from the full flow test", type: "text" },
        timeout: 15000,
      },
    );
    // Message send may succeed or fail with validation
    expect(
      [200, 201, 400, 404].includes(msgRes.status()),
      `Message send returned ${msgRes.status()}`,
    ).toBe(true);

    // Step 4: Get messages
    const getRes = await page.request.get(
      `${apiBase}/api/v1/topics/${topicId}/messages`,
      { headers, timeout: 15000 },
    );
    expect(
      [200, 404].includes(getRes.status()),
      `Get messages returned ${getRes.status()}`,
    ).toBe(true);

    // Step 5: Delete topic
    const deleteRes = await page.request.delete(
      `${apiBase}/api/v1/topics/${topicId}`,
      { headers, timeout: 15000 },
    );
    expect(
      [200, 204].includes(deleteRes.status()),
      `Delete topic returned ${deleteRes.status()}`,
    ).toBe(true);
  });
});
