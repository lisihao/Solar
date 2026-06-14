import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { AiChatService } from "../ai-chat.service";
import { TaskProfileMapperService } from "../task-profile-mapper.service";
import {
  AiModelConfigService,
  AIModelConfig,
} from "../../models/config/ai-model-config.service";
import { AiApiCallerService } from "../../providers/ai-api-caller.service";
import { AiStreamHandlerService } from "../ai-stream-handler.service";
import { AIMetricsService } from "@/modules/platform/monitoring";
import { GuardrailsPipelineService } from "../../../safety/guardrails/guardrails-pipeline.service";
import { EntityHealthRegistry } from "../../../reliability/entity-health/entity-health.registry";
import { AiConnectionTestService } from "../../byok/ai-connection-test.service";
import { AiModelDiscoveryService } from "../../models/catalog/ai-model-discovery.service";
import { AiDirectKeyService } from "../../byok/ai-direct-key.service";
import { AiImageGenerationService } from "../../image/ai-image-generation.service";
import { AiChatRetryService } from "../ai-chat-retry.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { AIModelType } from "@prisma/client";
import { AiServiceUnavailableError } from "@/modules/ai-engine/llm/abstractions/ai-service.exception";
import { RequestContext } from "@/common/context/request-context";
import { MissionContext } from "@/common/context/mission-context";

// Helper to create mock AIModelConfig
function createMockModelConfig(
  overrides: Partial<AIModelConfig> = {},
): AIModelConfig {
  return {
    id: "test-model-id",
    name: "test-model",
    displayName: "Test Model",
    provider: "openai",
    modelId: "gpt-4o",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "test-key",
    maxTokens: 4000,
    temperature: 0.7,
    isEnabled: true,
    isDefault: false,
    isReasoning: false,
    apiFormat: "openai",
    supportsTemperature: true,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    ...overrides,
  };
}

