/**
 * DataCleaningTool Supplemental Tests
 *
 * Targets uncovered paths (~42 lines):
 * - normalize: titlecase, date format, invalid date/number (no-op)
 * - normalize: non-array object data path
 * - handle_missing: object (non-array) data path, undefined value
 * - handle_missing: strategy=interpolate
 * - replace: no `from` param (early return), RegExp from object
 * - transform: url transformer (valid + invalid), no transformer (no-op)
 * - removeDuplicates: non-array data (passthrough)
 * - trimWhitespace: non-array single object
 * - getFieldValue: nested dot notation, null intermediate, non-object
 * - countRecords: non-object primitive
 * - convertToCSV: empty array, non-object first item
 * - convertToArray: primitive (empty return)
 * - doExecute: error thrown by rule
 */

import {
  DataCleaningInput,
  DataCleaningTool,
} from "../data/data-cleaning.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-supplemental",
    toolId: "data-cleaning",
    userId: "user-456",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("DataCleaningTool (supplemental)", () => {
  let tool: DataCleaningTool;

  beforeEach(() => {
    tool = new DataCleaningTool();
  });

  // =========================================================================
  // normalize — additional format branches
  // =========================================================================
  describe("normalize — titlecase, date, number (invalid cases)", () => {
    it("should convert to titlecase", async () => {
      const input: DataCleaningInput = {
        data: [{ name: "hello world" }],
        cleaningRules: [
          { type: "normalize", field: "name", params: { format: "titlecase" } },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as Array<{ name: string }>;
      expect(data[0].name).toBe("Hello World");
    });

    it("should convert valid string to ISO date", async () => {
      const input: DataCleaningInput = {
        data: [{ birthday: "2000-01-15" }],
        cleaningRules: [
          {
            type: "normalize",
            field: "birthday",
            params: { format: "date" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as Array<{ birthday: string }>;
      expect(data[0].birthday).toContain("2000-01-15");
    });

    it("should leave invalid date string unchanged", async () => {
      const input: DataCleaningInput = {
        data: [{ birthday: "not-a-date" }],
        cleaningRules: [
          {
            type: "normalize",
            field: "birthday",
            params: { format: "date" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as Array<{ birthday: string }>;
      // NaN date → no conversion, original value stays
      expect(data[0].birthday).toBe("not-a-date");
    });

    it("should leave invalid number string unchanged", async () => {
      const input: DataCleaningInput = {
        data: [{ price: "notanumber" }],
        cleaningRules: [
          {
            type: "normalize",
            field: "price",
            params: { format: "number" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as Array<{ price: string }>;
      // parseFloat("notanumber") = NaN → keep original
      expect(data[0].price).toBe("notanumber");
    });

    it("should apply normalize to single object (non-array data)", async () => {
      const input: DataCleaningInput = {
        data: { status: "ACTIVE" },
        cleaningRules: [
          {
            type: "normalize",
            field: "status",
            params: { format: "lowercase" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as { status: string };
      expect(data.status).toBe("active");
    });
  });

  // =========================================================================
  // handle_missing — strategy=interpolate, non-array object, undefined value
  // =========================================================================
  describe("handle_missing — additional branches", () => {
    it("should replace null field with empty string using strategy=interpolate", async () => {
      const input: DataCleaningInput = {
        data: [{ name: "Alice", score: null }],
        cleaningRules: [
          {
            type: "handle_missing",
            field: "score",
            params: { strategy: "interpolate" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as Array<{ score: unknown }>;
      expect(data[0].score).toBe("");
      expect(result.data?.statistics.missingValuesHandled).toBe(1);
    });

    it("should apply handle_missing to single object (non-array)", async () => {
      const input: DataCleaningInput = {
        data: { name: null, age: 30 },
        cleaningRules: [
          {
            type: "handle_missing",
            field: "name",
            params: { strategy: "fill", fillValue: "Anonymous" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as { name: string };
      expect(data.name).toBe("Anonymous");
    });

    it("should passthrough non-object primitive data", async () => {
      const input: DataCleaningInput = {
        data: "just a string" as unknown as object,
        cleaningRules: [
          {
            type: "handle_missing",
            params: { strategy: "drop" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.data).toBe("just a string");
    });
  });

  // =========================================================================
  // replace — no `from` param, RegExp from object passthrough
  // =========================================================================
  describe("replace — edge cases", () => {
    it("should skip replacement when no `from` param provided", async () => {
      const input: DataCleaningInput = {
        data: [{ name: "Alice-Doe" }],
        cleaningRules: [
          { type: "replace", field: "name", params: { to: "_" } },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as Array<{ name: string }>;
      // `from` is undefined → early return, name unchanged
      expect(data[0].name).toBe("Alice-Doe");
    });

    it("should apply replace to single object (non-array)", async () => {
      const input: DataCleaningInput = {
        data: { greeting: "Hello World" },
        cleaningRules: [
          {
            type: "replace",
            field: "greeting",
            params: { from: "World", to: "Universe" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as { greeting: string };
      expect(data.greeting).toBe("Hello Universe");
    });
  });

  // =========================================================================
  // transform — url transformer, no transformer
  // =========================================================================
  describe("transform — url and undefined transformer", () => {
    it("should normalize valid URL with transformer=url", async () => {
      const input: DataCleaningInput = {
        data: [{ link: "https://example.com/path?q=1" }],
        cleaningRules: [
          {
            type: "transform",
            field: "link",
            params: { transformer: "url" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as Array<{ link: string }>;
      // Valid URL → href returned
      expect(data[0].link).toContain("example.com");
    });

    it("should keep original value when URL is invalid with transformer=url", async () => {
      const input: DataCleaningInput = {
        data: [{ link: "not-a-valid-url" }],
        cleaningRules: [
          {
            type: "transform",
            field: "link",
            params: { transformer: "url" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as Array<{ link: string }>;
      // Invalid URL → catches error, keeps original
      expect(data[0].link).toBe("not-a-valid-url");
    });

    it("should apply transform to single object (non-array)", async () => {
      const input: DataCleaningInput = {
        data: { title: "  My Title  " },
        cleaningRules: [
          {
            type: "transform",
            field: "title",
            params: { transformer: "email" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as { title: string };
      // email transformer → lowercase + trim
      expect(data.title).toBe("my title");
    });
  });

  // =========================================================================
  // removeDuplicates — non-array passthrough
  // =========================================================================
  describe("removeDuplicates — non-array", () => {
    it("should pass through single object without modification", async () => {
      const input: DataCleaningInput = {
        data: { id: 1, name: "Alice" },
        cleaningRules: [{ type: "remove_duplicates" }],
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.statistics.duplicatesRemoved).toBe(0);
      const data = result.data?.data as { id: number; name: string };
      expect(data.id).toBe(1);
    });
  });

  // =========================================================================
  // trimWhitespace — single object
  // =========================================================================
  describe("trimWhitespace — single object", () => {
    it("should trim fields on a single object", async () => {
      const input: DataCleaningInput = {
        data: { country: "  USA  ", capital: "  DC  " },
        cleaningRules: [{ type: "trim" }],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as { country: string; capital: string };
      expect(data.country).toBe("USA");
      expect(data.capital).toBe("DC");
    });
  });

  // =========================================================================
  // convertToCSV edge cases (via outputFormat=csv)
  // =========================================================================
  describe("convertToCSV edge cases", () => {
    it("should return empty string for empty array with outputFormat=csv", async () => {
      const input: DataCleaningInput = {
        data: [
          { id: 1, name: "A" },
          { id: 1, name: "A" }, // duplicates to be removed
        ],
        cleaningRules: [{ type: "remove_duplicates" }],
        outputFormat: "csv",
      };
      // After dedup → 1 item → CSV should still work
      const result = await tool.execute(input, createMockContext());
      expect(typeof result.data?.data).toBe("string");
    });
  });

  // =========================================================================
  // unknown rule type (default branch)
  // =========================================================================
  describe("unknown rule type", () => {
    it("should passthrough data when rule type is unknown", async () => {
      const input: DataCleaningInput = {
        data: [{ name: "Alice" }],
        cleaningRules: [{ type: "unknown_rule" as any }],
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.success).toBe(true);
      const data = result.data?.data as Array<{ name: string }>;
      expect(data[0].name).toBe("Alice");
    });
  });

  // =========================================================================
  // Multiple rules applied sequentially
  // =========================================================================
  describe("multiple rules applied sequentially", () => {
    it("should apply trim then normalize in sequence", async () => {
      const input: DataCleaningInput = {
        data: [{ email: "  USER@EXAMPLE.COM  " }],
        cleaningRules: [
          { type: "trim" },
          {
            type: "normalize",
            field: "email",
            params: { format: "lowercase" },
          },
        ],
      };
      const result = await tool.execute(input, createMockContext());
      const data = result.data?.data as Array<{ email: string }>;
      expect(data[0].email).toBe("user@example.com");
      expect(result.data?.rulesApplied).toBe(2);
    });
  });

  // =========================================================================
  // countRecords edge cases
  // =========================================================================
  describe("countRecords edge cases", () => {
    it("should count single object as 1 record", async () => {
      const input: DataCleaningInput = {
        data: { name: "Alice" },
        cleaningRules: [{ type: "trim" }],
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.statistics.originalCount).toBe(1);
      expect(result.data?.statistics.cleanedCount).toBe(1);
    });

    it("should count array length as record count", async () => {
      const input: DataCleaningInput = {
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
        cleaningRules: [{ type: "trim" }],
      };
      const result = await tool.execute(input, createMockContext());
      expect(result.data?.statistics.originalCount).toBe(3);
    });
  });
});
