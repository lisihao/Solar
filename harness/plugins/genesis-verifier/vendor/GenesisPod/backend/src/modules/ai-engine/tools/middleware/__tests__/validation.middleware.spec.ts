/**
 * Unit tests for ValidationMiddleware
 */

import * as fs from "fs";
import * as path from "path";
import {
  ValidationMiddleware,
  createValidationMiddleware,
} from "../validation.middleware";
import { ValidationError } from "@/modules/ai-engine/facade/abstractions/engine.error";
import {
  ITool,
  ToolCategory,
  ToolContext,
  ToolResult,
  JSONSchema,
} from "../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(
  id: string = "test-tool",
  inputSchema: JSONSchema = { type: "object" },
  overrides: Partial<ITool> = {},
): ITool {
  return {
    id,
    name: `Tool ${id}`,
    description: "Test",
    category: "information" as ToolCategory,
    inputSchema,
    outputSchema: { type: "object" },
    enabled: true,
    cancellable: true,
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
    toFunctionDefinition: () => ({
      name: id,
      description: "Test",
      parameters: {},
    }),
    toCompactSummary: () => ({
      id,
      name: `Tool ${id}`,
      brief: "Test",
      category: "information" as ToolCategory,
    }),
    ...overrides,
  };
}

function makeContext(): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "test-tool",
    createdAt: new Date(),
  };
}

