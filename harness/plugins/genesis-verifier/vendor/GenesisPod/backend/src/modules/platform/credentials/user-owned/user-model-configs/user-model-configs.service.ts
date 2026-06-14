import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AIModelType, Prisma, UserModelConfig } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { inferIsReasoning } from "../../../../ai-engine/llm/types/model.utils";

const PROVIDER_NAME_PATTERN = /^[a-z0-9-]+$/;
// 2026-05-11 P2: 删除 PROVIDER_DEFAULTS 硬编码。apiFormat 没填且 DB 也没配
// 时用 "openai" 作最通用兜底（覆盖 95% OpenAI-compatible provider）。
const DEFAULT_API_FORMAT_FALLBACK = "openai";

export interface CreateUserModelConfigInput {
  provider: string;
  modelId: string;
  displayName: string;
  modelType: AIModelType;
  apiEndpoint?: string | null;
  apiKeyId?: string | null;
  maxTokens?: number;
  temperature?: number;
  embeddingDimensions?: number | null;
  maxInputTokens?: number | null;
  isReasoning?: boolean;
  apiFormat?: string;
  supportsTemperature?: boolean;
  supportsStreaming?: boolean;
  supportsFunctionCalling?: boolean;
  supportsVision?: boolean;
  tokenParamName?: string;
  defaultTimeoutMs?: number;
  priority?: number;
  isEnabled?: boolean;
  isDefault?: boolean;
  description?: string | null;
  priceInputPerMillion?: number | null;
  priceOutputPerMillion?: number | null;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
}

export type UpdateUserModelConfigInput = Partial<CreateUserModelConfigInput>;

@Injectable()
export class UserModelConfigsService {
  constructor(private readonly prisma: PrismaService) {}

  private validateProvider(provider: string): string {
    const normalized = provider.toLowerCase().trim();
    if (!PROVIDER_NAME_PATTERN.test(normalized) || normalized.length > 50) {
      throw new BadRequestException("Invalid provider name");
    }
    return normalized;
  }

  /**
   * 2026-05-28 BYOK 安全：校验用户绑定的 apiKeyId 确实属于当前用户、且 provider
   * 匹配。否则用户可填他人的 UserApiKey.id，runtime honor 时会用他人 Key 调 LLM
   * （横向越权）。仅在 apiKeyId 非空时校验。
   */
  private async assertApiKeyOwnership(
    userId: string,
    apiKeyId: string,
    provider: string,
  ): Promise<void> {
    const key = await this.prisma.userApiKey.findFirst({
      where: { id: apiKeyId, userId },
      select: { provider: true },
    });
    if (!key) {
      throw new BadRequestException(
        "Selected API key not found or not owned by you",
      );
    }
    if (key.provider.toLowerCase() !== provider.toLowerCase()) {
      throw new BadRequestException(
        `Selected API key belongs to provider "${key.provider}", not "${provider}"`,
      );
    }
  }

  /**
   * 2026-05-11 P2: apiFormat 兜底从硬编码 PROVIDER_DEFAULTS 改为 DB ai_providers。
   * 没填 + DB 也没该 provider → "openai" 兜底（覆盖绝大多数 OpenAI-兼容场景）。
   */
  private async applyDefaults(
    input: CreateUserModelConfigInput,
    provider: string,
  ): Promise<Prisma.UserModelConfigCreateInput> {
    let apiFormat = input.apiFormat;
    if (!apiFormat) {
      try {
        const dbProvider = await this.prisma.aIProvider.findFirst({
          where: { slug: provider, isEnabled: true, scope: "system" },
        });
        apiFormat = dbProvider?.apiFormat || DEFAULT_API_FORMAT_FALLBACK;
      } catch {
        apiFormat = DEFAULT_API_FORMAT_FALLBACK;
      }
    }
    return {
      provider,
      modelId: input.modelId.trim(),
      displayName: input.displayName.trim() || input.modelId.trim(),
      modelType: input.modelType,
      apiEndpoint: input.apiEndpoint?.trim() || null,
      apiKeyId: input.apiKeyId?.trim() || null,
      maxTokens: input.maxTokens ?? 4096,
      temperature: input.temperature ?? 0.7,
      embeddingDimensions: input.embeddingDimensions ?? null,
      maxInputTokens: input.maxInputTokens ?? null,
      // 数据根因修复：用户保存模型配置时若未显式标 isReasoning，按 modelId 启发式兜底。
      // 让 reasoning 模型（gpt-5.x / o1/o3/o4 等）落库时 isReasoning=true，下游
      // token 参数决策（max_completion_tokens vs max_tokens）才不会因 DB false 而发错。
      // 显式传了就尊重用户/调用方的值。
      isReasoning: input.isReasoning ?? inferIsReasoning(input.modelId),
      apiFormat,
      supportsTemperature: input.supportsTemperature ?? true,
      supportsStreaming: input.supportsStreaming ?? true,
      supportsFunctionCalling: input.supportsFunctionCalling ?? true,
      supportsVision: input.supportsVision ?? false,
      tokenParamName: input.tokenParamName ?? "max_tokens",
      defaultTimeoutMs: input.defaultTimeoutMs ?? 120000,
      priority: input.priority ?? 50,
      isEnabled: input.isEnabled ?? true,
      isDefault: input.isDefault ?? false,
      description: input.description?.trim() || null,
      priceInputPerMillion: input.priceInputPerMillion ?? null,
      priceOutputPerMillion: input.priceOutputPerMillion ?? null,
      rpmLimit: input.rpmLimit ?? null,
      tpmLimit: input.tpmLimit ?? null,
      user: { connect: { id: "" } }, // Caller replaces this
    };
  }

