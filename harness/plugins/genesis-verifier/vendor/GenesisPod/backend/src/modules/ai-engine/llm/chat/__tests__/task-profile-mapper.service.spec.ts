import { Test, TestingModule } from "@nestjs/testing";
import { TaskProfileMapperService } from "../task-profile-mapper.service";
import type { TaskProfile } from "../../types";
import { REASONING_MODEL_MIN_TOKENS } from "../../types";
import type { AIModelConfig } from "../ai-chat.service";

// Helper to create mock AIModelConfig
function createMockModelConfig(
  overrides: Partial<AIModelConfig> = {},
): AIModelConfig {
  return {
    id: "test-model-id",
    name: "test-model",
    displayName: "Test Model",
    provider: "openai",
    modelId: overrides.isReasoning ? "o1" : "gpt-4",
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

describe("TaskProfileMapperService", () => {
  let service: TaskProfileMapperService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaskProfileMapperService],
    }).compile();

    service = module.get<TaskProfileMapperService>(TaskProfileMapperService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== 基础映射测试 ====================

  describe("Basic Mapping", () => {
    it("should return defaults when profile is undefined", () => {
      const result = service.mapToParameters(undefined, null);

      expect(result.temperature).toBe(0.7);
      expect(result.maxTokens).toBe(4096);
    });

    it("should return model config defaults when profile is undefined", () => {
      const modelConfig = createMockModelConfig({
        temperature: 0.8,
        maxTokens: 8000,
      });

      const result = service.mapToParameters(undefined, modelConfig);

      expect(result.temperature).toBe(0.8);
      expect(result.maxTokens).toBe(8000);
    });

    it("should map creativity to temperature correctly", () => {
      const testCases: Array<{
        creativity: TaskProfile["creativity"];
        expected: number;
      }> = [
        { creativity: "deterministic", expected: 0.1 },
        { creativity: "low", expected: 0.3 },
        { creativity: "medium", expected: 0.7 },
        { creativity: "high", expected: 0.9 },
      ];

      testCases.forEach(({ creativity, expected }) => {
        const result = service.mapToParameters({ creativity }, null);
        expect(result.temperature).toBe(expected);
      });
    });

    it("should map outputLength to maxTokens correctly", () => {
      const testCases: Array<{
        outputLength: TaskProfile["outputLength"];
        expected: number;
      }> = [
        { outputLength: "minimal", expected: 500 },
        { outputLength: "short", expected: 1500 },
        { outputLength: "medium", expected: 4000 },
        { outputLength: "standard", expected: 6000 },
        { outputLength: "long", expected: 8000 },
        { outputLength: "extended", expected: 16000 },
      ];

      testCases.forEach(({ outputLength, expected }) => {
        const result = service.mapToParameters({ outputLength }, null);
        expect(result.maxTokens).toBe(expected);
      });
    });
  });

  // ==================== 推理模型测试 ====================

  describe("Reasoning Model Handling", () => {
    it("should boost tokens for reasoning models to minimum when model supports it", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: true,
        maxTokens: 50000, // Model supports enough tokens
      });

      const result = service.mapToParameters(
        { outputLength: "medium" },
        modelConfig,
      );

      expect(result.maxTokens).toBe(REASONING_MODEL_MIN_TOKENS);
    });

    it("should boost extended output to 32000 for reasoning models when supported", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: true,
        maxTokens: 50000, // Model supports enough tokens
      });

      const result = service.mapToParameters(
        { outputLength: "extended" },
        modelConfig,
      );

      expect(result.maxTokens).toBe(32000);
    });

    it("should boost long output to 28000 for reasoning models when supported", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: true,
        maxTokens: 50000, // Model supports enough tokens
      });

      const result = service.mapToParameters(
        { outputLength: "long" },
        modelConfig,
      );

      expect(result.maxTokens).toBe(28000);
    });

    // 2026-06-10 日志实测：minimal 500→12500 让分类任务也长推理。
    // minimal/short 分档收敛：minimal ≤4000、short ≤8000，medium+ 维持原行为。
    it("caps minimal boost at 4000 for reasoning models", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: true,
        maxTokens: 25000,
      });

      const result = service.mapToParameters(
        { outputLength: "minimal" },
        modelConfig,
      );

      expect(result.maxTokens).toBeLessThanOrEqual(4000);
      expect(result.maxTokens).toBe(4000);
    });

    it("caps short boost at 8000 for reasoning models", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: true,
        maxTokens: 25000,
      });

      const result = service.mapToParameters(
        { outputLength: "short" },
        modelConfig,
      );

      expect(result.maxTokens).toBeLessThanOrEqual(8000);
      expect(result.maxTokens).toBe(8000);
    });

    it("should cap reasoning model tokens to model max to prevent API errors", () => {
      const modelConfig = createMockModelConfig({
        maxTokens: 12000, // Lower than REASONING_MODEL_MIN_TOKENS
        isReasoning: true,
      });

      const result = service.mapToParameters(
        { outputLength: "medium" },
        modelConfig,
      );

      // Should cap to model's maxTokens to prevent API 400 errors
      // The service will log a warning about suboptimal configuration
      expect(result.maxTokens).toBe(12000);
    });

    it("should use model maxTokens when it meets reasoning minimum", () => {
      const modelConfig = createMockModelConfig({
        maxTokens: 30000, // Higher than REASONING_MODEL_MIN_TOKENS
        isReasoning: true,
      });

      const result = service.mapToParameters(
        { outputLength: "medium" },
        modelConfig,
      );

      // Should use REASONING_MODEL_MIN_TOKENS since it's within model limits
      expect(result.maxTokens).toBe(REASONING_MODEL_MIN_TOKENS);
    });
  });

  // ==================== Non-Reasoning Cap Defense (BYOK protection) ====================
  // 守护 outputLength='extended' (16K) 在 max output ≤ 8K 的 model 上被 cap 到 model max，
  // 防 BYOK 路径 (ai-direct-key.service.ts:105) 因 max_tokens 超限被 provider 400。
  // 双道防线：(1) modelConfig.maxTokens cap (line 137) + (2) getKnownModelLimit() 硬兜底 (line 146)
  describe("Non-Reasoning Cap Defense (BYOK protection)", () => {
    it("should cap extended output to modelConfig.maxTokens when model supports less than 16K", () => {
      // Arrange — 模拟 BYOK 配置 claude-3.5-sonnet (max output 8192)，
      // 用户 taskProfile 要 extended (16000)
      const modelConfig = createMockModelConfig({
        isReasoning: false,
        modelId: "claude-3.5-sonnet",
        maxTokens: 8192,
      });

      // Act
      const result = service.mapToParameters(
        { outputLength: "extended" },
        modelConfig,
      );

      // Assert — 必须被 cap 到 8192，否则 provider 返回 400
      expect(result.maxTokens).toBe(8192);
    });

    it("should cap long output to modelConfig.maxTokens when model is below 8K", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: false,
        modelId: "gpt-3.5-turbo",
        maxTokens: 4096,
      });

      const result = service.mapToParameters(
        { outputLength: "long" },
        modelConfig,
      );

      expect(result.maxTokens).toBe(4096);
    });

    it("should hard cap via getKnownModelLimit when modelConfig.maxTokens exceeds known API limit", () => {
      // 防回退场景：DB 里 claude-3.5-sonnet 错填 maxTokens=32000 (API 实际只支持 8192)
      // mapToParameters 必须用 MODEL_KNOWN_LIMITS 兜底，不能信 DB 错配
      const modelConfig = createMockModelConfig({
        isReasoning: false,
        modelId: "claude-3.5-sonnet",
        maxTokens: 32000,
      });

      const result = service.mapToParameters(
        { outputLength: "extended" },
        modelConfig,
      );

      // 兜底到 MODEL_KNOWN_LIMITS 中 claude-3.5-sonnet 的硬限制 8192
      expect(result.maxTokens).toBe(8192);
    });

    it("should allow extended (16K) on model that genuinely supports 16K output (gpt-4o)", () => {
      // 反向验证：gpt-4o max output 16384，不该被多余 cap
      const modelConfig = createMockModelConfig({
        isReasoning: false,
        modelId: "gpt-4o",
        maxTokens: 16384,
      });

      const result = service.mapToParameters(
        { outputLength: "extended" },
        modelConfig,
      );

      expect(result.maxTokens).toBe(16000);
    });

    it("should not cap when modelId is unknown and modelConfig.maxTokens is high enough", () => {
      // 守护：完全未知 model (knownLimit=null) + modelConfig.maxTokens=32000
      // 走 outputLength 直出，不被 cap (16000 < 32000)
      const modelConfig = createMockModelConfig({
        isReasoning: false,
        modelId: "unknown-model-xyz",
        maxTokens: 32000,
      });

      const result = service.mapToParameters(
        { outputLength: "extended" },
        modelConfig,
      );

      // outputLength=extended 原值，不被 cap
      expect(result.maxTokens).toBe(16000);
    });
  });

  // ==================== JSON 输出格式测试 ====================

  describe("JSON Output Format", () => {
    it("should cap temperature at 0.3 for JSON output", () => {
      const result = service.mapToParameters(
        { creativity: "high", outputFormat: "json" },
        null,
      );

      expect(result.temperature).toBe(0.3);
    });

    it("should not change temperature for non-JSON output", () => {
      const result = service.mapToParameters(
        { creativity: "high", outputFormat: "markdown" },
        null,
      );

      expect(result.temperature).toBe(0.9);
    });
  });

  // ==================== Reasoning Depth 测试 ====================

  describe("Reasoning Depth Mapping", () => {
    it("should pass through reasoningDepth for reasoning models", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: true,
        maxTokens: 50000,
      });

      const result = service.mapToParameters(
        {
          creativity: "medium",
          outputLength: "medium",
          reasoningDepth: "deep",
        },
        modelConfig,
      );

      expect(result.reasoningDepth).toBe("deep");
    });

    it("should NOT set reasoningDepth for non-reasoning models", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: false,
        maxTokens: 8000,
      });

      const result = service.mapToParameters(
        {
          creativity: "medium",
          outputLength: "medium",
          reasoningDepth: "deep",
        },
        modelConfig,
      );

      expect(result.reasoningDepth).toBeUndefined();
    });

    it("should NOT set reasoningDepth when profile has no reasoningDepth", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: true,
        maxTokens: 50000,
      });

      const result = service.mapToParameters(
        { creativity: "medium", outputLength: "medium" },
        modelConfig,
      );

      expect(result.reasoningDepth).toBeUndefined();
    });

    it("should boost tokens to 32000 for deep reasoning when below threshold", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: true,
        maxTokens: 50000,
      });

      const result = service.mapToParameters(
        { outputLength: "medium", reasoningDepth: "deep" },
        modelConfig,
      );

      expect(result.maxTokens).toBeGreaterThanOrEqual(32000);
    });

    it("should NOT boost tokens for light/moderate reasoning", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: true,
        maxTokens: 50000,
      });

      const result = service.mapToParameters(
        { outputLength: "medium", reasoningDepth: "light" },
        modelConfig,
      );

      // Should not get the 32K deep boost (still gets reasoning model boost)
      expect(result.reasoningDepth).toBe("light");
    });

    it("should cap deep reasoning boost at model maxTokens", () => {
      const modelConfig = createMockModelConfig({
        isReasoning: true,
        maxTokens: 16384, // Model can't do 32000
      });

      const result = service.mapToParameters(
        { outputLength: "medium", reasoningDepth: "deep" },
        modelConfig,
      );

      expect(result.maxTokens).toBeLessThanOrEqual(16384);
    });
  });
});
