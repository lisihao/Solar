/**
 * AIErrorClassifier 单元测试
 *
 * 验证错误分类的正确性和可重试性判断
 */

import { AIErrorClassifier, AIError, AIErrorType } from "../error-classifier";
import { AxiosError } from "axios";

describe("AIErrorClassifier", () => {
  let classifier: AIErrorClassifier;

  beforeEach(() => {
    classifier = new AIErrorClassifier();
  });

  describe("classify", () => {
    it("should return existing AIError unchanged", () => {
      const originalError = new AIError(
        AIErrorType.RATE_LIMIT,
        "Rate limit",
        429,
      );

      const result = classifier.classify(originalError);

      expect(result).toBe(originalError);
    });

    it("should classify 429 as RATE_LIMIT", () => {
      const axiosError = createAxiosError(429, "Too many requests");

      const result = classifier.classify(axiosError);

      expect(result.type).toBe(AIErrorType.RATE_LIMIT);
      expect(result.isRetryable()).toBe(true);
    });

    it("should classify 429 with quota message as QUOTA_EXCEEDED", () => {
      const axiosError = createAxiosError(429, "You exceeded your quota");

      const result = classifier.classify(axiosError);

      expect(result.type).toBe(AIErrorType.QUOTA_EXCEEDED);
      expect(result.isRetryable()).toBe(false);
    });

    it("should classify 403 billing/credits exhaustion as QUOTA_EXCEEDED (non-retryable)", () => {
      // Live xai wording: "spending limit" contains "limit" — must NOT be misread
      // as a retryable rate-limit and burn 3 retries on a dead-credits key.
      const axiosError = createAxiosError(
        403,
        "Your team has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.",
      );

      const result = classifier.classify(axiosError);

      expect(result.type).toBe(AIErrorType.QUOTA_EXCEEDED);
      expect(result.isRetryable()).toBe(false);
    });

    it("should classify 403 rate-limit (no billing words) as RATE_LIMIT", () => {
      const axiosError = createAxiosError(403, "rate limit exceeded");

      const result = classifier.classify(axiosError);

      expect(result.type).toBe(AIErrorType.RATE_LIMIT);
      expect(result.isRetryable()).toBe(true);
    });

    it("should classify 401 as INVALID_API_KEY", () => {
      const axiosError = createAxiosError(401, "Invalid API key");

      const result = classifier.classify(axiosError);

      expect(result.type).toBe(AIErrorType.INVALID_API_KEY);
      expect(result.isRetryable()).toBe(false);
    });

    it("should classify 400 as INVALID_REQUEST", () => {
      const axiosError = createAxiosError(400, "Invalid request body");

      const result = classifier.classify(axiosError);

      expect(result.type).toBe(AIErrorType.INVALID_REQUEST);
      expect(result.isRetryable()).toBe(false);
    });

    it("should classify 400 with context_length as CONTEXT_TOO_LONG", () => {
      const axiosError = createAxiosError(
        400,
        "This model maximum context length is 4096 tokens",
      );

      const result = classifier.classify(axiosError);

      expect(result.type).toBe(AIErrorType.CONTEXT_TOO_LONG);
      expect(result.isRetryable()).toBe(false);
    });

    it("should classify 404 as INVALID_MODEL", () => {
      const axiosError = createAxiosError(404, "Model not found");

      const result = classifier.classify(axiosError);

      expect(result.type).toBe(AIErrorType.INVALID_MODEL);
      expect(result.isRetryable()).toBe(false);
    });

    it("should classify 5xx as TEMPORARY_UNAVAILABLE", () => {
      const statusCodes = [500, 502, 503, 504];

      for (const status of statusCodes) {
        const axiosError = createAxiosError(status, "Server error");

        const result = classifier.classify(axiosError);

        expect(result.type).toBe(AIErrorType.TEMPORARY_UNAVAILABLE);
        expect(result.isRetryable()).toBe(true);
      }
    });

    it("should classify ECONNABORTED as TIMEOUT", () => {
      const axiosError = {
        code: "ECONNABORTED",
        message: "timeout",
        isAxiosError: true,
      } as AxiosError;

      const result = classifier.classify(axiosError);

      expect(result.type).toBe(AIErrorType.TIMEOUT);
      expect(result.isRetryable()).toBe(true);
    });

    it("should classify ECONNREFUSED as NETWORK_ERROR", () => {
      const axiosError = {
        code: "ECONNREFUSED",
        message: "Connection refused",
        isAxiosError: true,
      } as AxiosError;

      const result = classifier.classify(axiosError);

      expect(result.type).toBe(AIErrorType.NETWORK_ERROR);
      expect(result.isRetryable()).toBe(true);
    });

    it("should classify unknown errors as UNKNOWN", () => {
      const result = classifier.classify("Something went wrong");

      expect(result.type).toBe(AIErrorType.UNKNOWN);
      expect(result.message).toBe("Something went wrong");
    });
  });
});