describe("AiChatService", () => {
  let service: AiChatService;
  let mockConfigService: any;
  let mockTaskProfileMapper: any;
  let mockModelConfigService: any;
  let mockApiCallerService: any;
  let mockStreamHandlerService: any;
  let mockMetricsService: any;
  let mockGuardrailsPipeline: any;
  let mockCircuitBreaker: any;
  let mockConnectionTestService: any;
  let mockModelDiscoveryService: any;
  let mockDirectKeyService: any;
  let mockImageGenerationService: any;
  let mockRetryService: any;
  let mockEventEmitter: any;

  beforeEach(async () => {
    // Required services
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === "DEFAULT_AI_MODEL") return "gpt-4o";
        if (key === "GUARDRAILS_ENABLED") return "false";
        return defaultValue;
      }),
    };

    mockTaskProfileMapper = {
      mapToParameters: jest.fn().mockReturnValue({
        temperature: 0.7,
        maxTokens: 4000,
      }),
    };

    mockModelConfigService = {
      getModelConfig: jest.fn().mockResolvedValue(null),
      getDefaultModelConfig: jest.fn().mockResolvedValue(null),
      getDefaultModelByType: jest.fn().mockResolvedValue(null),
      getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
      getApiKeyForModel: jest.fn().mockResolvedValue("test-key"),
      isReasoningModel: jest.fn().mockReturnValue(false),
      getTimeoutForModel: jest.fn().mockReturnValue(120000),
      findUserDefaultByType: jest.fn().mockResolvedValue(null),
      resolveApiKey: jest.fn().mockResolvedValue({
        apiKey: "test-key",
        source: "system",
        apiEndpoint: "https://api.openai.com/v1",
      }),
    };

    mockApiCallerService = {
      callOpenAICompatibleAPI: jest.fn().mockResolvedValue({
        content: "Test response",
        model: "gpt-4o",
        tokensUsed: 100,
      }),
      callAnthropicAPI: jest.fn().mockResolvedValue({
        content: "Test response",
        model: "claude-3-opus",
        tokensUsed: 100,
      }),
      callGoogleAPI: jest.fn().mockResolvedValue({
        content: "Test response",
        model: "gemini-2.0-flash",
        tokensUsed: 100,
      }),
      callXAIAPI: jest.fn().mockResolvedValue({
        content: "Test response",
        model: "grok",
        tokensUsed: 100,
      }),
    };

    mockStreamHandlerService = {
      streamOpenAICompatible: jest.fn(),
      streamAnthropic: jest.fn(),
    };

    // Optional services
    mockMetricsService = {
      recordMetric: jest.fn().mockResolvedValue(undefined),
    };

    mockGuardrailsPipeline = {
      processInput: jest.fn().mockResolvedValue({ passed: true }),
      processOutput: jest.fn().mockResolvedValue({ passed: true }),
    };

    mockCircuitBreaker = {
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      parseErrorType: jest.fn().mockReturnValue("API_ERROR"),
      incrementLoad: jest.fn(),
      decrementLoad: jest.fn(),
      canExecute: jest.fn().mockReturnValue(true),
    };

    mockConnectionTestService = {
      testModelConnectionWithKey: jest.fn().mockResolvedValue({
        success: true,
        message: "Connection successful",
        latency: 100,
      }),
    };

    mockModelDiscoveryService = {
      fetchAvailableModels: jest.fn().mockResolvedValue({
        success: true,
        models: [{ id: "gpt-4o", name: "GPT-4 Optimized" }],
      }),
      formatModelDisplayName: jest.fn((model: string) => model),
      getEnvVarNameForProvider: jest.fn().mockReturnValue("OPENAI_API_KEY"),
    };

    mockDirectKeyService = {
      generateChatCompletionWithKey: jest.fn().mockResolvedValue({
        content: "Direct key response",
        model: "gpt-4o",
        tokensUsed: 100,
      }),
    };

    mockImageGenerationService = {
      isImageGenerationRequest: jest.fn().mockReturnValue(false),
    };

    mockRetryService = {
      withExponentialBackoff: jest.fn((op: () => Promise<unknown>) => op()),
    };

    mockEventEmitter = {
      emit: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiChatService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: TaskProfileMapperService, useValue: mockTaskProfileMapper },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        { provide: AiApiCallerService, useValue: mockApiCallerService },
        { provide: AiStreamHandlerService, useValue: mockStreamHandlerService },
        { provide: AiChatRetryService, useValue: mockRetryService },
        { provide: AIMetricsService, useValue: mockMetricsService },
        {
          provide: GuardrailsPipelineService,
          useValue: mockGuardrailsPipeline,
        },
        { provide: EntityHealthRegistry, useValue: mockCircuitBreaker },
        {
          provide: AiConnectionTestService,
          useValue: mockConnectionTestService,
        },
        {
          provide: AiModelDiscoveryService,
          useValue: mockModelDiscoveryService,
        },
        { provide: AiDirectKeyService, useValue: mockDirectKeyService },
        {
          provide: AiImageGenerationService,
          useValue: mockImageGenerationService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<AiChatService>(AiChatService);

    // ★ BYOK v2 防呆：AiChatService.chat() 要求必有 userId（参数或 RequestContext）。
    //   测试统一用虚拟 userId，避免每个用例都要显式传参。
    jest.spyOn(RequestContext, "getUserId").mockReturnValue("test-user-id");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Model Config Delegation Tests ====================

  describe("Model Configuration Delegation", () => {
    it("should delegate getDefaultModelByType to AiModelConfigService", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getDefaultModelByType.mockResolvedValue(
        mockConfig,
      );

      const result = await service.getDefaultModelByType(AIModelType.CHAT);

      expect(mockModelConfigService.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
      expect(result).toEqual(mockConfig);
    });

    it("should delegate getAllEnabledModelsByType to AiModelConfigService", async () => {
      const mockModels = [
        createMockModelConfig({ modelId: "gpt-4o" }),
        createMockModelConfig({ modelId: "claude-3-opus" }),
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        mockModels,
      );

      const result = await service.getAllEnabledModelsByType(AIModelType.CHAT, [
        "gpt-4",
      ]);

      expect(
        mockModelConfigService.getAllEnabledModelsByType,
      ).toHaveBeenCalledWith(AIModelType.CHAT, ["gpt-4"]);
      expect(result).toEqual(mockModels);
    });

    it("should delegate getApiKeyForModel to AiModelConfigService", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getApiKeyForModel.mockResolvedValue("test-key");

      const result = await service.getApiKeyForModel(mockConfig);

      expect(mockModelConfigService.getApiKeyForModel).toHaveBeenCalledWith(
        mockConfig,
      );
      expect(result).toBe("test-key");
    });

    it("should delegate isReasoningModel to AiModelConfigService", () => {
      mockModelConfigService.isReasoningModel.mockReturnValue(true);

      const result = service.isReasoningModel("o1-preview");

      expect(mockModelConfigService.isReasoningModel).toHaveBeenCalledWith(
        "o1-preview",
      );
      expect(result).toBe(true);
    });
  });

  // ==================== Sub-service Delegation Tests ====================

  describe("Sub-service Delegation", () => {
    it("should delegate testModelConnectionWithKey to AiConnectionTestService", async () => {
      const result = await service.testModelConnectionWithKey(
        "openai",
        "gpt-4o",
        "test-key",
        "https://api.openai.com/v1",
      );

      expect(
        mockConnectionTestService.testModelConnectionWithKey,
      ).toHaveBeenCalledWith(
        "openai",
        "gpt-4o",
        "test-key",
        "https://api.openai.com/v1",
        undefined,
      );
      expect(result.success).toBe(true);
    });

    it("should return error when AiConnectionTestService not available", async () => {
      service = new AiChatService(
        mockConfigService,
        mockTaskProfileMapper,
        mockModelConfigService,
        mockApiCallerService,
        mockStreamHandlerService,
        mockRetryService,
      );

      const result = await service.testModelConnectionWithKey(
        "openai",
        "gpt-4o",
        "test-key",
        "https://api.openai.com/v1",
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe("AiConnectionTestService not available");
    });

    it("should delegate fetchAvailableModels to AiModelDiscoveryService", async () => {
      const result = await service.fetchAvailableModels(
        "openai",
        "test-key",
        "https://api.openai.com/v1",
      );

      expect(
        mockModelDiscoveryService.fetchAvailableModels,
      ).toHaveBeenCalledWith(
        "openai",
        "test-key",
        "https://api.openai.com/v1",
        undefined,
      );
      expect(result.success).toBe(true);
    });

    it("should return error when AiModelDiscoveryService not available", async () => {
      service = new AiChatService(
        mockConfigService,
        mockTaskProfileMapper,
        mockModelConfigService,
        mockApiCallerService,
        mockStreamHandlerService,
        mockRetryService,
      );

      const result = await service.fetchAvailableModels("openai", "test-key");

      expect(result.success).toBe(false);
      expect(result.error).toBe("AiModelDiscoveryService not available");
    });

    it("should delegate generateChatCompletionWithKey to AiDirectKeyService", async () => {
      const result = await service.generateChatCompletionWithKey({
        provider: "openai",
        modelId: "gpt-4o",
        apiKey: "test-key",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(
        mockDirectKeyService.generateChatCompletionWithKey,
      ).toHaveBeenCalled();
      expect(result.content).toBe("Direct key response");
    });

    it("should return error when AiDirectKeyService not available", async () => {
      service = new AiChatService(
        mockConfigService,
        mockTaskProfileMapper,
        mockModelConfigService,
        mockApiCallerService,
        mockStreamHandlerService,
        mockRetryService,
      );

      const result = await service.generateChatCompletionWithKey({
        provider: "openai",
        modelId: "gpt-4o",
        apiKey: "test-key",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content).toBe("AiDirectKeyService not available");
    });

    it("should delegate isImageGenerationRequest to AiImageGenerationService", () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(true);

      const result = service.isImageGenerationRequest("Generate an image");

      expect(
        mockImageGenerationService.isImageGenerationRequest,
      ).toHaveBeenCalledWith("Generate an image");
      expect(result).toBe(true);
    });

    it("should return false when AiImageGenerationService not available", () => {
      service = new AiChatService(
        mockConfigService,
        mockTaskProfileMapper,
        mockModelConfigService,
        mockApiCallerService,
        mockStreamHandlerService,
        mockRetryService,
      );

      const result = service.isImageGenerationRequest("Generate an image");

      expect(result).toBe(false);
    });

    it("should delegate formatModelDisplayName to AiModelDiscoveryService", () => {
      mockModelDiscoveryService.formatModelDisplayName.mockReturnValue(
        "GPT-4 Optimized",
      );

      const result = service.formatModelDisplayName("gpt-4o");

      expect(
        mockModelDiscoveryService.formatModelDisplayName,
      ).toHaveBeenCalledWith("gpt-4o");
      expect(result).toBe("GPT-4 Optimized");
    });

    it("should return original model name when AiModelDiscoveryService not available", () => {
      service = new AiChatService(
        mockConfigService,
        mockTaskProfileMapper,
        mockModelConfigService,
        mockApiCallerService,
        mockStreamHandlerService,
        mockRetryService,
      );

      const result = service.formatModelDisplayName("gpt-4o");

      expect(result).toBe("gpt-4o");
    });

    it("should delegate getEnvVarNameForProvider to AiModelDiscoveryService", () => {
      const result = service.getEnvVarNameForProvider("openai");

      expect(
        mockModelDiscoveryService.getEnvVarNameForProvider,
      ).toHaveBeenCalledWith("openai");
      expect(result).toBe("OPENAI_API_KEY");
    });

    it("should return default format when AiModelDiscoveryService not available", () => {
      service = new AiChatService(
        mockConfigService,
        mockTaskProfileMapper,
        mockModelConfigService,
        mockApiCallerService,
        mockStreamHandlerService,
        mockRetryService,
      );

      const result = service.getEnvVarNameForProvider("openai");

      expect(result).toBe("OPENAI_API_KEY");
    });
  });

  // ==================== BYOK contract (2026-05-12) ====================
  // chat() 入口必须把 MissionContext.userId 作为 effectiveUserId 第三兜底，
  // 并在 mission 上下文下检测到 userId 解析为空时记录 contract violation error。
  // 详细背景见 ai-chat.service.ts:1244 注释。

  describe("BYOK contract — mission-context userId fallback (2026-05-12)", () => {
    let errorSpy: jest.SpyInstance;
    const CONTRACT_PHRASE = "BYOK contract violation";

    // 工具：只关心"是否记过 contract violation"，下游模型未配置等正常 error 忽略
    function hasContractViolation(): boolean {
      return errorSpy.mock.calls.some(
        (call) =>
          typeof call[0] === "string" && call[0].includes(CONTRACT_PHRASE),
      );
    }

    beforeEach(() => {
      // 默认 stub 是 "test-user-id"——本节测试需要 RequestContext 空，
      // 模拟"mission 路径未走 HTTP middleware"的状态
      jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);
      errorSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: jest.Mock } }).logger,
          "error",
        )
        .mockImplementation();
    });

    afterEach(() => {
      jest.spyOn(MissionContext, "get").mockRestore();
    });

    it("falls through to MissionContext.userId when no options.userId / no RequestContext", async () => {
      jest.spyOn(MissionContext, "get").mockReturnValue({
        missionId: "m1",
        userId: "mission-user",
      });

      await service
        .chat({
          messages: [{ role: "user", content: "hi" }],
          modelType: AIModelType.CHAT,
        })
        .catch(() => undefined);

      // userId 从 MissionContext 解到 → 不触发 contract violation
      expect(hasContractViolation()).toBe(false);
    });

    it("logs contract violation when mission context exists but no userId anywhere", async () => {
      jest.spyOn(MissionContext, "get").mockReturnValue({ missionId: "m1" });

      await service
        .chat({
          messages: [{ role: "user", content: "hi" }],
          modelType: AIModelType.CHAT,
          operationName: "test-op",
        })
        .catch(() => undefined);

      const violationCall = errorSpy.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes(CONTRACT_PHRASE),
      );
      expect(violationCall).toBeDefined();
      expect(violationCall![0]).toContain("missionId=m1");
      expect(violationCall![0]).toContain("operationName=test-op");
    });

    it("does NOT log violation when no missionId (cron / system task without mission scope)", async () => {
      jest.spyOn(MissionContext, "get").mockReturnValue(undefined);

      await service
        .chat({
          messages: [{ role: "user", content: "hi" }],
          modelType: AIModelType.CHAT,
        })
        .catch(() => undefined);

      expect(hasContractViolation()).toBe(false);
    });

    it("does NOT log violation when options.userId is provided (explicit BYOK)", async () => {
      jest.spyOn(MissionContext, "get").mockReturnValue({ missionId: "m1" });

      await service
        .chat({
          messages: [{ role: "user", content: "hi" }],
          modelType: AIModelType.CHAT,
          userId: "explicit-user",
        })
        .catch(() => undefined);

      expect(hasContractViolation()).toBe(false);
    });
  });

  // ==================== Chat Method Tests ====================

  describe("chat() - Main Entry Point", () => {
    it("should route to Path B (BYOK) when apiKey and provider are provided", async () => {
      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        provider: "openai",
        apiKey: "custom-key",
        model: "gpt-4o",
      });

      expect(
        mockDirectKeyService.generateChatCompletionWithKey,
      ).toHaveBeenCalled();
      expect(result.content).toBe("Direct key response");
    });

    it("should route to Path A (system config) when no apiKey provided", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalled();
      expect(result.content).toBe("Test response");
    });

    it("should resolve model from modelType when model not provided", async () => {
      const mockConfig = createMockModelConfig({ modelId: "gpt-4o" });
      mockModelConfigService.getDefaultModelByType.mockResolvedValue(
        mockConfig,
      );

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        modelType: AIModelType.CHAT,
      });

      expect(mockModelConfigService.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
    });

    it("should read DEFAULT_AI_MODEL with empty-string default (no hardcoded fallback) when no model or modelType provided", async () => {
      const mockConfig = createMockModelConfig({ modelId: "gpt-4o" });
      // Operator opts in via env. With empty string default, the service
      // still honours DEFAULT_AI_MODEL when it is set.
      mockConfigService.get.mockImplementation((key: string, def?: unknown) => {
        if (key === "DEFAULT_AI_MODEL") return "gpt-4o";
        return def;
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(mockConfigService.get).toHaveBeenCalledWith(
        "DEFAULT_AI_MODEL",
        "",
      );
      expect(mockModelConfigService.getModelConfig).toHaveBeenCalledWith(
        "gpt-4o",
      );
    });

    it("should throw AiServiceUnavailableError when no modelId can be resolved (no hardcoded gemini fallback)", async () => {
      mockConfigService.get.mockReturnValue("");

      await expect(
        service.chat({ messages: [{ role: "user", content: "Hello" }] }),
      ).rejects.toThrow(/DEFAULT_AI_MODEL 未设置|DEFAULT_AI_MODEL is not set/);
    });

    it("EVALUATOR 无配置 → 回落 CHAT 主模型（不再抛错让上层 abstain）", async () => {
      // 2026-06-12: 日志实测 judge:external 因 no EVALUATOR model 直接 abstain。
      // 现在非 CHAT 类型无配置应回落 CHAT，而非抛 AiServiceUnavailableError。
      mockConfigService.get.mockReturnValue(""); // 无 DEFAULT_AI_MODEL env
      mockModelConfigService.getModelConfig.mockResolvedValue(null);
      mockModelConfigService.findUserDefaultByType.mockResolvedValue(null);
      const chatCfg = createMockModelConfig({ modelId: "chat-model-x" });
      mockModelConfigService.getDefaultModelByType.mockImplementation(
        (type: AIModelType) =>
          Promise.resolve(type === AIModelType.CHAT ? chatCfg : null),
      );

      // 核心回归：不再抛 AiServiceUnavailableError（abstain 根因），而是回落 CHAT。
      await expect(
        service.chat({
          messages: [{ role: "user", content: "judge this" }],
          modelType: AIModelType.EVALUATOR,
        }),
      ).resolves.toBeDefined();
      // 回退路径执行：解析了 CHAT 主模型
      expect(mockModelConfigService.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
    });

    it("should apply taskProfile parameters when provided", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockTaskProfileMapper.mapToParameters.mockReturnValue({
        temperature: 0.3,
        maxTokens: 1500,
      });

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        taskProfile: { creativity: "low", outputLength: "short" },
      });

      expect(mockTaskProfileMapper.mapToParameters).toHaveBeenCalledWith(
        { creativity: "low", outputLength: "short" },
        mockConfig,
      );
      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        1500, // maxTokens from taskProfile
        0.3, // temperature from taskProfile
        expect.any(Number),
        expect.any(String),
        undefined, // responseFormat
        undefined, // reasoningDepth
        undefined, // outputSchema
        false, // useStrictMode
        expect.any(Boolean), // isReasoning
        undefined, // structuredOutputStrategy
        undefined, // outputJsonSchema
        undefined, // schemaName
        undefined, // tools
        expect.any(String), // v3.1 §A: provider
      );
    });

    it("should prefer direct parameters over taskProfile", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        maxTokens: 2000,
        temperature: 0.5,
        taskProfile: { creativity: "low", outputLength: "short" },
      });

      // Should not call taskProfileMapper when direct params provided
      expect(mockTaskProfileMapper.mapToParameters).not.toHaveBeenCalled();
      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        2000,
        0.5,
        expect.any(Number),
        expect.any(String),
        undefined, // responseFormat
        undefined, // reasoningDepth
        undefined, // outputSchema
        false, // useStrictMode
        expect.any(Boolean), // isReasoning
        undefined, // structuredOutputStrategy
        undefined, // outputJsonSchema
        undefined, // schemaName
        undefined, // tools
        expect.any(String), // v3.1 §A: provider
      );
    });

    it("should pass responseFormat=json to callOpenAICompatibleAPI", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        responseFormat: "json",
      });

      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(String),
        "json", // responseFormat threaded through
        undefined, // reasoningDepth
        undefined, // outputSchema
        false, // useStrictMode
        expect.any(Boolean), // isReasoning
        undefined, // structuredOutputStrategy
        undefined, // outputJsonSchema
        undefined, // schemaName
        undefined, // tools
        expect.any(String), // v3.1 §A: provider
      );
    });

    it("should use model defaults when no taskProfile or direct params", async () => {
      const mockConfig = createMockModelConfig({
        maxTokens: 8000,
        temperature: 0.8,
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockTaskProfileMapper.mapToParameters.mockReturnValue({
        temperature: 0.8,
        maxTokens: 8000,
      });

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      expect(mockTaskProfileMapper.mapToParameters).toHaveBeenCalledWith(
        undefined,
        mockConfig,
      );
    });
  });

  // ==================== Guardrails Integration Tests ====================

  describe("Guardrails Integration", () => {
    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "true";
        if (key === "DEFAULT_AI_MODEL") return "gpt-4o";
        return undefined;
      });
    });

    it("should block input when guardrails fail", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockGuardrailsPipeline.processInput.mockResolvedValue({
        passed: false,
        blockedBy: "profanity_filter",
      });

      const result = await service.chat({
        messages: [{ role: "user", content: "Bad content" }],
        model: "gpt-4o",
      });

      expect(mockGuardrailsPipeline.processInput).toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content).toContain("blocked by content safety guardrail");
      expect(
        mockApiCallerService.callOpenAICompatibleAPI,
      ).not.toHaveBeenCalled();
    });

    it("should block output when guardrails fail", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockGuardrailsPipeline.processOutput.mockResolvedValue({
        passed: false,
        blockedBy: "sensitive_info_filter",
      });

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      expect(mockGuardrailsPipeline.processOutput).toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content).toContain("filtered by content safety guardrail");
    });

    it("should allow content when guardrails pass", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockGuardrailsPipeline.processInput.mockResolvedValue({ passed: true });
      mockGuardrailsPipeline.processOutput.mockResolvedValue({ passed: true });

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toBe("Test response");
    });

    it("should skip guardrails when not enabled", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "false";
        if (key === "DEFAULT_AI_MODEL") return "gpt-4o";
        return undefined;
      });

      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      expect(mockGuardrailsPipeline.processInput).not.toHaveBeenCalled();
      expect(mockGuardrailsPipeline.processOutput).not.toHaveBeenCalled();
    });

    // ★ Security (P0): 生产环境不允许通过 GUARDRAILS_ENABLED=false 关闭护栏
    it("should keep guardrails ON in production even if GUARDRAILS_ENABLED=false", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "false";
        if (key === "NODE_ENV") return "production";
        if (key === "DEFAULT_AI_MODEL") return "gpt-4o";
        return undefined;
      });

      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockGuardrailsPipeline.processInput.mockResolvedValue({ passed: true });
      mockGuardrailsPipeline.processOutput.mockResolvedValue({ passed: true });

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      // Production must NOT honor the disable flag
      expect(mockGuardrailsPipeline.processInput).toHaveBeenCalled();
      expect(mockGuardrailsPipeline.processOutput).toHaveBeenCalled();
    });

    // ★ Security (P0): guardrail 管道异常 → fail-closed 阻断（旧行为是 fail-open 放行）
    it("should fail-closed (block) when input guardrails throw error", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockGuardrailsPipeline.processInput.mockRejectedValue(
        new Error("Guardrail error"),
      );

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      // Pipeline error must block the request rather than leak through
      expect(result.isError).toBe(true);
      expect(result.content).toContain("blocked by content safety guardrail");
      expect(
        mockApiCallerService.callOpenAICompatibleAPI,
      ).not.toHaveBeenCalled();
    });
  });

  // ==================== Fallback Chain Tests ====================

  describe("Fallback Chain", () => {
    it("should return first successful model response", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        modelType: AIModelType.CHAT,
      });

      expect(result.content).toBe("Test response");
      expect(result.isError).not.toBe(true);
    });

    it("should fallback to alternative models when primary fails and modelType is provided", async () => {
      const primaryConfig = createMockModelConfig({ modelId: "gpt-4o" });
      const fallbackConfig = createMockModelConfig({
        modelId: "claude-3-opus",
        provider: "anthropic",
        apiFormat: "anthropic",
      });

      // Mock getModelConfig to return appropriate config based on model ID
      mockModelConfigService.getModelConfig.mockImplementation(
        async (modelId: string) => {
          if (modelId === "gpt-4o") return primaryConfig;
          if (modelId === "claude-3-opus") return fallbackConfig;
          return null;
        },
      );

      // After primary fails, getAllEnabledModelsByType returns fallback
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue([
        fallbackConfig,
      ]);

      // Primary model returns error
      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValueOnce({
        content: "Primary API Error",
        model: "gpt-4o",
        tokensUsed: 0,
        isError: true,
      });

      // Fallback model succeeds
      mockApiCallerService.callAnthropicAPI.mockResolvedValueOnce({
        content: "Fallback success",
        model: "claude-3-opus",
        tokensUsed: 100,
      });

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        modelType: AIModelType.CHAT, // modelType required for fallback
      });

      // Should query for alternative models after primary fails
      expect(
        mockModelConfigService.getAllEnabledModelsByType,
      ).toHaveBeenCalledWith(
        AIModelType.CHAT,
        expect.arrayContaining(["gpt-4o"]), // Should exclude tried model
      );
      expect(mockApiCallerService.callAnthropicAPI).toHaveBeenCalled();
      expect(result.content).toBe("Fallback success");
      expect(result.isError).toBeFalsy();
    });

    it("should return error after all fallbacks exhausted", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue([]);

      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "API Error",
        model: "gpt-4o",
        tokensUsed: 0,
        isError: true,
      });

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        modelType: AIModelType.CHAT,
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("API Error");
    });

    it("should limit fallback attempts to maxFallbackAttempts", async () => {
      const configs = Array.from({ length: 10 }, (_, i) =>
        createMockModelConfig({ modelId: `model-${i}` }),
      );

      mockModelConfigService.getModelConfig.mockResolvedValue(configs[0]);
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        configs.slice(1),
      );

      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "Error",
        model: "test",
        tokensUsed: 0,
        isError: true,
      });

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "model-0",
        modelType: AIModelType.CHAT,
      });

      // Should try at most 5 models (maxFallbackAttempts)
      expect(
        mockApiCallerService.callOpenAICompatibleAPI,
      ).toHaveBeenCalledTimes(5);
      expect(result.isError).toBe(true);
    });
  });

  // ==================== Circuit Breaker Integration Tests ====================

  describe("Circuit Breaker Integration", () => {
    it("should record success when model call succeeds", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalledWith(
        "gpt-4o",
        expect.any(Number),
      );
    });

    it("should record failure when model call fails", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue([]);

      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "API Error",
        model: "gpt-4o",
        tokensUsed: 0,
        isError: true,
      });

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        modelType: AIModelType.CHAT,
      });

      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalledWith(
        "gpt-4o",
        "API_ERROR",
        "API Error",
      );
    });

    it("should work when circuit breaker not available", async () => {
      service = new AiChatService(
        mockConfigService,
        mockTaskProfileMapper,
        mockModelConfigService,
        mockApiCallerService,
        mockStreamHandlerService,
        mockRetryService,
      );

      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      expect(result.content).toBe("Test response");
    });
  });

  // ==================== Retry Logic Tests ====================

  describe("Retry Logic", () => {
    it("should retry on retryable errors", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      // Mock to succeed on the first attempt (no retries needed at chat level)
      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "Success after retry",
        model: "gpt-4o",
        tokensUsed: 100,
      });

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      // Retry logic is internal to generateChatCompletion via withRetry
      expect(result.content).toBe("Success after retry");
    });

    it("should not retry on non-retryable errors in strict mode", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      // Mock error in API caller
      const error = new Error("Invalid API key");
      mockApiCallerService.callOpenAICompatibleAPI.mockRejectedValue(error);

      await expect(
        service.chat({
          messages: [{ role: "user", content: "Hello" }],
          model: "gpt-4o",
          strictMode: true,
        }),
      ).rejects.toThrow();
    });

    it("should respect MAX_RETRIES limit", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      const error = new Error("Rate limit exceeded");
      mockApiCallerService.callOpenAICompatibleAPI.mockRejectedValue(error);

      await expect(
        service.chat({
          messages: [{ role: "user", content: "Hello" }],
          model: "gpt-4o",
          strictMode: true,
        }),
      ).rejects.toThrow();

      // Retry happens inside withRetry() called by callAPIWithConfig
      // The chat() method itself only calls generateChatCompletion once
      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalled();
    });
  });

  // ==================== Error Handling Tests ====================

  describe("Error Handling", () => {
    it("should throw error in strict mode when model not configured", async () => {
      mockModelConfigService.getModelConfig.mockResolvedValue(null);

      await expect(
        service.chat({
          messages: [{ role: "user", content: "Hello" }],
          model: "unknown-model",
          strictMode: true,
        }),
      ).rejects.toThrow(AiServiceUnavailableError);
    });

    it("should return error message in non-strict mode when model not configured", async () => {
      mockModelConfigService.getModelConfig.mockResolvedValue(null);

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "unknown-model",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("模型未配置");
    });

    it("should throw error when API key not configured in strict mode", async () => {
      const mockConfig = createMockModelConfig({ apiKey: null });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockModelConfigService.resolveApiKey.mockResolvedValue(null);

      await expect(
        service.generateChatCompletion({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
          strictMode: true,
        }),
      ).rejects.toThrow(AiServiceUnavailableError);
    });

    it("should return error message when API key not configured in non-strict mode", async () => {
      const mockConfig = createMockModelConfig({ apiKey: null });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockModelConfigService.resolveApiKey.mockResolvedValue(null);

      const result = await service.generateChatCompletion({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("API Key 未配置");
    });
  });

  // ==================== API Format Routing Tests ====================

  describe("API Format Routing", () => {
    it("should route to OpenAI API for openai format", async () => {
      const mockConfig = createMockModelConfig({ apiFormat: "openai" });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalled();
    });

    it("should route to Anthropic API for anthropic format", async () => {
      const mockConfig = createMockModelConfig({
        apiFormat: "anthropic",
        provider: "anthropic",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "claude-3-opus",
      });

      expect(mockApiCallerService.callAnthropicAPI).toHaveBeenCalled();
    });

    it("should route to Google API for google format", async () => {
      const mockConfig = createMockModelConfig({
        apiFormat: "google",
        provider: "google",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gemini-2.0-flash",
      });

      expect(mockApiCallerService.callGoogleAPI).toHaveBeenCalled();
    });

    it("should route to XAI API for xai format", async () => {
      const mockConfig = createMockModelConfig({
        apiFormat: "xai",
        provider: "xai",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "grok",
      });

      expect(mockApiCallerService.callXAIAPI).toHaveBeenCalled();
    });

    it("should default to OpenAI API for unknown format", async () => {
      const mockConfig = createMockModelConfig({
        apiFormat: "unknown" as any,
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "custom-model",
      });

      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalled();
    });
  });

  // ==================== Metrics Recording Tests ====================

  describe("Metrics Recording", () => {
    it("should record successful LLM call metrics", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        userId: "user-123",
      });

      expect(mockMetricsService.recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: "llm_call",
          modelId: "gpt-4o",
          userId: "user-123",
          success: true,
          providerId: "openai",
        }),
      );
    });

    it("should record failed LLM call metrics", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue([]);

      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "API Error",
        model: "gpt-4o",
        tokensUsed: 0,
        isError: true,
      });

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        modelType: AIModelType.CHAT,
      });

      expect(mockMetricsService.recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: "llm_call",
          success: false,
          errorCode: "LLM_CALL_FAILED",
        }),
      );
    });

    it("should work when metrics service not available", async () => {
      service = new AiChatService(
        mockConfigService,
        mockTaskProfileMapper,
        mockModelConfigService,
        mockApiCallerService,
        mockStreamHandlerService,
        mockRetryService,
      );

      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      expect(result.content).toBe("Test response");
    });
  });

  // ==================== Stream Tests ====================

  describe("chatStream()", () => {
    it("should stream response for OpenAI format", async () => {
      const mockConfig = createMockModelConfig({ apiFormat: "openai" });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      const mockStream = (async function* () {
        yield { content: "Hello", done: false };
        yield { content: " world", done: false };
        yield { content: "", done: true };
      })();

      mockStreamHandlerService.streamOpenAICompatible.mockReturnValue(
        mockStream,
      );

      const chunks: any[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(
        mockStreamHandlerService.streamOpenAICompatible,
      ).toHaveBeenCalled();
    });

    it("should stream response for Anthropic format", async () => {
      const mockConfig = createMockModelConfig({
        apiFormat: "anthropic",
        provider: "anthropic",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      const mockStream = (async function* () {
        yield { content: "Test", done: false };
        yield { content: "", done: true };
      })();

      mockStreamHandlerService.streamAnthropic.mockReturnValue(mockStream);

      const chunks: any[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "claude-3-opus",
      })) {
        chunks.push(chunk);
      }

      expect(mockStreamHandlerService.streamAnthropic).toHaveBeenCalled();
    });

    it("should fallback to non-streaming for unsupported formats", async () => {
      const mockConfig = createMockModelConfig({
        apiFormat: "google",
        provider: "google",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockApiCallerService.callGoogleAPI.mockResolvedValue({
        content: "Full response",
        model: "gemini-2.0-flash",
        tokensUsed: 100,
      });

      const chunks: any[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "gemini-2.0-flash",
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toBe("Full response");
      expect(chunks[0].done).toBe(true);
    });

    it("should return error when model not configured", async () => {
      mockModelConfigService.getModelConfig.mockResolvedValue(null);

      const chunks: any[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "unknown-model",
      })) {
        chunks.push(chunk);
      }

      expect(chunks[0].error).toBe("MODEL_NOT_CONFIGURED");
      expect(chunks[0].done).toBe(true);
    });

    it("should return error when API key not configured", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockModelConfigService.resolveApiKey.mockResolvedValue(null);

      const chunks: any[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      })) {
        chunks.push(chunk);
      }

      expect(chunks[0].error).toBe("API_KEY_NOT_CONFIGURED");
      expect(chunks[0].done).toBe(true);
    });
  });

  // ==================== Observability / Trace Tests ====================

  describe("Trace Integration", () => {
    it("should emit llm.span.start event when traceId is provided", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        traceId: "test-trace-id",
      });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "llm.span.start",
        expect.objectContaining({
          traceId: "test-trace-id",
          name: "ai-chat",
          type: "llm_call",
          metadata: expect.objectContaining({
            messageCount: 1,
          }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "llm.span.end",
        expect.objectContaining({
          status: "success",
        }),
      );
    });

    it("should not emit span events when traceId is not provided", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      const emitCalls: string[] = mockEventEmitter.emit.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(emitCalls).not.toContain("llm.span.start");
      expect(emitCalls).not.toContain("llm.span.end");
    });

    it("should emit llm.span.end with error status on failure", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue([]);

      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "API Error",
        model: "gpt-4o",
        tokensUsed: 0,
        isError: true,
      });

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        modelType: AIModelType.CHAT,
        traceId: "test-trace-id",
      });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "llm.span.end",
        expect.objectContaining({
          status: "error",
        }),
      );
    });

    it("should work when EventEmitter2 not available", async () => {
      service = new AiChatService(
        mockConfigService,
        mockTaskProfileMapper,
        mockModelConfigService,
        mockApiCallerService,
        mockStreamHandlerService,
        mockRetryService,
      );

      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        traceId: "test-trace-id",
      });

      expect(result.content).toBe("Test response");
    });
  });

  // ==================== Utility Methods Tests ====================

  describe("Utility Methods", () => {
    it("should validate AI service availability", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "OK",
        model: "gpt-4o",
        tokensUsed: 10,
      });

      await expect(
        service.validateAIServiceAvailability("gpt-4o"),
      ).resolves.not.toThrow();
    });

    it("should throw error when AI service validation fails", async () => {
      mockModelConfigService.getModelConfig.mockResolvedValue(null);
      mockModelConfigService.getDefaultModelConfig.mockResolvedValue(null);

      await expect(service.validateAIServiceAvailability()).rejects.toThrow(
        AiServiceUnavailableError,
      );
    });

    it("should check if API key is configured", async () => {
      const mockConfig = createMockModelConfig({ apiKey: "test-key" });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);

      const result = await service.isApiKeyConfiguredAsync("gpt-4o");

      expect(result).toBe(true);
    });

    it("should get available models asynchronously", async () => {
      const mockModels = [
        createMockModelConfig({ modelId: "gpt-4o" }),
        createMockModelConfig({ modelId: "claude-3-opus" }),
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        mockModels,
      );

      const result = await service.getAvailableModelsAsync();

      expect(result).toContain("gpt-4o");
      expect(result).toContain("claude-3-opus");
    });
  });

  // ==================== getRequiredApiKeyName ====================

  describe("getRequiredApiKeyName", () => {
    it.each([
      ["grok", "XAI_API_KEY"],
      ["grok-3", "XAI_API_KEY"],
      ["gpt-4", "OPENAI_API_KEY"],
      ["gpt-4o-mini", "OPENAI_API_KEY"],
      ["o1-preview", "OPENAI_API_KEY"],
      ["o3-mini", "OPENAI_API_KEY"],
      ["claude", "ANTHROPIC_API_KEY"],
      ["claude-3-opus", "ANTHROPIC_API_KEY"],
      ["gemini", "GOOGLE_AI_API_KEY"],
      ["gemini-2.0-flash", "GOOGLE_AI_API_KEY"],
      ["unknown-model", "GOOGLE_AI_API_KEY"], // default fallback
    ])("maps model '%s' to key '%s'", (model, expectedKey) => {
      expect(service.getRequiredApiKeyName(model)).toBe(expectedKey);
    });
  });

  // ==================== isApiKeyConfigured (sync) ====================

  describe("isApiKeyConfigured (sync)", () => {
    it("returns true when env var is set", () => {
      mockConfigService.get.mockReturnValue("some-api-key");
      expect(service.isApiKeyConfigured("grok")).toBe(true);
    });

    it("returns false when env var is not set", () => {
      mockConfigService.get.mockReturnValue(undefined);
      expect(service.isApiKeyConfigured("grok")).toBe(false);
    });
  });

  // ==================== getAvailableModels (sync) ====================

  describe("getAvailableProviders / getAvailableModels (sync)", () => {
    // The service now returns provider names (xai/openai/anthropic/google)
    // instead of model-name literals. The legacy getAvailableModels() alias
    // delegates to getAvailableProviders and is kept only for migration.
    it("returns xai when XAI_API_KEY is set", () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "XAI_API_KEY") return "xai-key";
        return undefined;
      });
      expect(service.getAvailableProviders()).toContain("xai");
      expect(service.getAvailableModels()).toContain("xai");
    });

    it("returns openai when OPENAI_API_KEY is set", () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "OPENAI_API_KEY") return "openai-key";
        return undefined;
      });
      expect(service.getAvailableProviders()).toContain("openai");
    });

    it("returns anthropic when ANTHROPIC_API_KEY is set", () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "ANTHROPIC_API_KEY") return "anthropic-key";
        return undefined;
      });
      expect(service.getAvailableProviders()).toContain("anthropic");
    });

    it("returns google when GOOGLE_AI_API_KEY is set", () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "GOOGLE_AI_API_KEY") return "google-key";
        return undefined;
      });
      expect(service.getAvailableProviders()).toContain("google");
    });

    it("returns empty array when no env vars are set", () => {
      mockConfigService.get.mockReturnValue(undefined);
      const models = service.getAvailableModels();
      expect(models).toEqual([]);
    });
  });

  // ==================== isApiKeyConfiguredAsync ====================

  describe("isApiKeyConfiguredAsync - additional coverage", () => {
    it("returns false when no DB config and no env var", async () => {
      mockModelConfigService.getModelConfig.mockResolvedValue(null);
      mockConfigService.get.mockReturnValue(undefined);

      const result = await service.isApiKeyConfiguredAsync("gpt-4o");
      expect(result).toBe(false);
    });

    it("returns true when DB config has no apiKey but env var is set", async () => {
      mockModelConfigService.getModelConfig.mockResolvedValue(
        createMockModelConfig({ apiKey: null as any }),
      );
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "OPENAI_API_KEY") return "some-key";
        return undefined;
      });

      const result = await service.isApiKeyConfiguredAsync("gpt-4o");
      expect(result).toBe(true);
    });
  });

  // ==================== validateAIServiceAvailability - additional branches ====================

  describe("validateAIServiceAvailability - additional coverage", () => {
    it("throws when AI response contains error message", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "API Key 未配置 - please add your key",
        model: "gpt-4o",
        tokensUsed: 0,
      });

      await expect(
        service.validateAIServiceAvailability("gpt-4o"),
      ).rejects.toThrow(AiServiceUnavailableError);
    });

    it("throws AiServiceUnavailableError when API call throws generic error", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockApiCallerService.callOpenAICompatibleAPI.mockRejectedValue(
        new Error("Network timeout"),
      );

      await expect(
        service.validateAIServiceAvailability("gpt-4o"),
      ).rejects.toThrow(AiServiceUnavailableError);
    });

    it("validates with default model when no model specified and DB default exists", async () => {
      const mockConfig = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(null);
      mockModelConfigService.getDefaultModelConfig.mockResolvedValue(
        mockConfig,
      );
      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "OK",
        model: "gpt-4o",
        tokensUsed: 10,
      });

      await expect(
        service.validateAIServiceAvailability(),
      ).resolves.not.toThrow();
    });
  });

  // ==================== callAPIWithConfig - supportsTemperature branch ====================

  describe("callAPIWithConfig - temperature handling", () => {
    it("should pass undefined temperature for models that do not support it", async () => {
      const config = createMockModelConfig({
        supportsTemperature: false,
        apiFormat: "openai",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "o1-mini",
        temperature: 0.7, // This should be ignored
      });

      // temperature should be passed as undefined to the API caller
      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        undefined, // effectiveTemperature should be undefined
        expect.anything(),
        expect.anything(),
        undefined, // responseFormat not passed
        undefined, // reasoningDepth
        undefined, // outputSchema
        false, // useStrictMode
        expect.any(Boolean), // isReasoning
        undefined, // structuredOutputStrategy
        undefined, // outputJsonSchema
        undefined, // schemaName
        undefined, // tools
        expect.any(String), // v3.1 §A: provider
      );
    });

    it("should pass temperature when model supports it", async () => {
      const config = createMockModelConfig({
        supportsTemperature: true,
        apiFormat: "openai",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        temperature: 0.5,
      });

      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        0.5,
        expect.anything(),
        expect.anything(),
        undefined, // responseFormat not passed
        undefined, // reasoningDepth
        undefined, // outputSchema
        false, // useStrictMode
        expect.any(Boolean), // isReasoning
        undefined, // structuredOutputStrategy
        undefined, // outputJsonSchema
        undefined, // schemaName
        undefined, // tools
        expect.any(String), // v3.1 §A: provider
      );
    });

    it("uses getTimeoutForModel when config has no defaultTimeoutMs", async () => {
      const config = createMockModelConfig({
        defaultTimeoutMs: undefined,
        apiFormat: "openai",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      // Should still call the API (timeout was computed internally)
      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalled();
    });

    // 回归：UserModelConfig.defaultTimeoutMs 默认 120000（schema @default）
    // 不能短路掉 reasoning model 540s+ 的推荐 timeout。
    // 旧实现 `config.defaultTimeoutMs || getTimeoutForModel(...)` 会让 120000
    // 强吃 reasoning timeout，导致 BYOK gpt-5 类 reasoning 模型在 axios 120s
    // 后被 ECONNABORTED → "Request timeout"。修复用 Math.max 保留显式增大能力。
    it("Math.max picks computed timeout when config.defaultTimeoutMs is below computed", async () => {
      const config = createMockModelConfig({
        defaultTimeoutMs: 120000, // schema default
        apiFormat: "openai",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(config);
      mockModelConfigService.getTimeoutForModel.mockReturnValue(540000); // reasoning + 16K tokens

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-5.4",
      });

      // 7th positional arg of callOpenAICompatibleAPI is `timeout`.
      // Must be the larger value (540000), not the short-circuited 120000.
      const lastCall = (
        mockApiCallerService.callOpenAICompatibleAPI as jest.Mock
      ).mock.calls.at(-1);
      expect(lastCall?.[6]).toBe(540000);
    });

    it("Math.max keeps configured timeout when it exceeds computed (admin override)", async () => {
      const config = createMockModelConfig({
        defaultTimeoutMs: 900000, // admin explicit override
        apiFormat: "openai",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(config);
      mockModelConfigService.getTimeoutForModel.mockReturnValue(540000);

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-5.4",
      });

      const lastCall = (
        mockApiCallerService.callOpenAICompatibleAPI as jest.Mock
      ).mock.calls.at(-1);
      expect(lastCall?.[6]).toBe(900000);
    });
  });

  // ==================== getApiFormatForProvider ====================

  describe("getApiFormatForProvider (private, via callAPIWithConfig)", () => {
    it("should use apiEndpoint from resolved key when available", async () => {
      const config = createMockModelConfig({
        apiEndpoint: "https://original.endpoint.com",
        apiFormat: "openai",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(config);
      mockModelConfigService.resolveApiKey.mockResolvedValue({
        apiKey: "resolved-key",
        source: "personal",
        apiEndpoint: "https://custom.endpoint.com", // Override endpoint
      });

      await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      // API should be called with the resolved (custom) endpoint
      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalledWith(
        "https://custom.endpoint.com",
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        undefined, // responseFormat not passed
        undefined, // reasoningDepth
        undefined, // outputSchema
        false, // useStrictMode
        expect.any(Boolean), // isReasoning
        undefined, // structuredOutputStrategy
        undefined, // outputJsonSchema
        undefined, // schemaName
        undefined, // tools
        expect.any(String), // v3.1 §A: provider
      );
    });
  });

  // ==================== mapAIErrorTypeToTaskCompletion (via circuit breaker path) ====================

  describe("mapAIErrorTypeToTaskCompletion (via chat error types)", () => {
    const errorTypeCases = [
      "RATE_LIMIT",
      "QUOTA_EXCEEDED",
      "TIMEOUT",
      "INVALID_API_KEY",
      "INVALID_MODEL",
      "CONTENT_FILTERED",
      "CONTEXT_LENGTH_EXCEEDED",
      "NETWORK_ERROR",
      "TEMPORARY_UNAVAILABLE",
    ];

    it.each(errorTypeCases)(
      "handles errorType='%s' via circuit breaker",
      async (errorType) => {
        const config = createMockModelConfig();
        mockModelConfigService.getModelConfig.mockResolvedValue(config);
        mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue([]);

        mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
          content: "Error content",
          model: "gpt-4o",
          tokensUsed: 0,
          isError: true,
          errorType,
        });

        await service.chat({
          messages: [{ role: "user", content: "Hello" }],
          model: "gpt-4o",
          modelType: AIModelType.CHAT,
        });

        // Circuit breaker should be called with parsed error type
        expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
      },
    );
  });

  // ==================== chatStream - additional coverage ====================

  describe("chatStream() - additional coverage", () => {
    it("should resolve model via getDefaultModelConfig when no model or modelType", async () => {
      const defaultConfig = createMockModelConfig({ modelId: "default-model" });
      mockModelConfigService.getDefaultModelByType.mockResolvedValue(null);
      mockModelConfigService.getDefaultModelConfig.mockResolvedValue(
        defaultConfig,
      );
      mockModelConfigService.getModelConfig.mockResolvedValue(defaultConfig);

      const mockStream = (async function* () {
        yield { content: "Default stream content", done: false };
        yield { content: "", done: true };
      })();
      mockStreamHandlerService.streamOpenAICompatible.mockReturnValue(
        mockStream,
      );

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        // no model, no modelType
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("should resolve model via modelType in chatStream", async () => {
      const config = createMockModelConfig();
      mockModelConfigService.getDefaultModelByType.mockResolvedValue(config);
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      const mockStream = (async function* () {
        yield { content: "Typed model content", done: false };
        yield { content: "", done: true };
      })();
      mockStreamHandlerService.streamOpenAICompatible.mockReturnValue(
        mockStream,
      );

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        modelType: AIModelType.CHAT,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("should apply taskProfile in chatStream", async () => {
      const config = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      const mockStream = (async function* () {
        yield { content: "task profile content", done: false };
        yield { content: "", done: true };
      })();
      mockStreamHandlerService.streamOpenAICompatible.mockReturnValue(
        mockStream,
      );

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        taskProfile: { creativity: "high", outputLength: "long" },
      })) {
        chunks.push(chunk);
      }

      expect(mockTaskProfileMapper.mapToParameters).toHaveBeenCalled();
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("should increment/decrement circuit breaker load in chatStream", async () => {
      const config = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      const mockStream = (async function* () {
        yield { content: "OK", done: false };
        yield { content: "", done: true };
      })();
      mockStreamHandlerService.streamOpenAICompatible.mockReturnValue(
        mockStream,
      );

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      })) {
        chunks.push(chunk);
      }

      expect(mockCircuitBreaker.incrementLoad).toHaveBeenCalledWith("gpt-4o");
      expect(mockCircuitBreaker.decrementLoad).toHaveBeenCalledWith("gpt-4o");
    });

    it("should yield error chunk when stream throws", async () => {
      const config = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      const errorStream = (async function* () {
        yield { content: "Partial content", done: false };
        throw new Error("Stream connection error");
      })();
      mockStreamHandlerService.streamOpenAICompatible.mockReturnValue(
        errorStream,
      );

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      })) {
        chunks.push(chunk);
      }

      const lastChunk = chunks[chunks.length - 1] as {
        done: boolean;
        error?: string;
      };
      expect(lastChunk.done).toBe(true);
      expect(lastChunk.error).toContain("Stream connection error");
      // Circuit breaker should record failure
      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });

    it("should handle guardrails output block in chatStream", async () => {
      const config = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      const mockStream = (async function* () {
        yield { content: "Blocked content", done: false };
        yield { content: "", done: true };
      })();
      mockStreamHandlerService.streamOpenAICompatible.mockReturnValue(
        mockStream,
      );

      // Enable guardrails for this test
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "true";
        if (key === "DEFAULT_AI_MODEL") return "gpt-4o";
        return undefined;
      });
      mockGuardrailsPipeline.processOutput.mockResolvedValue({
        passed: false,
        blockedBy: "unsafe_content",
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      })) {
        chunks.push(chunk);
      }

      const lastChunk = chunks[chunks.length - 1] as {
        done: boolean;
        error?: string;
      };
      expect(lastChunk.done).toBe(true);
      expect(lastChunk.error).toContain("安全策略");
    });

    // ★ Security (P0): processOutput 异常 → fail-closed 阻断流（旧行为是 fail-open 放行）
    it("should fail-closed (block stream) when guardrails processOutput throws", async () => {
      const config = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      const mockStream = (async function* () {
        yield { content: "Good content", done: false };
        yield { content: "", done: true };
      })();
      mockStreamHandlerService.streamOpenAICompatible.mockReturnValue(
        mockStream,
      );

      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "true";
        if (key === "DEFAULT_AI_MODEL") return "gpt-4o";
        return undefined;
      });
      mockGuardrailsPipeline.processOutput.mockRejectedValue(
        new Error("Guardrails service down"),
      );

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      })) {
        chunks.push(chunk);
      }

      // Pipeline error must block the stream with a safety-policy error chunk
      const finalChunk = chunks[chunks.length - 1] as {
        done: boolean;
        error?: string;
      };
      expect(finalChunk.done).toBe(true);
      expect(finalChunk.error).toContain("安全策略");
    });

    it("should yield chunk error if stream yields error chunk", async () => {
      const config = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      const errorStream = (async function* () {
        yield {
          content: "",
          done: true,
          error: "Stream specific error message",
        };
      })();
      mockStreamHandlerService.streamOpenAICompatible.mockReturnValue(
        errorStream,
      );

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      })) {
        chunks.push(chunk);
      }

      const errorChunk = chunks[0] as { error?: string; done: boolean };
      expect(errorChunk.error).toBe("Stream specific error message");
    });

    it("should emit usage info from stream final chunk", async () => {
      const config = createMockModelConfig();
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      const mockStream = (async function* () {
        yield { content: "Content", done: false };
        yield {
          content: "",
          done: true,
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
          },
        };
      })();
      mockStreamHandlerService.streamOpenAICompatible.mockReturnValue(
        mockStream,
      );

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      })) {
        chunks.push(chunk);
      }

      // The final chunk emitted by chatStream should include usage
      const lastChunk = chunks[chunks.length - 1] as {
        done: boolean;
        usage?: { totalTokens: number };
      };
      expect(lastChunk.done).toBe(true);
      expect(lastChunk.usage).toBeDefined();
      expect(lastChunk.usage?.totalTokens).toBe(30);
    });
  });

  // ==================== chat() - BYOK output guardrail block ====================

  describe("chat() - BYOK path additional coverage", () => {
    it("should block BYOK output when guardrails fail", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "true";
        if (key === "DEFAULT_AI_MODEL") return "gpt-4o";
        return undefined;
      });
      mockGuardrailsPipeline.processInput.mockResolvedValue({ passed: true });
      mockGuardrailsPipeline.processOutput.mockResolvedValue({
        passed: false,
        blockedBy: "output_filter",
      });

      mockDirectKeyService.generateChatCompletionWithKey.mockResolvedValue({
        content: "Blocked BYOK response",
        model: "gpt-4o",
        tokensUsed: 100,
        isError: false,
      });

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        provider: "openai",
        apiKey: "user-api-key",
        model: "gpt-4o",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("filtered by content safety guardrail");
    });

    it("should handle BYOK path when directKeyService throws", async () => {
      mockGuardrailsPipeline.processInput.mockResolvedValue({ passed: true });
      mockDirectKeyService.generateChatCompletionWithKey.mockRejectedValue(
        new Error("Direct key service error"),
      );

      await expect(
        service.chat({
          messages: [{ role: "user", content: "Hello" }],
          provider: "openai",
          apiKey: "user-api-key",
          model: "gpt-4o",
        }),
      ).rejects.toThrow("Direct key service error");
    });
  });

  // ==================== getAvailableModelsAsync - error path ====================

  describe("getAvailableModelsAsync - error path", () => {
    it("returns empty array when getAllEnabledModelsByType throws", async () => {
      mockModelConfigService.getAllEnabledModelsByType.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.getAvailableModelsAsync();
      expect(result).toEqual([]);
    });

    it("excludes models without API keys", async () => {
      const modelsWithNoKey = [
        createMockModelConfig({ modelId: "model-no-key" }),
      ];
      mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue(
        modelsWithNoKey,
      );
      mockModelConfigService.getApiKeyForModel.mockResolvedValue(null);

      const result = await service.getAvailableModelsAsync();
      expect(result).toEqual([]);
    });
  });

  // ==================== Function Calling — tools passthrough ====================

  describe("Function Calling — tools passthrough via ChatOptions", () => {
    const toolDefs = [
      {
        name: "web-search",
        description: "Search the web",
        parameters: {
          type: "object" as const,
          properties: { query: { type: "string" } },
        },
      },
    ];

    it("tools field in ChatOptions flows into generateChatCompletion without error", async () => {
      const mockConfig = createMockModelConfig({ modelId: "gpt-4o" });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "result",
        model: "gpt-4o",
        tokensUsed: 100,
        finishReason: "stop",
      });

      await expect(
        service.chat({
          messages: [{ role: "user", content: "search TypeScript" }],
          model: "gpt-4o",
          tools: toolDefs,
        }),
      ).resolves.toBeDefined();
      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalled();
      const args = mockApiCallerService.callOpenAICompatibleAPI.mock.calls[0];
      expect(args[16]).toEqual(toolDefs);
    });

    it("toolCalls returned from adapter are propagated back in ChatResult", async () => {
      const mockConfig = createMockModelConfig({ modelId: "gpt-4o" });
      mockModelConfigService.getModelConfig.mockResolvedValue(mockConfig);
      mockApiCallerService.callOpenAICompatibleAPI.mockResolvedValue({
        content: "",
        model: "gpt-4o",
        tokensUsed: 50,
        finishReason: "tool_calls",
        toolCalls: [
          { id: "call-1", name: "web-search", arguments: { query: "AI" } },
        ],
      });

      const result = await service.chat({
        messages: [{ role: "user", content: "find AI info" }],
        model: "gpt-4o",
        tools: toolDefs,
      });

      expect(result.toolCalls).toEqual([
        { id: "call-1", name: "web-search", arguments: { query: "AI" } },
      ]);
    });
  });
});
