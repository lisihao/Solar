/**
 * AIFacade - Supplemental tests
 *
 * Covers additional uncovered paths in ai-engine.facade.ts:
 * - chat() with model fallback service
 * - chat() model type resolution from modelType param
 * - chatWithFallback() success and all-models-failed paths
 * - getDefaultTextModel() / getDefaultImageModel()
 * - getModelById() / getDefaultModelByType() / getFullModelConfig()
 * - executeSkill() — with and without setLLMAdapter
 * - resolveSkillInputBindings() — PromptSkillAdapter vs plain ISkill
 * - buildContext() — topic/resource/memory source types, token compression
 * - checkConstraints() — custom content filter rules, invalid regex
 * - search() — ToolRegistry unavailable path
 */

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  },
  ...jest.requireActual("@prisma/client"),
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    IMAGE_GENERATION: "IMAGE_GENERATION",
    IMAGE_EDITING: "IMAGE_EDITING",
    MULTIMODAL: "MULTIMODAL",
    EMBEDDING: "EMBEDDING",
    RERANK: "RERANK",
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AIFacade } from "../ai.facade";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
import { AIModelType } from "@prisma/client";
import {
  ORCHESTRATION_FEATURE,
  MEMORY_FEATURE,
  TOOL_FEATURE,
  SKILL_FEATURE,
} from "../facade.providers";

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────

function makeMockAiChatService(overrides: Record<string, unknown> = {}) {
  return {
    chat: jest.fn().mockResolvedValue({
      content: "Hello world",
      model: "gpt-4o",
      usage: { totalTokens: 100 },
      isError: false,
      apiKeySource: "system",
    }),
    chatStream: jest.fn().mockImplementation(async function* () {
      yield { content: "chunk", done: true, tokensUsed: 50 };
    }),
    getAvailableModelsAsync: jest.fn().mockResolvedValue(["gpt-4o"]),
    isReasoningModel: jest.fn().mockReturnValue(false),
    getDefaultModelByType: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeMockModelConfigService(overrides: Record<string, unknown> = {}) {
  return {
    getDefaultModel: jest.fn().mockResolvedValue(null),
    getModelById: jest.fn().mockResolvedValue(null),
    resolveApiKey: jest
      .fn()
      .mockImplementation((model: { apiKey?: string }) =>
        Promise.resolve(
          model?.apiKey ? { apiKey: model.apiKey, source: "system" } : null,
        ),
      ),
    refreshModelConfigCache: jest.fn(),
    getEnabledModelsForFrontend: jest.fn().mockResolvedValue([
      {
        id: "db-gpt4o",
        modelId: "gpt-4o",
        name: "GPT-4o",
        displayName: "GPT-4o",
        provider: "openai",
      },
    ]),
    getAllEnabledModelsByType: jest.fn().mockResolvedValue([
      {
        id: "db-gpt4o",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        isReasoning: false,
        maxTokens: 8000,
      },
    ]),
    ...overrides,
  };
}

function makeMockCircuitBreaker() {
  return {
    canExecute: jest.fn().mockReturnValue(true),
    getCooldownRemaining: jest.fn().mockReturnValue(0),
    incrementLoad: jest.fn(),
    decrementLoad: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    parseErrorType: jest.fn().mockReturnValue("API_ERROR"),
    selectBest: jest.fn().mockReturnValue(null),
  };
}

async function buildFacade(
  extraProviders: Array<{ provide: unknown; useValue: unknown }> = [],
  chatServiceOverrides: Record<string, unknown> = {},
  modelConfigOverrides: Record<string, unknown> = {},
): Promise<{
  facade: AIFacade;
  mockChat: jest.Mock;
  mockCircuitBreaker: ReturnType<typeof makeMockCircuitBreaker>;
}> {
  const mockChat = makeMockAiChatService(chatServiceOverrides);
  const mockCircuitBreaker = makeMockCircuitBreaker();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AIFacade,
      { provide: AiChatService, useValue: mockChat },
      {
        provide: AiModelConfigService,
        useValue: makeMockModelConfigService(modelConfigOverrides),
      },
      {
        provide: ORCHESTRATION_FEATURE,
        useValue: { circuitBreaker: mockCircuitBreaker, agentExecutor: null },
      },
      ...extraProviders,
    ],
  }).compile();

  jest.spyOn(Logger.prototype, "log").mockImplementation();
  jest.spyOn(Logger.prototype, "warn").mockImplementation();
  jest.spyOn(Logger.prototype, "error").mockImplementation();
  jest.spyOn(Logger.prototype, "debug").mockImplementation();

  return {
    facade: module.get<AIFacade>(AIFacade),
    mockChat,
    mockCircuitBreaker,
  };
}

