/**
 * ModelSubFacade Unit Tests
 */

import { ModelSubFacade } from "../model.sub-facade";
import { AIModelType } from "@prisma/client";

// ============================================================================
// Helpers / Factories
// ============================================================================

function buildModel(
  overrides: Partial<{
    id: string;
    dbId: string;
    name: string;
    provider: string;
    isReasoning: boolean;
    isAvailable: boolean;
    maxTokens: number;
    isDefault: boolean;
  }> = {},
) {
  return {
    id: overrides.id ?? "gpt-4o",
    dbId: overrides.dbId ?? "db-1",
    name: overrides.name ?? "GPT-4o",
    provider: overrides.provider ?? "openai",
    isReasoning: overrides.isReasoning ?? false,
    isAvailable: overrides.isAvailable ?? true,
    maxTokens: overrides.maxTokens ?? 128000,
    icon: undefined,
    isDefault: overrides.isDefault ?? false,
  };
}

// ============================================================================
// Mocks
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockAiChatService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockModelConfigService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockModelFallbackService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockOrchestration: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockModelResolver: any;

function createFacade(
  options: {
    withFallback?: boolean;
    withOrchestration?: boolean;
    withResolver?: boolean;
  } = {},
): ModelSubFacade {
  return new ModelSubFacade(
    mockAiChatService,
    mockModelConfigService,
    options.withFallback ? mockModelFallbackService : undefined,
    options.withOrchestration ? mockOrchestration : undefined,
    options.withResolver ? mockModelResolver : undefined,
  );
}

// ============================================================================
// Test suite
// ============================================================================

