/**
 * ModelResolverService 单元测试
 *
 * 测试从 AIFacade 提取的模型管理职责：
 * - selectModel() 智能模型选择（推理/提供商/黑名单/token/熔断器）
 * - getReasoningModel() 推理模型获取
 * - getAvailableModelsExtended() 扩展模型列表
 * - getAvailableModels() 简化模型列表
 * - getDefaultTextModel() / getDefaultImageModel() 默认模型
 * - getModelById() / getFullModelConfig() 模型配置查询
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ModelResolverService } from "../model-resolver.service";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
import { ModelFallbackService } from "../../../ai-engine/llm/models/selection/model-fallback.service";
import { ORCHESTRATION_FEATURE } from "../facade.providers";

describe("ModelResolverService", () => {
  let service: ModelResolverService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAiChatService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockModelConfigService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFallbackService: any;
  let mockOrchestration: any;

  const MOCK_MODELS = [
    {
      id: "db-1",
      modelId: "gpt-4o",
      displayName: "GPT-4o",
      name: "GPT-4o",
      provider: "openai",
      isReasoning: false,
      isEnabled: true,
      isDefault: true,
      maxTokens: 4096,
      apiKey: "sk-xxx",
      apiEndpoint: "https://api.openai.com",
    },
    {
      id: "db-2",
      modelId: "claude-3-opus",
      displayName: "Claude 3 Opus",
      name: "Claude 3 Opus",
      provider: "anthropic",
      isReasoning: false,
      isEnabled: true,
      isDefault: false,
      maxTokens: 8000,
      apiKey: "sk-ant-xxx",
    },
    {
      id: "db-3",
      modelId: "o1-preview",
      displayName: "O1 Preview",
      name: "O1 Preview",
      provider: "openai",
      isReasoning: true,
      isEnabled: true,
      isDefault: false,
      maxTokens: 32000,
      apiKey: "sk-xxx",
    },
    {
      id: "db-4",
      modelId: "deepseek-r1",
      displayName: "DeepSeek R1",
      name: "DeepSeek R1",
      provider: "deepseek",
      isReasoning: true,
      isEnabled: true,
      isDefault: false,
      maxTokens: 16000,
      apiKey: "sk-ds-xxx",
    },
  ];

  beforeEach(async () => {
    mockAiChatService = {
      isReasoningModel: jest.fn().mockImplementation((id: string) => {
        return id.startsWith("o1") || id.includes("deepseek-r1");
      }),
      getDefaultModelByType: jest.fn().mockResolvedValue(MOCK_MODELS[0]),
    };

    mockModelConfigService = {
      getAllEnabledModelsByType: jest.fn().mockResolvedValue(MOCK_MODELS),
      getEnabledModelsForFrontend: jest.fn().mockResolvedValue(
        MOCK_MODELS.map((m) => ({
          id: m.id,
          modelId: m.modelId,
          name: m.displayName,
          provider: m.provider,
          icon: null,
          isDefault: m.isDefault,
        })),
      ),
      getModelById: jest.fn().mockImplementation((id: string) => {
        return Promise.resolve(
          MOCK_MODELS.find((m) => m.modelId === id || m.id === id) || null,
        );
      }),
      resolveApiKey: jest
        .fn()
        .mockImplementation((model: { apiKey?: string }) => {
          return Promise.resolve(
            model?.apiKey ? { apiKey: model.apiKey, source: "system" } : null,
          );
        }),
    };

    mockFallbackService = {
      isModelBlocked: jest.fn().mockReturnValue(false),
    };

    mockOrchestration = {
      circuitBreaker: {
        canExecute: jest.fn().mockReturnValue(true),
        selectBest: jest.fn().mockReturnValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelResolverService,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        { provide: ModelFallbackService, useValue: mockFallbackService },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: mockOrchestration,
        },
      ],
    }).compile();

    service = module.get<ModelResolverService>(ModelResolverService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // selectModel
  // =========================================================================

  describe("selectModel", () => {
    it("should return first available model with no options", async () => {
      const result = await service.selectModel();

      expect(result).not.toBeNull();
      expect(result!.id).toBe("gpt-4o");
    });

    it("should return null when no models available", async () => {
      mockModelConfigService.getAllEnabledModelsByType!.mockResolvedValue([]);

      const result = await service.selectModel();
      expect(result).toBeNull();
    });

    it("should filter by requireReasoning", async () => {
      const result = await service.selectModel({ requireReasoning: true });

      expect(result).not.toBeNull();
      expect(result!.isReasoning).toBe(true);
      expect(["o1-preview", "deepseek-r1"]).toContain(result!.id);
    });

    it("should fall back to all models if no reasoning models exist", async () => {
      mockModelConfigService.getAllEnabledModelsByType!.mockResolvedValue(
        MOCK_MODELS.filter((m) => !m.isReasoning),
      );
      mockAiChatService.isReasoningModel!.mockReturnValue(false);

      const result = await service.selectModel({ requireReasoning: true });

      expect(result).not.toBeNull();
      // Falls back to first non-reasoning model
      expect(result!.id).toBe("gpt-4o");
    });

    it("should filter by preferredProvider", async () => {
      const result = await service.selectModel({
        preferredProvider: "anthropic",
      });

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("anthropic");
      expect(result!.id).toBe("claude-3-opus");
    });

    it("should be case-insensitive for preferredProvider", async () => {
      const result = await service.selectModel({
        preferredProvider: "ANTHROPIC",
      });

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("anthropic");
    });

    it("should fall back to all models if preferred provider not found", async () => {
      const result = await service.selectModel({
        preferredProvider: "nonexistent",
      });

      expect(result).not.toBeNull();
      // Falls back to first model
      expect(result!.id).toBe("gpt-4o");
    });

    it("should filter out blocked models via fallback service", async () => {
      mockFallbackService.isModelBlocked!.mockImplementation(
        (id: string) => id === "gpt-4o",
      );

      const result = await service.selectModel();

      expect(result).not.toBeNull();
      expect(result!.id).not.toBe("gpt-4o");
    });

    it("should fall back to blocked models if all are blocked", async () => {
      mockFallbackService.isModelBlocked!.mockReturnValue(true);

      const result = await service.selectModel();

      // Should still return a model (falls back to original candidates)
      expect(result).not.toBeNull();
    });

    it("should filter by minMaxTokens", async () => {
      const result = await service.selectModel({ minMaxTokens: 10000 });

      expect(result).not.toBeNull();
      expect(result!.maxTokens).toBeGreaterThanOrEqual(10000);
    });

    it("should fall back when no models meet minMaxTokens", async () => {
      const result = await service.selectModel({ minMaxTokens: 999999 });

      expect(result).not.toBeNull();
      // Falls back to original candidates
    });

    it("should use circuit breaker selection when available", async () => {
      mockOrchestration.circuitBreaker.selectBest.mockReturnValue(
        "chat:claude-3-opus",
      );

      const result = await service.selectModel();

      expect(mockOrchestration.circuitBreaker.selectBest).toHaveBeenCalled();
      expect(result!.id).toBe("claude-3-opus");
    });

    it("should fall back to first candidate when circuit breaker returns unknown id", async () => {
      mockOrchestration.circuitBreaker.selectBest.mockReturnValue(
        "chat:nonexistent",
      );

      const result = await service.selectModel();

      expect(result!.id).toBe("gpt-4o");
    });

    it("should combine multiple filters", async () => {
      const result = await service.selectModel({
        requireReasoning: true,
        preferredProvider: "openai",
        minMaxTokens: 10000,
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe("o1-preview");
      expect(result!.isReasoning).toBe(true);
      expect(result!.provider).toBe("openai");
    });

    it("should pass correct modelType to getAvailableModelsExtended", async () => {
      await service.selectModel({ modelType: AIModelType.IMAGE_GENERATION });

      expect(
        mockModelConfigService.getAllEnabledModelsByType,
      ).toHaveBeenCalledWith(AIModelType.IMAGE_GENERATION);
    });

    it("should default to CHAT model type", async () => {
      await service.selectModel();

      expect(
        mockModelConfigService.getAllEnabledModelsByType,
      ).toHaveBeenCalledWith(AIModelType.CHAT);
    });
  });

  // =========================================================================
  // getReasoningModel
  // =========================================================================

  describe("getReasoningModel", () => {
    it("should delegate to selectModel with requireReasoning", async () => {
      const spy = jest.spyOn(service, "selectModel");

      await service.getReasoningModel();

      expect(spy).toHaveBeenCalledWith({ requireReasoning: true });
    });

    it("should return a reasoning model", async () => {
      const result = await service.getReasoningModel();

      expect(result).not.toBeNull();
      expect(result!.isReasoning).toBe(true);
    });
  });

  // =========================================================================
  // getAvailableModelsExtended
  // =========================================================================

  describe("getAvailableModelsExtended", () => {
    it("should return extended model info for all enabled models", async () => {
      const result = await service.getAvailableModelsExtended();

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: "gpt-4o",
          dbId: "db-1",
          name: "GPT-4o",
          provider: "openai",
          isReasoning: false,
          isAvailable: true,
          maxTokens: 4096,
          isDefault: true,
        }),
      );
    });

    it("should mark blocked models as unavailable", async () => {
      mockFallbackService.isModelBlocked!.mockImplementation(
        (id: string) => id === "gpt-4o",
      );

      const result = await service.getAvailableModelsExtended();

      const gpt4o = result.find((m) => m.id === "gpt-4o");
      expect(gpt4o!.isAvailable).toBe(false);
    });

    it("should mark circuit-broken models as unavailable", async () => {
      mockOrchestration.circuitBreaker.canExecute.mockImplementation(
        (entityId: string) => entityId !== "chat:gpt-4o",
      );

      const result = await service.getAvailableModelsExtended();

      const gpt4o = result.find((m) => m.id === "gpt-4o");
      expect(gpt4o!.isAvailable).toBe(false);

      const claude = result.find((m) => m.id === "claude-3-opus");
      expect(claude!.isAvailable).toBe(true);
    });

    it("should detect reasoning models via isReasoning flag", async () => {
      const result = await service.getAvailableModelsExtended();

      const o1 = result.find((m) => m.id === "o1-preview");
      expect(o1!.isReasoning).toBe(true);

      const gpt4o = result.find((m) => m.id === "gpt-4o");
      expect(gpt4o!.isReasoning).toBe(false);
    });

    it("should fall back to aiChatService.isReasoningModel when flag is null", async () => {
      const modelsWithoutFlag = MOCK_MODELS.map((m) => ({
        ...m,
        isReasoning: null,
      }));
      mockModelConfigService.getAllEnabledModelsByType!.mockResolvedValue(
        modelsWithoutFlag as any,
      );

      const result = await service.getAvailableModelsExtended();

      const o1 = result.find((m) => m.id === "o1-preview");
      expect(o1!.isReasoning).toBe(true);
      expect(mockAiChatService.isReasoningModel).toHaveBeenCalledWith(
        "o1-preview",
      );
    });

    it("should pass modelType parameter", async () => {
      await service.getAvailableModelsExtended(AIModelType.IMAGE_GENERATION);

      expect(
        mockModelConfigService.getAllEnabledModelsByType,
      ).toHaveBeenCalledWith(AIModelType.IMAGE_GENERATION);
    });
  });

  // =========================================================================
  // getAvailableModels (simplified)
  // =========================================================================

  describe("getAvailableModels", () => {
    it("should return simplified model list", async () => {
      const result = await service.getAvailableModels();

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
        }),
      );
    });

    it("should call getEnabledModelsForFrontend", async () => {
      await service.getAvailableModels(AIModelType.CHAT);

      expect(
        mockModelConfigService.getEnabledModelsForFrontend,
      ).toHaveBeenCalledWith(AIModelType.CHAT);
    });
  });

  // =========================================================================
  // getDefaultTextModel / getDefaultImageModel
  // =========================================================================

  describe("getDefaultTextModel", () => {
    it("should delegate to getDefaultModelByType with CHAT", async () => {
      const result = await service.getDefaultTextModel();

      expect(mockAiChatService.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
      expect(result).not.toBeNull();
      expect(result!.modelId).toBe("gpt-4o");
    });

    it("should return null when no default model", async () => {
      mockAiChatService.getDefaultModelByType!.mockResolvedValue(null);

      const result = await service.getDefaultTextModel();
      expect(result).toBeNull();
    });
  });

  describe("getDefaultImageModel", () => {
    it("should delegate to getDefaultModelByType with IMAGE_GENERATION", async () => {
      await service.getDefaultImageModel();

      expect(mockAiChatService.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.IMAGE_GENERATION,
      );
    });
  });

  // =========================================================================
  // getModelById
  // =========================================================================

  describe("getModelById", () => {
    it("should return model config by modelId", async () => {
      const result = await service.getModelById("gpt-4o");

      expect(result).not.toBeNull();
      expect(result!.modelId).toBe("gpt-4o");
      expect(result!.provider).toBe("openai");
      expect(result!.displayName).toBe("GPT-4o");
    });

    it("should return null for unknown model", async () => {
      mockModelConfigService.getModelById!.mockResolvedValue(null);

      const result = await service.getModelById("unknown-model");
      expect(result).toBeNull();
    });

    it("should include API key in response", async () => {
      const result = await service.getModelById("gpt-4o");

      expect(result!.apiKey).toBe("sk-xxx");
    });
  });

  // =========================================================================
  // getFullModelConfig
  // =========================================================================

  describe("getFullModelConfig", () => {
    it("should return full model configuration", async () => {
      const result = await service.getFullModelConfig("gpt-4o");

      expect(result).not.toBeNull();
      expect(result!.modelId).toBe("gpt-4o");
      expect(result!.apiKey).toBe("sk-xxx");
      expect(result!.isEnabled).toBe(true);
    });

    it("should return null for unknown model", async () => {
      mockModelConfigService.getModelById!.mockResolvedValue(null);

      const result = await service.getFullModelConfig("unknown");
      expect(result).toBeNull();
    });

    it("should apply defaults for missing fields", async () => {
      mockModelConfigService.getModelById!.mockResolvedValue({
        id: "db-1",
        modelId: "minimal-model",
        provider: "test",
      } as any);

      const result = await service.getFullModelConfig("minimal-model");

      expect(result!.displayName).toBe("minimal-model");
      expect(result!.name).toBe("minimal-model");
      expect(result!.apiKey).toBe("");
      expect(result!.isEnabled).toBe(true);
      expect(result!.isDefault).toBe(false);
      expect(result!.isReasoning).toBe(false);
      expect(result!.supportsTemperature).toBe(true);
    });
  });

  // =========================================================================
  // Without optional dependencies
  // =========================================================================

  describe("without optional dependencies", () => {
    let minimalService: ModelResolverService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ModelResolverService,
          { provide: AiChatService, useValue: mockAiChatService },
          { provide: AiModelConfigService, useValue: mockModelConfigService },
          // No ModelFallbackService, no ORCHESTRATION_FEATURE
        ],
      }).compile();

      minimalService = module.get<ModelResolverService>(ModelResolverService);
    });

    it("should work without fallback service (no blacklist filtering)", async () => {
      const result = await minimalService.selectModel();

      expect(result).not.toBeNull();
      expect(result!.id).toBe("gpt-4o");
    });

    it("should work without circuit breaker", async () => {
      const result = await minimalService.selectModel();

      expect(result).not.toBeNull();
    });

    it("should mark all models as available without circuit breaker", async () => {
      const models = await minimalService.getAvailableModelsExtended();

      expect(models.every((m) => m.isAvailable)).toBe(true);
    });
  });
});
