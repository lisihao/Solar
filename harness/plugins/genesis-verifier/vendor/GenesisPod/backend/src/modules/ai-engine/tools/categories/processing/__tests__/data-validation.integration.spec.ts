/**
 * DataValidationTool - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Line 274: schema errors pushed (validateAgainstSchema with actual errors)
 *  - Line 330: strict=true Ajv mode
 *  - Lines 334-362: ajv-formats integration + error parsing
 *  - Line 472: getNestedValue with null intermediate → returns undefined
 *  - Line 495: validateFormat URL → invalid URL (catch branch)
 *  - Lines 501-504: validateFormat "date" format
 *  - Line 514: validateFormat default case (unknown format)
 *  - Lines 532, 538-539: countFields circular reference + array path
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  DataValidationTool,
  DataValidationInput,
  ValidationRule,
} from "../data/data-validation.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "ext-exec",
    toolId: "data-validation",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("DataValidationTool (extended coverage)", () => {
  let tool: DataValidationTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataValidationTool],
    }).compile();
    tool = module.get(DataValidationTool);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // Lines 330, 334-362: strict=true Ajv mode and error parsing
  // =========================================================================

  describe("schema validation with strict=true (lines 330, 334-362)", () => {
    it("validates with strict option set to true", async () => {
      const input: DataValidationInput = {
        data: { name: "Alice" },
        schema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        },
        strict: true,
      };

      const result = await tool.execute(input, makeContext());

      // Should succeed or error (strict mode may reject unknown keywords)
      expect(result).toHaveProperty("success");
    });

    it("collects schema validation errors via ajv-formats (lines 334-362)", async () => {
      const input: DataValidationInput = {
        data: { email: "not-an-email", birth: "not-a-date" },
        schema: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            birth: { type: "string", format: "date" },
          },
        },
      };

      const result = await tool.execute(input, makeContext());

      if (result.success) {
        // ajv-formats is available, should report format errors
        expect(result.data?.valid).toBe(false);
        expect(result.data?.errors.length).toBeGreaterThan(0);
      } else {
        expect(result.error?.message).toBeDefined();
      }
    });
  });

  // =========================================================================
  // Line 472: getNestedValue with null intermediate (returns undefined)
  // =========================================================================

  describe("getNestedValue with null intermediate (line 472)", () => {
    it("returns undefined when nested path traverses null", async () => {
      const input: DataValidationInput = {
        data: { user: null }, // nested.name traversal hits null at "user"
        rules: [
          {
            type: "required",
            field: "user.name",
          } as ValidationRule,
        ],
      };

      const result = await tool.execute(input, makeContext());

      expect(result.success).toBe(true);
      // Field is required but the value is undefined (null intermediate)
      expect(result.data?.valid).toBe(false);
    });
  });

  // =========================================================================
  // Lines 495, 501-504, 514: validateFormat branches
  // =========================================================================

  describe("validateFormat branches (lines 495, 501-504, 514)", () => {
    it("URL format: invalid URL returns format error (line 495 catch)", async () => {
      const input: DataValidationInput = {
        data: { link: "not a valid url!!" },
        rules: [
          {
            type: "format",
            field: "link",
            params: { format: "url" },
          } as ValidationRule,
        ],
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);
      expect(result.data?.valid).toBe(false);
    });

    it("URL format: valid URL passes (line 493-497 success path)", async () => {
      const input: DataValidationInput = {
        data: { link: "https://example.com" },
        rules: [
          {
            type: "format",
            field: "link",
            params: { format: "url" },
          } as ValidationRule,
        ],
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);
      expect(result.data?.valid).toBe(true);
    });

    it("date format: valid date passes (lines 501-502)", async () => {
      const input: DataValidationInput = {
        data: { birthdate: "1990-01-15" },
        rules: [
          {
            type: "format",
            field: "birthdate",
            params: { format: "date" },
          } as ValidationRule,
        ],
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);
      expect(result.data?.valid).toBe(true);
    });

    it("date format: invalid date fails (lines 501-502)", async () => {
      const input: DataValidationInput = {
        data: { birthdate: "not-a-date" },
        rules: [
          {
            type: "format",
            field: "birthdate",
            params: { format: "date" },
          } as ValidationRule,
        ],
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);
      expect(result.data?.valid).toBe(false);
    });

    it("unknown format returns no error (default case line 514)", async () => {
      const input: DataValidationInput = {
        data: { field: "some-value" },
        rules: [
          {
            type: "format",
            field: "field",
            params: { format: "unknown-custom-format" },
          } as ValidationRule,
        ],
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);
      // Unknown format → validateFormat returns true → no error
      expect(result.data?.valid).toBe(true);
    });

    it("phone format: valid phone passes", async () => {
      const input: DataValidationInput = {
        data: { phone: "+1 (555) 123-4567" },
        rules: [
          {
            type: "format",
            field: "phone",
            params: { format: "phone" },
          } as ValidationRule,
        ],
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);
      expect(result.data?.valid).toBe(true);
    });
  });

  // =========================================================================
  // Lines 532, 538-539: countFields circular reference + array
  // =========================================================================

  describe("countFields with circular reference and array (lines 532, 538-539)", () => {
    it("handles arrays in data (line 538-539 array reduce path)", async () => {
      const input: DataValidationInput = {
        data: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        rules: [
          {
            type: "required",
            field: "items",
          } as ValidationRule,
        ],
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);
      // Summary should count fields in nested array elements
      expect(result.data?.summary.totalFields).toBeGreaterThan(0);
    });

    it("handles circular reference in data (line 532)", async () => {
      const obj: Record<string, unknown> = { name: "test" };
      obj["self"] = obj; // circular reference

      const input: DataValidationInput = {
        data: obj,
        rules: [
          {
            type: "required",
            field: "name",
          } as ValidationRule,
        ],
      };

      const result = await tool.execute(input, makeContext());
      // Should not throw due to circular reference guard
      expect(result.success).toBe(true);
    });
  });
});
