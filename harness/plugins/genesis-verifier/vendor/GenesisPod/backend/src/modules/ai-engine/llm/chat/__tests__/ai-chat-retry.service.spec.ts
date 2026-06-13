import { Test, TestingModule } from "@nestjs/testing";
import { AiChatRetryService } from "../ai-chat-retry.service";

describe("AiChatRetryService", () => {
  let service: AiChatRetryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiChatRetryService],
    }).compile();

    service = module.get<AiChatRetryService>(AiChatRetryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("sleep", () => {
    it("should sleep for specified duration", async () => {
      const start = Date.now();
      await service.sleep(100);
      const end = Date.now();

      expect(end - start).toBeGreaterThanOrEqual(90);
    });

    it("should resolve immediately for 0ms", async () => {
      const start = Date.now();
      await service.sleep(0);
      const end = Date.now();

      expect(end - start).toBeLessThan(200);
    });
  });

  describe("classifyError", () => {
    it("should classify error and return category", () => {
      const error = new Error("some error");

      const result = service.classifyError(error);

      expect(result).toHaveProperty("category");
      expect(result).toHaveProperty("isRetriable");
      expect(result).toHaveProperty("message");
    });

    it("should classify timeout error as retriable", () => {
      const error = new Error("Request timeout");

      const result = service.classifyError(error);

      expect(result.category).toBe("TIMEOUT");
      expect(result.isRetriable).toBe(true);
    });

    it("should classify network error as retriable", () => {
      const error = new Error("Network error: ECONNREFUSED");

      const result = service.classifyError(error);

      expect(result.isRetriable).toBe(true);
    });

    it("should classify invalid API key as non-retriable", () => {
      const error = new Error("Invalid API key");

      const result = service.classifyError(error);

      expect(result.category).toBe("INVALID_API_KEY");
      expect(result.isRetriable).toBe(false);
    });

    it("should handle error without message", () => {
      const error = { code: "UNKNOWN" };

      const result = service.classifyError(error);

      expect(result).toHaveProperty("category");
      expect(result).toHaveProperty("isRetriable");
      expect(result).toHaveProperty("message");
    });
  });

  describe("executeWithRetry", () => {
    it("should execute function successfully without retry", async () => {
      const mockFn = jest.fn().mockResolvedValue("success");

      const result = await service.executeWithRetry(mockFn);

      expect(result).toBe("success");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should retry on retriable error", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockResolvedValueOnce("success");

      const result = await service.executeWithRetry(mockFn, {
        maxRetries: 2,
        retryDelays: [10, 20],
      });

      expect(result).toBe("success");
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it("should not retry on non-retriable error", async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error("Invalid API key"));

      await expect(
        service.executeWithRetry(mockFn, {
          maxRetries: 3,
        }),
      ).rejects.toThrow("Invalid API key");

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should throw error after max retries exhausted", async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error("Request timeout"));

      await expect(
        service.executeWithRetry(mockFn, {
          maxRetries: 2,
          retryDelays: [10, 20],
        }),
      ).rejects.toThrow("Request timeout");

      expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should call onRetry callback", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockResolvedValueOnce("success");
      const onRetry = jest.fn();

      await service.executeWithRetry(mockFn, {
        maxRetries: 2,
        retryDelays: [10, 20],
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(0, expect.any(Error));
    });

    it("should use custom context in logging", async () => {
      const mockFn = jest.fn().mockResolvedValue("success");

      const result = await service.executeWithRetry(mockFn, {
        context: "Custom API Call",
      });

      expect(result).toBe("success");
    });

    it("should use default retry configuration when not specified", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockResolvedValueOnce("success");

      const result = await service.executeWithRetry(mockFn);

      expect(result).toBe("success");
      expect(mockFn).toHaveBeenCalledTimes(2);
    });
  });

  // ★ 2026-06-02 BYOK throttle resilience：401 智能退避重试
  describe("withExponentialBackoff — smart 401 (transient throttle) retry", () => {
    beforeEach(() => {
      // 避免真实退避延迟拖慢测试
      jest.spyOn(service, "sleep").mockResolvedValue(undefined);
    });

    const invalidKeyError = () => new Error("Invalid API key");

    it("does NOT retry 401/INVALID_API_KEY by default (original behavior)", async () => {
      const op = jest.fn().mockRejectedValue(invalidKeyError());

      await expect(
        service.withExponentialBackoff(op, "test-op", "agnes"),
      ).rejects.toBeDefined();
      expect(op).toHaveBeenCalledTimes(1); // 立即失败，不重试
    });

    it("retries 401 as transient when retryTransient401=true and recovers", async () => {
      const op = jest
        .fn()
        .mockRejectedValueOnce(invalidKeyError())
        .mockResolvedValueOnce("ok");

      const res = await service.withExponentialBackoff(op, "test-op", "agnes", {
        retryTransient401: true,
      });

      expect(res).toBe("ok");
      expect(op).toHaveBeenCalledTimes(2); // 退避后第二次成功
    });

    it("gives up after max retries when 401 persists even with retryTransient401", async () => {
      const op = jest.fn().mockRejectedValue(invalidKeyError());

      await expect(
        service.withExponentialBackoff(op, "test-op", "agnes", {
          retryTransient401: true,
        }),
      ).rejects.toBeDefined();
      expect(op).toHaveBeenCalledTimes(3); // MAX_RETRIES 后放弃
    });
  });

  // 2026-05-01 (PR-X-T): validateAIServiceAvailability 删除 — 该方法在 retry
  // service 是空 TODO stub，真实现在 ai-chat.service.ts 上；0 caller 调用 retry 的版本。

  describe("buildErrorResponse", () => {
    it("should build error response for rate limit", () => {
      const error = new Error("rate limit exceeded");
      const model = "gpt-4";

      const result = service.buildErrorResponse(error, model);

      expect(result.content).toBeTruthy();
      expect(result.tokensUsed).toBe(0);
      expect(result.model).toBe(model);
      expect(result.isError).toBe(true);
    });

    it("should build error response for timeout", () => {
      const error = new Error("Request timeout");
      const model = "claude-3";

      const result = service.buildErrorResponse(error, model);

      expect(result.content).toContain("超时");
      expect(result.model).toBe(model);
      expect(result.isError).toBe(true);
    });

    it("should build error response for invalid request", () => {
      const error = new Error("bad request");
      const model = "gpt-4";

      const result = service.buildErrorResponse(error, model);

      expect(result.content).toBeTruthy();
      expect(result.isError).toBe(true);
    });

    it("should build error response for invalid API key", () => {
      const error = new Error("Invalid API key");
      const model = "gpt-4";

      const result = service.buildErrorResponse(error, model);

      expect(result.content).toContain("API Key");
      expect(result.isError).toBe(true);
    });

    it("should build generic error response for unknown errors", () => {
      const error = new Error("Unknown error");
      const model = "gpt-4";

      const result = service.buildErrorResponse(error, model);

      expect(result.content).toContain("AI 服务调用失败");
      expect(result.model).toBe(model);
    });
  });

  describe("handleApiError", () => {
    it("should throw error in strict mode", () => {
      const error = new Error("API error");
      const model = "gpt-4";

      expect(() => service.handleApiError(error, model, true)).toThrow(
        "API error",
      );
    });

    it("should return error response in non-strict mode", () => {
      const error = new Error("Request timeout");
      const model = "gpt-4";

      const result = service.handleApiError(error, model, false);

      expect(result.isError).toBe(true);
      expect(result.content).toBeTruthy();
    });

    it("should default to non-strict mode", () => {
      const error = new Error("API error");
      const model = "gpt-4";

      const result = service.handleApiError(error, model);

      expect(result.isError).toBe(true);
      expect(result).toHaveProperty("content");
    });
  });
});
