/**
 * JobSearchTool Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { JobSearchTool } from "../job-search.tool";
import { ToolRegistry } from "../../../../registry/tool.registry";
import { ToolContext } from "../../../../abstractions/tool.interface";

function makeContext(): ToolContext {
  return {
    executionId: "exec-job-001",
    toolId: "job-search",
    createdAt: new Date(),
  };
}

function makeWebSearch(
  results: Array<{ title: string; url: string; content?: string }> = [],
  overrides: { success?: boolean; throwError?: Error } = {},
) {
  return {
    execute: jest.fn(async () => {
      if (overrides.throwError) throw overrides.throwError;
      return overrides.success === false
        ? { success: false, error: { message: "down" }, data: null }
        : {
            success: true,
            data: { results, success: true, totalResults: results.length },
          };
    }),
  };
}

describe("JobSearchTool", () => {
  let tool: JobSearchTool;
  let registryMock: { tryGet: jest.Mock };

  beforeEach(async () => {
    registryMock = { tryGet: jest.fn() };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        JobSearchTool,
        { provide: ToolRegistry, useValue: registryMock },
      ],
    }).compile();
    tool = moduleRef.get(JobSearchTool);
  });

  describe("metadata", () => {
    it("has id 'job-search'", () => {
      expect(tool.id).toBe("job-search");
    });
    it("has 'information' category and job tags", () => {
      expect(tool.category).toBe("information");
      expect(tool.tags).toContain("jobs");
      expect(tool.tags).toContain("recruiting");
    });
    it("requires query input", () => {
      expect(tool.inputSchema.required).toContain("query");
    });
  });

  describe("success path", () => {
    it("queries all 5 platforms by default", async () => {
      const ws = makeWebSearch([]);
      registryMock.tryGet.mockReturnValue(ws);
      await tool.execute({ query: "AI engineer" }, makeContext());
      const q = ws.execute.mock.calls[0][0].query as string;
      expect(q).toContain("site:linkedin.com/jobs");
      expect(q).toContain("site:indeed.com");
      expect(q).toContain("site:glassdoor.com");
      expect(q).toContain("site:wellfound.com");
      expect(q).toContain("site:news.ycombinator.com");
      expect(q).toContain("AI engineer");
    });

    it("respects preferredPlatforms subset", async () => {
      const ws = makeWebSearch([]);
      registryMock.tryGet.mockReturnValue(ws);
      await tool.execute(
        {
          query: "remote backend",
          preferredPlatforms: ["linkedin", "wellfound"],
        },
        makeContext(),
      );
      const q = ws.execute.mock.calls[0][0].query as string;
      expect(q).toContain("site:linkedin.com/jobs");
      expect(q).toContain("site:wellfound.com");
      expect(q).not.toContain("site:indeed.com");
      expect(q).not.toContain("site:glassdoor.com");
    });

    it("identifies platform per result via domain matching", async () => {
      const ws = makeWebSearch([
        {
          title: "Senior Eng",
          url: "https://www.linkedin.com/jobs/view/123",
          content: "open role",
        },
        {
          title: "Backend Dev",
          url: "https://www.indeed.com/viewjob?jk=abc",
          content: "5y exp",
        },
        {
          title: "VP Eng",
          url: "https://wellfound.com/company/x/jobs/1",
          content: "founding",
        },
      ]);
      registryMock.tryGet.mockReturnValue(ws);
      const r = await tool.execute({ query: "x" }, makeContext());
      const items = (r.data as { items: Array<Record<string, unknown>> }).items;
      expect(items[0].platform).toBe("LinkedIn Jobs");
      expect(items[1].platform).toBe("Indeed");
      expect(items[2].platform).toBe("Wellfound");
    });
  });

  describe("error path", () => {
    it("returns success:false when no valid platforms selected", async () => {
      registryMock.tryGet.mockReturnValue(makeWebSearch());
      const r = await tool.execute(
        { query: "x", preferredPlatforms: ["bogus", "fake"] },
        makeContext(),
      );
      const data = r.data as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain("Unknown preferredPlatforms");
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
      expect(data.error).toContain("down");
    });
  });
});

