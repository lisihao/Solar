/**
 * Unit tests for error-detection.utils.ts
 */

import {
  isRetryableError,
  isRateLimitError,
  isPermanentError,
  isApiErrorContent,
  parseErrorType,
  calculateBackoffDelay,
  sleep,
  withRetry,
  DEFAULT_RETRY_CONFIG,
  ErrorDetectionRetryConfig,
} from "../error-detection.utils";

// ==================== isRetryableError ====================

describe("isRetryableError", () => {
  describe("retryable messages", () => {
    it("returns true for timeout messages", () => {
      expect(isRetryableError("Connection timeout exceeded")).toBe(true);
    });

    it("returns true for ETIMEDOUT messages", () => {
      expect(isRetryableError("ETIMEDOUT: connection timed out")).toBe(true);
    });

    it("returns true for ECONNRESET messages", () => {
      expect(isRetryableError("ECONNRESET: connection reset by peer")).toBe(
        true,
      );
    });

    it("returns true for ECONNREFUSED messages", () => {
      expect(isRetryableError("ECONNREFUSED: connection refused")).toBe(true);
    });

    it("returns true for 503 service unavailable", () => {
      expect(isRetryableError("503 Service Unavailable")).toBe(true);
    });

    it("returns true for 502 bad gateway", () => {
      expect(isRetryableError("502 Bad Gateway")).toBe(true);
    });

    it("returns true for overloaded messages", () => {
      expect(isRetryableError("The server is currently overloaded")).toBe(true);
    });

    it("returns true for too many requests (rate limit)", () => {
      expect(isRetryableError("Too many requests - please wait")).toBe(true);
    });

    it("returns true for rate-limit messages", () => {
      expect(isRetryableError("rate limit exceeded for model")).toBe(true);
    });

    it("returns true for 429 in message", () => {
      expect(isRetryableError("HTTP 429 error received")).toBe(true);
    });

    it("returns true for unknown messages (default behaviour)", () => {
      expect(isRetryableError("something completely unexpected happened")).toBe(
        true,
      );
    });
  });

  describe("non-retryable messages (auth / context / 4xx)", () => {
    it("returns false for authentication errors", () => {
      expect(isRetryableError("authentication failed for the request")).toBe(
        false,
      );
    });

    it("returns false for authorization errors", () => {
      expect(isRetryableError("authorization required")).toBe(false);
    });

    it("returns false for 401 in message", () => {
      expect(isRetryableError("HTTP 401 Unauthorized")).toBe(false);
    });

    it("returns false for 403 in message", () => {
      expect(isRetryableError("403 Forbidden access")).toBe(false);
    });

    it("returns false for 404 in message", () => {
      expect(isRetryableError("404 Not Found")).toBe(false);
    });

    it("returns false for context too large", () => {
      expect(isRetryableError("context too large for this model")).toBe(false);
    });

    it("returns false for token limit exceeded", () => {
      expect(isRetryableError("token limit exceeded for request")).toBe(false);
    });

    it("returns false for invalid API key", () => {
      expect(isRetryableError("invalid api key provided")).toBe(false);
    });

    it("returns false for invalid model", () => {
      expect(isRetryableError("invalid model specified")).toBe(false);
    });

    it("returns false for content policy violations", () => {
      expect(isRetryableError("content policy violation detected")).toBe(false);
    });

    it("returns false for model not available", () => {
      expect(isRetryableError("model not available in this region")).toBe(
        false,
      );
    });
  });

  describe("custom config", () => {
    it("respects custom nonRetryablePatterns", () => {
      const customConfig: ErrorDetectionRetryConfig = {
        ...DEFAULT_RETRY_CONFIG,
        nonRetryablePatterns: [/custom_permanent/i],
        retryablePatterns: [],
      };
      expect(isRetryableError("custom_permanent error", customConfig)).toBe(
        false,
      );
    });

    it("respects custom retryablePatterns", () => {
      const customConfig: ErrorDetectionRetryConfig = {
        ...DEFAULT_RETRY_CONFIG,
        nonRetryablePatterns: [],
        retryablePatterns: [/my_custom_retry/i],
      };
      expect(isRetryableError("my_custom_retry error", customConfig)).toBe(
        true,
      );
    });
  });
});

// ==================== isRateLimitError ====================

describe("isRateLimitError", () => {
  it("returns true for rate limit messages", () => {
    expect(isRateLimitError("rate limit exceeded for model gpt-4")).toBe(true);
  });

  it("returns true for ratelimit without space", () => {
    expect(isRateLimitError("ratelimit hit")).toBe(true);
  });

  it("returns true for too many requests", () => {
    expect(isRateLimitError("too many requests sent")).toBe(true);
  });

  it("returns true for HTTP 429", () => {
    expect(isRateLimitError("HTTP 429 received from API")).toBe(true);
  });

  it("returns true for quota exceeded", () => {
    expect(isRateLimitError("quota exceeded for this billing period")).toBe(
      true,
    );
  });

  it("returns false for a generic server error", () => {
    expect(isRateLimitError("500 Internal Server Error")).toBe(false);
  });

  it("returns false for a timeout error", () => {
    expect(isRateLimitError("Connection timeout")).toBe(false);
  });

  it("returns false for auth errors", () => {
    expect(isRateLimitError("401 Unauthorized")).toBe(false);
  });
});

