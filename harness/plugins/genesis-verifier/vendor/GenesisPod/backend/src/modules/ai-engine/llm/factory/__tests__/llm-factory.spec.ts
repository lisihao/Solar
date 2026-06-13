/**
 * Unit Tests - LLMFactory
 */

import { LLMFactory } from "../llm.factory";
import {
  ILLMAdapter,
  LLM_PROVIDERS,
  LLM_MODELS,
} from "../../abstractions/llm-adapter.interface";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAdapter(
  id: string,
  supportedModels: string[] = [],
  defaultModel = "",
): ILLMAdapter {
  return {
    id,
    name: `${id} Adapter`,
    supportedModels,
    defaultModel,
    chat: jest.fn(),
    supportsModel: (model: string) => supportedModels.includes(model),
    getModelConfig: jest.fn().mockReturnValue(undefined),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LLMFactory", () => {
  let factory: LLMFactory;

  beforeEach(() => {
    factory = new LLMFactory();
  });

  // ─── initialize ──────────────────────────────────────────────────────────

  describe("initialize", () => {
    it("sets defaultProvider from config", () => {
      factory.initialize({ defaultProvider: LLM_PROVIDERS.ANTHROPIC });
      // Register anthropic adapter
      const adapter = makeAdapter(
        LLM_PROVIDERS.ANTHROPIC,
        [LLM_MODELS.CLAUDE_35_SONNET],
        LLM_MODELS.CLAUDE_35_SONNET,
      );
      factory.registerAdapter(adapter);

      expect(factory.getAdapter()).toBe(adapter);
    });

    it("sets defaultModel from config", () => {
      factory.initialize({ defaultModel: LLM_MODELS.GPT4O });
      const model = factory.getDefaultModel();
      expect(model).toBe(LLM_MODELS.GPT4O);
    });

    it("stores provider configs", () => {
      factory.initialize({
        providers: {
          [LLM_PROVIDERS.OPENAI]: { apiKey: "sk-test", enabled: true },
        } as never,
      });

      const config = factory.getProviderConfig(LLM_PROVIDERS.OPENAI);
      expect(config?.apiKey).toBe("sk-test");
    });

    it("is a no-op for undefined fields", () => {
      // Should not throw
      factory.initialize({});
      expect(factory.getAllAdapters()).toHaveLength(0);
    });
  });

  // ─── registerAdapter ─────────────────────────────────────────────────────

  describe("registerAdapter", () => {
    it("registers an adapter and makes it retrievable", () => {
      const adapter = makeAdapter("openai", [LLM_MODELS.GPT4O]);
      factory.registerAdapter(adapter);
      expect(factory.getAdapter("openai")).toBe(adapter);
    });

    it("overwrites an existing adapter with the same id", () => {
      const a1 = makeAdapter("openai", ["model-1"]);
      const a2 = makeAdapter("openai", ["model-2"]);
      factory.registerAdapter(a1);
      factory.registerAdapter(a2);
      expect(factory.getAdapter("openai")).toBe(a2);
    });
  });

  // ─── getAdapter ──────────────────────────────────────────────────────────

  describe("getAdapter", () => {
    it("returns undefined when no adapters are registered", () => {
      expect(factory.getAdapter()).toBeUndefined();
    });

    it("returns adapter by explicit providerId", () => {
      const a = makeAdapter("anthropic");
      factory.registerAdapter(a);
      expect(factory.getAdapter("anthropic")).toBe(a);
    });

    it("returns undefined for unknown providerId", () => {
      factory.registerAdapter(makeAdapter("openai"));
      expect(factory.getAdapter("unknown-provider")).toBeUndefined();
    });

    it("falls back to default provider adapter", () => {
      factory.initialize({ defaultProvider: LLM_PROVIDERS.OPENAI });
      const a = makeAdapter(LLM_PROVIDERS.OPENAI);
      factory.registerAdapter(a);
      expect(factory.getAdapter()).toBe(a);
    });

    it("falls back to first available adapter when default provider not registered", () => {
      factory.initialize({ defaultProvider: LLM_PROVIDERS.OPENAI });
      const a = makeAdapter("anthropic"); // not the default provider
      factory.registerAdapter(a);
      // Returns first adapter since openai isn't registered
      expect(factory.getAdapter()).toBe(a);
    });
  });

  // ─── getAdapterForModel ──────────────────────────────────────────────────

  describe("getAdapterForModel", () => {
    it("returns adapter that supports the given model", () => {
      const openai = makeAdapter("openai", [LLM_MODELS.GPT4O]);
      const anthropic = makeAdapter("anthropic", [LLM_MODELS.CLAUDE_35_SONNET]);
      factory.registerAdapter(openai);
      factory.registerAdapter(anthropic);

      expect(factory.getAdapterForModel(LLM_MODELS.GPT4O)).toBe(openai);
      expect(factory.getAdapterForModel(LLM_MODELS.CLAUDE_35_SONNET)).toBe(
        anthropic,
      );
    });

    it("returns undefined when no adapter supports the model", () => {
      factory.registerAdapter(makeAdapter("openai", [LLM_MODELS.GPT4O]));
      expect(factory.getAdapterForModel("unknown-model")).toBeUndefined();
    });

    it("returns undefined when no adapters registered", () => {
      expect(factory.getAdapterForModel(LLM_MODELS.GPT4O)).toBeUndefined();
    });
  });

  // ─── getAllAdapters ───────────────────────────────────────────────────────

  describe("getAllAdapters", () => {
    it("returns empty array when nothing registered", () => {
      expect(factory.getAllAdapters()).toEqual([]);
    });

    it("returns all registered adapters", () => {
      const a1 = makeAdapter("openai");
      const a2 = makeAdapter("anthropic");
      factory.registerAdapter(a1);
      factory.registerAdapter(a2);
      const all = factory.getAllAdapters();
      expect(all).toHaveLength(2);
      expect(all).toContain(a1);
      expect(all).toContain(a2);
    });
  });

  // ─── getSupportedModels ──────────────────────────────────────────────────

  describe("getSupportedModels", () => {
    it("returns empty array when no adapters", () => {
      expect(factory.getSupportedModels()).toEqual([]);
    });

    it("aggregates and deduplicates models from all adapters", () => {
      factory.registerAdapter(
        makeAdapter("openai", [LLM_MODELS.GPT4O, LLM_MODELS.GPT4O_MINI]),
      );
      factory.registerAdapter(
        makeAdapter("anthropic", [
          LLM_MODELS.CLAUDE_35_SONNET,
          LLM_MODELS.GPT4O,
        ]),
      );

      const models = factory.getSupportedModels();
      // GPT4O appears in both – should be deduplicated
      expect(models.filter((m) => m === LLM_MODELS.GPT4O)).toHaveLength(1);
      expect(models).toContain(LLM_MODELS.CLAUDE_35_SONNET);
    });
  });

  // ─── getDefaultModel ─────────────────────────────────────────────────────

  describe("getDefaultModel", () => {
    it("throws when no default configured and no adapters", () => {
      expect(() => factory.getDefaultModel()).toThrow(
        "No default AI model configured",
      );
    });

    it("returns defaultModel set via initialize()", () => {
      factory.initialize({ defaultModel: LLM_MODELS.GPT4O });
      expect(factory.getDefaultModel()).toBe(LLM_MODELS.GPT4O);
    });

    it("falls back to adapter defaultModel when no factory-level default", () => {
      const adapter = makeAdapter(
        "openai",
        [LLM_MODELS.GPT4O],
        LLM_MODELS.GPT4O,
      );
      factory.registerAdapter(adapter);
      factory.initialize({ defaultProvider: LLM_PROVIDERS.OPENAI });
      expect(factory.getDefaultModel()).toBe(LLM_MODELS.GPT4O);
    });

    it("throws when adapter.defaultModel is empty string", () => {
      const adapter = makeAdapter("openai", [LLM_MODELS.GPT4O], ""); // empty default
      factory.initialize({ defaultProvider: LLM_PROVIDERS.OPENAI });
      factory.registerAdapter(adapter);
      expect(() => factory.getDefaultModel()).toThrow(
        "No default AI model configured",
      );
    });
  });

  // ─── setDefaultModel ─────────────────────────────────────────────────────

  describe("setDefaultModel", () => {
    it("updates the default model", () => {
      factory.setDefaultModel(LLM_MODELS.GPT4O);
      expect(factory.getDefaultModel()).toBe(LLM_MODELS.GPT4O);
    });

    it("can be changed multiple times", () => {
      factory.setDefaultModel(LLM_MODELS.GPT4O);
      factory.setDefaultModel(LLM_MODELS.CLAUDE_35_SONNET);
      expect(factory.getDefaultModel()).toBe(LLM_MODELS.CLAUDE_35_SONNET);
    });
  });

  // ─── getProviderConfig ────────────────────────────────────────────────────

  describe("getProviderConfig", () => {
    it("returns undefined for unconfigured provider", () => {
      expect(factory.getProviderConfig(LLM_PROVIDERS.OPENAI)).toBeUndefined();
    });

    it("returns config after initialize()", () => {
      factory.initialize({
        providers: {
          [LLM_PROVIDERS.OPENAI]: {
            apiKey: "key123",
            enabled: true,
            baseUrl: "https://api.openai.com",
          },
        } as never,
      });
      const config = factory.getProviderConfig(LLM_PROVIDERS.OPENAI);
      expect(config?.apiKey).toBe("key123");
      expect(config?.enabled).toBe(true);
    });
  });

  // ─── isProviderAvailable ─────────────────────────────────────────────────

  describe("isProviderAvailable", () => {
    it("returns false for unconfigured provider", () => {
      expect(factory.isProviderAvailable(LLM_PROVIDERS.OPENAI)).toBe(false);
    });

    it("returns false when enabled is false", () => {
      factory.initialize({
        providers: {
          [LLM_PROVIDERS.OPENAI]: { apiKey: "key", enabled: false },
        } as never,
      });
      expect(factory.isProviderAvailable(LLM_PROVIDERS.OPENAI)).toBe(false);
    });

    it("returns false when apiKey is missing", () => {
      factory.initialize({
        providers: {
          [LLM_PROVIDERS.OPENAI]: { enabled: true },
        } as never,
      });
      expect(factory.isProviderAvailable(LLM_PROVIDERS.OPENAI)).toBe(false);
    });

    it("returns true when enabled and apiKey present", () => {
      factory.initialize({
        providers: {
          [LLM_PROVIDERS.OPENAI]: { apiKey: "sk-real-key", enabled: true },
        } as never,
      });
      expect(factory.isProviderAvailable(LLM_PROVIDERS.OPENAI)).toBe(true);
    });

    it("returns true when enabled is not explicitly set (defaults to available)", () => {
      factory.initialize({
        providers: {
          [LLM_PROVIDERS.OPENAI]: { apiKey: "sk-key" },
        } as never,
      });
      expect(factory.isProviderAvailable(LLM_PROVIDERS.OPENAI)).toBe(true);
    });
  });

  // ─── getAvailableProviders ────────────────────────────────────────────────

  describe("getAvailableProviders", () => {
    it("returns empty array when no providers configured", () => {
      expect(factory.getAvailableProviders()).toEqual([]);
    });

    it("returns only providers that are available", () => {
      factory.initialize({
        providers: {
          [LLM_PROVIDERS.OPENAI]: { apiKey: "sk-key", enabled: true },
          [LLM_PROVIDERS.ANTHROPIC]: { enabled: false }, // no key
          [LLM_PROVIDERS.GOOGLE]: { apiKey: "google-key" },
        } as never,
      });

      const available = factory.getAvailableProviders();
      expect(available).toContain(LLM_PROVIDERS.OPENAI);
      expect(available).toContain(LLM_PROVIDERS.GOOGLE);
      expect(available).not.toContain(LLM_PROVIDERS.ANTHROPIC);
    });
  });
});

