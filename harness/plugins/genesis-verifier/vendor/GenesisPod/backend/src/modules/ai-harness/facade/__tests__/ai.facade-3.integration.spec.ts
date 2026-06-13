/**
 * AIFacade - Supplemental3 tests
 *
 * Covers uncovered branches not in supplemental/supplemental2:
 * - handleSkillProxy: domain/query provided WITH skills available → auto-delegates
 * - handleSkillProxy: domain/query provided WITHOUT skills → returns null (normal flow)
 * - enforceRateLimitAndBudget: rate limited (has constraint.rateLimiter)
 * - enforceRateLimitAndBudget: budget exceeded (has constraint.costController)
 * - chatWithSkills: skills loader unavailable → fallback to plain chat
 * - chatWithSkills: skills loader available → injects system prompt
 * - chatStream: success path (no circuit breaker)
 */

// Mock @prisma/client so enum accesses don't throw in this isolated test context
jest.mock("@prisma/client", () => {
  const enumProxy = new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === "string" ? prop : undefined) },
  );
  return new Proxy(
    { PrismaClient: jest.fn().mockImplementation(() => ({})) },
    {
      get(target, prop) {
        if (prop in target)
          return (target as Record<string | symbol, unknown>)[prop];
        return enumProxy;
      },
    },
  );
});

import { Test, TestingModule } from "@nestjs/testing";
import { AIFacade } from "../ai.facade";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
import {
  MEMORY_FEATURE,
  TOOL_FEATURE,
  ORCHESTRATION_FEATURE,
  SKILL_FEATURE,
  CONSTRAINT_FEATURE,
  TEAMS_FEATURE,
  CONTENT_FEATURE,
  KNOWLEDGE_FEATURE,
  INTELLIGENCE_FEATURE,
  COLLABORATION_FEATURE,
  OBSERVABILITY_FEATURE,
  REGISTRY_FEATURE,
  REALTIME_FEATURE,
} from "../facade.providers";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeChatService() {
  return {
    chat: jest.fn().mockResolvedValue({
      content: "Hello from AI",
      model: "gpt-4o",
      usage: { totalTokens: 100 },
      isError: false,
      apiKeySource: "system",
    }),
    chatStream: jest.fn().mockImplementation(function* () {
      yield { content: "chunk1", done: false, tokensUsed: 0 };
      yield { content: "chunk2", done: true, tokensUsed: 50 };
    }),
    getAvailableModelsAsync: jest.fn().mockResolvedValue(["gpt-4o"]),
    isReasoningModel: jest.fn().mockReturnValue(false),
    getDefaultModelByType: jest.fn().mockResolvedValue(null),
    generateChatCompletion: jest
      .fn()
      .mockResolvedValue({ content: "ok", tokensUsed: 5 }),
  };
}

function makeModelConfigService() {
  return {
    getDefaultModel: jest.fn().mockResolvedValue(null),
    getModelById: jest.fn().mockResolvedValue(null),
    refreshModelConfigCache: jest.fn(),
    getEnabledModelsForFrontend: jest.fn().mockResolvedValue([]),
    getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
  };
}

const ALL_NULL_FEATURES = [
  { provide: MEMORY_FEATURE, useValue: undefined },
  { provide: TOOL_FEATURE, useValue: undefined },
  { provide: ORCHESTRATION_FEATURE, useValue: undefined },
  { provide: SKILL_FEATURE, useValue: undefined },
  { provide: CONSTRAINT_FEATURE, useValue: undefined },
  { provide: TEAMS_FEATURE, useValue: undefined },
  { provide: CONTENT_FEATURE, useValue: undefined },
  { provide: KNOWLEDGE_FEATURE, useValue: undefined },
  { provide: INTELLIGENCE_FEATURE, useValue: undefined },
  { provide: COLLABORATION_FEATURE, useValue: undefined },
  { provide: OBSERVABILITY_FEATURE, useValue: undefined },
  { provide: REGISTRY_FEATURE, useValue: undefined },
  { provide: REALTIME_FEATURE, useValue: undefined },
];

async function buildFacade(
  chatService: ReturnType<typeof makeChatService>,
  extraProviders: Array<{ provide: string | symbol; useValue: unknown }> = [],
): Promise<AIFacade> {
  const extraTokens = new Set(extraProviders.map((p) => p.provide));
  const merged = [
    ...ALL_NULL_FEATURES.filter((d) => !extraTokens.has(d.provide)),
    ...extraProviders,
  ];

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AIFacade,
      { provide: AiChatService, useValue: chatService },
      { provide: AiModelConfigService, useValue: makeModelConfigService() },
      ...merged,
    ],
  }).compile();

  return module.get<AIFacade>(AIFacade);
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests: handleSkillProxy
// ──────────────────────────────────────────────────────────────────────────────

