/**
 * Pagination Utilities Unit Tests
 *
 * Tests for pagination parameter parsing and response formatting utilities.
 */

import {
  parsePagination,
  createPaginatedResponse,
  PaginationLimits,
} from "../pagination.utils";

describe("Pagination Utilities", () => {
  describe("parsePagination", () => {
    describe("default values", () => {
      it("should return defaults when no parameters provided", () => {
        // Act
        const result = parsePagination();

        // Assert
        expect(result).toEqual({
          skip: 0,
          take: PaginationLimits.DEFAULT_TAKE,
        });
      });

      it("should use default take when only skip provided", () => {
        // Act
        const result = parsePagination(10);

        // Assert
        expect(result).toEqual({
          skip: 10,
          take: PaginationLimits.DEFAULT_TAKE,
        });
      });

      it("should use default skip when only take provided", () => {
        // Act
        const result = parsePagination(undefined, 50);

        // Assert
        expect(result).toEqual({
          skip: 0,
          take: 50,
        });
      });
    });

    describe("string parameter parsing", () => {
      it("should parse string skip parameter", () => {
        // Act
        const result = parsePagination("20", "30");

        // Assert
        expect(result).toEqual({
          skip: 20,
          take: 30,
        });
      });

      it("should parse string with leading zeros", () => {
        // Act
        const result = parsePagination("00020", "00030");

        // Assert
        expect(result).toEqual({
          skip: 20,
          take: 30,
        });
      });

      it("should handle invalid string skip as 0", () => {
        // Act
        const result = parsePagination("invalid", "10");

        // Assert
        expect(result.skip).toBe(0);
      });

      it("should handle invalid string take as default", () => {
        // Act
        const result = parsePagination("0", "invalid");

        // Assert
        expect(result.take).toBe(PaginationLimits.DEFAULT_TAKE);
      });

      it("should handle empty string parameters", () => {
        // Act
        const result = parsePagination("", "");

        // Assert
        expect(result).toEqual({
          skip: 0,
          take: PaginationLimits.DEFAULT_TAKE,
        });
      });
    });

    describe("number parameter handling", () => {
      it("should handle number parameters directly", () => {
        // Act
        const result = parsePagination(10, 25);

        // Assert
        expect(result).toEqual({
          skip: 10,
          take: 25,
        });
      });

      it("should handle zero values", () => {
        // Act
        const result = parsePagination(0, 0);

        // Assert
        expect(result.skip).toBe(0);
        expect(result.take).toBe(1); // Minimum take is 1
      });

      it("should handle large numbers", () => {
        // Act
        const result = parsePagination(1000000, 200);

        // Assert
        expect(result.skip).toBe(1000000);
        expect(result.take).toBe(100); // Capped at MAX_TAKE
      });
    });

    describe("skip validation", () => {
      it("should enforce minimum skip of 0", () => {
        // Act
        const result = parsePagination(-10, 20);

        // Assert
        expect(result.skip).toBe(0);
      });

      it("should handle negative string skip", () => {
        // Act
        const result = parsePagination("-5", "20");

        // Assert
        expect(result.skip).toBe(0);
      });

      it("should handle very large skip values", () => {
        // Act
        const result = parsePagination(Number.MAX_SAFE_INTEGER, 20);

        // Assert
        expect(result.skip).toBe(Number.MAX_SAFE_INTEGER);
      });
    });

    describe("take validation", () => {
      it("should enforce minimum take of 1", () => {
        // Act
        const result = parsePagination(0, -10);

        // Assert
        expect(result.take).toBe(1);
      });

      it("should enforce default maxTake of 100", () => {
        // Act
        const result = parsePagination(0, 200);

        // Assert
        expect(result.take).toBe(PaginationLimits.MAX_TAKE);
      });

      it("should respect custom maxTake", () => {
        // Act
        const result = parsePagination(0, 300, 500);

        // Assert
        expect(result.take).toBe(300);
      });

      it("should cap at custom maxTake", () => {
        // Act
        const result = parsePagination(0, 600, 500);

        // Assert
        expect(result.take).toBe(500);
      });

      it("should use admin maxTake when specified", () => {
        // Act
        const result = parsePagination(0, 300, PaginationLimits.MAX_TAKE_ADMIN);

        // Assert
        expect(result.take).toBe(300);
      });

      it("should cap at admin maxTake", () => {
        // Act
        const result = parsePagination(0, 600, PaginationLimits.MAX_TAKE_ADMIN);

        // Assert
        expect(result.take).toBe(PaginationLimits.MAX_TAKE_ADMIN);
      });
    });

    describe("NaN handling", () => {
      it("should treat NaN skip as 0", () => {
        // Act
        const result = parsePagination(NaN, 20);

        // Assert
        expect(result.skip).toBe(0);
      });

      it("should treat NaN take as default", () => {
        // Act
        const result = parsePagination(0, NaN);

        // Assert
        expect(result.take).toBe(PaginationLimits.DEFAULT_TAKE);
      });

      it("should handle division by zero result", () => {
        // Act
        const result = parsePagination(1 / 0, 20);

        // Assert
        expect(result.skip).toBeGreaterThan(0);
      });
    });

    describe("edge cases", () => {
      it("should handle decimal numbers by parsing as integers", () => {
        // Act
        const result = parsePagination("10.5", "25.7");

        // Assert
        expect(result).toEqual({
          skip: 10,
          take: 25,
        });
      });

      it("should handle scientific notation strings", () => {
        // Act
        const result = parsePagination("1e2", "2e1");

        // Assert
        // parseInt parses "1e2" as "1" (stops at non-digit)
        expect(result.skip).toBe(1);
        expect(result.take).toBe(2);
      });

      it("should handle hexadecimal string (invalid)", () => {
        // Act
        const result = parsePagination("0x10", "0x20");

        // Assert
        expect(result.skip).toBe(0); // parseInt handles hex, but user input unlikely
      });
    });
  });

  describe("createPaginatedResponse", () => {
    describe("basic response structure", () => {
      it("should create response with data and pagination", () => {
        // Arrange
        const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const total = 10;
        const pagination = { skip: 0, take: 3 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result).toHaveProperty("data", data);
        expect(result).toHaveProperty("pagination");
        expect(result.pagination).toHaveProperty("skip", 0);
        expect(result.pagination).toHaveProperty("take", 3);
        expect(result.pagination).toHaveProperty("total", 10);
        expect(result.pagination).toHaveProperty("hasMore");
      });

      it("should include all pagination fields", () => {
        // Arrange
        const data = [1, 2, 3];
        const total = 100;
        const pagination = { skip: 20, take: 10 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination).toEqual({
          skip: 20,
          take: 10,
          total: 100,
          hasMore: true,
        });
      });
    });

    describe("hasMore calculation", () => {
      it("should set hasMore to true when more items exist", () => {
        // Arrange
        const data = Array.from({ length: 20 }, (_, i) => i);
        const total = 100;
        const pagination = { skip: 0, take: 20 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.hasMore).toBe(true);
      });

      it("should set hasMore to false when on last page", () => {
        // Arrange
        const data = Array.from({ length: 10 }, (_, i) => i);
        const total = 100;
        const pagination = { skip: 90, take: 20 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.hasMore).toBe(false);
      });

      it("should set hasMore to false when all items returned", () => {
        // Arrange
        const data = Array.from({ length: 50 }, (_, i) => i);
        const total = 50;
        const pagination = { skip: 0, take: 50 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.hasMore).toBe(false);
      });

      it("should set hasMore to false when no items exist", () => {
        // Arrange
        const data: number[] = [];
        const total = 0;
        const pagination = { skip: 0, take: 20 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.hasMore).toBe(false);
      });

      it("should handle partial last page correctly", () => {
        // Arrange
        const data = [1, 2, 3]; // Only 3 items returned
        const total = 23;
        const pagination = { skip: 20, take: 20 }; // Requested 20 but got 3

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.hasMore).toBe(false);
      });
    });

    describe("data types", () => {
      it("should handle array of objects", () => {
        // Arrange
        const data = [
          { id: 1, name: "Item 1" },
          { id: 2, name: "Item 2" },
        ];
        const total = 2;
        const pagination = { skip: 0, take: 10 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.data).toEqual(data);
        expect(result.data).toHaveLength(2);
      });

      it("should handle array of primitives", () => {
        // Arrange
        const data = [1, 2, 3, 4, 5];
        const total = 10;
        const pagination = { skip: 0, take: 5 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.data).toEqual([1, 2, 3, 4, 5]);
      });

      it("should handle array of strings", () => {
        // Arrange
        const data = ["a", "b", "c"];
        const total = 26;
        const pagination = { skip: 0, take: 3 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.data).toEqual(["a", "b", "c"]);
      });

      it("should handle empty array", () => {
        // Arrange
        const data: any[] = [];
        const total = 0;
        const pagination = { skip: 0, take: 20 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.data).toEqual([]);
        expect(result.pagination.hasMore).toBe(false);
      });
    });

    describe("pagination scenarios", () => {
      it("should handle first page", () => {
        // Arrange
        const data = Array.from({ length: 20 }, (_, i) => i);
        const total = 100;
        const pagination = { skip: 0, take: 20 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.skip).toBe(0);
        expect(result.pagination.hasMore).toBe(true);
      });

      it("should handle middle page", () => {
        // Arrange
        const data = Array.from({ length: 20 }, (_, i) => i + 40);
        const total = 100;
        const pagination = { skip: 40, take: 20 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.skip).toBe(40);
        expect(result.pagination.hasMore).toBe(true);
      });

      it("should handle last page", () => {
        // Arrange
        const data = Array.from({ length: 5 }, (_, i) => i + 95);
        const total = 100;
        const pagination = { skip: 95, take: 20 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.skip).toBe(95);
        expect(result.pagination.hasMore).toBe(false);
      });

      it("should handle single item page", () => {
        // Arrange
        const data = [{ id: 1 }];
        const total = 1;
        const pagination = { skip: 0, take: 1 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.data).toHaveLength(1);
        expect(result.pagination.hasMore).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle data length exceeding total", () => {
        // Arrange - shouldn't happen but handle gracefully
        const data = Array.from({ length: 10 }, (_, i) => i);
        const total = 5;
        const pagination = { skip: 0, take: 10 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.hasMore).toBe(false);
      });

      it("should handle skip exceeding total", () => {
        // Arrange
        const data: number[] = [];
        const total = 10;
        const pagination = { skip: 100, take: 20 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.hasMore).toBe(false);
      });

      it("should handle very large total", () => {
        // Arrange
        const data = Array.from({ length: 20 }, (_, i) => i);
        const total = 1000000;
        const pagination = { skip: 0, take: 20 };

        // Act
        const result = createPaginatedResponse(data, total, pagination);

        // Assert
        expect(result.pagination.total).toBe(1000000);
        expect(result.pagination.hasMore).toBe(true);
      });
    });
  });

  describe("PaginationLimits", () => {
    it("should export constant limits", () => {
      expect(PaginationLimits.DEFAULT_TAKE).toBe(20);
      expect(PaginationLimits.MAX_TAKE).toBe(100);
      expect(PaginationLimits.MAX_TAKE_ADMIN).toBe(500);
    });
  });

  describe("integration scenarios", () => {
    it("should work together for typical API pagination", () => {
      // Arrange - simulate API request with query params
      const skip = "20";
      const take = "10";

      // Act - parse parameters
      const pagination = parsePagination(skip, take);

      // Simulate database query returning data
      const data = Array.from({ length: 10 }, (_, i) => ({
        id: i + 21,
        name: `Item ${i + 21}`,
      }));
      const total = 100;

      // Create response
      const response = createPaginatedResponse(data, total, pagination);

      // Assert
      expect(response.data).toHaveLength(10);
      expect(response.pagination).toEqual({
        skip: 20,
        take: 10,
        total: 100,
        hasMore: true,
      });
    });

    it("should handle admin user with higher limits", () => {
      // Arrange - admin requests large page
      const skip = "0";
      const take = "200";

      // Act
      const pagination = parsePagination(
        skip,
        take,
        PaginationLimits.MAX_TAKE_ADMIN,
      );
      const data = Array.from({ length: 200 }, (_, i) => i);
      const response = createPaginatedResponse(data, 1000, pagination);

      // Assert
      expect(response.pagination.take).toBe(200);
      expect(response.pagination.hasMore).toBe(true);
    });

    it("should handle last page with fewer items than requested", () => {
      // Arrange
      const skip = "90";
      const take = "20";

      // Act
      const pagination = parsePagination(skip, take);
      const data = Array.from({ length: 10 }, (_, i) => i + 90); // Only 10 items left
      const response = createPaginatedResponse(data, 100, pagination);

      // Assert
      expect(response.data).toHaveLength(10);
      expect(response.pagination.hasMore).toBe(false);
    });
  });
});
