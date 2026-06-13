import { Test, TestingModule } from "@nestjs/testing";
import { AiChatTokenService } from "../ai-chat-token.service";

describe("AiChatTokenService", () => {
  let service: AiChatTokenService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiChatTokenService],
    }).compile();

    service = module.get<AiChatTokenService>(AiChatTokenService);
  });

  // ==================== estimateTokenCount ====================

  describe("estimateTokenCount", () => {
    it("should estimate tokens for English text", () => {
      // "Hello World" = 11 chars / 4 = ~3
      const result = service.estimateTokenCount("Hello World");
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(10);
    });

    it("should estimate tokens for Chinese text", () => {
      // 5 Chinese chars => 5 / 1.5 = ~4
      const result = service.estimateTokenCount("你好世界吗");
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(10);
    });

    it("should handle mixed text", () => {
      const result = service.estimateTokenCount("Hello 世界 World");
      expect(result).toBeGreaterThan(0);
    });

    it("should return 0 for empty string", () => {
      const result = service.estimateTokenCount("");
      expect(result).toBe(0);
    });

    it("should handle long text", () => {
      const longText = "A".repeat(1000);
      const result = service.estimateTokenCount(longText);
      expect(result).toBe(250); // 1000/4 = 250
    });

    it("should handle Chinese-heavy text with higher density", () => {
      const allChinese = "你".repeat(150);
      const result = service.estimateTokenCount(allChinese);
      // 150 / 1.5 = 100
      expect(result).toBe(100);
    });
  });

  // ==================== calculateCost ====================

  describe("calculateCost", () => {
    it("should calculate cost correctly", () => {
      // 1M prompt tokens at $10, 1M completion tokens at $30
      const cost = service.calculateCost(1000, 1000, 10, 30);
      // input: (1000/1_000_000)*10 = 0.01, output: (1000/1_000_000)*30 = 0.03
      expect(cost).toBeCloseTo(0.04, 5);
    });

    it("should return 0 when no prices provided", () => {
      const cost = service.calculateCost(1000, 1000);
      expect(cost).toBe(0);
    });

    it("should return 0 when input price is undefined", () => {
      const cost = service.calculateCost(1000, 1000, undefined, 30);
      expect(cost).toBe(0);
    });

    it("should return 0 when output price is undefined", () => {
      const cost = service.calculateCost(1000, 1000, 10, undefined);
      expect(cost).toBe(0);
    });

    it("should handle zero tokens", () => {
      const cost = service.calculateCost(0, 0, 10, 30);
      expect(cost).toBe(0);
    });

    it("should handle large token counts", () => {
      const cost = service.calculateCost(1_000_000, 1_000_000, 5, 15);
      expect(cost).toBeCloseTo(20, 5);
    });
  });

  // ==================== validateTokenLimit ====================

  describe("validateTokenLimit", () => {
    it("should return valid when within limit", () => {
      const result = service.validateTokenLimit(500, 1000);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should return invalid when exceeds limit", () => {
      const result = service.validateTokenLimit(1500, 1000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("1500");
      expect(result.reason).toContain("1000");
    });

    it("should return valid when exactly at limit", () => {
      const result = service.validateTokenLimit(1000, 1000);
      expect(result.valid).toBe(true);
    });

    it("should return invalid when 1 over limit", () => {
      const result = service.validateTokenLimit(1001, 1000);
      expect(result.valid).toBe(false);
    });
  });

  // ==================== getTokenParamName ====================

  describe("getTokenParamName", () => {
    it("should return max_completion_tokens for reasoning models", () => {
      expect(service.getTokenParamName(true)).toBe("max_completion_tokens");
    });

    it("should return max_tokens for non-reasoning models", () => {
      expect(service.getTokenParamName(false)).toBe("max_tokens");
    });

    it("falls back to modelId heuristic when isReasoning is undefined (gpt-5.4 → max_completion_tokens)", () => {
      expect(service.getTokenParamName(undefined, "gpt-5.4")).toBe(
        "max_completion_tokens",
      );
    });

    it("falls back to max_tokens for a non-reasoning modelId when isReasoning undefined", () => {
      expect(service.getTokenParamName(undefined, "gpt-4o")).toBe("max_tokens");
    });

    it("honors explicit false even for a reasoning-looking modelId", () => {
      expect(service.getTokenParamName(false, "gpt-5.4")).toBe("max_tokens");
    });
  });

  // ==================== parseTokenUsage ====================

  describe("parseTokenUsage", () => {
    it("should parse standard token usage", () => {
      const response = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 200,
          total_tokens: 300,
        },
      };

      const result = service.parseTokenUsage(response);
      expect(result.promptTokens).toBe(100);
      expect(result.completionTokens).toBe(200);
      expect(result.totalTokens).toBe(300);
      expect(result.reasoningTokens).toBeUndefined();
    });

    it("should parse reasoning token details", () => {
      const response = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 500,
          total_tokens: 600,
          completion_tokens_details: {
            reasoning_tokens: 450,
          },
        },
      };

      const result = service.parseTokenUsage(response);
      expect(result.reasoningTokens).toBe(450);
    });

    it("should handle missing usage", () => {
      const result = service.parseTokenUsage({});
      expect(result.promptTokens).toBe(0);
      expect(result.completionTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
    });

    it("should handle null response", () => {
      const result = service.parseTokenUsage(null);
      expect(result.promptTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
    });

    it("should handle undefined response", () => {
      const result = service.parseTokenUsage(undefined);
      expect(result.promptTokens).toBe(0);
    });
  });

  // ==================== logTokenUsage ====================

  describe("logTokenUsage", () => {
    it("should log token usage without throwing", () => {
      expect(() =>
        service.logTokenUsage("gpt-4o", {
          promptTokens: 100,
          completionTokens: 200,
          totalTokens: 300,
        }),
      ).not.toThrow();
    });

    it("should log with reasoning tokens", () => {
      expect(() =>
        service.logTokenUsage("o1-mini", {
          promptTokens: 100,
          completionTokens: 500,
          totalTokens: 600,
          reasoningTokens: 450,
        }),
      ).not.toThrow();
    });

    it("should log with cost", () => {
      expect(() =>
        service.logTokenUsage(
          "gpt-4o",
          {
            promptTokens: 100,
            completionTokens: 200,
            totalTokens: 300,
          },
          0.003,
        ),
      ).not.toThrow();
    });
  });
});
