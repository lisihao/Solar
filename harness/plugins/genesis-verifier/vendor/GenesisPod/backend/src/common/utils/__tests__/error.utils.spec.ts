/**
 * Error Utilities Unit Tests
 *
 * Tests for error handling utility functions that work with TypeScript strict mode.
 */

import {
  getErrorMessage,
  getErrorStack,
  ensureError,
  formatErrorForLog,
} from "../error.utils";

describe("Error Utilities", () => {
  describe("getErrorMessage", () => {
    it("should extract message from Error instance", () => {
      // Arrange
      const error = new Error("Test error message");

      // Act
      const result = getErrorMessage(error);

      // Assert
      expect(result).toBe("Test error message");
    });

    it("should extract message from custom Error subclass", () => {
      // Arrange
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }
      const error = new CustomError("Custom error message");

      // Act
      const result = getErrorMessage(error);

      // Assert
      expect(result).toBe("Custom error message");
    });

    it("should convert string to string", () => {
      // Arrange
      const error = "Simple error string";

      // Act
      const result = getErrorMessage(error);

      // Assert
      expect(result).toBe("Simple error string");
    });

    it("should convert number to string", () => {
      // Arrange
      const error = 404;

      // Act
      const result = getErrorMessage(error);

      // Assert
      expect(result).toBe("404");
    });

    it("should convert null to string", () => {
      // Arrange
      const error = null;

      // Act
      const result = getErrorMessage(error);

      // Assert
      expect(result).toBe("null");
    });

    it("should convert undefined to string", () => {
      // Arrange
      const error = undefined;

      // Act
      const result = getErrorMessage(error);

      // Assert
      expect(result).toBe("undefined");
    });

    it("should convert boolean to string", () => {
      // Arrange
      const error = false;

      // Act
      const result = getErrorMessage(error);

      // Assert
      expect(result).toBe("false");
    });

    it("should convert object to string", () => {
      // Arrange
      const error = { code: "ERR001", details: "Something went wrong" };

      // Act
      const result = getErrorMessage(error);

      // Assert
      expect(result).toBe("[object Object]");
    });

    it("should convert array to string", () => {
      // Arrange
      const error = ["error1", "error2"];

      // Act
      const result = getErrorMessage(error);

      // Assert
      expect(result).toBe("error1,error2");
    });

    it("should handle Error with empty message", () => {
      // Arrange
      const error = new Error("");

      // Act
      const result = getErrorMessage(error);

      // Assert
      expect(result).toBe("");
    });
  });

  describe("getErrorStack", () => {
    it("should extract stack from Error instance", () => {
      // Arrange
      const error = new Error("Test error");

      // Act
      const result = getErrorStack(error);

      // Assert
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result).toContain("Error: Test error");
    });

    it("should extract stack from custom Error subclass", () => {
      // Arrange
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }
      const error = new CustomError("Custom error");

      // Act
      const result = getErrorStack(error);

      // Assert
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });

    it("should return undefined for non-Error values", () => {
      // Arrange & Act & Assert
      expect(getErrorStack("string error")).toBeUndefined();
      expect(getErrorStack(404)).toBeUndefined();
      expect(getErrorStack(null)).toBeUndefined();
      expect(getErrorStack(undefined)).toBeUndefined();
      expect(getErrorStack({ message: "error" })).toBeUndefined();
      expect(getErrorStack(["error"])).toBeUndefined();
    });

    it("should return stack even if Error has no stack property", () => {
      // Arrange
      const error = new Error("Test");
      delete (error as any).stack;

      // Act
      const result = getErrorStack(error);

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe("ensureError", () => {
    it("should return Error instance unchanged", () => {
      // Arrange
      const error = new Error("Test error");

      // Act
      const result = ensureError(error);

      // Assert
      expect(result).toBe(error);
      expect(result.message).toBe("Test error");
    });

    it("should return custom Error subclass unchanged", () => {
      // Arrange
      class CustomError extends Error {
        public readonly code: string;
        constructor(message: string, code: string) {
          super(message);
          this.code = code;
          this.name = "CustomError";
        }
      }
      const error = new CustomError("Custom error", "ERR001");

      // Act
      const result = ensureError(error);

      // Assert
      expect(result).toBe(error);
      expect(result).toBeInstanceOf(CustomError);
      expect((result as CustomError).code).toBe("ERR001");
    });

    it("should convert string to Error", () => {
      // Arrange
      const error = "String error";

      // Act
      const result = ensureError(error);

      // Assert
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("String error");
    });

    it("should convert number to Error", () => {
      // Arrange
      const error = 500;

      // Act
      const result = ensureError(error);

      // Assert
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("500");
    });

    it("should convert null to Error", () => {
      // Arrange
      const error = null;

      // Act
      const result = ensureError(error);

      // Assert
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("null");
    });

    it("should convert undefined to Error", () => {
      // Arrange
      const error = undefined;

      // Act
      const result = ensureError(error);

      // Assert
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("undefined");
    });

    it("should convert object to Error", () => {
      // Arrange
      const error = { code: "ERR001", message: "Something failed" };

      // Act
      const result = ensureError(error);

      // Assert
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("[object Object]");
    });

    it("should convert array to Error", () => {
      // Arrange
      const error = ["error1", "error2"];

      // Act
      const result = ensureError(error);

      // Assert
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("error1,error2");
    });

    it("should create Error with stack trace", () => {
      // Arrange
      const error = "Test error";

      // Act
      const result = ensureError(error);

      // Assert
      expect(result.stack).toBeDefined();
      expect(typeof result.stack).toBe("string");
    });
  });

  describe("formatErrorForLog", () => {
    it("should format Error instance with message and stack", () => {
      // Arrange
      const error = new Error("Test error");

      // Act
      const result = formatErrorForLog(error);

      // Assert
      expect(result).toHaveProperty("message", "Test error");
      expect(result).toHaveProperty("stack");
      expect(typeof result.stack).toBe("string");
      expect(result.stack).toContain("Error: Test error");
    });

    it("should format custom Error with message and stack", () => {
      // Arrange
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }
      const error = new CustomError("Custom error");

      // Act
      const result = formatErrorForLog(error);

      // Assert
      expect(result).toHaveProperty("message", "Custom error");
      expect(result).toHaveProperty("stack");
      expect(typeof result.stack).toBe("string");
    });

    it("should format string error with only message", () => {
      // Arrange
      const error = "String error";

      // Act
      const result = formatErrorForLog(error);

      // Assert
      expect(result).toEqual({ message: "String error" });
      expect(result.stack).toBeUndefined();
    });

    it("should format number error with only message", () => {
      // Arrange
      const error = 404;

      // Act
      const result = formatErrorForLog(error);

      // Assert
      expect(result).toEqual({ message: "404" });
      expect(result.stack).toBeUndefined();
    });

    it("should format null with only message", () => {
      // Arrange
      const error = null;

      // Act
      const result = formatErrorForLog(error);

      // Assert
      expect(result).toEqual({ message: "null" });
      expect(result.stack).toBeUndefined();
    });

    it("should format undefined with only message", () => {
      // Arrange
      const error = undefined;

      // Act
      const result = formatErrorForLog(error);

      // Assert
      expect(result).toEqual({ message: "undefined" });
      expect(result.stack).toBeUndefined();
    });

    it("should format object with only message", () => {
      // Arrange
      const error = { code: "ERR001", details: "Failed" };

      // Act
      const result = formatErrorForLog(error);

      // Assert
      expect(result).toEqual({ message: "[object Object]" });
      expect(result.stack).toBeUndefined();
    });

    it("should format Error with no stack gracefully", () => {
      // Arrange
      const error = new Error("Test");
      delete (error as any).stack;

      // Act
      const result = formatErrorForLog(error);

      // Assert
      expect(result).toHaveProperty("message", "Test");
      expect(result.stack).toBeUndefined();
    });

    it("should format Error with empty message", () => {
      // Arrange
      const error = new Error("");

      // Act
      const result = formatErrorForLog(error);

      // Assert
      expect(result).toHaveProperty("message", "");
      expect(result).toHaveProperty("stack");
    });
  });

  describe("integration scenarios", () => {
    it("should handle try-catch with unknown error type", () => {
      // Arrange
      const throwError = () => {
        throw "String error thrown";
      };

      // Act
      try {
        throwError();
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        const errorObj = ensureError(error);
        const logFormat = formatErrorForLog(error);

        // Assert
        expect(message).toBe("String error thrown");
        expect(errorObj).toBeInstanceOf(Error);
        expect(errorObj.message).toBe("String error thrown");
        expect(logFormat).toEqual({ message: "String error thrown" });
      }
    });

    it("should handle async rejection with various types", async () => {
      // Arrange
      const testCases = [
        new Error("Standard error"),
        "String rejection",
        { error: "Object rejection" },
        404,
        null,
      ];

      // Act & Assert
      for (const testCase of testCases) {
        try {
          await Promise.reject(testCase);
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          const errorObj = ensureError(error);
          const logFormat = formatErrorForLog(error);

          expect(message).toBeDefined();
          expect(typeof message).toBe("string");
          expect(errorObj).toBeInstanceOf(Error);
          expect(logFormat).toHaveProperty("message");
        }
      }
    });

    it("should preserve Error chain information", () => {
      // Arrange
      const originalError = new Error("Original error");
      const wrappedError = new Error(`Wrapped: ${originalError.message}`);

      // Act
      const message = getErrorMessage(wrappedError);
      const stack = getErrorStack(wrappedError);
      const errorObj = ensureError(wrappedError);

      // Assert
      expect(message).toBe("Wrapped: Original error");
      expect(stack).toContain("Wrapped: Original error");
      expect(errorObj).toBe(wrappedError);
    });
  });
});
