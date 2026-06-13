/**
 * SocialXSearchTool Unit Tests
 *
 * 隔离 ToolRegistry，验证 BaseTool 全 lifecycle：
 *   - metadata / 输入校验
 *   - 成功路径：site:x.com OR site:twitter.com 拼装 → web-search 委托 → domain 解析
 *   - 失败路径：web-search 缺席 / web-search 失败 / 异常抛出
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SocialXSearchTool } from "../social-x-search.tool";
import { ToolRegistry } from "../../../../registry/tool.registry";
import { ToolContext } from "../../../../abstractions/tool.interface";

function makeContext(): ToolContext {
  return {
    executionId: "exec-sx-001",
    toolId: "social-x-search",
    createdAt: new Date(),
  };
}

function makeWebSearchTool(
  results: Array<{
    title: string;
    url: string;
    content?: string;
    publishedDate?: string;
  }> = [],
  overrides: { success?: boolean; throwError?: Error } = {},
) {
  return {
    execute: jest.fn(async () => {
      if (overrides.throwError) throw overrides.throwError;
      return overrides.success === false
        ? { success: false, error: { message: "web-search down" }, data: null }
        : {
            success: true,
            data: { results, success: true, totalResults: results.length },
          };
    }),
  };
}

describe("SocialXSearchTool", () => {
  let tool: SocialXSearchTool;
  let registryMock: { tryGet: jest.Mock };

  beforeEach(async () => {
    registryMock = { tryGet: jest.fn() };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SocialXSearchTool,
        { provide: ToolRegistry, useValue: registryMock },
      ],
    }).compile();
    tool = moduleRef.get(SocialXSearchTool);
  });

  describe("metadata", () => {
    it("has id 'social-x-search'", () => {
      expect(tool.id).toBe("social-x-search");
    });
    it("has category 'information' and social tags", () => {
      expect(tool.category).toBe("information");
      expect(tool.tags).toContain("social");
      expect(tool.tags).toContain("x");
      expect(tool.tags).toContain("twitter");
    });
    it("requires 'query' input", () => {
      expect(tool.inputSchema.required).toContain("query");
    });
    it("declares no side effect", () => {
      expect(tool.sideEffect).toBe("none");
    });
  });

  describe("success path", () => {
    it("calls web-search with site:x.com OR site:twitter.com prefix", async () => {
      const webSearch = makeWebSearchTool([]);
      registryMock.tryGet.mockReturnValue(webSearch);

      await tool.execute({ query: "Anthropic Claude 4" }, makeContext());

      expect(webSearch.execute).toHaveBeenCalledTimes(1);
      const callArg = webSearch.execute.mock.calls[0][0];
      expect(callArg.query).toContain("site:x.com");
      expect(callArg.query).toContain("site:twitter.com");
      expect(callArg.query).toContain("Anthropic Claude 4");
      expect(callArg.numResults).toBe(10);
    });

    it("respects custom maxResults", async () => {
      const webSearch = makeWebSearchTool([]);
      registryMock.tryGet.mockReturnValue(webSearch);

      await tool.execute({ query: "GPT-5", maxResults: 5 }, makeContext());

      expect(webSearch.execute.mock.calls[0][0].numResults).toBe(5);
    });

    it("maps web-search results to SocialXItem with parsed domain", async () => {
      const webSearch = makeWebSearchTool([
        {
          title: "Sam tweets",
          url: "https://x.com/sama/status/123",
          content: "AGI when",
          publishedDate: "2026-04-25",
        },
        {
          title: "Old tweet",
          url: "https://twitter.com/elonmusk/status/456",
          content: "Mars",
        },
        { title: "No URL", url: "ill formed", content: "fallback domain" },
      ]);
      registryMock.tryGet.mockReturnValue(webSearch);

      const r = await tool.execute({ query: "AI" }, makeContext());
      expect(r.success).toBe(true);
      const items = (r.data as { items: Array<Record<string, unknown>> }).items;
      expect(items).toHaveLength(3);
      expect(items[0]).toMatchObject({
        title: "Sam tweets",
        url: "https://x.com/sama/status/123",
        snippet: "AGI when",
        publishedDate: "2026-04-25",
        domain: "x.com",
      });
      expect(items[1].domain).toBe("twitter.com");
      expect(items[2].domain).toBe("x.com"); // fallback when URL parse fails
    });
  });

  describe("error path", () => {
    it("returns success:false when web-search not registered", async () => {
      registryMock.tryGet.mockReturnValue(undefined);

      const r = await tool.execute({ query: "AI" }, makeContext());
      const data = r.data as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain("web-search tool not registered");
    });

    it("returns success:false when web-search fails", async () => {
      const webSearch = makeWebSearchTool([], { success: false });
      registryMock.tryGet.mockReturnValue(webSearch);

      const r = await tool.execute({ query: "AI" }, makeContext());
      const data = r.data as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain("web-search down");
    });

    it("returns success:false when web-search throws unexpectedly", async () => {
      const webSearch = makeWebSearchTool([], {
        throwError: new Error("Network down"),
      });
      registryMock.tryGet.mockReturnValue(webSearch);

      const r = await tool.execute({ query: "AI" }, makeContext());
      const data = r.data as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain("Network down");
    });
  });
});