// ─────────────────────────────────────────────────────────────
// chat() — model resolution from modelType
// ─────────────────────────────────────────────────────────────

describe("AIFacade — chat() model resolution", () => {
  afterEach(() => jest.restoreAllMocks());

  it("resolves modelId from request.model when provided", async () => {
    const { facade, mockChat } = await buildFacade();

    await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
      model: "claude-3-opus",
    });

    expect(mockChat.chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-3-opus" }),
    );
  });

  it("resolves modelId from modelType when request.model is absent", async () => {
    const mockGetDefault = jest
      .fn()
      .mockResolvedValue({ modelId: "gemini-flash" });
    const { facade, mockChat } = await buildFacade([], {
      getDefaultModelByType: mockGetDefault,
    });

    await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
      modelType: AIModelType.CHAT_FAST,
    });

    expect(mockGetDefault).toHaveBeenCalledWith(AIModelType.CHAT_FAST);
    expect(mockChat.chat).toHaveBeenCalled();
  });

  it("falls back to 'default' when neither model nor modelType resolves", async () => {
    const { facade, mockChat } = await buildFacade([], {
      getDefaultModelByType: jest.fn().mockResolvedValue(null),
    });

    await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
      modelType: AIModelType.CHAT,
    });

    // model passed to aiChatService.chat should be request.model which is undefined → falls to 'default'
    expect(mockChat.chat).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// chat() — ModelFallbackService path
// ─────────────────────────────────────────────────────────────

describe("AIFacade — chat() with ModelFallbackService", () => {
  afterEach(() => jest.restoreAllMocks());

  it("uses fallback service when available and returns success result", async () => {
    const mockFallbackExecute = jest.fn().mockResolvedValue({
      success: true,
      fallbackUsed: false,
      attemptedModels: ["gpt-4o"],
      attempts: 1,
      modelUsed: "gpt-4o",
      data: {
        content: "Fallback path response",
        model: "gpt-4o",
        usage: { totalTokens: 80 },
        isError: false,
        apiKeySource: "system",
      },
    });

    const mockFallbackService = { executeWithFallback: mockFallbackExecute };

    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        {
          provide: AiChatService,
          useValue: makeMockAiChatService(),
        },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: {
            circuitBreaker: makeMockCircuitBreaker(),
            agentExecutor: null,
          },
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);
    // Inject modelFallbackService via private field
    (facade as unknown as Record<string, unknown>)["modelFallbackService"] =
      mockFallbackService;

    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
    });

    expect(result.content).toBe("Fallback path response");
    expect(result.isError).toBe(false);
    expect(mockFallbackExecute).toHaveBeenCalled();
  });

  it("returns error when all fallback models fail and not in strict mode", async () => {
    const mockFallbackExecute = jest.fn().mockResolvedValue({
      success: false,
      fallbackUsed: true,
      attemptedModels: ["gpt-4o", "claude-3"],
      attempts: 2,
      modelUsed: "gpt-4o",
      error: new Error("All providers down"),
      data: null,
    });

    const mockFallbackService = { executeWithFallback: mockFallbackExecute };

    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);
    (facade as unknown as Record<string, unknown>)["modelFallbackService"] =
      mockFallbackService;

    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("All providers down");
  });

  it("throws when all fallback models fail in strict mode", async () => {
    const mockFallbackExecute = jest.fn().mockResolvedValue({
      success: false,
      fallbackUsed: true,
      attemptedModels: ["gpt-4o"],
      attempts: 1,
      error: new Error("Fatal error"),
      data: null,
    });

    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);
    (facade as unknown as Record<string, unknown>)["modelFallbackService"] = {
      executeWithFallback: mockFallbackExecute,
    };

    await expect(
      facade.chat({
        messages: [{ role: "user", content: "Test" }],
        strictMode: true,
      }),
    ).rejects.toThrow("Fatal error");
  });
});

// ─────────────────────────────────────────────────────────────
// getDefaultTextModel / getDefaultImageModel / getModelById / getDefaultModelByType
// ─────────────────────────────────────────────────────────────

