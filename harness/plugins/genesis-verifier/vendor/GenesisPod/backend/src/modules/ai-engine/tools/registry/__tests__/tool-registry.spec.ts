/**
 * Unit tests for ToolRegistry
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ToolRegistry } from "../tool.registry";
import {
  ITool,
  ToolCategory,
  ToolContext,
  ToolResult,
  FunctionDefinition,
  CompactToolSummary,
  ToolDefinition,
} from "../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(
  id: string,
  category: ToolCategory = "information",
  overrides: Partial<ITool> = {},
): ITool {
  return {
    id,
    name: `Tool ${id}`,
    description: `Description of ${id}`,
    category,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    enabled: true,
    cancellable: true,
    defaultTimeout: 5000,
    tags: undefined,
    async execute(_input: unknown, _context: ToolContext): Promise<ToolResult> {
      return {
        success: true,
        data: {},
        metadata: {
          executionId: "e",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      };
    },
    toFunctionDefinition(): FunctionDefinition {
      return { name: id, description: `Description of ${id}`, parameters: {} };
    },
    toCompactSummary(): CompactToolSummary {
      return {
        id,
        name: `Tool ${id}`,
        brief: `Description of ${id}`,
        category,
      };
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ToolRegistry],
    }).compile();

    registry = module.get<ToolRegistry>(ToolRegistry);
  });

  // -------------------------------------------------------------------------
  // register()
  // -------------------------------------------------------------------------

  describe("register()", () => {
    it("registers a tool successfully", () => {
      const tool = makeTool("tool-1");
      registry.register(tool);
      expect(registry.has("tool-1")).toBe(true);
    });

    it("retrieves a registered tool by id", () => {
      const tool = makeTool("tool-2");
      registry.register(tool);
      expect(registry.get("tool-2")).toBe(tool);
    });

    it("logs warning and skips duplicate registration", () => {
      const tool = makeTool("dup-tool");
      registry.register(tool);
      registry.register(tool); // second call should be silently skipped
      expect(registry.getAll()).toHaveLength(1);
    });

    it("indexes tool by category", () => {
      const tool = makeTool("info-tool", "information");
      registry.register(tool);
      expect(registry.getByCategory("information")).toContainEqual(tool);
    });

    it("indexes multiple tools in the same category", () => {
      registry.register(makeTool("info-1", "generation"));
      registry.register(makeTool("info-2", "generation"));
      expect(registry.getByCategory("generation")).toHaveLength(2);
    });

    it("indexes tool by tag when tags are provided", () => {
      const tool = makeTool("tagged-tool", "processing", {
        tags: ["nlp", "text"],
      });
      registry.register(tool);
      expect(registry.getByTag("nlp")).toContainEqual(tool);
      expect(registry.getByTag("text")).toContainEqual(tool);
    });

    it("handles tools with no tags without throwing", () => {
      const tool = makeTool("no-tag-tool", "information", { tags: undefined });
      expect(() => registry.register(tool)).not.toThrow();
    });

    it("registers tools in different categories correctly", () => {
      registry.register(makeTool("t1", "information"));
      registry.register(makeTool("t2", "generation"));
      registry.register(makeTool("t3", "processing"));

      expect(registry.getByCategory("information")).toHaveLength(1);
      expect(registry.getByCategory("generation")).toHaveLength(1);
      expect(registry.getByCategory("processing")).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // unregister()
  // -------------------------------------------------------------------------

  describe("unregister()", () => {
    it("removes a registered tool and returns true", () => {
      registry.register(makeTool("remove-me"));
      const result = registry.unregister("remove-me");
      expect(result).toBe(true);
      expect(registry.has("remove-me")).toBe(false);
    });

    it("returns false for an unknown tool id", () => {
      expect(registry.unregister("nonexistent")).toBe(false);
    });

    it("cleans up category index on unregister", () => {
      registry.register(makeTool("cat-tool", "export"));
      registry.unregister("cat-tool");
      expect(registry.getByCategory("export")).toHaveLength(0);
    });

    it("cleans up tag index on unregister", () => {
      registry.register(makeTool("tag-tool", "memory", { tags: ["persist"] }));
      registry.unregister("tag-tool");
      expect(registry.getByTag("persist")).toHaveLength(0);
    });

    it("does not affect other tools in the same category", () => {
      registry.register(makeTool("keep-me", "information"));
      registry.register(makeTool("remove-me", "information"));
      registry.unregister("remove-me");
      expect(registry.getByCategory("information")).toHaveLength(1);
      expect(registry.getByCategory("information")[0].id).toBe("keep-me");
    });
  });

  // -------------------------------------------------------------------------
  // get() / tryGet()
  // -------------------------------------------------------------------------

  describe("get() and tryGet()", () => {
    it("get() throws for an unknown tool id", () => {
      expect(() => registry.get("unknown")).toThrow();
    });

    it("tryGet() returns undefined for an unknown tool id", () => {
      expect(registry.tryGet("unknown")).toBeUndefined();
    });

    it("tryGet() returns the tool when found", () => {
      const tool = makeTool("found-tool");
      registry.register(tool);
      expect(registry.tryGet("found-tool")).toBe(tool);
    });
  });

  // -------------------------------------------------------------------------
  // registerDefinition()
  // -------------------------------------------------------------------------

  describe("registerDefinition()", () => {
    it("stores a factory from ToolDefinition", () => {
      const tool = makeTool("def-tool");
      const def: ToolDefinition = {
        id: "def-tool",
        name: "Def Tool",
        description: "Test",
        category: "information",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        factory: () => tool,
      };
      expect(() => registry.registerDefinition(def)).not.toThrow();
    });

    it("handles definition without a factory", () => {
      const def: ToolDefinition = {
        id: "no-factory-tool",
        name: "No Factory",
        description: "Test",
        category: "information",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
      };
      expect(() => registry.registerDefinition(def)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getByCategory()
  // -------------------------------------------------------------------------

  describe("getByCategory()", () => {
    it("returns empty array for an empty registry", () => {
      expect(registry.getByCategory("information")).toEqual([]);
    });

    it("returns only tools in the specified category", () => {
      registry.register(makeTool("info-tool", "information"));
      registry.register(makeTool("gen-tool", "generation"));

      const infoTools = registry.getByCategory("information");
      expect(infoTools).toHaveLength(1);
      expect(infoTools[0].id).toBe("info-tool");
    });

    it("returns empty array for a category with no tools", () => {
      registry.register(makeTool("t", "information"));
      expect(registry.getByCategory("export")).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getByTag()
  // -------------------------------------------------------------------------

  describe("getByTag()", () => {
    it("returns empty array when no tools have the tag", () => {
      registry.register(makeTool("t", "information", { tags: ["other"] }));
      expect(registry.getByTag("nonexistent-tag")).toEqual([]);
    });

    it("returns tools matching the tag", () => {
      registry.register(makeTool("nlp-tool", "processing", { tags: ["nlp"] }));
      registry.register(
        makeTool("other-tool", "processing", { tags: ["search"] }),
      );
      expect(registry.getByTag("nlp")).toHaveLength(1);
      expect(registry.getByTag("nlp")[0].id).toBe("nlp-tool");
    });

    it("returns multiple tools for the same tag", () => {
      registry.register(makeTool("t1", "information", { tags: ["ai"] }));
      registry.register(makeTool("t2", "generation", { tags: ["ai"] }));
      expect(registry.getByTag("ai")).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // getCategories() / getTags()
  // -------------------------------------------------------------------------

  describe("getCategories()", () => {
    it("returns empty array on empty registry", () => {
      expect(registry.getCategories()).toEqual([]);
    });

    it("returns all categories with registered tools", () => {
      registry.register(makeTool("t1", "information"));
      registry.register(makeTool("t2", "generation"));
      const cats = registry.getCategories();
      expect(cats).toContain("information");
      expect(cats).toContain("generation");
    });
  });

  describe("getTags()", () => {
    it("returns empty array on empty registry", () => {
      expect(registry.getTags()).toEqual([]);
    });

    it("returns all tags from registered tools", () => {
      registry.register(
        makeTool("t", "information", { tags: ["search", "web"] }),
      );
      const tags = registry.getTags();
      expect(tags).toContain("search");
      expect(tags).toContain("web");
    });
  });

  // -------------------------------------------------------------------------
  // getEnabled()
  // -------------------------------------------------------------------------

  describe("getEnabled()", () => {
    it("returns all tools when all are enabled", () => {
      registry.register(makeTool("t1", "information", { enabled: true }));
      registry.register(makeTool("t2", "generation", { enabled: true }));
      expect(registry.getEnabled()).toHaveLength(2);
    });

    it("excludes disabled tools", () => {
      registry.register(
        makeTool("enabled-tool", "information", { enabled: true }),
      );
      registry.register(
        makeTool("disabled-tool", "information", { enabled: false }),
      );
      const enabled = registry.getEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe("enabled-tool");
    });

    it("includes tools without explicit enabled property (treated as enabled)", () => {
      const tool = makeTool("no-enabled-prop", "information");
      delete (tool as any).enabled;
      registry.register(tool);
      expect(registry.getEnabled()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // getAllFunctionDefinitions()
  // -------------------------------------------------------------------------

  describe("getAllFunctionDefinitions()", () => {
    it("returns empty array when no tools registered", () => {
      expect(registry.getAllFunctionDefinitions()).toEqual([]);
    });

    it("returns function definitions for all enabled tools", () => {
      registry.register(makeTool("t1", "information", { enabled: true }));
      registry.register(makeTool("t2", "generation", { enabled: true }));
      const defs = registry.getAllFunctionDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs[0]).toHaveProperty("name");
      expect(defs[0]).toHaveProperty("description");
    });

    it("excludes disabled tools", () => {
      registry.register(makeTool("enabled", "information", { enabled: true }));
      registry.register(
        makeTool("disabled", "information", { enabled: false }),
      );
      const defs = registry.getAllFunctionDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0].name).toBe("enabled");
    });
  });

  // -------------------------------------------------------------------------
  // getFunctionDefinitions()
  // -------------------------------------------------------------------------

  describe("getFunctionDefinitions()", () => {
    it("returns definitions only for specified ids", () => {
      registry.register(makeTool("t1"));
      registry.register(makeTool("t2"));
      registry.register(makeTool("t3"));
      const defs = registry.getFunctionDefinitions(["t1", "t3"]);
      expect(defs).toHaveLength(2);
    });

    it("ignores unknown ids", () => {
      registry.register(makeTool("t1"));
      const defs = registry.getFunctionDefinitions(["t1", "nonexistent"]);
      expect(defs).toHaveLength(1);
    });

    it("excludes disabled tools from specified ids", () => {
      registry.register(makeTool("enabled", "information", { enabled: true }));
      registry.register(
        makeTool("disabled", "information", { enabled: false }),
      );
      const defs = registry.getFunctionDefinitions(["enabled", "disabled"]);
      expect(defs).toHaveLength(1);
      expect(defs[0].name).toBe("enabled");
    });
  });

  // -------------------------------------------------------------------------
  // getAllCompactSummaries()
  // -------------------------------------------------------------------------

  describe("getAllCompactSummaries()", () => {
    it("returns empty array for empty registry", () => {
      expect(registry.getAllCompactSummaries()).toEqual([]);
    });

    it("returns compact summaries for all enabled tools", () => {
      registry.register(makeTool("t1", "information", { enabled: true }));
      registry.register(makeTool("t2", "generation", { enabled: true }));
      const summaries = registry.getAllCompactSummaries();
      expect(summaries).toHaveLength(2);
      expect(summaries[0]).toHaveProperty("id");
      expect(summaries[0]).toHaveProperty("brief");
      expect(summaries[0]).toHaveProperty("category");
    });
  });

  // -------------------------------------------------------------------------
  // getCompactSummaries()
  // -------------------------------------------------------------------------

  describe("getCompactSummaries()", () => {
    it("returns compact summaries for specified ids", () => {
      registry.register(makeTool("t1"));
      registry.register(makeTool("t2"));
      const summaries = registry.getCompactSummaries(["t1"]);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].id).toBe("t1");
    });

    it("excludes disabled tools", () => {
      registry.register(makeTool("enabled", "information", { enabled: true }));
      registry.register(
        makeTool("disabled", "information", { enabled: false }),
      );
      const summaries = registry.getCompactSummaries(["enabled", "disabled"]);
      expect(summaries).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // getToolList()
  // -------------------------------------------------------------------------

  describe("getToolList()", () => {
    beforeEach(() => {
      registry.register(
        makeTool("t-info-1", "information", {
          tags: ["search"],
          enabled: true,
        }),
      );
      registry.register(
        makeTool("t-gen-1", "generation", { tags: ["ai"], enabled: true }),
      );
      registry.register(
        makeTool("t-info-2", "information", { tags: ["web"], enabled: true }),
      );
    });

    it("returns compact summaries by default (compact=true)", () => {
      const result = registry.getToolList(["t-info-1", "t-gen-1"]);
      expect(result).toHaveLength(2);
      // Compact summary has `brief` property
      expect((result[0] as CompactToolSummary).brief).toBeDefined();
    });

    it("returns function definitions when compact=false", () => {
      const result = registry.getToolList(["t-info-1"], { compact: false });
      expect(result).toHaveLength(1);
      // FunctionDefinition has `parameters` property
      expect((result[0] as FunctionDefinition).parameters).toBeDefined();
    });

    it("filters by categories", () => {
      const result = registry.getToolList(["t-info-1", "t-gen-1", "t-info-2"], {
        categories: ["information"],
      });
      expect(result).toHaveLength(2);
    });

    it("filters by tags", () => {
      const result = registry.getToolList(["t-info-1", "t-gen-1", "t-info-2"], {
        tags: ["ai"],
      });
      expect(result).toHaveLength(1);
    });

    it("limits results when maxTools is specified", () => {
      const result = registry.getToolList(["t-info-1", "t-gen-1", "t-info-2"], {
        maxTools: 2,
      });
      expect(result).toHaveLength(2);
    });

    it("returns empty array when no ids provided", () => {
      const result = registry.getToolList([]);
      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // estimateTokens()
  // -------------------------------------------------------------------------

  describe("estimateTokens()", () => {
    it("returns 0 for empty ids", () => {
      expect(registry.estimateTokens([])).toBe(0);
    });

    it("returns 0 for non-registered ids", () => {
      expect(registry.estimateTokens(["unknown-tool"])).toBe(0);
    });

    it("returns a positive number for registered tools", () => {
      registry.register(
        makeTool("schema-tool", "information", {
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
            },
          },
        }),
      );
      const estimate = registry.estimateTokens(["schema-tool"]);
      expect(estimate).toBeGreaterThan(0);
    });

    it("returns larger estimate for full mode (compact=false)", () => {
      registry.register(
        makeTool("est-tool", "information", {
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Some query" },
              limit: { type: "number" },
            },
          },
        }),
      );
      const compactEst = registry.estimateTokens(["est-tool"], true);
      const fullEst = registry.estimateTokens(["est-tool"], false);
      expect(fullEst).toBeGreaterThanOrEqual(compactEst);
    });

    it("excludes disabled tools from estimate", () => {
      registry.register(
        makeTool("disabled-tool", "information", { enabled: false }),
      );
      expect(registry.estimateTokens(["disabled-tool"])).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // isAvailable()
  // -------------------------------------------------------------------------

  describe("isAvailable()", () => {
    it("returns true for a registered and enabled tool", () => {
      registry.register(
        makeTool("avail-tool", "information", { enabled: true }),
      );
      expect(registry.isAvailable("avail-tool")).toBe(true);
    });

    it("returns false for a non-registered tool", () => {
      expect(registry.isAvailable("nonexistent")).toBe(false);
    });

    it("returns false for a disabled tool", () => {
      registry.register(
        makeTool("disabled", "information", { enabled: false }),
      );
      expect(registry.isAvailable("disabled")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getStats()
  // -------------------------------------------------------------------------

  describe("getStats()", () => {
    it("returns zero stats on empty registry", () => {
      const stats = registry.getStats();
      expect(stats.total).toBe(0);
      expect(stats.byCategory).toEqual({});
      expect(stats.enabledCount).toBe(0);
      expect(stats.disabledCount).toBe(0);
    });

    it("reports correct total and category breakdown", () => {
      registry.register(makeTool("t1", "information", { enabled: true }));
      registry.register(makeTool("t2", "information", { enabled: true }));
      registry.register(makeTool("t3", "generation", { enabled: false }));

      const stats = registry.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byCategory["information"]).toBe(2);
      expect(stats.byCategory["generation"]).toBe(1);
      expect(stats.enabledCount).toBe(2);
      expect(stats.disabledCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // search()
  // -------------------------------------------------------------------------

  describe("search()", () => {
    beforeEach(() => {
      registry.register(
        makeTool("web-search", "information", { tags: ["search", "web"] }),
      );
      registry.register(
        makeTool("code-gen", "generation", { tags: ["ai", "code"] }),
      );
      registry.register(
        makeTool("data-clean", "processing", { tags: ["data"] }),
      );
    });

    it("returns all tools when no filter specified", () => {
      expect(registry.search({})).toHaveLength(3);
    });

    it("filters by keyword matching tool id", () => {
      const results = registry.search({ keyword: "web" });
      expect(results.some((t) => t.id === "web-search")).toBe(true);
    });

    it("filters by keyword matching tool name", () => {
      const results = registry.search({ keyword: "Tool web-search" });
      expect(results.some((t) => t.id === "web-search")).toBe(true);
    });

    it("filters by keyword matching description", () => {
      const results = registry.search({ keyword: "Description of code-gen" });
      expect(results.some((t) => t.id === "code-gen")).toBe(true);
    });

    it("filters by category", () => {
      const results = registry.search({ category: "generation" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("code-gen");
    });

    it("filters by tags", () => {
      const results = registry.search({ tags: ["ai"] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("code-gen");
    });

    it("filters enabledOnly — excludes disabled tools", () => {
      registry.register(
        makeTool("disabled-search", "information", { enabled: false }),
      );
      const results = registry.search({ enabledOnly: true });
      expect(results.every((t) => t.enabled !== false)).toBe(true);
    });

    it("combines keyword + category filter", () => {
      const results = registry.search({
        keyword: "search",
        category: "information",
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("web-search");
    });

    it("returns empty array when no tools match", () => {
      const results = registry.search({ keyword: "zzz-impossible-keyword" });
      expect(results).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getAll() / size() — inherited
  // -------------------------------------------------------------------------

  describe("getAll() and size() — inherited", () => {
    it("getAll() returns empty array initially", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("getAll() returns all registered tools", () => {
      registry.register(makeTool("t1"));
      registry.register(makeTool("t2"));
      expect(registry.getAll()).toHaveLength(2);
    });

    it("size() returns 0 initially", () => {
      expect(registry.size()).toBe(0);
    });

    it("size() returns the correct count after registrations", () => {
      registry.register(makeTool("t1"));
      registry.register(makeTool("t2"));
      expect(registry.size()).toBe(2);
    });
  });
});

