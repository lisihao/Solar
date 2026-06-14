import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { AiChatService, ChatResult } from "../ai-chat.service";
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
import { RequestContext } from "@/common/context/request-context";

/**
 * Tests for chat() — the BYOK model-level failover wrapper around chatOnce.
 *
 * chatOnce is PRIVATE — stubbed via jest.spyOn(service as any, "chatOnce") so
 * these tests exercise ONLY the wrapper's failover decision logic, isolated from
 * the (unchanged) inner execution chain.
 */

function modelConfig(overrides: Partial<AIModelConfig> = {}): AIModelConfig {
  return {
    id: "id",
    name: "name",
    displayName: "name",
    provider: "openai",
    modelId: "gpt-4o",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "k",
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

function okResult(model: string): ChatResult {
  return {
    content: "ok",
    model,
    isError: false,
    usage: { totalTokens: 10 },
  };
}

describe("AiChatService.chat() — model-level failover wrapper", () => {
  let service: AiChatService;
  let mockModelConfigService: {
    listUserEnabledModelsByType: jest.Mock;
  } & Record<string, jest.Mock>;

  beforeEach(async () => {
    mockModelConfigService = {
      listUserEnabledModelsByType: jest.fn().mockResolvedValue([]),
      getModelConfig: jest.fn().mockResolvedValue(null),
      getDefaultModelConfig: jest.fn().mockResolvedValue(null),
      getDefaultModelByType: jest.fn().mockResolvedValue(null),
      getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
      resolveApiKey: jest.fn().mockResolvedValue(null),
    };

    const noop = () => undefined;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiChatService,
        { provide: ConfigService, useValue: { get: jest.fn(() => "") } },
        {
          provide: TaskProfileMapperService,
          useValue: { mapToParameters: jest.fn(() => ({})) },
        },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        { provide: AiApiCallerService, useValue: {} },
        { provide: AiStreamHandlerService, useValue: {} },
        { provide: AiChatRetryService, useValue: {} },
        { provide: AIMetricsService, useValue: { recordMetric: noop } },
        { provide: GuardrailsPipelineService, useValue: {} },
        { provide: EntityHealthRegistry, useValue: {} },
        { provide: AiConnectionTestService, useValue: {} },
        { provide: AiModelDiscoveryService, useValue: {} },
        { provide: AiDirectKeyService, useValue: {} },
        { provide: AiImageGenerationService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<AiChatService>(AiChatService);

    // Wrapper resolves userId from options ?? RequestContext.
    jest.spyOn(RequestContext, "getUserId").mockReturnValue("user-1");
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("fails over to the next enabled model when the default provider raises a provider-level error", async () => {
    // First chatOnce (default model) throws a BYOK provider-level error.
    // Second chatOnce (re-elected model) succeeds.
    const chatOnceSpy = jest
      .spyOn(service as unknown as { chatOnce: jest.Mock }, "chatOnce")
      .mockRejectedValueOnce(
        new Error('No API Key available for provider "xai"'),
      )
      .mockResolvedValueOnce(okResult("gpt-4o"));

    // After the xai failure, the next enabled model is an OpenAI one.
    mockModelConfigService.listUserEnabledModelsByType.mockResolvedValueOnce([
      modelConfig({ provider: "openai", modelId: "gpt-4o" }),
    ]);

    const result = await service.chat({
      messages: [{ role: "user", content: "hi" }],
      modelType: AIModelType.CHAT,
    });

    expect(result.content).toBe("ok");
    expect(chatOnceSpy).toHaveBeenCalledTimes(2);

    // Second chatOnce must use the re-elected model.
    const secondCallArgs = chatOnceSpy.mock.calls[1][0] as { model?: string };
    expect(secondCallArgs.model).toBe("gpt-4o");

    // The failed provider ("xai") must be excluded when re-electing.
    expect(
      mockModelConfigService.listUserEnabledModelsByType,
    ).toHaveBeenCalledTimes(1);
    const electionArgs =
      mockModelConfigService.listUserEnabledModelsByType.mock.calls[0];
    expect(electionArgs[0]).toBe("user-1");
    expect(electionArgs[1]).toBe(AIModelType.CHAT);
    const excludeProviders = electionArgs[3] as string[];
    expect(excludeProviders).toContain("xai");
  });

  it("does NOT failover (calls chatOnce once) when caller explicitly specifies model", async () => {
    const chatOnceSpy = jest
      .spyOn(service as unknown as { chatOnce: jest.Mock }, "chatOnce")
      .mockResolvedValue(okResult("gpt-4o"));

    const result = await service.chat({
      messages: [{ role: "user", content: "hi" }],
      modelType: AIModelType.CHAT,
      model: "gpt-4o",
    });

    expect(result.content).toBe("ok");
    expect(chatOnceSpy).toHaveBeenCalledTimes(1);
    // No re-election when model is pinned by caller.
    expect(
      mockModelConfigService.listUserEnabledModelsByType,
    ).not.toHaveBeenCalled();
  });

  it("does NOT failover (calls chatOnce once) when there is no userId", async () => {
    jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);

    const chatOnceSpy = jest
      .spyOn(service as unknown as { chatOnce: jest.Mock }, "chatOnce")
      .mockResolvedValue(okResult("gpt-4o"));

    const result = await service.chat({
      messages: [{ role: "user", content: "hi" }],
      modelType: AIModelType.CHAT,
    });

    expect(result.content).toBe("ok");
    expect(chatOnceSpy).toHaveBeenCalledTimes(1);
    expect(
      mockModelConfigService.listUserEnabledModelsByType,
    ).not.toHaveBeenCalled();
  });

  it("does NOT failover on a guardrail soft-error (returns it as-is)", async () => {
    const guardrailResult: ChatResult = {
      content: "Request blocked by content safety guardrail: policy-violation",
      model: "gpt-4o",
      isError: true,
    };

    const chatOnceSpy = jest
      .spyOn(service as unknown as { chatOnce: jest.Mock }, "chatOnce")
      .mockResolvedValue(guardrailResult);

    const result = await service.chat({
      messages: [{ role: "user", content: "hi" }],
      modelType: AIModelType.CHAT,
    });

    expect(result).toBe(guardrailResult);
    expect(chatOnceSpy).toHaveBeenCalledTimes(1);
    expect(
      mockModelConfigService.listUserEnabledModelsByType,
    ).not.toHaveBeenCalled();
  });

  it("re-throws the provider error when no alternative model is available", async () => {
    const chatOnceSpy = jest
      .spyOn(service as unknown as { chatOnce: jest.Mock }, "chatOnce")
      .mockRejectedValue(new Error('No API Key available for provider "xai"'));

    // No alternative models for the user.
    mockModelConfigService.listUserEnabledModelsByType.mockResolvedValue([]);

    await expect(
      service.chat({
        messages: [{ role: "user", content: "hi" }],
        modelType: AIModelType.CHAT,
      }),
    ).rejects.toThrow('No API Key available for provider "xai"');

    // chatOnce tried once; election returned nothing → no retry.
    expect(chatOnceSpy).toHaveBeenCalledTimes(1);
  });
});
