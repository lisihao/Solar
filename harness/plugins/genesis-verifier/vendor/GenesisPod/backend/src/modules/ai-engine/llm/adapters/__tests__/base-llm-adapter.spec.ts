/**
 * Unit Tests - BaseLLMAdapter
 *
 * BaseLLMAdapter is abstract; we test it via a minimal concrete subclass.
 */

import { BaseLLMAdapter } from "../base-llm.adapter";
import {
  LLMRequestOptions,
  LLMResponse,
  LLMModelConfig,
  createLLMAdapter,
} from "../base-llm.adapter";

// ─── Concrete test subclass ───────────────────────────────────────────────────

class TestLLMAdapter extends BaseLLMAdapter {
  readonly id = "test-adapter";
  readonly name = "Test Adapter";
  readonly supportedModels = ["model-a", "model-b"];
  readonly defaultModel = "model-a";
  protected readonly modelConfigs = new Map<string, LLMModelConfig>([
    [
      "model-a",
      {
        id: "model-a",
        name: "Model A",
        maxTokens: 4096,
        contextWindow: 32768,
        supportsTools: true,
        supportsVision: false,
        supportsStreaming: true,
      },
    ],
  ]);

  async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    this.recordSuccess(options.maxTokens ?? 0);
    return {
      id: "test-id",
      content: "Hello!",
      finishReason: "stop",
      model: options.model ?? this.defaultModel,
      createdAt: new Date(),
    };
  }
}

class FailingLLMAdapter extends BaseLLMAdapter {
  readonly id = "failing-adapter";
  readonly name = "Failing Adapter";
  readonly supportedModels = ["model-x"];
  readonly defaultModel = "model-x";
  protected readonly modelConfigs = new Map<string, LLMModelConfig>();

  async chat(_options: LLMRequestOptions): Promise<LLMResponse> {
    this.recordFailure();
    throw new Error("Upstream failure");
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BaseLLMAdapter (via TestLLMAdapter)", () => {
  let adapter: TestLLMAdapter;

  beforeEach(() => {
    adapter = new TestLLMAdapter();
  });

  // ─── supportsModel ───────────────────────────────────────────────────────

  describe("supportsModel", () => {
    it("returns true for supported model", () => {
      expect(adapter.supportsModel("model-a")).toBe(true);
      expect(adapter.supportsModel("model-b")).toBe(true);
    });

    it("returns false for unsupported model", () => {
      expect(adapter.supportsModel("gpt-9000")).toBe(false);
    });
  });

  // ─── getModelConfig ──────────────────────────────────────────────────────

  describe("getModelConfig", () => {
    it("returns config for a known model", () => {
      const config = adapter.getModelConfig("model-a");
      expect(config).toBeDefined();
      expect(config?.id).toBe("model-a");
      expect(config?.maxTokens).toBe(4096);
    });

    it("returns undefined for an unknown model", () => {
      expect(adapter.getModelConfig("unknown-model")).toBeUndefined();
    });
  });

  // ─── countTokens ─────────────────────────────────────────────────────────

  describe("countTokens", () => {
    it("returns a positive integer for English text", () => {
      const tokens = adapter.countTokens("Hello, world!");
      expect(tokens).toBeGreaterThan(0);
      expect(Number.isInteger(tokens)).toBe(true);
    });

    it("counts Chinese characters with higher weight", () => {
      const chineseTokens = adapter.countTokens("你好世界");
      const englishTokens = adapter.countTokens("abcd");
      // 4 Chinese chars = 4*2 = 8 tokens; 4 English chars = ceil(4/4) = 1 token
      expect(chineseTokens).toBeGreaterThan(englishTokens);
    });

    it("returns 0 or more for empty string", () => {
      expect(adapter.countTokens("")).toBeGreaterThanOrEqual(0);
    });

    it("estimates correctly for a mixed string", () => {
      // "abc" = 3 other chars = ceil(3/4) = 1 token
      expect(adapter.countTokens("abc")).toBe(1);
    });
  });

  // ─── getStats ────────────────────────────────────────────────────────────

  describe("getStats", () => {
    it("returns zero stats on fresh adapter", () => {
      expect(adapter.getStats()).toEqual({
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        totalTokensUsed: 0,
      });
    });

    it("increments success stats after successful chat", async () => {
      await adapter.chat({
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 100,
      });
      const stats = adapter.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(0);
      expect(stats.totalTokensUsed).toBe(100);
    });

    it("does not add to tokensUsed when maxTokens is falsy", async () => {
      await adapter.chat({ messages: [{ role: "user", content: "Hi" }] });
      expect(adapter.getStats().totalTokensUsed).toBe(0);
    });
  });

  // ─── recordFailure ───────────────────────────────────────────────────────

  describe("recordFailure", () => {
    it("increments failure stats on error", async () => {
      const failing = new FailingLLMAdapter();
      await expect(
        failing.chat({ messages: [{ role: "user", content: "Hi" }] }),
      ).rejects.toThrow("Upstream failure");

      const stats = failing.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.failureCount).toBe(1);
      expect(stats.successCount).toBe(0);
    });
  });

