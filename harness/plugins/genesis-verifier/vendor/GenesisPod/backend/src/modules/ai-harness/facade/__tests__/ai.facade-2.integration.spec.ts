/**
 * AIFacade - Supplemental2 tests
 *
 * Covers uncovered branches not in supplemental.spec.ts or extended.spec.ts:
 * - chatStructured() — JSON parse, markdown fence, retry, throwOnParseError=false
 * - chat() — circuit breaker open, rate limited, budget exceeded
 * - chatSingleModel() — error in service response
 * - registerDirectResearchExecutor / runDirectResearch
 * - logFeatureAvailability — constructor logging
 */

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

function makeChatService() {
  return {
    chat: jest.fn().mockResolvedValue({
      content: "Hello",
      model: "gpt-4o",
      usage: { totalTokens: 100 },
      isError: false,
      apiKeySource: "system",
    }),
    chatStream: jest.fn().mockImplementation(async function* () {
      yield { content: "c", done: true, tokensUsed: 10 };
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

async function buildFacadeWithProviders(
  chatService: ReturnType<typeof makeChatService>,
  extraProviders: Array<{ provide: string | symbol; useValue: unknown }> = [],
): Promise<AIFacade> {
  const defaultExtras = [
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

  // Merge: extraProviders override defaults
  const extraTokens = new Set(extraProviders.map((p) => p.provide));
  const merged = [
    ...defaultExtras.filter((d) => !extraTokens.has(d.provide)),
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

// ===========================================================================
// chatStructured
// ===========================================================================

describe("AIFacade chatStructured()", () => {
  let facade: AIFacade;
  let chatSvc: ReturnType<typeof makeChatService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    chatSvc = makeChatService();
    facade = await buildFacadeWithProviders(chatSvc);
  });

  it("parses plain JSON response", async () => {
    chatSvc.chat.mockResolvedValueOnce({
      content: '{"value": 42}',
      model: "gpt-4o",
      usage: { totalTokens: 30 },
      isError: false,
      apiKeySource: "system",
    });

    const result = await facade.chatStructured<{ value: number }>({
      messages: [{ role: "user", content: "give me json" }],
      schema: { type: "object", properties: { value: { type: "number" } } },
    });

    expect(result.data.value).toBe(42);
    expect(result.retriedParse).toBe(false);
  });

  it("extracts JSON from markdown code fence", async () => {
    chatSvc.chat.mockResolvedValueOnce({
      content: '```json\n{"key": "val"}\n```',
      model: "gpt-4o",
      usage: { totalTokens: 40 },
      isError: false,
      apiKeySource: "system",
    });

    const result = await facade.chatStructured<{ key: string }>({
      messages: [{ role: "user", content: "give me json" }],
      schema: { type: "object" },
    });

    expect(result.data.key).toBe("val");
  });

  it("retries on parse failure and succeeds on second attempt", async () => {
    chatSvc.chat
      .mockResolvedValueOnce({
        content: "I cannot provide JSON",
        model: "gpt-4o",
        usage: { totalTokens: 20 },
        isError: false,
        apiKeySource: "system",
      })
      .mockResolvedValueOnce({
        content: '{"name": "retry"}',
        model: "gpt-4o",
        usage: { totalTokens: 30 },
        isError: false,
        apiKeySource: "system",
      });

    const result = await facade.chatStructured<{ name: string }>({
      messages: [{ role: "user", content: "test" }],
      schema: { type: "object" },
      maxRetries: 1,
    });

    expect(result.data.name).toBe("retry");
    expect(result.retriedParse).toBe(true);
    expect(chatSvc.chat).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries when throwOnParseError=true", async () => {
    chatSvc.chat.mockResolvedValue({
      content: "Not JSON at all!",
      model: "gpt-4o",
      usage: { totalTokens: 15 },
      isError: false,
      apiKeySource: "system",
    });

    await expect(
      facade.chatStructured({
        messages: [{ role: "user", content: "test" }],
        schema: { type: "object" },
        maxRetries: 1,
        throwOnParseError: true,
      }),
    ).rejects.toThrow("Structured output parse failed");

    expect(chatSvc.chat).toHaveBeenCalledTimes(2);
  });

  it("returns empty data when throwOnParseError=false", async () => {
    chatSvc.chat.mockResolvedValue({
      content: "totally not json",
      model: "gpt-4o",
      usage: { totalTokens: 10 },
      isError: false,
      apiKeySource: "system",
    });

    const result = await facade.chatStructured({
      messages: [{ role: "user", content: "test" }],
      schema: { type: "object" },
      maxRetries: 0,
      throwOnParseError: false,
    });

    expect(result.data).toEqual({});
    expect(result.retriedParse).toBe(true);
  });

  it("accumulates tokens across retries", async () => {
    chatSvc.chat
      .mockResolvedValueOnce({
        content: "bad",
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
        apiKeySource: "system",
      })
      .mockResolvedValueOnce({
        content: '{"done": true}',
        model: "gpt-4o",
        usage: { totalTokens: 70 },
        isError: false,
        apiKeySource: "system",
      });

    const result = await facade.chatStructured({
      messages: [{ role: "user", content: "test" }],
      schema: { type: "object" },
      maxRetries: 1,
      throwOnParseError: false,
    });

    expect(result.tokensUsed).toBe(120);
  });

  it("handles error response from chat service and retries", async () => {
    chatSvc.chat
      .mockResolvedValueOnce({
        content: "Service unavailable",
        model: "gpt-4o",
        usage: { totalTokens: 0 },
        isError: true,
        apiKeySource: "system",
      })
      .mockResolvedValueOnce({
        content: '{"status": "ok"}',
        model: "gpt-4o",
        usage: { totalTokens: 25 },
        isError: false,
        apiKeySource: "system",
      });

    const result = await facade.chatStructured<{ status: string }>({
      messages: [{ role: "user", content: "test" }],
      schema: { type: "object" },
      maxRetries: 1,
      throwOnParseError: false,
    });

    expect(result.data).toEqual({ status: "ok" });
  });

  it("uses custom systemPrompt prepended to schema instruction", async () => {
    chatSvc.chat.mockResolvedValueOnce({
      content: '{"x": 1}',
      model: "gpt-4o",
      usage: { totalTokens: 20 },
      isError: false,
      apiKeySource: "system",
    });

    await facade.chatStructured({
      messages: [{ role: "user", content: "test" }],
      schema: { type: "object" },
      systemPrompt: "You are an expert analyst.",
    });

    const chatArg = chatSvc.chat.mock.calls[0][0];
    expect(chatArg.systemPrompt).toContain("You are an expert analyst.");
    expect(chatArg.systemPrompt).toContain("valid JSON");
  });
});

// ===========================================================================
// chat() with circuit breaker
// ===========================================================================

describe("AIFacade chat() — circuit breaker", () => {
  let facade: AIFacade;
  let chatSvc: ReturnType<typeof makeChatService>;
  let circuitBreaker: {
    canExecute: jest.Mock;
    getCooldownRemaining: jest.Mock;
    incrementLoad: jest.Mock;
    decrementLoad: jest.Mock;
    recordSuccess: jest.Mock;
    recordFailure: jest.Mock;
    parseErrorType: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    chatSvc = makeChatService();
    circuitBreaker = {
      canExecute: jest.fn().mockReturnValue(true),
      getCooldownRemaining: jest.fn().mockReturnValue(0),
      incrementLoad: jest.fn(),
      decrementLoad: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      parseErrorType: jest.fn().mockReturnValue("API_ERROR"),
    };

    facade = await buildFacadeWithProviders(chatSvc, [
      {
        provide: ORCHESTRATION_FEATURE,
        useValue: { circuitBreaker },
      },
    ]);
  });

  it("blocks call when circuit is OPEN", async () => {
    circuitBreaker.canExecute.mockReturnValue(false);
    circuitBreaker.getCooldownRemaining.mockReturnValue(15000);

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("temporarily unavailable");
    expect(chatSvc.chat).not.toHaveBeenCalled();
  });

  it("records success in circuit breaker after successful call", async () => {
    const result = await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.isError).toBe(false);
    expect(circuitBreaker.recordSuccess).toHaveBeenCalled();
    expect(circuitBreaker.decrementLoad).toHaveBeenCalled();
  });

  it("records failure on error response", async () => {
    chatSvc.chat.mockResolvedValueOnce({
      content: "Error from model",
      model: "gpt-4o",
      usage: { totalTokens: 0 },
      isError: true,
      apiKeySource: "system",
    });

    await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(circuitBreaker.recordFailure).toHaveBeenCalled();
  });

  it("records failure on exception and decrements load", async () => {
    chatSvc.chat.mockRejectedValueOnce(new Error("Network failure"));

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
      strictMode: false,
    });

    expect(result.isError).toBe(true);
    expect(circuitBreaker.recordFailure).toHaveBeenCalled();
    expect(circuitBreaker.decrementLoad).toHaveBeenCalled();
  });
});

// ===========================================================================
// chat() with rate limiter and budget constraint
// ===========================================================================

describe("AIFacade chat() — constraints", () => {
  let facade: AIFacade;
  let chatSvc: ReturnType<typeof makeChatService>;
  let rateLimiter: { checkAndConsume: jest.Mock };
  let costController: { checkBudget: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    chatSvc = makeChatService();
    rateLimiter = {
      checkAndConsume: jest.fn().mockResolvedValue({ allowed: true }),
    };
    costController = {
      checkBudget: jest.fn().mockReturnValue({ allowed: true }),
    };

    facade = await buildFacadeWithProviders(chatSvc, [
      {
        provide: CONSTRAINT_FEATURE,
        useValue: { rateLimiter, costController },
      },
    ]);
  });

  it("returns rate limit error when rate limiter says not allowed", async () => {
    rateLimiter.checkAndConsume.mockResolvedValue({
      allowed: false,
      retryAfterMs: 3000,
    });

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
      billing: { userId: "u1", moduleType: "chat", operationType: "ask" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Rate limit");
    expect(chatSvc.chat).not.toHaveBeenCalled();
  });

  it("returns budget error when budget controller says not allowed", async () => {
    costController.checkBudget.mockReturnValue({
      allowed: false,
      reason: "Monthly budget exhausted",
    });

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Budget limit exceeded");
    expect(chatSvc.chat).not.toHaveBeenCalled();
  });

  it("consumes rate limit token on allowed request with billing userId", async () => {
    await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
      billing: { userId: "user-123", moduleType: "chat", operationType: "ask" },
    });

    expect(rateLimiter.checkAndConsume).toHaveBeenCalledWith("chat", {
      tenantId: "user-123",
    });
  });

  it("uses global key for rate limiting when no billing userId", async () => {
    await facade.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(rateLimiter.checkAndConsume).toHaveBeenCalledWith("chat", {
      tenantId: "global",
    });
  });
});

// ===========================================================================
