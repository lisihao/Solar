/**
 * tools.provider.ts 单元测试
 */
import {
  ALL_TOOL_CLASSES,
  ALL_TOOL_PROVIDERS,
  ALL_TOOLS_TOKEN,
  allToolsProvider,
  TOOL_ID_CLASS_MAP,
  TOTAL_TOOL_COUNT,
} from "../tools.provider";

describe("tools.provider", () => {
  describe("ALL_TOOL_CLASSES", () => {
    it("should be a non-empty array", () => {
      expect(Array.isArray(ALL_TOOL_CLASSES)).toBe(true);
      expect(ALL_TOOL_CLASSES.length).toBeGreaterThan(0);
    });

    it("should contain class constructors", () => {
      for (const ToolClass of ALL_TOOL_CLASSES) {
        expect(typeof ToolClass).toBe("function");
      }
    });
  });

  describe("ALL_TOOL_PROVIDERS", () => {
    it("should equal ALL_TOOL_CLASSES", () => {
      expect(ALL_TOOL_PROVIDERS).toBe(ALL_TOOL_CLASSES);
    });
  });

  describe("ALL_TOOLS_TOKEN", () => {
    it("should be a string token", () => {
      expect(typeof ALL_TOOLS_TOKEN).toBe("string");
      expect(ALL_TOOLS_TOKEN).toBe("ALL_TOOLS");
    });
  });

  describe("allToolsProvider", () => {
    it("should have correct provide token", () => {
      expect(allToolsProvider.provide).toBe(ALL_TOOLS_TOKEN);
    });

    it("should have a useFactory function", () => {
      expect(
        typeof (allToolsProvider as { useFactory: unknown }).useFactory,
      ).toBe("function");
    });

    it("should have inject array equal to ALL_TOOL_CLASSES", () => {
      expect((allToolsProvider as { inject: unknown }).inject).toBe(
        ALL_TOOL_CLASSES,
      );
    });

    it("useFactory should return its arguments as array", () => {
      const factory = (
        allToolsProvider as { useFactory: (...args: unknown[]) => unknown }
      ).useFactory;
      const mockTool1 = { id: "tool1" };
      const mockTool2 = { id: "tool2" };
      const result = factory(mockTool1, mockTool2);
      expect(result).toEqual([mockTool1, mockTool2]);
    });
  });

  describe("TOOL_ID_CLASS_MAP", () => {
    it("should be a non-empty object", () => {
      expect(typeof TOOL_ID_CLASS_MAP).toBe("object");
      expect(Object.keys(TOOL_ID_CLASS_MAP).length).toBeGreaterThan(0);
    });

    it("should contain web-search tool", () => {
      expect(TOOL_ID_CLASS_MAP["web-search"]).toBeDefined();
    });

    it("should contain web-scraper tool", () => {
      expect(TOOL_ID_CLASS_MAP["web-scraper"]).toBeDefined();
    });

    it("should contain rag-search tool", () => {
      expect(TOOL_ID_CLASS_MAP["rag-search"]).toBeDefined();
    });

    it("should contain image-search aggregator", () => {
      expect(TOOL_ID_CLASS_MAP["image-search"]).toBeDefined();
    });

    it("should contain bing-image-search", () => {
      expect(TOOL_ID_CLASS_MAP["bing-image-search"]).toBeDefined();
    });

    it("should contain google-image-search", () => {
      expect(TOOL_ID_CLASS_MAP["google-image-search"]).toBeDefined();
    });

    it("should contain serpapi-image-search", () => {
      expect(TOOL_ID_CLASS_MAP["serpapi-image-search"]).toBeDefined();
    });

    it("should contain sql-executor tool", () => {
      expect(TOOL_ID_CLASS_MAP["sql-executor"]).toBeDefined();
    });

    it("should contain container-executor tool", () => {
      expect(TOOL_ID_CLASS_MAP["container-executor"]).toBeDefined();
    });

    it("should contain text-generation tool", () => {
      expect(TOOL_ID_CLASS_MAP["text-generation"]).toBeDefined();
    });

    it("should contain export-pptx tool", () => {
      expect(TOOL_ID_CLASS_MAP["export-pptx"]).toBeDefined();
    });

    it("should contain agent-handoff tool", () => {
      expect(TOOL_ID_CLASS_MAP["agent-handoff"]).toBeDefined();
    });

    it("should have all values as functions (constructors)", () => {
      for (const [key, cls] of Object.entries(TOOL_ID_CLASS_MAP)) {
        expect(typeof cls).toBe(
          "function",
          `Tool ${key} should be a constructor`,
        );
      }
    });
  });

  describe("TOTAL_TOOL_COUNT", () => {
    it("should equal ALL_TOOL_CLASSES.length", () => {
      expect(TOTAL_TOOL_COUNT).toBe(ALL_TOOL_CLASSES.length);
    });

    it("should be a positive number", () => {
      expect(TOTAL_TOOL_COUNT).toBeGreaterThan(0);
    });
  });
});
