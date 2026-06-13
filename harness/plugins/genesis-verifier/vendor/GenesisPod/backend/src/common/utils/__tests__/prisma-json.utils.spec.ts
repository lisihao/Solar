/**
 * Prisma JSON Utility Unit Tests
 *
 * Tests for the toPrismaJson type-cast utility.
 */

import { toPrismaJson } from "../prisma-json.utils";

describe("Prisma JSON Utils", () => {
  describe("toPrismaJson", () => {
    // --- Primitive values ---

    it("should return a string value unchanged", () => {
      const value = "hello";
      const result = toPrismaJson(value);
      expect(result).toBe("hello");
    });

    it("should return a number value unchanged", () => {
      const value = 42;
      const result = toPrismaJson(value);
      expect(result).toBe(42);
    });

    it("should return a boolean true unchanged", () => {
      const result = toPrismaJson(true);
      expect(result).toBe(true);
    });

    it("should return a boolean false unchanged", () => {
      const result = toPrismaJson(false);
      expect(result).toBe(false);
    });

    it("should return null unchanged", () => {
      const result = toPrismaJson(null);
      expect(result).toBeNull();
    });

    // --- Object and array values ---

    it("should return a flat object unchanged", () => {
      const value = { key: "value", count: 5 };
      const result = toPrismaJson(value);
      expect(result).toEqual({ key: "value", count: 5 });
    });

    it("should return a nested object unchanged", () => {
      const value = { outer: { inner: { deep: true } } };
      const result = toPrismaJson(value);
      expect(result).toEqual({ outer: { inner: { deep: true } } });
    });

    it("should return an array unchanged", () => {
      const value = [1, 2, 3];
      const result = toPrismaJson(value);
      expect(result).toEqual([1, 2, 3]);
    });

    it("should return an array of objects unchanged", () => {
      const value = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      const result = toPrismaJson(value);
      expect(result).toEqual(value);
    });

    it("should return an empty object unchanged", () => {
      const value = {};
      const result = toPrismaJson(value);
      expect(result).toEqual({});
    });

    it("should return an empty array unchanged", () => {
      const value: unknown[] = [];
      const result = toPrismaJson(value);
      expect(result).toEqual([]);
    });

    // --- Reference identity ---

    it("should return the exact same object reference (no copy)", () => {
      // toPrismaJson is just a cast — no cloning
      const value = { key: "test" };
      const result = toPrismaJson(value);
      expect(result).toBe(value);
    });

    it("should return the exact same array reference", () => {
      const value = [1, 2, 3];
      const result = toPrismaJson(value);
      expect(result).toBe(value);
    });

    // --- Complex structures ---

    it("should handle mixed-type nested structure", () => {
      const value = {
        name: "report",
        count: 3,
        enabled: true,
        tags: ["a", "b"],
        meta: { source: "api" },
      };
      const result = toPrismaJson(value);
      expect(result).toEqual(value);
    });

    it("should handle zero and negative numbers", () => {
      expect(toPrismaJson(0)).toBe(0);
      expect(toPrismaJson(-1)).toBe(-1);
      expect(toPrismaJson(-3.14)).toBe(-3.14);
    });

    it("should handle floating point numbers", () => {
      expect(toPrismaJson(3.14)).toBe(3.14);
    });

    it("should handle empty string", () => {
      expect(toPrismaJson("")).toBe("");
    });
  });
});
