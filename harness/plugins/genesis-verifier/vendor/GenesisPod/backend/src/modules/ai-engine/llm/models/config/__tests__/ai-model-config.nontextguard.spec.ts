/**
 * AiModelConfigService — non-text-model guard spec (FIX 2)
 *
 * getAllEnabledModelsByType(CHAT) must exclude rows whose modelId matches the
 * non-text-generation predicate (e.g. "grok-imagine-image") even when their
 * UserModelConfig.modelType is mis-stored as CHAT.
 *
 * IMAGE_GENERATION query must still return such rows (those are the target).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AiModelConfigService } from "../ai-model-config.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";
import { UserModelConfigsService } from "@/modules/platform/credentials/user-owned/user-model-configs/user-model-configs.service";
import { RequestContext } from "@/common/context/request-context";
import { AIModelType } from "@prisma/client";

// ─── shared helper ───────────────────────────────────────────────────────────

function makeAdminModel(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "model-1",
    name: "gpt-4o",
    displayName: "GPT-4o",
    provider: "openai",
    modelId: "gpt-4o",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "sk-key",
    secretKey: null,
    maxTokens: 4000,
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
    priceInputPerMillion: 5.0,
    priceOutputPerMillion: 15.0,
    priority: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    icon: null,
    color: null,
    description: null,
    rpmLimit: null,
    tpmLimit: null,
    structuredOutputStrategy: null,
    fallbackStrategies: [],
    supportsJsonSchemaStrict: false,
    supportsJsonSchema: false,
    supportsToolUse: false,
    supportsJsonMode: false,
    supportsGbnfGrammar: false,
    capabilityOverrides: null,
    embeddingDimensions: null,
    maxInputTokens: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("AiModelConfigService – non-text-model guard (FIX 2)", () => {
  let service: AiModelConfigService;
  let prisma: jest.Mocked<
    Pick<
      PrismaService,
      "aIModel" | "userModelConfig" | "userApiKey" | "keyAssignment"
    >
  >;
  let userApiKeysService: jest.Mocked<UserApiKeysService>;

  beforeEach(async () => {
    prisma = {
      aIModel: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      } as unknown as jest.Mocked<PrismaService["aIModel"]>,
      userModelConfig: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      } as unknown as jest.Mocked<PrismaService["userModelConfig"]>,
      userApiKey: {
        findMany: jest.fn(),
      } as unknown as jest.Mocked<PrismaService["userApiKey"]>,
      keyAssignment: {
        findMany: jest.fn(),
      } as unknown as jest.Mocked<PrismaService["keyAssignment"]>,
    };

    userApiKeysService = {
      resolveProviderDefaults: jest.fn().mockResolvedValue(null),
      getAvailableProviders: jest.fn().mockResolvedValue([]),
      getPersonalKey: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<UserApiKeysService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiModelConfigService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: SecretsService,
          useValue: { getValueInternal: jest.fn().mockResolvedValue(null) },
        },
        { provide: UserApiKeysService, useValue: userApiKeysService },
        {
          provide: UserModelConfigsService,
          useValue: {
            findByModelId: jest.fn().mockResolvedValue(null),
            findDefaultForType: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<AiModelConfigService>(AiModelConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // ─── BYOK user path (with userId) ──────────────────────────────────────────
  // 2026-05-25 严格 BYOK 收口后，无 userId 的 admin 兜底路径已删（返回 []）。
  // FIX 2 非文本模型守卫现仅作用于 with-userId 的 UserModelConfig 选择路径，
  // 这里相应改为带 userId 上下文验证守卫仍生效。
  describe("BYOK user path (with userId)", () => {
    const USER_ID = "user-byok-1";

    beforeEach(() => {
      jest.spyOn(RequestContext, "getUserId").mockReturnValue(USER_ID);
    });

    it("excludes grok-imagine-image from CHAT results even when modelType=CHAT in DB", async () => {
      const imagineModel = makeAdminModel({
        id: "img-model",
        name: "grok-imagine-image",
        modelId: "grok-imagine-image",
        provider: "xai",
        modelType: "CHAT" as AIModelType, // mis-tagged
      });
      const chatModel = makeAdminModel({ id: "chat-model" });

      (prisma.userModelConfig.count as jest.Mock).mockResolvedValue(2);
      (prisma.userModelConfig.findMany as jest.Mock).mockResolvedValue([
        chatModel,
        imagineModel,
      ]);

      const results = await service.getAllEnabledModelsByType(AIModelType.CHAT);

      const ids = results.map((r) => r.modelId);
      expect(ids).not.toContain("grok-imagine-image");
      expect(ids).toContain("gpt-4o");
    });

    it("keeps grok-imagine-image when querying IMAGE_GENERATION", async () => {
      const imagineModel = makeAdminModel({
        id: "img-model",
        name: "grok-imagine-image",
        modelId: "grok-imagine-image",
        provider: "xai",
        modelType: "IMAGE_GENERATION" as AIModelType,
      });

      (prisma.userModelConfig.count as jest.Mock).mockResolvedValue(1);
      (prisma.userModelConfig.findMany as jest.Mock).mockResolvedValue([
        imagineModel,
      ]);

      const results = await service.getAllEnabledModelsByType(
        AIModelType.IMAGE_GENERATION,
      );

      const ids = results.map((r) => r.modelId);
      expect(ids).toContain("grok-imagine-image");
    });

    it("also excludes dall-e and flux model IDs from CHAT pool", async () => {
      const dalleModel = makeAdminModel({
        id: "dalle-model",
        name: "dall-e-3",
        modelId: "dall-e-3",
        provider: "openai",
        modelType: "CHAT" as AIModelType,
      });
      const fluxModel = makeAdminModel({
        id: "flux-model",
        name: "flux-schnell",
        modelId: "flux-schnell",
        provider: "bfl",
        modelType: "CHAT" as AIModelType,
      });
      const realChat = makeAdminModel({ id: "chat-1" });

      (prisma.userModelConfig.count as jest.Mock).mockResolvedValue(3);
      (prisma.userModelConfig.findMany as jest.Mock).mockResolvedValue([
        realChat,
        dalleModel,
        fluxModel,
      ]);

      const results = await service.getAllEnabledModelsByType(AIModelType.CHAT);
      const ids = results.map((r) => r.modelId);
      expect(ids).toContain("gpt-4o");
      expect(ids).not.toContain("dall-e-3");
      expect(ids).not.toContain("flux-schnell");
    });

    it("returns [] with no userId — strict BYOK, NO admin fallback", async () => {
      jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);
      (prisma.aIModel.findMany as jest.Mock).mockResolvedValue([
        makeAdminModel({ id: "chat-model" }),
      ]);

      const results = await service.getAllEnabledModelsByType(AIModelType.CHAT);

      expect(results).toHaveLength(0);
    });
  });
});
