/**
 * Model Tier Config Tests
 *
 * 覆盖所有模型分类分支：STRONG / STANDARD / BASIC / 边界情况
 */

import { classifyModelTier, ModelTier } from "../model-tier.config";

describe("classifyModelTier", () => {
  // ==================== STRONG Tier ====================

  describe("STRONG tier models", () => {
    const strongModels = [
      // Claude
      "claude-sonnet-4-20260514",
      "claude-sonnet-4",
      "claude-opus-4",
      "claude-opus-4-20260514",
      // GPT-4o (not mini)
      "gpt-4o",
      "gpt-4o-2024-08-06",
      // GPT-4.1 (not mini/nano)
      "gpt-4.1",
      "gpt-4.1-2025-04-14",
      // Reasoning models
      "o1-preview",
      "o1-mini", // o1- prefix matches
      "o3-mini",
      "o4-mini",
      // Gemini
      "gemini-2.0-pro",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-preview-04-17",
      "gemini-3.0",
      // Grok
      "grok-3",
      "grok-3-beta",
      // DeepSeek
      "deepseek-r1",
      "deepseek-r1-distill-qwen-32b",
      "deepseek-v3",
    ];

    it.each(strongModels)("classifies %s as STRONG", (modelId) => {
      expect(classifyModelTier(modelId)).toBe(ModelTier.STRONG);
    });
  });

  // ==================== STANDARD Tier ====================

  describe("STANDARD tier models", () => {
    const standardModels = [
      "gpt-4o-mini",
      "gpt-4o-mini-2024-07-18",
      "gpt-4.1-mini",
      "gpt-4.1-mini-2025-04-14",
      "claude-haiku-3.5",
      "claude-haiku-4",
      "gemini-2.0-flash",
      "gemini-2.0-flash-001",
      "grok-3-mini",
      "grok-3-mini-beta",
    ];

    it.each(standardModels)("classifies %s as STANDARD", (modelId) => {
      expect(classifyModelTier(modelId)).toBe(ModelTier.STANDARD);
    });
  });

  // ==================== BASIC Tier ====================

  describe("BASIC tier models (unknown/fallback)", () => {
    const basicModels = [
      "llama-3.1-70b",
      "mistral-large",
      "qwen-72b",
      "yi-large",
      "some-unknown-model",
    ];

    it.each(basicModels)("classifies %s as BASIC", (modelId) => {
      expect(classifyModelTier(modelId)).toBe(ModelTier.BASIC);
    });
  });

  // ==================== Edge Cases ====================

  describe("edge cases", () => {
    it("returns BASIC for empty string", () => {
      expect(classifyModelTier("")).toBe(ModelTier.BASIC);
    });

    it("is case insensitive", () => {
      expect(classifyModelTier("GPT-4O")).toBe(ModelTier.STRONG);
      expect(classifyModelTier("Claude-Sonnet-4")).toBe(ModelTier.STRONG);
      expect(classifyModelTier("GPT-4O-MINI")).toBe(ModelTier.STANDARD);
    });

    // ★ 关键边界：gpt-4o-mini 不应匹配 STRONG 的 gpt-4o 模式
    it("correctly distinguishes gpt-4o from gpt-4o-mini", () => {
      expect(classifyModelTier("gpt-4o")).toBe(ModelTier.STRONG);
      expect(classifyModelTier("gpt-4o-mini")).toBe(ModelTier.STANDARD);
    });

    // ★ 关键边界：gpt-4.1-mini 不应匹配 STRONG 的 gpt-4.1 模式
    it("correctly distinguishes gpt-4.1 from gpt-4.1-mini", () => {
      expect(classifyModelTier("gpt-4.1")).toBe(ModelTier.STRONG);
      expect(classifyModelTier("gpt-4.1-mini")).toBe(ModelTier.STANDARD);
      expect(classifyModelTier("gpt-4.1-nano")).toBe(ModelTier.BASIC);
    });

    // ★ 关键边界：grok-3 vs grok-3-mini
    it("correctly distinguishes grok-3 from grok-3-mini", () => {
      expect(classifyModelTier("grok-3")).toBe(ModelTier.STRONG);
      expect(classifyModelTier("grok-3-mini")).toBe(ModelTier.STANDARD);
    });

    // ★ gemini-2.5-flash 是 STRONG（thinking 能力强）
    it("classifies gemini-2.5-flash as STRONG", () => {
      expect(classifyModelTier("gemini-2.5-flash")).toBe(ModelTier.STRONG);
    });

    // ★ gemini-2.0-flash 是 STANDARD
    it("classifies gemini-2.0-flash as STANDARD", () => {
      expect(classifyModelTier("gemini-2.0-flash")).toBe(ModelTier.STANDARD);
    });

    // STRONG 优先匹配：同时匹配 STRONG 和 STANDARD 时取 STRONG
    it("STRONG takes priority when both patterns match", () => {
      // gemini-2.5-flash 匹配 STRONG 的 gemini-2\.5-flash 和可能的 STANDARD flash 模式
      expect(classifyModelTier("gemini-2.5-flash")).toBe(ModelTier.STRONG);
    });
  });
});