describe("AIFacade handleSkillProxy (via chat())", () => {
  let chatSvc: ReturnType<typeof makeChatService>;

  beforeEach(() => {
    jest.clearAllMocks();
    chatSvc = makeChatService();
  });

  it("returns null (no delegation) when no domain/query provided", async () => {
    const facade = await buildFacade(chatSvc);

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.content).toBe("Hello from AI");
    expect(chatSvc.chat).toHaveBeenCalledTimes(1);
  });

  it("returns null (no delegation) when skills feature not available", async () => {
    const facade = await buildFacade(chatSvc, [
      { provide: SKILL_FEATURE, useValue: undefined },
    ]);

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
      domain: "research",
    });

    // Still calls plain chat since SKILL_FEATURE is undefined
    expect(result.content).toBe("Hello from AI");
  });

  it("delegates to chatWithSkills when domain/query provided WITH skills feature", async () => {
    const mockSkillLoader = {
      getSkillsForTask: jest.fn().mockResolvedValue([]),
    };
    const mockPromptBuilder = {
      buildSystemPrompt: jest.fn().mockReturnValue({
        prompt: "You are a research expert.",
        usedSkills: ["research-guide"],
        estimatedTokens: 200,
      }),
    };

    const skillFeature = {
      loader: mockSkillLoader,
      promptBuilder: mockPromptBuilder,
      registry: {},
    };

    const facade = await buildFacade(chatSvc, [
      { provide: SKILL_FEATURE, useValue: skillFeature },
    ]);

    const result = await facade.chat({
      messages: [{ role: "user", content: "Analyze AI trends" }],
      domain: "research",
    });

    expect(result.content).toBe("Hello from AI");
    expect(mockSkillLoader.getSkillsForTask).toHaveBeenCalled();
    expect(mockPromptBuilder.buildSystemPrompt).toHaveBeenCalled();
    // Inner chat gets called with skills system prompt prepended
    expect(chatSvc.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: "You are a research expert.",
          }),
        ]),
      }),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: enforceRateLimitAndBudget
// ──────────────────────────────────────────────────────────────────────────────

