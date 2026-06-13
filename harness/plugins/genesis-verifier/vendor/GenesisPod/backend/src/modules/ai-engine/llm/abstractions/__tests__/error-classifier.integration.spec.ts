/**
 * AIErrorClassifier 扩展测试 - 覆盖额外分支
 */
import { AIErrorClassifier, AIError, AIErrorType } from "../error-classifier";
import { AxiosError } from "axios";

describe("AIErrorClassifier (extended)", () => {
  let classifier: AIErrorClassifier;

  beforeEach(() => {
    classifier = new AIErrorClassifier();
  });

  describe("classify - axios errors (additional branches)", () => {
    it("should classify 402 as QUOTA_EXCEEDED", () => {
      const error = createAxiosError(402, "Payment required");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.QUOTA_EXCEEDED);
      expect(result.isRetryable()).toBe(false);
    });

    it("should classify 403 with content/safety keyword as CONTENT_FILTERED", () => {
      const error = createAxiosError(403, "content policy violation");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.CONTENT_FILTERED);
    });

    it("should classify 403 with safety keyword as CONTENT_FILTERED", () => {
      const error = createAxiosError(403, "safety filter triggered");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.CONTENT_FILTERED);
    });

    it("should classify 403 with rate limit keyword as RATE_LIMIT", () => {
      const error = createAxiosError(403, "rate limit exceeded");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.RATE_LIMIT);
    });

    it("should classify 403 with too many requests as RATE_LIMIT", () => {
      const error = createAxiosError(403, "too many requests");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.RATE_LIMIT);
    });

    it("should classify 403 with quota keyword as RATE_LIMIT", () => {
      const error = createAxiosError(403, "quota exceeded for requests");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.RATE_LIMIT);
    });

    it("should classify 403 with no matching keyword as INVALID_API_KEY", () => {
      const error = createAxiosError(403, "Access denied");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.INVALID_API_KEY);
    });

    it("should classify 400 with maximum context as CONTEXT_TOO_LONG", () => {
      const error = createAxiosError(400, "maximum context length exceeded");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.CONTEXT_TOO_LONG);
    });

    it("should classify 400 with too long as CONTEXT_TOO_LONG", () => {
      const error = createAxiosError(400, "input is too long for this model");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.CONTEXT_TOO_LONG);
    });

    it("should classify ETIMEDOUT code as TIMEOUT", () => {
      const error = {
        code: "ETIMEDOUT",
        message: "connection timed out",
        isAxiosError: true,
      } as AxiosError;
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.TIMEOUT);
    });

    it("should classify ENOTFOUND as NETWORK_ERROR", () => {
      const error = {
        code: "ENOTFOUND",
        message: "Host not found",
        isAxiosError: true,
      } as AxiosError;
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.NETWORK_ERROR);
    });

    it("should classify ENETUNREACH as NETWORK_ERROR", () => {
      const error = {
        code: "ENETUNREACH",
        message: "Network unreachable",
        isAxiosError: true,
      } as AxiosError;
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.NETWORK_ERROR);
    });

    it("should classify ECONNRESET as NETWORK_ERROR", () => {
      const error = {
        code: "ECONNRESET",
        message: "Connection reset",
        isAxiosError: true,
      } as AxiosError;
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.NETWORK_ERROR);
    });

    it("should classify EPIPE as NETWORK_ERROR", () => {
      const error = {
        code: "EPIPE",
        message: "Broken pipe",
        isAxiosError: true,
      } as AxiosError;
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.NETWORK_ERROR);
    });

    it("should classify socket hang up as NETWORK_ERROR", () => {
      const error = {
        message: "socket hang up",
        isAxiosError: true,
      } as AxiosError;
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.NETWORK_ERROR);
    });

    it("should classify network socket disconnected as NETWORK_ERROR", () => {
      const error = {
        message: "network socket disconnected",
        isAxiosError: true,
      } as AxiosError;
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.NETWORK_ERROR);
    });

    it("should handle axios error with no status code as UNKNOWN", () => {
      const error = {
        message: "Unknown axios error",
        isAxiosError: true,
        response: undefined,
      } as AxiosError;
      const result = classifier.classify(error);
      // No status, no matching code → UNKNOWN
      expect(result.type).toBe(AIErrorType.UNKNOWN);
    });

    it("should include provider in error", () => {
      const error = createAxiosError(401, "Unauthorized");
      const result = classifier.classify(error, "anthropic");
      expect(result.provider).toBe("anthropic");
    });
  });

  describe("classify - generic Error (classifyGenericError)", () => {
    it("should classify timeout message as TIMEOUT", () => {
      const error = new Error("Request timeout occurred");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.TIMEOUT);
    });

    it("should classify timed out message as TIMEOUT", () => {
      const error = new Error("operation timed out");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.TIMEOUT);
    });

    it("should classify network in message as NETWORK_ERROR", () => {
      const error = new Error("network failure");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.NETWORK_ERROR);
    });

    it("should classify connection in message as NETWORK_ERROR", () => {
      const error = new Error("connection refused");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.NETWORK_ERROR);
    });

    it("should classify read econnreset as NETWORK_ERROR", () => {
      const error = new Error("read econnreset");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.NETWORK_ERROR);
    });

    it("should classify api key in message as INVALID_API_KEY", () => {
      const error = new Error("invalid api key provided");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.INVALID_API_KEY);
    });

    it("should classify apikey in message as INVALID_API_KEY", () => {
      const error = new Error("apikey missing");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.INVALID_API_KEY);
    });

    it("should classify unauthorized in message as INVALID_API_KEY", () => {
      const error = new Error("Unauthorized access");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.INVALID_API_KEY);
    });

    it("should classify authentication in message as INVALID_API_KEY", () => {
      const error = new Error("authentication failed");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.INVALID_API_KEY);
    });

    it("should classify content filter in message as CONTENT_FILTERED", () => {
      const error = new Error("content filter activated");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.CONTENT_FILTERED);
    });

    it("should classify safety in message as CONTENT_FILTERED", () => {
      const error = new Error("safety violation detected");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.CONTENT_FILTERED);
    });

    it("should classify blocked in message as CONTENT_FILTERED", () => {
      const error = new Error("request blocked by policy");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.CONTENT_FILTERED);
    });

    it("should classify generic Error as UNKNOWN", () => {
      const error = new Error("some random error");
      const result = classifier.classify(error);
      expect(result.type).toBe(AIErrorType.UNKNOWN);
    });
  });

  describe("AIError - getUserMessage all branches", () => {
    it("should have user message for TIMEOUT", () => {
      const err = new AIError(AIErrorType.TIMEOUT, "timeout");
      expect(err.getUserMessage()).toContain("超时");
    });

    it("should have user message for TEMPORARY_UNAVAILABLE", () => {
      const err = new AIError(AIErrorType.TEMPORARY_UNAVAILABLE, "unavailable");
      expect(err.getUserMessage()).toContain("暂时不可用");
    });

    it("should have user message for NETWORK_ERROR", () => {
      const err = new AIError(AIErrorType.NETWORK_ERROR, "network");
      expect(err.getUserMessage()).toContain("网络");
    });

    it("should have user message for INVALID_MODEL", () => {
      const err = new AIError(AIErrorType.INVALID_MODEL, "no model");
      expect(err.getUserMessage()).toContain("不可用");
    });

    it("should have user message for INVALID_REQUEST", () => {
      const err = new AIError(AIErrorType.INVALID_REQUEST, "bad request");
      expect(err.getUserMessage()).toContain("参数错误");
    });

    it("should have user message for QUOTA_EXCEEDED", () => {
      const err = new AIError(AIErrorType.QUOTA_EXCEEDED, "quota");
      expect(err.getUserMessage()).toContain("配额");
    });

    it("should have user message for CONTENT_FILTERED", () => {
      const err = new AIError(AIErrorType.CONTENT_FILTERED, "filtered");
      expect(err.getUserMessage()).toContain("过滤");
    });

    it("should have user message for CONTEXT_TOO_LONG", () => {
      const err = new AIError(AIErrorType.CONTEXT_TOO_LONG, "long");
      expect(err.getUserMessage()).toContain("过长");
    });

    it("should have default user message for UNKNOWN", () => {
      const err = new AIError(AIErrorType.UNKNOWN, "unknown");
      expect(err.getUserMessage()).toContain("AI 服务");
    });
  });
});

// Helper
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