describe("ModelSubFacade", () => {
  beforeEach(() => {
    mockAiChatService = {
      isReasoningModel: jest.fn().mockReturnValue(false),
      getDefaultModelByType: jest.fn().mockResolvedValue(null),
    };

    mockModelConfigService = {
      getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
      getEnabledModelsForFrontend: jest.fn().mockResolvedValue([]),
      getModelById: jest.fn().mockResolvedValue(null),
      resolveApiKey: jest
        .fn()
        .mockImplementation((model: { apiKey?: string }) =>
          Promise.resolve(
            model?.apiKey ? { apiKey: model.apiKey, source: "system" } : null,
          ),
        ),
    };

    mockModelFallbackService = {
      isModelBlocked: jest.fn().mockReturnValue(false),
    };

    mockOrchestration = {
      circuitBreaker: {
        selectBest: jest.fn().mockReturnValue(null),
        canExecute: jest.fn().mockReturnValue(true),
      },
    };

    mockModelResolver = {
      selectModel: jest.fn().mockResolvedValue(null),
      getAvailableModelsExtended: jest.fn().mockResolvedValue([]),
      getAvailableModels: jest.fn().mockResolvedValue([]),
      getDefaultTextModel: jest.fn().mockResolvedValue(null),
      getDefaultImageModel: jest.fn().mockResolvedValue(null),
      getModelById: jest.fn().mockResolvedValue(null),
      getFullModelConfig: jest.fn().mockResolvedValue(null),
      getDefaultModelByType: jest.fn().mockResolvedValue(null),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // selectModel — delegates to modelResolver when available
  // --------------------------------------------------------------------------

  describe("selectModel — with modelResolver", () => {
    it("should delegate to modelResolver.selectModel when available", async () => {
      const resolverModel = buildModel({ id: "resolver-model" });
      mockModelResolver.selectModel.mockResolvedValue(resolverModel);

      const facade = createFacade({ withResolver: true });
      const result = await facade.selectModel({ requireReasoning: true });

      expect(mockModelResolver.selectModel).toHaveBeenCalledWith({
        requireReasoning: true,
      });
      expect(result?.id).toBe("resolver-model");
    });
  });

  // --------------------------------------------------------------------------
  // selectModel — direct implementation (no modelResolver)
  // --------------------------------------------------------------------------

  describe("selectModel — direct implementation", () => {
    it("should return null when no models available", async () => {
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue([]);

      const facade = createFacade();
      const result = await facade.selectModel();

      expect(result).toBeNull();
    });

    it("should return first model when no filters applied", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );

      const facade = createFacade();
      const result = await facade.selectModel();

      expect(result?.id).toBe("gpt-4o");
    });

    it("should filter reasoning models when requireReasoning=true", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
        {
          modelId: "o3",
          id: "db-2",
          displayName: "O3",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: true,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );

      const facade = createFacade();
      const result = await facade.selectModel({ requireReasoning: true });

      expect(result?.id).toBe("o3");
    });

    it("should fall back to all models if no reasoning models found", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );

      const facade = createFacade();
      const result = await facade.selectModel({ requireReasoning: true });

      // Falls back to all models
      expect(result?.id).toBe("gpt-4o");
    });

    it("should filter by preferredProvider", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
        {
          modelId: "claude-3",
          id: "db-2",
          displayName: "Claude 3",
          provider: "anthropic",
          maxTokens: 200000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );

      const facade = createFacade();
      const result = await facade.selectModel({
        preferredProvider: "anthropic",
      });

      expect(result?.id).toBe("claude-3");
    });

    it("should keep all models when preferredProvider not found", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );

      const facade = createFacade();
      const result = await facade.selectModel({
        preferredProvider: "nonexistent",
      });

      expect(result?.id).toBe("gpt-4o");
    });

    it("should filter blocked models when fallbackService available", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
        {
          modelId: "gpt-3.5",
          id: "db-2",
          displayName: "GPT-3.5",
          provider: "openai",
          maxTokens: 16000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );
      mockModelFallbackService.isModelBlocked.mockImplementation(
        (id: string) => id === "gpt-4o",
      );

      const facade = createFacade({ withFallback: true });
      const result = await facade.selectModel();

      expect(result?.id).toBe("gpt-3.5");
    });

    it("should keep original list when all models are blocked", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );
      mockModelFallbackService.isModelBlocked.mockReturnValue(true);

      const facade = createFacade({ withFallback: true });
      const result = await facade.selectModel();

      // All blocked → keep original list as fallback
      expect(result?.id).toBe("gpt-4o");
    });

    it("should filter by minMaxTokens", async () => {
      const dbModels = [
        {
          modelId: "small-model",
          id: "db-1",
          displayName: "Small",
          provider: "openai",
          maxTokens: 4000,
          isDefault: false,
          isReasoning: false,
        },
        {
          modelId: "large-model",
          id: "db-2",
          displayName: "Large",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );

      const facade = createFacade();
      const result = await facade.selectModel({ minMaxTokens: 100000 });

      expect(result?.id).toBe("large-model");
    });

    it("should use circuit breaker selection when available", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
        {
          modelId: "claude-3",
          id: "db-2",
          displayName: "Claude 3",
          provider: "anthropic",
          maxTokens: 200000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );
      mockOrchestration.circuitBreaker.selectBest.mockReturnValue(
        "chat:claude-3",
      );
      mockOrchestration.circuitBreaker.canExecute.mockReturnValue(true);

      const facade = createFacade({ withOrchestration: true });
      const result = await facade.selectModel();

      expect(result?.id).toBe("claude-3");
    });

    it("should fall back to first model when circuit breaker returns unknown id", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );
      mockOrchestration.circuitBreaker.selectBest.mockReturnValue(
        "chat:nonexistent-model",
      );
      mockOrchestration.circuitBreaker.canExecute.mockReturnValue(true);

      const facade = createFacade({ withOrchestration: true });
      const result = await facade.selectModel();

      expect(result?.id).toBe("gpt-4o");
    });

    it("should use default modelType CHAT when not specified", async () => {
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue([]);

      const facade = createFacade();
      await facade.selectModel({});

      expect(
        mockModelConfigService.getAllEnabledModelsByType,
      ).toHaveBeenCalledWith(AIModelType.CHAT);
    });

    it("should pass modelType to getAllEnabledModelsByType", async () => {
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue([]);

      const facade = createFacade();
      await facade.selectModel({ modelType: AIModelType.IMAGE_GENERATION });

      expect(
        mockModelConfigService.getAllEnabledModelsByType,
      ).toHaveBeenCalledWith(AIModelType.IMAGE_GENERATION);
    });
  });

  // --------------------------------------------------------------------------
  // getReasoningModel
  // --------------------------------------------------------------------------

  describe("getReasoningModel", () => {
    it("should delegate to selectModel with requireReasoning=true", async () => {
      const dbModels = [
        {
          modelId: "o3",
          id: "db-1",
          displayName: "O3",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: true,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );

      const facade = createFacade();
      const result = await facade.getReasoningModel();

      expect(result?.id).toBe("o3");
    });
  });

  // --------------------------------------------------------------------------
  // getAvailableModelsExtended
  // --------------------------------------------------------------------------

  describe("getAvailableModelsExtended", () => {
    it("should delegate to modelResolver when available", async () => {
      const resolverModels = [buildModel({ id: "resolver-model" })];
      mockModelResolver.getAvailableModelsExtended.mockResolvedValue(
        resolverModels,
      );

      const facade = createFacade({ withResolver: true });
      const result = await facade.getAvailableModelsExtended();

      expect(mockModelResolver.getAvailableModelsExtended).toHaveBeenCalled();
      expect(result).toBe(resolverModels);
    });

    it("should map db models to ModelInfo when no resolver", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: true,
          isReasoning: null, // null — should fall back to aiChatService.isReasoningModel
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );
      mockAiChatService.isReasoningModel.mockReturnValue(false);

      const facade = createFacade();
      const result = await facade.getAvailableModelsExtended(AIModelType.CHAT);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("gpt-4o");
      expect(result[0].name).toBe("GPT-4o");
      expect(result[0].provider).toBe("openai");
      expect(result[0].isDefault).toBe(true);
    });

    it("should use model isReasoning flag when available", async () => {
      const dbModels = [
        {
          modelId: "o3",
          id: "db-1",
          displayName: "O3",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: true,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );

      const facade = createFacade();
      const result = await facade.getAvailableModelsExtended();

      expect(result[0].isReasoning).toBe(true);
      // Should not call aiChatService.isReasoningModel since isReasoning is already set
      expect(mockAiChatService.isReasoningModel).not.toHaveBeenCalled();
    });

    it("should mark models as unavailable when blocked", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );
      mockModelFallbackService.isModelBlocked.mockReturnValue(true);

      const facade = createFacade({ withFallback: true });
      const result = await facade.getAvailableModelsExtended();

      expect(result[0].isAvailable).toBe(false);
    });

    it("should mark models as unavailable when circuit breaker denies execution", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );
      mockOrchestration.circuitBreaker.canExecute.mockReturnValue(false);

      const facade = createFacade({ withOrchestration: true });
      const result = await facade.getAvailableModelsExtended();

      expect(result[0].isAvailable).toBe(false);
    });

    it("should use modelId as name when displayName is null", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          displayName: null,
          provider: "openai",
          maxTokens: 128000,
          isDefault: false,
          isReasoning: false,
        },
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        dbModels,
      );

      const facade = createFacade();
      const result = await facade.getAvailableModelsExtended();

      expect(result[0].name).toBe("gpt-4o");
    });
  });

  // --------------------------------------------------------------------------
  // getAvailableModels
  // --------------------------------------------------------------------------

  describe("getAvailableModels", () => {
    it("should delegate to modelResolver when available", async () => {
      const resolverModels = [
        { id: "m1", name: "Model 1", provider: "openai", dbId: "db-1" },
      ];
      mockModelResolver.getAvailableModels.mockResolvedValue(resolverModels);

      const facade = createFacade({ withResolver: true });
      const result = await facade.getAvailableModels();

      expect(result).toBe(resolverModels);
    });

    it("should map frontend models to simplified format", async () => {
      const dbModels = [
        {
          modelId: "gpt-4o",
          id: "db-1",
          name: "GPT-4o",
          provider: "openai",
          icon: null,
          isDefault: true,
        },
      ];
      mockModelConfigService.getEnabledModelsForFrontend.mockResolvedValue(
        dbModels,
      );

      const facade = createFacade();
      const result = await facade.getAvailableModels(AIModelType.CHAT);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("gpt-4o");
      expect(result[0].name).toBe("GPT-4o");
      expect(result[0].provider).toBe("openai");
      expect(result[0].isDefault).toBe(true);
    });

    it("should use default CHAT type when not specified", async () => {
      mockModelConfigService.getEnabledModelsForFrontend.mockResolvedValue([]);

      const facade = createFacade();
      await facade.getAvailableModels();

      expect(
        mockModelConfigService.getEnabledModelsForFrontend,
      ).toHaveBeenCalledWith(AIModelType.CHAT);
    });
  });

  // --------------------------------------------------------------------------
  // getDefaultTextModel
  // --------------------------------------------------------------------------

  describe("getDefaultTextModel", () => {
    it("should delegate to modelResolver when available", async () => {
      const resolverModel = {
        id: "gpt-4o",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
      };
      mockModelResolver.getDefaultTextModel.mockResolvedValue(resolverModel);

      const facade = createFacade({ withResolver: true });
      const result = await facade.getDefaultTextModel();

      expect(result).toBe(resolverModel);
    });

    it("should return null when no default model found", async () => {
      mockAiChatService.getDefaultModelByType.mockResolvedValue(null);

      const facade = createFacade();
      const result = await facade.getDefaultTextModel();

      expect(result).toBeNull();
    });

    it("should return default text model config", async () => {
      const modelConfig = {
        id: "db-1",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        maxTokens: 128000,
      };
      mockAiChatService.getDefaultModelByType.mockResolvedValue(modelConfig);

      const facade = createFacade();
      const result = await facade.getDefaultTextModel();

      expect(result?.modelId).toBe("gpt-4o");
      expect(result?.provider).toBe("openai");
      expect(mockAiChatService.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
    });

    it("should use modelId as id when id is not present", async () => {
      const modelConfig = {
        modelId: "gpt-4o",
        displayName: null,
        provider: "openai",
      };
      mockAiChatService.getDefaultModelByType.mockResolvedValue(modelConfig);

      const facade = createFacade();
      const result = await facade.getDefaultTextModel();

      expect(result?.id).toBe("gpt-4o");
      expect(result?.displayName).toBe("gpt-4o");
    });
  });

  // --------------------------------------------------------------------------
  // getDefaultImageModel
  // --------------------------------------------------------------------------

  describe("getDefaultImageModel", () => {
    it("should delegate to modelResolver when available", async () => {
      const resolverModel = {
        id: "dall-e-3",
        modelId: "dall-e-3",
        displayName: "DALL-E 3",
        provider: "openai",
      };
      mockModelResolver.getDefaultImageModel.mockResolvedValue(resolverModel);

      const facade = createFacade({ withResolver: true });
      const result = await facade.getDefaultImageModel();

      expect(result).toBe(resolverModel);
    });

    it("should return null when no default image model found", async () => {
      mockAiChatService.getDefaultModelByType.mockResolvedValue(null);

      const facade = createFacade();
      const result = await facade.getDefaultImageModel();

      expect(result).toBeNull();
    });

    it("should return default image model config", async () => {
      const modelConfig = {
        id: "db-img-1",
        modelId: "dall-e-3",
        displayName: "DALL-E 3",
        provider: "openai",
        maxTokens: 0,
      };
      mockAiChatService.getDefaultModelByType.mockResolvedValue(modelConfig);

      const facade = createFacade();
      const result = await facade.getDefaultImageModel();

      expect(result?.modelId).toBe("dall-e-3");
      expect(mockAiChatService.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.IMAGE_GENERATION,
      );
    });
  });

  // --------------------------------------------------------------------------
  // getModelById
  // --------------------------------------------------------------------------

  describe("getModelById", () => {
    it("should delegate to modelResolver when available", async () => {
      const resolverModel = {
        id: "gpt-4o",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
      };
      mockModelResolver.getModelById.mockResolvedValue(resolverModel);

      const facade = createFacade({ withResolver: true });
      const result = await facade.getModelById("gpt-4o");

      expect(result).toBe(resolverModel);
    });

    it("should return null when model not found", async () => {
      mockModelConfigService.getModelById.mockResolvedValue(null);

      const facade = createFacade();
      const result = await facade.getModelById("nonexistent");

      expect(result).toBeNull();
    });

    it("should return mapped model when found", async () => {
      const config = {
        id: "db-1",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        maxTokens: 128000,
        apiEndpoint: "https://api.openai.com",
        isReasoning: true,
        apiKey: "sk-test",
        secretKey: null,
      };
      mockModelConfigService.getModelById.mockResolvedValue(config);

      const facade = createFacade();
      const result = await facade.getModelById("gpt-4o");

      expect(result?.id).toBe("db-1");
      expect(result?.modelId).toBe("gpt-4o");
      expect(result?.isReasoning).toBe(true);
      expect(result?.apiKey).toBe("sk-test");
    });

    it("should default isReasoning to false when null", async () => {
      const config = {
        id: "db-1",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        isReasoning: null,
      };
      mockModelConfigService.getModelById.mockResolvedValue(config);

      const facade = createFacade();
      const result = await facade.getModelById("gpt-4o");

      expect(result?.isReasoning).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getFullModelConfig
  // --------------------------------------------------------------------------

  describe("getFullModelConfig", () => {
    it("should delegate to modelResolver when available", async () => {
      const fullConfig = {
        id: "gpt-4o",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        name: "GPT-4o",
        provider: "openai",
        apiKey: "sk-test",
        isEnabled: true,
        isDefault: false,
      };
      mockModelResolver.getFullModelConfig.mockResolvedValue(fullConfig);

      const facade = createFacade({ withResolver: true });
      const result = await facade.getFullModelConfig("gpt-4o");

      expect(result).toBe(fullConfig);
    });

    it("should return null when model not found", async () => {
      mockModelConfigService.getModelById.mockResolvedValue(null);

      const facade = createFacade();
      const result = await facade.getFullModelConfig("nonexistent");

      expect(result).toBeNull();
    });

    it("should map full config with all fields", async () => {
      const config = {
        id: "db-1",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        name: "GPT-4o",
        provider: "openai",
        apiKey: "sk-test",
        secretKey: "secret",
        apiEndpoint: "https://api.openai.com",
        maxTokens: 128000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: true,
        isReasoning: false,
        apiFormat: "openai",
        supportsTemperature: true,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        supportsVision: true,
        tokenParamName: "max_tokens",
        defaultTimeoutMs: 30000,
        priceInputPerMillion: 5.0,
        priceOutputPerMillion: 15.0,
        priority: 1,
      };
      mockModelConfigService.getModelById.mockResolvedValue(config);

      const facade = createFacade();
      const result = await facade.getFullModelConfig("gpt-4o");

      expect(result?.modelId).toBe("gpt-4o");
      expect(result?.apiKey).toBe("sk-test");
      expect(result?.isEnabled).toBe(true);
      expect(result?.supportsFunctionCalling).toBe(true);
      expect(result?.priceInputPerMillion).toBe(5.0);
    });

    it("should use defaults for missing optional fields", async () => {
      const config = {
        id: "db-1",
        modelId: "gpt-4o",
        provider: "openai",
        displayName: null,
        name: null,
        apiKey: null,
        secretKey: null,
        apiEndpoint: null,
        maxTokens: null,
        temperature: null,
        isEnabled: null,
        isDefault: null,
        isReasoning: null,
        apiFormat: null,
        supportsTemperature: null,
        supportsStreaming: null,
        supportsFunctionCalling: null,
        supportsVision: null,
        tokenParamName: null,
        defaultTimeoutMs: null,
        priceInputPerMillion: null,
        priceOutputPerMillion: null,
        priority: null,
      };
      mockModelConfigService.getModelById.mockResolvedValue(config);

      const facade = createFacade();
      const result = await facade.getFullModelConfig("gpt-4o");

      expect(result?.displayName).toBe("gpt-4o");
      expect(result?.apiKey).toBe("");
      expect(result?.isEnabled).toBe(true);
      expect(result?.isDefault).toBe(false);
      expect(result?.isReasoning).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getDefaultModelByType
  // --------------------------------------------------------------------------

  describe("getDefaultModelByType", () => {
    it("should delegate to modelResolver when available", async () => {
      const resolverModel = {
        id: "gpt-4o",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
      };
      mockModelResolver.getDefaultModelByType.mockResolvedValue(resolverModel);

      const facade = createFacade({ withResolver: true });
      const result = await facade.getDefaultModelByType(AIModelType.CHAT);

      expect(result).toBe(resolverModel);
      expect(mockModelResolver.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
    });

    it("should return null when no default model found", async () => {
      mockAiChatService.getDefaultModelByType.mockResolvedValue(null);

      const facade = createFacade();
      const result = await facade.getDefaultModelByType(AIModelType.CHAT);

      expect(result).toBeNull();
    });

    it("should return mapped config for specified model type", async () => {
      const modelConfig = {
        id: "db-1",
        modelId: "stable-diffusion",
        displayName: "Stable Diffusion",
        provider: "stability",
        maxTokens: 0,
      };
      mockAiChatService.getDefaultModelByType.mockResolvedValue(modelConfig);

      const facade = createFacade();
      const result = await facade.getDefaultModelByType(
        AIModelType.IMAGE_GENERATION,
      );

      expect(result?.modelId).toBe("stable-diffusion");
      expect(mockAiChatService.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.IMAGE_GENERATION,
      );
    });
  });
});