describe("AIFacade enforceRateLimitAndBudget (via chat())", () => {
  let chatSvc: ReturnType<typeof makeChatService>;

  beforeEach(() => {
    jest.clearAllMocks();
    chatSvc = makeChatService();
  });

  it("returns rate limit error when rate limiter denies request", async () => {
    const rateLimiter = {
      checkAndConsume: jest
        .fn()
        .mockResolvedValue({ allowed: false, retryAfterMs: 30000 }),
    };

    const constraintFeature = {
      rateLimiter,
      costController: undefined,
    };

    const facade = await buildFacade(chatSvc, [
      { provide: CONSTRAINT_FEATURE, useValue: constraintFeature },
    ]);

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
      billing: {
        userId: "user-123",
        moduleType: "ai-ask",
        operationType: "chat",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Rate limit exceeded");
    expect(chatSvc.chat).not.toHaveBeenCalled();
  });

  it("consumes rate limit token when request is allowed", async () => {
    const rateLimiter = {
      checkAndConsume: jest.fn().mockResolvedValue({ allowed: true }),
    };

    const constraintFeature = {
      rateLimiter,
      costController: undefined,
    };

    const facade = await buildFacade(chatSvc, [
      { provide: CONSTRAINT_FEATURE, useValue: constraintFeature },
    ]);

    await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
      billing: {
        userId: "user-456",
        moduleType: "ai-ask",
        operationType: "chat",
      },
    });

    expect(rateLimiter.checkAndConsume).toHaveBeenCalledWith("chat", {
      tenantId: "user-456",
    });
    expect(chatSvc.chat).toHaveBeenCalled();
  });

  it("returns budget error when cost controller denies request", async () => {
    const constraintFeature = {
      rateLimiter: undefined,
      costController: {
        checkBudget: jest.fn().mockReturnValue({
          allowed: false,
          reason: "Monthly budget exceeded",
        }),
      },
    };

    const facade = await buildFacade(chatSvc, [
      { provide: CONSTRAINT_FEATURE, useValue: constraintFeature },
    ]);

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Budget limit exceeded");
    expect(chatSvc.chat).not.toHaveBeenCalled();
  });

  it("allows request when cost controller approves budget", async () => {
    const constraintFeature = {
      rateLimiter: undefined,
      costController: {
        checkBudget: jest.fn().mockReturnValue({ allowed: true }),
      },
    };

    const facade = await buildFacade(chatSvc, [
      { provide: CONSTRAINT_FEATURE, useValue: constraintFeature },
    ]);

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBe(false);
    expect(chatSvc.chat).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: chatWithSkills
// ──────────────────────────────────────────────────────────────────────────────

describe("AIFacade chatWithSkills()", () => {
  let chatSvc: ReturnType<typeof makeChatService>;

  beforeEach(() => {
    jest.clearAllMocks();
    chatSvc = makeChatService();
  });

  it("falls back to plain chat when skills loader unavailable", async () => {
    const facade = await buildFacade(chatSvc);

    const result = await facade.chatWithSkills({
      messages: [{ role: "user", content: "Analyze this" }],
      domain: "research",
      taskProfile: { creativity: "low", outputLength: "medium" },
    });

    expect(result.content).toBe("Hello from AI");
    expect(result.usedSkills).toEqual([]);
    expect(result.skillsTokensUsed).toBe(0);
  });

  it("injects skills system prompt when skills loader available", async () => {
    const mockSkills = [
      { id: "research-guide", content: "Research guidelines" },
    ];
    const mockSkillLoader = {
      getSkillsForTask: jest.fn().mockResolvedValue(mockSkills),
    };
    const mockPromptBuilder = {
      buildSystemPrompt: jest.fn().mockReturnValue({
        prompt: "Research expert system prompt",
        usedSkills: ["research-guide"],
        estimatedTokens: 150,
      }),
    };

    const skillFeature = {
      loader: mockSkillLoader,
      promptBuilder: mockPromptBuilder,
      registry: {},
    };

    const facade = await buildFacade(chatSvc, [
      { provide: SKILL_FEATURE, useValue: skillFeature },
    ]);

    const result = await facade.chatWithSkills({
      messages: [{ role: "user", content: "Analyze AI trends" }],
      domain: "research",
      taskProfile: { creativity: "medium", outputLength: "long" },
    });

    expect(result.content).toBe("Hello from AI");
    expect(result.usedSkills).toContain("research-guide");
    expect(result.skillsTokensUsed).toBe(150);
    expect(mockSkillLoader.getSkillsForTask).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "research" }),
    );
  });

  it("handles empty skills list (no matching skills)", async () => {
    const mockSkillLoader = {
      getSkillsForTask: jest.fn().mockResolvedValue([]),
    };
    const mockPromptBuilder = {
      buildSystemPrompt: jest.fn().mockReturnValue({
        prompt: "", // empty prompt
        usedSkills: [],
        estimatedTokens: 0,
      }),
    };

    const facade = await buildFacade(chatSvc, [
      {
        provide: SKILL_FEATURE,
        useValue: {
          loader: mockSkillLoader,
          promptBuilder: mockPromptBuilder,
          registry: {},
        },
      },
    ]);

    const result = await facade.chatWithSkills({
      messages: [{ role: "user", content: "Hello" }],
      domain: "common",
    });

    expect(result.usedSkills).toEqual([]);
    // Without system prompt, only original message is sent
    expect(chatSvc.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.not.arrayContaining([
          expect.objectContaining({ role: "system" }),
        ]),
      }),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: chatStream
// ──────────────────────────────────────────────────────────────────────────────

describe("AIFacade chatStream()", () => {
  let chatSvc: ReturnType<typeof makeChatService>;

  beforeEach(() => {
    jest.clearAllMocks();
    chatSvc = makeChatService();
  });

  it("streams chunks from aiChatService", async () => {
    const facade = await buildFacade(chatSvc);

    const chunks: Array<{ content: string; done: boolean }> = [];
    for await (const chunk of facade.chatStream({
      messages: [{ role: "user", content: "Tell me a story" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some((c) => c.done)).toBe(true);
  });

  it("yields circuit breaker error when circuit is open", async () => {
    const circuitBreaker = {
      canExecute: jest.fn().mockReturnValue(false),
      getCooldownRemaining: jest.fn().mockReturnValue(15000),
      incrementLoad: jest.fn(),
      decrementLoad: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      parseErrorType: jest.fn(),
    };

    const facade = await buildFacade(chatSvc, [
      {
        provide: ORCHESTRATION_FEATURE,
        useValue: {
          circuitBreaker,
          intentRouter: undefined,
          taskDecomposer: undefined,
          agentExecutor: undefined,
          stateManager: undefined,
          fcExecutor: undefined,
          contextInit: undefined,
          outputReviewer: undefined,
          contextEvolution: undefined,
        },
      },
    ]);

    const chunks: Array<{ content: string; done: boolean; error?: string }> =
      [];
    for await (const chunk of facade.chatStream({
      messages: [{ role: "user", content: "Hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].error).toBe("CIRCUIT_BREAKER_OPEN");
    expect(chunks[0].done).toBe(true);
    expect(chatSvc.chatStream).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: resolveModelId
// ──────────────────────────────────────────────────────────────────────────────

describe("AIFacade resolveModelId (via chat())", () => {
  let chatSvc: ReturnType<typeof makeChatService>;

  beforeEach(() => {
    jest.clearAllMocks();
    chatSvc = makeChatService();
  });

  it("uses explicit model when provided", async () => {
    const facade = await buildFacade(chatSvc);

    await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
      model: "claude-3-opus",
    });

    expect(chatSvc.chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-3-opus" }),
    );
  });

  it("uses default model by type when explicit model not provided", async () => {
    chatSvc.getDefaultModelByType.mockResolvedValue({
      modelId: "gpt-4o-mini",
      name: "GPT-4o Mini",
    });
    const facade = await buildFacade(chatSvc);

    await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
      modelType: "CHAT" as import("@prisma/client").AIModelType,
    });

    expect(chatSvc.getDefaultModelByType).toHaveBeenCalled();
  });

  it("falls back to empty string when no model or type provided", async () => {
    const facade = await buildFacade(chatSvc);

    await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    // Should still call chat (model is undefined in request, empty string resolved internally)
    expect(chatSvc.chat).toHaveBeenCalled();
    expect(chatSvc.getDefaultModelByType).not.toHaveBeenCalled();
  });
});
