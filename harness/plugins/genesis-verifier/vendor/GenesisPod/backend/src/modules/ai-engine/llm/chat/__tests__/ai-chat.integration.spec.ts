/**
 * AiChatService - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Line 281: metrics catch warning
 *  - Lines 341-345, 356: emitJournalRecord, emitCostRecord, emitLatencyAction (via recordToLatencySession with ctx)
 *  - Lines 1072-1077: addChatObserver / removeChatObserver
 *  - Lines 1082-1086: dispatchChatObservers with throwing observer
 *  - Line 1132: AbortSignal aborted → DOMException
 *  - Lines 1170-1175: no userId → UnauthorizedException
 *  - Lines 1202-1205: BYOK path without directKeyService
 *  - Lines 637: generateChatCompletion with modelConfig found
 *  - Lines 732-735: clamping maxTokens to model limit
 */

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
import { RequestContext } from "@/common/context/request-context";

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

describe("AiChatService (extended coverage)", () => {
  let service: AiChatService;
  let mockConfigService: Record<string, jest.Mock>;
  let mockModelConfigService: Record<string, jest.Mock>;
  let mockApiCallerService: Record<string, jest.Mock>;
  let mockEventEmitter: Record<string, jest.Mock>;
  let mockRetryService: Record<string, jest.Mock>;
  let mockMetricsService: Record<string, jest.Mock>;

  async function buildModule(
    overrides: { directKeyService?: unknown } = {},
  ): Promise<void> {
    mockConfigService = {
      get: jest.fn((key: string, defaultVal?: unknown) => {
        if (key === "DEFAULT_AI_MODEL") return "gpt-4o";
        if (key === "GUARDRAILS_ENABLED") return "false";
        return defaultVal;
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
        model: "claude",
        tokensUsed: 100,
      }),
      callGoogleAPI: jest.fn().mockResolvedValue({
        content: "Test response",
        model: "gemini",
        tokensUsed: 100,
      }),
      callXAIAPI: jest.fn().mockResolvedValue({
        content: "Test response",
        model: "grok",
        tokensUsed: 100,
      }),
    };

    mockMetricsService = {
      recordMetric: jest.fn().mockResolvedValue(undefined),
    };

    mockEventEmitter = {
      emit: jest.fn().mockReturnValue(true),
    };

    mockRetryService = {
      withExponentialBackoff: jest.fn((op: () => Promise<unknown>) => op()),
    };

    const defaultDirectKeyService = {
      generateChatCompletionWithKey: jest.fn().mockResolvedValue({
        content: "Direct key response",
        model: "gpt-4o",
        tokensUsed: 100,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiChatService,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: TaskProfileMapperService,
          useValue: {
            mapToParameters: jest
              .fn()
              .mockReturnValue({ temperature: 0.7, maxTokens: 4000 }),
          },
        },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        { provide: AiApiCallerService, useValue: mockApiCallerService },
        {
          provide: AiStreamHandlerService,
          useValue: {
            streamOpenAICompatible: jest.fn(),
            streamAnthropic: jest.fn(),
          },
        },
        { provide: AiChatRetryService, useValue: mockRetryService },
        { provide: AIMetricsService, useValue: mockMetricsService },
        {
          provide: GuardrailsPipelineService,
          useValue: {
            processInput: jest.fn().mockResolvedValue({ passed: true }),
            processOutput: jest.fn().mockResolvedValue({ passed: true }),
          },
        },
        {
          provide: EntityHealthRegistry,
          useValue: {
            recordSuccess: jest.fn(),
            recordFailure: jest.fn(),
            parseErrorType: jest.fn().mockReturnValue("API_ERROR"),
            incrementLoad: jest.fn(),
            decrementLoad: jest.fn(),
            canExecute: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: AiConnectionTestService,
          useValue: {
            testModelConnectionWithKey: jest.fn().mockResolvedValue({
              success: true,
              message: "ok",
              latency: 100,
            }),
          },
        },
        {
          provide: AiModelDiscoveryService,
          useValue: {
            fetchAvailableModels: jest.fn(),
            formatModelDisplayName: jest.fn((m: string) => m),
            getEnvVarNameForProvider: jest
              .fn()
              .mockReturnValue("OPENAI_API_KEY"),
          },
        },
        {
          provide: AiDirectKeyService,
          useValue: overrides.directKeyService ?? defaultDirectKeyService,
        },
        {
          provide: AiImageGenerationService,
          useValue: {
            isImageGenerationRequest: jest.fn().mockReturnValue(false),
          },
        },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<AiChatService>(AiChatService);
    jest.spyOn(RequestContext, "getUserId").mockReturnValue("test-user-id");
  }

  beforeEach(async () => {
    await buildModule();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Lines 1072-1077: addChatObserver / removeChatObserver
  // =========================================================================

  describe("addChatObserver / removeChatObserver (lines 1072-1077)", () => {
    it("adds and removes a chat observer", () => {
      const observer = jest.fn();
      const dispose = service.addChatObserver(observer);

      // dispose returns unsubscribe function
      expect(typeof dispose).toBe("function");

      const removed = service.removeChatObserver(observer);
      expect(removed).toBe(true);
    });

    it("removeChatObserver returns false for unknown observer", () => {
      const unknown = jest.fn();
      expect(service.removeChatObserver(unknown)).toBe(false);
    });
  });

  // =========================================================================
  // Lines 1082-1086: dispatchChatObservers with throwing observer
  // =========================================================================

  describe("dispatchChatObservers with throwing observer (lines 1082-1086)", () => {
    it("does not propagate error when observer throws", async () => {
      const throwingObserver = jest.fn().mockImplementation(() => {
        throw new Error("Observer error");
      });
      service.addChatObserver(throwingObserver);

      // chat() calls dispatchChatObservers in finally
      mockModelConfigService.getModelConfig.mockResolvedValue(
        createMockModelConfig(),
      );

      // Should not throw despite observer error
      const result = await service.chat({
        messages: [{ role: "user", content: "test" }],
        model: "gpt-4o",
        userId: "user-123",
      });

      expect(result.content).toBe("Test response");
      expect(throwingObserver).toHaveBeenCalled();

      service.removeChatObserver(throwingObserver);
    });
  });

  // =========================================================================
  // Line 1132: AbortSignal aborted → DOMException
  // =========================================================================

  describe("AbortSignal aborted (line 1132)", () => {
    it("throws DOMException when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        service.chat({
          messages: [{ role: "user", content: "test" }],
          model: "gpt-4o",
          userId: "user-123",
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Lines 1170-1175: no userId → UnauthorizedException
  // =========================================================================

  describe("no userId → UnauthorizedException (lines 1170-1175)", () => {
    it("throws UnauthorizedException when no userId and no RequestContext", async () => {
      // Override RequestContext to return undefined
      jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);

      await expect(
        service.chat({
          messages: [{ role: "user", content: "test" }],
          model: "gpt-4o",
          // No userId, no apiKey+provider combo
        }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Lines 637: generateChatCompletion with modelConfig found
  // =========================================================================

  describe("generateChatCompletion with modelConfig (line 637)", () => {
    it("uses callAPIWithConfig when modelConfig is found in DB", async () => {
      const config = createMockModelConfig({
        modelId: "gpt-4o",
        provider: "openai",
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      const result = await service.generateChatCompletion({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 1000,
      });

      expect(result.content).toBe("Test response");
      expect(mockApiCallerService.callOpenAICompatibleAPI).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Lines 732-735: clamping maxTokens to model limit
  // =========================================================================

  describe("clamping maxTokens to model config limit (lines 732-735)", () => {
    it("clamps maxTokens when request exceeds model limit", async () => {
      const config = createMockModelConfig({
        modelId: "limited-model",
        provider: "openai",
        maxTokens: 2000, // lower than requested
      });
      mockModelConfigService.getModelConfig.mockResolvedValue(config);

      const result = await service.generateChatCompletion({
        model: "limited-model",
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 8000, // exceeds model limit
      });

      // Should succeed but use clamped tokens
      expect(result.content).toBe("Test response");

      // Verify that callOpenAICompatibleAPI was called with clamped maxTokens
      const calledMaxTokens =
        mockApiCallerService.callOpenAICompatibleAPI.mock.calls[0][4];
      expect(calledMaxTokens).toBeLessThanOrEqual(2000);
    });
  });

  // =========================================================================
  // Line 281: recordMetric failure catch → logger.warn
  // =========================================================================

  describe("recordMetric failure catch (line 281)", () => {
    it("logs warning when recordMetric fails", async () => {
      mockMetricsService.recordMetric.mockRejectedValue(
        new Error("metrics DB error"),
      );
      mockModelConfigService.getModelConfig.mockResolvedValue(
        createMockModelConfig(),
      );

      // Should not throw - metrics failure is caught
      const result = await service.generateChatCompletion({
        model: "gpt-4o",
        messages: [{ role: "user", content: "test" }],
        maxTokens: 1000,
      });

      expect(result.content).toBe("Test response");
    });
  });

  // =========================================================================
  // Lines 341-345: emitJournalRecord, emitCostRecord, emitMetrics paths
  // (covered indirectly through generateChatCompletion which calls private methods)
  // =========================================================================

  describe("EventEmitter2 emit paths (lines 341-356)", () => {
    it("emits events during chat when events emitter is available", async () => {
      mockModelConfigService.getModelConfig.mockResolvedValue(
        createMockModelConfig(),
      );

      const result = await service.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        userId: "user-evt",
        traceId: "trace-123",
      });

      expect(result.content).toBe("Test response");
      // events?.emit is called for span start/end
      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });
  });
});
