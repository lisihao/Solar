/**
 * ModelResolverService — supplement branch coverage spec
 *
 * Targets uncovered branches:
 *   - selectModel(): availableProviders filter → no matching providers → return null
 *   - selectModel(): availableProviders filter → filters correctly
 *   - getModelById(): isReasoning ?? false (model has no isReasoning field)
 *   - getModelById(): apiKey null path (resolveApiKey returns null)
 *   - getFullModelConfig(): id || modelId (id missing → uses modelId)
 *   - getFullModelConfig(): various nullish coalescing for optional fields
 *   - getDefaultModelByType(): returns null when config is null
 *   - getAvailableModelsExtended(): displayName || modelId fallback (no displayName)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ModelResolverService } from "../model-resolver.service";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
import { ModelFallbackService } from "../../../ai-engine/llm/models/selection/model-fallback.service";
import { ORCHESTRATION_FEATURE } from "../facade.providers";

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
];

async function makeService(overrides?: {
  isModelBlocked?: (id: string) => boolean;
  resolveApiKey?: (
    model: Record<string, unknown>,
  ) => Promise<{ apiKey: string; source: string } | null>;
}) {
  const mockAiChatService = {
    isReasoningModel: jest.fn().mockReturnValue(false),
    getDefaultModelByType: jest.fn().mockResolvedValue(MOCK_MODELS[0]),
  };

  const mockModelConfigService = {
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
    getModelById: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(
          MOCK_MODELS.find((m) => m.modelId === id || m.id === id) || null,
        ),
      ),
    resolveApiKey:
      overrides?.resolveApiKey ??
      jest
        .fn()
        .mockImplementation((model: { apiKey?: string }) =>
          Promise.resolve(
            model?.apiKey ? { apiKey: model.apiKey, source: "system" } : null,
          ),
        ),
  };

  const mockFallbackService = {
    isModelBlocked:
      overrides?.isModelBlocked ?? jest.fn().mockReturnValue(false),
  };

  const mockOrchestration = {
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
      { provide: ORCHESTRATION_FEATURE, useValue: mockOrchestration },
    ],
  }).compile();

  return {
    service: module.get<ModelResolverService>(ModelResolverService),
    mockAiChatService,
    mockModelConfigService,
    mockFallbackService,
    mockOrchestration,
  };
}

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ─── availableProviders filter ─────────────────────────────────────────────────

describe("ModelResolverService supplement — availableProviders", () => {
  it("returns null when availableProviders does not match any model", async () => {
    const { service } = await makeService();
    const result = await service.selectModel({
      availableProviders: ["azure"], // No models from azure
    });
    expect(result).toBeNull();
  });

  it("filters models to only matching providers", async () => {
    const { service } = await makeService();
    const result = await service.selectModel({
      availableProviders: ["anthropic"],
    });
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("anthropic");
  });

  it("is case-insensitive for availableProviders", async () => {
    const { service } = await makeService();
    const result = await service.selectModel({
      availableProviders: ["OPENAI"],
    });
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("openai");
  });

  it("works with empty availableProviders array → no filtering (undefined-like behavior)", async () => {
    const { service } = await makeService();
    // With availableProviders=[] (empty), allowed set is empty → filtered will be empty → return null
    const result = await service.selectModel({
      availableProviders: [],
    });
    // Empty available providers means no match → null
    expect(result).toBeNull();
  });
});

// 2026-05-12 BYOK fix: auto-resolve availableProviders from RequestContext.userId
//   when caller didn't pass explicit BYOK provider filter. Avoids silent admin
//   model selection in topic-insights / ai-harness/evaluation / team-factory
//   selectModel callers that all skip the filter.
describe("ModelResolverService — auto BYOK from RequestContext", () => {
  // 用 RequestContext.run 包装来注入 userId（与 prod 路径一致）
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    RequestContext,
  } = require("../../../../common/context/request-context");

  it("auto-resolves healthy providers from RequestContext.userId when not explicitly set", async () => {
    const getHealthyProviders = jest.fn().mockResolvedValue(["anthropic"]);
    const keyResolver = { getHealthyProviders };

    const mockAiChatService = {
      isReasoningModel: jest.fn().mockReturnValue(false),
    };
    const mockModelConfigService = {
      getAllEnabledModelsByType: jest.fn().mockResolvedValue([
        { id: "gpt-4o", modelId: "gpt-4o", name: "GPT-4o", provider: "openai" },
        {
          id: "claude-sonnet",
          modelId: "claude-sonnet",
          name: "Claude",
          provider: "anthropic",
        },
      ]),
    };
    const mockFallback = { isModelBlocked: jest.fn().mockReturnValue(false) };
    const mockOrchestration = {
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
        { provide: ModelFallbackService, useValue: mockFallback },
        { provide: ORCHESTRATION_FEATURE, useValue: mockOrchestration },
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        {
          provide:
            require("../../../platform/credentials/resolution/key-resolver/key-resolver.service")
              .KeyResolverService,
          useValue: keyResolver,
        },
      ],
    }).compile();
    const service = module.get<ModelResolverService>(ModelResolverService);

    // caller 不传 availableProviders；RequestContext 注入 userId
    const result = await RequestContext.run({ userId: "user-1" }, () =>
      service.selectModel({}),
    );

    expect(getHealthyProviders).toHaveBeenCalledWith("user-1");
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("anthropic"); // openai 被剔除
  });

  it("does not invoke keyResolver when caller passes explicit availableProviders", async () => {
    const getHealthyProviders = jest.fn();
    const keyResolver = { getHealthyProviders };

    const mockAiChatService = {
      isReasoningModel: jest.fn().mockReturnValue(false),
    };
    const mockModelConfigService = {
      getAllEnabledModelsByType: jest.fn().mockResolvedValue([
        {
          id: "gpt-4o",
          modelId: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
        },
      ]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelResolverService,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        {
          provide: ModelFallbackService,
          useValue: { isModelBlocked: jest.fn().mockReturnValue(false) },
        },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: {
            circuitBreaker: {
              canExecute: jest.fn().mockReturnValue(true),
              selectBest: jest.fn().mockReturnValue(null),
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        {
          provide:
            require("../../../platform/credentials/resolution/key-resolver/key-resolver.service")
              .KeyResolverService,
          useValue: keyResolver,
        },
      ],
    }).compile();
    const service = module.get<ModelResolverService>(ModelResolverService);

    await RequestContext.run({ userId: "user-1" }, () =>
      service.selectModel({ availableProviders: ["openai"] }),
    );

    // caller 显式给了，不再调 getHealthyProviders
    expect(getHealthyProviders).not.toHaveBeenCalled();
  });

  it("falls through to admin pool when no userId in RequestContext", async () => {
    const getHealthyProviders = jest.fn();
    const keyResolver = { getHealthyProviders };

    const mockAiChatService = {
      isReasoningModel: jest.fn().mockReturnValue(false),
    };
    const mockModelConfigService = {
      getAllEnabledModelsByType: jest.fn().mockResolvedValue([
        {
          id: "gpt-4o",
          modelId: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
        },
      ]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelResolverService,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        {
          provide: ModelFallbackService,
          useValue: { isModelBlocked: jest.fn().mockReturnValue(false) },
        },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: {
            circuitBreaker: {
              canExecute: jest.fn().mockReturnValue(true),
              selectBest: jest.fn().mockReturnValue(null),
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        {
          provide:
            require("../../../platform/credentials/resolution/key-resolver/key-resolver.service")
              .KeyResolverService,
          useValue: keyResolver,
        },
      ],
    }).compile();
    const service = module.get<ModelResolverService>(ModelResolverService);

    // 无 RequestContext.userId（cron / 系统任务）
    const result = await service.selectModel({});

    expect(getHealthyProviders).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("openai");
  });
});

// ─── getModelById with no isReasoning / no apiKey ────────────────────────────

describe("ModelResolverService supplement — getModelById edge cases", () => {
  it("returns isReasoning=false when model has no isReasoning field", async () => {
    const { service, mockModelConfigService } = await makeService();
    mockModelConfigService.getModelById.mockResolvedValue({
      id: "db-1",
      modelId: "gpt-4o",
      displayName: "GPT-4o",
      provider: "openai",
      // isReasoning: undefined (not set)
    });
    mockModelConfigService.resolveApiKey.mockResolvedValue({
      apiKey: "sk-xxx",
      source: "system",
    });

    const result = await service.getModelById("gpt-4o");
    expect(result!.isReasoning).toBe(false);
  });

  it("returns apiKey=null when resolveApiKey returns null", async () => {
    const { service } = await makeService({
      resolveApiKey: jest.fn().mockResolvedValue(null),
    });
    const result = await service.getModelById("gpt-4o");
    expect(result!.apiKey).toBeNull();
  });
});

// ─── getFullModelConfig nullish coalescing branches ──────────────────────────

describe("ModelResolverService supplement — getFullModelConfig branches", () => {
  it("uses modelId as id when model has no id field", async () => {
    const { service, mockModelConfigService } = await makeService();
    mockModelConfigService.getModelById.mockResolvedValue({
      // No id field
      modelId: "test-model",
      provider: "test",
    });
    mockModelConfigService.resolveApiKey.mockResolvedValue(null);

    const result = await service.getFullModelConfig("test-model");
    expect(result!.id).toBe("test-model"); // Falls back to modelId
  });

  it("returns empty apiKey when resolveApiKey returns null", async () => {
    const { service } = await makeService({
      resolveApiKey: jest.fn().mockResolvedValue(null),
    });
    const result = await service.getFullModelConfig("gpt-4o");
    expect(result!.apiKey).toBe("");
  });

  it("returns null for secretKey when not set on model", async () => {
    const { service, mockModelConfigService } = await makeService();
    mockModelConfigService.getModelById.mockResolvedValue({
      id: "db-1",
      modelId: "gpt-4o",
      provider: "openai",
      // secretKey: undefined
    });
    mockModelConfigService.resolveApiKey.mockResolvedValue(null);

    const result = await service.getFullModelConfig("gpt-4o");
    expect(result!.secretKey).toBeNull();
  });
});

// ─── getDefaultModelByType null path ────────────────────────────────────────

describe("ModelResolverService supplement — getDefaultModelByType null", () => {
  it("returns null when aiChatService.getDefaultModelByType returns null", async () => {
    const { service, mockAiChatService } = await makeService();
    mockAiChatService.getDefaultModelByType.mockResolvedValue(null);

    const result = await service.getDefaultImageModel();
    expect(result).toBeNull();
  });
});

// ─── getAvailableModelsExtended: displayName fallback to modelId ─────────────

describe("ModelResolverService supplement — getAvailableModelsExtended displayName fallback", () => {
  it("uses modelId as name when displayName is absent", async () => {
    const { service, mockModelConfigService } = await makeService();
    mockModelConfigService.getAllEnabledModelsByType.mockResolvedValue([
      {
        id: "db-1",
        modelId: "gpt-4o",
        // displayName: undefined
        provider: "openai",
        isReasoning: false,
        isEnabled: true,
        isDefault: true,
        maxTokens: 4096,
      },
    ]);

    const result = await service.getAvailableModelsExtended();
    expect(result[0].name).toBe("gpt-4o"); // Falls back to modelId
  });
});