// ==================== isPermanentError ====================

describe("isPermanentError", () => {
  it("returns true for context too large", () => {
    expect(isPermanentError("context too large for model")).toBe(true);
  });

  it("returns true for context overflow", () => {
    expect(isPermanentError("context overflow in request")).toBe(true);
  });

  it("returns true for token limit exceeded", () => {
    expect(isPermanentError("token limit exceeded")).toBe(true);
  });

  it("returns true for invalid request", () => {
    expect(isPermanentError("invalid request format")).toBe(true);
  });

  it("returns true for invalid API key", () => {
    expect(isPermanentError("invalid api key")).toBe(true);
  });

  it("returns true for authentication failed", () => {
    expect(isPermanentError("authentication required")).toBe(true);
  });

  it("returns true for authorization denied", () => {
    expect(isPermanentError("authorization denied")).toBe(true);
  });

  it("returns true for 403 forbidden", () => {
    expect(isPermanentError("403 Forbidden")).toBe(true);
  });

  it("returns true for 401 unauthorized", () => {
    expect(isPermanentError("401 Unauthorized")).toBe(true);
  });

  it("returns true for 404 not found", () => {
    expect(isPermanentError("Resource 404 not found")).toBe(true);
  });

  it("returns true for model not available", () => {
    expect(isPermanentError("model not available for this account")).toBe(true);
  });

  it("returns true for content policy", () => {
    expect(isPermanentError("content policy violation")).toBe(true);
  });

  it("returns false for transient errors", () => {
    expect(isPermanentError("Connection timeout ETIMEDOUT")).toBe(false);
  });

  it("returns false for 503 service unavailable", () => {
    expect(isPermanentError("503 Service Unavailable")).toBe(false);
  });
});

// ==================== isApiErrorContent ====================

describe("isApiErrorContent", () => {
  it("returns false for empty string", () => {
    expect(isApiErrorContent("")).toBe(false);
  });

  it("returns true for content containing 'API Error:'", () => {
    expect(
      isApiErrorContent("API Error: Something went wrong with your request."),
    ).toBe(true);
  });

  it("returns true for content with Rate limit exceeded", () => {
    expect(
      isApiErrorContent("Rate limit exceeded. Please try again later."),
    ).toBe(true);
  });

  it("returns true for 'Please check your API key'", () => {
    expect(isApiErrorContent("Please check your API key and try again.")).toBe(
      true,
    );
  });

  it("returns true for ECONNREFUSED in content", () => {
    expect(isApiErrorContent("ECONNREFUSED 127.0.0.1:11434")).toBe(true);
  });

  it("returns true for ETIMEDOUT in content", () => {
    expect(isApiErrorContent("ETIMEDOUT after 30000ms")).toBe(true);
  });

  it("returns true for 500 Internal Server Error in content", () => {
    expect(isApiErrorContent("500 Internal Server Error from upstream")).toBe(
      true,
    );
  });

  it("returns true for 503 Service Unavailable in content", () => {
    expect(isApiErrorContent("503 Service Unavailable")).toBe(true);
  });

  it("returns true for quota exceeded", () => {
    expect(isApiErrorContent("quota exceeded for this month")).toBe(true);
  });

  it("returns true for insufficient quota", () => {
    expect(
      isApiErrorContent("insufficient_quota: You have run out of credits"),
    ).toBe(true);
  });

  it("returns true for short content containing 'Error'", () => {
    // < 100 chars and contains "Error"
    expect(isApiErrorContent("Error 42")).toBe(true);
  });

  it("returns true for short content containing Chinese '错误'", () => {
    expect(isApiErrorContent("发生错误")).toBe(true);
  });

  it("returns false for normal non-error content longer than 100 chars", () => {
    const longNormalContent =
      "This is a valid and complete response from the AI model. " +
      "It contains useful information and no error indicators at all.";
    expect(isApiErrorContent(longNormalContent)).toBe(false);
  });

  it("returns false for short content without error keywords", () => {
    expect(isApiErrorContent("Ok")).toBe(false);
  });
});

// ==================== parseErrorType ====================

