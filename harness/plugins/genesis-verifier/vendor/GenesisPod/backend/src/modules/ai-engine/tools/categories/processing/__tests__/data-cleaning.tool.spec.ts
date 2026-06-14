/**
 * DataCleaningTool Unit Tests
 */

import {
  DataCleaningTool,
  DataCleaningInput,
  CleaningRule,
} from "../data/data-cleaning.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "data-cleaning",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("DataCleaningTool", () => {
  let tool: DataCleaningTool;

  beforeEach(() => {
    tool = new DataCleaningTool();
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have correct id and category", () => {
      expect(tool.id).toBe("data-cleaning");
      expect(tool.category).toBe("processing");
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true with valid data and rules", () => {
      const input: DataCleaningInput = {
        data: [{ name: "test" }],
        cleaningRules: [{ type: "trim" }],
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return false when data is missing", () => {
      const input = {
        cleaningRules: [{ type: "trim" }],
      } as unknown as DataCleaningInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when cleaningRules is an empty array", () => {
      const input: DataCleaningInput = {
        data: [{ name: "test" }],
        cleaningRules: [],
      };
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when cleaningRules is missing", () => {
      const input = {
        data: [{ name: "test" }],
      } as unknown as DataCleaningInput;
      expect(tool.validateInput(input)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // remove_duplicates rule
  // --------------------------------------------------------------------------

  describe("remove_duplicates rule", () => {
    it("should remove duplicate items from an array", async () => {
      const input: DataCleaningInput = {
        data: [
          { id: 1, name: "Alice" },
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
        cleaningRules: [{ type: "remove_duplicates" }],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data?.data)).toBe(true);
      expect((result.data?.data as unknown[]).length).toBe(2);
      expect(result.data?.statistics.duplicatesRemoved).toBe(1);
    });

    it("should remove duplicates by a specific field", async () => {
      const input: DataCleaningInput = {
        data: [
          { id: 1, name: "Alice" },
          { id: 1, name: "Alice Duplicate" },
          { id: 2, name: "Bob" },
        ],
        cleaningRules: [{ type: "remove_duplicates", field: "id" }],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect((result.data?.data as unknown[]).length).toBe(2);
      expect(result.data?.statistics.duplicatesRemoved).toBe(1);
    });

    it("should leave data unchanged if no duplicates exist", async () => {
      const input: DataCleaningInput = {
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
        cleaningRules: [{ type: "remove_duplicates" }],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect((result.data?.data as unknown[]).length).toBe(3);
      expect(result.data?.statistics.duplicatesRemoved).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // handle_missing rule
  // --------------------------------------------------------------------------

  describe("handle_missing rule", () => {
    it("should drop records with missing field values using strategy=drop", async () => {
      const input: DataCleaningInput = {
        data: [
          { name: "Alice", age: 30 },
          { name: "", age: 25 },
        ],
        cleaningRules: [
          {
            type: "handle_missing",
            field: "name",
            params: { strategy: "drop" },
          },
        ],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect((result.data?.data as unknown[]).length).toBe(1);
      expect(result.data?.statistics.missingValuesHandled).toBe(1);
    });

    it("should fill missing values using strategy=fill", async () => {
      const input: DataCleaningInput = {
        data: [{ name: "Alice" }, { name: null }],
        cleaningRules: [
          {
            type: "handle_missing",
            field: "name",
            params: { strategy: "fill", fillValue: "Unknown" },
          },
        ],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ name: unknown }>;
      const filled = data.find((r) => r.name === "Unknown");
      expect(filled).toBeDefined();
    });

    it("should apply default value using strategy=default", async () => {
      const input: DataCleaningInput = {
        data: [{ score: null }],
        cleaningRules: [
          {
            type: "handle_missing",
            field: "score",
            params: { strategy: "default", defaultValue: 0 },
          },
        ],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ score: unknown }>;
      expect(data[0].score).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // normalize rule
  // --------------------------------------------------------------------------

  describe("normalize rule", () => {
    it("should convert field to lowercase", async () => {
      const input: DataCleaningInput = {
        data: [{ email: "USER@EXAMPLE.COM" }],
        cleaningRules: [
          {
            type: "normalize",
            field: "email",
            params: { format: "lowercase" },
          },
        ],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ email: string }>;
      expect(data[0].email).toBe("user@example.com");
      expect(result.data?.statistics.fieldsNormalized).toBeGreaterThan(0);
    });

    it("should convert field to uppercase", async () => {
      const input: DataCleaningInput = {
        data: [{ code: "abc" }],
        cleaningRules: [
          { type: "normalize", field: "code", params: { format: "uppercase" } },
        ],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ code: string }>;
      expect(data[0].code).toBe("ABC");
    });

    it("should parse string to number with format=number", async () => {
      const input: DataCleaningInput = {
        data: [{ price: "19.99" }],
        cleaningRules: [
          { type: "normalize", field: "price", params: { format: "number" } },
        ],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ price: unknown }>;
      expect(data[0].price).toBe(19.99);
    });
  });

  // --------------------------------------------------------------------------
  // trim rule
  // --------------------------------------------------------------------------

  describe("trim rule", () => {
    it("should trim whitespace from string fields", async () => {
      const input: DataCleaningInput = {
        data: [{ name: "  Alice  ", city: " Boston " }],
        cleaningRules: [{ type: "trim" }],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ name: string; city: string }>;
      expect(data[0].name).toBe("Alice");
      expect(data[0].city).toBe("Boston");
    });

    it("should trim only the specified field", async () => {
      const input: DataCleaningInput = {
        data: [{ name: "  Alice  ", city: "  Boston  " }],
        cleaningRules: [{ type: "trim", field: "name" }],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ name: string; city: string }>;
      expect(data[0].name).toBe("Alice");
      expect(data[0].city).toBe("  Boston  ");
    });
  });

  // --------------------------------------------------------------------------
  // replace rule
  // --------------------------------------------------------------------------

  describe("replace rule", () => {
    it("should replace a string pattern in a field", async () => {
      const input: DataCleaningInput = {
        data: [{ phone: "+1-800-555-1234" }],
        cleaningRules: [
          { type: "replace", field: "phone", params: { from: "-", to: "" } },
        ],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ phone: string }>;
      expect(data[0].phone).toBe(
        "+1800555 1234".replace(/\s/g, "").replace(/-/g, "") || "+18005551234",
      );
      // Verify dashes are removed
      expect(data[0].phone).not.toContain("-");
    });
  });

  // --------------------------------------------------------------------------
  // transform rule
  // --------------------------------------------------------------------------

  describe("transform rule", () => {
    it("should normalize email format with transformer=email", async () => {
      const input: DataCleaningInput = {
        data: [{ email: "  User@Example.COM  " }],
        cleaningRules: [
          {
            type: "transform",
            field: "email",
            params: { transformer: "email" },
          },
        ],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ email: string }>;
      expect(data[0].email).toBe("user@example.com");
    });

    it("should strip non-digits from phone with transformer=phone", async () => {
      const input: DataCleaningInput = {
        data: [{ phone: "(800) 555-1234" }],
        cleaningRules: [
          {
            type: "transform",
            field: "phone",
            params: { transformer: "phone" },
          },
        ],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ phone: string }>;
      expect(data[0].phone).toBe("8005551234");
    });

    it("should generate slug from string with transformer=slug", async () => {
      const input: DataCleaningInput = {
        data: [{ title: "Hello World! This is a Test" }],
        cleaningRules: [
          {
            type: "transform",
            field: "title",
            params: { transformer: "slug" },
          },
        ],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      const data = result.data?.data as Array<{ title: string }>;
      expect(data[0].title).toBe("hello-world-this-is-a-test");
    });
  });

  // --------------------------------------------------------------------------
  // outputFormat
  // --------------------------------------------------------------------------

  describe("outputFormat", () => {
    it("should output CSV string when outputFormat=csv", async () => {
      const input: DataCleaningInput = {
        data: [
          { name: "Alice", age: "30" },
          { name: "Bob", age: "25" },
        ],
        cleaningRules: [{ type: "trim" }],
        outputFormat: "csv",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(typeof result.data?.data).toBe("string");
      expect(result.data?.data as string).toContain("name");
      expect(result.data?.data as string).toContain("Alice");
    });

    it("should output array when outputFormat=array", async () => {
      const input: DataCleaningInput = {
        data: { name: "single" },
        cleaningRules: [{ type: "trim" }],
        outputFormat: "array",
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(Array.isArray(result.data?.data)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Statistics and rulesApplied
  // --------------------------------------------------------------------------

  describe("statistics", () => {
    it("should report correct rulesApplied count", async () => {
      const rules: CleaningRule[] = [
        { type: "trim" },
        { type: "normalize", params: { format: "lowercase" } },
      ];
      const input: DataCleaningInput = {
        data: [{ name: "  ALICE  " }],
        cleaningRules: rules,
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.rulesApplied).toBe(2);
    });

    it("should report originalCount and cleanedCount", async () => {
      const input: DataCleaningInput = {
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
        cleaningRules: [{ type: "trim" }],
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.statistics.originalCount).toBe(3);
      expect(result.data?.statistics.cleanedCount).toBe(3);
    });
  });
});
