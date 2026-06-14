/**
 * WikiSearchTool — 单测 (gap #3 v2.0 rebuild 2026-05-12)
 *
 * 覆盖：
 *  1. 元数据 + validateInput 边界
 *  2. augmentor 未绑定 → success:true + 空 + note
 *  3. wiki-only 过滤：augmentor 混 chunk + wiki，工具只回 wiki
 *  4. 全 chunk 命中 → 空 results + note
 *  5. augmentor throw → success:false + error
 */

import { WikiSearchTool } from "../wiki-search.tool";
import { ToolContext } from "../../../../abstractions/tool.interface";
import type { IKbQueryAugmentor } from "@/modules/ai-engine/rag/abstractions/kb-query-augmentor.interface";
import type { SearchResult } from "@/modules/ai-engine/rag/pipeline/rag-pipeline.interface";

type MockAugmentor = {
  simpleQuery: jest.MockedFunction<IKbQueryAugmentor["simpleQuery"]>;
};

function ctx(): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "wiki-search",
    userId: "user-1",
    createdAt: new Date(),
  };
}

function makeHit(
  id: string,
  source: "wiki" | "chunk",
  score = 1,
): SearchResult {
  return {
    childChunkId: `cid-${id}`,
    parentChunkId: `pid-${id}`,
    documentId: `doc-${id}`,
    content: `body for ${id}`,
    parentContent: `parent for ${id}`,
    score,
    metadata: {
      source,
      slug: source === "wiki" ? `slug-${id}` : undefined,
      kbId: source === "wiki" ? "kb-1" : undefined,
      title: source === "wiki" ? `Title ${id}` : undefined,
    },
  };
}

describe("WikiSearchTool", () => {
  describe("metadata", () => {
    it("ships canonical tool id + category", () => {
      const tool = new WikiSearchTool(undefined);
      expect(tool.id).toBe("wiki-search");
      expect(tool.category).toBe("information");
      expect(tool.sideEffect).toBe("none");
      expect(tool.tags).toEqual(
        expect.arrayContaining(["knowledge", "wiki", "internal"]),
      );
    });
  });

  describe("validateInput", () => {
    const tool = new WikiSearchTool(undefined);

    it("rejects empty query / empty kb list / topK out of range", () => {
      expect(tool.validateInput({ query: "", knowledgeBaseIds: ["kb"] })).toBe(
        false,
      );
      expect(tool.validateInput({ query: "x", knowledgeBaseIds: [] })).toBe(
        false,
      );
      expect(
        tool.validateInput({ query: "x", knowledgeBaseIds: ["kb"], topK: 99 }),
      ).toBe(false);
    });

    it("accepts well-formed input", () => {
      expect(
        tool.validateInput({ query: "react", knowledgeBaseIds: ["kb-1"] }),
      ).toBe(true);
    });
  });

  describe("doExecute", () => {
    it("returns empty + note when augmentor not bound", async () => {
      const tool = new WikiSearchTool(undefined);
      const result = await tool.execute(
        { query: "x", knowledgeBaseIds: ["kb-1"] },
        ctx(),
      );
      expect(result.data?.success).toBe(true);
      expect(result.data?.results).toEqual([]);
      expect(result.data?.note).toContain("wiki integration not bound");
    });

    it("filters chunk hits out and returns wiki-only", async () => {
      const augmentor: MockAugmentor = {
        simpleQuery: jest
          .fn()
          .mockResolvedValue([
            makeHit("a", "wiki", 0.9),
            makeHit("b", "chunk", 0.8),
            makeHit("c", "wiki", 0.7),
          ]),
      };
      const tool = new WikiSearchTool(augmentor as IKbQueryAugmentor);
      const result = await tool.execute(
        { query: "react", knowledgeBaseIds: ["kb-1"] },
        ctx(),
      );
      expect(result.data?.success).toBe(true);
      expect(result.data?.totalResults).toBe(2);
      expect(result.data?.results.map((r) => r.slug)).toEqual([
        "slug-a",
        "slug-c",
      ]);
      // chunk hit (slug undefined) must NOT leak through
      expect(result.data?.results.some((r) => !r.slug)).toBe(false);
    });

    it("returns empty + note when all augmentor hits are chunk (no wiki confidence)", async () => {
      const augmentor: MockAugmentor = {
        simpleQuery: jest
          .fn()
          .mockResolvedValue([
            makeHit("a", "chunk", 0.9),
            makeHit("b", "chunk", 0.8),
          ]),
      };
      const tool = new WikiSearchTool(augmentor as IKbQueryAugmentor);
      const result = await tool.execute(
        { query: "react", knowledgeBaseIds: ["kb-1"] },
        ctx(),
      );
      expect(result.data?.success).toBe(true);
      expect(result.data?.results).toEqual([]);
      expect(result.data?.note).toContain("no wiki hits");
    });

    it("returns success:false + error when augmentor throws", async () => {
      const augmentor: MockAugmentor = {
        simpleQuery: jest.fn().mockRejectedValue(new Error("db down")),
      };
      const tool = new WikiSearchTool(augmentor as IKbQueryAugmentor);
      const result = await tool.execute(
        { query: "react", knowledgeBaseIds: ["kb-1"] },
        ctx(),
      );
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("db down");
    });

    it("truncates long content to 600 chars + ellipsis", async () => {
      const longBody = "x".repeat(900);
      const augmentor: MockAugmentor = {
        simpleQuery: jest.fn().mockResolvedValue([
          {
            childChunkId: "a",
            parentChunkId: "a",
            documentId: "doc-a",
            content: longBody,
            parentContent: longBody,
            score: 1,
            metadata: { source: "wiki", slug: "long", kbId: "kb-1" },
          },
        ]),
      };
      const tool = new WikiSearchTool(augmentor as IKbQueryAugmentor);
      const result = await tool.execute(
        { query: "x", knowledgeBaseIds: ["kb-1"] },
        ctx(),
      );
      expect(result.data?.results[0].excerpt.length).toBe(601); // 600 + 1 ellipsis char
      expect(result.data?.results[0].excerpt.endsWith("…")).toBe(true);
    });
  });
});