describe("parseErrorType", () => {
  it("returns rate_limit for rate limit messages", () => {
    expect(parseErrorType("rate limit exceeded")).toBe("rate_limit");
  });

  it("returns rate_limit for 429 messages", () => {
    expect(parseErrorType("HTTP 429 Too Many Requests")).toBe("rate_limit");
  });

  it("returns timeout for timeout messages", () => {
    expect(parseErrorType("Connection timeout after 30s")).toBe("timeout");
  });

  it("returns timeout for etimedout messages", () => {
    expect(parseErrorType("ETIMEDOUT connecting to host")).toBe("timeout");
  });

  it("returns auth for authentication messages", () => {
    expect(parseErrorType("authentication failed")).toBe("auth");
  });

  it("returns auth for authorization messages", () => {
    expect(parseErrorType("authorization required")).toBe("auth");
  });

  it("returns auth for 401 in message", () => {
    expect(parseErrorType("HTTP 401 Unauthorized")).toBe("auth");
  });

  it("returns auth for 403 in message", () => {
    expect(parseErrorType("403 Forbidden")).toBe("auth");
  });

  it("returns context_overflow for context overflow", () => {
    expect(parseErrorType("context too large for this request")).toBe(
      "context_overflow",
    );
  });

  it("returns context_overflow for token limit", () => {
    expect(parseErrorType("token limit exceeded by 1000 tokens")).toBe(
      "context_overflow",
    );
  });

  it("returns unknown for unrecognised errors", () => {
    expect(parseErrorType("some random unexpected error message xyz")).toBe(
      "unknown",
    );
  });
});

// ==================== calculateBackoffDelay ====================

describe("calculateBackoffDelay", () => {
  it("returns a value close to initialDelayMs for attempt 0", () => {
    // delay = 1000 * 2^0 = 1000, jitter adds up to 10% = 100
    const delay = calculateBackoffDelay(0, DEFAULT_RETRY_CONFIG);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1100);
  });

  it("doubles approximately each attempt (exponential growth)", () => {
    const d0 = calculateBackoffDelay(0, DEFAULT_RETRY_CONFIG);
    const d1 = calculateBackoffDelay(1, DEFAULT_RETRY_CONFIG);
    // d1 should be roughly 2x d0 (allowing for jitter)
    expect(d1).toBeGreaterThanOrEqual(d0 * 1.5);
  });

  it("caps at maxDelayMs", () => {
    // attempt 10 => 1000 * 2^10 = 1_048_576 which is >> 10000
    const delay = calculateBackoffDelay(10, DEFAULT_RETRY_CONFIG);
    // max = 10000, jitter <= 1000 => max 11000
    expect(delay).toBeLessThanOrEqual(
      DEFAULT_RETRY_CONFIG.maxDelayMs * 1.1 + 1,
    );
  });

  it("respects custom initialDelayMs and multiplier", () => {
    const customConfig: ErrorDetectionRetryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      initialDelayMs: 500,
      backoffMultiplier: 3,
      maxDelayMs: 100000,
    };
    // attempt 1 => 500 * 3^1 = 1500
    const delay = calculateBackoffDelay(1, customConfig);
    expect(delay).toBeGreaterThanOrEqual(1500);
    expect(delay).toBeLessThanOrEqual(1650); // 1500 + 10% jitter
  });
});

// ==================== sleep ====================

describe("sleep", () => {
  it("resolves after approximately the specified delay", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    // Allow some timing tolerance
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("returns a Promise", () => {
    const result = sleep(0);
    expect(result).toBeInstanceOf(Promise);
    return result;
  });
});

// ==================== withRetry ====================

describe("withRetry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves immediately on first-try success", async () => {
    const operation = jest.fn().mockResolvedValue("success");
    const promise = withRetry(operation, { maxRetries: 3 });
    // Advance timers to flush any pending sleeps
    void jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and returns value on eventual success", async () => {
    let callCount = 0;
    const operation = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        throw new Error("temporary failure");
      }
      return Promise.resolve("eventual success");
    });

    const promise = withRetry(operation, {
      maxRetries: 3,
      shouldRetry: () => true,
    });

    // Flush timers to skip sleep delays
    void jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("eventual success");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all retries", async () => {
    const operation = jest
      .fn()
      .mockRejectedValue(new Error("permanent failure"));

    const promise = withRetry(operation, {
      maxRetries: 2,
      shouldRetry: () => true,
    });

    void jest.runAllTimersAsync();
    await expect(promise).rejects.toThrow("permanent failure");
    expect(operation).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("does not retry when shouldRetry returns false", async () => {
    const operation = jest
      .fn()
      .mockRejectedValue(new Error("401 Unauthorized"));

    const promise = withRetry(operation, {
      maxRetries: 3,
      shouldRetry: () => false,
    });

    void jest.runAllTimersAsync();
    await expect(promise).rejects.toThrow("401 Unauthorized");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry callback on each retry attempt", async () => {
    let callCount = 0;
    const operation = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) throw new Error("retry me");
      return Promise.resolve("done");
    });

    const onRetry = jest.fn();
    const promise = withRetry(operation, {
      maxRetries: 3,
      shouldRetry: () => true,
      onRetry,
    });

    void jest.runAllTimersAsync();
    await promise;
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
