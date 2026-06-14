/**
 * Crypto Utility Unit Tests
 *
 * Tests for the safeCompare function which provides constant-time
 * string comparison to prevent timing attacks.
 */

import { safeCompare } from "../crypto.utils";

describe("Crypto Utils", () => {
  describe("safeCompare", () => {
    // --- Happy path ---

    it("should return true for identical strings", () => {
      // Arrange
      const a = "my-secret-api-key";
      const b = "my-secret-api-key";

      // Act
      const result = safeCompare(a, b);

      // Assert
      expect(result).toBe(true);
    });

    it("should return true for identical empty strings", () => {
      // Arrange
      const a = "";
      const b = "";

      // Act
      const result = safeCompare(a, b);

      // Assert
      expect(result).toBe(true);
    });

    it("should return true for single character match", () => {
      // Act & Assert
      expect(safeCompare("x", "x")).toBe(true);
    });

    it("should return true for strings with special characters", () => {
      // Arrange
      const a = "sk-abc123!@#$%^&*()_+-=[]{}|;':\",./<>?";
      const b = "sk-abc123!@#$%^&*()_+-=[]{}|;':\",./<>?";

      // Act & Assert
      expect(safeCompare(a, b)).toBe(true);
    });

    it("should return true for strings with unicode characters", () => {
      // Arrange
      const a = "密钥-abc-123";
      const b = "密钥-abc-123";

      // Act & Assert
      expect(safeCompare(a, b)).toBe(true);
    });

    it("should return true for long identical strings", () => {
      // Arrange
      const a = "a".repeat(1000);
      const b = "a".repeat(1000);

      // Act & Assert
      expect(safeCompare(a, b)).toBe(true);
    });

    // --- Strings that differ ---

    it("should return false for strings with different content", () => {
      // Act & Assert
      expect(safeCompare("abc", "xyz")).toBe(false);
    });

    it("should return false for strings with same length but different content", () => {
      // Arrange
      const a = "abc";
      const b = "abd";

      // Act
      const result = safeCompare(a, b);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for strings with different lengths", () => {
      // Arrange
      const a = "short";
      const b = "longerstring";

      // Act
      const result = safeCompare(a, b);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false when a is shorter than b", () => {
      // Act & Assert
      expect(safeCompare("abc", "abcd")).toBe(false);
    });

    it("should return false when b is shorter than a", () => {
      // Act & Assert
      expect(safeCompare("abcd", "abc")).toBe(false);
    });

    it("should return false for empty string vs non-empty string", () => {
      // Act & Assert
      expect(safeCompare("", "abc")).toBe(false);
      expect(safeCompare("abc", "")).toBe(false);
    });

    it("should be case-sensitive", () => {
      // Arrange
      const a = "MyApiKey";
      const b = "myapikey";

      // Act & Assert
      expect(safeCompare(a, b)).toBe(false);
    });

    it("should distinguish strings differing only by leading/trailing whitespace", () => {
      // Act & Assert
      expect(safeCompare("abc", " abc")).toBe(false);
      expect(safeCompare("abc", "abc ")).toBe(false);
      expect(safeCompare(" abc ", "abc")).toBe(false);
    });

    // --- Type validation (non-string inputs) ---

    it("should return false when first argument is not a string (number)", () => {
      // Act & Assert
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(safeCompare(123 as any, "123")).toBe(false);
    });

    it("should return false when second argument is not a string (number)", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(safeCompare("123", 123 as any)).toBe(false);
    });

    it("should return false when first argument is null", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(safeCompare(null as any, "test")).toBe(false);
    });

    it("should return false when second argument is null", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(safeCompare("test", null as any)).toBe(false);
    });

    it("should return false when first argument is undefined", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(safeCompare(undefined as any, "test")).toBe(false);
    });

    it("should return false when second argument is undefined", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(safeCompare("test", undefined as any)).toBe(false);
    });

    it("should return false when both arguments are non-strings", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(safeCompare(42 as any, 42 as any)).toBe(false);
    });

    it("should return false when first argument is an object", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(safeCompare({} as any, "test")).toBe(false);
    });

    it("should return false when first argument is a boolean", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(safeCompare(true as any, "true")).toBe(false);
    });

    // --- Constant-time property (structural, not timing-based) ---

    it("should not throw even when strings have very different lengths", () => {
      // Arrange
      const a = "x";
      const b = "x".repeat(10000);

      // Act & Assert
      expect(() => safeCompare(a, b)).not.toThrow();
      expect(safeCompare(a, b)).toBe(false);
    });

    it("should handle binary-like strings correctly", () => {
      // Arrange
      const a = "\x00\x01\x02";
      const b = "\x00\x01\x02";

      // Act & Assert
      expect(safeCompare(a, b)).toBe(true);
    });

    it("should return false for binary-like strings that differ", () => {
      // Arrange
      const a = "\x00\x01\x02";
      const b = "\x00\x01\x03";

      // Act & Assert
      expect(safeCompare(a, b)).toBe(false);
    });
  });
});
