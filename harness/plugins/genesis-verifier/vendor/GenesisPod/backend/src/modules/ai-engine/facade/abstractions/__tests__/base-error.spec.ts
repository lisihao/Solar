/**
 * Tests for base error classes
 */

import {
  EngineError,
  ValidationError,
  TimeoutError,
  CancelledError,
  NotFoundError,
  RetryExhaustedError,
  PreconditionError,
  DependencyError,
  RateLimitError,
} from "../engine.error";
import { CommonErrorCode } from "../error-codes.constants";

describe("EngineError", () => {
  describe("constructor defaults", () => {
    it("sets message correctly", () => {
      const error = new EngineError("test message");
      expect(error.message).toBe("test message");
    });

    it("defaults code to CommonErrorCode.UNKNOWN", () => {
      const error = new EngineError("test");
      expect(error.code).toBe(CommonErrorCode.UNKNOWN);
    });

    it("defaults retryable to false when no meta or options", () => {
      const error = new EngineError("test", "CUSTOM_CODE");
      expect(error.retryable).toBe(false);
    });

    it("defaults httpStatus to 500 when no meta or options", () => {
      const error = new EngineError("test", "CUSTOM_CODE");
      expect(error.httpStatus).toBe(500);
    });

    it("sets name to class name", () => {
      const error = new EngineError("test");
      expect(error.name).toBe("EngineError");
    });

    it("sets timestamp as Date", () => {
      const before = new Date();
      const error = new EngineError("test");
      const after = new Date();
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(error.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("is an instance of Error", () => {
      const error = new EngineError("test");
      expect(error).toBeInstanceOf(Error);
    });

    it("is an instance of EngineError", () => {
      const error = new EngineError("test");
      expect(error).toBeInstanceOf(EngineError);
    });
  });

  describe("constructor with options", () => {
    it("sets details from options", () => {
      const error = new EngineError("test", CommonErrorCode.UNKNOWN, {
        details: { key: "value" },
      });
      expect(error.details).toEqual({ key: "value" });
    });

    it("sets cause from options", () => {
      const cause = new Error("root cause");
      const error = new EngineError("test", CommonErrorCode.UNKNOWN, { cause });
      expect(error.cause).toBe(cause);
    });

    it("sets retryable from options overriding meta", () => {
      const error = new EngineError("test", CommonErrorCode.TIMEOUT, {
        retryable: false,
      });
      expect(error.retryable).toBe(false);
    });

    it("sets httpStatus from options overriding meta", () => {
      const error = new EngineError("test", CommonErrorCode.UNKNOWN, {
        httpStatus: 418,
      });
      expect(error.httpStatus).toBe(418);
    });

    it("sets userMessage from options", () => {
      const error = new EngineError("internal", CommonErrorCode.UNKNOWN, {
        userMessage: "Something went wrong",
      });
      expect(error.userMessage).toBe("Something went wrong");
    });

    it("uses message as userMessage when no userMessage option and no meta", () => {
      const error = new EngineError("fallback message", "CUSTOM_NO_META");
      expect(error.userMessage).toBe("fallback message");
    });
  });

  describe("uses error code metadata", () => {
    it("uses meta httpStatus for TIMEOUT code", () => {
      const error = new EngineError("timed out", CommonErrorCode.TIMEOUT);
      expect(error.httpStatus).toBe(408);
    });

    it("uses meta retryable for TIMEOUT code", () => {
      const error = new EngineError("timed out", CommonErrorCode.TIMEOUT);
      expect(error.retryable).toBe(true);
    });

    it("uses meta httpStatus for RATE_LIMITED code", () => {
      const error = new EngineError(
        "rate limited",
        CommonErrorCode.RATE_LIMITED,
      );
      expect(error.httpStatus).toBe(429);
    });
  });

  describe("fromError static method", () => {
    it("returns the same EngineError if passed an EngineError", () => {
      const original = new EngineError("original");
      const result = EngineError.fromError(original);
      expect(result).toBe(original);
    });

    it("wraps a plain Error", () => {
      const plain = new Error("plain error");
      const result = EngineError.fromError(plain);
      expect(result).toBeInstanceOf(EngineError);
      expect(result.message).toBe("plain error");
      expect(result.cause).toBe(plain);
    });

    it("wraps a string error", () => {
      const result = EngineError.fromError("something went wrong");
      expect(result).toBeInstanceOf(EngineError);
      expect(result.message).toBe("something went wrong");
    });

    it("wraps unknown non-string error with 'Unknown error' message", () => {
      const result = EngineError.fromError({ foo: "bar" });
      expect(result.message).toBe("Unknown error");
    });

    it("accepts custom code", () => {
      const result = EngineError.fromError(
        new Error("test"),
        CommonErrorCode.TIMEOUT,
      );
      expect(result.code).toBe(CommonErrorCode.TIMEOUT);
    });

    it("accepts details", () => {
      const result = EngineError.fromError(
        new Error("test"),
        CommonErrorCode.UNKNOWN,
        {
          extra: "info",
        },
      );
      expect(result.details).toBeDefined();
    });
  });

  describe("toJSON method", () => {
    it("includes all required fields", () => {
      const error = new EngineError("test error", CommonErrorCode.UNKNOWN, {
        details: { info: "detail" },
      });
      const json = error.toJSON();
      expect(json.name).toBe("EngineError");
      expect(json.code).toBe(CommonErrorCode.UNKNOWN);
      expect(json.message).toBe("test error");
      expect(json.userMessage).toBeDefined();
      expect(json.retryable).toBe(false);
      expect(json.httpStatus).toBe(500);
      expect(json.timestamp).toBeDefined();
    });

    it("includes details when present", () => {
      const error = new EngineError("test", CommonErrorCode.UNKNOWN, {
        details: { key: "value" },
      });
      const json = error.toJSON();
      expect(json.details).toEqual({ key: "value" });
    });

    it("includes cause when present", () => {
      const cause = new Error("cause");
      const error = new EngineError("test", CommonErrorCode.UNKNOWN, { cause });
      const json = error.toJSON();
      expect(json.cause).toBeDefined();
      expect((json.cause as Record<string, unknown>).message).toBe("cause");
    });

    it("does not include details when absent", () => {
      const error = new EngineError("test");
      const json = error.toJSON();
      expect(json.details).toBeUndefined();
    });
  });

  describe("toResponse method", () => {
    it("returns error with code, message, and optional details", () => {
      const error = new EngineError("test", CommonErrorCode.UNKNOWN, {
        details: { info: "x" },
      });
      const response = error.toResponse();
      expect(response.error.code).toBe(CommonErrorCode.UNKNOWN);
      expect(response.error.message).toBe(error.userMessage);
      expect(response.error.details).toEqual({ info: "x" });
    });

    it("does not include details in response when absent", () => {
      const error = new EngineError("test");
      const response = error.toResponse();
      expect(response.error.details).toBeUndefined();
    });
  });

  describe("getFullMessage method", () => {
    it("includes code and message", () => {
      const error = new EngineError("my message", "MY_CODE");
      const full = error.getFullMessage();
      expect(full).toContain("MY_CODE");
      expect(full).toContain("my message");
    });

    it("includes cause message when present", () => {
      const cause = new Error("root cause");
      const error = new EngineError("outer", "MY_CODE", { cause });
      const full = error.getFullMessage();
      expect(full).toContain("root cause");
    });

    it("does not mention cause when absent", () => {
      const error = new EngineError("outer", "MY_CODE");
      const full = error.getFullMessage();
      expect(full).not.toContain("Caused by");
    });

    it("includes details when present", () => {
      const error = new EngineError("outer", "MY_CODE", {
        details: { foo: "bar" },
      });
      const full = error.getFullMessage();
      expect(full).toContain("Details");
    });
  });
});

describe("ValidationError", () => {
  it("is an instance of EngineError", () => {
    const error = new ValidationError([
      { path: "field", message: "required", type: "required" },
    ]);
    expect(error).toBeInstanceOf(EngineError);
  });

  it("has httpStatus 400", () => {
    const error = new ValidationError([
      { path: "field", message: "required", type: "required" },
    ]);
    expect(error.httpStatus).toBe(400);
  });

  it("has retryable false", () => {
    const error = new ValidationError([
      { path: "name", message: "invalid", type: "invalid" },
    ]);
    expect(error.retryable).toBe(false);
  });

  it("stores validationErrors array", () => {
    const errors = [
      { path: "email", message: "invalid email", type: "format" },
      { path: "age", message: "must be number", type: "type" },
    ];
    const error = new ValidationError(errors);
    expect(error.validationErrors).toEqual(errors);
    expect(error.validationErrors.length).toBe(2);
  });

  it("uses custom message when provided", () => {
    const error = new ValidationError(
      [{ path: "f", message: "m", type: "t" }],
      "Custom message",
    );
    expect(error.message).toBe("Custom message");
  });

  it("generates default message from errors when no message provided", () => {
    const error = new ValidationError([
      { path: "field", message: "is required", type: "required" },
    ]);
    expect(error.message).toContain("is required");
  });

  it("has code VALIDATION_FAILED", () => {
    const error = new ValidationError([{ path: "f", message: "m", type: "t" }]);
    expect(error.code).toBe(CommonErrorCode.VALIDATION_FAILED);
  });
});

describe("TimeoutError", () => {
  it("is an instance of EngineError", () => {
    const error = new TimeoutError(5000);
    expect(error).toBeInstanceOf(EngineError);
  });

  it("stores timeout value", () => {
    const error = new TimeoutError(3000);
    expect(error.timeout).toBe(3000);
  });

  it("has retryable true", () => {
    const error = new TimeoutError(5000);
    expect(error.retryable).toBe(true);
  });

  it("generates default message with timeout value", () => {
    const error = new TimeoutError(5000);
    expect(error.message).toContain("5000");
  });

  it("uses custom message when provided", () => {
    const error = new TimeoutError(5000, "Custom timeout");
    expect(error.message).toBe("Custom timeout");
  });

  it("has code TIMEOUT", () => {
    const error = new TimeoutError(1000);
    expect(error.code).toBe(CommonErrorCode.TIMEOUT);
  });
});

describe("CancelledError", () => {
  it("is an instance of EngineError", () => {
    expect(new CancelledError()).toBeInstanceOf(EngineError);
  });

  it("has httpStatus 499", () => {
    const error = new CancelledError();
    expect(error.httpStatus).toBe(499);
  });

  it("has retryable false", () => {
    const error = new CancelledError();
    expect(error.retryable).toBe(false);
  });

  it("has default message", () => {
    const error = new CancelledError();
    expect(error.message).toBeTruthy();
  });

  it("uses custom message", () => {
    const error = new CancelledError("User cancelled");
    expect(error.message).toBe("User cancelled");
  });

  it("has code CANCELLED", () => {
    const error = new CancelledError();
    expect(error.code).toBe(CommonErrorCode.CANCELLED);
  });
});

describe("NotFoundError", () => {
  it("is an instance of EngineError", () => {
    expect(new NotFoundError("Agent", "agent-1")).toBeInstanceOf(EngineError);
  });

  it("has httpStatus 404", () => {
    const error = new NotFoundError("Agent", "agent-1");
    expect(error.httpStatus).toBe(404);
  });

  it("has retryable false", () => {
    const error = new NotFoundError("Tool", "tool-1");
    expect(error.retryable).toBe(false);
  });

  it("stores resourceType and resourceId", () => {
    const error = new NotFoundError("Skill", "skill-abc");
    expect(error.resourceType).toBe("Skill");
    expect(error.resourceId).toBe("skill-abc");
  });

  it("generates default message with resourceType and resourceId", () => {
    const error = new NotFoundError("Agent", "agent-xyz");
    expect(error.message).toContain("Agent");
    expect(error.message).toContain("agent-xyz");
  });

  it("uses custom message when provided", () => {
    const error = new NotFoundError("Agent", "a1", "Custom not found");
    expect(error.message).toBe("Custom not found");
  });

  it("has code NOT_FOUND", () => {
    const error = new NotFoundError("Resource", "r-1");
    expect(error.code).toBe(CommonErrorCode.NOT_FOUND);
  });
});

describe("RetryExhaustedError", () => {
  it("is an instance of EngineError", () => {
    expect(new RetryExhaustedError(3)).toBeInstanceOf(EngineError);
  });

  it("stores attempts count", () => {
    const error = new RetryExhaustedError(5);
    expect(error.attempts).toBe(5);
  });

  it("stores lastError when provided", () => {
    const lastErr = new Error("last attempt failed");
    const error = new RetryExhaustedError(3, lastErr);
    expect(error.lastError).toBe(lastErr);
  });

  it("has retryable false", () => {
    const error = new RetryExhaustedError(3);
    expect(error.retryable).toBe(false);
  });

  it("generates default message with attempts", () => {
    const error = new RetryExhaustedError(3);
    expect(error.message).toContain("3");
  });

  it("uses custom message when provided", () => {
    const error = new RetryExhaustedError(3, undefined, "All retries failed");
    expect(error.message).toBe("All retries failed");
  });

  it("has code RETRY_EXHAUSTED", () => {
    const error = new RetryExhaustedError(3);
    expect(error.code).toBe(CommonErrorCode.RETRY_EXHAUSTED);
  });
});

describe("PreconditionError", () => {
  it("is an instance of EngineError", () => {
    expect(new PreconditionError("condition")).toBeInstanceOf(EngineError);
  });

  it("has httpStatus 412", () => {
    const error = new PreconditionError("must be ready");
    expect(error.httpStatus).toBe(412);
  });

  it("has retryable false", () => {
    const error = new PreconditionError("condition");
    expect(error.retryable).toBe(false);
  });

  it("accepts a single string condition", () => {
    const error = new PreconditionError("must have auth");
    expect(error.conditions).toEqual(["must have auth"]);
  });

  it("accepts an array of conditions", () => {
    const error = new PreconditionError(["cond1", "cond2"]);
    expect(error.conditions).toEqual(["cond1", "cond2"]);
  });

  it("generates default message from conditions", () => {
    const error = new PreconditionError(["cond1", "cond2"]);
    expect(error.message).toContain("cond1");
  });

  it("has code PRECONDITION_FAILED", () => {
    const error = new PreconditionError("condition");
    expect(error.code).toBe(CommonErrorCode.PRECONDITION_FAILED);
  });
});

describe("DependencyError", () => {
  it("is an instance of EngineError", () => {
    expect(new DependencyError(["dep1"])).toBeInstanceOf(EngineError);
  });

  it("stores missingDependencies", () => {
    const error = new DependencyError(["db", "cache"]);
    expect(error.missingDependencies).toEqual(["db", "cache"]);
  });

  it("has retryable false", () => {
    const error = new DependencyError(["dep1"]);
    expect(error.retryable).toBe(false);
  });

  it("generates default message with dependency names", () => {
    const error = new DependencyError(["redis", "postgres"]);
    expect(error.message).toContain("redis");
  });

  it("uses custom message when provided", () => {
    const error = new DependencyError(["db"], "DB not available");
    expect(error.message).toBe("DB not available");
  });

  it("has code DEPENDENCY_MISSING", () => {
    const error = new DependencyError(["dep1"]);
    expect(error.code).toBe(CommonErrorCode.DEPENDENCY_MISSING);
  });
});

describe("RateLimitError", () => {
  it("is an instance of EngineError", () => {
    expect(new RateLimitError()).toBeInstanceOf(EngineError);
  });

  it("has httpStatus 429", () => {
    const error = new RateLimitError();
    expect(error.httpStatus).toBe(429);
  });

  it("has retryable true", () => {
    const error = new RateLimitError();
    expect(error.retryable).toBe(true);
  });

  it("stores retryAfter when provided", () => {
    const error = new RateLimitError(5000);
    expect(error.retryAfter).toBe(5000);
  });

  it("retryAfter is undefined when not provided", () => {
    const error = new RateLimitError();
    expect(error.retryAfter).toBeUndefined();
  });

  it("has default message", () => {
    const error = new RateLimitError();
    expect(error.message).toBeTruthy();
  });

  it("uses custom message when provided", () => {
    const error = new RateLimitError(undefined, "Too many requests");
    expect(error.message).toBe("Too many requests");
  });

  it("has code RATE_LIMITED", () => {
    const error = new RateLimitError();
    expect(error.code).toBe(CommonErrorCode.RATE_LIMITED);
  });
});

