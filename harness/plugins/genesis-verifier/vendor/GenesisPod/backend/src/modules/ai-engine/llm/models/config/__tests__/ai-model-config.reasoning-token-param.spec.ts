/**
 * AiModelConfigService — reasoning / tokenParamName 启发式兜底回归测试
 *
 * 背景（2026-06-10 P0，gpt-5.4 BYOK 全失败）：
 *   OpenAI reasoning 模型（gpt-5.x / o1/o3/o4）必须发 max_completion_tokens，
 *   发 max_tokens 会 INVALID_REQUEST 全失败。AIModel.isReasoning 列是
 *   NOT NULL @default(false)，用户/admin 没标 → false → tokenParamName 走
 *   max_tokens。修复：buildModelConfig / isReasoningModel 对 reasoning 名模型
 *   做启发式 OR 兜底（DB false 但名是 reasoning → 仍判 reasoning）。
 *
 * 强验证点：
 *   - isReasoningModel('gpt-5.4') 在 DB/缓存无该模型时返 true（启发式兜底）
 *   - getModelConfig 对未配 isReasoning 的 gpt-5.4 返 tokenParamName=max_completion_tokens
 */
import { AiModelConfigService } from "../ai-model-config.service";

function makeMockPrisma() {
  return {
    aIModel: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

function makeService(prisma: ReturnType<typeof makeMockPrisma>) {
  const secretsService = { getValueInternal: jest.fn() };
  const userApiKeysService = {
    getPersonalKey: jest.fn().mockResolvedValue(null),
    getAvailableProviders: jest.fn().mockResolvedValue([]),
    resolveProviderDefaults: jest.fn().mockResolvedValue(null),
  };
  return new AiModelConfigService(
    // 仅注入测试路径用到的依赖；其余可选依赖留空
    prisma as never,
    secretsService as never,
    userApiKeysService as never,
  );
}

describe("AiModelConfigService — reasoning token param fallback", () => {
  describe("isReasoningModel (sync)", () => {
    it("returns true for gpt-5.4 when cache/DB has no such model (heuristic fallback)", () => {
      const prisma = makeMockPrisma();
      const service = makeService(prisma);
      // 缓存为空（findMany→[]），无该模型 → 走 inferIsReasoning('gpt-5.4') = true
      expect(service.isReasoningModel("gpt-5.4")).toBe(true);
    });

    it("returns true for o3-mini on cache miss (heuristic fallback)", () => {
      const service = makeService(makeMockPrisma());
      expect(service.isReasoningModel("o3-mini")).toBe(true);
    });

    it("returns false for a non-reasoning model (gpt-4o) on cache miss", () => {
      const service = makeService(makeMockPrisma());
      expect(service.isReasoningModel("gpt-4o")).toBe(false);
    });
  });

  describe("getModelConfig tokenParamName", () => {
    it("returns max_completion_tokens for a gpt-5.4 AIModel row stored with isReasoning=false (mis-tagged)", async () => {
      const prisma = makeMockPrisma();
      // DB 里有 gpt-5.4，但 isReasoning=false（用户没标）、tokenParamName 未配（null）
      prisma.aIModel.findFirst.mockResolvedValue({
        id: "m-1",
        name: "gpt-5.4",
        displayName: "GPT-5.4",
        provider: "openai",
        modelId: "gpt-5.4",
        apiEndpoint: "https://api.openai.com/v1/chat/completions",
        apiKey: null,
        secretKey: null,
        maxTokens: 8192,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
        isReasoning: false, // ← 根因：未标记，DB 默认 false
        apiFormat: "openai",
        supportsTemperature: null,
        supportsStreaming: null,
        supportsFunctionCalling: null,
        supportsVision: null,
        tokenParamName: null, // ← 未显式配 → 必须由 isReasoning 推出
        defaultTimeoutMs: null,
        priceInputPerMillion: null,
        priceOutputPerMillion: null,
        priority: null,
        structuredOutputStrategy: null,
        fallbackStrategies: [],
        supportsJsonSchemaStrict: null,
        supportsJsonSchema: null,
        supportsToolUse: null,
        supportsJsonMode: null,
        supportsGbnfGrammar: null,
        capabilityOverrides: null,
      });

      const service = makeService(prisma);
      const config = await service.getModelConfig("gpt-5.4");

      expect(config).not.toBeNull();
      expect(config?.isReasoning).toBe(true);
      expect(config?.tokenParamName).toBe("max_completion_tokens");
    });

    it("returns max_tokens for a non-reasoning model (gpt-4o) with isReasoning=false", async () => {
      const prisma = makeMockPrisma();
      prisma.aIModel.findFirst.mockResolvedValue({
        id: "m-2",
        name: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        modelId: "gpt-4o",
        apiEndpoint: "https://api.openai.com/v1/chat/completions",
        apiKey: null,
        secretKey: null,
        maxTokens: 8192,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
        isReasoning: false,
        apiFormat: "openai",
        supportsTemperature: null,
        supportsStreaming: null,
        supportsFunctionCalling: null,
        supportsVision: null,
        tokenParamName: null,
        defaultTimeoutMs: null,
        priceInputPerMillion: null,
        priceOutputPerMillion: null,
        priority: null,
        structuredOutputStrategy: null,
        fallbackStrategies: [],
        supportsJsonSchemaStrict: null,
        supportsJsonSchema: null,
        supportsToolUse: null,
        supportsJsonMode: null,
        supportsGbnfGrammar: null,
        capabilityOverrides: null,
      });

      const service = makeService(prisma);
      const config = await service.getModelConfig("gpt-4o");

      expect(config).not.toBeNull();
      expect(config?.isReasoning).toBe(false);
      expect(config?.tokenParamName).toBe("max_tokens");
    });

    it("respects an explicit DB tokenParamName even for a reasoning model name", async () => {
      const prisma = makeMockPrisma();
      // admin 显式把 tokenParamName 设成 max_tokens（直读字段，不被启发式覆盖）
      prisma.aIModel.findFirst.mockResolvedValue({
        id: "m-3",
        name: "gpt-5.4",
        displayName: "GPT-5.4",
        provider: "openai",
        modelId: "gpt-5.4",
        apiEndpoint: "https://api.openai.com/v1/chat/completions",
        apiKey: null,
        secretKey: null,
        maxTokens: 8192,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
        isReasoning: false,
        apiFormat: "openai",
        supportsTemperature: null,
        supportsStreaming: null,
        supportsFunctionCalling: null,
        supportsVision: null,
        tokenParamName: "max_tokens", // ← 显式 override
        defaultTimeoutMs: null,
        priceInputPerMillion: null,
        priceOutputPerMillion: null,
        priority: null,
        structuredOutputStrategy: null,
        fallbackStrategies: [],
        supportsJsonSchemaStrict: null,
        supportsJsonSchema: null,
        supportsToolUse: null,
        supportsJsonMode: null,
        supportsGbnfGrammar: null,
        capabilityOverrides: null,
      });

      const service = makeService(prisma);
      const config = await service.getModelConfig("gpt-5.4");

      expect(config?.tokenParamName).toBe("max_tokens");
    });
  });
});
