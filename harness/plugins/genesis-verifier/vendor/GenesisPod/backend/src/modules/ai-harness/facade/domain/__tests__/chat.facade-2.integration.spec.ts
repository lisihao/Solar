/**
 * chat.facade-supplemental2.spec.ts
 *
 * Additional coverage for ChatFacade branches not covered by
 * chat.facade.spec.ts or chat.facade-supplemental.spec.ts:
 *   - chatWithFallback() — fallbackResult.success=false + strictMode=true (throws)
 *   - chatWithFallback() — fallbackResult.success=false + strictMode=false (error response)
 *   - chatWithFallback() — fallbackUsed=true branch (logs warn)
 *   - chatSingleModel() — circuit breaker OPEN returns 503 response
 *   - chatSingleModel() — result.isError=true → recordFailure called
 *   - chatSingleModel() — catch block: strictMode=true re-throws
 *   - chatSingleModel() — catch block: strictMode=false returns error response
 *   - handleBilling() — apiKeySource="personal" → skip billing
 *   - handleBilling() — consumeCredits throws → warns and swallows
 *   - chatStream() — circuit breaker OPEN yields error chunk and returns
 *   - chatStream() — stream generator throws → catch block yields error
 *   - resolveModelId() — model provided → returned as-is
 *   - resolveModelId() — modelType provided, getDefaultModelByType returns null → ""
 *   - checkConstraints() — validateJsonSchema: data not object, data not array
 *   - checkConstraints() — jsonSchema required fields missing
 *   - checkConstraints() — JSON.parse throws in jsonSchema branch
 *   - checkConstraints() — content passes all checks (no violations)
 *   - compressContext() — content already under limit (returns as-is)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "../chat.facade";
import { AiChatService } from "../../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../../ai-engine/llm/models/config/ai-model-config.service";
import { ModelFallbackService } from "../../../../ai-engine/llm/models/selection/model-fallback.service";
import { CreditsService } from "../../../../platform/credits/credits.service";
import { ORCHESTRATION_FEATURE } from "../../facade.providers";

// ============================================================
// Shared helpers
// ============================================================

function buildMockAiChatService(): jest.Mocked<Partial<AiChatService>> {
  return {
    chat: jest.fn().mockResolvedValue({
      content: "Hello!",
      model: "gpt-4o",
      usage: { totalTokens: 100 },
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

function buildOpenCircuitBreaker() {
  return {
    canExecute: jest.fn().mockReturnValue(false), // OPEN
    getCooldownRemaining: jest.fn().mockReturnValue(5000),
    incrementLoad: jest.fn(),
    decrementLoad: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    parseErrorType: jest.fn(),
    selectBest: jest.fn().mockReturnValue(null),
  };
}

function buildClosedCircuitBreaker() {
  return {
    canExecute: jest.fn().mockReturnValue(true), // CLOSED
    getCooldownRemaining: jest.fn().mockReturnValue(0),
    incrementLoad: jest.fn(),
    decrementLoad: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn().mockReturnValue(undefined),
    parseErrorType: jest.fn().mockReturnValue("API_ERROR"),
    selectBest: jest.fn().mockReturnValue(null),
  };
}

// ============================================================
// chatWithFallback() branches
// ============================================================

describe("ChatFacade — chatWithFallback() failure paths", () => {
  let facade: ChatFacade;
  let mockAiChatService: jest.Mocked<Partial<AiChatService>>;
  let mockFallbackService: jest.Mocked<Partial<ModelFallbackService>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAiChatService = buildMockAiChatService();
    mockFallbackService = {
      executeWithFallback: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: buildMockModelConfigService(),
        },
        { provide: ModelFallbackService, useValue: mockFallbackService },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: buildClosedCircuitBreaker() },
        },
      ],
    }).compile();

    facade = module.get<ChatFacade>(ChatFacade);
  });

  it("should throw when all models fail and strictMode=true", async () => {
    (mockFallbackService.executeWithFallback as jest.Mock).mockResolvedValue({
      success: false,
      error: new Error("All models exhausted"),
      fallbackUsed: false,
      attemptedModels: ["gpt-4o", "claude-3"],
      attempts: 2,
      modelUsed: null,
    });

    await expect(
      facade.chat({
        messages: [{ role: "user", content: "Test" }],
        model: "gpt-4o",
        strictMode: true,
      }),
    ).rejects.toThrow("All models exhausted");
  });

  it("should return error response when all models fail and strictMode=false", async () => {
    (mockFallbackService.executeWithFallback as jest.Mock).mockResolvedValue({
      success: false,
      error: new Error("Models failed"),
      fallbackUsed: false,
      attemptedModels: ["gpt-4o"],
      attempts: 1,
      modelUsed: "gpt-4o",
    });

    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
      strictMode: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Error:");
    expect(result.tokensUsed).toBe(0);
  });

  it("should return error response with default message when no error.message", async () => {
    (mockFallbackService.executeWithFallback as jest.Mock).mockResolvedValue({
      success: false,
      error: undefined, // no error object
      fallbackUsed: false,
      attemptedModels: ["gpt-4o"],
      attempts: 1,
      modelUsed: null,
    });

    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("All models failed");
  });

  it("should log warning when fallback was used (fallbackUsed=true)", async () => {
    (mockFallbackService.executeWithFallback as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        content: "Fallback result",
        model: "claude-3",
        usage: { totalTokens: 150 },
        isError: false,
        apiKeySource: undefined,
      },
      fallbackUsed: true,
      attemptedModels: ["gpt-4o", "claude-3"],
      attempts: 2,
      modelUsed: "claude-3",
    });

    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
    });

    expect(result.content).toBe("Fallback result");
    expect(result.model).toBe("claude-3");
    expect(result.isError).toBe(false);
  });

  it("should call circuitBreaker.recordSuccess when fallback succeeds", async () => {
    const mockCB = buildClosedCircuitBreaker();

    const module2: TestingModule = await Test.createTestingModule({
      providers: [
        ChatFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: buildMockModelConfigService(),
        },
        { provide: ModelFallbackService, useValue: mockFallbackService },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: mockCB },
        },
      ],
    }).compile();

    const facade2 = module2.get<ChatFacade>(ChatFacade);

    (mockFallbackService.executeWithFallback as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        content: "OK",
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
        apiKeySource: undefined,
      },
      fallbackUsed: false,
      attemptedModels: ["gpt-4o"],
      attempts: 1,
      modelUsed: "gpt-4o",
    });

    await facade2.chat({
      messages: [{ role: "user", content: "Hello" }],
      model: "gpt-4o",
    });

    expect(mockCB.recordSuccess).toHaveBeenCalled();
  });
});

// ============================================================
// chatSingleModel() circuit breaker OPEN
// ============================================================

describe("ChatFacade — chatSingleModel() circuit breaker OPEN", () => {
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
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: buildOpenCircuitBreaker() },
        },
      ],
    }).compile();

    facade = module.get<ChatFacade>(ChatFacade);
  });

  it("should return unavailable error when circuit breaker is OPEN", async () => {
    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("temporarily unavailable");
    expect(result.content).toContain("5"); // 5000ms → 5 seconds
    expect(result.tokensUsed).toBe(0);
  });
});

// ============================================================
// chatSingleModel() — result.isError=true path
// ============================================================

describe("ChatFacade — chatSingleModel() isError result", () => {
  let facade: ChatFacade;
  let mockAiChatService: jest.Mocked<Partial<AiChatService>>;
  let mockCB: ReturnType<typeof buildClosedCircuitBreaker>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAiChatService = buildMockAiChatService();
    mockCB = buildClosedCircuitBreaker();

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
          useValue: { circuitBreaker: mockCB },
        },
      ],
    }).compile();

    facade = module.get<ChatFacade>(ChatFacade);
  });

  it("should call circuitBreaker.recordFailure when aiChatService returns isError=true", async () => {
    (mockAiChatService.chat as jest.Mock).mockResolvedValue({
      content: "API error occurred",
      model: "gpt-4o",
      usage: { totalTokens: 0 },
      isError: true,
    });

    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
    });

    expect(result.isError).toBe(true);
    expect(mockCB.recordFailure).toHaveBeenCalled();
    // Should NOT call recordSuccess
    expect(mockCB.recordSuccess).not.toHaveBeenCalled();
  });

  it("should re-throw when aiChatService throws and strictMode=true", async () => {
    (mockAiChatService.chat as jest.Mock).mockRejectedValue(
      new Error("Upstream model error"),
    );

    await expect(
      facade.chat({
        messages: [{ role: "user", content: "Test" }],
        model: "gpt-4o",
        strictMode: true,
      }),
    ).rejects.toThrow("Upstream model error");
  });

  it("should return error response when aiChatService throws and strictMode=false", async () => {
    (mockAiChatService.chat as jest.Mock).mockRejectedValue(
      new Error("Model timeout"),
    );

    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
      strictMode: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Error:");
    expect(result.content).toContain("Model timeout");
    expect(result.tokensUsed).toBe(0);
  });

  it("should decrement circuit breaker load in finally even when error occurs", async () => {
    (mockAiChatService.chat as jest.Mock).mockRejectedValue(
      new Error("Fatal error"),
    );

    await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
      strictMode: false,
    });

    expect(mockCB.decrementLoad).toHaveBeenCalled();
  });
});

// ============================================================
// handleBilling() — personal API key and credit error
// ============================================================

describe("ChatFacade — handleBilling() edge cases", () => {
  let facade: ChatFacade;
  let mockAiChatService: jest.Mocked<Partial<AiChatService>>;
  let mockCreditsService: { consumeCredits: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAiChatService = buildMockAiChatService();
    mockCreditsService = {
      consumeCredits: jest.fn().mockResolvedValue(undefined),
    };

    (mockAiChatService.chat as jest.Mock).mockResolvedValue({
      content: "Response",
      model: "gpt-4o",
      usage: { totalTokens: 100 },
      isError: false,
      apiKeySource: undefined,
    });

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

  it("should skip billing when apiKeySource is personal", async () => {
    (mockAiChatService.chat as jest.Mock).mockResolvedValue({
      content: "Personal key response",
      model: "gpt-4o",
      usage: { totalTokens: 100 },
      isError: false,
      apiKeySource: "personal",
    });

    await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
      billing: {
        userId: "user-1",
        moduleType: "ai-ask",
        operationType: "chat",
      },
    });

    // consumeCredits should NOT be called for personal API key
    expect(mockCreditsService.consumeCredits).not.toHaveBeenCalled();
  });

  it("should warn and swallow error when consumeCredits throws", async () => {
    mockCreditsService.consumeCredits.mockRejectedValue(
      new Error("Credit service down"),
    );

    // Should not throw even when billing fails
    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
      billing: {
        userId: "user-1",
        moduleType: "ai-ask",
        operationType: "chat",
      },
    });

    // Chat should still succeed
    expect(result.isError).toBe(false);
    expect(mockCreditsService.consumeCredits).toHaveBeenCalled();
  });

  it("should call consumeCredits with correct params", async () => {
    await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
      billing: {
        userId: "billed-user",
        moduleType: "ai-research",
        operationType: "analysis",
        referenceId: "report-99",
        description: "Research billing",
      },
    });

    expect(mockCreditsService.consumeCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "billed-user",
        moduleType: "ai-research",
        operationType: "analysis",
        referenceId: "report-99",
        description: "Research billing",
      }),
    );
  });
});

// ============================================================
// chatStream() — circuit breaker OPEN
// ============================================================

describe("ChatFacade — chatStream() circuit breaker OPEN", () => {
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
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: buildOpenCircuitBreaker() },
        },
      ],
    }).compile();

    facade = module.get<ChatFacade>(ChatFacade);
  });

  it("should yield a single error chunk when circuit breaker is OPEN", async () => {
    const chunks: Array<{ content: string; done: boolean; error?: string }> =
      [];

    for await (const chunk of facade.chatStream({
      messages: [{ role: "user", content: "Test" }],
      model: "gpt-4o",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].done).toBe(true);
    expect(chunks[0].error).toBe("CIRCUIT_BREAKER_OPEN");
    expect(chunks[0].content).toContain("temporarily unavailable");
  });
});

// ============================================================
// chatStream() — stream throws (catch block)
// ============================================================

describe("ChatFacade — chatStream() catch block", () => {
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

  it("should yield error chunk when chatStream generator throws", async () => {
    mockAiChatService.chatStream = jest.fn().mockReturnValue(
      (async function* () {
        throw new Error("Stream connection lost");
      })(),
    );

    const chunks: Array<{ content: string; done: boolean; error?: string }> =
      [];
    for await (const chunk of facade.chatStream({
      messages: [{ role: "user", content: "Test" }],
    })) {
      chunks.push(chunk);
    }

    // Should have error chunk from catch block
    expect(
      chunks.some((c) => c.error && c.error.includes("Stream connection lost")),
    ).toBe(true);
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.done).toBe(true);
  });

  it("should yield error chunk with empty content when catch fires", async () => {
    mockAiChatService.chatStream = jest.fn().mockReturnValue(
      (async function* () {
        throw new Error("Unexpected stream error");
      })(),
    );

    const chunks: Array<{ content: string; done: boolean; error?: string }> =
      [];
    for await (const chunk of facade.chatStream({
      messages: [{ role: "user", content: "Hello" }],
    })) {
      chunks.push(chunk);
    }

    const errorChunk = chunks.find((c) => c.error);
    expect(errorChunk).toBeDefined();
    expect(errorChunk?.content).toBe("");
    expect(errorChunk?.done).toBe(true);
  });
});

// ============================================================
// resolveModelId() edge cases
// ============================================================

describe("ChatFacade — resolveModelId() edge cases", () => {
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

  it("should return empty string when modelType provided but getDefaultModelByType returns null", async () => {
    (mockAiChatService.getDefaultModelByType as jest.Mock).mockResolvedValue(
      null,
    );

    // chat() calls resolveModelId, which should return ""
    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
      modelType: AIModelType.CHAT,
      // no model provided
    });

    // Should still complete (with empty model ID)
    expect(result).toBeDefined();
    // AiChatService.chat was called
    expect(mockAiChatService.chat).toHaveBeenCalled();
  });
});

// ============================================================
// checkConstraints() — validateJsonSchema branches
// ============================================================

describe("ChatFacade — checkConstraints() JSON schema validation", () => {
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

  it("should fail when content is invalid JSON (jsonSchema check)", () => {
    const result = facade.checkConstraints({
      content: "this is not json",
      constraints: {
        jsonSchema: { type: "object" },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "json_schema",
          message: "Content is not valid JSON",
        }),
      ]),
    );
  });

  it("should fail when schema expects object but data is not an object", () => {
    const result = facade.checkConstraints({
      content: '"just a string"',
      constraints: {
        jsonSchema: { type: "object" },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations?.some((v) => v.type === "json_schema")).toBe(true);
  });

  it("should fail when schema expects array but data is not an array", () => {
    const result = facade.checkConstraints({
      content: '{"notAnArray": true}',
      constraints: {
        jsonSchema: { type: "array" },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations?.some((v) => v.type === "json_schema")).toBe(true);
  });

  it("should fail when required fields are missing from the JSON object", () => {
    const result = facade.checkConstraints({
      content: '{"name": "Alice"}',
      constraints: {
        jsonSchema: {
          type: "object",
          required: ["name", "email", "age"],
        },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations?.some((v) => v.type === "json_schema")).toBe(true);
  });

  it("should pass when all required fields are present", () => {
    const result = facade.checkConstraints({
      content: '{"name": "Alice", "email": "a@b.com", "age": 30}',
      constraints: {
        jsonSchema: {
          type: "object",
          required: ["name", "email", "age"],
        },
      },
    });

    expect(result.passed).toBe(true);
  });

  it("should pass for valid array content when schema expects array", () => {
    const result = facade.checkConstraints({
      content: "[1, 2, 3]",
      constraints: {
        jsonSchema: { type: "array" },
      },
    });

    expect(result.passed).toBe(true);
  });

  it("should pass when no constraints specified", () => {
    const result = facade.checkConstraints({
      content: "any content",
      constraints: {},
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toBeUndefined();
  });

  it("should provide adjustedContent when token limit is exceeded", () => {
    // Create content that exceeds token limit
    // estimateTokens: otherChars / 4 = content.length / 4
    // maxTokens: 10, so content needs > 40 characters
    const longContent = "A".repeat(500); // 500 chars → ~125 tokens

    const result = facade.checkConstraints({
      content: longContent,
      constraints: {
        maxTokens: 10, // very low to trigger violation
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations?.some((v) => v.type === "token_limit")).toBe(true);
    expect(result.adjustedContent).toBeDefined();
    expect(result.adjustedContent).toContain("[... content compressed ...]");
  });

  it("should not adjustContent when under token limit", () => {
    const result = facade.checkConstraints({
      content: "Short",
      constraints: {
        maxTokens: 1000, // well above estimate
      },
    });

    expect(result.passed).toBe(true);
    expect(result.adjustedContent).toBeUndefined();
  });
});

// ============================================================
// checkConstraints() — SENSITIVE_PATTERNS matching
// ============================================================

describe("ChatFacade — checkConstraints() sensitive content detection", () => {
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

  it("should detect password patterns in content", () => {
    const result = facade.checkConstraints({
      content: "The config has password: supersecret123",
      constraints: {
        contentFilter: { enabled: true },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations?.some((v) => v.type === "content_filter")).toBe(
      true,
    );
  });

  it("should detect bearer token patterns", () => {
    const result = facade.checkConstraints({
      content: "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.sometoken",
      constraints: {
        contentFilter: { enabled: true },
      },
    });

    expect(result.passed).toBe(false);
  });

  it("should not flag clean content", () => {
    const result = facade.checkConstraints({
      content: "This is a normal research query about climate change.",
      constraints: {
        contentFilter: { enabled: true },
      },
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toBeUndefined();
  });

  it("should not check sensitive patterns when contentFilter.enabled=false", () => {
    const result = facade.checkConstraints({
      content: "password: should_be_ignored",
      constraints: {
        contentFilter: { enabled: false },
      },
    });

    expect(result.passed).toBe(true);
  });
});