describe("AIFacade — model info getters", () => {
  afterEach(() => jest.restoreAllMocks());

  it("getDefaultTextModel returns null when no default CHAT model", async () => {
    const { facade } = await buildFacade(
      [],
      {},
      { getAllEnabledModelsByType: jest.fn().mockResolvedValue([]) },
    );

    const result = await facade.getDefaultTextModel();
    expect(result).toBeNull();
  });

  it("getDefaultTextModel returns model when available", async () => {
    const modelConfig = {
      id: "db-id",
      modelId: "gpt-4o",
      displayName: "GPT-4o",
      provider: "openai",
      maxTokens: 8000,
    };
    // getDefaultTextModel delegates to aiChatService.getDefaultModelByType(CHAT)
    const { facade } = await buildFacade([], {
      getDefaultModelByType: jest.fn().mockResolvedValue(modelConfig),
    });

    const result = await facade.getDefaultTextModel();
    expect(result).not.toBeNull();
    expect(result?.modelId).toBe("gpt-4o");
  });

  it("getDefaultImageModel returns null when no IMAGE_GENERATION model", async () => {
    const { facade } = await buildFacade(
      [],
      {},
      { getAllEnabledModelsByType: jest.fn().mockResolvedValue([]) },
    );

    const result = await facade.getDefaultImageModel();
    expect(result).toBeNull();
  });

  it("getModelById returns null when model not found", async () => {
    const { facade } = await buildFacade(
      [],
      {},
      {
        getModelById: jest.fn().mockResolvedValue(null),
        getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
      },
    );

    const result = await facade.getModelById("nonexistent");
    expect(result).toBeNull();
  });

  it("getModelById returns model when found by modelId", async () => {
    const model = {
      id: "db-id",
      modelId: "gpt-4o",
      displayName: "GPT-4o",
      name: "GPT-4o",
      provider: "openai",
      maxTokens: 8000,
      apiKey: "sk-test",
      secretKey: null,
      apiEndpoint: null,
      isReasoning: false,
      modelType: "CHAT",
    };
    const { facade } = await buildFacade(
      [],
      {},
      {
        getModelById: jest.fn().mockResolvedValue(model),
      },
    );

    const result = await facade.getModelById("gpt-4o");
    expect(result).not.toBeNull();
    expect(result?.modelId).toBe("gpt-4o");
  });

  it("getDefaultModelByType returns null when no model of that type", async () => {
    const { facade } = await buildFacade(
      [],
      {},
      { getAllEnabledModelsByType: jest.fn().mockResolvedValue([]) },
    );

    const result = await facade.getDefaultModelByType(AIModelType.EMBEDDING);
    expect(result).toBeNull();
  });

  it("getDefaultModelByType returns model when found", async () => {
    const modelConfig = {
      id: "emb-id",
      modelId: "text-embedding-3-small",
      displayName: "Embedding",
      provider: "openai",
      maxTokens: 8000,
    };
    // getDefaultModelByType delegates to aiChatService.getDefaultModelByType(modelType)
    const { facade } = await buildFacade([], {
      getDefaultModelByType: jest.fn().mockResolvedValue(modelConfig),
    });

    const result = await facade.getDefaultModelByType(AIModelType.EMBEDDING);
    expect(result).not.toBeNull();
    expect(result?.modelId).toBe("text-embedding-3-small");
  });
});

// ─────────────────────────────────────────────────────────────
// executeSkill()
// ─────────────────────────────────────────────────────────────

