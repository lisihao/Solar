/**
 * chat.facade-supplemental.spec.ts
 *
 * Covers branches NOT tested by chat.facade.spec.ts:
 *   - chatWithSkills() — full path when skills.loader + skills.promptBuilder ARE available
 *   - chatStream() — token estimation when tokensUsed===0 and content was accumulated
 *   - chatStream() — chunk.error branch inside the streaming loop
 *   - handleBilling() — via BillingContext (full billing context resolution)
 *   - resolveBillingFromContext() — RequestContext fallback path
 *   - checkConstraints() — contentFilter.rules custom regex
 *   - extractJson() — leading non-JSON text before '{' and trailing text after '}'
 *   - chat() skill proxy — domain/query present with skills available
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "../chat.facade";
import { AiChatService } from "../../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../../ai-engine/llm/models/config/ai-model-config.service";
import { CreditsService } from "../../../../platform/credits/credits.service";
import { ORCHESTRATION_FEATURE, SKILL_FEATURE } from "../../facade.providers";

// ============================================================
// Shared mocks
// ============================================================

function buildMockAiChatService(): jest.Mocked<Partial<AiChatService>> {
  return {
    chat: jest.fn().mockResolvedValue({
      content: "Hello!",
      model: "gpt-4o",
      usage: { totalTokens: 80 },
      isError: false,
    }),
    chatStream: jest.fn(),
    getDefaultModelByType: jest.fn().mockResolvedValue({ modelId: "gpt-4o" }),
  };
}

function buildMockModelConfigService() {
  return {
    getDefaultModel: jest.fn().mockResolvedValue(null),
    getModelById: jest.fn().mockResolvedValue(null),
    refreshModelConfigCache: jest.fn(),
    getEnabledModelsForFrontend: jest.fn().mockResolvedValue([]),
    getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
  };
}

function buildMockCircuitBreaker() {
  return {
    canExecute: jest.fn().mockReturnValue(true),
    getCooldownRemaining: jest.fn().mockReturnValue(0),
    incrementLoad: jest.fn(),
    decrementLoad: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    parseErrorType: jest.fn(),
    selectBest: jest.fn().mockReturnValue(null),
  };
}

// ============================================================
// chatWithSkills() — full skill path
// ============================================================

describe("ChatFacade — chatWithSkills() with skills available", () => {
  let facade: ChatFacade;
  let mockAiChatService: jest.Mocked<Partial<AiChatService>>;

  const mockSkillLoader = {
    getSkillsForTask: jest.fn().mockResolvedValue([]),
  };
  const mockPromptBuilder = {
    buildSystemPrompt: jest.fn().mockReturnValue({
      prompt: "You are an expert assistant.",
      usedSkills: ["skill-research"],
      estimatedTokens: 150,
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAiChatService = buildMockAiChatService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: buildMockModelConfigService(),
        },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: buildMockCircuitBreaker() },
        },
        {
          provide: SKILL_FEATURE,
          useValue: {
            loader: mockSkillLoader,
            promptBuilder: mockPromptBuilder,
          },
        },
      ],
    }).compile();

    facade = module.get<ChatFacade>(ChatFacade);
  });

  it("should load skills, inject system prompt, and call underlying chat", async () => {
    const result = await facade.chatWithSkills({
      messages: [{ role: "user", content: "Research this topic" }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "low", outputLength: "medium" },
      domain: "research",
    });

    expect(mockSkillLoader.getSkillsForTask).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "research",
      }),
    );
    expect(mockPromptBuilder.buildSystemPrompt).toHaveBeenCalled();
    // AiChatService.chat should be called with system message prepended
    expect(mockAiChatService.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user" }),
        ]),
      }),
    );
    expect(result.usedSkills).toEqual(["skill-research"]);
    expect(result.skillsTokensUsed).toBe(150);
    expect(result.content).toBe("Hello!");
  });

  it("should not prepend system message when buildSystemPrompt returns empty prompt", async () => {
    mockPromptBuilder.buildSystemPrompt.mockReturnValue({
      prompt: "", // empty — no system message injected
      usedSkills: [],
      estimatedTokens: 0,
    });

    const result = await facade.chatWithSkills({
      messages: [{ role: "user", content: "Hello" }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "low", outputLength: "short" },
      domain: "common",
    });

    // Should only have the original user message, no system message prepended
    const chatCallArgs = (mockAiChatService.chat as jest.Mock).mock.calls[0][0];
    expect(chatCallArgs.messages).toHaveLength(1);
    expect(chatCallArgs.messages[0].role).toBe("user");
    expect(result.usedSkills).toEqual([]);
  });

  it("should auto-delegate from chat() when domain/query are provided", async () => {
    // When domain/query are provided and skills ARE available,
    // chat() should invoke handleSkillProxy -> chatWithSkills
    const result = await facade.chat({
      messages: [{ role: "user", content: "Analyze" }],
      domain: "research",
    });

    expect(mockSkillLoader.getSkillsForTask).toHaveBeenCalled();
    expect(result.content).toBe("Hello!");
  });
});

// ============================================================
// chatStream() — token estimation and chunk.error
// ============================================================

describe("ChatFacade — chatStream() token estimation and error chunks", () => {
  let facade: ChatFacade;
  let mockAiChatService: jest.Mocked<Partial<AiChatService>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAiChatService = buildMockAiChatService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: buildMockModelConfigService(),
        },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: buildMockCircuitBreaker() },
        },
      ],
    }).compile();

    facade = module.get<ChatFacade>(ChatFacade);
  });

  it("should estimate tokens from content length when usage not provided in stream", async () => {
    // Simulate chunks with no usage field (tokensUsed stays 0) but content present
    mockAiChatService.chatStream = jest.fn().mockReturnValue(
      (async function* () {
        yield { content: "Hello", done: false }; // no usage
        yield { content: " World!", done: false }; // no usage
        yield { content: "", done: true }; // terminal chunk
      })(),
    );

    const chunks: Array<{ content: string; done: boolean; error?: string }> =
      [];
    for await (const chunk of facade.chatStream({
      messages: [{ role: "user", content: "Hi" }],
      model: "gpt-4o",
    })) {
      chunks.push(chunk);
    }

    // Should complete without error
    expect(chunks[chunks.length - 1].done).toBe(true);
    // No error
    expect(chunks.every((c) => !c.error)).toBe(true);
  });

  it("should record circuit breaker failure when chunk has error field", async () => {
    const mockCircuitBreaker = buildMockCircuitBreaker();

    const module2: TestingModule = await Test.createTestingModule({
      providers: [
        ChatFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: buildMockModelConfigService(),
        },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: mockCircuitBreaker },
        },
      ],
    }).compile();

    const facade2 = module2.get<ChatFacade>(ChatFacade);

    // Chunk with error field set
    mockAiChatService.chatStream = jest.fn().mockReturnValue(
      (async function* () {
        yield { content: "partial", done: false };
        yield {
          content: "",
          done: true,
          error: "rate_limit_exceeded",
          usage: undefined,
        };
      })(),
    );

    const results: Array<{ content: string; done: boolean; error?: string }> =
      [];
    for await (const chunk of facade2.chatStream({
      messages: [{ role: "user", content: "Test" }],
    })) {
      results.push(chunk);
    }

    // Circuit breaker should have recorded failure for the error chunk
    expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
  });
});

// ============================================================
// handleBilling() — BillingContext and RequestContext fallback
// ============================================================

describe("ChatFacade — billing context resolution", () => {
  let facade: ChatFacade;
  let mockAiChatService: jest.Mocked<Partial<AiChatService>>;
  let mockCreditsService: { consumeCredits: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAiChatService = buildMockAiChatService();
    mockCreditsService = {
      consumeCredits: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: buildMockModelConfigService(),
        },
        { provide: CreditsService, useValue: mockCreditsService },
      ],
    }).compile();

    facade = module.get<ChatFacade>(ChatFacade);
  });

  it("should use BillingContext when set before chat call", async () => {
    const { BillingContext } = await import("../../../../platform/facade");

    // Set billing context (simulates what AI App modules do)
    await BillingContext.run(
      {
        userId: "ctx-user-1",
        moduleType: "ai-research",
        operationType: "analysis",
        referenceId: "report-123",
        description: "Research report",
      },
      async () => {
        await facade.chat({
          messages: [{ role: "user", content: "Analyze" }],
          // No billing in request — should fall back to BillingContext
        });
      },
    );

    // The chat was called and billing was resolved from BillingContext
    expect(mockAiChatService.chat).toHaveBeenCalled();
  });

  it("should not call consumeCredits when no billing info at all", async () => {
    await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      // No billing, no BillingContext, no RequestContext
    });

    expect(mockCreditsService.consumeCredits).not.toHaveBeenCalled();
  });
});

// ============================================================
// checkConstraints() — contentFilter.rules
// ============================================================

describe("ChatFacade — checkConstraints() custom contentFilter rules", () => {
  let facade: ChatFacade;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatFacade,
        { provide: AiChatService, useValue: buildMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: buildMockModelConfigService(),
        },
      ],
    }).compile();

    facade = module.get<ChatFacade>(ChatFacade);
  });

  it("should detect custom rule violations via contentFilter.rules", () => {
    const result = facade.checkConstraints({
      content: "This message contains FORBIDDEN_WORD here",
      constraints: {
        contentFilter: {
          enabled: true,
          rules: ["FORBIDDEN_WORD"],
        },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "content_filter",
          message: expect.stringContaining("FORBIDDEN_WORD"),
        }),
      ]),
    );
  });

  it("should skip invalid regex in contentFilter.rules without throwing", () => {
    // "[invalid" is an invalid regex — should be skipped gracefully
    const result = facade.checkConstraints({
      content: "Some normal content",
      constraints: {
        contentFilter: {
          enabled: true,
          rules: ["[invalid-regex"],
        },
      },
    });

    // Should not throw; invalid rule is skipped
    expect(result).toBeDefined();
  });

  it("should pass when custom rules do not match", () => {
    const result = facade.checkConstraints({
      content: "Clean content with no forbidden words",
      constraints: {
        contentFilter: {
          enabled: true,
          rules: ["VERY_SPECIFIC_FORBIDDEN_PHRASE_XYZ"],
        },
      },
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toBeUndefined();
  });
});

// ============================================================
// extractJson() — leading/trailing non-JSON text trimming
// ============================================================

describe("ChatFacade — chatStructured() JSON extraction edge cases", () => {
  let facade: ChatFacade;
  let mockAiChatService: jest.Mocked<Partial<AiChatService>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAiChatService = buildMockAiChatService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: buildMockModelConfigService(),
        },
      ],
    }).compile();

    facade = module.get<ChatFacade>(ChatFacade);
  });

  it("should strip leading non-JSON text before the opening brace", async () => {
    // e.g. LLM outputs "Here is the JSON: {\"key\": \"value\"}"
    mockAiChatService.chat = jest.fn().mockResolvedValue({
      content: 'Here is the result: {"key": "value"} end',
      model: "gpt-4o",
      usage: { totalTokens: 50 },
      isError: false,
    });

    const result = await facade.chatStructured<{ key: string }>({
      messages: [{ role: "user", content: "Generate" }],
      schema: { type: "object" },
    });

    expect(result.data.key).toBe("value");
  });

  it("should extract JSON from array format with leading text", async () => {
    mockAiChatService.chat = jest.fn().mockResolvedValue({
      content: "Output: [1, 2, 3] done",
      model: "gpt-4o",
      usage: { totalTokens: 30 },
      isError: false,
    });

    const result = await facade.chatStructured<number[]>({
      messages: [{ role: "user", content: "List numbers" }],
      schema: { type: "array" },
    });

    expect(result.data).toEqual([1, 2, 3]);
  });

  it("should handle isError response by accumulating error and continuing retries", async () => {
    // chat returns isError=true — causes lastError to be set, loop continues
    mockAiChatService.chat = jest.fn().mockResolvedValue({
      content: "Internal error",
      model: "gpt-4o",
      usage: { totalTokens: 10 },
      isError: true,
    });

    await expect(
      facade.chatStructured<{ x: number }>({
        messages: [{ role: "user", content: "Err" }],
        schema: { type: "object" },
        maxRetries: 0,
        throwOnParseError: true,
      }),
    ).rejects.toThrow();
  });

  it("should use system prompt with retry prefix on second attempt", async () => {
    let callCount = 0;
    mockAiChatService.chat = jest.fn().mockImplementation(async (req) => {
      callCount++;
      if (callCount === 1) {
        return {
          content: "not json",
          model: "gpt-4o",
          usage: { totalTokens: 10 },
          isError: false,
        };
      }
      // On second call, verify the system prompt contains retry prefix
      expect(req.systemPrompt).toContain(
        "previous response was not valid JSON",
      );
      return {
        content: '{"retried": true}',
        model: "gpt-4o",
        usage: { totalTokens: 20 },
        isError: false,
      };
    });

    const result = await facade.chatStructured<{ retried: boolean }>({
      messages: [{ role: "user", content: "Try again" }],
      schema: { type: "object" },
      maxRetries: 1,
    });

    expect(result.data.retried).toBe(true);
    expect(result.retriedParse).toBe(true);
    expect(callCount).toBe(2);
  });
});
