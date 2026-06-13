import { BrowserContextTool } from "../browser-context.tool";
import { BrowserService } from "@/common/browser/browser.service";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock factories
// ============================================================================

function createMockPage() {
  return {
    url: jest.fn().mockReturnValue("about:blank"),
    goto: jest.fn().mockResolvedValue({
      url: () => "https://example.com/landed",
    }),
    click: jest.fn().mockResolvedValue(undefined),
    type: jest.fn().mockResolvedValue(undefined),
    keyboard: {
      press: jest.fn().mockResolvedValue(undefined),
    },
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    waitForFunction: jest.fn().mockResolvedValue({
      jsonValue: () => Promise.resolve({ ready: true }),
    }),
    screenshot: jest.fn().mockResolvedValue(Buffer.from("PNGDATA", "utf-8")),
    evaluate: jest.fn().mockResolvedValue({ ok: true }),
  };
}

function createMockContext(page: ReturnType<typeof createMockPage>) {
  return {
    pages: jest.fn().mockResolvedValue([page]),
    cookies: jest
      .fn()
      .mockResolvedValue([
        { name: "session", value: "abc", domain: ".example.com" },
      ]),
    setCookie: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockBrowserService(
  opts: {
    context?: ReturnType<typeof createMockContext> | null;
  } = {},
) {
  const ctx = opts.context !== undefined ? opts.context : null;
  return {
    createPage: jest.fn().mockResolvedValue({
      url: () => "https://example.com",
    }),
    closeContext: jest.fn().mockResolvedValue(undefined),
    getContext: jest.fn().mockResolvedValue(ctx),
  };
}

function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "browser-context",
    userId: "user-1",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("BrowserContextTool", () => {
  describe("metadata", () => {
    it("has stable id, category, sideEffect", () => {
      const tool = new BrowserContextTool(
        createMockBrowserService() as unknown as BrowserService,
      );
      expect(tool.id).toBe("browser-context");
      expect(tool.category).toBe("automation");
      expect(tool.sideEffect).toBe("idempotent");
      expect(tool.tags).toContain("puppeteer");
    });
  });

  describe("validateInput", () => {
    const tool = new BrowserContextTool(
      createMockBrowserService() as unknown as BrowserService,
    );

    it("rejects missing contextId", () => {
      expect(tool.validateInput({ contextId: "", op: "goto", url: "x" })).toBe(
        false,
      );
    });

    it("rejects goto without url", () => {
      expect(tool.validateInput({ contextId: "c1", op: "goto" })).toBe(false);
    });

    it("rejects click without selector", () => {
      expect(tool.validateInput({ contextId: "c1", op: "click" })).toBe(false);
    });

    it("rejects type without selector or text", () => {
      expect(
        tool.validateInput({ contextId: "c1", op: "type", selector: "#a" }),
      ).toBe(false);
      expect(
        tool.validateInput({ contextId: "c1", op: "type", text: "hi" }),
      ).toBe(false);
    });

    it("rejects press without key", () => {
      expect(tool.validateInput({ contextId: "c1", op: "press" })).toBe(false);
    });

    it("rejects evaluate without fnSource", () => {
      expect(tool.validateInput({ contextId: "c1", op: "evaluate" })).toBe(
        false,
      );
    });

    it("rejects setCookies with empty cookies", () => {
      expect(
        tool.validateInput({ contextId: "c1", op: "setCookies", cookies: [] }),
      ).toBe(false);
    });

    it("accepts well-formed openPage / closePage / getCookies", () => {
      expect(tool.validateInput({ contextId: "c1", op: "openPage" })).toBe(
        true,
      );
      expect(tool.validateInput({ contextId: "c1", op: "closePage" })).toBe(
        true,
      );
      expect(tool.validateInput({ contextId: "c1", op: "getCookies" })).toBe(
        true,
      );
    });

    it("accepts well-formed goto / click / type / press / evaluate", () => {
      expect(
        tool.validateInput({
          contextId: "c1",
          op: "goto",
          url: "https://x.test",
        }),
      ).toBe(true);
      expect(
        tool.validateInput({ contextId: "c1", op: "click", selector: "#go" }),
      ).toBe(true);
      expect(
        tool.validateInput({
          contextId: "c1",
          op: "type",
          selector: "#i",
          text: "hi",
        }),
      ).toBe(true);
      expect(
        tool.validateInput({ contextId: "c1", op: "press", key: "Enter" }),
      ).toBe(true);
      expect(
        tool.validateInput({
          contextId: "c1",
          op: "evaluate",
          fnSource: "1+1",
        }),
      ).toBe(true);
    });
  });

  describe("openPage / closePage", () => {
    it("openPage delegates to BrowserService.createPage", async () => {
      const svc = createMockBrowserService();
      const tool = new BrowserContextTool(svc as unknown as BrowserService);

      const res = await tool.execute(
        { contextId: "ctx-A", op: "openPage" },
        createToolContext(),
      );

      expect(res.success).toBe(true);
      expect(svc.createPage).toHaveBeenCalledWith("ctx-A");
      expect(res.data?.op).toBe("openPage");
      expect(res.data?.contextId).toBe("ctx-A");
    });

    it("closePage delegates to BrowserService.closeContext", async () => {
      const svc = createMockBrowserService();
      const tool = new BrowserContextTool(svc as unknown as BrowserService);

      const res = await tool.execute(
        { contextId: "ctx-A", op: "closePage" },
        createToolContext(),
      );

      expect(res.success).toBe(true);
      expect(svc.closeContext).toHaveBeenCalledWith("ctx-A");
    });
  });

  describe("page ops require existing context", () => {
    it("returns error when context not found", async () => {
      const svc = createMockBrowserService({ context: null });
      const tool = new BrowserContextTool(svc as unknown as BrowserService);

      const res = await tool.execute(
        { contextId: "missing", op: "click", selector: "#x" },
        createToolContext(),
      );

      expect(res.success).toBe(false);
      expect(res.error?.message).toMatch(/Browser context not found/);
    });

    it("returns error when context has no pages", async () => {
      const page = createMockPage();
      const ctx = createMockContext(page);
      ctx.pages.mockResolvedValueOnce([]);
      const svc = createMockBrowserService({ context: ctx });
      const tool = new BrowserContextTool(svc as unknown as BrowserService);

      const res = await tool.execute(
        { contextId: "ctx-A", op: "click", selector: "#x" },
        createToolContext(),
      );

      expect(res.success).toBe(false);
      expect(res.error?.message).toMatch(/No page in browser context/);
    });
  });

  describe("page ops happy path", () => {
    let page: ReturnType<typeof createMockPage>;
    let ctx: ReturnType<typeof createMockContext>;
    let svc: ReturnType<typeof createMockBrowserService>;
    let tool: BrowserContextTool;

    beforeEach(() => {
      page = createMockPage();
      ctx = createMockContext(page);
      svc = createMockBrowserService({ context: ctx });
      tool = new BrowserContextTool(svc as unknown as BrowserService);
    });

    it("goto returns landed URL", async () => {
      const res = await tool.execute(
        {
          contextId: "ctx-A",
          op: "goto",
          url: "https://x.test",
          waitUntil: "networkidle0",
          timeout: 5_000,
        },
        createToolContext(),
      );
      expect(res.success).toBe(true);
      expect(page.goto).toHaveBeenCalledWith("https://x.test", {
        waitUntil: "networkidle0",
        timeout: 5_000,
      });
      expect(res.data?.url).toBe("https://example.com/landed");
    });

    it("click invokes page.click", async () => {
      const res = await tool.execute(
        { contextId: "ctx-A", op: "click", selector: "#submit" },
        createToolContext(),
      );
      expect(res.success).toBe(true);
      expect(page.click).toHaveBeenCalledWith("#submit");
    });

    it("type invokes page.type", async () => {
      const res = await tool.execute(
        {
          contextId: "ctx-A",
          op: "type",
          selector: "#title",
          text: "hello",
        },
        createToolContext(),
      );
      expect(res.success).toBe(true);
      expect(page.type).toHaveBeenCalledWith("#title", "hello");
    });

    it("press invokes keyboard.press", async () => {
      const res = await tool.execute(
        { contextId: "ctx-A", op: "press", key: "Enter" },
        createToolContext(),
      );
      expect(res.success).toBe(true);
      expect(page.keyboard.press).toHaveBeenCalledWith("Enter");
    });

    it("waitForSelector invokes page.waitForSelector with timeout", async () => {
      const res = await tool.execute(
        {
          contextId: "ctx-A",
          op: "waitForSelector",
          selector: ".loaded",
          timeout: 2_000,
        },
        createToolContext(),
      );
      expect(res.success).toBe(true);
      expect(page.waitForSelector).toHaveBeenCalledWith(".loaded", {
        timeout: 2_000,
      });
    });

    it("waitForFunction returns jsonValue from handle", async () => {
      const res = await tool.execute(
        {
          contextId: "ctx-A",
          op: "waitForFunction",
          fnSource: "window.READY === true",
        },
        createToolContext(),
      );
      expect(res.success).toBe(true);
      expect(res.data?.result).toEqual({ ready: true });
    });

    it("getCookies reads from BrowserContext.cookies", async () => {
      const res = await tool.execute(
        { contextId: "ctx-A", op: "getCookies" },
        createToolContext(),
      );
      expect(res.success).toBe(true);
      expect(res.data?.cookies).toHaveLength(1);
      expect(res.data?.cookies?.[0]).toMatchObject({
        name: "session",
        value: "abc",
      });
    });

    it("setCookies writes via BrowserContext.setCookie", async () => {
      const cookies = [{ name: "auth", value: "tok", domain: ".x.test" }];
      const res = await tool.execute(
        { contextId: "ctx-A", op: "setCookies", cookies },
        createToolContext(),
      );
      expect(res.success).toBe(true);
      expect(ctx.setCookie).toHaveBeenCalledWith(cookies[0]);
    });

    it("screenshot returns base64 string", async () => {
      const res = await tool.execute(
        { contextId: "ctx-A", op: "screenshot" },
        createToolContext(),
      );
      expect(res.success).toBe(true);
      expect(res.data?.screenshotBase64).toBe(
        Buffer.from("PNGDATA", "utf-8").toString("base64"),
      );
    });

    it("evaluate returns page.evaluate result", async () => {
      page.evaluate.mockResolvedValueOnce({ count: 42 });
      const res = await tool.execute(
        {
          contextId: "ctx-A",
          op: "evaluate",
          fnSource: "document.querySelectorAll('img').length",
        },
        createToolContext(),
      );
      expect(res.success).toBe(true);
      expect(res.data?.result).toEqual({ count: 42 });
    });

    it("evaluate forwards args to page.evaluate", async () => {
      page.evaluate.mockResolvedValueOnce("ok");
      await tool.execute(
        {
          contextId: "ctx-A",
          op: "evaluate",
          fnSource: "(x, y) => x + y",
          args: [1, 2],
        },
        createToolContext(),
      );
      expect(page.evaluate).toHaveBeenCalledWith("(x, y) => x + y", 1, 2);
    });
  });

  describe("fnSource length guard (P0-2 mitigation)", () => {
    const tool = new BrowserContextTool(
      createMockBrowserService() as unknown as BrowserService,
    );

    it("rejects evaluate fnSource > 8192 chars", () => {
      const huge = "a".repeat(8193);
      expect(
        tool.validateInput({
          contextId: "c1",
          op: "evaluate",
          fnSource: huge,
        }),
      ).toBe(false);
    });

    it("rejects waitForFunction fnSource > 8192 chars", () => {
      const huge = "x".repeat(9000);
      expect(
        tool.validateInput({
          contextId: "c1",
          op: "waitForFunction",
          fnSource: huge,
        }),
      ).toBe(false);
    });

    it("accepts evaluate fnSource at exactly 8192 chars", () => {
      const max = "a".repeat(8192);
      expect(
        tool.validateInput({
          contextId: "c1",
          op: "evaluate",
          fnSource: max,
        }),
      ).toBe(true);
    });
  });

  describe("audit log on evaluate / waitForFunction (P0-2 mitigation)", () => {
    let page: ReturnType<typeof createMockPage>;
    let ctx: ReturnType<typeof createMockContext>;
    let svc: ReturnType<typeof createMockBrowserService>;
    let tool: BrowserContextTool;
    let loggerWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      page = createMockPage();
      ctx = createMockContext(page);
      svc = createMockBrowserService({ context: ctx });
      tool = new BrowserContextTool(svc as unknown as BrowserService);
      loggerWarnSpy = jest
        .spyOn(
          (tool as unknown as { logger: { warn: jest.Mock } }).logger,
          "warn",
        )
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      loggerWarnSpy.mockRestore();
    });

    it("evaluate emits audit log with hash + snippet", async () => {
      page.evaluate.mockResolvedValueOnce({ ok: 1 });
      await tool.execute(
        {
          contextId: "ctx-A",
          op: "evaluate",
          fnSource: "document.cookie",
        },
        createToolContext(),
      );
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
      const msg = loggerWarnSpy.mock.calls[0][0] as string;
      expect(msg).toMatch(/\[audit\] evaluate fnSource sha256=/);
      expect(msg).toMatch(/len=15/);
      expect(msg).toMatch(/snippet="document\.cookie"/);
    });

    it("waitForFunction emits audit log distinct from evaluate", async () => {
      await tool.execute(
        {
          contextId: "ctx-A",
          op: "waitForFunction",
          fnSource: "window.READY",
        },
        createToolContext(),
      );
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
      const msg = loggerWarnSpy.mock.calls[0][0] as string;
      expect(msg).toMatch(/\[audit\] waitForFunction fnSource sha256=/);
    });

    it("does NOT emit audit log for non-evaluate ops", async () => {
      await tool.execute(
        { contextId: "ctx-A", op: "click", selector: "#x" },
        createToolContext(),
      );
      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });
  });
});
