/**
 * v3.1 B.2 spec — capability_overrides JSONB 字段流入 + zod 严校。
 *
 * 验证 buildModelConfig（admin AIModel 行）+ toAIModelConfigFromUserConfig
 * （UserModelConfig 行）两条转换路径：
 *
 *   1. capability_overrides = null              → aiModelOverrides/userOverrides undefined（行为不变）
 *   2. capability_overrides = 合法 partial      → 字段流入
 *   3. capability_overrides = 非法 enum 值      → logger.warn + undefined，业务不崩
 *   4. capability_overrides = 未知字段 (.strict) → logger.warn + undefined，业务不崩
 *   5. safeParse 调用次数（spy 验证未误调 parse 跑 throw 路径）
 *
 * 阶段 0 spec 跑通不需要改；本 spec 只验 B.2 新增逻辑。
 */
import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AiModelConfigService } from "../ai-model-config.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";
import { UserModelConfigsService } from "@/modules/platform/credentials/user-owned/user-model-configs/user-model-configs.service";
import { AIModelType, UserModelConfig } from "@prisma/client";
import { ModelCapabilitiesOverridesSchema } from "../../capability/model-capability.types";

/**
 * Admin AIModel 行 fixture 工厂（capability_overrides 可注入）
 */
function makeAIModelRow(overrides: unknown): Record<string, unknown> {
  return {
    id: "model-test",
    name: "gpt-4o",
    displayName: "GPT-4o",
    provider: "openai",
    modelId: "gpt-4o",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "sk-test",
    secretKey: null,
    maxTokens: 4096,
    temperature: 0.7,
    isEnabled: true,
    isDefault: true,
    modelType: "CHAT" as AIModelType,
    isReasoning: false,
    apiFormat: "openai",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: false,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    priceInputPerMillion: 5,
    priceOutputPerMillion: 15,
    priority: 100,
    structuredOutputStrategy: null,
    fallbackStrategies: [],
    supportsJsonSchemaStrict: false,
    supportsJsonSchema: false,
    supportsToolUse: false,
    supportsJsonMode: false,
    supportsGbnfGrammar: false,
    capabilityOverrides: overrides,
    icon: null,
    color: null,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * BYOK UserModelConfig 行 fixture 工厂（capability_overrides 可注入）
 *
 * Prisma UserModelConfig 行内置 user 关系字段不需在 service 内部消费，
 * 用 `as unknown as UserModelConfig` 收窄类型即可。
 */
function makeUserModelConfigRow(overrides: unknown): UserModelConfig {
  return {
    id: "umc-test",
    userId: "user-test",
    provider: "openai",
    modelId: "gpt-4o",
    displayName: "GPT-4o BYOK",
    modelType: "CHAT" as AIModelType,
    apiEndpoint: null,
    maxTokens: 4096,
    temperature: 0.7,
    embeddingDimensions: null,
    maxInputTokens: null,
    isReasoning: false,
    apiFormat: "openai",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: false,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    priceInputPerMillion: null,
    priceOutputPerMillion: null,
    priority: 50,
    isEnabled: true,
    isDefault: false,
    description: null,
    rpmLimit: null,
    tpmLimit: null,
    capabilityOverrides: overrides,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserModelConfig;
}

describe("AiModelConfigService — capability_overrides (v3.1 B.2)", () => {
  let service: AiModelConfigService;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    const mockPrismaService = {
      aIModel: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      userApiKey: { findMany: jest.fn().mockResolvedValue([]) },
      keyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      userModelConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const mockSecretsService = { getValueInternal: jest.fn() };

    const mockUserApiKeysService = {
      getPersonalKey: jest.fn().mockResolvedValue(null),
      getAvailableProviders: jest.fn().mockResolvedValue([]),
      resolveProviderDefaults: jest.fn().mockResolvedValue({
        endpoint: "https://api.openai.com/v1",
        apiFormat: "openai",
        testModel: "gpt-4o-mini",
      }),
    };

    const mockUserModelConfigsService = {
      findByModelId: jest.fn().mockResolvedValue(null),
      findDefaultForType: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiModelConfigService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SecretsService, useValue: mockSecretsService },
        { provide: UserApiKeysService, useValue: mockUserApiKeysService },
        {
          provide: UserModelConfigsService,
          useValue: mockUserModelConfigsService,
        },
      ],
    }).compile();

    service = module.get<AiModelConfigService>(AiModelConfigService);

    // Spy 全局 Logger.prototype.warn（NestJS Logger 实例都走这个 prototype）。
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.clearAllMocks();
  });

  /**
   * 走 buildModelConfig：构建一个 AIModel 行进缓存，再 getModelConfig 拿出来。
   */
  async function buildAdminConfig(overrides: unknown) {
    const row = makeAIModelRow(overrides);
    const prisma = (
      service as unknown as { prisma: { aIModel: { findMany: jest.Mock } } }
    ).prisma;
    prisma.aIModel.findMany.mockResolvedValueOnce([row]);
    await service.refreshModelConfigCache();
    return await service.getModelConfig("gpt-4o");
  }

  /**
   * 走 toAIModelConfigFromUserConfig：直接调 private 方法（同模块测试场景允许）。
   */
  async function buildUserConfig(overrides: unknown) {
    const row = makeUserModelConfigRow(overrides);
    const toAIModelConfigFromUserConfig = (
      service as unknown as {
        toAIModelConfigFromUserConfig: (
          cfg: UserModelConfig,
        ) => Promise<unknown>;
      }
    ).toAIModelConfigFromUserConfig.bind(service);
    return (await toAIModelConfigFromUserConfig(row)) as {
      aiModelOverrides?: unknown;
      userOverrides?: unknown;
    } | null;
  }

  describe("admin path (buildModelConfig)", () => {
    it("null override → aiModelOverrides undefined（行为不变）", async () => {
      const cfg = await buildAdminConfig(null);
      expect(cfg).not.toBeNull();
      expect(cfg?.aiModelOverrides).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("合法 partial override → 字段流入", async () => {
      const cfg = await buildAdminConfig({
        structuredOutput: { nativeMode: "json_mode" },
      });
      expect(cfg).not.toBeNull();
      expect(cfg?.aiModelOverrides).toEqual({
        structuredOutput: { nativeMode: "json_mode" },
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("非法 enum 值 → logger.warn + undefined，业务不崩", async () => {
      const cfg = await buildAdminConfig({
        structuredOutput: { nativeMode: "invalid_value" },
      });
      expect(cfg).not.toBeNull();
      expect(cfg?.aiModelOverrides).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("admin");
      expect(warnSpy.mock.calls[0][0]).toContain("gpt-4o");
    });

    it("未知字段 (.strict 拒) → logger.warn + undefined，业务不崩", async () => {
      const cfg = await buildAdminConfig({ unknownField: "x" });
      expect(cfg).not.toBeNull();
      expect(cfg?.aiModelOverrides).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("admin");
    });

    // ── Fix-1 (review 2026-05-24)：sub-object 也必须 strict，否则静默漏 ──
    it("sub-object 未知字段 (sub-strict 拒) → logger.warn + undefined，不静默漏", async () => {
      // 修前：reasoning 子对象只 .partial() 没 .strict()
      //   → effort 被默默丢，生成 { reasoning: {} }
      //   → mergeInto 看到空对象 patch 进 target 不改任何字段（等价 noop）
      //   → 比拒掉更糟：没 warn，admin 以为生效了但其实没
      // 修后：sub-strict 直接拒整个 override，warn + undefined，回退链生效
      const cfg = await buildAdminConfig({
        reasoning: { effort: "low" }, // ← effort 不在 reasoning sub-schema 字段表
      });
      expect(cfg).not.toBeNull();
      expect(cfg?.aiModelOverrides).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("admin");
    });

    // ── Fix-2 (review 2026-05-24)：__meta 必须入 schema，B.4 self-heal 写入需要 ──
    it("__meta（B.4 self-heal 写入字段）合法 → 接受", async () => {
      const cfg = await buildAdminConfig({
        __meta: {
          autoDowngraded: true,
          source: "self-heal-user",
          selfHealedAt: "2026-05-24T00:00:00Z",
          selfHealedReason: "json_schema_400",
          probeFailCount: 0,
        },
      });
      expect(cfg).not.toBeNull();
      expect(cfg?.aiModelOverrides).toEqual({
        __meta: {
          autoDowngraded: true,
          source: "self-heal-user",
          selfHealedAt: "2026-05-24T00:00:00Z",
          selfHealedReason: "json_schema_400",
          probeFailCount: 0,
        },
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("__meta 未知字段 (__meta 自己 strict 拒) → logger.warn + undefined", async () => {
      const cfg = await buildAdminConfig({
        __meta: { unknownMetaKey: "x" },
      });
      expect(cfg).not.toBeNull();
      expect(cfg?.aiModelOverrides).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("admin");
    });
  });

  describe("BYOK user path (toAIModelConfigFromUserConfig)", () => {
    it("null override → userOverrides undefined（行为不变）", async () => {
      const cfg = await buildUserConfig(null);
      expect(cfg).not.toBeNull();
      expect(cfg?.userOverrides).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("合法 partial override → 字段流入", async () => {
      const cfg = await buildUserConfig({
        toolUse: { mode: "anthropic_tools", parallelCalls: true },
      });
      expect(cfg).not.toBeNull();
      expect(cfg?.userOverrides).toEqual({
        toolUse: { mode: "anthropic_tools", parallelCalls: true },
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("非法 enum 值 → logger.warn + undefined，业务不崩", async () => {
      const cfg = await buildUserConfig({
        reasoning: { kind: "not_a_kind" },
      });
      expect(cfg).not.toBeNull();
      expect(cfg?.userOverrides).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("user");
      expect(warnSpy.mock.calls[0][0]).toContain("gpt-4o");
    });

    it("未知字段 (.strict 拒) → logger.warn + undefined，业务不崩", async () => {
      const cfg = await buildUserConfig({ rogueField: 42 });
      expect(cfg).not.toBeNull();
      expect(cfg?.userOverrides).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("user");
    });

    // ── Fix-1 BYOK 侧 sub-strict 守护（review 2026-05-24） ──
    it("BYOK sub-object 未知字段 (sub-strict 拒) → warn + undefined，不静默漏", async () => {
      const cfg = await buildUserConfig({
        toolUse: { extraToolField: true }, // ← 不在 toolUse sub-schema 字段表
      });
      expect(cfg).not.toBeNull();
      expect(cfg?.userOverrides).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("user");
    });
  });

  describe("zod 使用安全性", () => {
    it("用 safeParse 不用 parse（throw 不冒泡破坏业务）", async () => {
      const safeParseSpy = jest.spyOn(
        ModelCapabilitiesOverridesSchema,
        "safeParse",
      );
      const parseSpy = jest.spyOn(ModelCapabilitiesOverridesSchema, "parse");

      // 触发 admin 路径一次 + user 路径一次（合法 override）
      await buildAdminConfig({ streaming: { support: false } });
      await buildUserConfig({ vision: { support: "image_url" } });

      expect(safeParseSpy).toHaveBeenCalledTimes(2);
      expect(parseSpy).not.toHaveBeenCalled();

      safeParseSpy.mockRestore();
      parseSpy.mockRestore();
    });

    // ── Fix-4 (arch-auditor P2 review 2026-05-24)：mockImplementation throw 直接证 ──
    // 上面 spy 验证调用计数，但 spy 不一定覆盖 service 内 import 的引用
    // （取决于 zod schema 是否被冻结/拷贝）。改用 throw 直接证 fail-open 生效：
    // 如果 service 里误写成 parse 而不是 safeParse，throw 会冒泡到 buildModelConfig，
    // 触发 cache 刷新挂掉，测试会崩。fail-open 行为正确则被 warn + undefined 兜住。
    it("falls back open if parse throws (proves safeParse path is wired)", async () => {
      const parseSpy = jest
        .spyOn(ModelCapabilitiesOverridesSchema, "parse")
        .mockImplementation(() => {
          throw new Error("parse should never be called");
        });

      // 触发解析（合法 override，但 parse spy 一旦被调就 throw）
      const cfg = await buildAdminConfig({ streaming: { support: false } });

      // 验证：buildModelConfig 没崩 + aiModelOverrides 是合法数据（safeParse 正常返）
      expect(cfg).not.toBeNull();
      expect(cfg?.aiModelOverrides).toEqual({ streaming: { support: false } });

      parseSpy.mockRestore();
    });
  });

  // ─────────── v3.1 §B+.2 apiFormat backfill ───────────
  describe("apiFormat backfill (v3.1 §B+.2)", () => {
    it("admin path: AIModel.apiFormat='openai' 流入 AIModelConfig.apiFormat", async () => {
      const cfg = (await buildAdminConfig(null)) as {
        apiFormat?: string;
      } | null;
      expect(cfg).not.toBeNull();
      // makeAIModelRow 默认 apiFormat='openai'；buildModelConfig 经 resolveApiFormat 透传
      expect(cfg?.apiFormat).toBe("openai");
    });

    it("BYOK path: UserModelConfig.apiFormat='openai' 流入 AIModelConfig.apiFormat", async () => {
      const cfg = (await buildUserConfig(null)) as {
        apiFormat?: string;
      } | null;
      expect(cfg).not.toBeNull();
      // makeUserModelConfigRow 默认 apiFormat='openai'；toAIModelConfigFromUserConfig 透传
      expect(cfg?.apiFormat).toBe("openai");
    });
  });
});
