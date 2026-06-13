/**
 * YouTubeSearchTool Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { YouTubeSearchTool } from "../youtube-search.tool";
import { ToolRegistry } from "../../../../registry/tool.registry";
import { ToolContext } from "../../../../abstractions/tool.interface";

function makeContext(): ToolContext {
  return {
    executionId: "exec-yt-001",
    toolId: "youtube-search",
    createdAt: new Date(),
  };
}

function makeWebSearch(
  results: Array<{ title: string; url: string; content?: string }> = [],
  overrides: { success?: boolean } = {},
) {
  return {
    execute: jest.fn(async () =>
      overrides.success === false
        ? { success: false, error: { message: "down" }, data: null }
        : {
            success: true,
            data: { results, success: true, totalResults: results.length },
          },
    ),
  };
}

describe("YouTubeSearchTool", () => {
  let tool: YouTubeSearchTool;
  let registryMock: { tryGet: jest.Mock };

  beforeEach(async () => {
    registryMock = { tryGet: jest.fn() };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        YouTubeSearchTool,
        { provide: ToolRegistry, useValue: registryMock },
      ],
    }).compile();
    tool = moduleRef.get(YouTubeSearchTool);
  });

  describe("metadata", () => {
    it("has id 'youtube-search'", () => {
      expect(tool.id).toBe("youtube-search");
    });
    it("has 'information' category and video tags", () => {
      expect(tool.category).toBe("information");
      expect(tool.tags).toContain("video");
      expect(tool.tags).toContain("youtube");
    });
  });

  describe("success path", () => {
    it("queries all 3 platforms by default", async () => {
      const ws = makeWebSearch([]);
      registryMock.tryGet.mockReturnValue(ws);
      await tool.execute({ query: "GPT-5 demo" }, makeContext());
      const q = ws.execute.mock.calls[0][0].query as string;
      expect(q).toContain("site:youtube.com");
      expect(q).toContain("site:vimeo.com");
      expect(q).toContain("site:bilibili.com");
      expect(q).toContain("GPT-5 demo");
    });

    it("respects custom platforms subset", async () => {
      const ws = makeWebSearch([]);
      registryMock.tryGet.mockReturnValue(ws);
      await tool.execute({ query: "x", platforms: ["youtube"] }, makeContext());
      const q = ws.execute.mock.calls[0][0].query as string;
      expect(q).toContain("site:youtube.com");
      expect(q).not.toContain("site:vimeo.com");
      expect(q).not.toContain("site:bilibili.com");
    });

    it("maps results to VideoItem with platform identification", async () => {
      const ws = makeWebSearch([
        {
          title: "Tutorial",
          url: "https://www.youtube.com/watch?v=abc",
          content: "yt content",
        },
        {
          title: "Talk",
          url: "https://vimeo.com/123456",
          content: "vimeo content",
        },
        {
          title: "BV",
          url: "https://www.bilibili.com/video/BVxyz",
          content: "bili content",
        },
      ]);
      registryMock.tryGet.mockReturnValue(ws);
      const r = await tool.execute({ query: "x" }, makeContext());
      const items = (r.data as { items: Array<Record<string, unknown>> }).items;
      expect(items[0].platform).toBe("YouTube");
      expect(items[1].platform).toBe("Vimeo");
      expect(items[2].platform).toBe("Bilibili");
    });
  });

  describe("error path", () => {
    it("returns success:false on unknown platforms", async () => {
      registryMock.tryGet.mockReturnValue(makeWebSearch());
      const r = await tool.execute(
        { query: "x", platforms: ["bogus"] },
        makeContext(),
      );
      const data = r.data as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain("Unknown platforms");
    });

    it("returns success:false when web-search not registered", async () => {
      registryMock.tryGet.mockReturnValue(undefined);
      const r = await tool.execute({ query: "x" }, makeContext());
      const data = r.data as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain("web-search tool not registered");
    });

    it("returns success:false when web-search fails", async () => {
      registryMock.tryGet.mockReturnValue(
        makeWebSearch([], { success: false }),
      );
      const r = await tool.execute({ query: "x" }, makeContext());
      const data = r.data as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });
  });
});

