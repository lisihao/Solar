import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { SecretsService } from "../../platform/credentials/storage/secrets/secrets.service";
// Credential-admin surface imports credentials from source (not the engine
// facade barrel) to avoid circular-barrel DI breakage; eslint-exempted below.
import { KeyAssignmentsService } from "../../platform/credentials/governance/key-assignments/key-assignments.service";
import { AIModelType } from "@prisma/client";
import {
  mapWithConcurrency,
  ConcurrencyLimits,
} from "../../../common/utils/concurrency.utils";
import {
  UserManagementService,
  ResourceManagementService,
  StatisticsService,
} from "./services";
import { APP_CONFIG } from "../../../common/config/app.config";
import { inferIsReasoning, getKnownModelLimit } from "../../ai-engine/facade";
import { AuditService, AuditAction } from "../../../common/audit/audit.service";
import { maskSensitiveSetting } from "./utils/mask-sensitive-setting.utils";

/** Minimal model for Perplexity balance check */
const PERPLEXITY_VALIDATION_MODEL = "llama-3.1-sonar-small-128k-online";

type ExternalProvider = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  headers?: string;
  isDefault?: boolean;
};

const DEFAULT_EXTERNAL_PROVIDERS: ExternalProvider[] = [
  {
    id: "market",
    name: "Market / Price",
    description: "GPU/compute pricing, supply-demand and deal flows",
    category: "market",
  },
  {
    id: "finance",
    name: "Finance / Filings",
    description: "Financials, filings, funding, IPO/registration updates",
    category: "finance",
  },
  {
    id: "news",
    name: "News / Sentiment",
    description: "News streams and sentiment for adjudication evidence",
    category: "news",
  },
  {
    id: "regulation",
    name: "Regulation / Policy",
    description: "Export controls, energy constraints, compliance metrics",
    category: "regulation",
  },
];

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private secretsService: SecretsService,
    private userManagementService: UserManagementService,
    private resourceManagementService: ResourceManagementService,
    private statisticsService: StatisticsService,
    // S5 audit fix（2026-05-04）：管理员敏感操作必须落审计
    private auditService: AuditService,
    // PR-6（2026-05-12）：updateAIModel 重启模型时反向恢复 STALE assignments
    private keyAssignmentsService: KeyAssignmentsService,
  ) {}

  /**
   * 获取所有用户列表
   * @delegate UserManagementService
   */
  async getAllUsers(page = 1, limit = 20, search?: string) {
    return this.userManagementService.getAllUsers(page, limit, search);
  }

  /**
   * 获取用户统计信息（用于管理仪表板）
   * @delegate UserManagementService
   */
  async getUserStats() {
    return this.userManagementService.getUserStats();
  }

  /**
   * 获取用户登录历史
   * @delegate UserManagementService
   */
  async getUserLoginHistory(userId: string, limit = 10) {
    return this.userManagementService.getUserLoginHistory(userId, limit);
  }

  /**
   * 创建新用户（管理员功能）
   * @delegate UserManagementService
   */
  async createUser(data: {
    email: string;
    username?: string;
    role?: "USER" | "ADMIN";
    password?: string;
  }) {
    const result = await this.userManagementService.createUser(data);
    await this.auditService.log({
      action: AuditAction.USER_REGISTER,
      resourceType: "User",
      resourceId: (result as { id?: string })?.id,
      details: { email: data.email, role: data.role },
      result: "SUCCESS",
    });
    return result;
  }

  /**
   * 删除资源
   * @delegate ResourceManagementService
   */
  async deleteResource(resourceId: string) {
    return this.resourceManagementService.deleteResource(resourceId);
  }

  /**
   * 批量删除资源
   * @delegate ResourceManagementService
   */
  async deleteResources(resourceIds: string[]) {
    return this.resourceManagementService.deleteResources(resourceIds);
  }

  /**
   * 更新用户角色
   * @delegate UserManagementService
   */
  async updateUserRole(userId: string, role: "USER" | "ADMIN") {
    return this.userManagementService.updateUserRole(userId, role);
  }

  /**
   * 禁用/启用用户
   * @delegate UserManagementService
   */
  async toggleUserStatus(userId: string, isActive: boolean) {
    return this.userManagementService.toggleUserStatus(userId, isActive);
  }

  /**
   * 更新用户信息
   * @delegate UserManagementService
   */
  async updateUser(
    userId: string,
    data: {
      username?: string;
      role?: "USER" | "ADMIN";
      status?: "active" | "inactive" | "banned";
    },
  ) {
    return this.userManagementService.updateUser(userId, data);
  }

  /**
   * 删除用户
   * @delegate UserManagementService
   */
  async deleteUser(userId: string) {
    return this.userManagementService.deleteUser(userId);
  }

  // ============ Credits Management ============

  /**
   * 获取用户积分详情
   * @delegate UserManagementService
   */
  async getUserCredits(userId: string) {
    return this.userManagementService.getUserCredits(userId);
  }

  /**
   * 发放积分
   * @delegate UserManagementService
   */
  async grantCredits(userId: string, amount: number, reason?: string) {
    return this.userManagementService.grantCredits(userId, amount, reason);
  }

  /**
   * 冻结/解冻用户积分账户
   * @delegate UserManagementService
   */
  async toggleCreditFreeze(userId: string, freeze: boolean, reason?: string) {
    return this.userManagementService.toggleCreditFreeze(
      userId,
      freeze,
      reason,
    );
  }

  /**
   * 获取所有积分账户列表（管理员面板）
   */
  async getCreditAccounts(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;

    const where = search
      ? {
          user: {
            OR: [
              { email: { contains: search, mode: "insensitive" as const } },
              { username: { contains: search, mode: "insensitive" as const } },
            ],
          },
        }
      : {};

    const [accounts, total] = await Promise.all([
      this.prisma.creditAccount.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
            },
          },
        },
      }),
      this.prisma.creditAccount.count({ where }),
    ]);

    return {
      accounts: accounts.map((account) => ({
        userId: account.userId,
        email: account.user.email,
        username: account.user.username,
        balance: account.balance,
        totalEarned: account.totalEarned,
        totalSpent: account.totalSpent,
        isFrozen: account.isFrozen,
        createdAt: account.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 获取积分统计信息（管理员面板）
   */
  async getCreditsStats() {
    const [totalAccounts, aggregates, frozenAccounts, lowBalanceAccounts] =
      await Promise.all([
        this.prisma.creditAccount.count(),
        this.prisma.creditAccount.aggregate({
          _sum: {
            balance: true,
            totalEarned: true,
            totalSpent: true,
          },
        }),
        this.prisma.creditAccount.count({ where: { isFrozen: true } }),
        this.prisma.creditAccount.count({ where: { balance: { lt: 500 } } }),
      ]);

    return {
      totalAccounts,
      totalBalance: aggregates._sum.balance || 0,
      totalEarned: aggregates._sum.totalEarned || 0,
      totalSpent: aggregates._sum.totalSpent || 0,
      frozenAccounts,
      lowBalanceAccounts,
    };
  }

  /**
   * 获取用户积分交易记录（管理员面板）
   */
  async getCreditTransactions(userId: string, limit = 50, offset = 0) {
    const account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      throw new NotFoundException(
        `Credit account for user ${userId} not found`,
      );
    }

    const [transactions, total] = await Promise.all([
      this.prisma.creditTransaction.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.creditTransaction.count({
        where: { accountId: account.id },
      }),
    ]);

    return {
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter,
        description: tx.description,
        moduleType: tx.moduleType,
        operationType: tx.operationType,
        createdAt: tx.createdAt,
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * 获取 Overview 页面各模块统计数据
   * @delegate StatisticsService
   */
  async getOverviewStats() {
    return this.statisticsService.getOverviewStats();
  }

  /**
   * 获取系统统计信息
   * @delegate StatisticsService
   */
  async getSystemStats() {
    return this.statisticsService.getSystemStats();
  }

  /**
   * 检查用户是否是管理员
   * @delegate UserManagementService
   */
  async isUserAdmin(userId: string): Promise<boolean> {
    return this.userManagementService.isUserAdmin(userId);
  }

  // ============ AI Model Management ============

  /**
   * 获取所有AI模型配置
   */
  async getAllAIModels() {
    const models = await this.prisma.aIModel.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });

    // 返回掩码的API Key，显示前4位和后4位
    return models.map((model) => ({
      ...model,
      apiKey: model.apiKey ? this.maskApiKey(model.apiKey) : null,
      hasApiKey: !!model.apiKey || !!model.secretKey,
    }));
  }

  /**
   * 获取单个AI模型
   * @param id 模型ID
   * @param includeFullApiKey 是否返回完整的 API Key（用于编辑模式）
   */
  async getAIModel(id: string, includeFullApiKey: boolean = false) {
    const model = await this.prisma.aIModel.findUnique({
      where: { id },
    });

    if (!model) {
      throw new NotFoundException(`AI Model ${id} not found`);
    }

    // 编辑模式返回完整 API Key，否则返回掩码
    return {
      ...model,
      apiKey: model.apiKey
        ? includeFullApiKey
          ? model.apiKey
          : this.maskApiKey(model.apiKey)
        : null,
      hasApiKey: !!model.apiKey || !!model.secretKey,
    };
  }

  /**
   * 掩码 API Key，显示前4位和后4位
   */
  private maskApiKey(apiKey: string): string {
    if (apiKey.length <= 12) {
      return "****" + apiKey.slice(-4);
    }
    return apiKey.slice(0, 4) + "****" + apiKey.slice(-4);
  }

  /**
   * 校验并修正模型配置，返回修正后的数据和警告信息
   * 在 createAIModel / updateAIModel 写入数据库前调用
   */
  private validateAndCorrectModelConfig(
    modelId: string,
    data: {
      maxTokens?: number;
      isReasoning?: boolean;
      tokenParamName?: string;
      supportsTemperature?: boolean;
    },
  ): { corrected: typeof data; warnings: string[] } {
    const warnings: string[] = [];
    const corrected = { ...data };

    // 1. maxTokens 超过已知 API 限制 → 自动修正
    const knownLimit = getKnownModelLimit(modelId);
    if (
      knownLimit &&
      corrected.maxTokens !== undefined &&
      corrected.maxTokens > knownLimit
    ) {
      warnings.push(
        `maxTokens ${corrected.maxTokens} exceeds known API limit ${knownLimit} for ${modelId}, auto-corrected`,
      );
      this.logger.warn(
        `[validateModelConfig] ${modelId}: maxTokens ${corrected.maxTokens} -> ${knownLimit} (known API limit)`,
      );
      corrected.maxTokens = knownLimit;
    }

    // 2. isReasoning 与模型名称不匹配 → 附 warning
    if (corrected.isReasoning !== undefined) {
      const inferredReasoning = inferIsReasoning(modelId);
      if (corrected.isReasoning && !inferredReasoning) {
        warnings.push(
          `isReasoning=true but "${modelId}" does not match known reasoning model patterns. Verify this is correct.`,
        );
        this.logger.warn(
          `[validateModelConfig] ${modelId}: isReasoning=true but name does not match reasoning patterns`,
        );
      }

      // 3. 自动设置推理模型相关参数
      if (corrected.isReasoning) {
        if (corrected.tokenParamName === undefined) {
          corrected.tokenParamName = "max_completion_tokens";
        }
        if (corrected.supportsTemperature === undefined) {
          corrected.supportsTemperature = false;
        }
      } else {
        if (corrected.tokenParamName === undefined) {
          corrected.tokenParamName = "max_tokens";
        }
        if (corrected.supportsTemperature === undefined) {
          corrected.supportsTemperature = true;
        }
      }
    }

    return { corrected, warnings };
  }

  /**
   * 创建或更新AI模型 (upsert)
   * 根据 modelId 判断：
   * - 如果相同 modelId 已存在，则更新该模型
   * - 如果 modelId 不同，则创建新模型（即使是同一个 provider/name）
   */
  async createAIModel(data: {
    name: string;
    displayName: string;
    provider: string;
    modelId: string;
    modelType?: AIModelType;
    icon: string;
    color: string;
    apiEndpoint: string;
    apiKey?: string;
    secretKey?: string | null; // 引用 Secret Manager 中的密钥名称
    maxTokens?: number;
    temperature?: number;
    description?: string;
    isReasoning?: boolean;
    // ★ 新增：模型能力配置字段
    apiFormat?: string;
    supportsTemperature?: boolean;
    supportsStreaming?: boolean;
    supportsFunctionCalling?: boolean;
    supportsVision?: boolean;
    tokenParamName?: string;
    defaultTimeoutMs?: number;
    priceInputPerMillion?: number;
    priceOutputPerMillion?: number;
    priority?: number;
  }) {
    // Trim apiKey to remove any whitespace from copy-paste
    const apiKey = data.apiKey?.trim() || null;
    // 保留 provider 原始大小写用于显示（下游比较均已使用 toLowerCase）
    const provider = data.provider;

    this.logger.log(
      `createAIModel called: name=${data.name}, modelId=${data.modelId}, apiKeyProvided=${!!apiKey}, apiKeyLength=${apiKey?.length || 0}`,
    );

    // ★ 校验并修正模型配置
    const { corrected, warnings } = this.validateAndCorrectModelConfig(
      data.modelId,
      {
        maxTokens: data.maxTokens,
        isReasoning: data.isReasoning,
        tokenParamName: data.tokenParamName,
        supportsTemperature: data.supportsTemperature,
      },
    );
    data.maxTokens = corrected.maxTokens;
    data.isReasoning = corrected.isReasoning;
    data.tokenParamName = corrected.tokenParamName;
    data.supportsTemperature = corrected.supportsTemperature;

    // 根据 modelId 和 name 检查是否存在完全相同的模型配置
    // 如果只有 modelId 相同但 name 不同，则创建新配置（支持横向扩展）
    const existingByModelId = await this.prisma.aIModel.findFirst({
      where: {
        modelId: { equals: data.modelId, mode: "insensitive" },
        name: { equals: data.name, mode: "insensitive" },
      },
    });

    if (existingByModelId) {
      // 如果存在完全相同的 modelId 和 name，则更新
      this.logger.log(
        `AI Model with modelId=${data.modelId} already exists (id=${existingByModelId.id}), updating`,
      );

      // 准备更新数据 - 只有提供了有效的 apiKey 才更新
      const updateData: Record<string, unknown> = {
        name: data.name,
        displayName: data.displayName,
        provider,
        modelType: data.modelType ?? existingByModelId.modelType,
        icon: data.icon,
        color: data.color,
        apiEndpoint: data.apiEndpoint,
        secretKey: data.secretKey,
        maxTokens: data.maxTokens ?? existingByModelId.maxTokens,
        temperature: data.temperature ?? existingByModelId.temperature,
        description: data.description,
        isReasoning: data.isReasoning ?? existingByModelId.isReasoning,
        // ★ 新增：模型能力配置字段
        apiFormat: data.apiFormat ?? existingByModelId.apiFormat,
        supportsTemperature:
          data.supportsTemperature ?? existingByModelId.supportsTemperature,
        supportsStreaming:
          data.supportsStreaming ?? existingByModelId.supportsStreaming,
        supportsFunctionCalling:
          data.supportsFunctionCalling ??
          existingByModelId.supportsFunctionCalling,
        supportsVision: data.supportsVision ?? existingByModelId.supportsVision,
        tokenParamName: data.tokenParamName ?? existingByModelId.tokenParamName,
        defaultTimeoutMs:
          data.defaultTimeoutMs ?? existingByModelId.defaultTimeoutMs,
        priceInputPerMillion:
          data.priceInputPerMillion ?? existingByModelId.priceInputPerMillion,
        priceOutputPerMillion:
          data.priceOutputPerMillion ?? existingByModelId.priceOutputPerMillion,
        priority: data.priority ?? existingByModelId.priority,
      };

      // 只有当提供了有效的 API Key（非空、非掩码格式）才更新
      if (apiKey && !apiKey.includes("****")) {
        updateData.apiKey = apiKey;
        this.logger.log(
          `Updating API key for modelId=${data.modelId}: length=${apiKey.length}, prefix=${apiKey.substring(0, 8)}...`,
        );
      } else {
        this.logger.log(
          `Keeping existing API key for modelId=${data.modelId} (new key not provided or is masked)`,
        );
      }

      const updated = await this.prisma.aIModel.update({
        where: { id: existingByModelId.id },
        data: updateData,
      });

      this.logger.log(
        `AI Model updated: ${updated.name} (${updated.displayName}), modelId=${updated.modelId}`,
      );

      return {
        ...updated,
        apiKey: updated.apiKey ? this.maskApiKey(updated.apiKey) : null,
        hasApiKey: !!updated.apiKey || !!updated.secretKey,
        isUpdate: true, // 标记这是更新操作
        warnings,
      };
    }

    // modelId 不存在，创建新模型
    const model = await this.prisma.aIModel.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        provider,
        modelId: data.modelId,
        modelType: data.modelType ?? "CHAT",
        icon: data.icon,
        color: data.color,
        apiEndpoint: data.apiEndpoint,
        apiKey: apiKey,
        secretKey: data.secretKey,
        maxTokens: data.maxTokens ?? 4096,
        temperature: data.temperature ?? 0.7,
        description: data.description,
        isEnabled: true,
        isDefault: false,
        // 数据根因修复：admin 建模型时未显式标 isReasoning，按 modelId 启发式兜底，
        // 让 reasoning 模型（gpt-5.x / o1/o3/o4 等）落库即 isReasoning=true，
        // 下游 token 参数决策（max_completion_tokens）才正确。显式传了就尊重。
        isReasoning: data.isReasoning ?? inferIsReasoning(data.modelId),
        // ★ 新增：模型能力配置字段
        apiFormat: data.apiFormat ?? "openai",
        supportsTemperature: data.supportsTemperature ?? true,
        supportsStreaming: data.supportsStreaming ?? true,
        supportsFunctionCalling: data.supportsFunctionCalling ?? true,
        supportsVision: data.supportsVision ?? false,
        tokenParamName: data.tokenParamName ?? "max_tokens",
        defaultTimeoutMs: data.defaultTimeoutMs ?? 120000,
        priceInputPerMillion: data.priceInputPerMillion,
        priceOutputPerMillion: data.priceOutputPerMillion,
        priority: data.priority ?? 50,
      },
    });

    this.logger.log(
      `AI Model created: ${model.name} (${model.displayName}), modelId=${model.modelId}`,
    );

    return {
      ...model,
      apiKey: model.apiKey ? this.maskApiKey(model.apiKey) : null,
      hasApiKey: !!model.apiKey || !!model.secretKey,
      isUpdate: false, // 标记这是创建操作
      warnings,
    };
  }

  /**
   * 更新AI模型
   */
  async updateAIModel(
    id: string,
    data: {
      displayName?: string;
      provider?: string;
      modelId?: string;
      modelType?: AIModelType;
      icon?: string;
      color?: string;
      apiEndpoint?: string;
      apiKey?: string;
      secretKey?: string | null; // 引用 Secret Manager 中的密钥名称
      maxTokens?: number;
      temperature?: number;
      description?: string;
      isEnabled?: boolean;
      isReasoning?: boolean;
      // ★ 新增：模型能力配置字段
      apiFormat?: string;
      supportsTemperature?: boolean;
      supportsStreaming?: boolean;
      supportsFunctionCalling?: boolean;
      supportsVision?: boolean;
      tokenParamName?: string;
      defaultTimeoutMs?: number;
      priceInputPerMillion?: number;
      priceOutputPerMillion?: number;
      priority?: number;
      // ★ Structured Output capability matrix (2026-05-06)
      structuredOutputStrategy?: string | null;
      fallbackStrategies?: string[];
      supportsJsonSchemaStrict?: boolean;
      supportsJsonSchema?: boolean;
      supportsToolUse?: boolean;
      supportsJsonMode?: boolean;
      supportsGbnfGrammar?: boolean;
    },
  ) {
    const model = await this.prisma.aIModel.findUnique({
      where: { id },
    });

    if (!model) {
      throw new NotFoundException(`AI Model ${id} not found`);
    }

    // 如果apiKey为空字符串，设为null；如果是掩码格式（包含****）则保持不变
    // 同时对apiKey进行trim处理，防止复制时带入空格
    let apiKeyUpdate = undefined;
    if (data.apiKey !== undefined) {
      const trimmedKey =
        typeof data.apiKey === "string" ? data.apiKey.trim() : data.apiKey;
      this.logger.log(
        `API Key update: received="${data.apiKey?.substring(0, 10)}...", trimmed="${trimmedKey?.substring(0, 10)}...", length=${trimmedKey?.length || 0}`,
      );
      if (trimmedKey === "" || trimmedKey === null) {
        apiKeyUpdate = null;
        this.logger.log("API Key update: setting to null (empty)");
      } else if (trimmedKey.includes("****")) {
        // 掩码格式，保持不变
        this.logger.log("API Key update: keeping existing (masked format)");
      } else {
        apiKeyUpdate = trimmedKey;
        this.logger.log(
          `API Key update: setting new key (length=${trimmedKey.length})`,
        );
      }
    }

    // ★ 校验并修正模型配置
    const effectiveModelId = data.modelId ?? model.modelId;
    const { corrected: updateCorrected, warnings: updateWarnings } =
      this.validateAndCorrectModelConfig(effectiveModelId, {
        maxTokens: data.maxTokens,
        isReasoning: data.isReasoning,
        tokenParamName: data.tokenParamName,
        supportsTemperature: data.supportsTemperature,
      });

    const updated = await this.prisma.aIModel.update({
      where: { id },
      data: {
        displayName: data.displayName,
        provider: data.provider,
        modelId: data.modelId,
        modelType: data.modelType,
        icon: data.icon,
        color: data.color,
        apiEndpoint: data.apiEndpoint,
        apiKey: apiKeyUpdate,
        secretKey: data.secretKey,
        maxTokens: updateCorrected.maxTokens,
        temperature: data.temperature,
        description: data.description,
        isEnabled: data.isEnabled,
        isReasoning: updateCorrected.isReasoning,
        // ★ 新增：模型能力配置字段
        apiFormat: data.apiFormat,
        supportsTemperature: updateCorrected.supportsTemperature,
        supportsStreaming: data.supportsStreaming,
        supportsFunctionCalling: data.supportsFunctionCalling,
        supportsVision: data.supportsVision,
        tokenParamName: updateCorrected.tokenParamName,
        defaultTimeoutMs: data.defaultTimeoutMs,
        priceInputPerMillion: data.priceInputPerMillion,
        priceOutputPerMillion: data.priceOutputPerMillion,
        priority: data.priority,
        // ★ Structured Output capability matrix (2026-05-06)
        structuredOutputStrategy: data.structuredOutputStrategy,
        fallbackStrategies: data.fallbackStrategies,
        supportsJsonSchemaStrict: data.supportsJsonSchemaStrict,
        supportsJsonSchema: data.supportsJsonSchema,
        supportsToolUse: data.supportsToolUse,
        supportsJsonMode: data.supportsJsonMode,
        supportsGbnfGrammar: data.supportsGbnfGrammar,
      },
    });

    this.logger.log(
      `AI Model updated: ${updated.name}, hasApiKey=${!!updated.apiKey}, apiKeyLength=${updated.apiKey?.length || 0}`,
    );

    // PR-6（2026-05-12）：isEnabled false→true 切换时反向恢复 STALE assignments
    // 触发场景：admin 之前 disable 模型让 cron 把关联 KeyAssignment 打成 STALE，
    // 现在重新 enable 模型 → 用户原有权益自动复活，不需要 admin 手动逐条改。
    // 只看从 false → true 的切换，避免无关 update 误触发。
    if (model.isEnabled === false && updated.isEnabled === true) {
      try {
        const restored = await this.keyAssignmentsService.reactivateStale(id);
        if (restored.count > 0) {
          this.logger.log(
            `[updateAIModel] Reactivated ${restored.count} STALE assignments after re-enabling model ${id}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[updateAIModel] reactivateStale failed (non-fatal): ${(err as Error).message}`,
        );
      }
    }

    return {
      ...updated,
      apiKey: updated.apiKey ? this.maskApiKey(updated.apiKey) : null,
      hasApiKey: !!updated.apiKey || !!updated.secretKey,
      warnings: updateWarnings,
    };
  }

  /**
   * 设置默认AI模型
   */
  async setDefaultAIModel(id: string) {
    const model = await this.prisma.aIModel.findUnique({
      where: { id },
    });

    if (!model) {
      throw new NotFoundException(`AI Model ${id} not found`);
    }

    // 先将所有模型设为非默认
    await this.prisma.aIModel.updateMany({
      data: { isDefault: false },
    });

    // 设置当前模型为默认
    const updated = await this.prisma.aIModel.update({
      where: { id },
      data: { isDefault: true },
    });

    this.logger.log(`AI Model ${updated.name} set as default`);

    return {
      ...updated,
      apiKey: updated.apiKey ? this.maskApiKey(updated.apiKey) : null,
      hasApiKey: !!updated.apiKey || !!updated.secretKey,
    };
  }

  /**
   * 删除AI模型
   */
  async deleteAIModel(id: string) {
    const model = await this.prisma.aIModel.findUnique({
      where: { id },
    });

    if (!model) {
      throw new NotFoundException(`AI Model ${id} not found`);
    }

    // 不允许删除默认模型
    if (model.isDefault) {
      throw new Error("Cannot delete the default AI model");
    }

    await this.prisma.aIModel.delete({
      where: { id },
    });

    this.logger.log(`AI Model deleted: ${model.name}`);
    await this.auditService.log({
      action: AuditAction.SYSTEM_CONFIG_CHANGE,
      resourceType: "AIModel",
      resourceId: id,
      details: {
        operation: "deleteAIModel",
        modelName: model.name,
        provider: model.provider,
      },
      result: "SUCCESS",
    });

    return { success: true, message: "AI Model deleted successfully" };
  }

  /**
   * 获取AI模型的API Key（仅用于测试连接）
   * 优先从 Secret Manager 获取（如果 secretKey 已配置），否则使用直接存储的 apiKey
   * ★ 对返回值做 trim 处理，避免空格导致 API 调用失败
   */
  async getAIModelApiKey(id: string): Promise<string | null> {
    const model = await this.prisma.aIModel.findUnique({
      where: { id },
      select: { apiKey: true, secretKey: true },
    });

    if (!model) {
      return null;
    }

    // 优先使用 secretKey 从 Secret Manager 获取
    if (model.secretKey) {
      this.logger.log(
        `[getAIModelApiKey] model=${id}, secretKey="${model.secretKey}", hasLegacyApiKey=${!!model.apiKey}, legacyApiKeyLength=${model.apiKey?.length ?? 0}`,
      );
      const secretValue = await this.secretsService.getValueInternal(
        model.secretKey,
      );
      if (secretValue) {
        const trimmedValue = secretValue.trim();
        this.logger.log(
          `[getAIModelApiKey] Secret resolved: length=${trimmedValue.length}, prefix="${trimmedValue.substring(0, 10)}..."`,
        );
        return trimmedValue;
      }
      this.logger.warn(
        `[getAIModelApiKey] Secret '${model.secretKey}' not found for model ${id}, falling back to apiKey`,
      );
    }

    // 回退到直接存储的 apiKey
    const fallback = model.apiKey?.trim() || null;
    this.logger.log(
      `[getAIModelApiKey] Using fallback apiKey: length=${fallback?.length ?? 0}, prefix="${fallback?.substring(0, 10) ?? "null"}..."`,
    );
    return fallback;
  }

  // ============ System Settings Management ============

  /**
   * 获取系统设置（按分类）。敏感字段 (apiKey/secret/...) 经
   * maskSensitiveSetting 屏蔽，只返 {configured, hint}。详见
   * `utils/mask-sensitive-setting.utils.ts` 内 JSDoc。
   */
  async getSettings(category?: string) {
    const where = category ? { category } : {};
    const settings = await this.prisma.systemSetting.findMany({
      where,
      orderBy: { key: "asc" },
    });
    const result: Record<string, unknown> = {};
    for (const setting of settings) {
      let parsed: unknown;
      try {
        if (setting.value) parsed = JSON.parse(setting.value);
      } catch {
        parsed = setting.value;
      }
      result[setting.key] = maskSensitiveSetting(setting.key, parsed);
    }
    return result;
  }

  /**
   * 获取单个设置
   */
  async getSetting(key: string) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      return null;
    }

    try {
      return setting.value ? JSON.parse(setting.value) : null;
    } catch {
      return setting.value;
    }
  }

  /**
   * 更新或创建设置
   */
  async setSetting(
    key: string,
    value: unknown,
    options?: { description?: string; category?: string },
  ) {
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);

    const setting = await this.prisma.systemSetting.upsert({
      where: { key },
      update: {
        value: stringValue,
        description: options?.description,
        category: options?.category,
      },
      create: {
        key,
        value: stringValue,
        description: options?.description,
        category: options?.category ?? "general",
      },
    });

    this.logger.log(`System setting updated: ${key}`);

    return setting;
  }

  /**
   * 批量更新设置（带并发限制）
   */
  async setSettings(
    settings: Array<{
      key: string;
      value: unknown;
      description?: string;
      category?: string;
    }>,
  ) {
    const results = await mapWithConcurrency(
      settings,
      (s) =>
        this.setSetting(s.key, s.value, {
          description: s.description,
          category: s.category,
        }),
      ConcurrencyLimits.DB,
    );

    this.logger.log(`Updated ${results.length} system settings`);

    return results;
  }

  /**
   * 删除设置
   */
  async deleteSetting(key: string) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      throw new NotFoundException(`Setting ${key} not found`);
    }

    await this.prisma.systemSetting.delete({
      where: { key },
    });

    this.logger.log(`System setting deleted: ${key}`);

    return { success: true, message: "Setting deleted successfully" };
  }

  /**
   * 获取搜索API配置
   * ★ 支持多 Key 格式，返回 keyCount 便于 UI 展示
   */
  async getSearchConfig() {
    const provider = await this.getSetting("search.provider");
    const perplexityKey = await this.getSetting("search.perplexity.apiKey");
    const enabled = await this.getSetting("search.enabled");

    // ★ 读取多 Key 配置（新格式）
    const tavilyKeys = await this.getSetting("search.tavily.apiKeys");
    const serperKeys = await this.getSetting("search.serper.apiKeys");

    // ★ 兼容读取旧格式（单 Key）
    const tavilyKeyLegacy = await this.getSetting("search.tavily.apiKey");
    const serperKeyLegacy = await this.getSetting("search.serper.apiKey");

    // 合并新旧格式的 Key
    const tavilyKeyList = Array.isArray(tavilyKeys)
      ? tavilyKeys
      : tavilyKeyLegacy
        ? [tavilyKeyLegacy]
        : [];
    const serperKeyList = Array.isArray(serperKeys)
      ? serperKeys
      : serperKeyLegacy
        ? [serperKeyLegacy]
        : [];

    return {
      provider: provider || "tavily",
      enabled: enabled !== false,
      perplexity: {
        apiKey: perplexityKey ? "***configured***" : null,
        hasApiKey: !!perplexityKey,
      },
      tavily: {
        apiKey: tavilyKeyList.length > 0 ? "***configured***" : null,
        hasApiKey: tavilyKeyList.length > 0,
        keyCount: tavilyKeyList.length, // ★ 返回 Key 数量
      },
      serper: {
        apiKey: serperKeyList.length > 0 ? "***configured***" : null,
        hasApiKey: serperKeyList.length > 0,
        keyCount: serperKeyList.length, // ★ 返回 Key 数量
      },
      // DuckDuckGo doesn't require API key - always available
      duckduckgo: {
        apiKey: null,
        hasApiKey: true, // Always "configured" since no key needed
        noKeyRequired: true,
      },
    };
  }

  /**
   * 更新搜索API配置
   * ★ 支持多 Key 配置：tavilyApiKeys / serperApiKeys
   * ★ 兼容旧格式：tavilyApiKey / serperApiKey
   */
  async updateSearchConfig(config: {
    provider?: string;
    enabled?: boolean;
    perplexityApiKey?: string;
    tavilyApiKey?: string; // 旧格式（单个 Key）
    serperApiKey?: string; // 旧格式（单个 Key）
    tavilyApiKeys?: string[]; // 新格式（多个 Key）
    serperApiKeys?: string[]; // 新格式（多个 Key）
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (config.provider !== undefined) {
      updates.push({
        key: "search.provider",
        value: config.provider,
        description:
          "Search API provider (perplexity, tavily, serper or duckduckgo)",
        category: "search",
      });
    }

    if (config.enabled !== undefined) {
      updates.push({
        key: "search.enabled",
        value: config.enabled,
        description: "Enable or disable search functionality",
        category: "search",
      });
    }

    // Only update API keys if they are provided and not the masked value
    if (
      config.perplexityApiKey &&
      config.perplexityApiKey !== "***configured***" &&
      config.perplexityApiKey.trim() !== ""
    ) {
      updates.push({
        key: "search.perplexity.apiKey",
        value: config.perplexityApiKey.trim(),
        description: "Perplexity API Key",
        category: "search",
      });
    }

    // ★ Tavily: 优先使用新格式（多 Key），否则使用旧格式（单 Key）
    if (config.tavilyApiKeys && Array.isArray(config.tavilyApiKeys)) {
      const validKeys = config.tavilyApiKeys
        .filter((k) => k && k !== "***configured***" && k.trim() !== "")
        .map((k) => k.trim());
      if (validKeys.length > 0) {
        updates.push({
          key: "search.tavily.apiKeys",
          value: validKeys,
          description: "Tavily API Keys (multiple for failover)",
          category: "search",
        });
      }
    } else if (
      config.tavilyApiKey &&
      config.tavilyApiKey !== "***configured***" &&
      config.tavilyApiKey.trim() !== ""
    ) {
      // 旧格式兼容：转换为数组存储
      updates.push({
        key: "search.tavily.apiKeys",
        value: [config.tavilyApiKey.trim()],
        description: "Tavily API Keys",
        category: "search",
      });
    }

    // ★ Serper: 同样支持多 Key
    if (config.serperApiKeys && Array.isArray(config.serperApiKeys)) {
      const validKeys = config.serperApiKeys
        .filter((k) => k && k !== "***configured***" && k.trim() !== "")
        .map((k) => k.trim());
      if (validKeys.length > 0) {
        updates.push({
          key: "search.serper.apiKeys",
          value: validKeys,
          description: "Serper API Keys (multiple for failover)",
          category: "search",
        });
      }
    } else if (
      config.serperApiKey &&
      config.serperApiKey !== "***configured***" &&
      config.serperApiKey.trim() !== ""
    ) {
      // 旧格式兼容：转换为数组存储
      updates.push({
        key: "search.serper.apiKeys",
        value: [config.serperApiKey.trim()],
        description: "Serper API Keys",
        category: "search",
      });
    }

    if (updates.length > 0) {
      await this.setSettings(updates);
    }

    return this.getSearchConfig();
  }

  /**
   * 获取搜索API Key（内部使用，返回实际值）
   */
  async getSearchApiKey(provider: string): Promise<string | null> {
    if (provider === "perplexity") {
      return this.getSetting("search.perplexity.apiKey");
    } else if (provider === "tavily") {
      return this.getSetting("search.tavily.apiKey");
    } else if (provider === "serper") {
      return this.getSetting("search.serper.apiKey");
    }
    return null;
  }

  // ============ Content Extraction API Configuration ============

  /**
   * 获取内容提取API配置
   */
  async getContentExtractionConfig() {
    const jinaKey = await this.getSetting("extraction.jina.apiKey");
    const firecrawlKey = await this.getSetting("extraction.firecrawl.apiKey");
    const tavilyKey = await this.getSetting("extraction.tavily.apiKey");
    const enabled = await this.getSetting("extraction.enabled");

    return {
      enabled: enabled !== false,
      jina: {
        apiKey: jinaKey ? this.maskApiKey(jinaKey) : null,
        hasApiKey: !!jinaKey,
      },
      firecrawl: {
        apiKey: firecrawlKey ? this.maskApiKey(firecrawlKey) : null,
        hasApiKey: !!firecrawlKey,
      },
      tavily: {
        apiKey: tavilyKey ? this.maskApiKey(tavilyKey) : null,
        hasApiKey: !!tavilyKey,
      },
    };
  }

  /**
   * 更新内容提取API配置
   */
  async updateContentExtractionConfig(config: {
    enabled?: boolean;
    jinaApiKey?: string;
    firecrawlApiKey?: string;
    tavilyApiKey?: string;
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (config.enabled !== undefined) {
      updates.push({
        key: "extraction.enabled",
        value: config.enabled,
        description: "Enable or disable content extraction",
        category: "extraction",
      });
    }

    // Only update API keys if they are provided and not the masked value
    if (
      config.jinaApiKey &&
      !config.jinaApiKey.includes("****") &&
      config.jinaApiKey.trim() !== ""
    ) {
      updates.push({
        key: "extraction.jina.apiKey",
        value: config.jinaApiKey.trim(),
        description: "Jina AI Reader API Key",
        category: "extraction",
      });
    }

    if (
      config.firecrawlApiKey &&
      !config.firecrawlApiKey.includes("****") &&
      config.firecrawlApiKey.trim() !== ""
    ) {
      updates.push({
        key: "extraction.firecrawl.apiKey",
        value: config.firecrawlApiKey.trim(),
        description: "Firecrawl API Key",
        category: "extraction",
      });
    }

    if (
      config.tavilyApiKey &&
      !config.tavilyApiKey.includes("****") &&
      config.tavilyApiKey.trim() !== ""
    ) {
      updates.push({
        key: "extraction.tavily.apiKey",
        value: config.tavilyApiKey.trim(),
        description: "Tavily API Key (for deep research)",
        category: "extraction",
      });
    }

    if (updates.length > 0) {
      await this.setSettings(updates);
    }

    return this.getContentExtractionConfig();
  }

  /**
   * 获取内容提取API Key（内部使用，返回实际值）
   */
  async getContentExtractionApiKey(
    provider: "jina" | "firecrawl" | "tavily",
  ): Promise<string | null> {
    return this.getSetting(`extraction.${provider}.apiKey`);
  }

  // ============ YouTube API Configuration ============

  /**
   * 获取YouTube字幕API配置
   */
  async getYoutubeConfig() {
    const supadataKey = await this.getSetting("youtube.supadata.apiKey");
    const enabled = await this.getSetting("youtube.enabled");
    const provider = await this.getSetting("youtube.provider");

    return {
      enabled: enabled !== false,
      provider: provider || "supadata",
      supadata: {
        apiKey: supadataKey ? this.maskApiKey(supadataKey) : null,
        hasApiKey: !!supadataKey,
      },
    };
  }

  /**
   * 更新YouTube字幕API配置
   */
  async updateYoutubeConfig(config: {
    enabled?: boolean;
    provider?: string;
    supadataApiKey?: string;
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (config.enabled !== undefined) {
      updates.push({
        key: "youtube.enabled",
        value: config.enabled,
        description: "Enable or disable YouTube transcript API",
        category: "youtube",
      });
    }

    if (config.provider) {
      updates.push({
        key: "youtube.provider",
        value: config.provider,
        description: "YouTube transcript API provider",
        category: "youtube",
      });
    }

    // Only update API keys if they are provided and not the masked value
    if (
      config.supadataApiKey &&
      !config.supadataApiKey.includes("****") &&
      config.supadataApiKey.trim() !== ""
    ) {
      updates.push({
        key: "youtube.supadata.apiKey",
        value: config.supadataApiKey.trim(),
        description: "Supadata API Key for YouTube transcript",
        category: "youtube",
      });
    }

    if (updates.length > 0) {
      await this.setSettings(updates);
    }

    return this.getYoutubeConfig();
  }

  /**
   * 获取YouTube API Key（内部使用，返回实际值）
   */
  async getYoutubeApiKey(provider: "supadata"): Promise<string | null> {
    return this.getSetting(`youtube.${provider}.apiKey`);
  }

  // ============ TTS (Text-to-Speech) Configuration ============

  /**
   * 获取TTS配置
   */
  async getTTSConfig() {
    const elevenLabsKey = await this.getSetting("tts.elevenlabs.apiKey");
    const googleKey = await this.getSetting("tts.google.apiKey");
    const enabled = await this.getSetting("tts.enabled");
    const provider = await this.getSetting("tts.provider");

    return {
      enabled: enabled !== false,
      provider: provider || "elevenlabs",
      elevenlabs: {
        apiKey: elevenLabsKey ? this.maskApiKey(elevenLabsKey) : null,
        hasApiKey: !!elevenLabsKey,
      },
      google: {
        apiKey: googleKey ? this.maskApiKey(googleKey) : null,
        hasApiKey: !!googleKey,
      },
    };
  }

  /**
   * 更新TTS配置
   */
  async updateTTSConfig(config: {
    enabled?: boolean;
    provider?: string;
    elevenLabsApiKey?: string;
    googleTTSApiKey?: string;
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (config.enabled !== undefined) {
      updates.push({
        key: "tts.enabled",
        value: config.enabled,
        description: "Enable or disable TTS API",
        category: "tts",
      });
    }

    if (config.provider) {
      updates.push({
        key: "tts.provider",
        value: config.provider,
        description: "TTS API provider (elevenlabs or google)",
        category: "tts",
      });
    }

    // Only update API keys if they are provided and not the masked value
    if (
      config.elevenLabsApiKey &&
      !config.elevenLabsApiKey.includes("*") &&
      config.elevenLabsApiKey.trim()
    ) {
      updates.push({
        key: "tts.elevenlabs.apiKey",
        value: config.elevenLabsApiKey,
        description: "ElevenLabs API Key",
        category: "tts",
      });
    }

    if (
      config.googleTTSApiKey &&
      !config.googleTTSApiKey.includes("*") &&
      config.googleTTSApiKey.trim()
    ) {
      updates.push({
        key: "tts.google.apiKey",
        value: config.googleTTSApiKey,
        description: "Google Cloud TTS API Key",
        category: "tts",
      });
    }

    // Save all updates
    for (const update of updates) {
      await this.setSetting(update.key, update.value, {
        description: update.description,
        category: update.category,
      });
    }

    return this.getTTSConfig();
  }

  /**
   * 获取TTS API Key（内部使用，返回实际值）
   */
  async getTTSApiKey(
    provider: "elevenlabs" | "google",
  ): Promise<string | null> {
    return this.getSetting(`tts.${provider}.apiKey`);
  }

  // ============ SkillsMP Configuration ============

  /**
   * 获取 SkillsMP 配置
   */
  async getSkillsmpConfig() {
    const enabled = (await this.getSetting("skillsmp.enabled")) ?? true;
    const apiKey = await this.getSetting("skillsmp.apiKey");
    const lastSync = await this.getSetting("skillsmp.lastSync");
    const syncInterval =
      (await this.getSetting("skillsmp.syncInterval")) ?? "daily";

    return {
      enabled,
      apiKey: apiKey ? this.maskApiKey(apiKey) : null,
      hasApiKey: !!apiKey,
      lastSync: lastSync || null,
      syncInterval,
    };
  }

  /**
   * 更新 SkillsMP 配置
   */
  async updateSkillsmpConfig(config: {
    enabled?: boolean;
    apiKey?: string;
    syncInterval?: "daily" | "weekly" | "manual";
  }) {
    if (config.enabled !== undefined) {
      await this.setSetting("skillsmp.enabled", config.enabled);
    }

    // Only update API key if provided and not a masked value
    if (config.apiKey && !config.apiKey.includes("****")) {
      await this.setSetting("skillsmp.apiKey", config.apiKey);
    }

    if (config.syncInterval) {
      await this.setSetting("skillsmp.syncInterval", config.syncInterval);
    }

    return this.getSkillsmpConfig();
  }

  /**
   * 获取 SkillsMP API Key（内部使用，返回实际值）
   */
  async getSkillsmpApiKey(): Promise<string | null> {
    return this.getSetting("skillsmp.apiKey");
  }

  /**
   * 安装技能配置到数据库
   */
  async installSkillFromMarketplace(skillData: {
    id: string;
    name: string;
    displayName?: string;
    description?: string;
    layer?: string;
    domain?: string;
    tags?: string[];
  }) {
    return this.prisma.skillConfig.upsert({
      where: { skillId: skillData.id },
      create: {
        skillId: skillData.id,
        displayName: skillData.displayName || skillData.name,
        description: skillData.description || "",
        layer: skillData.layer || "application",
        domain: skillData.domain || "common",
        enabled: true,
        tags: skillData.tags || [],
        config: {},
      },
      update: {
        displayName: skillData.displayName || skillData.name,
        description: skillData.description || "",
        layer: skillData.layer || "application",
        domain: skillData.domain || "common",
        enabled: true,
        tags: skillData.tags || [],
      },
    });
  }

  // ============ External Data Providers Configuration ============

  async getExternalProvidersConfig(): Promise<
    Array<ExternalProvider & { hasApiKey: boolean }>
  > {
    const stored = (await this.getSetting("external.providers")) as
      | ExternalProvider[]
      | null;
    const existing = Array.isArray(stored) ? stored : [];
    const defaultIds = DEFAULT_EXTERNAL_PROVIDERS.map((p) => p.id);

    const defaults = DEFAULT_EXTERNAL_PROVIDERS.map((provider) => {
      const prev = existing.find((p) => p.id === provider.id);
      const apiKey = prev?.apiKey || "";
      return {
        ...provider,
        ...prev,
        apiKey: apiKey, // Return full API key for external providers (admin only endpoint)
        hasApiKey: !!apiKey,
        enabled: prev?.enabled ?? false,
        baseUrl: prev?.baseUrl ?? "",
        headers: prev?.headers ?? "",
      };
    });

    const customProviders = existing
      .filter((p) => !defaultIds.includes(p.id))
      .map((provider) => {
        const apiKey = provider.apiKey || "";
        return {
          ...provider,
          apiKey: apiKey, // Return full API key for external providers (admin only endpoint)
          hasApiKey: !!apiKey,
          enabled: provider.enabled ?? false,
          baseUrl: provider.baseUrl ?? "",
          headers: provider.headers ?? "",
        };
      });

    return [...defaults, ...customProviders];
  }

  async updateExternalProvidersConfig(providers: ExternalProvider[]) {
    const stored = (await this.getSetting("external.providers")) as
      | ExternalProvider[]
      | null;
    const existing = Array.isArray(stored) ? stored : [];

    const mergedProviders = providers
      .filter((p) => {
        // Only save providers with valid data: must have id AND name AND (baseUrl OR apiKey)
        const hasId = p.id?.trim();
        const hasName = p.name?.trim();
        const hasBaseUrl = p.baseUrl?.trim();
        // Check for new apiKey OR existing apiKey in database
        const hasNewApiKey = p.apiKey && !p.apiKey.includes("***");
        const prev = existing.find((ep) => ep.id === p.id);
        const hasExistingApiKey = !!prev?.apiKey;
        return (
          hasId && hasName && (hasBaseUrl || hasNewApiKey || hasExistingApiKey)
        );
      })
      .map((provider) => {
        const prev = existing.find((p) => p.id === provider.id);
        const incomingApiKey = provider.apiKey || "";
        const apiKey =
          incomingApiKey &&
          !incomingApiKey.includes("***") &&
          incomingApiKey.trim() !== ""
            ? incomingApiKey.trim()
            : prev?.apiKey || "";

        return {
          ...prev,
          ...provider,
          id: provider.id,
          apiKey,
          enabled: provider.enabled ?? prev?.enabled ?? false,
          baseUrl: provider.baseUrl ?? prev?.baseUrl ?? "",
          headers: provider.headers ?? prev?.headers ?? "",
        };
      });

    await this.setSetting("external.providers", mergedProviders, {
      description: "External data providers configuration",
      category: "external",
    });

    return this.getExternalProvidersConfig();
  }

  /**
   * 检查API余额/配额
   */
  async checkApiBalance(
    type: "search" | "extraction",
    provider: string,
  ): Promise<{
    provider: string;
    hasBalance: boolean;
    balance?: string;
    quota?: { used: number; limit: number };
    error?: string;
  }> {
    try {
      let apiKey: string | null = null;

      if (type === "search") {
        apiKey = await this.getSearchApiKey(provider);
      } else if (type === "extraction") {
        apiKey = await this.getContentExtractionApiKey(
          provider as "jina" | "firecrawl" | "tavily",
        );
      }

      if (!apiKey) {
        return {
          provider,
          hasBalance: false,
          error: "API Key not configured",
        };
      }

      // 根据不同提供商查询余额
      switch (provider) {
        case "tavily":
          return await this.checkTavilyBalance(apiKey);
        case "firecrawl":
          return await this.checkFirecrawlBalance(apiKey);
        case "jina":
          return await this.checkJinaBalance(apiKey);
        case "serper":
          return await this.checkSerperBalance(apiKey);
        case "perplexity":
          return await this.checkPerplexityBalance(apiKey);
        default:
          return {
            provider,
            hasBalance: true,
            balance: "Unknown",
          };
      }
    } catch (error) {
      this.logger.error(`Failed to check ${provider} balance: ${error}`);
      return {
        provider,
        hasBalance: false,
        error: error instanceof Error ? error.message : "Check failed",
      };
    }
  }

  private async checkTavilyBalance(apiKey: string): Promise<{
    provider: string;
    hasBalance: boolean;
    balance?: string;
    quota?: { used: number; limit: number };
    error?: string;
  }> {
    try {
      // Tavily doesn't have a public balance API, we can only test if the key works
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: "test",
          max_results: 1,
        }),
      });

      if (response.ok) {
        return {
          provider: "tavily",
          hasBalance: true,
          balance: "Active",
        };
      } else if (response.status === 401) {
        return {
          provider: "tavily",
          hasBalance: false,
          error: "Invalid API key",
        };
      } else if (response.status === 429) {
        return {
          provider: "tavily",
          hasBalance: false,
          error: "Rate limit exceeded / Quota exhausted",
        };
      }

      return {
        provider: "tavily",
        hasBalance: false,
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        provider: "tavily",
        hasBalance: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  private async checkFirecrawlBalance(apiKey: string): Promise<{
    provider: string;
    hasBalance: boolean;
    balance?: string;
    quota?: { used: number; limit: number };
    error?: string;
  }> {
    try {
      // Firecrawl has a credit balance API
      const response = await fetch(
        "https://api.firecrawl.dev/v1/team/credit-usage",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        this.logger.debug(
          `Firecrawl balance response: ${JSON.stringify(data)}`,
        );

        // Firecrawl API 可能返回不同的字段结构
        // 尝试多种可能的字段名
        const remaining =
          data.remaining_credits ??
          data.credits_remaining ??
          data.credits ??
          data.balance ??
          data.data?.remaining_credits ??
          data.data?.credits;
        const used =
          data.credits_used ??
          data.used_credits ??
          data.usage ??
          data.data?.credits_used ??
          0;
        const total =
          data.credits_limit ??
          data.total_credits ??
          data.limit ??
          data.data?.credits_limit;

        // 如果无法获取具体数值，尝试返回可用状态
        if (remaining === undefined) {
          // API 响应成功但没有余额信息，标记为可用
          return {
            provider: "firecrawl",
            hasBalance: true,
            balance: "Active",
          };
        }

        const limit = total ?? (remaining + used || remaining);

        return {
          provider: "firecrawl",
          hasBalance: remaining > 0,
          balance: `${remaining} credits`,
          quota: { used: used || 0, limit: limit || 0 },
        };
      } else if (response.status === 401) {
        return {
          provider: "firecrawl",
          hasBalance: false,
          error: "Invalid API key",
        };
      }

      return {
        provider: "firecrawl",
        hasBalance: false,
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        provider: "firecrawl",
        hasBalance: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  private async checkJinaBalance(apiKey: string): Promise<{
    provider: string;
    hasBalance: boolean;
    balance?: string;
    quota?: { used: number; limit: number };
    error?: string;
  }> {
    try {
      // Jina has a balance API
      const response = await fetch("https://api.jina.ai/v1/billing/balance", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const balance = data.balance ?? data.credits ?? data.remaining;

        if (balance !== undefined) {
          return {
            provider: "jina",
            hasBalance: balance > 0,
            balance:
              typeof balance === "number"
                ? `$${balance.toFixed(2)}`
                : String(balance),
          };
        }

        return {
          provider: "jina",
          hasBalance: true,
          balance: "Active",
        };
      } else if (response.status === 401) {
        return {
          provider: "jina",
          hasBalance: false,
          error: "Invalid API key",
        };
      }

      // If balance API doesn't exist, test the reader API
      const testResponse = await fetch(
        "https://r.jina.ai/https://example.com",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
        },
      );

      if (testResponse.ok) {
        return {
          provider: "jina",
          hasBalance: true,
          balance: "Active (free tier or paid)",
        };
      }

      return {
        provider: "jina",
        hasBalance: false,
        error: `HTTP ${testResponse.status}`,
      };
    } catch (error) {
      return {
        provider: "jina",
        hasBalance: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  private async checkSerperBalance(apiKey: string): Promise<{
    provider: string;
    hasBalance: boolean;
    balance?: string;
    quota?: { used: number; limit: number };
    error?: string;
  }> {
    try {
      // Serper has an account API
      const response = await fetch("https://google.serper.dev/account", {
        method: "GET",
        headers: {
          "X-API-KEY": apiKey,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const credits = data.credits ?? data.remaining;
        const used = data.requests ?? data.used ?? 0;

        if (credits !== undefined) {
          return {
            provider: "serper",
            hasBalance: credits > 0,
            balance: `${credits} credits`,
            quota: { used, limit: credits + used },
          };
        }

        return {
          provider: "serper",
          hasBalance: true,
          balance: "Active",
        };
      } else if (response.status === 401) {
        return {
          provider: "serper",
          hasBalance: false,
          error: "Invalid API key",
        };
      }

      return {
        provider: "serper",
        hasBalance: false,
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        provider: "serper",
        hasBalance: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  private async checkPerplexityBalance(apiKey: string): Promise<{
    provider: string;
    hasBalance: boolean;
    balance?: string;
    error?: string;
  }> {
    try {
      // Perplexity doesn't have a public balance API, test with a minimal request
      const response = await fetch(
        "https://api.perplexity.ai/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: PERPLEXITY_VALIDATION_MODEL,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
        },
      );

      if (response.ok) {
        return {
          provider: "perplexity",
          hasBalance: true,
          balance: "Active",
        };
      } else if (response.status === 401) {
        return {
          provider: "perplexity",
          hasBalance: false,
          error: "Invalid API key",
        };
      } else if (response.status === 429) {
        return {
          provider: "perplexity",
          hasBalance: false,
          error: "Rate limit exceeded",
        };
      }

      return {
        provider: "perplexity",
        hasBalance: false,
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        provider: "perplexity",
        hasBalance: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  /**
   * 诊断AI模型配置
   * 返回所有模型的配置状态，用于调试
   */
  async diagnoseAIModels() {
    const models = await this.prisma.aIModel.findMany({
      orderBy: { name: "asc" },
    });

    return models.map((model) => ({
      id: model.id,
      name: model.name,
      displayName: model.displayName,
      provider: model.provider,
      modelId: model.modelId,
      modelType: model.modelType,
      apiEndpoint: model.apiEndpoint,
      isEnabled: model.isEnabled,
      isDefault: model.isDefault,
      hasApiKey: !!model.apiKey || !!model.secretKey,
      apiKeyLength: model.apiKey?.length || 0,
      apiKeyPrefix: model.apiKey ? model.apiKey.substring(0, 8) + "..." : null,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      updatedAt: model.updatedAt,
    }));
  }

  // ============ AI Model Type-based Selection ============

  /**
   * 获取指定类型的所有启用模型
   */
  async getAIModelsByType(modelType: AIModelType) {
    const models = await this.prisma.aIModel.findMany({
      where: {
        modelType,
        isEnabled: true,
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });

    return models.map((model) => ({
      ...model,
      apiKey: model.apiKey ? this.maskApiKey(model.apiKey) : null,
      hasApiKey: !!model.apiKey || !!model.secretKey,
    }));
  }

  /**
   * 获取指定类型的默认模型
   * 如果没有设置默认，则返回该类型中的第一个启用模型
   */
  async getDefaultModelByType(modelType: AIModelType) {
    // 先找该类型的默认模型
    let model = await this.prisma.aIModel.findFirst({
      where: {
        modelType,
        isEnabled: true,
        isDefault: true,
      },
    });

    // 如果没有默认模型，返回该类型中的第一个启用模型
    if (!model) {
      model = await this.prisma.aIModel.findFirst({
        where: {
          modelType,
          isEnabled: true,
        },
        orderBy: { createdAt: "asc" },
      });
    }

    if (!model) {
      return null;
    }

    return {
      ...model,
      apiKey: model.apiKey ? this.maskApiKey(model.apiKey) : null,
      hasApiKey: !!model.apiKey || !!model.secretKey,
    };
  }

  /**
   * 获取指定类型的默认模型（返回完整配置，包括 API Key）
   * 供内部服务使用
   */
  async getDefaultModelByTypeInternal(modelType: AIModelType) {
    // 先找该类型的默认模型
    let model = await this.prisma.aIModel.findFirst({
      where: {
        modelType,
        isEnabled: true,
        isDefault: true,
      },
    });

    // 如果没有默认模型，返回该类型中的第一个启用模型
    if (!model) {
      model = await this.prisma.aIModel.findFirst({
        where: {
          modelType,
          isEnabled: true,
        },
        orderBy: { createdAt: "asc" },
      });
    }

    return model;
  }

  /**
   * 设置某个模型为其类型的默认模型
   * 只影响同类型的模型
   */
  async setDefaultAIModelForType(id: string) {
    const model = await this.prisma.aIModel.findUnique({
      where: { id },
    });

    if (!model) {
      throw new NotFoundException(`AI Model ${id} not found`);
    }

    // 先将同类型的所有模型设为非默认
    await this.prisma.aIModel.updateMany({
      where: { modelType: model.modelType },
      data: { isDefault: false },
    });

    // 设置当前模型为默认
    const updated = await this.prisma.aIModel.update({
      where: { id },
      data: { isDefault: true },
    });

    this.logger.log(
      `AI Model ${updated.name} set as default for type ${updated.modelType}`,
    );

    return {
      ...updated,
      apiKey: updated.apiKey ? this.maskApiKey(updated.apiKey) : null,
      hasApiKey: !!updated.apiKey || !!updated.secretKey,
    };
  }

  /**
   * 获取所有类型及其默认模型
   */
  async getAllModelTypeDefaults() {
    const types: AIModelType[] = [
      "CHAT",
      "IMAGE_GENERATION",
      "IMAGE_EDITING",
      "MULTIMODAL",
      "EMBEDDING",
      "RERANK",
    ];

    const result: Record<
      string,
      { defaultModel: unknown; availableModels: number }
    > = {};

    for (const type of types) {
      const defaultModel = await this.getDefaultModelByType(type);
      const count = await this.prisma.aIModel.count({
        where: { modelType: type, isEnabled: true },
      });

      result[type] = {
        defaultModel: defaultModel
          ? {
              id: defaultModel.id,
              name: defaultModel.name,
              displayName: defaultModel.displayName,
              modelId: defaultModel.modelId,
              provider: defaultModel.provider,
            }
          : null,
        availableModels: count,
      };
    }

    return result;
  }

  // ============ Data Collection Management ============

  /**
   * 重置所有采集数据
   * 用于清空去重缓存，允许重新采集
   *
   * ⚠️ 危险操作：删除所有 raw_data、resources、deduplication_records
   */
  async resetCollectionData() {
    this.logger.warn("Resetting ALL collection data...");

    // 1. 统计当前数据量
    const beforeCounts = {
      rawData: await this.prisma.rawData.count(),
      resources: await this.prisma.resource.count(),
      deduplicationRecords: await this.prisma.deduplicationRecord.count(),
    };

    this.logger.log(
      `Before reset: raw_data=${beforeCounts.rawData}, resources=${beforeCounts.resources}, deduplication=${beforeCounts.deduplicationRecords}`,
    );

    // 2. 按顺序删除（考虑外键约束）

    // 删除去重记录
    const deletedDedup = await this.prisma.deduplicationRecord.deleteMany({});

    // 删除笔记、评论（资源相关）
    const deletedNotes = await this.prisma.note.deleteMany({});
    const deletedComments = await this.prisma.comment.deleteMany({});

    // 删除资源
    const deletedResources = await this.prisma.resource.deleteMany({});

    // 删除原始数据（去重的依据）
    const deletedRawData = await this.prisma.rawData.deleteMany({});

    // 3. 重置采集任务统计
    await this.prisma.collectionTask.updateMany({
      data: {
        totalItems: 0,
        processedItems: 0,
        successItems: 0,
        failedItems: 0,
        duplicateItems: 0,
        skippedItems: 0,
      },
    });

    // 4. 重置数据源统计
    await this.prisma.dataSource.updateMany({
      data: {
        totalCollected: 0,
      },
    });

    const result = {
      success: true,
      message: "All collection data has been reset",
      deleted: {
        rawData: deletedRawData.count,
        resources: deletedResources.count,
        deduplicationRecords: deletedDedup.count,
        notes: deletedNotes.count,
        comments: deletedComments.count,
      },
      before: beforeCounts,
    };

    this.logger.warn(
      `Collection data reset completed: ${JSON.stringify(result.deleted)}`,
    );

    return result;
  }

  // ============ Category-Specific Settings Methods ============

  /**
   * Get SMTP settings
   */
  async getSmtpSettings() {
    const [host, port, user, pass, from, enabled, adminEmail] =
      await Promise.all([
        this.getSetting("smtp.host"),
        this.getSetting("smtp.port"),
        this.getSetting("smtp.user"),
        this.getSetting("smtp.pass"),
        this.getSetting("smtp.from"),
        this.getSetting("smtp.enabled"),
        this.getSetting("smtp.adminEmail"),
      ]);

    return {
      host: host || null,
      port: port || 587,
      user: user || null,
      pass: pass ? "********" : null, // Mask password
      from: from || "",
      enabled: enabled === true,
      adminEmail: adminEmail || null,
    };
  }

  /**
   * Update SMTP settings
   */
  async updateSmtpSettings(settings: {
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    from?: string;
    enabled?: boolean;
    adminEmail?: string;
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (settings.host !== undefined) {
      updates.push({
        key: "smtp.host",
        value: settings.host,
        description: "SMTP host",
        category: "smtp",
      });
    }
    if (settings.port !== undefined) {
      updates.push({
        key: "smtp.port",
        value: settings.port,
        description: "SMTP port",
        category: "smtp",
      });
    }
    if (settings.user !== undefined) {
      updates.push({
        key: "smtp.user",
        value: settings.user,
        description: "SMTP username",
        category: "smtp",
      });
    }
    // Only update password if it's not the masked value
    if (settings.pass && settings.pass !== "********" && settings.pass.trim()) {
      updates.push({
        key: "smtp.pass",
        value: settings.pass,
        description: "SMTP password",
        category: "smtp",
      });
    }
    if (settings.from !== undefined) {
      updates.push({
        key: "smtp.from",
        value: settings.from,
        description: "SMTP from address",
        category: "smtp",
      });
    }
    if (settings.enabled !== undefined) {
      updates.push({
        key: "smtp.enabled",
        value: settings.enabled,
        description: "SMTP enabled",
        category: "smtp",
      });
    }
    if (settings.adminEmail !== undefined) {
      updates.push({
        key: "smtp.adminEmail",
        value: settings.adminEmail,
        description: "Admin email for notifications",
        category: "smtp",
      });
    }

    await this.setSettings(updates);
    return { success: true };
  }

  /**
   * Test SMTP connection
   */
  async testSmtpConnection() {
    const [host, port, user, pass, from, adminEmail] = await Promise.all([
      this.getSetting("smtp.host"),
      this.getSetting("smtp.port"),
      this.getSetting("smtp.user"),
      this.getSetting("smtp.pass"),
      this.getSetting("smtp.from"),
      this.getSetting("smtp.adminEmail"),
    ]);

    if (!host || !user || !pass) {
      return {
        success: false,
        message:
          "SMTP configuration is incomplete. Please fill in host, user, and password.",
      };
    }

    try {
      // Dynamic import to avoid circular dependencies
      const nodemailer = await import("nodemailer");

      const transporter = nodemailer.createTransport({
        host: host,
        port: port || 587,
        secure: port === 465,
        auth: {
          user: user,
          pass: pass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
      });

      // Verify connection
      await transporter.verify();

      // Optionally send test email
      if (adminEmail) {
        await transporter.sendMail({
          from: from || user,
          to: adminEmail,
          subject: "${APP_CONFIG.brand.name} SMTP Test",
          text: "This is a test email from ${APP_CONFIG.brand.name}. SMTP is configured correctly!",
          html: "<p>This is a test email from ${APP_CONFIG.brand.name}. <strong>SMTP is configured correctly!</strong></p>",
        });
        return {
          success: true,
          message: `Connection successful! Test email sent to ${adminEmail}`,
        };
      }

      return {
        success: true,
        message: "SMTP connection successful!",
      };
    } catch (error) {
      this.logger.error(`SMTP test failed: ${error}`);
      return {
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ============ Unified Email Settings (SMTP + Resend) ============

  /**
   * Get unified email settings (supports both SMTP and Resend)
   * Uses same keys as settings.service.ts for consistency
   */
  async getEmailSettingsUnified() {
    const [
      provider,
      enabled,
      from,
      adminEmail,
      host,
      port,
      user,
      pass,
      resendApiKey,
    ] = await Promise.all([
      this.getSetting("email_provider"),
      this.getSetting("email_enabled"),
      this.getSetting("email_from"),
      this.getSetting("admin_email"),
      this.getSetting("smtp_host"),
      this.getSetting("smtp_port"),
      this.getSetting("smtp_user"),
      this.getSetting("smtp_pass"),
      this.getSetting("resend_api_key"),
    ]);

    // Also check environment variables as fallback
    const envEnabled = process.env.EMAIL_ENABLED === "true";
    const envAdminEmail = process.env.ADMIN_EMAIL;

    return {
      provider: provider || process.env.EMAIL_PROVIDER || "smtp",
      enabled: enabled === "true" || enabled === true || envEnabled,
      from: from || process.env.EMAIL_FROM || "${APP_CONFIG.brand.emailFrom}",
      adminEmail: adminEmail || envAdminEmail || null,
      host: host || process.env.SMTP_HOST || null,
      port: parseInt(port || process.env.SMTP_PORT || "587"),
      user: user || process.env.SMTP_USER || null,
      hasPassword: !!(pass || process.env.SMTP_PASS),
      hasResendKey: !!(resendApiKey || process.env.RESEND_API_KEY),
    };
  }

  /**
   * Update unified email settings (supports both SMTP and Resend)
   * Uses same keys as settings.service.ts for consistency
   */
  async updateEmailSettingsUnified(settings: {
    provider?: "smtp" | "resend";
    enabled?: boolean;
    from?: string;
    adminEmail?: string;
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    resendApiKey?: string;
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (settings.provider !== undefined) {
      updates.push({
        key: "email_provider",
        value: settings.provider,
        description: "Email provider (smtp or resend)",
        category: "email",
      });
    }
    if (settings.enabled !== undefined) {
      updates.push({
        key: "email_enabled",
        value: settings.enabled.toString(),
        description: "Enable email notifications",
        category: "email",
      });
    }
    if (settings.from !== undefined) {
      updates.push({
        key: "email_from",
        value: settings.from,
        description: "Email from address",
        category: "email",
      });
    }
    if (settings.adminEmail !== undefined) {
      updates.push({
        key: "admin_email",
        value: settings.adminEmail,
        description: "Admin email for notifications",
        category: "email",
      });
    }

    // SMTP-specific settings
    if (settings.host !== undefined) {
      updates.push({
        key: "smtp_host",
        value: settings.host,
        description: "SMTP host",
        category: "email",
      });
    }
    if (settings.port !== undefined) {
      updates.push({
        key: "smtp_port",
        value: settings.port.toString(),
        description: "SMTP port",
        category: "email",
      });
    }
    if (settings.user !== undefined) {
      updates.push({
        key: "smtp_user",
        value: settings.user,
        description: "SMTP username",
        category: "email",
      });
    }
    // Only update password if it's not masked
    if (settings.pass?.trim() && !settings.pass.includes("•")) {
      updates.push({
        key: "smtp_pass",
        value: settings.pass,
        description: "SMTP password",
        category: "email",
      });
    }

    // Resend-specific settings
    if (settings.resendApiKey?.trim() && !settings.resendApiKey.includes("•")) {
      updates.push({
        key: "resend_api_key",
        value: settings.resendApiKey,
        description: "Resend API key",
        category: "email",
      });
    }

    if (updates.length > 0) {
      await this.setSettings(updates);
    }

    return this.getEmailSettingsUnified();
  }

  /**
   * Test email connection (supports both SMTP and Resend)
   * Uses same keys as settings.service.ts for consistency
   */
  async testEmailConnection() {
    const provider =
      (await this.getSetting("email_provider")) ||
      process.env.EMAIL_PROVIDER ||
      "smtp";
    const adminEmail =
      (await this.getSetting("admin_email")) || process.env.ADMIN_EMAIL;
    const from =
      (await this.getSetting("email_from")) ||
      process.env.EMAIL_FROM ||
      "${APP_CONFIG.brand.emailFrom}";

    if (!adminEmail) {
      return {
        success: false,
        message:
          "Admin email is not configured. Please set an admin email first.",
      };
    }

    try {
      if (provider === "resend") {
        // Test Resend
        const resendApiKey =
          (await this.getSetting("resend_api_key")) ||
          process.env.RESEND_API_KEY;
        if (!resendApiKey) {
          return {
            success: false,
            message: "Resend API key is not configured.",
          };
        }

        const { Resend } = await import("resend");
        const resend = new Resend(resendApiKey);

        await resend.emails.send({
          from: from,
          to: adminEmail,
          subject: "${APP_CONFIG.brand.name} Email Test",
          html: "<p>This is a test email from ${APP_CONFIG.brand.name}. <strong>Resend is configured correctly!</strong></p>",
        });

        return {
          success: true,
          message: `Test email sent to ${adminEmail} via Resend`,
        };
      } else {
        // Test SMTP
        const [host, port, user, pass] = await Promise.all([
          this.getSetting("smtp_host"),
          this.getSetting("smtp_port"),
          this.getSetting("smtp_user"),
          this.getSetting("smtp_pass"),
        ]);

        // Check env fallback
        const smtpHost = host || process.env.SMTP_HOST;
        const smtpPort = parseInt(port || process.env.SMTP_PORT || "587");
        const smtpUser = user || process.env.SMTP_USER;
        const smtpPass = pass || process.env.SMTP_PASS;

        if (!smtpHost || !smtpUser || !smtpPass) {
          return {
            success: false,
            message:
              "SMTP configuration is incomplete. Please configure host, user, and password.",
          };
        }

        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
        });

        await transporter.verify();
        await transporter.sendMail({
          from: from,
          to: adminEmail,
          subject: "${APP_CONFIG.brand.name} Email Test",
          html: "<p>This is a test email from ${APP_CONFIG.brand.name}. <strong>SMTP is configured correctly!</strong></p>",
        });

        return {
          success: true,
          message: `Test email sent to ${adminEmail} via SMTP`,
        };
      }
    } catch (error) {
      this.logger.error(`Email test failed: ${error}`);
      return {
        success: false,
        message: `Test failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get Site settings
   */
  async getSiteSettings() {
    const [
      siteName,
      siteDescription,
      maintenanceMode,
      maintenanceMessage,
      allowRegistration,
      requireEmailVerification,
    ] = await Promise.all([
      this.getSetting("site.name"),
      this.getSetting("site.description"),
      this.getSetting("site.maintenanceMode"),
      this.getSetting("site.maintenanceMessage"),
      this.getSetting("site.allowRegistration"),
      this.getSetting("site.requireEmailVerification"),
    ]);

    return {
      siteName: siteName || APP_CONFIG.brand.siteName,
      siteDescription: siteDescription || "AI-powered research platform",
      maintenanceMode: maintenanceMode === true,
      maintenanceMessage: maintenanceMessage || "System is under maintenance",
      allowRegistration: allowRegistration !== false,
      requireEmailVerification: requireEmailVerification === true,
    };
  }

  /**
   * Update Site settings
   */
  async updateSiteSettings(settings: {
    siteName?: string;
    siteDescription?: string;
    maintenanceMode?: boolean;
    maintenanceMessage?: string;
    allowRegistration?: boolean;
    requireEmailVerification?: boolean;
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (settings.siteName !== undefined) {
      updates.push({
        key: "site.name",
        value: settings.siteName,
        description: "Site name",
        category: "site",
      });
    }
    if (settings.siteDescription !== undefined) {
      updates.push({
        key: "site.description",
        value: settings.siteDescription,
        description: "Site description",
        category: "site",
      });
    }
    if (settings.maintenanceMode !== undefined) {
      updates.push({
        key: "site.maintenanceMode",
        value: settings.maintenanceMode,
        description: "Maintenance mode",
        category: "site",
      });
    }
    if (settings.maintenanceMessage !== undefined) {
      updates.push({
        key: "site.maintenanceMessage",
        value: settings.maintenanceMessage,
        description: "Maintenance message",
        category: "site",
      });
    }
    if (settings.allowRegistration !== undefined) {
      updates.push({
        key: "site.allowRegistration",
        value: settings.allowRegistration,
        description: "Allow new user registration",
        category: "site",
      });
    }
    if (settings.requireEmailVerification !== undefined) {
      updates.push({
        key: "site.requireEmailVerification",
        value: settings.requireEmailVerification,
        description: "Require email verification",
        category: "site",
      });
    }

    await this.setSettings(updates);
    return { success: true };
  }

  /**
   * Get AI settings
   */
  async getAiSettings() {
    const [
      defaultModel,
      maxTokens,
      temperature,
      rateLimitPerMinute,
      rateLimitPerDay,
    ] = await Promise.all([
      this.getSetting("ai.defaultModel"),
      this.getSetting("ai.maxTokens"),
      this.getSetting("ai.temperature"),
      this.getSetting("ai.rateLimitPerMinute"),
      this.getSetting("ai.rateLimitPerDay"),
    ]);

    return {
      defaultModel: defaultModel || "",
      maxTokens: maxTokens || 4096,
      temperature: temperature || 0.7,
      rateLimitPerMinute: rateLimitPerMinute || 20,
      rateLimitPerDay: rateLimitPerDay || 500,
    };
  }

  /**
   * Update AI settings
   */
  async updateAiSettings(settings: {
    defaultModel?: string;
    maxTokens?: number;
    temperature?: number;
    rateLimitPerMinute?: number;
    rateLimitPerDay?: number;
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (settings.defaultModel !== undefined) {
      updates.push({
        key: "ai.defaultModel",
        value: settings.defaultModel,
        description: "Default AI model",
        category: "ai",
      });
    }
    if (settings.maxTokens !== undefined) {
      updates.push({
        key: "ai.maxTokens",
        value: settings.maxTokens,
        description: "Max tokens for AI responses",
        category: "ai",
      });
    }
    if (settings.temperature !== undefined) {
      updates.push({
        key: "ai.temperature",
        value: settings.temperature,
        description: "AI temperature",
        category: "ai",
      });
    }
    if (settings.rateLimitPerMinute !== undefined) {
      updates.push({
        key: "ai.rateLimitPerMinute",
        value: settings.rateLimitPerMinute,
        description: "AI rate limit per minute",
        category: "ai",
      });
    }
    if (settings.rateLimitPerDay !== undefined) {
      updates.push({
        key: "ai.rateLimitPerDay",
        value: settings.rateLimitPerDay,
        description: "AI rate limit per day",
        category: "ai",
      });
    }

    await this.setSettings(updates);
    return { success: true };
  }

  /**
   * Get Security settings
   */
  async getSecuritySettings() {
    const [sessionTimeoutHours, maxLoginAttempts, lockoutDurationMinutes] =
      await Promise.all([
        this.getSetting("security.sessionTimeoutHours"),
        this.getSetting("security.maxLoginAttempts"),
        this.getSetting("security.lockoutDurationMinutes"),
      ]);

    return {
      sessionTimeoutHours: sessionTimeoutHours || 24,
      maxLoginAttempts: maxLoginAttempts || 5,
      lockoutDurationMinutes: lockoutDurationMinutes || 15,
    };
  }

  /**
   * Update Security settings
   */
  async updateSecuritySettings(settings: {
    sessionTimeoutHours?: number;
    maxLoginAttempts?: number;
    lockoutDurationMinutes?: number;
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (settings.sessionTimeoutHours !== undefined) {
      updates.push({
        key: "security.sessionTimeoutHours",
        value: settings.sessionTimeoutHours,
        description: "Session timeout in hours",
        category: "security",
      });
    }
    if (settings.maxLoginAttempts !== undefined) {
      updates.push({
        key: "security.maxLoginAttempts",
        value: settings.maxLoginAttempts,
        description: "Max login attempts before lockout",
        category: "security",
      });
    }
    if (settings.lockoutDurationMinutes !== undefined) {
      updates.push({
        key: "security.lockoutDurationMinutes",
        value: settings.lockoutDurationMinutes,
        description: "Lockout duration in minutes",
        category: "security",
      });
    }

    await this.setSettings(updates);
    return { success: true };
  }

  /**
   * Get Storage settings
   */
  async getStorageSettings() {
    const [maxUploadSizeMb, allowedFileTypes] = await Promise.all([
      this.getSetting("storage.maxUploadSizeMb"),
      this.getSetting("storage.allowedFileTypes"),
    ]);

    return {
      maxUploadSizeMb: maxUploadSizeMb || 10,
      allowedFileTypes:
        allowedFileTypes || "image/*,application/pdf,.doc,.docx",
    };
  }

  /**
   * Update Storage settings
   */
  async updateStorageSettings(settings: {
    maxUploadSizeMb?: number;
    allowedFileTypes?: string;
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (settings.maxUploadSizeMb !== undefined) {
      updates.push({
        key: "storage.maxUploadSizeMb",
        value: settings.maxUploadSizeMb,
        description: "Max upload size in MB",
        category: "storage",
      });
    }
    if (settings.allowedFileTypes !== undefined) {
      updates.push({
        key: "storage.allowedFileTypes",
        value: settings.allowedFileTypes,
        description: "Allowed file types",
        category: "storage",
      });
    }

    await this.setSettings(updates);
    return { success: true };
  }

  // ============ OpenAI Configuration ============

  /**
   * 获取 OpenAI API 配置
   */
  async getOpenAIConfig() {
    const apiKey = await this.getSetting("openai.apiKey");
    const enabled = await this.getSetting("openai.enabled");

    return {
      enabled: enabled !== false,
      hasApiKey: !!apiKey,
      apiKey: apiKey ? this.maskApiKey(apiKey) : null,
    };
  }

  /**
   * 更新 OpenAI API 配置
   */
  async updateOpenAIConfig(config: { enabled?: boolean; apiKey?: string }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (config.enabled !== undefined) {
      updates.push({
        key: "openai.enabled",
        value: config.enabled,
        description: "Enable or disable OpenAI API",
        category: "openai",
      });
    }

    if (
      config.apiKey &&
      !config.apiKey.includes("****") &&
      config.apiKey.trim() !== ""
    ) {
      updates.push({
        key: "openai.apiKey",
        value: config.apiKey.trim(),
        description: "OpenAI API Key",
        category: "openai",
      });
    }

    if (updates.length > 0) {
      await this.setSettings(updates);
      // S5 audit fix（2026-05-04）：API key 更新必须落审计（不记录 key 本身）
      await this.auditService.log({
        action: AuditAction.SYSTEM_CONFIG_CHANGE,
        resourceType: "ApiKey",
        resourceId: "openai",
        details: {
          operation: "updateOpenAIConfig",
          enabledChanged: config.enabled !== undefined,
          apiKeyChanged: !!(
            config.apiKey &&
            !config.apiKey.includes("****") &&
            config.apiKey.trim() !== ""
          ),
        },
        result: "SUCCESS",
      });
    }

    return this.getOpenAIConfig();
  }

  /**
   * 测试 OpenAI 连接
   */
  async testOpenAIConnection(
    apiKey: string,
  ): Promise<{ success: boolean; message: string; latency?: number }> {
    try {
      const start = Date.now();

      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const latency = Date.now() - start;

      if (response.ok) {
        return {
          success: true,
          message: "OpenAI connection successful",
          latency,
        };
      } else if (response.status === 401) {
        return { success: false, message: "Invalid API key" };
      } else {
        return { success: false, message: `HTTP ${response.status}` };
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  // ============ Cohere Rerank Configuration ============

  /**
   * 获取 Cohere API 配置
   */
  async getCohereConfig() {
    const apiKey = await this.getSetting("cohere.apiKey");
    const enabled = await this.getSetting("cohere.enabled");

    return {
      enabled: enabled !== false,
      hasApiKey: !!apiKey,
      apiKey: apiKey ? this.maskApiKey(apiKey) : null,
    };
  }

  /**
   * 更新 Cohere API 配置
   */
  async updateCohereConfig(config: { enabled?: boolean; apiKey?: string }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    if (config.enabled !== undefined) {
      updates.push({
        key: "cohere.enabled",
        value: config.enabled,
        description: "Enable or disable Cohere Rerank API",
        category: "cohere",
      });
    }

    if (
      config.apiKey &&
      !config.apiKey.includes("****") &&
      config.apiKey.trim() !== ""
    ) {
      updates.push({
        key: "cohere.apiKey",
        value: config.apiKey.trim(),
        description: "Cohere API Key",
        category: "cohere",
      });
    }

    if (updates.length > 0) {
      await this.setSettings(updates);
      // S5 audit fix（2026-05-04）：API key 更新必须落审计
      await this.auditService.log({
        action: AuditAction.SYSTEM_CONFIG_CHANGE,
        resourceType: "ApiKey",
        resourceId: "cohere",
        details: {
          operation: "updateCohereConfig",
          enabledChanged: config.enabled !== undefined,
          apiKeyChanged: !!(
            config.apiKey &&
            !config.apiKey.includes("****") &&
            config.apiKey.trim() !== ""
          ),
        },
        result: "SUCCESS",
      });
    }

    return this.getCohereConfig();
  }

  /**
   * 获取 Cohere API Key（内部使用，返回实际值）
   */
  async getCohereApiKey(): Promise<string | null> {
    // First check system settings
    const settingKey = await this.getSetting("cohere.apiKey");
    if (settingKey) {
      return settingKey;
    }

    // Fallback to environment variable
    return process.env.COHERE_API_KEY || null;
  }

  /**
   * 测试 Cohere 连接
   */
  async testCohereConnection(
    apiKey: string,
  ): Promise<{ success: boolean; message: string; latency?: number }> {
    try {
      const start = Date.now();

      const response = await fetch("https://api.cohere.com/v2/rerank", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "rerank-v3.5",
          query: "test",
          documents: ["test document"],
          top_n: 1,
        }),
      });

      const latency = Date.now() - start;

      if (response.ok) {
        return {
          success: true,
          message: "Cohere connection successful",
          latency,
        };
      } else if (response.status === 401) {
        return { success: false, message: "Invalid API key" };
      } else {
        const errorText = await response.text();
        return {
          success: false,
          message: `HTTP ${response.status}: ${errorText}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  // ============ Storage Provider Configuration ============

  /**
   * 获取存储配置
   */
  async getStorageProviderConfig() {
    const [
      provider,
      localPath,
      s3Bucket,
      s3Region,
      s3AccessKey,
      s3SecretKey,
      gdriveClientId,
      gdriveClientSecret,
      gdriveFolderId,
      maxFileSize,
      allowedTypes,
    ] = await Promise.all([
      this.getSetting("storage.provider"),
      this.getSetting("storage.localPath"),
      this.getSetting("storage.s3Bucket"),
      this.getSetting("storage.s3Region"),
      this.getSetting("storage.s3AccessKey"),
      this.getSetting("storage.s3SecretKey"),
      this.getSetting("storage.gdriveClientId"),
      this.getSetting("storage.gdriveClientSecret"),
      this.getSetting("storage.gdriveFolderId"),
      this.getSetting("storage.maxUploadSizeMb"),
      this.getSetting("storage.allowedFileTypes"),
    ]);

    return {
      provider: provider || "local",
      localPath: localPath || "/uploads",
      s3Bucket: s3Bucket || "",
      s3Region: s3Region || "us-east-1",
      s3AccessKey: s3AccessKey ? this.maskApiKey(s3AccessKey) : "",
      s3SecretKey: s3SecretKey ? this.maskApiKey(s3SecretKey) : "",
      gdriveClientId: gdriveClientId || "",
      gdriveClientSecret: gdriveClientSecret
        ? this.maskApiKey(gdriveClientSecret)
        : "",
      gdriveFolderId: gdriveFolderId || "",
      maxFileSize: maxFileSize || 10,
      allowedTypes: allowedTypes
        ? allowedTypes.split(",").map((s: string) => s.trim())
        : ["image/*", "application/pdf", "text/*"],
    };
  }

  /**
   * 更新存储配置
   */
  async updateStorageProviderConfig(config: {
    provider?: string;
    localPath?: string;
    s3Bucket?: string;
    s3Region?: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
    gdriveClientId?: string;
    gdriveClientSecret?: string;
    gdriveFolderId?: string;
    maxFileSize?: number;
    allowedTypes?: string[];
  }) {
    const updates: Array<{
      key: string;
      value: unknown;
      description?: string;
      category: string;
    }> = [];

    // Helper to add update if value is provided and not masked
    const addUpdate = (
      key: string,
      value: unknown,
      description: string,
      isSensitive = false,
    ) => {
      if (value === undefined) return;
      if (isSensitive && typeof value === "string" && value.includes("****"))
        return;
      updates.push({
        key: `storage.${key}`,
        value,
        description,
        category: "storage",
      });
    };

    addUpdate("provider", config.provider, "Active storage provider");
    addUpdate("localPath", config.localPath, "Local storage path");
    addUpdate("s3Bucket", config.s3Bucket, "S3 bucket name");
    addUpdate("s3Region", config.s3Region, "S3 region");
    addUpdate("s3AccessKey", config.s3AccessKey, "S3 access key", true);
    addUpdate("s3SecretKey", config.s3SecretKey, "S3 secret key", true);
    addUpdate(
      "gdriveClientId",
      config.gdriveClientId,
      "Google Drive client ID",
    );
    addUpdate(
      "gdriveClientSecret",
      config.gdriveClientSecret,
      "Google Drive client secret",
      true,
    );
    addUpdate(
      "gdriveFolderId",
      config.gdriveFolderId,
      "Google Drive folder ID",
    );
    addUpdate("maxUploadSizeMb", config.maxFileSize, "Max upload size in MB");

    if (config.allowedTypes) {
      addUpdate(
        "allowedFileTypes",
        config.allowedTypes.join(", "),
        "Allowed file types",
      );
    }

    if (updates.length > 0) {
      await this.setSettings(updates);
    }

    return this.getStorageProviderConfig();
  }

  /**
   * 测试 Google Drive 连接
   * Note: Google Drive OAuth requires user authentication flow
   */
  async testGDriveConnection(config: {
    clientId: string;
    clientSecret: string;
  }): Promise<{ success: boolean; message: string }> {
    // Google Drive requires OAuth2 flow, we can only validate the client ID format
    if (
      !config.clientId.includes(".apps.googleusercontent.com") &&
      !config.clientId.includes(".apps.google.com")
    ) {
      return {
        success: false,
        message:
          "Invalid Client ID format. Should end with .apps.googleusercontent.com",
      };
    }

    if (!config.clientSecret || config.clientSecret.length < 10) {
      return {
        success: false,
        message: "Client Secret appears to be invalid",
      };
    }

    return {
      success: true,
      message:
        "Google Drive credentials format validated. Full OAuth connection requires user authorization.",
    };
  }
}