describe("AIFacade — executeSkill()", () => {
  afterEach(() => jest.restoreAllMocks());

  it("calls skill.execute with input and context", async () => {
    const { facade } = await buildFacade();
    const mockSkill = {
      execute: jest.fn().mockResolvedValue({ success: true, data: "done" }),
    };
    const context = {
      executionId: "exec-1",
      skillId: "my-skill",
      createdAt: new Date(),
    };

    const result = await facade.executeSkill(
      mockSkill as unknown as import("../../skills/abstractions/skill.interface").ISkill,
      { input: "data" },
      context as unknown as import("../../skills/abstractions/skill.interface").SkillContext,
    );

    expect(mockSkill.execute).toHaveBeenCalledWith({ input: "data" }, context);
    expect(result).toEqual({ success: true, data: "done" });
  });

  it("injects llmAdapter when skill exposes setLLMAdapter and adapter is available", async () => {
    const mockLLMAdapter = { chat: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
        {
          provide: SKILL_FEATURE,
          useValue: {
            loader: null,
            promptBuilder: null,
            llmAdapter: mockLLMAdapter,
          },
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);

    const setLLMAdapter = jest.fn();
    const mockSkill = {
      setLLMAdapter,
      execute: jest.fn().mockResolvedValue({ success: true }),
    };

    await facade.executeSkill(
      mockSkill as unknown as import("../../skills/abstractions/skill.interface").ISkill,
      {},
      {
        executionId: "exec-2",
        skillId: "code-skill",
        createdAt: new Date(),
      } as unknown as import("../../skills/abstractions/skill.interface").SkillContext,
    );

    expect(setLLMAdapter).toHaveBeenCalledWith(mockLLMAdapter);
    expect(mockSkill.execute).toHaveBeenCalled();
  });

  it("warns but does not throw when skill has setLLMAdapter but no adapter injected", async () => {
    const { facade } = await buildFacade();

    const setLLMAdapter = jest.fn();
    const mockSkill = {
      setLLMAdapter,
      execute: jest.fn().mockResolvedValue({ success: true }),
    };

    // llmAdapterForSkills is not injected (undefined by default)
    const result = await facade.executeSkill(
      mockSkill as unknown as import("../../skills/abstractions/skill.interface").ISkill,
      {},
      {
        executionId: "exec-3",
        skillId: "code-skill",
        createdAt: new Date(),
      } as unknown as import("../../skills/abstractions/skill.interface").SkillContext,
    );

    expect(setLLMAdapter).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// resolveSkillInputBindings()
// ─────────────────────────────────────────────────────────────

describe("AIFacade — resolveSkillInputBindings()", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns null for non-PromptSkillAdapter skills", async () => {
    const { facade } = await buildFacade();

    const plainSkill = {
      execute: jest.fn(),
      isPromptSkillAdapter: false,
    };

    const result = facade.resolveSkillInputBindings(
      plainSkill as unknown as import("../../skills/abstractions/skill.interface").ISkill,
      {
        variables: {},
      } as unknown as import("../../skills/integration/input-binding-resolver").BindingContext,
    );

    expect(result).toBeNull();
  });

  it("returns null when bindings are not defined", async () => {
    const { facade } = await buildFacade();

    const adapter = {
      execute: jest.fn(),
      isPromptSkillAdapter: true,
      getInputBindings: jest.fn().mockReturnValue(null),
    };

    const result = facade.resolveSkillInputBindings(
      adapter as unknown as import("../../skills/abstractions/skill.interface").ISkill,
      {
        variables: {},
      } as unknown as import("../../skills/integration/input-binding-resolver").BindingContext,
    );

    expect(result).toBeNull();
  });

  it("resolves bindings when adapter and resolver are available", async () => {
    const mockResolver = {
      resolve: jest.fn().mockReturnValue({ field1: "resolved-value" }),
    };

    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
        {
          provide: SKILL_FEATURE,
          useValue: {
            loader: null,
            promptBuilder: null,
            inputBindingResolver: mockResolver,
          },
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);

    const adapter = {
      execute: jest.fn(),
      isPromptSkillAdapter: true,
      getInputBindings: jest
        .fn()
        .mockReturnValue([{ field: "field1", source: "context.x" }]),
    };

    const result = facade.resolveSkillInputBindings(
      adapter as unknown as import("../../skills/abstractions/skill.interface").ISkill,
      {
        variables: { x: "value" },
      } as unknown as import("../../skills/integration/input-binding-resolver").BindingContext,
    );

    expect(mockResolver.resolve).toHaveBeenCalled();
    expect(result).toEqual({ field1: "resolved-value" });
  });
});

// ─────────────────────────────────────────────────────────────
// buildContext() — topic, resource, memory, compression
// ─────────────────────────────────────────────────────────────

describe("AIFacade — buildContext()", () => {
  afterEach(() => jest.restoreAllMocks());

  it("builds context from custom source", async () => {
    const { facade } = await buildFacade();

    const ctx = await facade.buildContext({
      sources: [{ type: "custom", content: "Custom text" }],
    });

    expect(ctx).toContain("Custom text");
  });

  it("builds context from topic source with pre-loaded data", async () => {
    const { facade } = await buildFacade();

    const ctx = await facade.buildContext({
      sources: [
        {
          type: "topic",
          data: {
            name: "AI Research",
            type: "technology",
            description: "Deep learning trends",
            dimensions: [{ name: "NLP", description: "Language processing" }],
          },
        },
      ],
    });

    expect(ctx).toContain("AI Research");
    expect(ctx).toContain("Deep learning trends");
    expect(ctx).toContain("NLP");
  });

  it("builds context from topic source with just a name (no description/dimensions)", async () => {
    const { facade } = await buildFacade();

    const ctx = await facade.buildContext({
      sources: [
        {
          type: "topic",
          data: { name: "Simple Topic", type: "general" },
        },
      ],
    });

    expect(ctx).toContain("Simple Topic");
  });

  it("builds context from resource source with pre-loaded data", async () => {
    const { facade } = await buildFacade();

    const ctx = await facade.buildContext({
      sources: [
        {
          type: "resource",
          data: {
            title: "Research Paper",
            aiSummary: "AI summary here",
            content: "Full content text",
          },
        },
      ],
    });

    expect(ctx).toContain("Research Paper");
    expect(ctx).toContain("AI summary here");
    expect(ctx).toContain("Full content text");
  });

  it("truncates long resource content to 2000 chars", async () => {
    const { facade } = await buildFacade();

    const longContent = "x".repeat(3000);
    const ctx = await facade.buildContext({
      sources: [
        {
          type: "resource",
          data: { title: "Doc", content: longContent },
        },
      ],
    });

    expect(ctx).toContain("...");
    // Should contain the truncated part (2000 chars) + "..."
    expect(ctx.length).toBeLessThan(longContent.length + 200);
  });

  it("uses Prisma for topic when id provided without data (deprecated path)", async () => {
    const mockPrisma = {
      researchTopic: {
        findUnique: jest.fn().mockResolvedValue({
          name: "DB Topic",
          type: "research",
          description: "from DB",
          dimensions: [],
        }),
      },
      resource: { findUnique: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);
    (facade as unknown as Record<string, unknown>)["prisma"] = mockPrisma;

    const ctx = await facade.buildContext({
      sources: [{ type: "topic", id: "topic-db-id" }],
    });

    expect(mockPrisma.researchTopic.findUnique).toHaveBeenCalled();
    expect(ctx).toContain("DB Topic");
  });

  it("uses Prisma for resource when id provided without data (deprecated path)", async () => {
    const mockPrisma = {
      researchTopic: { findUnique: jest.fn() },
      resource: {
        findUnique: jest.fn().mockResolvedValue({
          title: "DB Resource",
          aiSummary: "DB summary",
          content: "DB content",
        }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);
    (facade as unknown as Record<string, unknown>)["prisma"] = mockPrisma;

    const ctx = await facade.buildContext({
      sources: [{ type: "resource", id: "resource-db-id" }],
    });

    expect(mockPrisma.resource.findUnique).toHaveBeenCalled();
    expect(ctx).toContain("DB Resource");
  });

  it("builds context from memory source using shortTerm memory", async () => {
    const mockShortTermMemory = {
      getWithSession: jest
        .fn()
        .mockResolvedValue("Previous conversation state"),
    };

    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
        {
          provide: MEMORY_FEATURE,
          useValue: { shortTerm: mockShortTermMemory, longTerm: null },
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);

    const ctx = await facade.buildContext({
      sources: [{ type: "memory", id: "session-abc" }],
    });

    expect(mockShortTermMemory.getWithSession).toHaveBeenCalledWith(
      "session-abc",
      "context",
    );
    expect(ctx).toContain("Previous conversation state");
  });

  it("compresses context when maxTokens and compress are set", async () => {
    const { facade } = await buildFacade();

    // Create a long context that exceeds maxTokens
    const longContent = "word ".repeat(2000); // ~10000 chars → ~2500 tokens

    const ctx = await facade.buildContext({
      sources: [{ type: "custom", content: longContent }],
      maxTokens: 100,
      compress: true,
    });

    expect(ctx).toContain("content compressed");
  });

  it("does not compress when compress flag is false", async () => {
    const { facade } = await buildFacade();

    const longContent = "word ".repeat(2000);

    const ctx = await facade.buildContext({
      sources: [{ type: "custom", content: longContent }],
      maxTokens: 10,
      compress: false,
    });

    // Should NOT be compressed
    expect(ctx).not.toContain("content compressed");
    expect(ctx.length).toBeGreaterThan(longContent.length - 100);
  });

  it("handles default case (unknown source type) by using content", async () => {
    const { facade } = await buildFacade();

    const ctx = await facade.buildContext({
      sources: [
        { type: "unknown-type" as "custom", content: "fallback content" },
      ],
    });

    expect(ctx).toContain("fallback content");
  });
});

// ─────────────────────────────────────────────────────────────
// checkConstraints() — custom rules and invalid regex
// ─────────────────────────────────────────────────────────────

describe("AIFacade — checkConstraints() edge cases", () => {
  afterEach(() => jest.restoreAllMocks());

  it("detects custom content filter rule violations", async () => {
    const { facade } = await buildFacade();

    const result = facade.checkConstraints({
      content: "This contains FORBIDDEN_WORD in text",
      constraints: {
        contentFilter: {
          enabled: true,
          rules: ["FORBIDDEN_WORD"],
        },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: "content_filter" }),
    );
  });

  it("skips invalid regex rules without throwing", async () => {
    const { facade } = await buildFacade();

    // Invalid regex should not crash
    const result = facade.checkConstraints({
      content: "Normal content",
      constraints: {
        contentFilter: {
          enabled: true,
          rules: ["[invalid regex"],
        },
      },
    });

    // Invalid regex is skipped — no false positive violation
    expect(result.passed).toBe(true);
  });

  it("provides adjustedContent when token limit violated", async () => {
    const { facade } = await buildFacade();

    const longContent = "a".repeat(10000);
    const result = facade.checkConstraints({
      content: longContent,
      constraints: { maxTokens: 50 },
    });

    expect(result.passed).toBe(false);
    expect(result.adjustedContent).toBeDefined();
    expect(result.adjustedContent).toContain("content compressed");
  });

  it("marks content as invalid JSON when jsonSchema check and content is not JSON", async () => {
    const { facade } = await buildFacade();

    const result = facade.checkConstraints({
      content: "Not a JSON string",
      constraints: {
        jsonSchema: { type: "object", required: ["name"] },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        type: "json_schema",
        message: expect.stringContaining("not valid JSON"),
      }),
    );
  });

  it("passes when JSON schema validation succeeds", async () => {
    const { facade } = await buildFacade();

    const result = facade.checkConstraints({
      content: '{"name": "Alice", "age": 30}',
      constraints: {
        jsonSchema: { type: "object", required: ["name", "age"] },
      },
    });

    expect(result.passed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// search() — ToolRegistry not available
// ─────────────────────────────────────────────────────────────

describe("AIFacade — search() without ToolRegistry", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns failure when ToolRegistry not available", async () => {
    // Build facade without TOOL_FEATURE
    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);

    const result = await facade.search({ query: "test query" });

    expect(result.success).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.error).toContain("not available");
  });

  it("returns failure when web-search tool throws during execution", async () => {
    const mockToolRegistry = {
      tryGet: jest.fn().mockReturnValue({
        execute: jest.fn().mockRejectedValue(new Error("Tool error")),
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
        {
          provide: TOOL_FEATURE,
          useValue: { registry: mockToolRegistry, executor: null },
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);

    const result = await facade.search({ query: "failing query" });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// chat() — isError path recording circuit breaker failure
// ─────────────────────────────────────────────────────────────

describe("AIFacade — chat() isError response handling", () => {
  afterEach(() => jest.restoreAllMocks());

  it("records circuit breaker failure when AiChatService returns isError=true", async () => {
    const { facade, mockChat, mockCircuitBreaker } = await buildFacade();

    mockChat.chat.mockResolvedValue({
      content: "Error message from LLM",
      model: "gpt-4o",
      usage: { totalTokens: 0 },
      isError: true,
    });

    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
    });

    expect(result.isError).toBe(true);
    expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
  });

  it("does not deduct credits when isError=true", async () => {
    const mockCreditsService = { consumeCredits: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        AIFacade,
        {
          provide: AiChatService,
          useValue: makeMockAiChatService({
            chat: jest.fn().mockResolvedValue({
              content: "Error",
              model: "gpt-4o",
              usage: { totalTokens: 100 },
              isError: true,
            }),
          }),
        },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const facade = module.get<AIFacade>(AIFacade);
    (facade as unknown as Record<string, unknown>)["creditsService"] =
      mockCreditsService;

    await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      billing: { userId: "u1", moduleType: "test", operationType: "chat" },
    });

    expect(mockCreditsService.consumeCredits).not.toHaveBeenCalled();
  });
});
