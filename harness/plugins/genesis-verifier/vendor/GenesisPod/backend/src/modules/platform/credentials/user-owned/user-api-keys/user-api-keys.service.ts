import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { EncryptionService } from "../../../../platform/credentials/storage/encryption/encryption.service";
import {
  CacheService,
  CachePrefix,
  CacheTTL,
} from "../../../../../common/cache";
import { UserApiKeyMode, Prisma } from "@prisma/client";
import {
  KeyHealthStore,
  buildPersonalKeyId,
  ProviderProbeService,
} from "@/modules/platform/credentials/governance/key-health";

/** Valid provider name pattern */
const PROVIDER_NAME_PATTERN = /^[a-z0-9-]+$/;

// 2026-05-11 P2: PROVIDER_DEFAULTS hardcoded 表删除。Provider 配置完全
// 数据驱动 —— resolveProviderDefaults 只读 DB ai_providers 表，找不到
// 返回 null + 友好报错，让 admin 在 UI 配置（不再硬编码 fallback）。

// 2026-05-28 H6: 捐赠池已退役 —— user_api_keys 现为纯个人 LLM key 表。
// strict BYOK + AuthorizationGrant 已取代共享池；捐赠相关方法/积分全部移除。

@Injectable()
export class UserApiKeysService {
  private readonly logger = new Logger(UserApiKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly providerProbe: ProviderProbeService,
    @Optional() private readonly cacheService?: CacheService,
    @Optional() private readonly keyHealthStore?: KeyHealthStore,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * 通知所有订阅方 BYOK 配置变更（EmbeddingService 会清 per-user embedding cache）。
   * 2026-05-12: 修"用户配了 BYOK 但下次 embedding 还在用 60s 前的旧 cache"
   */
  private emitUserApiKeyChanged(userId: string): void {
    if (!this.eventEmitter) return;
    this.eventEmitter.emit("user-api-key.changed", { userId });
  }

  private validateProvider(provider: string): string {
    const normalized = provider.toLowerCase();
    if (!PROVIDER_NAME_PATTERN.test(normalized) || normalized.length > 50) {
      throw new BadRequestException("Invalid provider name");
    }
    return normalized;
  }

  /**
   * SSRF protection: block private/internal IPs.
   *
   * For self-hosted local LLMs (e.g. vLLM/Ollama on the same host),
   * set BYOK_ALLOWED_INTERNAL_HOSTS to a comma-separated allowlist
   * of hostnames, e.g. "localhost,127.0.0.1,host.docker.internal".
   */
  private validateEndpointUrl(url: string): void {
    try {
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol)) {
        throw new BadRequestException("Endpoint must use HTTP or HTTPS");
      }
      const hostname = parsed.hostname;
      const allowlist = (process.env.BYOK_ALLOWED_INTERNAL_HOSTS || "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);
      if (allowlist.includes(hostname)) {
        return;
      }
      if (this.isPrivateHost(hostname)) {
        throw new BadRequestException("Internal endpoints are not allowed");
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("Invalid endpoint URL");
    }
  }

  /**
   * 列出用户的所有 API Key 配置（不返回明文 Key）
   */
  async listUserApiKeys(userId: string) {
    const keys = await this.prisma.userApiKey.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        label: true,
        mode: true,
        keyHint: true,
        apiEndpoint: true,
        preferredModelId: true,
        isActive: true,
        lastUsedAt: true,
        testStatus: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        usageCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ provider: "asc" }, { label: "asc" }],
    });

    return keys.map((key) => ({
      ...key,
      mode: key.mode.toLowerCase() as "personal", // 捐赠池退役后恒为 personal（W4b）
      keyHint: key.keyHint || "****",
    }));
  }

  /**
   * BYOK 状态快照 — onboarding banner 用
   * 返回：是否配置、活跃 provider 列表、是否已有至少一条 UserModelConfig。
   */
  async getByokStatus(userId: string): Promise<{
    configured: boolean;
    activeProviders: string[];
    hasModelConfig: boolean;
  }> {
    const [activeKeys, modelConfigCount] = await Promise.all([
      this.prisma.userApiKey.findMany({
        where: { userId, isActive: true, mode: UserApiKeyMode.PERSONAL },
        select: { provider: true },
      }),
      this.prisma.userModelConfig.count({
        where: { userId, isEnabled: true },
      }),
    ]);
    const activeProviders = Array.from(
      new Set(activeKeys.map((k) => k.provider.toLowerCase())),
    );
    return {
      configured: activeProviders.length > 0,
      activeProviders,
      hasModelConfig: modelConfigCount > 0,
    };
  }

  /**
   * 保存或更新用户 API Key
   */
  async saveKey(
    userId: string,
    provider: string,
    apiKey: string,
    mode: string,
    preferredModelId?: string,
    apiEndpoint?: string,
    /** PR-2: 多 key 标签（"default" / "personal-org-a" / "backup"） */
    label: string = "default",
  ) {
    const normalizedProvider = this.validateProvider(provider);
    const normalizedLabel = (label || "default").trim().toLowerCase();
    if (apiEndpoint) {
      this.validateEndpointUrl(apiEndpoint);
    }
    // 2026-05-28 PR-3.1：新写一律信封 v2（AES-256-GCM + KEK）。旧行读取走 decryptAny 双读。
    const env = await this.encryption.encryptEnvelope(apiKey);

    // 检查是否已有该 provider + label 的 Key
    const existing = await this.prisma.userApiKey.findUnique({
      where: {
        userId_provider_label: {
          userId,
          provider: normalizedProvider,
          label: normalizedLabel,
        },
      },
    });

    // 捐赠池退役后（H6）：user_api_keys 恒为 PERSONAL。
    const keyHint = this.generateKeyHint(apiKey);
    const writeData: Prisma.UserApiKeyUpdateInput = {
      encryptedValue: env.encryptedValue,
      iv: env.iv,
      authTag: env.authTag,
      wrappedDek: env.wrappedDek,
      encVersion: env.encVersion,
      kekVersion: env.kekVersion,
      keyHint,
      mode: UserApiKeyMode.PERSONAL,
      apiEndpoint: apiEndpoint || null,
      preferredModelId: preferredModelId || null,
      isActive: true,
    };

    if (existing) {
      await this.prisma.userApiKey.update({
        where: { id: existing.id },
        data: writeData,
      });
    } else {
      await this.prisma.userApiKey.create({
        data: {
          user: { connect: { id: userId } },
          provider: normalizedProvider,
          label: normalizedLabel,
          encryptedValue: env.encryptedValue,
          iv: env.iv,
          authTag: env.authTag,
          wrappedDek: env.wrappedDek,
          encVersion: env.encVersion,
          kekVersion: env.kekVersion,
          keyHint,
          mode: UserApiKeyMode.PERSONAL,
          apiEndpoint: apiEndpoint || null,
          preferredModelId: preferredModelId || null,
          isActive: true,
        },
      });
    }

    // 使缓存失效
    await this.invalidateUserKeyCache(userId);
    this.emitUserApiKeyChanged(userId);

    // PR-1 (2026-05-05) failover: rotate / 新增 / endpoint 改时清 LastGood + 旧 KeyHealth
    //   - rotate（同 label 改 apiKey）：旧 KeyHealth 状态对新 apiKey 不再适用，必须清
    //   - 新增 label：LastGood 可能还指向 stale key，强制重选
    if (this.keyHealthStore) {
      const keyId = buildPersonalKeyId(
        userId,
        normalizedProvider,
        normalizedLabel,
      );
      await this.keyHealthStore.delete(keyId);
      await this.keyHealthStore.clearLastGood(userId, normalizedProvider);
    }

    // 首次配置 Personal Key → 标记引导完成（捐赠池退役后所有 key 均为 PERSONAL）
    await this.markOnboardedIfNeeded(userId);

    return { success: true, mode };
  }

  /**
   * 将 User.byokOnboardedAt 从 null 标记为当前时间。
   * 如已设置则不覆盖（避免覆盖老用户的迁移值）。
   */
  async markOnboardedIfNeeded(userId: string): Promise<void> {
    try {
      await this.prisma.user.updateMany({
        where: { id: userId, byokOnboardedAt: null },
        data: { byokOnboardedAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to mark user ${userId} BYOK onboarded: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 用户已配置过 Personal Key 的全部 provider 集合（供模型路由的
   * availableProviders 过滤使用）。
   */
  async getAvailableProviders(userId: string): Promise<string[]> {
    const rows = await this.prisma.userApiKey.findMany({
      where: {
        userId,
        isActive: true,
        mode: UserApiKeyMode.PERSONAL,
      },
      select: { provider: true },
      distinct: ["provider"],
    });
    return rows.map((r) => r.provider.toLowerCase());
  }

  /**
   * 删除用户 API Key
   */
  async deleteKey(userId: string, provider: string, label: string = "default") {
    const normalizedProvider = this.validateProvider(provider);
    const normalizedLabel = (label || "default").trim().toLowerCase();
    const existing = await this.prisma.userApiKey.findUnique({
      where: {
        userId_provider_label: {
          userId,
          provider: normalizedProvider,
          label: normalizedLabel,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException("No API Key found for this provider");
    }

    await this.prisma.userApiKey.delete({ where: { id: existing.id } });

    // 使缓存失效
    await this.invalidateUserKeyCache(userId);
    this.emitUserApiKeyChanged(userId);

    // PR-1 (2026-05-05) failover: 清理 KeyHealth 记录 + LastGood
    if (this.keyHealthStore) {
      const keyId = buildPersonalKeyId(
        userId,
        normalizedProvider,
        normalizedLabel,
      );
      await this.keyHealthStore.delete(keyId);
      await this.keyHealthStore.clearLastGood(userId, normalizedProvider);
    }

    return { success: true };
  }

  /**
   * 测试 API Key 是否有效（pre-save 表单验证用）。
   *
   * ★ 2026-05-06: BYOK 场景下 testKey 接收的是用户在表单输入的明文 apiKey
   *   （未必对应已保存行）。即便 user 已存有同 provider 的 key，也不能用
   *   updateMany 把状态写到所有 label —— 用户测的是这条新值，不是已存行。
   *   所以 BYOK testKey 只返回结果，不写 DB；保存后的健康状态由业务流量调用
   *   时的 markSuccess/markFailure 写入（它们知道具体 keyId）。
   */
  async testKey(
    provider: string,
    apiKey: string,
    apiEndpoint?: string,
    userId?: string,
  ): Promise<{ success: boolean; message: string; errorCode?: string }> {
    const normalizedProvider = this.validateProvider(provider);
    if (apiEndpoint) {
      this.validateEndpointUrl(apiEndpoint);
    }
    const defaults = await this.resolveProviderDefaults(
      normalizedProvider,
      userId,
    );
    const endpoint = apiEndpoint || defaults?.endpoint;

    if (!endpoint) {
      return {
        success: false,
        message:
          `Provider "${normalizedProvider}" 未在 ai_providers 表配置，` +
          `请填写完整 API Endpoint，或让 admin 在 /admin/ai-providers 维护页添加。`,
        errorCode: "UNKNOWN",
      };
    }

    const apiFormat =
      defaults?.apiFormat || this.inferApiFormat(normalizedProvider, endpoint);
    const result = await this.providerProbe.probe({
      apiFormat,
      apiKey,
      endpoint,
      providerLabel: normalizedProvider,
    });

    if (result.ok) {
      return { success: true, message: "Connection successful" };
    }
    return {
      success: false,
      message: result.errorMessage ?? "API Key validation failed",
      errorCode: result.errorCode,
    };
  }

  /**
   * 2026-05-29 W3+：按已存储 key 的 id 主动测试（与 admin SecretKeysService.testKey 能力对齐）。
   *
   * 加载归属当前用户的 key → decryptAny 解密 → ProviderProbe 真发 HTTP →
   * 写回 testStatus / lastUsedAt / lastErrorCode / lastErrorMessage（UI 可见错误码）。
   * owner 隔离：非本人 key 抛 NotFound（不暴露存在性）。返回只含 { ok, errorCode }，
   * 不外泄 errorMessage（与 user-secrets testSecretKey 一致）。
   */
  async testKeyById(
    userId: string,
    id: string,
  ): Promise<{ ok: boolean; errorCode?: string }> {
    const key = await this.prisma.userApiKey.findFirst({
      where: { id, userId, mode: UserApiKeyMode.PERSONAL },
    });
    if (!key) {
      throw new NotFoundException("API Key not found");
    }

    const now = new Date();
    const decrypted = await this.encryption.decryptAny(key);
    if (!decrypted) {
      await this.prisma.userApiKey.update({
        where: { id },
        data: {
          testStatus: "failed",
          lastUsedAt: now,
          lastErrorCode: "DECRYPTION_FAILED",
          lastErrorMessage:
            "decryption failed (encryptedValue or iv corrupted)",
        },
      });
      return { ok: false, errorCode: "DECRYPTION_FAILED" };
    }

    const defaults = await this.resolveProviderDefaults(key.provider, userId);
    const endpoint = key.apiEndpoint || defaults?.endpoint;
    if (!endpoint) {
      await this.prisma.userApiKey.update({
        where: { id },
        data: {
          testStatus: "failed",
          lastUsedAt: now,
          lastErrorCode: "UNKNOWN",
          lastErrorMessage: `Provider "${key.provider}" 未配置 endpoint`,
        },
      });
      return { ok: false, errorCode: "UNKNOWN" };
    }

    const result = await this.providerProbe.probe({
      apiFormat:
        defaults?.apiFormat || this.inferApiFormat(key.provider, endpoint),
      apiKey: decrypted,
      endpoint,
      providerLabel: key.provider,
    });

    await this.prisma.userApiKey.update({
      where: { id },
      data: result.ok
        ? {
            testStatus: "success",
            lastUsedAt: now,
            lastErrorCode: null,
            lastErrorMessage: null,
          }
        : {
            testStatus: "failed",
            lastUsedAt: now,
            lastErrorCode: (result.errorCode ?? "UNKNOWN").slice(0, 40),
            lastErrorMessage: (result.errorMessage ?? "probe failed").slice(
              0,
              500,
            ),
          },
    });

    return { ok: result.ok, errorCode: result.errorCode };
  }

  /**
   * 获取用户的个人 Key（用于 AI 调用优先级判断）
   * 结果缓存 5 分钟以减少数据库查询
   */
  async getPersonalKey(
    userId: string,
    provider: string,
  ): Promise<{
    apiKey: string;
    apiEndpoint?: string | null;
    preferredModelId?: string | null;
    /**
     * 2026-05-12 fix: 返回实际 label，让 KeyResolver 构造 healthKeyId 时用真实
     * label 而非硬编码 "default"。否则 persistDbHealthOutcome 按 "default"
     * 反查 userApiKey 在用户用自定义 label 时找不到记录（Prisma P2025）。
     */
    label: string;
  } | null> {
    const normalizedProvider = provider.toLowerCase();
    const cacheKey = `${CachePrefix.USER_API_KEY}${userId}:${normalizedProvider}`;

    // 尝试从缓存获取
    if (this.cacheService) {
      const cached = await this.cacheService.get<{
        apiKey: string;
        apiEndpoint?: string | null;
        preferredModelId?: string | null;
        label?: string;
      }>(cacheKey);
      // 2026-05-12 fix: 上一版 cache shape 不含 label；缺 label 视为 stale，
      //   强制走 DB 拉，避免 KeyResolver 构造 healthKeyId 时退化为 "default"。
      if (cached?.label) {
        return cached as {
          apiKey: string;
          apiEndpoint?: string | null;
          preferredModelId?: string | null;
          label: string;
        };
      }
    }

    // PR-2: 多 key 支持 — label="default" 优先；其次按 lastUsedAt desc + label asc。
    //   后续若加 key health probing 可改为按 testStatus/score 排序。
    const key = await this.prisma.userApiKey.findFirst({
      where: {
        userId,
        provider: normalizedProvider,
        mode: UserApiKeyMode.PERSONAL,
        isActive: true,
      },
      orderBy: [
        { label: "asc" }, // "default" 字典序最小，优先命中
        { lastUsedAt: { sort: "desc", nulls: "last" } },
      ],
    });

    if (!key) {
      // 缓存空结果以避免重复查询（较短 TTL）
      if (this.cacheService) {
        await this.cacheService.set(cacheKey, null, CacheTTL.SHORT);
      }
      return null;
    }

    const decrypted = await this.encryption.decryptAny(key);
    if (!decrypted) return null;

    const result = {
      apiKey: decrypted,
      apiEndpoint: key.apiEndpoint,
      preferredModelId: key.preferredModelId,
      label: key.label,
    };

    // 缓存结果
    if (this.cacheService) {
      await this.cacheService.set(cacheKey, result, CacheTTL.DEFAULT);
    }

    return result;
  }

  /**
   * 2026-05-28 BYOK：按 UserApiKey.id 精确取一把用户 PERSONAL key（解密后）。
   * 供 KeyResolver 在 UserModelConfig.apiKeyId 指定了具体 key 时使用。
   * 校验：归属当前用户 + active + PERSONAL；传 provider 时再校验 provider 匹配。
   * 任一不满足或解密失败返回 null（调用方据此退回 provider 级解析）。
   */
  async getPersonalKeyById(
    userId: string,
    id: string,
    provider?: string,
  ): Promise<{
    apiKey: string;
    apiEndpoint?: string | null;
    preferredModelId?: string | null;
    label: string;
    provider: string;
  } | null> {
    const key = await this.prisma.userApiKey.findFirst({
      where: {
        id,
        userId,
        mode: UserApiKeyMode.PERSONAL,
        isActive: true,
      },
    });
    if (!key) return null;
    if (provider && key.provider.toLowerCase() !== provider.toLowerCase()) {
      return null;
    }
    const decrypted = await this.encryption.decryptAny(key);
    if (!decrypted) return null;
    return {
      apiKey: decrypted,
      apiEndpoint: key.apiEndpoint,
      preferredModelId: key.preferredModelId,
      label: key.label,
      provider: key.provider,
    };
  }

  /**
   * 使用户 API Key 缓存失效
   * 当用户更新、删除 Key 时调用
   */
  async invalidateUserKeyCache(userId: string): Promise<void> {
    if (this.cacheService) {
      await this.cacheService.invalidateUserCache(userId);
    }
  }

  /**
   * PR-1 (2026-05-05) failover: 列出该 user/provider 下所有可用 PERSONAL key（解密后）。
   *
   * 排序：label asc（"default" 字典序最小，自然第一），同 label 内 lastUsedAt desc。
   * 仅返回 isActive=true & PERSONAL mode（W4b 后枚举已收敛为单值，无需再排除捐赠 key）。
   *
   * 调用方（KeyResolver.resolveKeyChain）拿到列表后再叠加 KeyHealthStore.filterUsable
   * 过滤 DEAD/COOLDOWN，并把 LastGood 提到队首。
   */
  async listPersonalKeys(
    userId: string,
    provider: string,
  ): Promise<
    Array<{
      keyRowId: string;
      label: string;
      apiKey: string;
      apiEndpoint: string | null;
      preferredModelId: string | null;
    }>
  > {
    const normalizedProvider = provider.toLowerCase();
    const keys = await this.prisma.userApiKey.findMany({
      where: {
        userId,
        provider: normalizedProvider,
        mode: UserApiKeyMode.PERSONAL,
        isActive: true,
      },
      orderBy: [
        { label: "asc" },
        { lastUsedAt: { sort: "desc", nulls: "last" } },
      ],
    });
    const result: Array<{
      keyRowId: string;
      label: string;
      apiKey: string;
      apiEndpoint: string | null;
      preferredModelId: string | null;
    }> = [];
    for (const k of keys) {
      const decrypted = await this.encryption.decryptAny(k);
      if (!decrypted) continue;
      result.push({
        keyRowId: k.id,
        label: k.label,
        apiKey: decrypted,
        apiEndpoint: k.apiEndpoint,
        preferredModelId: k.preferredModelId,
      });
    }
    return result;
  }

  /**
   * 获取支持的 Provider 列表 —— 数据驱动单一真源（DB ai_providers）。
   *
   * 2026-05-11 P2: 删除 PROVIDER_DEFAULTS 硬编码 fallback。DB 未 seed 时
   * 返回空数组，前端展示空态引导 admin 去 /admin/ai-providers 维护页配置。
   * 包含：scope=system 的全局 provider + 该 user 自定义的 scope=user provider。
   */
  async getSupportedProviders(userId?: string) {
    try {
      const dbProviders = await this.prisma.aIProvider.findMany({
        where: {
          isEnabled: true,
          OR: [
            { scope: "system" },
            ...(userId ? [{ scope: "user", ownerUserId: userId }] : []),
          ],
        },
        orderBy: [{ scope: "asc" }, { displayOrder: "asc" }],
      });
      return dbProviders.map((p) => ({
        id: p.slug,
        name: p.name,
        endpoint: p.endpoint,
        // apiFormat 暴露给前端「添加模型配置」下拉：选中 provider 后自动带出调用协议，
        // 取代前端硬编码的 KNOWN_PROVIDERS（消除前后端两套数据源 + xai 协议漂移 bug）。
        apiFormat: p.apiFormat,
        iconUrl: p.iconUrl,
        freeTierNote: p.freeTierNote,
        docUrl: p.docUrl,
        capabilities: p.capabilities,
        scope: p.scope,
        isCustom: p.scope === "user",
      }));
    } catch (err) {
      this.logger.warn(
        `[getSupportedProviders] DB query failed (${(err as Error).message}); returning empty list`,
      );
      return [];
    }
  }

  /**
   * 解析 provider 默认配置 —— DB ai_providers 唯一真源。
   *
   * 2026-05-11 P2: 删除 PROVIDER_DEFAULTS 硬编码 fallback。DB 找不到该 slug
   * 时返回 null，调用方负责出友好报错（"请在 /admin/ai-providers 维护该 provider"
   * 或者 "请显式填写 apiEndpoint"）。
   *
   * 用于 testKey / saveKey / connection-test 时拿 endpoint / apiFormat / testModel
   * 兜底（AIModel.apiEndpoint 优先）。
   */
  async resolveProviderDefaults(
    slug: string,
    userId?: string,
  ): Promise<{
    endpoint: string;
    apiFormat: string;
    testModel: string;
  } | null> {
    try {
      const dbProvider = await this.prisma.aIProvider.findFirst({
        where: {
          slug,
          isEnabled: true,
          OR: [
            { scope: "system" },
            ...(userId ? [{ scope: "user", ownerUserId: userId }] : []),
          ],
        },
      });
      if (dbProvider) {
        return {
          endpoint: dbProvider.endpoint,
          apiFormat: dbProvider.apiFormat,
          testModel: dbProvider.testModel,
        };
      }
    } catch (err) {
      this.logger.warn(
        `[resolveProviderDefaults] DB query failed for "${slug}": ${(err as Error).message}`,
      );
    }
    return null;
  }

  // ==================== Private Helpers ====================

  /**
   * 当 DB ai_providers 没给出 apiFormat 时，从 provider slug / endpoint 推断调用协议。
   *
   * ★ 2026-06-11 修"Claude Key 测试始终失败"根因：旧逻辑 `defaults?.apiFormat || "openai"`
   *   在 slug 无匹配 ai_providers 行（或未配 apiFormat）时一律退回 "openai" → 对 Anthropic
   *   端点发 GET /models + Bearer（Anthropic 只认 x-api-key + POST /v1/messages）→ 401/404
   *   → 即便 Key 有效也判失败。改为按 slug/endpoint 推断，杜绝"用错协议测试"。
   */
  private inferApiFormat(slug: string, endpoint?: string): string {
    const s = (slug || "").toLowerCase();
    const e = (endpoint || "").toLowerCase();
    if (
      s.includes("anthropic") ||
      s.includes("claude") ||
      e.includes("anthropic")
    )
      return "anthropic";
    if (
      s.includes("google") ||
      s.includes("gemini") ||
      s.includes("vertex") ||
      e.includes("generativelanguage") ||
      e.includes("googleapis")
    )
      return "google";
    if (s.includes("cohere") || e.includes("cohere")) return "cohere";
    return "openai";
  }

  private generateKeyHint(apiKey: string): string {
    if (apiKey.length <= 8) return "****";
    const prefix = apiKey.substring(0, 4);
    const suffix = apiKey.substring(apiKey.length - 4);
    return `${prefix}...${suffix}`;
  }

  private isPrivateHost(hostname: string): boolean {
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]"
    ) {
      return true;
    }
    // 10.0.0.0/8
    if (hostname.startsWith("10.")) return true;
    // 192.168.0.0/16
    if (hostname.startsWith("192.168.")) return true;
    // 169.254.0.0/16 (link-local)
    if (hostname.startsWith("169.254.")) return true;
    // 172.16.0.0/12 (172.16.* - 172.31.*)
    if (hostname.startsWith("172.")) {
      const second = parseInt(hostname.split(".")[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  }
}
