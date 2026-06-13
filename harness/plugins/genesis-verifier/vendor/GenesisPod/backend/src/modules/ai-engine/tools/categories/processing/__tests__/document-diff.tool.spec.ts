/**
 * DocumentDiffTool Unit Tests
 */

import {
  DocumentDiffInput,
  DocumentDiffTool,
} from "../documents/document-diff.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "document-diff",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("DocumentDiffTool", () => {
  let tool: DocumentDiffTool;

  beforeEach(() => {
    tool = new DocumentDiffTool();
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have correct id and category", () => {
      expect(tool.id).toBe("document-diff");
      expect(tool.category).toBe("processing");
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true when source and target are provided", () => {
      const input: DocumentDiffInput = { source: "hello", target: "world" };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return true for empty string source and target", () => {
      const input: DocumentDiffInput = { source: "", target: "" };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return false when source is null", () => {
      const input = {
        source: null,
        target: "world",
      } as unknown as DocumentDiffInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when target is undefined", () => {
      const input = {
        source: "hello",
        target: undefined,
      } as unknown as DocumentDiffInput;
      expect(tool.validateInput(input)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Identical documents
  // --------------------------------------------------------------------------

  describe("identical documents", () => {
    it("should report identical:true when source equals target", async () => {
      const text = "Line one\nLine two\nLine three";
      const input: DocumentDiffInput = { source: text, target: text };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.identical).toBe(true);
      expect(result.data?.statistics.additions).toBe(0);
      expect(result.data?.statistics.deletions).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Basic diff - lines
  // --------------------------------------------------------------------------

  describe("diffType: lines (default)", () => {
    it("should detect added lines", async () => {
      const source = "Line one\nLine two";
      const target = "Line one\nLine two\nLine three";
      const input: DocumentDiffInput = { source, target, diffType: "lines" };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.statistics.additions).toBeGreaterThan(0);
      expect(result.data?.identical).toBe(false);
    });

    it("should detect deleted lines", async () => {
      const source = "Line one\nLine two\nLine three";
      const target = "Line one\nLine three";
      const input: DocumentDiffInput = { source, target, diffType: "lines" };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.statistics.deletions).toBeGreaterThan(0);
    });

    it("should detect modifications (delete+add pair)", async () => {
      const source = "The quick brown fox";
      const target = "The slow green fox";
      const input: DocumentDiffInput = { source, target, diffType: "lines" };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      // modifications count or additions+deletions > 0
      const changed =
        result.data!.statistics.additions +
        result.data!.statistics.deletions +
        result.data!.statistics.modifications;
      expect(changed).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // diffType: words
  // --------------------------------------------------------------------------

  describe("diffType: words", () => {
    it("should detect word-level differences", async () => {
      const source = "Hello world";
      const target = "Hello universe";
      const input: DocumentDiffInput = { source, target, diffType: "words" };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.identical).toBe(false);
      const changed =
        result.data!.statistics.additions +
        result.data!.statistics.deletions +
        result.data!.statistics.modifications;
      expect(changed).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // diffType: chars
  // --------------------------------------------------------------------------

  describe("diffType: chars", () => {
    it("should detect character-level differences", async () => {
      const source = "cat";
      const target = "car";
      const input: DocumentDiffInput = { source, target, diffType: "chars" };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.identical).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // ignore options
  // --------------------------------------------------------------------------

  describe("ignore options", () => {
    it("should treat texts as equal when ignoring case", async () => {
      const source = "Hello World";
      const target = "hello world";
      const input: DocumentDiffInput = {
        source,
        target,
        diffType: "lines",
        ignore: { case: true },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.identical).toBe(true);
    });

    it("should ignore empty lines when emptyLines=true", async () => {
      const source = "Line one\n\nLine two";
      const target = "Line one\nLine two";
      const input: DocumentDiffInput = {
        source,
        target,
        diffType: "lines",
        ignore: { emptyLines: true },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.identical).toBe(true);
    });

    it("should normalize whitespace when ignore.whitespace=true", async () => {
      const source = "Hello   World";
      const target = "Hello World";
      const input: DocumentDiffInput = {
        source,
        target,
        diffType: "lines",
        ignore: { whitespace: true },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.identical).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // format options
  // --------------------------------------------------------------------------

  describe("format options", () => {
    it("should return unified format with --- Source header", async () => {
      const input: DocumentDiffInput = {
        source: "old text",
        target: "new text",
        format: "unified",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.formatted).toContain("--- Source");
      expect(result.data?.formatted).toContain("+++ Target");
    });

    it("should return json format as valid JSON string", async () => {
      const input: DocumentDiffInput = {
        source: "old",
        target: "new",
        format: "json",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(() => JSON.parse(result.data?.formatted ?? "")).not.toThrow();
    });

    it("should return html format with diff div wrapper", async () => {
      const input: DocumentDiffInput = {
        source: "old line",
        target: "new line",
        format: "html",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.formatted).toContain('<div class="diff">');
    });

    it("should return side-by-side format with pipe separator", async () => {
      const input: DocumentDiffInput = {
        source: "source text",
        target: "target text",
        format: "side-by-side",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.formatted).toContain(" | ");
    });
  });

  // --------------------------------------------------------------------------
  // Output structure
  // --------------------------------------------------------------------------

  describe("output structure", () => {
    it("should include changes array, statistics, formatted string, identical boolean", async () => {
      const input: DocumentDiffInput = { source: "a", target: "b" };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(Array.isArray(result.data?.changes)).toBe(true);
      expect(typeof result.data?.statistics).toBe("object");
      expect(typeof result.data?.formatted).toBe("string");
      expect(typeof result.data?.identical).toBe("boolean");
    });

    it("should have similarity between 0 and 100", async () => {
      const input: DocumentDiffInput = {
        source: "completely different text",
        target: "nothing in common here at all",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.statistics.similarity).toBeGreaterThanOrEqual(0);
      expect(result.data?.statistics.similarity).toBeLessThanOrEqual(100);
    });
  });

  // --------------------------------------------------------------------------
  // Empty inputs
  // --------------------------------------------------------------------------

  describe("edge cases", () => {
    it("should handle empty source and non-empty target", async () => {
      const input: DocumentDiffInput = {
        source: "",
        target: "new content\nsecond line",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      // The two texts differ so identical must be false
      expect(result.data?.identical).toBe(false);
    });

    it("should handle non-empty source and empty target", async () => {
      const input: DocumentDiffInput = {
        source: "deleted content\nsecond line",
        target: "",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.identical).toBe(false);
    });

    it("should compute non-zero changes when source has extra lines vs target", async () => {
      const input: DocumentDiffInput = {
        source: "line one\nline two\nline three",
        target: "line one",
        diffType: "lines",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.statistics.deletions).toBeGreaterThan(0);
    });
  });
});
