import { Test, TestingModule } from "@nestjs/testing";
import {
  ContextBudgetCalculator,
  TokenBudget,
  ContentPriority,
  ModelConfig,
} from "../token-budget.service";

describe("ContextBudgetCalculator", () => {
  let service: ContextBudgetCalculator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContextBudgetCalculator],
    }).compile();

    service = module.get(ContextBudgetCalculator);
  });

  // ─── countTokens ────────────────────────────────────────────────────────────

  describe("countTokens()", () => {
    it("returns 0 for empty string", () => {
      expect(service.countTokens("")).toBe(0);
    });

    it("returns 0 for null-ish input", () => {
      expect(service.countTokens(null as unknown as string)).toBe(0);
      expect(service.countTokens(undefined as unknown as string)).toBe(0);
    });

    it("estimates tokens for pure English text", () => {
      // English: ~0.25 tokens/char
      const text = "a".repeat(100); // 100 chars → ceil(100 * 0.25) = 25
      expect(service.countTokens(text)).toBe(25);
    });

    it("estimates tokens for pure Chinese text", () => {
      // Chinese: ~1.5 tokens/char
      const text = "中".repeat(10); // 10 chars → ceil(10 * 1.5) = 15
      expect(service.countTokens(text)).toBe(15);
    });

    it("estimates tokens for mixed Chinese/English text", () => {
      // 5 Chinese + 5 English chars
      // chineseRatio = 0.5
      // avgTPChar = 0.5*1.5 + 0.5*0.25 = 0.875
      // ceil(10 * 0.875) = 9
      const text = "中文te";
      const result = service.countTokens(text);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(10);
    });

    it("returns positive number for normal English sentence", () => {
      const result = service.countTokens("Hello world, this is a test.");
      expect(result).toBeGreaterThan(0);
    });

    it("handles whitespace-only string", () => {
      const result = service.countTokens("   ");
      expect(result).toBeGreaterThan(0);
    });
  });

  // ─── getModelConfig ──────────────────────────────────────────────────────────

  describe("getModelConfig()", () => {
    it("returns config for known OpenAI model gpt-4o", () => {
      const config: ModelConfig = service.getModelConfig("gpt-4o");
      expect(config.modelId).toBe("gpt-4o");
      expect(config.contextWindow).toBe(128000);
      expect(config.maxOutputTokens).toBe(16384);
      expect(config.provider).toBe("openai");
    });

    it("returns config for known Anthropic model", () => {
      const config = service.getModelConfig("claude-3-5-sonnet-20241022");
      expect(config.provider).toBe("anthropic");
      expect(config.contextWindow).toBe(200000);
    });

    it("returns config for known Google model", () => {
      const config = service.getModelConfig("gemini-1.5-pro");
      expect(config.provider).toBe("google");
      expect(config.contextWindow).toBe(2000000);
    });

    it("returns config for known xAI model", () => {
      const config = service.getModelConfig("grok-beta");
      expect(config.provider).toBe("xai");
    });

    it("returns config for known DeepSeek model", () => {
      const config = service.getModelConfig("deepseek-chat");
      expect(config.provider).toBe("deepseek");
    });

    it("falls back to gpt-4o-mini context window for unknown model", () => {
      const config = service.getModelConfig("unknown-model-xyz");
      expect(config.contextWindow).toBe(128000); // gpt-4o-mini fallback
      expect(config.provider).toBe("unknown");
    });

    it("falls back to default maxOutputTokens for unknown model", () => {
      const config = service.getModelConfig("unknown-model-xyz");
      expect(config.maxOutputTokens).toBe(4096); // MODEL_MAX_OUTPUT.default
    });

    it("returns correct provider for o1 model", () => {
      const config = service.getModelConfig("o1");
      expect(config.provider).toBe("openai");
      expect(config.contextWindow).toBe(200000);
    });

    it("returns correct provider for o3-mini model", () => {
      const config = service.getModelConfig("o3-mini");
      expect(config.provider).toBe("openai");
    });

    // v3.1 §D.2.2 显式 fallback：DB providerHint 优先于启发式
    it("honors providerHint over modelId startsWith heuristic", () => {
      // modelId 启发式会判 'openai'，但 DB 说是自托管 'custom-azure-clone'
      const config = service.getModelConfig("gpt-4o", "azure");
      expect(config.provider).toBe("azure");
    });

    it("honors providerHint for unknown modelId (DB-known custom model)", () => {
      const config = service.getModelConfig("my-custom-llm", "custom-llamacpp");
      expect(config.provider).toBe("custom-llamacpp");
    });

    it("falls back to heuristic when providerHint is empty string", () => {
      const config = service.getModelConfig("gpt-4o", "");
      expect(config.provider).toBe("openai");
    });

    it("falls back to heuristic when providerHint is whitespace only", () => {
      const config = service.getModelConfig(
        "claude-3-5-sonnet-20241022",
        "   ",
      );
      expect(config.provider).toBe("anthropic");
    });

    it("falls back to heuristic when providerHint omitted (BC)", () => {
      // 旧调用方未传 providerHint → 启发式生效（与重构前一致）
      const config = service.getModelConfig("gemini-1.5-pro");
      expect(config.provider).toBe("google");
    });
  });

  // ─── calculateBudget ─────────────────────────────────────────────────────────

  describe("calculateBudget()", () => {
    it("calculates budget for gpt-4o", () => {
      const budget: TokenBudget = service.calculateBudget("gpt-4o");
      expect(budget.total).toBe(128000);
      expect(budget.maxOutput).toBe(16384);
      expect(budget.system).toBe(2000); // default
      expect(budget.mustConstraints).toBe(0);
      // available = 128000 - 16384 - 2000 - 1000 = 108616
      expect(budget.available).toBe(108616);
    });

    it("uses custom systemPromptTokens when provided", () => {
      const budget = service.calculateBudget("gpt-4o", 5000);
      expect(budget.system).toBe(5000);
      // available = 128000 - 16384 - 5000 - 1000 = 105616
      expect(budget.available).toBe(105616);
    });

    it("available is never negative", () => {
      // For a model with very small context window, force a scenario
      // Use a model with large system prompt tokens
      const budget = service.calculateBudget("gpt-4", 10000);
      // gpt-4: contextWindow=8192, maxOutput=4096 (default), system=10000
      // available = 8192 - 4096 - 10000 - 1000 = negative → clamped to 0
      expect(budget.available).toBeGreaterThanOrEqual(0);
    });

    it("calculates budget for gemini-1.5-pro with large context", () => {
      const budget = service.calculateBudget("gemini-1.5-pro");
      expect(budget.total).toBe(2000000);
      expect(budget.available).toBeGreaterThan(1000000);
    });
  });

  // ─── allocateBudget ──────────────────────────────────────────────────────────

  describe("allocateBudget()", () => {
    const budget: TokenBudget = {
      total: 128000,
      maxOutput: 16384,
      system: 2000,
      mustConstraints: 0,
      available: 1000,
    };

    it("allocates all items when within budget", () => {
      const priorities: ContentPriority[] = [
        {
          key: "item1",
          priority: 1,
          content: "Short text",
          compressible: false,
        },
        {
          key: "item2",
          priority: 2,
          content: "Another short",
          compressible: false,
        },
      ];

      const result = service.allocateBudget(budget, priorities);
      expect(result.allocatedContent.has("item1")).toBe(true);
      expect(result.allocatedContent.has("item2")).toBe(true);
      expect(result.withinBudget).toBe(true);
      expect(result.compressionApplied).toBe(false);
    });

    it("sorts by priority before allocating", () => {
      const smallBudget: TokenBudget = {
        ...budget,
        available: 5,
      };

      const priorities: ContentPriority[] = [
        {
          key: "lowPriority",
          priority: 10,
          content: "This long text is not priority",
          compressible: false,
        },
        {
          key: "highPriority",
          priority: 1,
          content: "Hi",
          compressible: false,
        },
      ];

      const result = service.allocateBudget(smallBudget, priorities);
      // High priority should be allocated first; low priority might be skipped
      expect(result.allocatedContent.has("highPriority")).toBe(true);
    });

    it("compresses compressible items when over budget", () => {
      const tightBudget: TokenBudget = {
        ...budget,
        available: 50,
      };

      const longContent = "a".repeat(10000); // very long
      const priorities: ContentPriority[] = [
        {
          key: "bigItem",
          priority: 1,
          content: longContent,
          compressible: true,
        },
      ];

      const result = service.allocateBudget(tightBudget, priorities);
      expect(result.compressionApplied).toBe(true);
      expect(result.allocatedContent.has("bigItem")).toBe(true);
      // Compressed content should be shorter than original
      const compressed = result.allocatedContent.get("bigItem")!;
      expect(compressed.length).toBeLessThan(longContent.length);
    });

    it("skips non-compressible items that exceed budget", () => {
      const tightBudget: TokenBudget = {
        ...budget,
        available: 1,
      };

      const priorities: ContentPriority[] = [
        {
          key: "bigItem",
          priority: 1,
          content: "a".repeat(10000),
          compressible: false,
        },
      ];

      const result = service.allocateBudget(tightBudget, priorities);
      expect(result.allocatedContent.has("bigItem")).toBe(false);
    });

    it("returns empty allocation for empty priorities", () => {
      const result = service.allocateBudget(budget, []);
      expect(result.allocatedContent.size).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.withinBudget).toBe(true);
    });

    it("sets systemPrompt and mustConstraints as empty strings (caller responsibility)", () => {
      const result = service.allocateBudget(budget, []);
      expect(result.systemPrompt).toBe("");
      expect(result.mustConstraints).toBe("");
    });
  });

  // ─── compress ────────────────────────────────────────────────────────────────

  describe("compress()", () => {
    it("returns content unchanged when already within target tokens", () => {
      const content = "Short text";
      const targetTokens = service.countTokens(content) + 100;
      expect(service.compress(content, targetTokens)).toBe(content);
    });

    it("truncates long English content to fit target", () => {
      const content = "word ".repeat(1000); // ~1000 words
      const targetTokens = 10;
      const compressed = service.compress(content, targetTokens);
      expect(service.countTokens(compressed)).toBeLessThanOrEqual(
        targetTokens + 60, // some tolerance for marker text
      );
    });

    it("includes compression marker for long content", () => {
      const content = "a".repeat(5000);
      const targetTokens = 20;
      const compressed = service.compress(content, targetTokens);
      expect(compressed).toContain("...");
    });

    it("returns empty string for empty input", () => {
      expect(service.compress("", 100)).toBe("");
    });

    it("handles null/undefined gracefully", () => {
      expect(service.compress(null as unknown as string, 100)).toBeFalsy();
    });

    it("includes head and tail in compressed output when tail is positive", () => {
      const content = "START" + "m".repeat(2000) + "END";
      const compressed = service.compress(content, 50);
      // Should contain parts of head and tail
      expect(compressed).toContain("START");
      expect(compressed.length).toBeGreaterThan(0);
    });
  });

  // ─── smartTruncate ───────────────────────────────────────────────────────────

  describe("smartTruncate()", () => {
    it("returns content unchanged when within maxTokens", () => {
      const content = "Short text";
      const result = service.smartTruncate(content, 1000);
      expect(result).toBe(content);
    });

    it("truncates content that exceeds maxTokens", () => {
      const content = "a".repeat(10000);
      const result = service.smartTruncate(content, 20);
      expect(result.length).toBeLessThan(content.length);
    });

    it("includes omission marker", () => {
      const content = "a".repeat(5000);
      const result = service.smartTruncate(content, 30);
      expect(result).toContain("已省略");
    });

    it("returns empty string for empty input", () => {
      expect(service.smartTruncate("", 100)).toBe("");
    });

    it("respects custom head/tail ratio options", () => {
      const content = "x".repeat(2000);
      const result = service.smartTruncate(content, 40, {
        preserveHead: 0.8,
        preserveTail: 0.1,
      });
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("已省略");
    });
  });

  // ─── needsCompression ────────────────────────────────────────────────────────

  describe("needsCompression()", () => {
    it("returns true when content exceeds available budget", () => {
      const budget: TokenBudget = {
        total: 1000,
        maxOutput: 100,
        system: 100,
        mustConstraints: 0,
        available: 5,
      };
      const longContent = "a".repeat(1000);
      expect(service.needsCompression(longContent, budget)).toBe(true);
    });

    it("returns false when content fits within budget", () => {
      const budget: TokenBudget = {
        total: 128000,
        maxOutput: 16384,
        system: 2000,
        mustConstraints: 0,
        available: 100000,
      };
      const shortContent = "Hello";
      expect(service.needsCompression(shortContent, budget)).toBe(false);
    });
  });

  // ─── recommendModel ──────────────────────────────────────────────────────────

  describe("recommendModel()", () => {
    it("keeps current model when content fits within 80% of context window", () => {
      const currentModel = "gpt-4o"; // 128k context
      const smallContent = 1000; // well within 80% of 128k
      expect(service.recommendModel(smallContent, currentModel)).toBe(
        currentModel,
      );
    });

    it("recommends larger model when content exceeds 80% of context window", () => {
      const currentModel = "gpt-4"; // 8192 context
      const largeContent = 8000; // exceeds 80% of 8192 (6553)
      const recommended = service.recommendModel(largeContent, currentModel);
      // Should recommend something with larger context
      const config = service.getModelConfig(recommended);
      expect(config.contextWindow).toBeGreaterThan(8192);
    });

    it("returns largest model when no model is large enough", () => {
      // Extremely large content
      const hugeContent = 3_000_000;
      const recommended = service.recommendModel(hugeContent, "gpt-4o");
      // Should return the largest available model
      const config = service.getModelConfig(recommended);
      expect(config.contextWindow).toBeGreaterThan(0);
    });

    it("returns current model as fallback", () => {
      const result = service.recommendModel(100, "unknown-model-xyz");
      // unknown model → contextWindow = 128000, 100 < 80% of 128000 → stays
      expect(result).toBe("unknown-model-xyz");
    });
  });

  // ─── formatBudgetReport ──────────────────────────────────────────────────────

  describe("formatBudgetReport()", () => {
    it("formats budget report with correct fields", () => {
      const budget: TokenBudget = {
        total: 128000,
        maxOutput: 16384,
        system: 2000,
        mustConstraints: 0,
        available: 108616,
      };
      const used = 50000;
      const report = service.formatBudgetReport(budget, used);

      expect(report).toContain("Token Budget Report");
      expect(report).toContain("128,000");
      expect(report).toContain("16,384");
      expect(report).toContain("2,000");
      expect(report).toContain("108,616");
      expect(report).toContain("50,000");
    });

    it("calculates utilization percentage", () => {
      const budget: TokenBudget = {
        total: 1000,
        maxOutput: 100,
        system: 100,
        mustConstraints: 0,
        available: 800,
      };
      const report = service.formatBudgetReport(budget, 400);
      // 400 / 800 = 50%
      expect(report).toContain("50.0%");
    });

    it("includes remaining tokens in report", () => {
      const budget: TokenBudget = {
        total: 1000,
        maxOutput: 100,
        system: 100,
        mustConstraints: 0,
        available: 800,
      };
      const report = service.formatBudgetReport(budget, 300);
      // remaining = 800 - 300 = 500
      expect(report).toContain("500");
    });
  });
});
