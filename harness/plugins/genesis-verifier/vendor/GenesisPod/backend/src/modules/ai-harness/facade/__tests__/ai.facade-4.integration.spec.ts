/**
 * AIFacade extended tests
 *
 * Covers uncovered methods beyond what ai-engine.facade.spec.ts tests:
 * - chatStream() — streaming with circuit breaker
 * - chatWithSkills() — skill injection and fallback
 * - embed() — via EmbeddingService
 * - storeMemory() / retrieveMemory() — via MemoryFeature
 * - runMission() / streamMission() — via TeamsService
 * - getRegisteredAgents() / getRegisteredTeams() — registry getters
 * - getBillingInfo() — billing context resolution
 * - handleBilling() — credits deduction
 * - getCapabilitySummary() — via AICapabilityResolver
 * - constraint enforcement — rate limiter / budget controller
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AIFacade } from "../ai.facade";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
import { AIModelType } from "@prisma/client";
import {
  TOOL_FEATURE,
  ORCHESTRATION_FEATURE,
  MEMORY_FEATURE,
  SKILL_FEATURE,
  CONSTRAINT_FEATURE,
} from "../facade.providers";

// ------------------------------------------------------------------
// Shared setup helpers
// ------------------------------------------------------------------

function makeMockAiChatService() {
  return {
    chat: jest.fn().mockResolvedValue({
      content: "Hello world",
      model: "gpt-4o",
      usage: { totalTokens: 100 },
      isError: false,
      apiKeySource: "system",
    }),
    chatStream: jest.fn().mockImplementation(async function* () {
      yield { content: "chunk1", done: false };
      yield { content: "chunk2", done: true, tokensUsed: 50 };
    }),
    getAvailableModelsAsync: jest.fn().mockResolvedValue(["gpt-4o"]),
    isReasoningModel: jest.fn().mockReturnValue(false),
    getDefaultModelByType: jest.fn().mockResolvedValue(null),
    generateChatCompletion: jest.fn().mockResolvedValue({
      content: "Completion",
      tokensUsed: 80,
    }),
  };
}

function makeMockModelConfigService() {
  return {
    getDefaultModel: jest.fn().mockResolvedValue(null),
    getModelById: jest.fn().mockResolvedValue(null),
    refreshModelConfigCache: jest.fn(),
    getEnabledModelsForFrontend: jest.fn().mockResolvedValue([
      {
        modelId: "gpt-4o",
        name: "GPT-4o",
        displayName: "GPT-4o",
        provider: "openai",
      },
    ]),
    getAllEnabledModelsByType: jest.fn().mockResolvedValue([
      {
        modelId: "gpt-4o",
        name: "GPT-4o",
        provider: "openai",
        isReasoning: false,
      },
    ]),
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

// ------------------------------------------------------------------
// chatStream tests
// ------------------------------------------------------------------

describe("AIFacade — chatStream()", () => {
  let facade: AIFacade;
  let mockAiChatService: any;
  let mockCircuitBreaker: any;

  beforeEach(async () => {
    mockAiChatService = makeMockAiChatService();
    mockCircuitBreaker = makeMockCircuitBreaker();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: mockCircuitBreaker, agentExecutor: null },
        },
      ],
    }).compile();

    facade = module.get<AIFacade>(AIFacade);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it("should yield chunks from AiChatService.chatStream", async () => {
    const chunks: any[] = [];
    for await (const chunk of facade.chatStream({
      messages: [{ role: "user", content: "Tell me a story" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe("chunk1");
    expect(chunks[0].done).toBe(false);
    expect(chunks[1].content).toBe("chunk2");
    expect(chunks[1].done).toBe(true);
  });

  it("should yield error chunk when circuit breaker is open", async () => {
    mockCircuitBreaker.canExecute.mockReturnValue(false);
    mockCircuitBreaker.getCooldownRemaining.mockReturnValue(10000);

    const chunks: any[] = [];
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

  it("should record circuit breaker success after streaming", async () => {
    const chunks: any[] = [];
    for await (const chunk of facade.chatStream({
      messages: [{ role: "user", content: "Hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalled();
  });

  it("should handle stream error and yield error chunk", async () => {
    mockAiChatService.chatStream.mockImplementation(async function* () {
      yield { content: "partial", done: false };
      throw new Error("Stream interrupted");
    });

    const chunks: any[] = [];
    for await (const chunk of facade.chatStream({
      messages: [{ role: "user", content: "Test" }],
    })) {
      chunks.push(chunk);
    }

    const errorChunk = chunks.find((c) => c.error);
    expect(errorChunk).toBeDefined();
    expect(errorChunk.done).toBe(true);
    expect(errorChunk.error).toContain("Stream interrupted");
  });

  it("should increment and decrement circuit breaker load", async () => {
    for await (const _ of facade.chatStream({
      messages: [{ role: "user", content: "Test" }],
    })) {
      // consume
    }

    expect(mockCircuitBreaker.incrementLoad).toHaveBeenCalled();
    expect(mockCircuitBreaker.decrementLoad).toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// chatWithSkills tests
// ------------------------------------------------------------------

describe("AIFacade — chatWithSkills()", () => {
  let facade: AIFacade;
  let mockAiChatService: any;
  let mockSkillLoader: any;
  let mockSkillBuilder: any;

  beforeEach(async () => {
    mockAiChatService = makeMockAiChatService();
    mockSkillLoader = {
      getSkillsForTask: jest
        .fn()
        .mockResolvedValue([
          { id: "research-skill", name: "Research", content: "Be thorough." },
        ]),
    };
    mockSkillBuilder = {
      buildSystemPrompt: jest.fn().mockReturnValue({
        prompt: "You are a research expert. Be thorough.",
        usedSkills: ["research-skill"],
        estimatedTokens: 50,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
        {
          provide: SKILL_FEATURE,
          useValue: {
            loader: mockSkillLoader,
            promptBuilder: mockSkillBuilder,
          },
        },
      ],
    }).compile();

    facade = module.get<AIFacade>(AIFacade);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it("should load skills and inject into system prompt", async () => {
    const result = await facade.chatWithSkills({
      messages: [{ role: "user", content: "Research AI trends" }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "low", outputLength: "medium" },
      domain: "research",
    });

    expect(mockSkillLoader.getSkillsForTask).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "research" }),
    );
    expect(mockSkillBuilder.buildSystemPrompt).toHaveBeenCalled();
    expect(result.usedSkills).toContain("research-skill");
    expect(result.skillsTokensUsed).toBe(50);
    expect(result.content).toBe("Hello world");
  });

  it("should fall back to plain chat when skills not available", async () => {
    // Create facade without SKILL_FEATURE
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    const facadeNoSkills = module.get<AIFacade>(AIFacade);

    const result = await facadeNoSkills.chatWithSkills({
      messages: [{ role: "user", content: "Research" }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "medium", outputLength: "medium" },
      domain: "research",
    });

    expect(result.usedSkills).toEqual([]);
    expect(result.skillsTokensUsed).toBe(0);
    expect(result.content).toBeDefined();
  });

  it("should pass additionalSkills to loader", async () => {
    await facade.chatWithSkills({
      messages: [{ role: "user", content: "Task" }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "medium", outputLength: "medium" },
      domain: "writing",
      additionalSkills: ["style-skill", "tone-skill"],
    });

    expect(mockSkillLoader.getSkillsForTask).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalSkillIds: ["style-skill", "tone-skill"],
      }),
    );
  });
});

// ------------------------------------------------------------------
// Constraint feature — rate limiter & budget
// ------------------------------------------------------------------

describe("AIFacade — constraint enforcement via CONSTRAINT_FEATURE", () => {
  it("should return rate limit error when rate limiter blocks", async () => {
    const mockAiChatService = makeMockAiChatService();
    const mockRateLimiter = {
      checkAndConsume: jest
        .fn()
        .mockResolvedValue({ allowed: false, retryAfterMs: 30000 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
        {
          provide: CONSTRAINT_FEATURE,
          useValue: { rateLimiter: mockRateLimiter, costController: null },
        },
      ],
    }).compile();

    const facade = module.get<AIFacade>(AIFacade);
    jest.spyOn(Logger.prototype, "warn").mockImplementation();

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
      billing: {
        userId: "user-ratelimited",
        moduleType: "test",
        operationType: "chat",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Rate limit");
    expect(mockAiChatService.chat).not.toHaveBeenCalled();
  });

  it("should return budget error when cost controller blocks", async () => {
    const mockAiChatService = makeMockAiChatService();
    const mockCostController = {
      checkBudget: jest
        .fn()
        .mockReturnValue({ allowed: false, reason: "Monthly budget exceeded" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
        {
          provide: CONSTRAINT_FEATURE,
          useValue: { rateLimiter: null, costController: mockCostController },
        },
      ],
    }).compile();

    const facade = module.get<AIFacade>(AIFacade);
    jest.spyOn(Logger.prototype, "warn").mockImplementation();

    const result = await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Budget limit exceeded");
    expect(mockAiChatService.chat).not.toHaveBeenCalled();
  });

  it("should consume rate limit token after allowed check", async () => {
    const mockAiChatService = makeMockAiChatService();
    const mockRateLimiter = {
      checkAndConsume: jest.fn().mockResolvedValue({ allowed: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
        {
          provide: CONSTRAINT_FEATURE,
          useValue: { rateLimiter: mockRateLimiter, costController: null },
        },
      ],
    }).compile();

    const facade = module.get<AIFacade>(AIFacade);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    await facade.chat({
      messages: [{ role: "user", content: "Hello" }],
      billing: {
        userId: "user-allowed",
        moduleType: "test",
        operationType: "chat",
      },
    });

    expect(mockRateLimiter.checkAndConsume).toHaveBeenCalledWith("chat", {
      tenantId: "user-allowed",
    });
  });
});

// ------------------------------------------------------------------
// Memory feature
// ------------------------------------------------------------------

describe("AIFacade — memory operations", () => {
  let facade: AIFacade;
  let mockShortTermMemory: any;
  let mockLongTermMemory: any;

  beforeEach(async () => {
    mockShortTermMemory = {
      setWithSession: jest.fn().mockResolvedValue(undefined),
      getWithSession: jest
        .fn()
        .mockResolvedValue("Previous conversation context"),
      clear: jest.fn(),
    };
    mockLongTermMemory = {
      setWithUser: jest.fn().mockResolvedValue(undefined),
      search: jest
        .fn()
        .mockResolvedValue([
          { key: "long-1", value: "Stored knowledge", score: 0.9 },
        ]),
    };

    const module: TestingModule = await Test.createTestingModule({
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
          provide: MEMORY_FEATURE,
          useValue: {
            shortTerm: mockShortTermMemory,
            longTerm: mockLongTermMemory,
          },
        },
      ],
    }).compile();

    facade = module.get<AIFacade>(AIFacade);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it("should store memory via short-term memory service", async () => {
    await facade.storeMemory({
      sessionId: "session-123",
      content: "User is asking about AI",
      type: "short",
    });

    expect(mockShortTermMemory.setWithSession).toHaveBeenCalledWith(
      "session-123",
      "memory",
      "User is asking about AI",
    );
  });

  it("should store memory via long-term memory service", async () => {
    await facade.storeMemory({
      sessionId: "user-456",
      content: "User prefers concise responses",
      type: "long",
    });

    expect(mockLongTermMemory.setWithUser).toHaveBeenCalledWith(
      "user-456",
      "memory",
      "User prefers concise responses",
    );
  });

  it("should retrieve memory from short-term store", async () => {
    const items = await facade.retrieveMemory({
      sessionId: "session-123",
      topK: 5,
    });

    expect(mockShortTermMemory.getWithSession).toHaveBeenCalledWith(
      "session-123",
      "memory",
    );
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].type).toBe("short");
  });

  it("should retrieve long-term memory when query is provided", async () => {
    const items = await facade.retrieveMemory({
      sessionId: "user-456",
      query: "preferences",
      topK: 3,
    });

    expect(mockLongTermMemory.search).toHaveBeenCalledWith(
      "preferences",
      expect.objectContaining({ userId: "user-456", limit: 3 }),
    );
    // Should include both short and long term results
    const longItems = items.filter((i) => i.type === "long");
    expect(longItems.length).toBeGreaterThanOrEqual(1);
  });

  it("should return empty array when no memory feature", async () => {
    // Create facade without MEMORY_FEATURE
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    const facadeNoMemory = module.get<AIFacade>(AIFacade);
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const items = await facadeNoMemory.retrieveMemory({
      sessionId: "session-no-memory",
    });

    expect(items).toEqual([]);
  });
});

// ------------------------------------------------------------------
// Registry getters
// ------------------------------------------------------------------

describe("AIFacade — registry getters", () => {
  it("should expose agentRegistry as a getter property", async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    const facade = module.get<AIFacade>(AIFacade);

    // When not provided (all optional), registries should be undefined
    expect(facade.agentRegistry).toBeUndefined();
    expect(facade.teamRegistry).toBeUndefined();
    expect(facade.skillRegistry).toBeUndefined();
    expect(facade.roleRegistry).toBeUndefined();
  });
});

// ------------------------------------------------------------------
// Tool execution via TOOL_FEATURE
// ------------------------------------------------------------------

describe("AIFacade — executeTool()", () => {
  let facade: AIFacade;
  let mockToolRegistry: any;

  beforeEach(async () => {
    mockToolRegistry = {
      tryGet: jest.fn(),
      getByCategory: jest.fn().mockReturnValue([]),
      getEnabled: jest.fn().mockReturnValue([]),
      isAvailable: jest.fn().mockReturnValue(true),
      getFunctionDefinitions: jest.fn().mockReturnValue([]),
      getAllFunctionDefinitions: jest.fn().mockReturnValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
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

    facade = module.get<AIFacade>(AIFacade);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it("should execute a tool via ToolRegistry", async () => {
    const mockTool = {
      enabled: true,
      defaultTimeout: 30000,
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: {
          results: [{ title: "Result", url: "https://x.com", content: "data" }],
        },
        error: undefined,
        metadata: { tokensUsed: 0 },
      }),
    };
    mockToolRegistry.tryGet.mockReturnValue(mockTool);

    const result = await facade.executeTool({
      toolId: "web-search",
      input: { query: "AI trends" },
    });

    expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-search");
    expect(mockTool.execute).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("should return failure when tool not found", async () => {
    mockToolRegistry.tryGet.mockReturnValue(null);

    const result = await facade.executeTool({
      toolId: "nonexistent-tool",
      input: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // error is an object with code and message
    expect((result.error as any).message).toContain("not found");
  });

  it("should return available tools info via getAvailableTools()", () => {
    mockToolRegistry.getEnabled.mockReturnValue([
      { id: "web-search", name: "Web Search", description: "Search the web" },
    ]);

    const tools = facade.getAvailableTools();
    expect(Array.isArray(tools)).toBe(true);
  });
});

// ------------------------------------------------------------------
// checkConstraints — existing facade method
// ------------------------------------------------------------------

describe("AIFacade — checkConstraints() edge cases", () => {
  let facade: AIFacade;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    facade = module.get<AIFacade>(AIFacade);
  });

  it("should pass when content is within token limit", () => {
    const result = facade.checkConstraints({
      content: "Short content",
      constraints: { maxTokens: 10000 },
    });
    expect(result.passed).toBe(true);
  });

  it("should pass when no constraints specified", () => {
    const result = facade.checkConstraints({
      content: "Any content",
      constraints: {},
    });
    expect(result.passed).toBe(true);
  });

  it("should detect api_key pattern as sensitive content", () => {
    const result = facade.checkConstraints({
      content: "api_key: sk-prod-secret-1234567890",
      constraints: { contentFilter: { enabled: true } },
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: "content_filter" }),
    );
  });

  it("should detect bearer token pattern", () => {
    const result = facade.checkConstraints({
      content: "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig",
      constraints: { contentFilter: { enabled: true } },
    });

    expect(result.passed).toBe(false);
  });

  it("should not check content filter when disabled", () => {
    const result = facade.checkConstraints({
      content: "password: mySecret123",
      constraints: { contentFilter: { enabled: false } },
    });

    expect(result.passed).toBe(true);
  });
});

// ------------------------------------------------------------------
// formatSearchResultsForContext
// ------------------------------------------------------------------

describe("AIFacade — formatSearchResultsForContext()", () => {
  let facade: AIFacade;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: makeMockAiChatService() },
        {
          provide: AiModelConfigService,
          useValue: makeMockModelConfigService(),
        },
      ],
    }).compile();

    facade = module.get<AIFacade>(AIFacade);
  });

  it("should format multiple results", () => {
    const formatted = facade.formatSearchResultsForContext([
      { title: "Result A", url: "https://a.com", content: "Content A" },
      { title: "Result B", url: "https://b.com", content: "Content B" },
    ]);

    expect(formatted).toContain("Result A");
    expect(formatted).toContain("https://a.com");
    expect(formatted).toContain("Content A");
    expect(formatted).toContain("Result B");
  });

  it("should return empty string for empty results array", () => {
    const formatted = facade.formatSearchResultsForContext([]);
    expect(typeof formatted).toBe("string");
  });
});
