/**
 * AiChatRetryService 扩展测试 - 覆盖 withExponentialBackoff
 */
import { Test, TestingModule } from "@nestjs/testing";
import { AiChatRetryService } from "../ai-chat-retry.service";

describe("AiChatRetryService (extended)", () => {
  let service: AiChatRetryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiChatRetryService],
    }).compile();

    service = module.get<AiChatRetryService>(AiChatRetryService);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("withExponentialBackoff", () => {
    it("should succeed on first attempt", async () => {
      const operation = jest.fn().mockResolvedValue("result");

      const result = await service.withExponentialBackoff(operation, "test-op");

      expect(result).toBe("result");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should retry on retriable timeout error and eventually succeed", async () => {
      // First attempt fails with timeout (retriable), second succeeds
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockResolvedValueOnce("success");

      // Run without fake timers (use real fast timer)
      jest.useRealTimers();
      const result = await service.withExponentialBackoff(
        operation,
        "retry-op",
      );

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);
    }, 15000);

    it("should throw non-retryable error immediately without retrying", async () => {
      const operation = jest
        .fn()
        .mockRejectedValue(new Error("Invalid API key"));

      jest.useRealTimers();
      await expect(
        service.withExponentialBackoff(operation, "non-retry-op"),
      ).rejects.toThrow();

      // Should be called only once (no retry for non-retryable errors)
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should throw after max retries for retriable errors", async () => {
      const operation = jest
        .fn()
        .mockRejectedValue(new Error("Request timeout"));

      jest.useRealTimers();
      // MAX_RETRIES is 3, so it will try 3 times total
      await expect(
        service.withExponentialBackoff(operation, "exhaust-op"),
      ).rejects.toThrow();

      expect(operation).toHaveBeenCalledTimes(3);
    }, 30000);

    it("should accept provider context parameter", async () => {
      const operation = jest.fn().mockResolvedValue("result");

      jest.useRealTimers();
      const result = await service.withExponentialBackoff(
        operation,
        "test-op",
        "openai",
      );

      expect(result).toBe("result");
    });
  });

  describe("buildErrorResponse - edge cases", () => {
    it("should build error response with message for RATE_LIMIT category", () => {
      // Simulate a 429 rate limit Axios error
      const error = {
        isAxiosError: true,
        response: { status: 429, data: {} },
        message: "Too Many Requests",
      };
      jest.useRealTimers();
      const result = service.buildErrorResponse(error, "gpt-4");
      expect(result.content).toContain("频率限制");
      expect(result.isError).toBe(true);
    });

    it("should build error response for TIMEOUT category", () => {
      const error = new Error("Request timeout");
      jest.useRealTimers();
      const result = service.buildErrorResponse(error, "gpt-4");
      expect(result.content).toContain("超时");
      expect(result.isError).toBe(true);
    });

    it("should include model in generic error response", () => {
      // Unknown error falls into the else branch which includes error message
      const error = new Error("network failure occurred");
      jest.useRealTimers();
      const result = service.buildErrorResponse(error, "model-x");
      // Generic error path includes the error message
      expect(result.content).toBeTruthy();
      expect(result.model).toBe("model-x");
    });
  });
});
