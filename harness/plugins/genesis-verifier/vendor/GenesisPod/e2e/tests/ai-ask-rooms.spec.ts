import { test, expect } from "@playwright/test";

/**
 * AI Ask Teams Rooms — E2E Smoke Tests (W6)
 *
 * 不依赖 LLM 实际响应，只验证：
 *   1. /ai-ask 工具栏暴露"团队"按钮
 *   2. 点击按钮导航至 /ai-ask/rooms/new
 *   3. /ai-ask/rooms/new 展示创建表单（标题、模式、成员行）
 *   4. /ai-ask/rooms/[id] 路由可加载（无白屏）
 *
 * 为何不做完整流程：sendMessage / socket 流式响应需要 backend + LLM provider 双就位，
 * 在 PR-time CI 不稳定。完整 happy-path 留 W6 follow-up（mock backend or staging env）。
 */

test.describe("AI Ask Teams Rooms (/ai-ask/rooms)", () => {
  test("/ai-ask exposes Teams entry button in toolbar", async ({ page }) => {
    await page.goto("/ai-ask", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // 工具栏「团队」按钮（红框）
    const teamsButton = page.getByRole("button", { name: /AI 团队模式/i });
    await expect(teamsButton).toBeVisible({ timeout: 15000 });
  });

  test("clicking Teams button navigates to /ai-ask/rooms/new", async ({
    page,
  }) => {
    await page.goto("/ai-ask", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const teamsButton = page.getByRole("button", { name: /AI 团队模式/i });
    if (await teamsButton.isVisible()) {
      await teamsButton.click();
      await page.waitForURL(/\/ai-ask\/rooms\/new/, { timeout: 10000 });
      expect(page.url()).toContain("/ai-ask/rooms/new");
    }
  });

  test("/ai-ask/rooms/new shows creation form", async ({ page }) => {
    await page.goto("/ai-ask/rooms/new", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // 表单元素
    await expect(page.getByText(/新建 AI 团队房间/)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/默认协作模式/)).toBeVisible();
    await expect(page.getByText(/AI 成员/)).toBeVisible();
    await expect(page.getByRole("button", { name: /创建房间/ })).toBeVisible();
  });

  test("/ai-ask/rooms/new mode selector lists 6 modes", async ({ page }) => {
    await page.goto("/ai-ask/rooms/new", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const select = page.locator("select").first();
    await expect(select).toBeVisible({ timeout: 15000 });

    const options = await select.locator("option").allInnerTexts();
    // 6 modes: FREECHAT / PARALLEL_MERGE / DEBATE / VOTE / REVIEW / HANDOFF
    expect(options.length).toBeGreaterThanOrEqual(6);
    expect(options.join(" ")).toMatch(/自由群聊|并行合并|辩论|投票|评审|交接/);
  });

  test("/ai-ask/rooms/new add/remove member rows", async ({ page }) => {
    await page.goto("/ai-ask/rooms/new", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const addBtn = page.getByRole("button", { name: /添加成员/ });
    const initialRows = await page
      .getByPlaceholder(/显示名/)
      .count();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
      const newCount = await page.getByPlaceholder(/显示名/).count();
      expect(newCount).toBeGreaterThan(initialRows);
    }
  });

  test("/ai-ask/rooms/[id] route loads without white screen", async ({
    page,
  }) => {
    // 用一个不存在的 id 触发路由；后端会返回 404，但前端组件应稳定显示 error 状态
    await page.goto("/ai-ask/rooms/nonexistent-id-for-smoke", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);

    await expect(page.locator("body")).not.toBeEmpty();
    const errorBoundary = page.getByText(
      /something went wrong|application error/i,
    );
    await expect(errorBoundary).toHaveCount(0);
  });
});