  // ─── processOptions ──────────────────────────────────────────────────────

  describe("processOptions (via protected)", () => {
    it("fills in defaults for missing options", () => {
      const process = (
        adapter as unknown as {
          processOptions(o: LLMRequestOptions): LLMRequestOptions;
        }
      ).processOptions;

      const result = process.call(adapter, { messages: [] });
      expect(result.model).toBe("model-a");
      expect(result.temperature).toBe(0.7);
      expect(result.maxTokens).toBe(4096);
    });

    it("preserves explicitly provided options", () => {
      const process = (
        adapter as unknown as {
          processOptions(o: LLMRequestOptions): LLMRequestOptions;
        }
      ).processOptions;

      const result = process.call(adapter, {
        messages: [],
        model: "model-b",
        temperature: 0.1,
        maxTokens: 2048,
      });
      expect(result.model).toBe("model-b");
      expect(result.temperature).toBe(0.1);
      expect(result.maxTokens).toBe(2048);
    });

    it("sets temperature to 0 when explicitly passed 0", () => {
      const process = (
        adapter as unknown as {
          processOptions(o: LLMRequestOptions): LLMRequestOptions;
        }
      ).processOptions;

      const result = process.call(adapter, { messages: [], temperature: 0 });
      expect(result.temperature).toBe(0);
    });
  });

  // ─── chatStream default throws ────────────────────────────────────────────

  describe("chatStream default implementation", () => {
    it("throws an error if chatStream is called on base class", async () => {
      // TestLLMAdapter inherits the default chatStream? implementation
      // The optional method is defined on BaseLLMAdapter.
      const stream = adapter.chatStream?.({
        messages: [{ role: "user", content: "Hi" }],
      });
      if (stream) {
        await expect(stream.next()).rejects.toThrow(
          "Streaming not supported by this adapter",
        );
      }
    });
  });
});

// ─── createLLMAdapter factory function ───────────────────────────────────────

describe("createLLMAdapter", () => {
  const chatFn = jest.fn().mockResolvedValue({
    id: "resp-1",
    content: "World",
    finishReason: "stop",
    model: "custom-model",
    createdAt: new Date(),
  });

  const adapter = createLLMAdapter({
    id: "custom",
    name: "Custom Adapter",
    supportedModels: ["custom-model"],
    defaultModel: "custom-model",
    chat: chatFn,
  });

  it("has the correct id and name", () => {
    expect(adapter.id).toBe("custom");
    expect(adapter.name).toBe("Custom Adapter");
  });

  it("supportsModel correctly", () => {
    expect(adapter.supportsModel("custom-model")).toBe(true);
    expect(adapter.supportsModel("other-model")).toBe(false);
  });

  it("getModelConfig always returns undefined", () => {
    expect(adapter.getModelConfig("custom-model")).toBeUndefined();
  });

  it("delegates chat() to the provided function", async () => {
    const result = await adapter.chat({
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.content).toBe("World");
    expect(chatFn).toHaveBeenCalledTimes(1);
  });
});

