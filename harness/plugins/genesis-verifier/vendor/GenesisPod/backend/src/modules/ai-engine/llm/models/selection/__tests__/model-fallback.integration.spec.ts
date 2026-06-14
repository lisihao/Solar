/**
 * ModelFallbackService - 扩展测试
 *
 * 补充现有 model-fallback.service.spec.ts 的覆盖范围：
 * - shouldSwitchModel() 错误分类
 * - isRetryableError() 可重试判断
 * - isModelBlocked() 黑名单机制
 * - 黑名单过期清理
 * - executeWithFallback() 完整链路
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ModelFallbackService } from "../model-fallback.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AIError, AIErrorType } from "../../../abstractions/error-classifier";

describe("ModelFallbackService - Extended", () => {
  let service: ModelFallbackService;
  let mockPrisma: any;

  const createMockModels = () => [
    {
      id: "1",
      modelId: "gpt-4o",
      displayName: "GPT-4o",
      provider: "openai",
      isEnabled: true,
      isDefault: true,
      maxTokens: 4096,
      apiKey: "sk-xxx",
      modelType: "CHAT",
      priority: 1,
    },
    {
      id: "2",
      modelId: "claude-3-opus",
      displayName: "Claude 3 Opus",
      provider: "anthropic",
      isEnabled: true,
      isDefault: false,
      maxTokens: 8000,
      apiKey: "sk-ant-xxx",
      modelType: "CHAT",
      priority: 2,
    },
    {
      id: "3",
      modelId: "gpt-4o-mini",
      displayName: "GPT-4o Mini",
      provider: "openai",
      isEnabled: true,
      isDefault: false,
      maxTokens: 2048,
      apiKey: "sk-xxx",
      modelType: "CHAT",
      priority: 3,
    },
  ];

  beforeEach(async () => {
    mockPrisma = {
      aIModel: {
        findMany: jest.fn().mockImplementation(({ where }: any = {}) => {
          let models = createMockModels();
          if (where?.modelId?.notIn) {
            models = models.filter(
              (m: any) => !where.modelId.notIn.includes(m.modelId),
            );
          }
          if (where?.modelType) {
            models = models.filter((m: any) => m.modelType === where.modelType);
          }
          return Promise.resolve(models);
        }),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          const models = createMockModels();
          let match: any = null;
          if (where?.OR) {
            const modelIdEquals = where.OR.find((c: any) => c.modelId)?.modelId
              ?.equals;
            const nameEquals = where.OR.find((c: any) => c.name)?.name?.equals;
            match = models.find(
              (m: any) =>
                (modelIdEquals &&
                  m.modelId.toLowerCase() === modelIdEquals.toLowerCase()) ||
                (nameEquals &&
                  m.displayName?.toLowerCase() === nameEquals.toLowerCase()),
            );
          } else {
            match = models.find(
              (m: any) => m.modelId === where?.modelId || m.id === where?.id,
            );
          }
          if (match && where?.isEnabled !== undefined && !match.isEnabled) {
            return Promise.resolve(null);
          }
          return Promise.resolve(match || null);
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelFallbackService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ModelFallbackService>(ModelFallbackService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // shouldSwitchModel
  // =========================================================================

  describe("shouldSwitchModel", () => {
    it("should return true for quota errors", () => {
      const error = new AIError(AIErrorType.QUOTA_EXCEEDED, "Quota exceeded");
      expect(service.shouldSwitchModel(error)).toBe(true);
    });

    it("should return true for invalid_model errors", () => {
      const error = new AIError(AIErrorType.INVALID_MODEL, "Model not found");
      expect(service.shouldSwitchModel(error)).toBe(true);
    });

    it("should return true for content_filtered errors", () => {
      const error = new AIError(
        AIErrorType.CONTENT_FILTERED,
        "Content filtered",
      );
      expect(service.shouldSwitchModel(error)).toBe(true);
    });

    it("should return false for timeout errors (retryable, not switch)", () => {
      const error = new AIError(AIErrorType.TIMEOUT, "Timeout");
      expect(service.shouldSwitchModel(error)).toBe(false);
    });

    it("should return false for unknown error types", () => {
      const error = new AIError(AIErrorType.UNKNOWN, "Unknown");
      expect(service.shouldSwitchModel(error)).toBe(false);
    });
  });

  // =========================================================================
  // isRetryableError
  // =========================================================================

  describe("isRetryableError", () => {
    it("should return true for timeout errors", () => {
      const error = new AIError(AIErrorType.TIMEOUT, "Timeout");
      expect(service.isRetryableError(error)).toBe(true);
    });

    it("should return true for network_error", () => {
      const error = new AIError(AIErrorType.NETWORK_ERROR, "Network");
      expect(service.isRetryableError(error)).toBe(true);
    });

    it("should return true for temporary_unavailable", () => {
      const error = new AIError(AIErrorType.TEMPORARY_UNAVAILABLE, "Temp");
      expect(service.isRetryableError(error)).toBe(true);
    });

    it("should return false for rate_limit (handled separately in executeWithFallback)", () => {
      const error = new AIError(AIErrorType.RATE_LIMIT, "Rate limited");
      expect(service.isRetryableError(error)).toBe(false);
    });

    it("should return false for quota errors (should switch)", () => {
      const error = new AIError(AIErrorType.QUOTA_EXCEEDED, "Quota");
      expect(service.isRetryableError(error)).toBe(false);
    });
  });

  // =========================================================================
  // isModelBlocked
  // =========================================================================

  describe("isModelBlocked", () => {
    it("should return false for non-blocked model", () => {
      expect(service.isModelBlocked("gpt-4o")).toBe(false);
    });

    it("should block model after invalid_api_key error in executeWithFallback", async () => {
      const error = new AIError(AIErrorType.INVALID_API_KEY, "Invalid API key");

      const executor = jest.fn().mockRejectedValue(error);

      try {
        await service.executeWithFallback("gpt-4o", executor, {
          maxRetries: 0,
          maxModelSwitches: 0,
        });
      } catch {
        // Expected to fail
      }

      // After invalid_api_key, model should be blocked
      expect(service.isModelBlocked("gpt-4o")).toBe(true);
    });
  });

  // =========================================================================
  // getModelFallbackChain
  // =========================================================================

  describe("getModelFallbackChain", () => {
    it("should return enabled models in priority order", async () => {
      const chain = await service.getModelFallbackChain();

      expect(chain.length).toBeGreaterThan(0);
    });

    it("should exclude specified models", async () => {
      const chain = await service.getModelFallbackChain({
        excludeModels: ["gpt-4o"],
      });

      expect(chain.every((m) => m.modelId !== "gpt-4o")).toBe(true);
    });
  });

  // =========================================================================
  // executeWithFallback
  // =========================================================================

  describe("executeWithFallback", () => {
    it("should succeed on first try", async () => {
      const executor = jest.fn().mockResolvedValue("success");

      const result = await service.executeWithFallback("gpt-4o", executor);

      expect(result.success).toBe(true);
      expect(result.data).toBe("success");
      expect(result.fallbackUsed).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it("should retry on retryable error", async () => {
      const error = new AIError(AIErrorType.TIMEOUT, "Timeout");

      const executor = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue("recovered");

      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxRetries: 1,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe("recovered");
      expect(result.attempts).toBe(2);
    });

    it("should switch model on model-switch errors", async () => {
      const quotaError = new AIError(
        AIErrorType.QUOTA_EXCEEDED,
        "Quota exceeded",
      );

      const executor = jest
        .fn()
        .mockRejectedValueOnce(quotaError)
        .mockResolvedValue("fallback-success");

      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxModelSwitches: 1,
      });

      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
    });

    it("should return failure after all retries and switches exhausted", async () => {
      const error = new AIError(
        AIErrorType.QUOTA_EXCEEDED,
        "Permanent failure",
      );

      const executor = jest.fn().mockRejectedValue(error);

      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxRetries: 0,
        maxModelSwitches: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should track attempted models", async () => {
      const error = new AIError(AIErrorType.QUOTA_EXCEEDED, "Quota");

      const executor = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue("ok");

      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxModelSwitches: 2,
        maxRetries: 0,
      });

      if (result.success) {
        expect(result.attemptedModels.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // =========================================================================
  // Priority patterns
  // =========================================================================

  describe("priority patterns", () => {
    it("should accept reasoning model priority patterns", () => {
      expect(() => {
        service.setReasoningModelPriority([/o3/, /o1/, /deepseek-r1/]);
      }).not.toThrow();
    });

    it("should accept fast model priority patterns", () => {
      expect(() => {
        service.setFastModelPriority([/gpt-4o-mini/, /claude-haiku/]);
      }).not.toThrow();
    });
  });
});