describe("AIError", () => {
  describe("isRetryable", () => {
    it("should return true for retryable errors", () => {
      const retryableTypes = [
        AIErrorType.RATE_LIMIT,
        AIErrorType.TIMEOUT,
        AIErrorType.TEMPORARY_UNAVAILABLE,
        AIErrorType.NETWORK_ERROR,
      ];

      for (const type of retryableTypes) {
        const error = new AIError(type, "test");
        expect(error.isRetryable()).toBe(true);
      }
    });

    it("should return false for non-retryable errors", () => {
      const nonRetryableTypes = [
        AIErrorType.INVALID_API_KEY,
        AIErrorType.INVALID_MODEL,
        AIErrorType.INVALID_REQUEST,
        AIErrorType.INVALID_RESPONSE,
        AIErrorType.QUOTA_EXCEEDED,
        AIErrorType.CONTENT_FILTERED,
        AIErrorType.CONTEXT_TOO_LONG,
        AIErrorType.UNKNOWN,
      ];

      for (const type of nonRetryableTypes) {
        const error = new AIError(type, "test");
        expect(error.isRetryable()).toBe(false);
      }
    });
  });

  describe("getRetryDelay", () => {
    it("should return appropriate delays for retryable errors", () => {
      expect(new AIError(AIErrorType.RATE_LIMIT, "").getRetryDelay()).toBe(
        5000,
      );
      expect(new AIError(AIErrorType.TIMEOUT, "").getRetryDelay()).toBe(1000);
      expect(
        new AIError(AIErrorType.TEMPORARY_UNAVAILABLE, "").getRetryDelay(),
      ).toBe(10000);
      expect(new AIError(AIErrorType.NETWORK_ERROR, "").getRetryDelay()).toBe(
        2000,
      );
    });

    it("should return 0 for non-retryable errors", () => {
      expect(new AIError(AIErrorType.INVALID_API_KEY, "").getRetryDelay()).toBe(
        0,
      );
      expect(new AIError(AIErrorType.UNKNOWN, "").getRetryDelay()).toBe(0);
    });
  });

  describe("getUserMessage", () => {
    it("should return user-friendly messages in Chinese", () => {
      const error = new AIError(AIErrorType.RATE_LIMIT, "Technical message");

      expect(error.getUserMessage()).toContain("请求过于频繁");
    });
  });

  describe("toJSON", () => {
    it("should serialize error correctly", () => {
      const error = new AIError(AIErrorType.RATE_LIMIT, "Rate limit", 429);

      const json = error.toJSON();

      expect(json).toEqual(
        expect.objectContaining({
          type: AIErrorType.RATE_LIMIT,
          message: "Rate limit",
          statusCode: 429,
          retryable: true,
          retryDelay: 5000,
        }),
      );
    });
  });
});

// Helper function
function createAxiosError(status: number, message: string): AxiosError {
  return {
    response: {
      status,
      data: { error: { message } },
    },
    isAxiosError: true,
    message,
  } as AxiosError;
}
