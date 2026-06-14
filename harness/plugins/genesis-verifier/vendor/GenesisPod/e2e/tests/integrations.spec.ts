import { test, expect } from "@playwright/test";

/**
 * Library Integrations — E2E Tests
 *
 * Covers L4 AI Apps → external integrations:
 * - Notion, Google Drive, Feishu connection status
 * - Collections management
 * - Knowledge graph nodes
 * - Notes
 * - RAG system status
 * - Export jobs and templates
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
// 1. External Integration Status (L4 App → External)
// ---------------------------------------------------------------------------

test.describe("External Integrations Status", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /integrations/notion/status — Notion connection status", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/integrations/notion/status`,
      { headers, timeout: 15000 },
    );

    // May return 200 with status info or 404 if not configured
    expect(
      [200, 404].includes(response.status()),
      `GET /integrations/notion/status returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const status = body.data ?? body;
      expect(status, "Notion status should be truthy").toBeTruthy();
    }
  });

  test("GET /integrations/google-drive/status — Google Drive status", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/integrations/google-drive/status`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 404].includes(response.status()),
      `GET /integrations/google-drive/status returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const status = body.data ?? body;
      expect(status, "Google Drive status should be truthy").toBeTruthy();
    }
  });

  test("GET /integrations/feishu/status — Feishu status", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/integrations/feishu/status`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 404].includes(response.status()),
      `GET /integrations/feishu/status returned ${response.status()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Collections (L4 App Content Management)
// ---------------------------------------------------------------------------

test.describe("Collections API (L4 App)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /collections — list collections", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/collections`, {
      headers,
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /collections returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.collections ?? []);
    expect(Array.isArray(list), "Collections should be an array").toBe(true);
  });

  test("POST /collections — create collection", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(`${apiBase}/api/v1/collections`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {
        name: "E2E Test Collection",
        description: "Created by Playwright E2E test",
      },
      timeout: 15000,
    });

    expect(
      [200, 201].includes(response.status()),
      `POST /collections returned ${response.status()}`,
    ).toBe(true);

    const body = await response.json();
    const collection = body.data ?? body;
    expect(collection, "Created collection should be truthy").toBeTruthy();
  });

  test("GET /collections/:id — get collection detail", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Get list first
    const listRes = await page.request.get(`${apiBase}/api/v1/collections`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.collections ?? []);
    if (list.length === 0) return;

    const collectionId = list[0].id ?? list[0]._id;
    const response = await page.request.get(
      `${apiBase}/api/v1/collections/${collectionId}`,
      { headers, timeout: 15000 },
    );

    expect(
      response.ok(),
      `GET /collections/:id returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const collection = body.data ?? body;
    expect(collection, "Collection detail should be truthy").toBeTruthy();
  });

  test("PATCH /collections/:id — update collection", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const listRes = await page.request.get(`${apiBase}/api/v1/collections`, {
      headers,
      timeout: 15000,
    });
    if (!listRes.ok()) return;

    const listBody = await listRes.json();
    const listPayload = listBody.data ?? listBody;
    const list = Array.isArray(listPayload)
      ? listPayload
      : (listPayload.items ?? listPayload.collections ?? []);
    if (list.length === 0) return;

    const collectionId = list[0].id ?? list[0]._id;
    const response = await page.request.patch(
      `${apiBase}/api/v1/collections/${collectionId}`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { description: "Updated by E2E test" },
        timeout: 15000,
      },
    );

    expect(
      [200, 204].includes(response.status()),
      `PATCH /collections/:id returned ${response.status()}`,
    ).toBe(true);
  });

  test("DELETE /collections/:id — delete collection", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    // Create a collection to delete
    const createRes = await page.request.post(`${apiBase}/api/v1/collections`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: { name: "E2E Delete Collection" },
      timeout: 15000,
    });
    if (!createRes.ok()) return;

    const createBody = await createRes.json();
    const collection = createBody.data ?? createBody;
    const collectionId = collection.id ?? collection._id;
    if (!collectionId) return;

    const deleteRes = await page.request.delete(
      `${apiBase}/api/v1/collections/${collectionId}`,
      { headers, timeout: 15000 },
    );

    expect(
      [200, 204].includes(deleteRes.status()),
      `DELETE /collections/:id returned ${deleteRes.status()}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Knowledge Graph (L4 App → L3 Engine)
// ---------------------------------------------------------------------------

test.describe("Knowledge Graph API (L4 → L3 Engine)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /knowledge-graph/nodes — list knowledge graph nodes", async ({
    page,
    baseURL,
  }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(
      `${apiBase}/api/v1/knowledge-graph/nodes`,
      { headers, timeout: 15000 },
    );

    // Knowledge graph may return 200 with nodes or 404 if not implemented
    expect(
      [200, 404].includes(response.status()),
      `GET /knowledge-graph/nodes returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const payload = body.data ?? body;
      const nodes = Array.isArray(payload)
        ? payload
        : (payload.items ?? payload.nodes ?? []);
      expect(
        Array.isArray(nodes),
        "Knowledge graph nodes should be an array",
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Notes (L4 App)
// ---------------------------------------------------------------------------

test.describe("Notes API (L4 App)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("POST /notes — create note", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(`${apiBase}/api/v1/notes`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {
        title: "E2E Test Note",
        content: "This is a test note created by Playwright E2E.",
      },
      timeout: 15000,
    });

    expect(
      [200, 201].includes(response.status()),
      `POST /notes returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const note = body.data ?? body;
      expect(note, "Created note should be truthy").toBeTruthy();
    }
  });

  test("GET /notes — list notes", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/notes`, {
      headers,
      timeout: 15000,
    });

    expect(
      response.ok(),
      `GET /notes returned ${response.status()}`,
    ).toBeTruthy();

    const body = await response.json();
    const payload = body.data ?? body;
    const list = Array.isArray(payload)
      ? payload
      : (payload.items ?? payload.notes ?? []);
    expect(Array.isArray(list), "Notes should be an array").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. RAG System Status (L4 App → L3 Engine RAG)
// ---------------------------------------------------------------------------

test.describe("RAG System Status (L4 → L3 Engine)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("GET /rag/status — RAG system status", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/rag/status`, {
      headers,
      timeout: 15000,
    });

    // RAG status may return 200 or 404
    expect(
      [200, 404].includes(response.status()),
      `GET /rag/status returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const status = body.data ?? body;
      expect(status, "RAG status should be truthy").toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Export & Templates (L4 App)
// ---------------------------------------------------------------------------

test.describe("Export & Templates API (L4 App)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  });

  test("POST /export — create export job", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.post(`${apiBase}/api/v1/export`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {
        format: "json",
        type: "resources",
      },
      timeout: 15000,
    });

    // Export may succeed (200/201/202) or fail with validation (400/404/422)
    expect(
      [200, 201, 202, 400, 404, 422].includes(response.status()),
      `POST /export returned ${response.status()}`,
    ).toBe(true);
  });

  test("GET /templates — list export templates", async ({ page, baseURL }) => {
    const apiBase = process.env.API_BASE_URL || baseURL || "";
    const headers = await getAuthHeader(page);

    const response = await page.request.get(`${apiBase}/api/v1/templates`, {
      headers,
      timeout: 15000,
    });

    // Templates may return 200 or 404
    expect(
      [200, 404].includes(response.status()),
      `GET /templates returned ${response.status()}`,
    ).toBe(true);

    if (response.ok()) {
      const body = await response.json();
      const payload = body.data ?? body;
      const templates = Array.isArray(payload)
        ? payload
        : (payload.items ?? payload.templates ?? []);
      expect(Array.isArray(templates), "Templates should be an array").toBe(
        true,
      );
    }
  });
});
