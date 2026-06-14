/**
 * ModelFallbackService — reasoning / tokenParamName 启发式兜底回归测试
 *
 * 背景（2026-06-10 P0，gpt-5.4 BYOK 全失败）：toAIModelConfig 原先 isReasoning
 * 直读 DB 列（NOT NULL @default(false)）→ 未标记的 gpt-5.x 走 max_tokens 被
 * OpenAI INVALID_REQUEST 全失败。修复：对 reasoning 名模型做启发式 OR 兜底。
 *
 * toAIModelConfig 为私有，经公共 getModelConfig() 验证（无请求上下文 → userId
 * undefined → 直接走 prisma.aIModel.findFirst → toAIModelConfig）。
 */
import { ModelFallbackService } from "../model-fallback.service";

function makeMockPrisma() {
  return {
    userModelConfig: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    aIModel: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

function aiModelRow(overrides: Record<string, unknown>) {
  return {
    id: "m-1",
    name: "model",
    displayName: "Model",
    provider: "openai",
    modelId: "model",
    apiEndpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: null,
    maxTokens: 8192,
    temperature: 0.7,
    isEnabled: true,
    isDefault: false,
    isReasoning: false,
    apiFormat: "openai",
    tokenParamName: null,
    supportsTemperature: null,
    supportsStreaming: null,
    supportsFunctionCalling: null,
    supportsVision: null,
    defaultTimeoutMs: null,
    priceInputPerMillion: null,
    priceOutputPerMillion: null,
    priority: null,
    ...overrides,
  };
}

describe("ModelFallbackService — reasoning token param fallback (toAIModelConfig)", () => {
  it("returns max_completion_tokens for gpt-5.4 row stored with isReasoning=false (mis-tagged)", async () => {
    const prisma = makeMockPrisma();
    prisma.aIModel.findFirst.mockResolvedValue(
      aiModelRow({ name: "gpt-5.4", modelId: "gpt-5.4", isReasoning: false }),
    );
    const service = new ModelFallbackService(prisma as never);

    const config = await service.getModelConfig("gpt-5.4");

    expect(config).not.toBeNull();
    expect(config?.isReasoning).toBe(true);
    expect(config?.tokenParamName).toBe("max_completion_tokens");
  });

  it("returns max_tokens for a non-reasoning model (gpt-4o)", async () => {
    const prisma = makeMockPrisma();
    prisma.aIModel.findFirst.mockResolvedValue(
      aiModelRow({ name: "gpt-4o", modelId: "gpt-4o", isReasoning: false }),
    );
    const service = new ModelFallbackService(prisma as never);

    const config = await service.getModelConfig("gpt-4o");

    expect(config?.isReasoning).toBe(false);
    expect(config?.tokenParamName).toBe("max_tokens");
  });

  it("respects explicit DB tokenParamName even for a reasoning model name", async () => {
    const prisma = makeMockPrisma();
    prisma.aIModel.findFirst.mockResolvedValue(
      aiModelRow({
        name: "gpt-5.4",
        modelId: "gpt-5.4",
        isReasoning: false,
        tokenParamName: "max_tokens",
      }),
    );
    const service = new ModelFallbackService(prisma as never);

    const config = await service.getModelConfig("gpt-5.4");

    expect(config?.tokenParamName).toBe("max_tokens");
  });
});
