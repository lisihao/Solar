import { test, expect } from "@playwright/test";

/**
 * Miscellaneous Pages — E2E Tests
 *
 * Home page, knowledge graph, RAG, notion integration
 */

// ---------------------------------------------------------------------------
// 1. Home Page
// ---------------------------------------------------------------------------

test.describe("Home Page (/)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("main content is visible", async ({ page }) => {
    const body = page.locator("body");
    await expect(body).toBeVisible();

    // Home page should have some meaningful content
    const mainContent = page.locator(
      "main, [class*='main'], [class*='home'], [class*='dashboard']",
    );
    const heading = page.locator("h1, h2");

    const hasContent = (await mainContent.count()) > 0;
    const hasHeading = (await heading.count()) > 0;

    expect(
      hasContent || hasHeading,
      "Home page should show main content or heading",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Knowledge Graph Page
// ---------------------------------------------------------------------------

test.describe("Knowledge Graph (/knowledge-graph)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/knowledge-graph", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
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
});

// ---------------------------------------------------------------------------
// 3. RAG Page
// ---------------------------------------------------------------------------

test.describe("RAG Page (/rag)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/rag", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
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
});

// ---------------------------------------------------------------------------
// 4. Notion Integration Page
// ---------------------------------------------------------------------------

test.describe("Notion Page (/notion/:pageId)", () => {
  test("page renders without crash for test id", async ({ page }) => {
    await page.goto("/notion/test-page-id", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    const appError = page.getByText(/application error/i);
    await expect(appError).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Library Knowledge Graph
// ---------------------------------------------------------------------------

test.describe("Library Knowledge Graph (/library/knowledge-graph)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library/knowledge-graph", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. AI Ask Page
// ---------------------------------------------------------------------------

test.describe("AI Ask (/ai-ask)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-ask", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  });

  test("page loads without errors", async ({ page }) => {
    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).not.toBeVisible();
  });

  test("chat input or question interface renders", async ({ page }) => {
    const chatInput = page.locator(
      "input, textarea, [class*='chat'], [class*='input'], [class*='ask']",
    );
    const heading = page.locator("h1, h2");

    const hasInput = (await chatInput.count()) > 0;
    const hasHeading = (await heading.count()) > 0;

    expect(
      hasInput || hasHeading,
      "AI Ask page should show chat input or heading",
    ).toBe(true);
  });
});