  async create(
    userId: string,
    input: CreateUserModelConfigInput,
  ): Promise<UserModelConfig> {
    if (!input.modelId?.trim()) {
      throw new BadRequestException("modelId is required");
    }
    if (!input.displayName?.trim()) {
      // 允许缺省，默认用 modelId
      input.displayName = input.modelId;
    }
    const provider = this.validateProvider(input.provider);
    if (input.apiKeyId?.trim()) {
      await this.assertApiKeyOwnership(userId, input.apiKeyId.trim(), provider);
    }
    const data = await this.applyDefaults(input, provider);
    data.user = { connect: { id: userId } };

    try {
      // 事务化：当 isDefault=true 时，先清同 modelType 下其他 default，
      // 再创建当前记录。两步原子，避免并发 create 时互相清零的 race。
      const created = await this.prisma.$transaction(async (tx) => {
        if (data.isDefault === true) {
          await tx.userModelConfig.updateMany({
            where: {
              userId,
              modelType: input.modelType,
              isDefault: true,
            },
            data: { isDefault: false },
          });
        }
        return tx.userModelConfig.create({ data });
      });
      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          `Model "${input.modelId}" already configured for provider "${provider}" under type "${input.modelType}"`,
        );
      }
      throw error;
    }
  }

  async update(
    userId: string,
    id: string,
    patch: UpdateUserModelConfigInput,
  ): Promise<UserModelConfig> {
    const existing = await this.prisma.userModelConfig.findUnique({
      where: { id },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException("Model config not found");
    }
    if (patch.apiKeyId?.trim()) {
      await this.assertApiKeyOwnership(
        userId,
        patch.apiKeyId.trim(),
        existing.provider,
      );
    }

    const data: Prisma.UserModelConfigUpdateInput = {};
    if (patch.modelId !== undefined) data.modelId = patch.modelId.trim();
    if (patch.displayName !== undefined)
      data.displayName = patch.displayName.trim();
    if (patch.modelType !== undefined) data.modelType = patch.modelType;
    if (patch.apiEndpoint !== undefined)
      data.apiEndpoint = patch.apiEndpoint?.trim() || null;
    if (patch.apiKeyId !== undefined)
      data.apiKeyId = patch.apiKeyId?.trim() || null;
    if (patch.maxTokens !== undefined) data.maxTokens = patch.maxTokens;
    if (patch.temperature !== undefined) data.temperature = patch.temperature;
    if (patch.embeddingDimensions !== undefined)
      data.embeddingDimensions = patch.embeddingDimensions;
    if (patch.maxInputTokens !== undefined)
      data.maxInputTokens = patch.maxInputTokens;
    if (patch.isReasoning !== undefined) data.isReasoning = patch.isReasoning;
    if (patch.apiFormat !== undefined) data.apiFormat = patch.apiFormat;
    if (patch.supportsTemperature !== undefined)
      data.supportsTemperature = patch.supportsTemperature;
    if (patch.supportsStreaming !== undefined)
      data.supportsStreaming = patch.supportsStreaming;
    if (patch.supportsFunctionCalling !== undefined)
      data.supportsFunctionCalling = patch.supportsFunctionCalling;
    if (patch.supportsVision !== undefined)
      data.supportsVision = patch.supportsVision;
    if (patch.tokenParamName !== undefined)
      data.tokenParamName = patch.tokenParamName;
    if (patch.defaultTimeoutMs !== undefined)
      data.defaultTimeoutMs = patch.defaultTimeoutMs;
    if (patch.priority !== undefined) data.priority = patch.priority;
    if (patch.isEnabled !== undefined) data.isEnabled = patch.isEnabled;
    if (patch.isDefault !== undefined) data.isDefault = patch.isDefault;
    if (patch.description !== undefined)
      data.description = patch.description?.trim() || null;
    if (patch.priceInputPerMillion !== undefined)
      data.priceInputPerMillion = patch.priceInputPerMillion;
    if (patch.priceOutputPerMillion !== undefined)
      data.priceOutputPerMillion = patch.priceOutputPerMillion;
    if (patch.rpmLimit !== undefined) data.rpmLimit = patch.rpmLimit;
    if (patch.tpmLimit !== undefined) data.tpmLimit = patch.tpmLimit;

    try {
      // 事务化：当 isDefault=true 或 modelType 变更时，先在事务里清同类下的
      // 其他 default，再更新本行，保证并发安全。
      const updated = await this.prisma.$transaction(async (tx) => {
        const targetModelType = patch.modelType ?? existing.modelType;
        const needsDefaultCleanup =
          patch.isDefault === true || patch.modelType !== undefined;
        if (needsDefaultCleanup && (patch.isDefault ?? existing.isDefault)) {
          await tx.userModelConfig.updateMany({
            where: {
              userId,
              modelType: targetModelType,
              isDefault: true,
              NOT: { id },
            },
            data: { isDefault: false },
          });
        }
        return tx.userModelConfig.update({ where: { id }, data });
      });
      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          `Model "${patch.modelId ?? existing.modelId}" already exists for this provider`,
        );
      }
      throw error;
    }
  }

  async delete(userId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.userModelConfig.findUnique({
      where: { id },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException("Model config not found");
    }
    await this.prisma.userModelConfig.delete({ where: { id } });
    return { success: true };
  }

  async listByUser(userId: string): Promise<UserModelConfig[]> {
    return this.prisma.userModelConfig.findMany({
      where: { userId },
      orderBy: [
        { isDefault: "desc" },
        { modelType: "asc" },
        { priority: "desc" },
        { createdAt: "desc" },
      ],
    });
  }

  async listByUserAndProvider(
    userId: string,
    provider: string,
  ): Promise<UserModelConfig[]> {
    return this.prisma.userModelConfig.findMany({
      where: { userId, provider: provider.toLowerCase() },
      orderBy: [
        { isDefault: "desc" },
        { modelType: "asc" },
        { priority: "desc" },
      ],
    });
  }

  async findById(userId: string, id: string): Promise<UserModelConfig | null> {
    const item = await this.prisma.userModelConfig.findUnique({
      where: { id },
    });
    if (!item || item.userId !== userId) return null;
    return item;
  }

  /**
   * 按 modelId 精确查找当前用户的配置。供 AiModelConfigService 在路由时查用。
   *
   * 用精确匹配而非 insensitive：避免用户同时创建 "gpt-4o" / "GPT-4o" 时不确定。
   *
   * ★ 注意：自 2026-04-22 migration 后 unique 是
   *    @@unique([userId, provider, modelId, modelType])
   * 同一 modelId 可能在多个 modelType 下都有行（例如 gpt-4o 同时作
   * CHAT / CODE / MULTIMODAL）。这里用 findFirst 不带 modelType 过滤，
   * 是故意的——调用方（`findUserModelConfigByModelId`）只需要 (apiEndpoint,
   * provider, key) 做路由，跨 modelType 的同 modelId 这些字段相同，取哪一条都行。
   */
  async findByModelId(
    userId: string,
    modelId: string,
  ): Promise<UserModelConfig | null> {
    return this.prisma.userModelConfig.findFirst({
      where: {
        userId,
        modelId,
        isEnabled: true,
      },
    });
  }

  /**
   * 查用户在指定 modelType 下的默认模型（isDefault=true）。
   * 没有则返回该 type 下 priority 最高的启用模型，再没有返回 null。
   */
  async findDefaultForType(
    userId: string,
    modelType: AIModelType,
  ): Promise<UserModelConfig | null> {
    const def = await this.prisma.userModelConfig.findFirst({
      where: { userId, modelType, isEnabled: true, isDefault: true },
    });
    if (def) return def;
    return this.prisma.userModelConfig.findFirst({
      where: { userId, modelType, isEnabled: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  }

  async setDefault(userId: string, id: string): Promise<UserModelConfig> {
    const existing = await this.prisma.userModelConfig.findUnique({
      where: { id },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException("Model config not found");
    }
    // 先把同 modelType 下其他 isDefault 清掉，同时把当前设为 default。
    // 如当前处于 isEnabled=false，同步打开 —— 否则 findDefaultForType
    // 因 isEnabled 过滤失效，isDefault=true 成了 ghost 状态。
    await this.prisma.$transaction([
      this.prisma.userModelConfig.updateMany({
        where: {
          userId,
          modelType: existing.modelType,
          isDefault: true,
          NOT: { id },
        },
        data: { isDefault: false },
      }),
      this.prisma.userModelConfig.update({
        where: { id },
        data: { isDefault: true, isEnabled: true },
      }),
    ]);
    return (await this.prisma.userModelConfig.findUnique({
      where: { id },
    })) as UserModelConfig;
  }
}
