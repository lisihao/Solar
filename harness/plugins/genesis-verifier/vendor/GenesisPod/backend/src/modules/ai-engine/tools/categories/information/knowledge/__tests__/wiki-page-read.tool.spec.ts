/**
 * WikiPageReadTool — 单测（W4 v2.0 rebuild 2026-05-12）
 *
 * 覆盖：
 *  1. 元数据 / validateInput 边界
 *  2. doExecute:
 *     - augmentor 未绑定（wiki 模块未加载）→ success:true + page:null + note
 *     - userId 缺失 → success:false + error
 *     - augmentor.getWikiPage 返回 null → success:true + page:null + note
 *     - augmentor.getWikiPage 抛 → success:false + error message
 *     - 正常返回 → success:true + page payload + outbound/backlinks 透传
 */

import { WikiPageReadTool } from "../wiki-page-read.tool";
import { ToolContext } from "../../../../abstractions/tool.interface";
import type {
  IKbQueryAugmentor,
  WikiPageRead,
} from "@/modules/ai-engine/rag/abstractions/kb-query-augmentor.interface";

type MockAugmentor = {
  simpleQuery: jest.MockedFunction<IKbQueryAugmentor["simpleQuery"]>;
  getWikiPage: jest.MockedFunction<
    NonNullable<IKbQueryAugmentor["getWikiPage"]>
  >;
};

function buildContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "wiki-page-read",
    userId: "user-1",
    createdAt: new Date(),
    ...overrides,
  };
}

function makePage(overrides: Partial<WikiPageRead> = {}): WikiPageRead {
  return {
    knowledgeBaseId: "kb-1",
    slug: "react-hooks",
    locale: "zh",
    title: "React Hooks",
    category: "ENTITY",
    body: "React Hooks 是 v16.8 引入的能力。see [[functional-components]]",
    oneLiner: "React 函数组件的状态钩子",
    outboundLinks: ["functional-components"],
    backlinks: ["react-overview"],
    updatedAt: "2026-05-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("WikiPageReadTool", () => {
  describe("metadata", () => {
    it("ships the canonical tool surface", () => {
      const tool = new WikiPageReadTool(undefined);
      expect(tool.id).toBe("wiki-page-read");
      expect(tool.category).toBe("information");
      expect(tool.sideEffect).toBe("none");
      expect(tool.tags).toEqual(
        expect.arrayContaining(["knowledge", "wiki", "cross-link"]),
      );
    });
  });

  describe("validateInput", () => {
    const tool = new WikiPageReadTool(undefined);

    it("rejects empty knowledgeBaseId", () => {
      expect(tool.validateInput({ knowledgeBaseId: "", slug: "x" })).toBe(
        false,
      );
    });
    it("rejects empty slug", () => {
      expect(tool.validateInput({ knowledgeBaseId: "kb", slug: "" })).toBe(
        false,
      );
    });
    it("rejects slug > 200 chars", () => {
      expect(
        tool.validateInput({ knowledgeBaseId: "kb", slug: "a".repeat(201) }),
      ).toBe(false);
    });
    it("rejects invalid locale", () => {
      expect(
        tool.validateInput({
          knowledgeBaseId: "kb",
          slug: "x",
          locale: "fr" as unknown as "zh",
        }),
      ).toBe(false);
    });
    it("accepts zh / en / undefined locale", () => {
      expect(tool.validateInput({ knowledgeBaseId: "kb", slug: "x" })).toBe(
        true,
      );
      expect(
        tool.validateInput({ knowledgeBaseId: "kb", slug: "x", locale: "zh" }),
      ).toBe(true);
      expect(
        tool.validateInput({ knowledgeBaseId: "kb", slug: "x", locale: "en" }),
      ).toBe(true);
    });
  });

  describe("doExecute", () => {
    it("returns page:null + note when augmentor not bound", async () => {
      const tool = new WikiPageReadTool(undefined);
      const result = await tool.execute(
        { knowledgeBaseId: "kb-1", slug: "x" },
        buildContext(),
      );
      expect(result.success).toBe(true);
      expect(result.data?.page).toBeNull();
      expect(result.data?.note).toContain("wiki integration not bound");
    });

    it("returns error when userId missing in context", async () => {
      const augmentor: MockAugmentor = {
        simpleQuery: jest.fn(),
        getWikiPage: jest.fn(),
      };
      const tool = new WikiPageReadTool(augmentor);
      const result = await tool.execute(
        { knowledgeBaseId: "kb-1", slug: "x" },
        buildContext({ userId: undefined }),
      );
      // BaseTool wraps non-throwing return into ToolResult.success=true + data.
      // Domain-level "success" flag lives on `data.success`.
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("userId missing");
    });

    it("returns page:null + note when augmentor returns null (page missing / access denied)", async () => {
      const augmentor: MockAugmentor = {
        simpleQuery: jest.fn(),
        getWikiPage: jest.fn().mockResolvedValue(null),
      };
      const tool = new WikiPageReadTool(augmentor);
      const result = await tool.execute(
        { knowledgeBaseId: "kb-1", slug: "missing-slug" },
        buildContext(),
      );
      expect(result.success).toBe(true);
      expect(result.data?.page).toBeNull();
      expect(result.data?.note).toContain("no wiki page");
      expect(augmentor.getWikiPage).toHaveBeenCalledWith(
        "user-1",
        "kb-1",
        "missing-slug",
        "zh",
      );
    });

    it("forwards locale=en when caller asks for english", async () => {
      const augmentor: MockAugmentor = {
        simpleQuery: jest.fn(),
        getWikiPage: jest.fn().mockResolvedValue(makePage({ locale: "en" })),
      };
      const tool = new WikiPageReadTool(augmentor);
      await tool.execute(
        { knowledgeBaseId: "kb-1", slug: "react-hooks", locale: "en" },
        buildContext(),
      );
      expect(augmentor.getWikiPage).toHaveBeenCalledWith(
        "user-1",
        "kb-1",
        "react-hooks",
        "en",
      );
    });

    it("returns the full page payload on happy path", async () => {
      const page = makePage();
      const augmentor: MockAugmentor = {
        simpleQuery: jest.fn(),
        getWikiPage: jest.fn().mockResolvedValue(page),
      };
      const tool = new WikiPageReadTool(augmentor);
      const result = await tool.execute(
        { knowledgeBaseId: "kb-1", slug: "react-hooks" },
        buildContext(),
      );
      expect(result.success).toBe(true);
      expect(result.data?.page).toEqual(page);
      // 关键：outboundLinks 一定透传，agent 才能沿 [[slug]] 走深度
      expect(result.data?.page?.outboundLinks).toEqual([
        "functional-components",
      ]);
      expect(result.data?.page?.backlinks).toEqual(["react-overview"]);
    });

    it("returns success:false + error when augmentor throws", async () => {
      const augmentor: MockAugmentor = {
        simpleQuery: jest.fn(),
        getWikiPage: jest.fn().mockRejectedValue(new Error("db down")),
      };
      const tool = new WikiPageReadTool(augmentor);
      const result = await tool.execute(
        { knowledgeBaseId: "kb-1", slug: "x" },
        buildContext(),
      );
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("db down");
    });
  });
});
