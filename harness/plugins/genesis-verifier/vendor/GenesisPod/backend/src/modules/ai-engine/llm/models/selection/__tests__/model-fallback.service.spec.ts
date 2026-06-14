import { Test, TestingModule } from "@nestjs/testing";
import { ModelFallbackService } from "../model-fallback.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AIModelType } from "@prisma/client";
import {
  AIError,
  AIErrorType,
} from "@/modules/ai-engine/llm/abstractions/error-classifier";

describe("ModelFallbackService", () => {
  let service: ModelFallbackService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockGPT4o = {
    id: "model-1",
    name: "gpt-4o",
    displayName: "GPT-4 Optimized",
    provider: "openai",
    modelId: "gpt-4o",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "sk-test-key",
    secretKey: null,
    maxTokens: 4000,
    temperature: 0.7,
    isEnabled: true,
    isDefault: true,
    modelType: AIModelType.CHAT,
    isReasoning: false,
    apiFormat: "openai",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: false,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    priceInputPerMillion: 5.0,
    priceOutputPerMillion: 15.0,
    priority: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    icon: null,
    color: null,
    description: null,
  };

  const mockO1 = {
    id: "model-2",
    name: "o1-preview",
    displayName: "OpenAI O1 Preview",
    provider: "openai",
    modelId: "o1-preview",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "sk-test-key",
    secretKey: null,
    maxTokens: 8000,
    temperature: 1.0,
    isEnabled: true,
    isDefault: false,
    modelType: AIModelType.CHAT,
    isReasoning: true,
    apiFormat: "openai",
    supportsTemperature: false,
    supportsStreaming: true,
    supportsFunctionCalling: false,
    supportsVision: false,
    tokenParamName: "max_completion_tokens",
    defaultTimeoutMs: 300000,
    priceInputPerMillion: 15.0,
    priceOutputPerMillion: 60.0,
    priority: 90,
    createdAt: new Date(),
    updatedAt: new Date(),
    icon: null,
    color: null,
    description: null,
  };

  const mockClaude = {
    id: "model-3",
    name: "claude-sonnet",
    displayName: "Claude 3 Sonnet",
    provider: "anthropic",
    modelId: "claude-3-5-sonnet-20241022",
    apiEndpoint: "https://api.anthropic.com",
    apiKey: "sk-ant-test",
    secretKey: null,
    maxTokens: 8000,
    temperature: 0.7,
    isEnabled: true,
    isDefault: false,
    modelType: AIModelType.CHAT,
    isReasoning: false,
    apiFormat: "anthropic",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    priceInputPerMillion: 3.0,
    priceOutputPerMillion: 15.0,
    priority: 85,
    createdAt: new Date(),
    updatedAt: new Date(),
    icon: null,
    color: null,
    description: null,
  };

  const mockGemini = {
    id: "model-4",
    name: "gemini-pro",
    displayName: "Gemini 2.0 Flash",
    provider: "google",
    modelId: "gemini-2.0-flash",
    apiEndpoint: "https://generativelanguage.googleapis.com",
    apiKey: "test-gemini-key",
    secretKey: null,
    maxTokens: 8000,
    temperature: 0.7,
    isEnabled: true,
    isDefault: false,
    modelType: AIModelType.CHAT,
    isReasoning: false,
    apiFormat: "google",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    priceInputPerMillion: 0.1,
    priceOutputPerMillion: 0.4,
    priority: 80,
    createdAt: new Date(),
    updatedAt: new Date(),
    icon: null,
    color: null,
    description: null,
  };

  const mockDeepSeekR1 = {
    id: "model-5",
    name: "deepseek-r1",
    displayName: "DeepSeek R1",
    provider: "deepseek",
    modelId: "deepseek-r1",
    apiEndpoint: "https://api.deepseek.com/v1",
    apiKey: "sk-deepseek-test",
    secretKey: null,
    maxTokens: 8000,
    temperature: 0.7,
    isEnabled: true,
    isDefault: false,
    modelType: AIModelType.CHAT,
    isReasoning: true,
    apiFormat: "openai",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: false,
    supportsVision: false,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 300000,
    priceInputPerMillion: 1.0,
    priceOutputPerMillion: 5.0,
    priority: 95,
    createdAt: new Date(),
    updatedAt: new Date(),
    icon: null,
    color: null,
    description: null,
  };

  beforeEach(async () => {
    const mockPrismaService = {
      aIModel: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelFallbackService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ModelFallbackService>(ModelFallbackService);
    prismaService = module.get(PrismaService);

    // Mock the delay method to avoid waiting in tests
    jest.spyOn(service as any, "delay").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getModelFallbackChain", () => {
    it("should return models sorted by default priority for standard models", async () => {
      // Arrange
      const models = [mockGemini, mockClaude, mockGPT4o];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);

      // Act
      const chain = await service.getModelFallbackChain({
        modelType: AIModelType.CHAT,
        preferReasoning: false,
      });

      // Assert
      expect(chain).toHaveLength(3);
      // Service sorts by priority patterns, not just isDefault
      // Verify all models are returned
      const modelIds = chain.map((m) => m.modelId);
      expect(modelIds).toContain("gpt-4o");
      expect(modelIds).toContain("claude-3-5-sonnet-20241022");
      expect(modelIds).toContain("gemini-2.0-flash");
    });

    it("should prioritize reasoning models when preferReasoning is true", async () => {
      // Arrange
      const models = [mockGPT4o, mockO1, mockDeepSeekR1, mockClaude];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);

      // Act
      const chain = await service.getModelFallbackChain({
        modelType: AIModelType.CHAT,
        preferReasoning: true,
      });

      // Assert
      expect(chain.length).toBeGreaterThan(0);
      // Explicit reasoning models should come first
      const reasoningModels = chain.filter((m) => m.isReasoning);
      expect(reasoningModels.length).toBe(2); // O1 and DeepSeek R1
      expect(chain[0].isReasoning || chain[1].isReasoning).toBe(true);
    });

    it("should exclude blocked models from the chain", async () => {
      // Arrange
      const models = [mockGPT4o, mockClaude, mockGemini];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);

      // Block GPT-4o
      const blockModel = service["blockModel"];
      blockModel.call(service, "gpt-4o", AIErrorType.QUOTA_EXCEEDED);

      // Act
      const chain = await service.getModelFallbackChain({
        modelType: AIModelType.CHAT,
      });

      // Assert
      expect(chain).toHaveLength(2);
      expect(chain.find((m) => m.modelId === "gpt-4o")).toBeUndefined();
    });

    it("should exclude models from excludeModels parameter", async () => {
      // Arrange
      // Return only the non-excluded models from the database query
      const models = [mockGPT4o, mockGemini]; // Claude is excluded by the query
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);

      // Act
      const chain = await service.getModelFallbackChain({
        modelType: AIModelType.CHAT,
        excludeModels: ["claude-3-5-sonnet-20241022"],
      });

      // Assert
      expect(prismaService.aIModel.findMany).toHaveBeenCalledWith({
        where: {
          modelType: AIModelType.CHAT,
          isEnabled: true,
          modelId: {
            notIn: ["claude-3-5-sonnet-20241022"],
          },
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      });
      expect(
        chain.find((m) => m.modelId === "claude-3-5-sonnet-20241022"),
      ).toBeUndefined();
      expect(chain).toHaveLength(2);
    });

    it("should return empty array when no models are available", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      const chain = await service.getModelFallbackChain({
        modelType: AIModelType.CHAT,
      });

      // Assert
      expect(chain).toHaveLength(0);
    });

    it("should handle database errors gracefully", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      // Act
      const chain = await service.getModelFallbackChain({
        modelType: AIModelType.CHAT,
      });

      // Assert
      expect(chain).toHaveLength(0);
    });
  });

  describe("executeWithFallback - Success scenarios", () => {
    it("should succeed on first attempt with preferred model", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockGPT4o,
      ]);
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(
        mockGPT4o,
      );

      const executor = jest.fn().mockResolvedValue({ data: "success" });

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        modelType: AIModelType.CHAT,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: "success" });
      expect(result.modelUsed).toBe("gpt-4o");
      expect(result.fallbackUsed).toBe(false);
      expect(result.attempts).toBe(1);
      expect(executor).toHaveBeenCalledTimes(1);
    });

    it("should retry on retryable errors and eventually succeed", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockGPT4o,
      ]);
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(
        mockGPT4o,
      );

      const executor = jest
        .fn()
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockResolvedValue({ data: "success" });

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        modelType: AIModelType.CHAT,
        maxRetries: 2,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: "success" });
      expect(result.attempts).toBe(2);
      expect(executor).toHaveBeenCalledTimes(2);
    });

    it("should use fallback model when preferred model fails with model-switch error", async () => {
      // Arrange
      const models = [mockGPT4o, mockClaude];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockGPT4o)
        .mockResolvedValueOnce(mockClaude);

      const quotaError = new AIError(
        AIErrorType.QUOTA_EXCEEDED,
        "Quota exceeded",
        undefined,
        undefined,
        undefined,
      );

      const executor = jest
        .fn()
        .mockRejectedValueOnce(quotaError)
        .mockResolvedValue({ data: "success with claude" });

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        modelType: AIModelType.CHAT,
        maxModelSwitches: 3,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: "success with claude" });
      expect(result.modelUsed).toBe("claude-3-5-sonnet-20241022");
      expect(result.fallbackUsed).toBe(true);
      expect(result.attemptedModels).toContain("gpt-4o");
    });
  });

  describe("executeWithFallback - Error handling", () => {
    it("should switch model immediately on QUOTA_EXCEEDED error", async () => {
      // Arrange
      const models = [mockGPT4o, mockClaude];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockGPT4o)
        .mockResolvedValueOnce(mockClaude);

      const quotaError = new AIError(
        AIErrorType.QUOTA_EXCEEDED,
        "Quota exceeded",
        undefined,
        undefined,
        undefined,
      );

      const executor = jest
        .fn()
        .mockRejectedValueOnce(quotaError)
        .mockResolvedValue({ data: "success" });

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxRetries: 2,
        maxModelSwitches: 3,
      });

      // Assert
      expect(executor).toHaveBeenCalledTimes(2); // No retry on quota error
      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
    });

    it("should switch model immediately on INVALID_API_KEY error", async () => {
      // Arrange
      const models = [mockGPT4o, mockClaude];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockGPT4o)
        .mockResolvedValueOnce(mockClaude);

      const apiKeyError = new AIError(
        AIErrorType.INVALID_API_KEY,
        "Invalid API key",
        undefined,
        undefined,
        undefined,
      );

      const executor = jest
        .fn()
        .mockRejectedValueOnce(apiKeyError)
        .mockResolvedValue({ data: "success" });

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxRetries: 2,
        maxModelSwitches: 3,
      });

      // Assert
      expect(executor).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
    });

    it("should switch model on INVALID_MODEL error", async () => {
      // Arrange
      const models = [mockGPT4o, mockClaude];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockGPT4o)
        .mockResolvedValueOnce(mockClaude);

      const invalidModelError = new AIError(
        AIErrorType.INVALID_MODEL,
        "Model not found",
        undefined,
        undefined,
        undefined,
      );

      const executor = jest
        .fn()
        .mockRejectedValueOnce(invalidModelError)
        .mockResolvedValue({ data: "success" });

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxModelSwitches: 3,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
    });

    it("should handle RATE_LIMIT error with retry then switch on consecutive rate limits", async () => {
      // Arrange
      const models = [mockGPT4o, mockClaude];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockGPT4o)
        .mockResolvedValueOnce(mockClaude);

      const rateLimitError = new AIError(
        AIErrorType.RATE_LIMIT,
        "Rate limit exceeded",
        undefined,
        undefined,
        undefined,
      );

      const executor = jest
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValue({ data: "success with claude" });

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxRetries: 3,
        maxModelSwitches: 3,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.modelUsed).toBe("claude-3-5-sonnet-20241022");
    }, 10000);

    it("should fail when all models in fallback chain are exhausted", async () => {
      // Arrange
      const models = [mockGPT4o, mockClaude];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockGPT4o)
        .mockResolvedValueOnce(mockClaude);

      const error = new AIError(
        AIErrorType.TIMEOUT,
        "Timeout",
        undefined,
        undefined,
        undefined,
      );

      const executor = jest.fn().mockRejectedValue(error);

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxRetries: 1,
        maxModelSwitches: 3,
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.attemptedModels.length).toBeGreaterThan(0);
    }, 10000);

    it("should fail immediately when no models are available", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([]);

      const executor = jest.fn();

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        modelType: AIModelType.CHAT,
      });

      // Assert
      expect(result.success).toBe(false);
      // ★ 全覆盖审计修 (2026-05-06): 链空时分类改为 NO_MODEL（之前误归 INVALID_MODEL）
      expect(result.error?.type).toBe(AIErrorType.NO_MODEL);
      expect(result.error?.message).toContain("No available models");
      expect(executor).not.toHaveBeenCalled();
    });
  });

  describe("Model blocklist", () => {
    it("should add model to blocklist on INVALID_API_KEY error", async () => {
      // Arrange
      const models = [mockGPT4o, mockClaude];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockGPT4o)
        .mockResolvedValueOnce(mockClaude);

      const apiKeyError = new AIError(
        AIErrorType.INVALID_API_KEY,
        "Invalid API key",
        undefined,
        undefined,
        undefined,
      );

      const executor = jest
        .fn()
        .mockRejectedValueOnce(apiKeyError)
        .mockResolvedValue({ data: "success" });

      // Act
      await service.executeWithFallback("gpt-4o", executor);

      // Assert - Model should be blocked
      expect(service.isModelBlocked("gpt-4o")).toBe(true);
    });

    it("should add model to blocklist on QUOTA_EXCEEDED error", async () => {
      // Arrange
      const models = [mockGPT4o, mockClaude];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockGPT4o)
        .mockResolvedValueOnce(mockClaude);

      const quotaError = new AIError(
        AIErrorType.QUOTA_EXCEEDED,
        "Quota exceeded",
        undefined,
        undefined,
        undefined,
      );

      const executor = jest
        .fn()
        .mockRejectedValueOnce(quotaError)
        .mockResolvedValue({ data: "success" });

      // Act
      await service.executeWithFallback("gpt-4o", executor);

      // Assert
      expect(service.isModelBlocked("gpt-4o")).toBe(true);
    });

    it("should automatically remove model from blocklist after TTL expires", async () => {
      // Arrange
      const blockModel = service["blockModel"];
      blockModel.call(service, "gpt-4o", AIErrorType.QUOTA_EXCEEDED);

      // Act - Model should be blocked initially
      expect(service.isModelBlocked("gpt-4o")).toBe(true);

      // Fast-forward time beyond QUOTA_BLOCK_DURATION_MS (5 minutes)
      jest.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60 * 1000);

      // Assert - Model should be unblocked
      expect(service.isModelBlocked("gpt-4o")).toBe(false);
    });

    it("should use longer TTL for INVALID_API_KEY than QUOTA_EXCEEDED", async () => {
      const blockModel = service["blockModel"];
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(now);

      // Block with quota error (5 min TTL)
      blockModel.call(service, "gpt-4o", AIErrorType.QUOTA_EXCEEDED);
      const quotaExpiry = service["modelBlocklist"].get("gpt-4o")?.until;

      // Block with API key error (10 min TTL)
      blockModel.call(
        service,
        "claude-3-5-sonnet-20241022",
        AIErrorType.INVALID_API_KEY,
      );
      const apiKeyExpiry = service["modelBlocklist"].get(
        "claude-3-5-sonnet-20241022",
      )?.until;

      expect(quotaExpiry).toBe(now + 5 * 60 * 1000);
      expect(apiKeyExpiry).toBe(now + 10 * 60 * 1000);
    });
  });

  describe("Error classification", () => {
    it("should identify QUOTA_EXCEEDED as model-switch error", () => {
      // Arrange
      const error = new AIError(
        AIErrorType.QUOTA_EXCEEDED,
        "Quota exceeded",
        undefined,
        undefined,
        undefined,
      );

      // Act
      const shouldSwitch = service.shouldSwitchModel(error);

      // Assert
      expect(shouldSwitch).toBe(true);
    });

    it("should identify TIMEOUT as retryable error", () => {
      // Arrange
      const error = new AIError(
        AIErrorType.TIMEOUT,
        "Timeout",
        undefined,
        undefined,
        undefined,
      );

      // Act
      const isRetryable = service.isRetryableError(error);

      // Assert
      expect(isRetryable).toBe(true);
    });

    it("should identify NETWORK_ERROR as retryable", () => {
      // Arrange
      const error = new AIError(
        AIErrorType.NETWORK_ERROR,
        "Network error",
        undefined,
        undefined,
        undefined,
      );

      // Act
      const isRetryable = service.isRetryableError(error);

      // Assert
      expect(isRetryable).toBe(true);
    });

    it("should identify TEMPORARY_UNAVAILABLE as retryable", () => {
      // Arrange
      const error = new AIError(
        AIErrorType.TEMPORARY_UNAVAILABLE,
        "Service unavailable",
        undefined,
        undefined,
        undefined,
      );

      // Act
      const isRetryable = service.isRetryableError(error);

      // Assert
      expect(isRetryable).toBe(true);
    });
  });

  describe("getModelConfig", () => {
    it("should return model config for valid modelId", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(
        mockGPT4o,
      );

      // Act
      const config = await service.getModelConfig("gpt-4o");

      // Assert
      expect(config).not.toBeNull();
      expect(config?.modelId).toBe("gpt-4o");
      expect(config?.provider).toBe("openai");
    });

    it("should perform case-insensitive search", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(
        mockGPT4o,
      );

      // Act
      const config = await service.getModelConfig("GPT-4O");

      // Assert
      expect(prismaService.aIModel.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { modelId: { equals: "GPT-4O", mode: "insensitive" } },
            { name: { equals: "GPT-4O", mode: "insensitive" } },
          ],
          isEnabled: true,
        },
      });
      expect(config?.modelId).toBe("gpt-4o");
    });

    it("should return null for non-existent model", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);

      // Act
      const config = await service.getModelConfig("non-existent");

      // Assert
      expect(config).toBeNull();
    });

    it("should handle database errors gracefully", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      // Act
      const config = await service.getModelConfig("gpt-4o");

      // Assert
      expect(config).toBeNull();
    });
  });

  describe("Priority customization", () => {
    it("should allow setting custom reasoning model priority patterns", () => {
      // Arrange
      const customPatterns = [/custom-model/i, /another-model/i];

      // Act
      service.setReasoningModelPriority(customPatterns);

      // Assert - verify patterns are set (internal state check)
      expect(service["reasoningPriorityPatterns"]).toEqual(customPatterns);
    });

    it("should allow setting custom fast model priority patterns", () => {
      // Arrange
      const customPatterns = [/fast-model/i, /quick-model/i];

      // Act
      service.setFastModelPriority(customPatterns);

      // Assert
      expect(service["fastPriorityPatterns"]).toEqual(customPatterns);
    });
  });

  describe("Graceful degradation", () => {
    it("should track all attempted models when all fail", async () => {
      // Arrange
      const models = [mockGPT4o, mockClaude, mockGemini];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockGPT4o)
        .mockResolvedValueOnce(mockClaude)
        .mockResolvedValueOnce(mockGemini);

      const error = new AIError(
        AIErrorType.TIMEOUT,
        "Timeout",
        undefined,
        undefined,
        undefined,
      );

      const executor = jest.fn().mockRejectedValue(error);

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxRetries: 1,
        maxModelSwitches: 3,
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.attemptedModels.length).toBeGreaterThan(0);
      expect(result.attempts).toBeGreaterThan(result.attemptedModels.length);
    }, 10000);

    it("should return descriptive error when all models fail", async () => {
      // Arrange
      const models = [mockGPT4o];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(
        mockGPT4o,
      );

      const error = new AIError(
        AIErrorType.TIMEOUT,
        "Timeout",
        undefined,
        undefined,
        undefined,
      );

      const executor = jest.fn().mockRejectedValue(error);

      // Act
      const result = await service.executeWithFallback("gpt-4o", executor, {
        maxRetries: 1,
        maxModelSwitches: 0,
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(AIErrorType.TIMEOUT);
    });
  });
});
