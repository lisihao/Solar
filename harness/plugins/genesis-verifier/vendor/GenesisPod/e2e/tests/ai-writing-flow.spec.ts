import { test, expect } from "@playwright/test";

/**
 * AI Writing Flow — E2E Tests
 *
 * Writing module flow crossing L4 → L2 → L1 layers:
 * - L4 AI Apps: Writing module (projects, chapters, story bible, world)
 * - L3 AI Engine: LLM service (content generation)
 * - L1 Infrastructure: Credits consumed during generation
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
// 1. UI Tests — Writing Page
// ---------------------------------------------------------------------------

test.describe("Writing Module UI (/ai-writing)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-writing", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors or error boundary", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("project list or empty state renders", async ({ page }) => {
    // Writing page shows project cards or an empty state
    const projectCard = page.locator(
      "[class*='project'], [class*='card'], [class*='writing'], table",
    );
    const emptyState = page.getByText(
      /no.*project|empty|get started|create|new project/i,
    );

    const hasProjects = (await projectCard.count()) > 0;
    const hasEmptyState = (await emptyState.count()) > 0;

    expect(
      hasProjects || hasEmptyState,
      "Writing page should show projects or empty state",
    ).toBe(true);
  });

  test("page heading is visible", async ({ page }) => {
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("New Project creation option exists", async ({ page }) => {
    const createButton = page.getByRole("button", {
      name: /new|create|start|write|begin/i,
    });
    const hasCreate = (await createButton.count()) > 0;

    // Could also be a link
    const createLink = page.getByRole("link", {
      name: /new|create|new project/i,
    });
    const hasLink = (await createLink.count()) > 0;

    expect(
      hasCreate || hasLink,
      "Writing page should have a create new project option",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. API Contract Tests — Writing Projects (L4 App)
// ---------------------------------------------------------------------------

test.describe("Writing API — Projects (L4 App)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-writing", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("POST /writing/projects — create writing project", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(
      `${apiBase}/api/v1/writing/projects`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          title: "E2E Test Writing Project",
          genre: "fiction",
          description: "A test writing project created by Playwright E2E",
        },
        timeout: 15000,
      },
    );

    // Accept 201 Created, 200 OK
    expect(
      [200, 201].includes(response.status()),
      `POST /writing/projects returned ${response.status()}`,
    ).toBe(true);

    const body = await response.json();
    const project = body.data ?? body;
    expect(project, "Created project should be truthy").toBeTruthy();
    expect(
      project.id ?? project._id,
      "Created project must have an id",
    ).toBeTruthy();
  });

  test("GET /writing/projects — list projects returns array", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/writing/projects`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /writing/projects returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.projects ?? []);
    expect(Array.isArray(list), "Writing projects should be an array").toBe(
      true,
    );
  });

  test("GET /writing/projects/:id — get project detail", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Get list first
    const listRes = await page.request.get(
      `${apiBase}/api/v1/writing/projects`,
      { headers, timeout: 15000 },
    );
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.projects ?? []);
    if (list.length === 0) return;

    const projectId = list[0].id ?? list[0]._id;
    const response = await page.request.get(
      `${apiBase}/api/v1/writing/projects/${projectId}`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /writing/projects/:id returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const project = body.data ?? body;
    expect(project, "Project detail should be truthy").toBeTruthy();
  });

  test("PATCH /writing/projects/:id — update project title", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(
      `${apiBase}/api/v1/writing/projects`,
      { headers, timeout: 15000 },
    );
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.projects ?? []);
    if (list.length === 0) return;

    const projectId = list[0].id ?? list[0]._id;
    const response = await page.request.patch(
      `${apiBase}/api/v1/writing/projects/${projectId}`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { description: "Updated description by E2E test" },
        timeout: 15000,
      },
    );

    expect(
      [200, 204].includes(response.status()),
      `PATCH /writing/projects/:id returned ${response.status()}`,
    ).toBe(true);
  });

  test("POST /writing/projects — validation: reject missing title", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(
      `${apiBase}/api/v1/writing/projects`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { description: "No title provided" },
        timeout: 15000,
      },
    );

    // Should reject with 400 Bad Request
    expect(
      [400, 422].includes(response.status()),
      `Missing title should return 400/422, got ${response.status()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. API Contract Tests — Chapters (L4 App)
// ---------------------------------------------------------------------------

test.describe("Writing API — Chapters (L4 App)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-writing", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /writing/projects/:id/chapters — get chapters", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(
      `${apiBase}/api/v1/writing/projects`,
      { headers, timeout: 15000 },
    );
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.projects ?? []);
    if (list.length === 0) return;

    const projectId = list[0].id ?? list[0]._id;
    const response = await page.request.get(
      `${apiBase}/api/v1/writing/projects/${projectId}/chapters`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 404].includes(response.status()),
      `GET /writing/projects/:id/chapters returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const payload = body.data ?? body;
      const chapters = Array.isArray(payload)
        ? payload
        : (payload.items ?? payload.chapters ?? []);
      expect(Array.isArray(chapters), "Chapters should be an array").toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. API Contract Tests — Story Bible & World Settings (L4 App)
// ---------------------------------------------------------------------------

test.describe("Writing API — Story Bible & World (L4 App)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-writing", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /writing/projects/:id/story-bible — get story bible", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(
      `${apiBase}/api/v1/writing/projects`,
      { headers, timeout: 15000 },
    );
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.projects ?? []);
    if (list.length === 0) return;

    const projectId = list[0].id ?? list[0]._id;
    const response = await page.request.get(
      `${apiBase}/api/v1/writing/projects/${projectId}/story-bible`,
      { headers, timeout: 15000 },
    );

    // Story bible may not exist for new projects
    expect(
      [200, 404].includes(response.status()),
      `GET /writing/projects/:id/story-bible returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /writing/projects/:id/world — get world settings", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(
      `${apiBase}/api/v1/writing/projects`,
      { headers, timeout: 15000 },
    );
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.projects ?? []);
    if (list.length === 0) return;

    const projectId = list[0].id ?? list[0]._id;
    const response = await page.request.get(
      `${apiBase}/api/v1/writing/projects/${projectId}/world`,
      { headers, timeout: 15000 },
    );

    // World settings may not exist for new projects
    expect(
      [200, 404].includes(response.status()),
      `GET /writing/projects/:id/world returned ${response.status()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. API Contract Tests — Validation & Cleanup
// ---------------------------------------------------------------------------

test.describe("Writing API — Validation & Cleanup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-writing", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /writing/projects/:id — reject invalid project id", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/writing/projects/nonexistent-project-id-xyz`,
      { headers, timeout: 15000 },
    );

    // Should return 404 Not Found
    expect(
      [400, 404].includes(response.status()),
      `Invalid project id should return 400/404, got ${response.status()}`,
    ).toBe(true);
  });

  test("DELETE /writing/projects/:id — delete writing project", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Create a project to delete
    const createRes = await page.request.post(
      `${apiBase}/api/v1/writing/projects`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { title: "E2E Delete Test Writing Project" },
        timeout: 15000,
      },
    );

    if (!createRes.ok()) return;

    const createBody = await createRes.json();
    const project = createBody.data ?? createBody;
    const projectId = project.id ?? project._id;

    if (!projectId) return;

    const deleteRes = await page.request.delete(
      `${apiBase}/api/v1/writing/projects/${projectId}`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 204].includes(deleteRes.status()),
      `DELETE /writing/projects/:id returned ${deleteRes.status()}`,
    ).toBe(true);
  });

  test("GET /ai-writing/style-presets returns style options", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/ai-writing/style-presets`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /ai-writing/style-presets returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const presets = Array.isArray(payload) ? payload : (payload.items ?? []);
    expect(Array.isArray(presets), "Style presets should be an array").toBe(
      true,
    );
  });

  test("Full flow: create project, update, get detail, delete", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Step 1: Create
    const createRes = await page.request.post(
      `${apiBase}/api/v1/writing/projects`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { title: "E2E Full Flow Test" },
        timeout: 15000,
      },
    );
    if (!createRes.ok()) return;

    const createBody = await createRes.json();
    const created = createBody.data ?? createBody;
    const projectId = created.id ?? created._id;
    expect(projectId, "Project should have id after creation").toBeTruthy();

    // Step 2: Update
    const updateRes = await page.request.patch(
      `${apiBase}/api/v1/writing/projects/${projectId}`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { description: "Updated in full flow test" },
        timeout: 15000,
      },
    );
    expect(
      [200, 204].includes(updateRes.status()),
      `Update should succeed, got ${updateRes.status()}`,
    ).toBe(true);

    // Step 3: Get detail
    const getRes = await page.request.get(
      `${apiBase}/api/v1/writing/projects/${projectId}`,
      { headers, timeout: 15000 },
    );
    expect(getRes.ok(), "Get detail should succeed").toBeTruthy();

    // Step 4: Delete
    const deleteRes = await page.request.delete(
      `${apiBase}/api/v1/writing/projects/${projectId}`,
      { headers, timeout: 15000 },
    );
    expect(
      [200, 204].includes(deleteRes.status()),
      `Delete should succeed, got ${deleteRes.status()}`,
    ).toBe(true);
  });
});
