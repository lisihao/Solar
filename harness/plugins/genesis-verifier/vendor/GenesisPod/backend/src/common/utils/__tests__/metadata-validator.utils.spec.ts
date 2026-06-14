/**
 * Metadata Validator Utility Unit Tests
 *
 * Tests for validateMetadata, validateMetadataOrThrow, and METADATA_LIMITS.
 */

import {
  validateMetadata,
  validateMetadataOrThrow,
  METADATA_LIMITS,
} from "../metadata-validator.utils";

describe("Metadata Validator Utils", () => {
  // ========== METADATA_LIMITS ==========

  describe("METADATA_LIMITS", () => {
    it("should export MAX_DEPTH of 5", () => {
      expect(METADATA_LIMITS.MAX_DEPTH).toBe(5);
    });

    it("should export MAX_SIZE_BYTES of 1MB (1048576 bytes)", () => {
      expect(METADATA_LIMITS.MAX_SIZE_BYTES).toBe(1024 * 1024);
    });
  });

  // ========== validateMetadata ==========

  describe("validateMetadata", () => {
    // --- Valid inputs ---

    it("should return valid with sanitized null for null input", () => {
      const result = validateMetadata(null);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBeNull();
      expect(result.error).toBeUndefined();
    });

    it("should return valid with sanitized null for undefined input", () => {
      const result = validateMetadata(undefined);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBeNull();
      expect(result.error).toBeUndefined();
    });

    it("should return valid for a simple flat object", () => {
      // Arrange
      const data = { name: "test", count: 42, active: true };

      // Act
      const result = validateMetadata(data);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.sanitized).toEqual({
        name: "test",
        count: 42,
        active: true,
      });
      expect(result.error).toBeUndefined();
    });

    it("should return valid for a nested object within depth limit", () => {
      // Arrange - depth of 3 (within default limit of 5)
      const data = { a: { b: { c: "leaf" } } };

      // Act
      const result = validateMetadata(data);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.sanitized).toEqual({ a: { b: { c: "leaf" } } });
    });

    it("should return valid for object at exactly max depth", () => {
      // Arrange - depth of exactly 5 (the limit)
      const data = { l1: { l2: { l3: { l4: { l5: "leaf" } } } } };

      // Act
      const result = validateMetadata(data);

      // Assert
      expect(result.valid).toBe(true);
    });

    it("should return valid for empty object", () => {
      const result = validateMetadata({});
      expect(result.valid).toBe(true);
      expect(result.sanitized).toEqual({});
    });

    it("should strip undefined values during sanitization", () => {
      // Arrange
      const data = { name: "test", undefinedField: undefined };

      // Act
      const result = validateMetadata(data);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.sanitized).toEqual({ name: "test" });
      expect(result.sanitized).not.toHaveProperty("undefinedField");
    });

    it("should strip function values during sanitization", () => {
      // Arrange
      const data = { name: "test", fn: () => "hello" };

      // Act
      const result = validateMetadata(data);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.sanitized).toEqual({ name: "test" });
      expect(result.sanitized).not.toHaveProperty("fn");
    });

    // --- Invalid inputs: wrong type ---

    it("should return invalid for array input", () => {
      // Arrange
      const data = [1, 2, 3];

      // Act
      const result = validateMetadata(data);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.sanitized).toBeNull();
      expect(result.error).toContain("Metadata must be an object");
    });

    it("should return invalid for string input", () => {
      const result = validateMetadata("just a string");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Metadata must be an object");
    });

    it("should return invalid for number input", () => {
      const result = validateMetadata(42);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Metadata must be an object");
    });

    it("should return invalid for boolean input", () => {
      const result = validateMetadata(true);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Metadata must be an object");
    });

    // --- Invalid inputs: depth exceeded ---

    it("should return invalid for object exceeding default depth limit", () => {
      // Arrange - depth of 6 (exceeds default limit of 5)
      const data = { l1: { l2: { l3: { l4: { l5: { l6: "too deep" } } } } } };

      // Act
      const result = validateMetadata(data);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.sanitized).toBeNull();
      expect(result.error).toContain("exceeds maximum depth");
    });

    it("should accept object at custom depth limit", () => {
      // Arrange - depth of 3, custom max of 3
      const data = { a: { b: { c: "value" } } };

      // Act
      const result = validateMetadata(data, 3);

      // Assert
      expect(result.valid).toBe(true);
    });

    it("should reject object exceeding custom depth limit", () => {
      // Arrange - depth of 4, custom max of 2
      const data = { a: { b: { c: { d: "too deep" } } } };

      // Act
      const result = validateMetadata(data, 2);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds maximum depth");
    });

    // --- Invalid inputs: size exceeded ---

    it("should return invalid when metadata exceeds size limit", () => {
      // Arrange - create an object > 1MB
      const largeData = { content: "x".repeat(1024 * 1024 + 1) };

      // Act
      const result = validateMetadata(largeData);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.sanitized).toBeNull();
      expect(result.error).toContain("exceeds maximum size");
    });

    it("should accept metadata at exactly the custom size limit", () => {
      // Arrange - small custom limit, small data
      const data = { a: "b" };
      const serialized = JSON.stringify(data);
      const sizeBytes = Buffer.byteLength(serialized, "utf8");

      // Act
      const result = validateMetadata(data, 5, sizeBytes); // exactly at limit

      // Assert
      expect(result.valid).toBe(true);
    });

    it("should reject metadata exceeding custom size limit", () => {
      // Arrange
      const data = { content: "hello world" };

      // Act - use a tiny size limit
      const result = validateMetadata(data, 5, 5);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds maximum size");
    });

    // --- Depth calculation with arrays ---

    it("should correctly calculate depth for objects containing arrays", () => {
      // Arrange - the array elements add to depth
      const data = { items: [{ name: "a" }] };

      // Act
      const result = validateMetadata(data, 3);

      // Assert
      expect(result.valid).toBe(true);
    });

    it("should handle objects with empty arrays", () => {
      const data = { items: [] };
      const result = validateMetadata(data);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toEqual({ items: [] });
    });

    // --- Error in result shape ---

    it("should include error message on failure", () => {
      const result = validateMetadata("not-an-object");
      expect(result.valid).toBe(false);
      expect(typeof result.error).toBe("string");
    });
  });

  // ========== validateMetadataOrThrow ==========

  describe("validateMetadataOrThrow", () => {
    it("should return null for null input", () => {
      const result = validateMetadataOrThrow(null);
      expect(result).toBeNull();
    });

    it("should return null for undefined input", () => {
      const result = validateMetadataOrThrow(undefined);
      expect(result).toBeNull();
    });

    it("should return sanitized data for valid object", () => {
      // Arrange
      const data = { key: "value", count: 1 };

      // Act
      const result = validateMetadataOrThrow(data);

      // Assert
      expect(result).toEqual({ key: "value", count: 1 });
    });

    it("should throw for invalid metadata (array)", () => {
      expect(() => validateMetadataOrThrow([1, 2])).toThrow(
        "Invalid metadata: Metadata must be an object",
      );
    });

    it("should throw for metadata exceeding depth", () => {
      const deep = { a: { b: { c: { d: { e: { f: "too deep" } } } } } };
      expect(() => validateMetadataOrThrow(deep)).toThrow("Invalid metadata:");
    });

    it("should throw for metadata exceeding size", () => {
      const large = { content: "x".repeat(1024 * 1024 + 1) };
      expect(() => validateMetadataOrThrow(large)).toThrow("Invalid metadata:");
    });

    it("should respect custom maxDepth parameter", () => {
      const data = { a: { b: "leaf" } };
      // Depth 2 is valid with maxDepth=2
      expect(() => validateMetadataOrThrow(data, 2)).not.toThrow();
    });

    it("should strip undefined values and not throw", () => {
      const data = { name: "Alice", extra: undefined };
      const result = validateMetadataOrThrow(data);
      expect(result).toEqual({ name: "Alice" });
    });
  });
});
