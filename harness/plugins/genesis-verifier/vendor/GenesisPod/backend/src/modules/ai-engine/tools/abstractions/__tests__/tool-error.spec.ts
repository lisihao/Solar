/**
 * Tests for ToolError
 */

import { ToolError } from "../tool.error";
import { EngineError } from "@/modules/ai-engine/facade/abstractions/engine.error";
import { ToolErrorCode } from "@/modules/ai-engine/facade/abstractions/error-codes.constants";

describe("ToolError", () => {
  describe("constructor", () => {
    it("is an instance of EngineError", () => {
      const error = new ToolError("test");
      expect(error).toBeInstanceOf(EngineError);
    });

    it("is an instance of ToolError", () => {
      const error = new ToolError("test");
      expect(error).toBeInstanceOf(ToolError);
    });

    it("defaults code to ToolErrorCode.UNKNOWN", () => {
      const error = new ToolError("test");
      expect(error.code).toBe(ToolErrorCode.UNKNOWN);
    });

    it("sets name to ToolError", () => {
      const error = new ToolError("test");
      expect(error.name).toBe("ToolError");
    });

    it("toolId is undefined by default", () => {
      const error = new ToolError("test");
      expect(error.toolId).toBeUndefined();
    });

    it("toolName is undefined by default", () => {
      const error = new ToolError("test");
      expect(error.toolName).toBeUndefined();
    });

    it("sets toolId from options", () => {
      const error = new ToolError("test", ToolErrorCode.UNKNOWN, {
        toolId: "tool-1",
      });
      expect(error.toolId).toBe("tool-1");
    });

    it("sets toolName from options", () => {
      const error = new ToolError("test", ToolErrorCode.UNKNOWN, {
        toolName: "MyTool",
      });
      expect(error.toolName).toBe("MyTool");
    });

    it("includes toolId in details when provided", () => {
      const error = new ToolError("test", ToolErrorCode.UNKNOWN, {
        toolId: "tool-1",
      });
      expect(error.details?.toolId).toBe("tool-1");
    });
  });

  describe("notFound factory", () => {
    it("creates error with toolId in message", () => {
      const error = ToolError.notFound("tool-abc");
      expect(error.message).toContain("tool-abc");
    });

    it("sets toolId", () => {
      const error = ToolError.notFound("tool-1");
      expect(error.toolId).toBe("tool-1");
    });

    it("has retryable false", () => {
      const error = ToolError.notFound("tool-1");
      expect(error.retryable).toBe(false);
    });

    it("has code NOT_FOUND", () => {
      const error = ToolError.notFound("tool-1");
      expect(error.code).toBe(ToolErrorCode.NOT_FOUND);
    });
  });

  describe("notRegistered factory", () => {
    it("sets toolId", () => {
      const error = ToolError.notRegistered("tool-2");
      expect(error.toolId).toBe("tool-2");
    });

    it("has retryable false", () => {
      const error = ToolError.notRegistered("tool-2");
      expect(error.retryable).toBe(false);
    });

    it("has code NOT_REGISTERED", () => {
      const error = ToolError.notRegistered("tool-2");
      expect(error.code).toBe(ToolErrorCode.NOT_REGISTERED);
    });
  });

  describe("invalidInput factory", () => {
    it("creates error with toolId and reason in message", () => {
      const error = ToolError.invalidInput("tool-1", "missing field");
      expect(error.message).toContain("tool-1");
      expect(error.message).toContain("missing field");
    });

    it("sets toolId", () => {
      const error = ToolError.invalidInput("tool-1", "reason");
      expect(error.toolId).toBe("tool-1");
    });

    it("has retryable false", () => {
      const error = ToolError.invalidInput("tool-1", "bad input");
      expect(error.retryable).toBe(false);
    });

    it("has code INVALID_INPUT", () => {
      const error = ToolError.invalidInput("tool-1", "reason");
      expect(error.code).toBe(ToolErrorCode.INVALID_INPUT);
    });

    it("accepts optional details", () => {
      const error = ToolError.invalidInput("tool-1", "reason", {
        field: "name",
      });
      expect(error.details).toBeDefined();
    });
  });

  describe("executionFailed factory", () => {
    it("creates error with toolId", () => {
      const error = ToolError.executionFailed("tool-1", "failed");
      expect(error.toolId).toBe("tool-1");
    });

    it("has retryable false", () => {
      const error = ToolError.executionFailed("tool-1", "error");
      expect(error.retryable).toBe(false);
    });

    it("includes cause when provided", () => {
      const cause = new Error("root cause");
      const error = ToolError.executionFailed("tool-1", "failed", cause);
      expect(error.cause).toBe(cause);
    });

    it("has code EXECUTION_FAILED", () => {
      const error = ToolError.executionFailed("tool-1", "reason");
      expect(error.code).toBe(ToolErrorCode.EXECUTION_FAILED);
    });
  });

  describe("timeout factory", () => {
    it("creates error with toolId and timeout in message", () => {
      const error = ToolError.timeout("tool-1", 3000);
      expect(error.toolId).toBe("tool-1");
      expect(error.message).toContain("3000");
    });

    it("has retryable true", () => {
      const error = ToolError.timeout("tool-1", 3000);
      expect(error.retryable).toBe(true);
    });

    it("has code TIMEOUT", () => {
      const error = ToolError.timeout("tool-1", 3000);
      expect(error.code).toBe(ToolErrorCode.TIMEOUT);
    });
  });

  describe("rateLimited factory", () => {
    it("creates error with toolId", () => {
      const error = ToolError.rateLimited("tool-1");
      expect(error.toolId).toBe("tool-1");
    });

    it("has retryable true", () => {
      const error = ToolError.rateLimited("tool-1");
      expect(error.retryable).toBe(true);
    });

    it("includes retryAfter in message when provided", () => {
      const error = ToolError.rateLimited("tool-1", 5000);
      expect(error.message).toContain("5000");
    });

    it("has code RATE_LIMITED", () => {
      const error = ToolError.rateLimited("tool-1");
      expect(error.code).toBe(ToolErrorCode.RATE_LIMITED);
    });
  });

  describe("apiError factory", () => {
    it("creates error with status code in message", () => {
      const error = ToolError.apiError("tool-1", 500, "Internal Server Error");
      expect(error.message).toContain("500");
    });

    it("has retryable true when statusCode >= 500", () => {
      const error = ToolError.apiError("tool-1", 500, "Server Error");
      expect(error.retryable).toBe(true);
    });

    it("has retryable true for 502", () => {
      const error = ToolError.apiError("tool-1", 502, "Bad Gateway");
      expect(error.retryable).toBe(true);
    });

    it("has retryable false when statusCode is 4xx", () => {
      const error = ToolError.apiError("tool-1", 400, "Bad Request");
      expect(error.retryable).toBe(false);
    });

    it("has retryable false for 404", () => {
      const error = ToolError.apiError("tool-1", 404, "Not Found");
      expect(error.retryable).toBe(false);
    });

    it("has retryable false for 401", () => {
      const error = ToolError.apiError("tool-1", 401, "Unauthorized");
      expect(error.retryable).toBe(false);
    });

    it("sets toolId", () => {
      const error = ToolError.apiError("tool-xyz", 500, "Error");
      expect(error.toolId).toBe("tool-xyz");
    });

    it("has code API_ERROR", () => {
      const error = ToolError.apiError("tool-1", 500, "Error");
      expect(error.code).toBe(ToolErrorCode.API_ERROR);
    });
  });

  describe("fromError static method", () => {
    it("returns same ToolError if passed a ToolError", () => {
      const original = ToolError.notFound("tool-1");
      const result = ToolError.fromError(original);
      expect(result).toBe(original);
    });

    it("wraps a plain Error into ToolError", () => {
      const plain = new Error("plain error");
      const result = ToolError.fromError(plain);
      expect(result).toBeInstanceOf(ToolError);
      expect(result.message).toBe("plain error");
      expect(result.cause).toBe(plain);
    });

    it("wraps string error into ToolError", () => {
      const result = ToolError.fromError("tool failed");
      expect(result).toBeInstanceOf(ToolError);
      expect(result.message).toBe("tool failed");
    });

    it("wraps unknown value with generic message", () => {
      const result = ToolError.fromError({ foo: "bar" });
      expect(result.message).toBe("Unknown tool error");
    });

    it("extracts toolId from details when provided", () => {
      const result = ToolError.fromError(
        new Error("err"),
        ToolErrorCode.UNKNOWN,
        { toolId: "tool-5" },
      );
      expect(result.toolId).toBe("tool-5");
    });
  });

  describe("fromToolError static method", () => {
    it("returns same ToolError if passed a ToolError", () => {
      const original = ToolError.notFound("t1");
      const result = ToolError.fromToolError(original, "t1");
      expect(result).toBe(original);
    });

    it("wraps plain Error with toolId", () => {
      const plain = new Error("fail");
      const result = ToolError.fromToolError(plain, "tool-xyz");
      expect(result).toBeInstanceOf(ToolError);
      expect(result.toolId).toBe("tool-xyz");
    });

    it("works without toolId", () => {
      const result = ToolError.fromToolError(new Error("err"));
      expect(result).toBeInstanceOf(ToolError);
      expect(result.toolId).toBeUndefined();
    });
  });
});

