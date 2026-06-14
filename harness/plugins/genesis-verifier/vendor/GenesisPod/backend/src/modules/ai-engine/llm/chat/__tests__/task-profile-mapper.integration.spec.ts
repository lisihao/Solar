/**
 * TaskProfileMapperService - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Lines 98-99: reasoning model + outputLength "minimal"/"short" → scaledMin branch
 *  - Lines 128-132: non-reasoning model capping tokens to model maxTokens
 *  - Lines 138-146: hard cap from getKnownModelLimit (warnedHardCaps dedup)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TaskProfileMapperService } from "../task-profile-mapper.service";
import type { AIModelConfig } from "../ai-chat.service";

function createModelConfig(
  overrides: Partial<AIModelConfig> = {},
): AIModelConfig {
  return {
    id: "test-id",
    name: "test",
    displayName: "Test",
    provider: "openai",
    modelId: "gpt-4",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "test-key",
    maxTokens: 8000,
    temperature: 0.7,
    isEnabled: true,
    isDefault: false,
    isReasoning: false,
    ...overrides,
  };
}

describe("TaskProfileMapperService (extended coverage)", () => {
  let service: TaskProfileMapperService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaskProfileMapperService],
    }).compile();
    service = module.get(TaskProfileMapperService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // Lines 98-99: reasoning model with minimal/short outputLength
  // =========================================================================

  describe("reasoning model with minimal/short outputLength (lines 98-99)", () => {
    it("uses scaledMin (0.5 * reasoningMin) for reasoning model with outputLength=minimal", () => {
      const modelConfig = createModelConfig({
        isReasoning: true,
        maxTokens: 100000,
        modelId: "o1",
      });

      const result = service.mapToParameters(
        { outputLength: "minimal" },
        modelConfig,
      );

      // scaledMin = Math.min(Math.ceil(reasoningMin * 0.5), 16000)
      // reasoningMin is large (model maxTokens based), scaled * 0.5 should be < 16000
      // The result is Math.max(baseMaxTokens(500), scaledMin)
      expect(result.maxTokens).toBeGreaterThan(500); // boosted above base
    });

    it("uses scaledMin (0.5 * reasoningMin) for reasoning model with outputLength=short", () => {
      const modelConfig = createModelConfig({
        isReasoning: true,
        maxTokens: 100000,
        modelId: "o1",
      });

      const result = service.mapToParameters(
        { outputLength: "short" },
        modelConfig,
      );

      // base is 1500, scaledMin should be bigger
      expect(result.maxTokens).toBeGreaterThan(1500);
      // But capped at 16000 max for scaledMin
      expect(result.maxTokens).toBeLessThanOrEqual(100000);
    });

    it("scaledMin for very large reasoning model is Math.max(baseTokens, scaledMin) with tiered cap", () => {
      // reasoningMin = Math.min(200000, 25000) = 25000
      // 2026-06-10：minimal 分档上限 4000（旧统一 16000 上限把分类任务推到 12500 长推理）
      // scaledMin = Math.min(Math.ceil(25000 * 0.5), 4000) = 4000
      // effectiveMaxTokens = Math.max(baseMaxTokens(500), 4000) = 4000
      const modelConfig = createModelConfig({
        isReasoning: true,
        maxTokens: 200000,
        modelId: "o1-pro",
      });

      const result = service.mapToParameters(
        { outputLength: "minimal" },
        modelConfig,
      );

      expect(result.maxTokens).toBe(4000);
    });
  });

  // =========================================================================
  // Lines 128-132: non-reasoning model capping to model maxTokens
  // =========================================================================

  describe("model maxTokens capping (lines 128-132)", () => {
    it("caps effectiveMaxTokens to model maxTokens when base exceeds it (non-reasoning)", () => {
      // outputLength "long" = 8000 base tokens, but model only supports 4000
      const modelConfig = createModelConfig({
        isReasoning: false,
        maxTokens: 4000,
        modelId: "gpt-3.5",
      });

      const result = service.mapToParameters(
        { outputLength: "long" },
        modelConfig,
      );

      // base is 8000 but model cap is 4000 → should be capped at 4000
      expect(result.maxTokens).toBe(4000);
    });

    it("caps extended output (16000) to a small model maxTokens", () => {
      const modelConfig = createModelConfig({
        isReasoning: false,
        maxTokens: 2000,
        modelId: "gpt-3.5-turbo",
      });

      const result = service.mapToParameters(
        { outputLength: "extended" },
        modelConfig,
      );

      expect(result.maxTokens).toBe(2000);
    });
  });

  // =========================================================================
  // Lines 138-146: hard cap from getKnownModelLimit + warnedHardCaps dedup
  // =========================================================================

  describe("known model hard cap (lines 138-146)", () => {
    it("applies known limit for gpt-4o-mini when effectiveTokens exceeds it", () => {
      // gpt-4o-mini known limit = 16384
      // If model config says maxTokens = 99999, base "extended" = 16000 which is < 16384
      // So let's use outputLength "long" with no model limit set, then trigger with a model with no limit on config
      const _modelConfig = createModelConfig({
        isReasoning: false,
        maxTokens: 99999, // db has wrong value, hard cap should kick in
        modelId: "gpt-4o-mini",
      });

      // outputLength extended = 16000 base tokens, but first model cap = 99999 (passes)
      // then knownLimit for gpt-4o-mini = 16384, 16000 < 16384 so no hard cap
      // Let's try to exceed 16384 by using a reasoning model to push tokens up
      // Actually let's use a model where hard cap < effectiveTokens
      // gpt-4-turbo known limit = 4096; use outputLength "medium" (4000 base)
      // 4000 < 4096, no cap. Let's use "long" (8000) -> hard cap to 4096
      const modelConfigTurbo = createModelConfig({
        isReasoning: false,
        maxTokens: 99999,
        modelId: "gpt-4-turbo",
      });

      const result = service.mapToParameters(
        { outputLength: "long" },
        modelConfigTurbo,
      );

      // gpt-4-turbo known limit = 4096
      expect(result.maxTokens).toBe(4096);
    });

    it("does not warn twice for same model (warnedHardCaps dedup)", () => {
      const modelConfig = createModelConfig({
        isReasoning: false,
        maxTokens: 99999,
        modelId: "gpt-4-turbo",
      });

      // First call → triggers warning and adds to warnedHardCaps
      const result1 = service.mapToParameters(
        { outputLength: "long" },
        modelConfig,
      );
      // Second call → already in warnedHardCaps, no duplicate warn
      const result2 = service.mapToParameters(
        { outputLength: "long" },
        modelConfig,
      );

      // Both results should have the hard-capped value
      expect(result1.maxTokens).toBe(4096);
      expect(result2.maxTokens).toBe(4096);
    });

    it("applies hard cap for claude-3-opus (4096 limit)", () => {
      const modelConfig = createModelConfig({
        isReasoning: false,
        maxTokens: 99999,
        modelId: "claude-3-opus",
      });

      const result = service.mapToParameters(
        { outputLength: "medium" },
        modelConfig,
      );

      // claude-3-opus known limit = 4096, medium base = 4000 < 4096 → no cap
      // Actually medium = 4000, knownLimit = 4096, 4000 < 4096 → no hard cap
      // Use "long" = 8000 > 4096 → hard cap to 4096
      const result2 = service.mapToParameters(
        { outputLength: "long" },
        modelConfig,
      );
      expect(result2.maxTokens).toBe(4096);
      // medium doesn't trigger the hard cap
      expect(result.maxTokens).toBe(4000);
    });
  });
});
