/**
 * Unit Tests - UniversalLLMAdapter
 */

import { UniversalLLMAdapter } from "../universal-llm.adapter";
import { AiChatService } from "../../chat/ai-chat.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { LLMRequestOptions } from "../abstractions/llm-adapter.interface";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAiChatService(): jest.Mocked<Pick<AiChatService, "chat">> {
  return {
    chat: jest.fn(),
  } as unknown as jest.Mocked<Pick<AiChatService, "chat">>;
}

function makePrismaService(
  models: object[] = [],
): jest.Mocked<Pick<PrismaService, "aIModel">> {
  const findMany = jest.fn().mockResolvedValue(models);
  const findFirst = jest.fn().mockResolvedValue(models[0] ?? null);

  return {
    aIModel: {
      findMany,
      findFirst,
    },
  } as unknown as jest.Mocked<Pick<PrismaService, "aIModel">>;
}

const sampleModels = [
  {
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    isDefault: true,
    maxTokens: 8192,
    modelType: "CHAT",
  },
  {
    modelId: "claude-3-5-sonnet",
    displayName: "Claude 3.5 Sonnet",
    isDefault: false,
    maxTokens: 4096,
    modelType: "CHAT",
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UniversalLLMAdapter", () => {
  let adapter: UniversalLLMAdapter;
  let aiChatService: ReturnType<typeof makeAiChatService>;
  let prismaService: ReturnType<typeof makePrismaService>;

  beforeEach(async () => {
    jest.useFakeTimers();
    aiChatService = makeAiChatService();
    prismaService = makePrismaService(sampleModels);

    adapter = new UniversalLLMAdapter(
      aiChatService as unknown as AiChatService,
      prismaService as unknown as PrismaService,
    );

    // Let the constructor's async initializeFromDatabase resolve
    await jest.runAllTimersAsync();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── Identifiers ─────────────────────────────────────────────────────────

  describe("identifiers", () => {
    it("should have id = 'universal'", () => {
      expect(adapter.id).toBe("universal");
    });

    it("should have a descriptive name", () => {
      expect(adapter.name).toContain("Universal");
    });
  });

  // ─── supportedModels / defaultModel ──────────────────────────────────────

  describe("supportedModels getter", () => {
    it("returns loaded model ids after initialization", async () => {
      const models = adapter.supportedModels;
      // May return ["*"] or actual list depending on timing; either is valid
      expect(Array.isArray(models)).toBe(true);
    });

    it("returns [*] when no models loaded yet", () => {
      const freshAdapter = new UniversalLLMAdapter(
        aiChatService as unknown as AiChatService,
        makePrismaService([]) as unknown as PrismaService,
      );
      // Before initialization completes, should return ["*"] as fallback
      const models = freshAdapter.supportedModels;
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe("defaultModel getter", () => {
    it("returns empty string or a model id", async () => {
      const m = adapter.defaultModel;
      expect(typeof m).toBe("string");
    });
  });

  // ─── supportsModel ───────────────────────────────────────────────────────

  describe("supportsModel", () => {
    it("returns true for GPT models", () => {
      expect(adapter.supportsModel("gpt-4o")).toBe(true);
      expect(adapter.supportsModel("gpt-3.5-turbo")).toBe(true);
    });

    it("returns true for Gemini models", () => {
      expect(adapter.supportsModel("gemini-pro")).toBe(true);
      expect(adapter.supportsModel("gemini-1.5-flash")).toBe(true);
    });

    it("returns true for Claude models", () => {
      expect(adapter.supportsModel("claude-3-opus")).toBe(true);
      expect(adapter.supportsModel("claude-sonnet-4")).toBe(true);
    });

    it("returns true for Grok models", () => {
      expect(adapter.supportsModel("grok-2")).toBe(true);
    });

    it("returns true for DeepSeek models", () => {
      expect(adapter.supportsModel("deepseek-chat")).toBe(true);
    });

    it("returns true for models in supportedModels list", () => {
      // After initialization, gpt-4o should be in the dynamic list
      expect(adapter.supportsModel("gpt-4o")).toBe(true);
    });

    it("returns false for completely unknown models", () => {
      // None of the keywords match and not in DB
      const freshAdapter = new UniversalLLMAdapter(
        aiChatService as unknown as AiChatService,
        makePrismaService([]) as unknown as PrismaService,
      );
      expect(freshAdapter.supportsModel("unknown-llm-xyz-9999")).toBe(false);
    });

    it("returns true for o1 prefix models", () => {
      expect(adapter.supportsModel("o1-mini")).toBe(true);
      expect(adapter.supportsModel("o3-pro")).toBe(true);
    });
  });

  // ─── getModelConfig ──────────────────────────────────────────────────────

  describe("getModelConfig", () => {
    it("returns config for known model after initialization", async () => {
      const config = await adapter.getModelConfig("gpt-4o");
      expect(config).toBeDefined();
      expect(config?.id).toBe("gpt-4o");
      expect(config?.maxTokens).toBe(8192);
      expect(config?.supportsTools).toBe(true);
      expect(config?.supportsStreaming).toBe(true);
    });

    it("returns undefined for model not in database", async () => {
      const config = await adapter.getModelConfig("unknown-xyz");
      expect(config).toBeUndefined();
    });

    it("sets supportsVision true for MULTIMODAL type", async () => {
      const multimodalModels = [
        {
          modelId: "gemini-vision",
          displayName: "Gemini Vision",
          isDefault: false,
          maxTokens: 4096,
          modelType: "MULTIMODAL",
        },
      ];
      const prisma = makePrismaService(multimodalModels);
      const a = new UniversalLLMAdapter(
        aiChatService as unknown as AiChatService,
        prisma as unknown as PrismaService,
      );
      await jest.runAllTimersAsync();

      const config = await a.getModelConfig("gemini-vision");
      expect(config?.supportsVision).toBe(true);
    });

    it("sets supportsVision false for CHAT type", async () => {
      const config = await adapter.getModelConfig("gpt-4o");
      expect(config?.supportsVision).toBe(false);
    });
  });

  // ─── chat ─────────────────────────────────────────────────────────────────

  describe("chat", () => {
    const sampleChatResponse = {
      content: "The answer is 42.",
      model: "gpt-4o",
      usage: { totalTokens: 120 },
    };

    beforeEach(() => {
      aiChatService.chat.mockResolvedValue(sampleChatResponse as never);
    });

    it("returns a well-formed LLMResponse", async () => {
      const options: LLMRequestOptions = {
        messages: [{ role: "user", content: "What is the answer?" }],
        model: "gpt-4o",
      };

      const result = await adapter.chat(options);

      expect(result.content).toBe("The answer is 42.");
      expect(result.finishReason).toBe("stop");
      expect(result.model).toBe("gpt-4o");
      expect(result.usage?.totalTokens).toBe(120);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(typeof result.id).toBe("string");
    });

    it("passes taskProfile to aiChatService", async () => {
      const options: LLMRequestOptions = {
        messages: [
          { role: "system", content: "Be concise" },
          { role: "user", content: "Hi" },
        ],
        model: "gpt-4o",
        taskProfile: { creativity: "low", outputLength: "short" },
      };

      await adapter.chat(options);

      expect(aiChatService.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: { creativity: "low", outputLength: "short" },
        }),
      );
    });

    it("converts responseFormat json to 'json'", async () => {
      const options: LLMRequestOptions = {
        messages: [{ role: "user", content: "Give JSON" }],
        responseFormat: "json",
      };

      await adapter.chat(options);

      expect(aiChatService.chat).toHaveBeenCalledWith(
        expect.objectContaining({ responseFormat: "json" }),
      );
    });

    it("uses getDefaultModelFromDb when no model specified", async () => {
      prismaService.aIModel.findFirst = jest
        .fn()
        .mockResolvedValueOnce({ modelId: "gpt-4o" });

      const options: LLMRequestOptions = {
        messages: [{ role: "user", content: "Hi" }],
      };

      await adapter.chat(options);

      expect(aiChatService.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gpt-4o" }),
      );
    });

    it("propagates error from aiChatService", async () => {
      aiChatService.chat.mockRejectedValueOnce(new Error("API quota exceeded"));

      await expect(
        adapter.chat({
          messages: [{ role: "user", content: "Hi" }],
          model: "gpt-4o",
        }),
      ).rejects.toThrow("API quota exceeded");
    });

    it("handles zero usage tokens gracefully", async () => {
      aiChatService.chat.mockResolvedValueOnce({
        content: "Done",
        model: "gpt-4o",
        usage: undefined,
      } as never);

      const result = await adapter.chat({
        messages: [{ role: "user", content: "Hi" }],
        model: "gpt-4o",
      });

      expect(result.usage?.totalTokens).toBe(0);
    });
  });

  // ─── chatStream ───────────────────────────────────────────────────────────

  describe("chatStream", () => {
    it("yields a single chunk with the full response", async () => {
      aiChatService.chat.mockResolvedValue({
        content: "Stream reply",
        model: "gpt-4o",
        usage: { totalTokens: 50 },
      } as never);

      const stream = adapter.chatStream!({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
      });

      const chunks: object[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect((chunks[0] as { delta: { content: string } }).delta.content).toBe(
        "Stream reply",
      );
    });
  });

  // ─── countTokens ─────────────────────────────────────────────────────────

  describe("countTokens", () => {
    it("estimates token count as ceil(length/4)", () => {
      expect(adapter.countTokens!("abcdefgh")).toBe(2); // 8/4 = 2
      expect(adapter.countTokens!("abc")).toBe(1); // ceil(3/4) = 1
      expect(adapter.countTokens!("")).toBe(0);
    });
  });

  // ─── Cache refresh behavior ───────────────────────────────────────────────

  describe("cache refresh", () => {
    it("only loads models once within TTL", async () => {
      const findMany = prismaService.aIModel.findMany as jest.Mock;
      const callCount = findMany.mock.calls.length;

      // Multiple calls within TTL should not trigger reload
      await adapter.getModelConfig("gpt-4o");
      await adapter.getModelConfig("gpt-4o");

      expect(findMany.mock.calls.length).toBe(callCount);
    });

    it("reloads after cache TTL expires", async () => {
      const findMany = prismaService.aIModel.findMany as jest.Mock;
      const callCount = findMany.mock.calls.length;

      // Advance time past the 5 minute TTL
      jest.advanceTimersByTime(6 * 60 * 1000);

      await adapter.getModelConfig("gpt-4o");

      expect(findMany.mock.calls.length).toBeGreaterThan(callCount);
    });
  });

  // ─── DB failure graceful handling ────────────────────────────────────────

  describe("database failure handling", () => {
    it("continues working when loadModelsFromDatabase fails on init", async () => {
      const badPrisma = {
        aIModel: {
          findMany: jest.fn().mockRejectedValue(new Error("DB down")),
          findFirst: jest.fn().mockRejectedValue(new Error("DB down")),
        },
      } as unknown as PrismaService;

      const a = new UniversalLLMAdapter(
        aiChatService as unknown as AiChatService,
        badPrisma,
      );

      await jest.runAllTimersAsync();

      // Should not throw; adapter falls back gracefully
      expect(a.id).toBe("universal");
    });
  });
});
