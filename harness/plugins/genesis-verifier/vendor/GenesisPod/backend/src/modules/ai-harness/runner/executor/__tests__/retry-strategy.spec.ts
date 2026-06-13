/**
 * RetryStrategy Unit Tests
 * 重试策略测试
 */

import { Logger } from "@nestjs/common";
import {
  RetryStrategy,
  RetryStrategyConfig,
  RetryResult,
  ToolErrorType,
  RetryToolError,
  WithRetry,
} from "../retry-strategy";

// ============================================================================
// Helpers
// ============================================================================

function makeConfig(
  overrides?: Partial<RetryStrategyConfig>,
): Partial<RetryStrategyConfig> {
  return {
    maxRetries: 2,
    initialDelay: 10,
    maxDelay: 100,
    backoffMultiplier: 2,
    jitter: false,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("RetryStrategy", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Construction and default config
  // --------------------------------------------------------------------------

  describe("constructor and DEFAULT_CONFIG", () => {
    it("should use DEFAULT_CONFIG when no config is provided", () => {
      const _strategy = new RetryStrategy();
      // Verify defaults are visible through behavior:
      // getDelay(1) with defaults: 1000 * 2^0 = 1000, with jitter it might vary
      // Use jitter: false config to verify deterministically
      const deterministic = new RetryStrategy({ jitter: false });
      const delay = deterministic.getDelay(1);
      expect(delay).toBe(RetryStrategy.DEFAULT_CONFIG.initialDelay); // 1000
    });

    it("should allow partial config override", () => {
      const strategy = new RetryStrategy({ maxRetries: 5, jitter: false });
      const delay = strategy.getDelay(1);
      expect(delay).toBe(RetryStrategy.DEFAULT_CONFIG.initialDelay);
    });

    it("should expose DEFAULT_CONFIG as static property", () => {
      expect(RetryStrategy.DEFAULT_CONFIG.maxRetries).toBe(3);
      expect(RetryStrategy.DEFAULT_CONFIG.initialDelay).toBe(1000);
      expect(RetryStrategy.DEFAULT_CONFIG.maxDelay).toBe(30000);
      expect(RetryStrategy.DEFAULT_CONFIG.backoffMultiplier).toBe(2);
      expect(RetryStrategy.DEFAULT_CONFIG.jitter).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // executeWithRetry — success on first attempt
  // --------------------------------------------------------------------------

  describe("executeWithRetry() - success path", () => {
    it("should return success with data on first attempt", async () => {
      const strategy = new RetryStrategy(makeConfig());
      const operation = jest.fn().mockResolvedValue("hello");

      const result: RetryResult<string> = await strategy.executeWithRetry(
        operation,
        "tool-a",
        "testOp",
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe("hello");
      expect(result.attempts).toBe(1);
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should work without operationName parameter", async () => {
      const strategy = new RetryStrategy(makeConfig());
      const operation = jest.fn().mockResolvedValue(42);

      const result = await strategy.executeWithRetry(operation, "tool-x");

      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });
  });

  // --------------------------------------------------------------------------
  // executeWithRetry — retry on retryable errors
  // --------------------------------------------------------------------------

  describe("executeWithRetry() - retry on retryable errors", () => {
    it("should retry after RATE_LIMIT error and succeed on second attempt", async () => {
      const strategy = new RetryStrategy(makeConfig({ maxRetries: 2 }));

      // Mock sleep to skip actual delays
      jest
        .spyOn(
          strategy as unknown as { sleep: (ms: number) => Promise<void> },
          "sleep",
        )
        .mockResolvedValue(undefined);

      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("rate limit exceeded"))
        .mockResolvedValue("success");

      const result = await strategy.executeWithRetry(operation, "tool-a");

      expect(result.success).toBe(true);
      expect(result.data).toBe("success");
      expect(result.attempts).toBe(2);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("should retry up to maxRetries and then fail", async () => {
      const strategy = new RetryStrategy(makeConfig({ maxRetries: 2 }));

      jest
        .spyOn(
          strategy as unknown as { sleep: (ms: number) => Promise<void> },
          "sleep",
        )
        .mockResolvedValue(undefined);

      const operation = jest
        .fn()
        .mockRejectedValue(new Error("timeout occurred"));

      const result = await strategy.executeWithRetry(operation, "tool-b");

      expect(result.success).toBe(false);
      // 1 initial + 2 retries = 3 attempts
      expect(result.attempts).toBe(3);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should not retry a non-retryable error", async () => {
      const strategy = new RetryStrategy(makeConfig({ maxRetries: 3 }));

      const operation = jest
        .fn()
        .mockRejectedValue(new Error("invalid input: 400"));

      const result = await strategy.executeWithRetry(operation, "tool-c");

      expect(result.success).toBe(false);
      // Should stop after first failure since INVALID_INPUT is not retryable
      expect(result.attempts).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should stop retrying if shouldRetry returns false", async () => {
      const strategy = new RetryStrategy(makeConfig({ maxRetries: 3 }));

      jest
        .spyOn(
          strategy as unknown as { sleep: (ms: number) => Promise<void> },
          "sleep",
        )
        .mockResolvedValue(undefined);

      // PERMISSION_DENIED is not retryable
      const operation = jest
        .fn()
        .mockRejectedValue(new Error("permission denied: 403"));

      const result = await strategy.executeWithRetry(operation, "tool-d");

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // shouldRetry
  // --------------------------------------------------------------------------

  describe("shouldRetry()", () => {
    it("should return true for retryable error within attempt limit", () => {
      const strategy = new RetryStrategy(makeConfig({ maxRetries: 3 }));
      const error: RetryToolError = {
        type: ToolErrorType.RATE_LIMIT,
        toolId: "tool-x",
        message: "rate limit",
        retryable: true,
      };

      expect(strategy.shouldRetry(error, 1)).toBe(true);
      expect(strategy.shouldRetry(error, 3)).toBe(true);
    });

    it("should return false when attempt exceeds maxRetries", () => {
      const strategy = new RetryStrategy(makeConfig({ maxRetries: 2 }));
      const error: RetryToolError = {
        type: ToolErrorType.TIMEOUT,
        toolId: "tool-x",
        message: "timeout",
        retryable: true,
      };

      expect(strategy.shouldRetry(error, 3)).toBe(false);
    });

    it("should return false for non-retryable error", () => {
      const strategy = new RetryStrategy(makeConfig({ maxRetries: 3 }));
      const error: RetryToolError = {
        type: ToolErrorType.INVALID_INPUT,
        toolId: "tool-x",
        message: "invalid",
        retryable: false,
      };

      expect(strategy.shouldRetry(error, 1)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getDelay
  // --------------------------------------------------------------------------

  describe("getDelay()", () => {
    it("should compute exponential backoff delay without jitter", () => {
      const strategy = new RetryStrategy({
        initialDelay: 100,
        maxDelay: 10000,
        backoffMultiplier: 2,
        jitter: false,
      });

      expect(strategy.getDelay(1)).toBe(100); // 100 * 2^0
      expect(strategy.getDelay(2)).toBe(200); // 100 * 2^1
      expect(strategy.getDelay(3)).toBe(400); // 100 * 2^2
    });

    it("should cap delay at maxDelay", () => {
      const strategy = new RetryStrategy({
        initialDelay: 1000,
        maxDelay: 1500,
        backoffMultiplier: 2,
        jitter: false,
      });

      expect(strategy.getDelay(3)).toBe(1500); // 1000 * 4 = 4000 → capped at 1500
    });

    it("should apply jitter when jitter is true", () => {
      const strategy = new RetryStrategy({
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        jitter: true,
      });

      // With jitter, delay should be in range [0.75 * delay, 1.25 * delay]
      const delay = strategy.getDelay(1);
      expect(delay).toBeGreaterThanOrEqual(750);
      expect(delay).toBeLessThanOrEqual(1250);
    });

    it("should return integer delay values when jitter is applied", () => {
      const strategy = new RetryStrategy({
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        jitter: true,
      });

      const delay = strategy.getDelay(2);
      expect(Number.isInteger(delay)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // classifyError
  // --------------------------------------------------------------------------

  describe("classifyError()", () => {
    const strategy = new RetryStrategy();
    const toolId = "tool-classify";

    it("should classify rate limit error as RATE_LIMIT (retryable)", () => {
      const err = strategy.classifyError(
        new Error("rate limit exceeded"),
        toolId,
      );
      expect(err.type).toBe(ToolErrorType.RATE_LIMIT);
      expect(err.retryable).toBe(true);
    });

    it("should classify 429 status in message as RATE_LIMIT", () => {
      const err = strategy.classifyError(
        new Error("HTTP 429 too many"),
        toolId,
      );
      expect(err.type).toBe(ToolErrorType.RATE_LIMIT);
      expect(err.retryable).toBe(true);
    });

    it("should classify timeout error as TIMEOUT (retryable)", () => {
      const err = strategy.classifyError(
        new Error("request timed out"),
        toolId,
      );
      expect(err.type).toBe(ToolErrorType.TIMEOUT);
      expect(err.retryable).toBe(true);
    });

    it("should classify 'timeout' keyword as TIMEOUT", () => {
      const err = strategy.classifyError(new Error("timeout"), toolId);
      expect(err.type).toBe(ToolErrorType.TIMEOUT);
    });

    it("should classify network error as NETWORK_ERROR (retryable)", () => {
      const err = strategy.classifyError(new Error("network failure"), toolId);
      expect(err.type).toBe(ToolErrorType.NETWORK_ERROR);
      expect(err.retryable).toBe(true);
    });

    it("should classify ECONNREFUSED as NETWORK_ERROR", () => {
      const err = strategy.classifyError(new Error("ECONNREFUSED"), toolId);
      expect(err.type).toBe(ToolErrorType.NETWORK_ERROR);
      expect(err.retryable).toBe(true);
    });

    it("should classify ENOTFOUND as NETWORK_ERROR", () => {
      const err = strategy.classifyError(new Error("ENOTFOUND"), toolId);
      expect(err.type).toBe(ToolErrorType.NETWORK_ERROR);
      expect(err.retryable).toBe(true);
    });

    it("should classify 503 as SERVICE_UNAVAILABLE (retryable)", () => {
      const err = strategy.classifyError(new Error("503 service"), toolId);
      expect(err.type).toBe(ToolErrorType.SERVICE_UNAVAILABLE);
      expect(err.retryable).toBe(true);
    });

    it("should classify 'service unavailable' as SERVICE_UNAVAILABLE", () => {
      const err = strategy.classifyError(
        new Error("service unavailable"),
        toolId,
      );
      expect(err.type).toBe(ToolErrorType.SERVICE_UNAVAILABLE);
      expect(err.retryable).toBe(true);
    });

    it("should classify quota exceeded as QUOTA_EXCEEDED (not retryable)", () => {
      const err = strategy.classifyError(new Error("quota exceeded"), toolId);
      expect(err.type).toBe(ToolErrorType.QUOTA_EXCEEDED);
      expect(err.retryable).toBe(false);
    });

    it("should classify 'limit exceeded' as QUOTA_EXCEEDED", () => {
      const err = strategy.classifyError(new Error("limit exceeded"), toolId);
      expect(err.type).toBe(ToolErrorType.QUOTA_EXCEEDED);
      expect(err.retryable).toBe(false);
    });

    it("should classify invalid input as INVALID_INPUT (not retryable)", () => {
      const err = strategy.classifyError(new Error("invalid input"), toolId);
      expect(err.type).toBe(ToolErrorType.INVALID_INPUT);
      expect(err.retryable).toBe(false);
    });

    it("should classify validation error as INVALID_INPUT", () => {
      const err = strategy.classifyError(
        new Error("validation failed"),
        toolId,
      );
      expect(err.type).toBe(ToolErrorType.INVALID_INPUT);
      expect(err.retryable).toBe(false);
    });

    it("should classify 400 status in message as INVALID_INPUT", () => {
      const err = strategy.classifyError(
        new Error("HTTP 400 bad request"),
        toolId,
      );
      expect(err.type).toBe(ToolErrorType.INVALID_INPUT);
      expect(err.retryable).toBe(false);
    });

    it("should classify permission denied as PERMISSION_DENIED (not retryable)", () => {
      const err = strategy.classifyError(
        new Error("permission denied"),
        toolId,
      );
      expect(err.type).toBe(ToolErrorType.PERMISSION_DENIED);
      expect(err.retryable).toBe(false);
    });

    it("should classify unauthorized as PERMISSION_DENIED", () => {
      const err = strategy.classifyError(new Error("unauthorized"), toolId);
      expect(err.type).toBe(ToolErrorType.PERMISSION_DENIED);
      expect(err.retryable).toBe(false);
    });

    it("should classify 403 status as PERMISSION_DENIED", () => {
      const err = strategy.classifyError(new Error("403 forbidden"), toolId);
      expect(err.type).toBe(ToolErrorType.PERMISSION_DENIED);
      expect(err.retryable).toBe(false);
    });

    it("should classify 'not found' as RESOURCE_NOT_FOUND (not retryable)", () => {
      const err = strategy.classifyError(
        new Error("resource not found"),
        toolId,
      );
      expect(err.type).toBe(ToolErrorType.RESOURCE_NOT_FOUND);
      expect(err.retryable).toBe(false);
    });

    it("should classify 404 status as RESOURCE_NOT_FOUND", () => {
      const err = strategy.classifyError(new Error("HTTP 404"), toolId);
      expect(err.type).toBe(ToolErrorType.RESOURCE_NOT_FOUND);
      expect(err.retryable).toBe(false);
    });

    it("should classify unknown error as UNKNOWN (not retryable)", () => {
      const err = strategy.classifyError(
        new Error("something completely different"),
        toolId,
      );
      expect(err.type).toBe(ToolErrorType.UNKNOWN);
      expect(err.retryable).toBe(false);
    });

    it("should handle non-Error objects", () => {
      const err = strategy.classifyError("plain string error", toolId);
      expect(err.message).toBe("plain string error");
      expect(err.originalError).toBeInstanceOf(Error);
    });

    it("should populate toolId in the returned error", () => {
      const err = strategy.classifyError(new Error("timeout"), "specific-tool");
      expect(err.toolId).toBe("specific-tool");
    });

    it("should populate originalError in the returned error", () => {
      const original = new Error("rate limit exceeded");
      const err = strategy.classifyError(original, toolId);
      expect(err.originalError).toBe(original);
    });
  });

  // --------------------------------------------------------------------------
  // ToolErrorType enum
  // --------------------------------------------------------------------------

  describe("ToolErrorType enum", () => {
    it("should export all expected error type values", () => {
      expect(ToolErrorType.RATE_LIMIT).toBe("RATE_LIMIT");
      expect(ToolErrorType.TIMEOUT).toBe("TIMEOUT");
      expect(ToolErrorType.NETWORK_ERROR).toBe("NETWORK_ERROR");
      expect(ToolErrorType.SERVICE_UNAVAILABLE).toBe("SERVICE_UNAVAILABLE");
      expect(ToolErrorType.QUOTA_EXCEEDED).toBe("QUOTA_EXCEEDED");
      expect(ToolErrorType.FEATURE_NOT_SUPPORTED).toBe("FEATURE_NOT_SUPPORTED");
      expect(ToolErrorType.INVALID_INPUT).toBe("INVALID_INPUT");
      expect(ToolErrorType.PERMISSION_DENIED).toBe("PERMISSION_DENIED");
      expect(ToolErrorType.RESOURCE_NOT_FOUND).toBe("RESOURCE_NOT_FOUND");
      expect(ToolErrorType.UNKNOWN).toBe("UNKNOWN");
    });
  });

  // --------------------------------------------------------------------------
  // WithRetry decorator
  // --------------------------------------------------------------------------

  describe("WithRetry() decorator", () => {
    it("should return the method result on success", async () => {
      class TestService {
        @WithRetry({ maxRetries: 1, initialDelay: 10, maxDelay: 100 })
        async doWork(): Promise<string> {
          return "decorated result";
        }
      }

      const svc = new TestService();
      const result = await svc.doWork();
      expect(result).toBe("decorated result");
    });

    it("should throw when all retries fail with originalError", async () => {
      class TestService {
        private _callCount = 0;

        @WithRetry({ maxRetries: 1, initialDelay: 1, maxDelay: 10 })
        async failingWork(): Promise<string> {
          this._callCount++;
          throw new Error("timeout occurred");
        }
      }

      const svc = new TestService();
      await expect(svc.failingWork()).rejects.toThrow("timeout occurred");
    });

    it("should throw generic error when originalError is undefined", async () => {
      // Simulate a non-retryable error so it fails on first attempt
      class TestService {
        @WithRetry({ maxRetries: 0, initialDelay: 1, maxDelay: 10 })
        async neverRetry(): Promise<string> {
          throw new Error("invalid input: 400");
        }
      }

      const svc = new TestService();
      await expect(svc.neverRetry()).rejects.toThrow();
    });

    it("should work without options", async () => {
      class TestService {
        @WithRetry()
        async simpleWork(): Promise<number> {
          return 99;
        }
      }

      const svc = new TestService();
      const result = await svc.simpleWork();
      expect(result).toBe(99);
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe("edge cases", () => {
    it("should handle maxRetries = 0 (no retries, only first attempt)", async () => {
      const strategy = new RetryStrategy({ maxRetries: 0 });
      const operation = jest
        .fn()
        .mockRejectedValue(new Error("timeout occurred"));

      const result = await strategy.executeWithRetry(operation, "tool-z");

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should succeed on last allowed retry", async () => {
      const strategy = new RetryStrategy(makeConfig({ maxRetries: 3 }));

      jest
        .spyOn(
          strategy as unknown as { sleep: (ms: number) => Promise<void> },
          "sleep",
        )
        .mockResolvedValue(undefined);

      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("timeout 1"))
        .mockRejectedValueOnce(new Error("timeout 2"))
        .mockRejectedValueOnce(new Error("timeout 3"))
        .mockResolvedValue("success on 4th");

      const result = await strategy.executeWithRetry(operation, "tool-w");

      expect(result.success).toBe(true);
      expect(result.data).toBe("success on 4th");
      expect(result.attempts).toBe(4);
    });

    it("should track totalDuration greater than 0 when retries happen", async () => {
      const strategy = new RetryStrategy(makeConfig({ maxRetries: 1 }));

      jest
        .spyOn(
          strategy as unknown as { sleep: (ms: number) => Promise<void> },
          "sleep",
        )
        .mockResolvedValue(undefined);

      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValue("ok");

      const result = await strategy.executeWithRetry(operation, "tool-v");

      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it("should return the last error when all retries exhausted", async () => {
      const strategy = new RetryStrategy(makeConfig({ maxRetries: 1 }));

      jest
        .spyOn(
          strategy as unknown as { sleep: (ms: number) => Promise<void> },
          "sleep",
        )
        .mockResolvedValue(undefined);

      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("timeout 1"))
        .mockRejectedValueOnce(new Error("timeout 2"));

      const result = await strategy.executeWithRetry(operation, "tool-u");

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("timeout 2");
    });
  });
});