function makeSuccessResult(): ToolResult {
  return {
    success: true,
    data: { value: "ok" },
    metadata: {
      executionId: "e",
      startTime: new Date(),
      endTime: new Date(),
      duration: 10,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ValidationMiddleware", () => {
  // -------------------------------------------------------------------------
  // Constructor and metadata
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it('has name "validation"', () => {
      const mw = new ValidationMiddleware();
      expect(mw.name).toBe("validation");
    });

    it("has priority 10", () => {
      const mw = new ValidationMiddleware();
      expect(mw.priority).toBe(10);
    });

    it("defaults validateInput to true", async () => {
      const tool = makeTool(
        "t",
        { type: "object", required: ["name"] },
        {
          validateInput: () => ({
            valid: false,
            errors: [{ path: "name", message: "required", type: "required" }],
          }),
        },
      );
      const mw = new ValidationMiddleware(); // default validateInput=true
      // Should throw because validateInput fails
      await expect(mw.before({}, makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });

    it("can disable validateInput via config", async () => {
      const tool = makeTool(
        "t",
        { type: "object", required: ["name"] },
        {
          validateInput: () => ({ valid: false, errors: [] }),
        },
      );
      const mw = new ValidationMiddleware({ validateInput: false });
      // Should NOT throw since validation is disabled
      await expect(mw.before({}, makeContext(), tool)).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // before() — tool.validateInput() used
  // -------------------------------------------------------------------------

  describe("before() — tool.validateInput()", () => {
    it("passes validation when tool.validateInput returns { valid: true }", async () => {
      const tool = makeTool(
        "t",
        { type: "object" },
        {
          validateInput: () => ({ valid: true }),
        },
      );
      const mw = new ValidationMiddleware();
      await expect(
        mw.before({ key: "val" }, makeContext(), tool),
      ).resolves.toBeUndefined();
    });

    it("throws ValidationError when tool.validateInput returns { valid: false }", async () => {
      const tool = makeTool(
        "t",
        { type: "object" },
        {
          validateInput: () => ({
            valid: false,
            errors: [{ path: "field", message: "Required", type: "required" }],
          }),
        },
      );
      const mw = new ValidationMiddleware();
      await expect(mw.before({}, makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });

    it("throws ValidationError when tool.validateInput returns boolean false", async () => {
      const tool = makeTool(
        "t",
        { type: "object" },
        {
          validateInput: () => false,
        },
      );
      const mw = new ValidationMiddleware();
      await expect(mw.before({}, makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });

    it("does not throw when tool.validateInput returns boolean true", async () => {
      const tool = makeTool(
        "t",
        { type: "object" },
        {
          validateInput: () => true,
        },
      );
      const mw = new ValidationMiddleware();
      await expect(
        mw.before({ data: 1 }, makeContext(), tool),
      ).resolves.toBeUndefined();
    });

    it("error message includes tool id when validateInput fails", async () => {
      const tool = makeTool(
        "my-tool",
        { type: "object" },
        {
          validateInput: () => ({ valid: false, errors: [] }),
        },
      );
      const mw = new ValidationMiddleware();
      let errorMsg = "";
      try {
        await mw.before({}, makeContext(), tool);
      } catch (e) {
        errorMsg = (e as Error).message;
      }
      expect(errorMsg).toContain("my-tool");
    });
  });

  // -------------------------------------------------------------------------
  // before() — schema validation (no tool.validateInput)
  // -------------------------------------------------------------------------

  describe("before() — JSON schema validation", () => {
    it("passes when input matches the schema type", async () => {
      const tool = makeTool("t", { type: "object" });
      const mw = new ValidationMiddleware();
      await expect(
        mw.before({ key: "val" }, makeContext(), tool),
      ).resolves.toBeUndefined();
    });

    it("throws when input does not match schema type", async () => {
      const tool = makeTool("t", { type: "object" });
      const mw = new ValidationMiddleware();
      // passing a string instead of object
      await expect(
        mw.before("not-an-object", makeContext(), tool),
      ).rejects.toThrow(ValidationError);
    });

    it("validates required properties", async () => {
      const tool = makeTool("t", {
        type: "object",
        required: ["name", "value"],
      });
      const mw = new ValidationMiddleware();
      // missing "value"
      await expect(
        mw.before({ name: "Alice" }, makeContext(), tool),
      ).rejects.toThrow(ValidationError);
    });

    it("passes when all required properties are present", async () => {
      const tool = makeTool("t", {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      });
      const mw = new ValidationMiddleware();
      await expect(
        mw.before({ name: "Alice" }, makeContext(), tool),
      ).resolves.toBeUndefined();
    });

    it("validates nested property types", async () => {
      const tool = makeTool("t", {
        type: "object",
        properties: {
          count: { type: "number" },
        },
      });
      const mw = new ValidationMiddleware();
      // count should be number, not string
      await expect(
        mw.before({ count: "not-a-number" }, makeContext(), tool),
      ).rejects.toThrow(ValidationError);
    });

    it("validates string minLength", async () => {
      const tool = makeTool("t", {
        type: "string",
        minLength: 5,
      });
      const mw = new ValidationMiddleware();
      await expect(mw.before("hi", makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });

    it("passes string that meets minLength", async () => {
      const tool = makeTool("t", {
        type: "string",
        minLength: 3,
      });
      const mw = new ValidationMiddleware();
      await expect(
        mw.before("hello", makeContext(), tool),
      ).resolves.toBeUndefined();
    });

    it("validates string maxLength", async () => {
      const tool = makeTool("t", {
        type: "string",
        maxLength: 5,
      });
      const mw = new ValidationMiddleware();
      await expect(
        mw.before("too-long-string", makeContext(), tool),
      ).rejects.toThrow(ValidationError);
    });

    it("validates number minimum", async () => {
      const tool = makeTool("t", { type: "number", minimum: 10 });
      const mw = new ValidationMiddleware();
      await expect(mw.before(5, makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });

    it("validates number maximum", async () => {
      const tool = makeTool("t", { type: "number", maximum: 100 });
      const mw = new ValidationMiddleware();
      await expect(mw.before(200, makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });

    it("passes number within range", async () => {
      const tool = makeTool("t", { type: "number", minimum: 1, maximum: 100 });
      const mw = new ValidationMiddleware();
      await expect(mw.before(50, makeContext(), tool)).resolves.toBeUndefined();
    });

    it("validates enum constraint", async () => {
      const tool = makeTool("t", {
        type: "string",
        enum: ["a", "b", "c"],
      });
      const mw = new ValidationMiddleware();
      await expect(mw.before("d", makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });

    it("passes enum value that matches", async () => {
      const tool = makeTool("t", {
        type: "string",
        enum: ["a", "b", "c"],
      });
      const mw = new ValidationMiddleware();
      await expect(
        mw.before("b", makeContext(), tool),
      ).resolves.toBeUndefined();
    });

    it("validates array item types", async () => {
      const tool = makeTool("t", {
        type: "array",
        items: { type: "number" },
      });
      const mw = new ValidationMiddleware();
      await expect(
        mw.before([1, "two", 3], makeContext(), tool),
      ).rejects.toThrow(ValidationError);
    });

    it("passes a valid array with correct item types", async () => {
      const tool = makeTool("t", {
        type: "array",
        items: { type: "number" },
      });
      const mw = new ValidationMiddleware();
      await expect(
        mw.before([1, 2, 3], makeContext(), tool),
      ).resolves.toBeUndefined();
    });

    it("passes when schema has no type (permissive)", async () => {
      const tool = makeTool("t", {});
      const mw = new ValidationMiddleware();
      await expect(
        mw.before({ anything: true }, makeContext(), tool),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // before() — custom validator
  // -------------------------------------------------------------------------

  describe("before() — customValidator", () => {
    it("calls custom validator when provided", async () => {
      const customValidator = jest.fn().mockReturnValue({ valid: true });
      const tool = makeTool("t", { type: "object" });
      const mw = new ValidationMiddleware({ customValidator });

      await mw.before({ key: "val" }, makeContext(), tool);

      expect(customValidator).toHaveBeenCalledWith(
        { key: "val" },
        tool.inputSchema,
      );
    });

    it("throws when custom validator returns invalid", async () => {
      const customValidator = jest.fn().mockReturnValue({
        valid: false,
        errors: [{ path: "", message: "Custom fail", type: "custom" }],
      });
      const tool = makeTool("t", { type: "object" });
      const mw = new ValidationMiddleware({ customValidator });

      await expect(
        mw.before({ key: "val" }, makeContext(), tool),
      ).rejects.toThrow(ValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // after() — output validation
  // -------------------------------------------------------------------------

  describe("after() — output validation enabled (default)", () => {
    it("returns result unchanged when output matches default outputSchema", async () => {
      const tool = makeTool("t", { type: "object" });
      // validateOutput defaults to true (strict by default)
      const mw = new ValidationMiddleware();
      const result = makeSuccessResult();

      // result.data = { value: "ok" } matches outputSchema { type: "object" }
      const out = await mw.after(result, makeContext(), tool);
      expect(out).toBe(result);
    });

    it("returns result unchanged for failed results even when validateOutput true", async () => {
      const tool = makeTool("t");
      const mw = new ValidationMiddleware({ validateOutput: true });
      const failResult: ToolResult = {
        success: false,
        error: { code: "ERR", message: "Fail" },
        metadata: {
          executionId: "e",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      };

      const out = await mw.after(failResult, makeContext(), tool);
      expect(out).toBe(failResult);
    });
  });

  describe("after() — output validation explicit config", () => {
    it("returns result when output matches output schema", async () => {
      const tool = makeTool(
        "t",
        { type: "object" },
        {
          outputSchema: { type: "object" },
        },
      );
      const mw = new ValidationMiddleware({ validateOutput: true });
      const result = makeSuccessResult();

      const out = await mw.after(result, makeContext(), tool);
      expect(out).toBe(result);
    });

    it("throws ValidationError when output does not match schema (strict is default)", async () => {
      delete process.env.STRICT_OUTPUT_VALIDATION;
      const tool = makeTool(
        "t",
        { type: "object" },
        {
          outputSchema: { type: "string" }, // output should be string
        },
      );
      const mw = new ValidationMiddleware({ validateOutput: true });
      // data is an object, output schema says string — should throw
      const result = makeSuccessResult();

      await expect(mw.after(result, makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // STRICT_OUTPUT_VALIDATION flag behaviour
  // -------------------------------------------------------------------------

  describe("STRICT_OUTPUT_VALIDATION flag", () => {
    afterEach(() => {
      delete process.env.STRICT_OUTPUT_VALIDATION;
    });

    it("flag=undefined (default): output schema failure throws ValidationError", async () => {
      delete process.env.STRICT_OUTPUT_VALIDATION;

      const tool = makeTool(
        "strict-default",
        { type: "object" },
        { outputSchema: { type: "string" } },
      );
      // Default constructor: validateOutput=true (strict on by default)
      const mw = new ValidationMiddleware();
      const result = makeSuccessResult();

      await expect(mw.after(result, makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });

    it("flag=0: output schema failure returns result without throwing (escape hatch)", async () => {
      process.env.STRICT_OUTPUT_VALIDATION = "0";

      const tool = makeTool(
        "strict-off",
        { type: "object" },
        { outputSchema: { type: "string" } },
      );
      // When env=0, validateOutput defaults to false — no throw
      const mw = new ValidationMiddleware();
      const result = makeSuccessResult();

      const out = await mw.after(result, makeContext(), tool);
      expect(out).toBe(result);
    });

    it("flag=0 but result.success=false: early-returns without schema check (no throw)", async () => {
      process.env.STRICT_OUTPUT_VALIDATION = "0";

      const tool = makeTool(
        "strict-fail-skip",
        { type: "object" },
        { outputSchema: { type: "string" } },
      );
      const mw = new ValidationMiddleware();
      const failResult: ToolResult = {
        success: false,
        error: { code: "ERR", message: "upstream failure" },
        metadata: {
          executionId: "e",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      };

      const out = await mw.after(failResult, makeContext(), tool);
      expect(out).toBe(failResult);
    });

    it("flag=undefined and output matches schema: returns result without throwing", async () => {
      delete process.env.STRICT_OUTPUT_VALIDATION;

      const tool = makeTool(
        "strict-pass",
        { type: "object" },
        { outputSchema: { type: "object" } },
      );
      const mw = new ValidationMiddleware();
      const result = makeSuccessResult();

      const out = await mw.after(result, makeContext(), tool);
      expect(out).toBe(result);
    });
  });

  // -------------------------------------------------------------------------
  // createValidationMiddleware factory
  // -------------------------------------------------------------------------

  describe("createValidationMiddleware()", () => {
    it("returns a ValidationMiddleware instance", () => {
      const mw = createValidationMiddleware();
      expect(mw).toBeInstanceOf(ValidationMiddleware);
    });

    it("accepts config options", async () => {
      const mw = createValidationMiddleware({ validateInput: false });
      const tool = makeTool(
        "t",
        { type: "object" },
        {
          validateInput: () => false, // would fail if validateInput were enabled
        },
      );
      // Should not throw since validateInput is disabled
      await expect(mw.before({}, makeContext(), tool)).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Type detection helpers
  // -------------------------------------------------------------------------

  describe("type detection", () => {
    it('detects null as "null"', async () => {
      const tool = makeTool("t", { type: "string" });
      const mw = new ValidationMiddleware();
      await expect(mw.before(null, makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });

    it('detects array correctly (not as "object")', async () => {
      const tool = makeTool("t", { type: "object" });
      const mw = new ValidationMiddleware();
      // Array should fail object type check
      await expect(mw.before([], makeContext(), tool)).rejects.toThrow(
        ValidationError,
      );
    });

    it('accepts array when schema type is "array"', async () => {
      const tool = makeTool("t", { type: "array" });
      const mw = new ValidationMiddleware();
      await expect(mw.before([], makeContext(), tool)).resolves.toBeUndefined();
    });

    it("accepts boolean type", async () => {
      const tool = makeTool("t", { type: "boolean" });
      const mw = new ValidationMiddleware();
      await expect(
        mw.before(true, makeContext(), tool),
      ).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// zod-powered validation — new capabilities
// ---------------------------------------------------------------------------

describe("zod-powered validation", () => {
  const mw = new ValidationMiddleware();

  it("1. enum field: rejects value not in enum list", async () => {
    const tool = makeTool("t", { type: "string", enum: ["a", "b"] });
    await expect(mw.before("c", makeContext(), tool)).rejects.toThrow(
      ValidationError,
    );
  });

  it("2. nested properties: error path contains dotted key", async () => {
    const tool = makeTool("t", {
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: { leaf: { type: "number" } },
        },
      },
    });
    let caughtError: ValidationError | undefined;
    try {
      await mw.before(
        { nested: { leaf: "not-a-number" } },
        makeContext(),
        tool,
      );
    } catch (e) {
      caughtError = e as ValidationError;
    }
    expect(caughtError).toBeInstanceOf(ValidationError);
    const errs = (caughtError as ValidationError).validationErrors;
    expect(
      errs.some((e) => e.path.includes("nested") && e.path.includes("leaf")),
    ).toBe(true);
  });

  it("3. minLength + maxLength together: too-long string is rejected", async () => {
    const tool = makeTool("t", {
      type: "string",
      minLength: 2,
      maxLength: 5,
    });
    await expect(mw.before("toolongstr", makeContext(), tool)).rejects.toThrow(
      ValidationError,
    );
  });

  it("4. array items type mismatch: each bad element produces an error", async () => {
    const tool = makeTool("t", {
      type: "array",
      items: { type: "number" },
    });
    let caughtError: ValidationError | undefined;
    try {
      await mw.before(["a", "b"], makeContext(), tool);
    } catch (e) {
      caughtError = e as ValidationError;
    }
    expect(caughtError).toBeInstanceOf(ValidationError);
  });

  it("5. $ref in schema: falls back gracefully without throwing", async () => {
    const tool = makeTool("t", { $ref: "#/definitions/Foo" } as JSONSchema);
    // fallback to z.unknown() path — z.unknown() accepts anything, so no throw
    await expect(
      mw.before({ anything: true }, makeContext(), tool),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sideEffect coverage audit
// ---------------------------------------------------------------------------

describe("sideEffect coverage audit", () => {
  it("every .tool.ts file in categories/ declares readonly sideEffect =", () => {
    const categoriesDir = path.resolve(__dirname, "../../../tools/categories");

    const missing: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".tool.ts")) {
          const source = fs.readFileSync(fullPath, "utf8");
          if (!/readonly sideEffect\s*=/.test(source)) {
            missing.push(
              path.relative(categoriesDir, fullPath).replace(/\\/g, "/"),
            );
          }
        }
      }
    };

    walk(categoriesDir);

    if (missing.length > 0) {
      throw new Error(
        `${missing.length} tool(s) missing sideEffect field:\n  ${missing.join("\n  ")}`,
      );
    }
    expect(missing).toHaveLength(0);
  });
});
