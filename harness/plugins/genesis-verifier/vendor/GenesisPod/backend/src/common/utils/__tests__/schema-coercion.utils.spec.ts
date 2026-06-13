/**
 * Schema Coercion Helpers — Unit Tests
 *
 * Covers the drift patterns local / quantized / reasoning models produce
 * (strings for numbers, floats for ints, novel enum tokens, etc.) and
 * verifies the fail-CLOSED contract for enum fallbacks.
 */

import {
  coercedScore,
  coercedInt,
  coercedEnum,
  parseNonNegativeIntEnv,
  parsePositiveIntEnv,
  parseBooleanEnv,
} from "../schema-coercion.utils";

describe("schema-coercion.utils", () => {
  describe("coercedScore", () => {
    const schema = coercedScore(0, 100);

    it("accepts in-range numbers verbatim", () => {
      expect(schema.parse(85)).toBe(85);
      expect(schema.parse(0)).toBe(0);
      expect(schema.parse(100)).toBe(100);
    });

    it("coerces numeric strings", () => {
      expect(schema.parse("85")).toBe(85);
      expect(schema.parse(" 42 ")).toBe(42);
      expect(schema.parse("3.5")).toBe(3.5);
    });

    it("clamps out-of-range values rather than rejecting", () => {
      expect(schema.parse(150)).toBe(100);
      expect(schema.parse(-5)).toBe(0);
      expect(schema.parse("999")).toBe(100);
    });

    it("rejects non-numeric junk", () => {
      expect(() => schema.parse("not a number")).toThrow();
      expect(() => schema.parse(null)).toThrow();
      expect(() => schema.parse(undefined)).toThrow();
    });

    it("respects custom min/max", () => {
      const tight = coercedScore(40, 60);
      expect(tight.parse(50)).toBe(50);
      expect(tight.parse(10)).toBe(40);
      expect(tight.parse(99)).toBe(60);
    });
  });

  describe("coercedInt", () => {
    const schema = coercedInt(0, 1000);

    it("accepts integers verbatim", () => {
      expect(schema.parse(5)).toBe(5);
    });

    it("floors floats", () => {
      expect(schema.parse(5.7)).toBe(5);
      expect(schema.parse(5.0)).toBe(5);
    });

    it("coerces numeric strings, flooring as needed", () => {
      expect(schema.parse("5")).toBe(5);
      expect(schema.parse("5.9")).toBe(5);
    });

    it("clamps out-of-range", () => {
      expect(schema.parse(9999)).toBe(1000);
      expect(schema.parse(-3)).toBe(0);
    });
  });

  describe("coercedEnum", () => {
    const VALUES = ["pass", "revise"] as const;

    it("accepts allowed values", () => {
      const schema = coercedEnum(VALUES, "revise");
      expect(schema.parse("pass")).toBe("pass");
      expect(schema.parse("revise")).toBe("revise");
    });

    it("normalizes case", () => {
      const schema = coercedEnum(VALUES, "revise");
      expect(schema.parse("Pass")).toBe("pass");
      expect(schema.parse("REVISE")).toBe("revise");
      expect(schema.parse("  pass  ")).toBe("pass");
    });

    it("falls back to the conservative default for unknown tokens", () => {
      const schema = coercedEnum(VALUES, "revise");
      // FAIL-CLOSED: hallucinated decisions never widen to "pass"
      expect(schema.parse("approve")).toBe("revise");
      expect(schema.parse("accept")).toBe("revise");
      expect(schema.parse("")).toBe("revise");
    });

    it("falls back when value is null/undefined/non-string", () => {
      const schema = coercedEnum(VALUES, "revise");
      expect(schema.parse(null)).toBe("revise");
      expect(schema.parse(undefined)).toBe("revise");
      expect(schema.parse(42)).toBe("revise");
    });

    it("rejects construction with a default not in the allowed set", () => {
      expect(() =>
        coercedEnum(VALUES, "approve" as unknown as "revise"),
      ).toThrow(/defaultValue/);
    });
  });

  describe("parseNonNegativeIntEnv", () => {
    it("returns default for unset / empty / whitespace", () => {
      expect(parseNonNegativeIntEnv(undefined, 10)).toBe(10);
      expect(parseNonNegativeIntEnv("", 10)).toBe(10);
      expect(parseNonNegativeIntEnv("   ", 10)).toBe(10);
    });

    it("parses valid non-negative ints", () => {
      expect(parseNonNegativeIntEnv("5", 10)).toBe(5);
      expect(parseNonNegativeIntEnv("0", 10)).toBe(0);
      expect(parseNonNegativeIntEnv(" 7 ", 10)).toBe(7);
    });

    it("falls back for negative or non-integer", () => {
      expect(parseNonNegativeIntEnv("-3", 10)).toBe(10);
      expect(parseNonNegativeIntEnv("3.5", 10)).toBe(10);
      expect(parseNonNegativeIntEnv("abc", 10)).toBe(10);
    });

    it("falls back for 0 when allowZero=false", () => {
      expect(parseNonNegativeIntEnv("0", 10, { allowZero: false })).toBe(10);
    });
  });

  describe("parsePositiveIntEnv", () => {
    it("falls back for 0", () => {
      expect(parsePositiveIntEnv("0", 5)).toBe(5);
    });
    it("accepts >= 1", () => {
      expect(parsePositiveIntEnv("1", 5)).toBe(1);
      expect(parsePositiveIntEnv("999", 5)).toBe(999);
    });
  });

  describe("parseBooleanEnv", () => {
    it.each(["1", "true", "yes", "on", "TRUE", " yes "])(
      "treats %s as true",
      (raw) => {
        expect(parseBooleanEnv(raw)).toBe(true);
      },
    );

    it.each(["0", "false", "no", "off", "", "anything"])(
      "treats %s as false",
      (raw) => {
        expect(parseBooleanEnv(raw)).toBe(false);
      },
    );

    it("treats undefined as false (production-safe default)", () => {
      expect(parseBooleanEnv(undefined)).toBe(false);
    });
  });
});
