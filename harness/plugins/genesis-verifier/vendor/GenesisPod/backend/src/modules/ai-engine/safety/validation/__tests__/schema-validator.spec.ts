/**
 * Unit Tests - SchemaValidator
 */

import { SchemaValidator } from "../schema-validator";
import { JsonSchema } from "../schema-validator";

describe("SchemaValidator", () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  // ─── type validation ──────────────────────────────────────────────────────

  describe("type validation", () => {
    it("passes for string type", () => {
      expect(validator.validate("hello", { type: "string" }).valid).toBe(true);
    });

    it("fails for wrong type (number given for string)", () => {
      const result = validator.validate(42, { type: "string" });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0].type).toBe("type");
    });

    it("passes for number type", () => {
      expect(validator.validate(3.14, { type: "number" }).valid).toBe(true);
    });

    it("fails for NaN as number", () => {
      expect(validator.validate(NaN, { type: "number" }).valid).toBe(false);
    });

    it("passes for integer type with integer value", () => {
      expect(validator.validate(5, { type: "integer" }).valid).toBe(true);
    });

    it("fails for float as integer", () => {
      expect(validator.validate(5.5, { type: "integer" }).valid).toBe(false);
    });

    it("passes for boolean type", () => {
      expect(validator.validate(true, { type: "boolean" }).valid).toBe(true);
      expect(validator.validate(false, { type: "boolean" }).valid).toBe(true);
    });

    it("passes for array type", () => {
      expect(validator.validate([1, 2, 3], { type: "array" }).valid).toBe(true);
    });

    it("fails for object given for array", () => {
      expect(validator.validate({}, { type: "array" }).valid).toBe(false);
    });

    it("passes for object type", () => {
      expect(validator.validate({ a: 1 }, { type: "object" }).valid).toBe(true);
    });

    it("fails for null as object type", () => {
      expect(validator.validate(null, { type: "object" }).valid).toBe(false);
    });

    it("fails for array as object type", () => {
      expect(validator.validate([], { type: "object" }).valid).toBe(false);
    });

    it("passes for null type", () => {
      expect(validator.validate(null, { type: "null" }).valid).toBe(true);
    });

    it("passes for union types", () => {
      const schema: JsonSchema = { type: ["string", "null"] };
      expect(validator.validate("hello", schema).valid).toBe(true);
      expect(validator.validate(null, schema).valid).toBe(true);
      expect(validator.validate(42, schema).valid).toBe(false);
    });

    it("passes for unknown type keyword (treated as any)", () => {
      expect(
        validator.validate("anything", { type: "custom-type" }).valid,
      ).toBe(true);
    });
  });

  // ─── enum validation ─────────────────────────────────────────────────────

  describe("enum validation", () => {
    it("passes when value is in enum list", () => {
      expect(
        validator.validate("red", { enum: ["red", "green", "blue"] }).valid,
      ).toBe(true);
    });

    it("fails when value is not in enum", () => {
      const result = validator.validate("yellow", {
        enum: ["red", "green", "blue"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0].type).toBe("enum");
    });

    it("handles numeric enum values", () => {
      expect(validator.validate(1, { enum: [1, 2, 3] }).valid).toBe(true);
      expect(validator.validate(4, { enum: [1, 2, 3] }).valid).toBe(false);
    });
  });

  // ─── object validation ────────────────────────────────────────────────────

  describe("object validation", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["name", "age"],
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
        email: { type: "string" },
      },
    };

    it("passes valid object", () => {
      const result = validator.validate({ name: "Alice", age: 30 }, schema);
      expect(result.valid).toBe(true);
    });

    it("fails when required field is missing", () => {
      const result = validator.validate({ name: "Alice" }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path.includes("age"))).toBe(true);
    });

    it("fails when required field has wrong type", () => {
      const result = validator.validate(
        { name: "Alice", age: "thirty" },
        schema,
      );
      expect(result.valid).toBe(false);
    });

    it("passes with extra properties when additionalProperties not set", () => {
      const result = validator.validate(
        { name: "Alice", age: 30, extra: "value" },
        schema,
      );
      expect(result.valid).toBe(true);
    });

    it("fails extra properties when additionalProperties=false", () => {
      const strictSchema: JsonSchema = {
        type: "object",
        properties: { name: { type: "string" } },
        additionalProperties: false,
      };
      const result = validator.validate(
        { name: "Alice", extra: "bad" },
        strictSchema,
      );
      expect(result.valid).toBe(false);
      expect(
        result.errors?.some((e) => e.type === "additionalProperties"),
      ).toBe(true);
    });

    it("validates nested properties", () => {
      const nestedSchema: JsonSchema = {
        type: "object",
        properties: {
          address: {
            type: "object",
            required: ["city"],
            properties: {
              city: { type: "string" },
            },
          },
        },
      };
      const result = validator.validate(
        { address: { city: "NYC" } },
        nestedSchema,
      );
      expect(result.valid).toBe(true);
    });

    it("fails when nested required field missing", () => {
      const nestedSchema: JsonSchema = {
        type: "object",
        properties: {
          address: {
            type: "object",
            required: ["city"],
            properties: { city: { type: "string" } },
          },
        },
      };
      const result = validator.validate({ address: {} }, nestedSchema);
      expect(result.valid).toBe(false);
    });
  });

  // ─── array validation ─────────────────────────────────────────────────────

  describe("array validation", () => {
    it("passes valid array of strings", () => {
      const schema: JsonSchema = {
        type: "array",
        items: { type: "string" },
      };
      expect(validator.validate(["a", "b", "c"], schema).valid).toBe(true);
    });

    it("fails when array item has wrong type", () => {
      const schema: JsonSchema = {
        type: "array",
        items: { type: "string" },
      };
      const result = validator.validate(["a", 42, "c"], schema);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path.includes("[1]"))).toBe(true);
    });

    it("passes empty array", () => {
      expect(validator.validate([], { type: "array" }).valid).toBe(true);
    });

    it("validates array of objects", () => {
      const schema: JsonSchema = {
        type: "array",
        items: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "integer" } },
        },
      };
      expect(validator.validate([{ id: 1 }, { id: 2 }], schema).valid).toBe(
        true,
      );
      expect(
        validator.validate([{ id: 1 }, { notId: "x" }], schema).valid,
      ).toBe(false);
    });
  });

  // ─── string constraints ───────────────────────────────────────────────────

  describe("string constraints", () => {
    it("passes string meeting minLength", () => {
      expect(
        validator.validate("hello", { type: "string", minLength: 3 }).valid,
      ).toBe(true);
    });

    it("fails string below minLength", () => {
      const result = validator.validate("hi", { type: "string", minLength: 3 });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0].type).toBe("minLength");
    });

    it("passes string below maxLength", () => {
      expect(
        validator.validate("hi", { type: "string", maxLength: 10 }).valid,
      ).toBe(true);
    });

    it("fails string above maxLength", () => {
      const result = validator.validate("hello world", {
        type: "string",
        maxLength: 5,
      });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0].type).toBe("maxLength");
    });

    it("passes string matching pattern", () => {
      expect(
        validator.validate("abc123", { type: "string", pattern: "^[a-z0-9]+$" })
          .valid,
      ).toBe(true);
    });

    it("fails string not matching pattern", () => {
      const result = validator.validate("ABC!", {
        type: "string",
        pattern: "^[a-z0-9]+$",
      });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0].type).toBe("pattern");
    });

    describe("format: email", () => {
      it("passes valid email", () => {
        expect(
          validator.validate("user@example.com", {
            type: "string",
            format: "email",
          }).valid,
        ).toBe(true);
      });

      it("fails invalid email", () => {
        expect(
          validator.validate("not-an-email", {
            type: "string",
            format: "email",
          }).valid,
        ).toBe(false);
      });
    });

    describe("format: uri", () => {
      it("passes valid URI", () => {
        expect(
          validator.validate("https://example.com/path", {
            type: "string",
            format: "uri",
          }).valid,
        ).toBe(true);
      });

      it("fails invalid URI", () => {
        expect(
          validator.validate("not a url", { type: "string", format: "uri" })
            .valid,
        ).toBe(false);
      });
    });

    describe("format: date", () => {
      it("passes valid date string", () => {
        expect(
          validator.validate("2024-01-15", { type: "string", format: "date" })
            .valid,
        ).toBe(true);
      });

      it("fails invalid date", () => {
        expect(
          validator.validate("not-a-date", { type: "string", format: "date" })
            .valid,
        ).toBe(false);
      });
    });

    describe("format: uuid", () => {
      it("passes valid UUID", () => {
        expect(
          validator.validate("550e8400-e29b-41d4-a716-446655440000", {
            type: "string",
            format: "uuid",
          }).valid,
        ).toBe(true);
      });

      it("fails invalid UUID", () => {
        expect(
          validator.validate("not-a-uuid", { type: "string", format: "uuid" })
            .valid,
        ).toBe(false);
      });
    });

    it("passes for unknown format (treated as valid)", () => {
      expect(
        validator.validate("anything", {
          type: "string",
          format: "custom-format",
        }).valid,
      ).toBe(true);
    });
  });

  // ─── number constraints ───────────────────────────────────────────────────

  describe("number constraints", () => {
    it("passes number >= minimum", () => {
      expect(validator.validate(5, { type: "number", minimum: 5 }).valid).toBe(
        true,
      );
    });

    it("fails number < minimum", () => {
      const result = validator.validate(4, { type: "number", minimum: 5 });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0].type).toBe("minimum");
    });

    it("passes number <= maximum", () => {
      expect(
        validator.validate(10, { type: "number", maximum: 10 }).valid,
      ).toBe(true);
    });

    it("fails number > maximum", () => {
      const result = validator.validate(11, { type: "number", maximum: 10 });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0].type).toBe("maximum");
    });

    it("passes integer with min/max constraints", () => {
      const schema: JsonSchema = { type: "integer", minimum: 1, maximum: 100 };
      expect(validator.validate(50, schema).valid).toBe(true);
      expect(validator.validate(0, schema).valid).toBe(false);
    });
  });

  // ─── composite schemas ────────────────────────────────────────────────────

  describe("oneOf", () => {
    const schema: JsonSchema = {
      oneOf: [{ type: "string" }, { type: "number" }],
    };

    it("passes when exactly one schema matches", () => {
      expect(validator.validate("hello", schema).valid).toBe(true);
      expect(validator.validate(42, schema).valid).toBe(true);
    });

    it("fails when no schemas match", () => {
      expect(validator.validate([], schema).valid).toBe(false);
    });

    it("fails when more than one schema matches", () => {
      // Both string and null wouldn't match both; but string/string would
      const bothMatch: JsonSchema = {
        oneOf: [{ type: "string" }, { type: "string", minLength: 1 }],
      };
      // "hello" matches both -> should fail
      expect(validator.validate("hello", bothMatch).valid).toBe(false);
    });
  });

  describe("anyOf", () => {
    const schema: JsonSchema = {
      anyOf: [
        { type: "string", minLength: 5 },
        { type: "number", minimum: 10 },
      ],
    };

    it("passes when at least one schema matches", () => {
      expect(validator.validate("hello world", schema).valid).toBe(true);
      expect(validator.validate(42, schema).valid).toBe(true);
    });

    it("fails when no schema matches", () => {
      const result = validator.validate("hi", schema); // too short, not a number
      expect(result.valid).toBe(false);
    });
  });

  describe("allOf", () => {
    const schema: JsonSchema = {
      allOf: [
        { type: "string", minLength: 3 },
        { type: "string", maxLength: 10 },
      ],
    };

    it("passes when all schemas match", () => {
      expect(validator.validate("hello", schema).valid).toBe(true);
    });

    it("fails when any schema fails", () => {
      expect(validator.validate("hi", schema).valid).toBe(false); // too short
      expect(validator.validate("hello world!", schema).valid).toBe(false); // too long
    });
  });

  describe("not", () => {
    const schema: JsonSchema = {
      not: { type: "string" },
    };

    it("passes when value does NOT match inner schema", () => {
      expect(validator.validate(42, schema).valid).toBe(true);
      expect(validator.validate(null, schema).valid).toBe(true);
    });

    it("fails when value matches the inner schema", () => {
      const result = validator.validate("hello", schema);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0].type).toBe("not");
    });
  });

  // ─── error message format ─────────────────────────────────────────────────

  describe("error message format", () => {
    it("error has path, message, and type fields", () => {
      const result = validator.validate(42, { type: "string" });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toMatchObject({
        path: expect.any(String),
        message: expect.any(String),
        type: expect.any(String),
      });
    });

    it("includes nested path for object property errors", () => {
      const schema: JsonSchema = {
        type: "object",
        properties: { name: { type: "string" } },
      };
      const result = validator.validate({ name: 123 }, schema);
      expect(result.errors?.some((e) => e.path.includes("name"))).toBe(true);
    });
  });

  // ─── no-schema / empty schema ─────────────────────────────────────────────

  describe("no constraint in schema", () => {
    it("passes anything when schema is empty", () => {
      expect(validator.validate("anything", {}).valid).toBe(true);
      expect(validator.validate(42, {}).valid).toBe(true);
      expect(validator.validate(null, {}).valid).toBe(true);
    });
  });
});
