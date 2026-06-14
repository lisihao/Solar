/**
 * Search Service
 * 底层搜索实现服务
 *
 * ============================================================================
 * ARCHITECTURE NOTE
 * ============================================================================
 * 本服务是 AI Engine 的底层搜索实现，提供：
 * - 多搜索提供商支持 (Tavily, Serper, DuckDuckGo)
 * - 自动降级和 Key 轮换
 * - 搜索结果排名和多样性过滤
 *
 * 使用指南：
 * 1. 上层 AI Apps 应通过 AIFacade.search() 调用（统一入口）
 * 2. 底层服务（如 DeepResearchAgent）可直接注入本服务使用
 * 3. AIFacade.search() 通过 web-search Tool 实现，最终也调用本服务
 *
 * 分层架构：
 *   AIFacade.search()  ← 统一入口（推荐）
 *         ↓
 *   web-search Tool (ToolRegistry)
 *         ↓
 *   SearchService (本服务) ← 底层实现
 * ============================================================================
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService, SECRET_NAMES } from "@/modules/platform/facade";
import {
  ToolKeyResolverService,
  NoToolKeyError,
} from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
import { RequestContext } from "@/common/context/request-context";
import * as duckDuckScrape from "duck-duck-scrape";
import * as crypto from "crypto";

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
  domain?: string;
  rawScore?: number;
}

export interface WebSearchResponse {
  success: boolean;
  results: WebSearchResult[];
  error?: string;
  /** 实际使用的搜索提供商 */
  provider?: string;
}

/** 需要触发自动降级的 HTTP 状态码 */
const FAILOVER_STATUS_CODES = [400, 401, 429, 432, 500, 502, 503, 504];

/** 搜索提供商优先级顺序 */
type SearchProvider = "tavily" | "serper" | "duckduckgo";

/** API Key 健康状态（内部使用） */
interface KeyHealth {
  failedAt: number;
  errorCode: number;
}

/** API Key 健康状态（对外导出） */
export interface KeyHealthStatus {
  /** 密钥序号 (0-indexed) */
  index: number;
  /** 脱敏显示的密钥 (如 tvly-abcd****xyz) */
  maskedKey: string;
  /** 是否健康可用 */
  isHealthy: boolean;
  /** 最近错误码 (如 HTTP 429) */
  lastError?: string;
  /** 冷却结束时间 (ISO 格式) */
  cooldownUntil?: string;
}

/** Key 冷却时间（毫秒）- 临时性错误（400/401/403/5xx）后多久重试 */
const KEY_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟

/**
 * Key 限流冷却时间（毫秒）- 429 Too Many Requests 短冷却。
 *
 * ★ P0-LIVE-COOLDOWN-FALSEPOS (2026-04-30): per-provider 区分。
 * Serper：1 分钟（用户实证 dashboard 配额仍剩 2324 但被锁 1436 min）。
 *   Serper 的 429 是 per-second 突发限流，1 分钟 retry 已绰绰有余。
 * 其他 provider：30 分钟（更稳健的默认）。
 *
 * 若真月配额耗尽 → cooldown 后重试还是 429 → 自动续期同 cooldown，
 * 用户体验等价；若是瞬时限流 → cooldown 后恢复，不再误锁 24h。
 */
const KEY_RATE_LIMIT_COOLDOWN_MS_DEFAULT = 30 * 60 * 1000; // 30 分钟
const KEY_RATE_LIMIT_COOLDOWN_MS_BY_PROVIDER: Record<string, number> = {
  serper: 60 * 1000, // 1 分钟
};
const rateLimitCooldownFor = (provider: string): number =>
  KEY_RATE_LIMIT_COOLDOWN_MS_BY_PROVIDER[provider] ??
  KEY_RATE_LIMIT_COOLDOWN_MS_DEFAULT;

/** Key 长冷却时间（毫秒）- 月配额耗尽（HTTP 402 / 显式 quota header）后长冷却 */
const KEY_QUOTA_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 小时

/**
 * DuckDuckGo 反爬熔断（2026-05-28）：DDG 是免 key 兜底，无官方限流额度，
 * mission 密集并发会触发 "DDG detected an anomaly" 反爬。命中后进入冷却，
 * 期间直接跳过 DDG（响亮失败，不再刷屏重试）；并用串行队列 + 最小间隔降低触发概率。
 */
const DDG_COOLDOWN_MS = 60 * 1000; // 命中反爬后冷却 60s
const DDG_MIN_SPACING_MS = 1200; // 串行请求之间最小间隔

/**
 * 判断是否为速率限制错误（短冷却即可，避免 24h 误锁）。
 * 注意：429 不再单独给 24h，统一走 30 分钟短冷却。
 */
const isRateLimitError = (errorCode: number): boolean => errorCode === 429;

/**
 * 判断是否为月配额真正耗尽（需要 24h 长冷却）。
 * - 402 Payment Required：明确表示余额不足
 * - 432：Tavily 计划用量上限（plan usage limit）。非瞬时错误，等同配额耗尽；
 *   否则每次搜索都会把全部 key 重试一遍（5min 短冷却），刷屏且浪费请求。
 * 当前未对 429 做 quota header 嗅探（多数 API 不在 status code 上区分），按
 * 短冷却处理；若真月配额耗尽，30min 后再次 429 → 自动续 30min，效果等价。
 */
const isQuotaExhaustedError = (errorCode: number): boolean =>
  errorCode === 402 || errorCode === 432;

/**
 * 2026-05-12: 客户端请求错误（query 本身的问题，不是 key 失效）。
 * - 400 Bad Request：参数错（query 太长 / 含非法字符 / 编码失败）
 * - 422 Unprocessable Entity：语义错
 * 这类错误不能把 key 标失败，否则 1 个坏 query 永久污染所有 key。
 */
const isClientRequestError = (errorCode: number): boolean =>
  errorCode === 400 || errorCode === 422;

/** 健康记录过期时间（毫秒）- 24 小时后清理 */
const KEY_HEALTH_TTL_MS = 24 * 60 * 60 * 1000;

/** 清理间隔（毫秒）- 每小时清理一次 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** 搜索配置（支持多 Key） */
interface SearchConfig {
  provider: string;
  enabled: boolean;
  tavilyKeys: string[];
  serperKeys: string[];
  /** ★ 2026-05-12: 与 tavilyKeys / serperKeys 平行的 keyId 数组（同长度同顺序），
   *   让 markKeyFailed / clearKeyFailure 能同时把状态同步到 DB SecretKey.testStatus
   *   让 admin UI（/admin/access/secrets）看到真实状态。
   *   keyId 为 null 时（legacy comma-separated 单行）跳过 DB 同步。 */
  tavilyKeyIds: Array<string | null>;
  serperKeyIds: Array<string | null>;
}

/** ★ 2026-05-12: SearchService 失败 → SecretKey.lastErrorCode 归一化映射，
 *   与 /admin/access/secrets badge ("未授权" / "限流" / "配额耗尽") 对齐。*/
function searchErrorToSecretCode(http: number): string {
  if (http === 401 || http === 403) return "AUTH_FAILED";
  if (http === 402) return "QUOTA_EXHAUSTED";
  if (http === 429) return "RATE_LIMIT_KEY";
  if (http >= 500) return "PROVIDER_5XX";
  if (http >= 400) return "BAD_REQUEST";
  return "UNKNOWN";
}

@Injectable()
export class SearchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchService.name);

  /**
   * API Key 健康状态追踪
   * Key: SHA-256 hash of "provider:apiKey" → Value: { failedAt, errorCode }
   * ★ 使用哈希避免 API Key 泄露
   */
  private keyHealthMap = new Map<string, KeyHealth>();

  /**
   * Round-Robin 索引追踪
   * Key: provider → Value: next key index
   * ★ 避免并发请求都使用同一 Key
   */
  private keyIndexMap = new Map<SearchProvider, number>();

  /** 清理定时器 */
  private cleanupTimer: NodeJS.Timeout | null = null;

  /** ★ DuckDuckGo 反爬冷却截止时间戳（ms）。命中 anomaly/限流后设置，期间跳过 DDG。 */
  private ddgCooldownUntil = 0;

  /** ★ DuckDuckGo 串行化队列尾：把并发搜索排队，避免同时多路触发反爬。 */
  private ddgQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly secretsService: SecretsService,
    private readonly configService: ConfigService,
    private readonly toolKeyResolver: ToolKeyResolverService,
  ) {}

  /**
   * 2026-05-27 BYOK 全量化：把某搜索工具的 admin key 列表替换为「该用户应使用的 key」。
   * - 有 userId（请求/任务上下文）：走 ToolKeyResolver（用户 Key 优先 → 授权 → strict/fallback）
   *   - 解析到 → 返回单 key（keyId=null，不参与 admin SecretKey 健康机制）
   *   - STRICT 且用户无 key/授权 → NoToolKeyError → 返回空（该 provider 不可用，降级 DuckDuckGo）
   *   - FALLBACK 且 admin 也没配 → 空
   * - 无 userId（background cron / 系统任务）：保持 admin key 列表不变。
   */
  private async applyByokToolKeys(
    toolId: string,
    adminKeys: string[],
    adminKeyIds: Array<string | null>,
  ): Promise<{ keys: string[]; keyIds: Array<string | null> }> {
    const userId = RequestContext.getUserId();
    if (!userId) {
      // 返回副本——调用方会先清空原数组再 push，返回同引用会被自清空
      return { keys: [...adminKeys], keyIds: [...adminKeyIds] };
    }
    try {
      const resolved = await this.toolKeyResolver.resolveToolKey(
        toolId,
        userId,
      );
      if (resolved) {
        return { keys: [resolved.value], keyIds: [null] };
      }
      // FALLBACK 模式但 admin 也没配 → 无可用 key
      return { keys: [], keyIds: [] };
    } catch (error) {
      if (error instanceof NoToolKeyError) {
        // STRICT：用户未配且无授权 → 不烧 admin 池，该 provider 不可用
        this.logger.debug(
          `[Search] BYOK STRICT: user ${userId} has no key/grant for ${toolId}, skipping admin keys`,
        );
        return { keys: [], keyIds: [] };
      }
      throw error;
    }
  }

  /**
   * 模块初始化时启动清理定时器
   */
  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredHealthRecords();
    }, CLEANUP_INTERVAL_MS).unref();
    this.logger.log("[Search] Health record cleanup timer started");
  }

  /**
   * 模块销毁时清理定时器
   */
  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      this.logger.log("[Search] Health record cleanup timer stopped");
    }
  }

  /**
   * 清理过期的健康记录，防止内存泄漏
   */
  private cleanupExpiredHealthRecords(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, health] of this.keyHealthMap.entries()) {
      if (now - health.failedAt > KEY_HEALTH_TTL_MS) {
        this.keyHealthMap.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(
        `[Search] Cleaned up ${cleanedCount} expired health records`,
      );
    }
  }

  /**
   * 获取 Key 的哈希值（避免明文存储）
   * ★ 安全：API Key 不会出现在 Map 键或日志中
   */
  private getKeyHash(provider: SearchProvider, key: string): string {
    return crypto
      .createHash("sha256")
      .update(`${provider}:${key}`)
      .digest("hex")
      .substring(0, 16); // 只取前 16 位，足够唯一标识
  }

  /**
   * 获取 Key 的掩码显示（用于日志）
   * ★ 安全：只显示长度，不暴露任何字符
   */
  private getMaskedKey(key: string): string {
    return `[${key.length}chars]`;
  }

  /**
   * 获取健康的 API Key
   * ★ 使用 Round-Robin 分散并发请求到不同的 Key
   * ★ 使用哈希存储健康状态，避免 Key 泄露
   * ★ 原子性索引递增，避免并发请求使用同一 Key
   */
  private getHealthyKey(
    provider: SearchProvider,
    keys: string[],
  ): string | null {
    // 过滤空 Key
    const validKeys = keys.filter((k) => k && k.trim() !== "");
    if (validKeys.length === 0) return null;

    const now = Date.now();

    // ★ 原子性获取并递增索引（避免并发请求获取相同 Key）
    // 即使在同步代码中，也要确保 get-and-increment 紧密相邻
    const startIndex = this.keyIndexMap.get(provider) || 0;
    this.keyIndexMap.set(provider, (startIndex + 1) % validKeys.length);

    // Round-Robin: 从当前索引开始尝试
    for (let i = 0; i < validKeys.length; i++) {
      const index = (startIndex + i) % validKeys.length;
      const key = validKeys[index];
      const healthKey = this.getKeyHash(provider, key);
      const health = this.keyHealthMap.get(healthKey);

      // Key 从未失败过，或冷却期已过
      // ★ P0-LIVE-COOLDOWN-FALSEPOS (2026-04-30): 三档 + per-provider 冷却
      //   402 月配额耗尽 → 24h；429 瞬时限流 → serper=1min, 其他=30min；其他 → 5min
      let cooldown = KEY_COOLDOWN_MS;
      if (health) {
        if (isQuotaExhaustedError(health.errorCode))
          cooldown = KEY_QUOTA_COOLDOWN_MS;
        else if (isRateLimitError(health.errorCode))
          cooldown = rateLimitCooldownFor(provider);
      }
      if (!health || now - health.failedAt >= cooldown) {
        if (health) {
          this.logger.debug(
            `[Search] Key ${this.getMaskedKey(key)} cooldown expired, retrying`,
          );
        }
        return key;
      }
    }

    // 所有 Key 都在冷却期
    // ★ 区分配额耗尽 vs 临时错误：
    // - 如果全部是配额耗尽（400/401），直接返回 null，触发 Provider 级降级
    // - 如果有临时错误（429/5xx），返回最早失败的 key 重试
    let allQuotaExhausted = true;
    let fallbackKey: string | null = null;
    let oldestFailedAt = Infinity;

    for (const key of validKeys) {
      const healthKey = this.getKeyHash(provider, key);
      const health = this.keyHealthMap.get(healthKey);
      if (health) {
        if (!isQuotaExhaustedError(health.errorCode)) {
          allQuotaExhausted = false;
        }
        if (health.failedAt < oldestFailedAt) {
          oldestFailedAt = health.failedAt;
          fallbackKey = key;
        }
      }
    }

    if (allQuotaExhausted) {
      this.logger.warn(
        `[Search] All ${provider} keys quota exhausted (24h cooldown), skipping provider`,
      );
      return null; // ★ 触发立即 failover，不浪费请求
    }

    if (fallbackKey) {
      this.logger.warn(
        `[Search] All ${provider} keys in cooldown, using oldest failed key`,
      );
    }
    return fallbackKey;
  }

  /**
   * 标记 Key 失败
   * ★ 使用哈希存储，不暴露 Key 内容
   * ★ 2026-05-12: 同步到 SecretKey.testStatus='failed' 让 admin UI 看到真实状态。
   *   keyId 通过 lookupKeyId(provider, key) 从 SearchConfig 拿（已配并行 keyId 数组）。
   *   env-fallback / legacy comma 模式 keyId=null 时跳过 DB 写。
   */
  private markKeyFailed(
    provider: SearchProvider,
    key: string,
    errorCode: number,
  ): void {
    const healthKey = this.getKeyHash(provider, key);
    this.keyHealthMap.set(healthKey, {
      failedAt: Date.now(),
      errorCode,
    });
    this.logger.warn(
      `[Search] Marked ${provider} key ${this.getMaskedKey(key)} as failed (HTTP ${errorCode})`,
    );
    // ★ 2026-05-12: bridge in-memory failure → DB SecretKey.testStatus
    //   admin /admin/access/secrets 显示的"正常 / 失败 / 限流"颜色 badge 才会变红
    void this.syncSecretFailureToDb(provider, key, errorCode);
  }

  /**
   * 清除 Key 的失败状态（成功时调用）
   * ★ 2026-05-12: 同步到 SecretKey.testStatus='success' + 清错误码消息。
   */
  private clearKeyFailure(provider: SearchProvider, key: string): void {
    const healthKey = this.getKeyHash(provider, key);
    if (this.keyHealthMap.has(healthKey)) {
      this.keyHealthMap.delete(healthKey);
      this.logger.debug(
        `[Search] Cleared failure status for ${provider} key ${this.getMaskedKey(key)}`,
      );
    }
    void this.syncSecretSuccessToDb(provider, key);
  }

  /**
   * 把 in-memory key 失败状态同步到 SecretKey.testStatus（DB），让 admin UI 看到。
   * 通过遍历当前 config 的 tavilyKeys/serperKeys 找到匹配 raw key 的 keyId。
   * keyId=null（env / legacy comma）时静默跳过。
   */
  private async syncSecretFailureToDb(
    provider: SearchProvider,
    key: string,
    httpCode: number,
  ): Promise<void> {
    try {
      const config = await this.getSearchConfig();
      const { keyId, secretName } = this.lookupKeyIdAndSecretName(
        provider,
        key,
        config,
      );
      if (!keyId || !secretName) return; // env-fallback / legacy comma 模式无 keyId
      await this.secretsService.markSecretFailure(
        secretName,
        `Search HTTP ${httpCode}`,
        keyId,
        searchErrorToSecretCode(httpCode),
      );
    } catch (err) {
      this.logger.debug(
        `[Search] syncSecretFailureToDb skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async syncSecretSuccessToDb(
    provider: SearchProvider,
    key: string,
  ): Promise<void> {
    try {
      const config = await this.getSearchConfig();
      const { keyId, secretName } = this.lookupKeyIdAndSecretName(
        provider,
        key,
        config,
      );
      if (!keyId || !secretName) return;
      await this.secretsService.markSecretSuccess(secretName, keyId);
    } catch (err) {
      this.logger.debug(
        `[Search] syncSecretSuccessToDb skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private lookupKeyIdAndSecretName(
    provider: SearchProvider,
    key: string,
    config: SearchConfig,
  ): { keyId: string | null; secretName: string | null } {
    if (provider === "tavily") {
      const idx = config.tavilyKeys.indexOf(key);
      if (idx === -1) return { keyId: null, secretName: null };
      return {
        keyId: config.tavilyKeyIds[idx] ?? null,
        secretName: SECRET_NAMES.TAVILY_SEARCH,
      };
    }
    if (provider === "serper") {
      const idx = config.serperKeys.indexOf(key);
      if (idx === -1) return { keyId: null, secretName: null };
      return {
        keyId: config.serperKeyIds[idx] ?? null,
        secretName: SECRET_NAMES.SERPER,
      };
    }
    return { keyId: null, secretName: null };
  }

  /**
   * ★ P0-LIVE-COOLDOWN-FALSEPOS (2026-04-30): 公开的清冷却 API。
   * 给管理后台 / 用户在确认 dashboard 配额仍有时手动重置。
   * 返回清掉的 key 数量。
   */
  resetAllKeyCooldowns(provider?: SearchProvider): number {
    let cleared = 0;
    for (const k of [...this.keyHealthMap.keys()]) {
      if (provider && !k.startsWith(`${provider}:`)) continue;
      this.keyHealthMap.delete(k);
      cleared++;
    }
    if (cleared > 0) {
      this.logger.warn(
        `[Search] Manually cleared ${cleared} key cooldown(s)${provider ? ` for ${provider}` : ""} (admin reset)`,
      );
    }
    return cleared;
  }

  /**
   * 获取用于显示的脱敏密钥
   * 显示前4位 + **** + 后3位（如 tvly-abcd****xyz）
   */
  getMaskedKeyForDisplay(key: string): string {
    if (!key || key.length < 10) {
      return "****";
    }
    const prefix = key.substring(0, 8);
    const suffix = key.substring(key.length - 3);
    return `${prefix}****${suffix}`;
  }

  /**
   * 获取指定 Provider 的所有 Key 健康状态
   * ★ 供管理后台 API 调用，展示密钥健康状况
   */
  async getKeyHealthStatus(
    provider: "tavily" | "serper",
  ): Promise<KeyHealthStatus[]> {
    const config = await this.getSearchConfig();
    const keys = provider === "tavily" ? config.tavilyKeys : config.serperKeys;
    const now = Date.now();

    return keys.map((key, index) => {
      const healthKey = this.getKeyHash(provider, key);
      const health = this.keyHealthMap.get(healthKey);

      // 计算是否健康：未失败过，或冷却期已过
      // 与 selectHealthyKey 一致：402 → 24h, 429 → per-provider (serper=1min,其他=30min), 其他 → 5min
      let cooldown = KEY_COOLDOWN_MS;
      if (health) {
        if (isQuotaExhaustedError(health.errorCode))
          cooldown = KEY_QUOTA_COOLDOWN_MS;
        else if (isRateLimitError(health.errorCode))
          cooldown = rateLimitCooldownFor(provider);
      }
      const isHealthy = !health || now - health.failedAt >= cooldown;

      // 计算冷却结束时间
      let cooldownUntil: string | undefined;
      if (health && !isHealthy) {
        const cooldownEnd = new Date(health.failedAt + cooldown);
        cooldownUntil = cooldownEnd.toISOString();
      }

      return {
        index,
        maskedKey: this.getMaskedKeyForDisplay(key),
        isHealthy,
        lastError: health ? `HTTP ${health.errorCode}` : undefined,
        cooldownUntil,
      };
    });
  }

  /**
   * 判断错误是否需要触发降级
   */
  private shouldFailover(error: unknown): boolean {
    const err = error as { response?: { status?: number } };
    const statusCode = err.response?.status;
    // 网络超时、连接失败、或特定状态码都应该降级
    if (!statusCode) return true; // 网络错误
    return FAILOVER_STATUS_CODES.includes(statusCode);
  }

  /**
   * Search for real-time information using configured search API
   * ★ 支持自动降级：主 Provider 失败时自动切换到备用 Provider
   * ★ 支持多 Key 轮换：同一 Provider 的多个 Key 失败时自动切换
   *
   * @param query - Search query string
   * @param maxResults - Maximum number of results to return
   * @param since - Optional date to filter results (only return results newer than this date)
   */
  async search(
    query: string,
    maxResults: number = 5,
    since?: Date,
  ): Promise<WebSearchResponse> {
    // Get search API configuration from system settings
    const searchConfig = await this.getSearchConfig();

    this.logger.debug(
      `[Search] Config: provider=${searchConfig.provider}, enabled=${searchConfig.enabled}, ` +
        `tavilyKeys=${searchConfig.tavilyKeys.length}, serperKeys=${searchConfig.serperKeys.length}`,
    );

    // 构建降级链：配置的 Provider → 备用 Provider → DuckDuckGo
    const failoverChain = this.buildFailoverChain(searchConfig);

    this.logger.debug(`[Search] Failover chain: ${failoverChain.join(" → ")}`);

    let lastError: unknown = null;

    for (const provider of failoverChain) {
      try {
        // ★ executeSearch 内部已实现同 Provider 多 Key 重试
        // 所有 key 都失败后才会抛异常到这里触发 Provider 级降级
        const { result, usedKey } = await this.executeSearch(
          provider,
          query,
          maxResults,
          since,
          searchConfig,
        );

        if (result.success) {
          // 成功时清除 Key 的失败状态
          if (usedKey) {
            this.clearKeyFailure(provider, usedKey);
          }
          return { ...result, provider };
        }

        // 搜索返回失败但没有抛出异常（如无结果），继续尝试下一个
        this.logger.warn(
          `[Search] ${provider} returned unsuccessful: ${result.error}`,
        );
        lastError = new Error(result.error);
      } catch (error: unknown) {
        lastError = error;
        const err = error as {
          response?: {
            status?: number;
            data?: { message?: string; error?: string };
          };
          message?: string;
        };
        const statusCode: number | undefined = err.response?.status;
        const errorMessage =
          err.response?.data?.message ||
          err.response?.data?.error ||
          err.message;

        this.logger.warn(
          `[Search] ${provider} all keys exhausted (${statusCode !== undefined ? `HTTP ${statusCode}` : "network error"}): ${errorMessage}`,
        );

        // 判断是否需要降级到下一个 Provider
        if (this.shouldFailover(error)) {
          this.logger.log(
            `[Search] Failing over from ${provider} to next provider...`,
          );
          continue;
        }

        return {
          success: false,
          results: [],
          error: errorMessage,
          provider,
        };
      }
    }

    // 所有 Provider 都失败了
    const lastErr = lastError as
      | { response?: { data?: { message?: string } }; message?: string }
      | undefined;
    const finalError =
      lastErr?.response?.data?.message ||
      lastErr?.message ||
      "All search providers failed";
    this.logger.error(
      `[Search] All providers exhausted. Final error: ${finalError}`,
    );

    return {
      success: false,
      results: [],
      error: finalError,
    };
  }

  /**
   * 构建降级链
   * 优先级：用户配置的 Provider → 备用付费 Provider → DuckDuckGo（免费兜底）
   */
  private buildFailoverChain(searchConfig: SearchConfig): SearchProvider[] {
    const chain: SearchProvider[] = [];
    const hasTavily = searchConfig.tavilyKeys.length > 0;
    const hasSerper = searchConfig.serperKeys.length > 0;

    // 1. 用户配置的首选 Provider
    if (searchConfig.provider === "tavily" && hasTavily) {
      chain.push("tavily");
    } else if (searchConfig.provider === "serper" && hasSerper) {
      chain.push("serper");
    } else if (searchConfig.provider === "duckduckgo") {
      chain.push("duckduckgo");
    }

    // 2. 备用付费 Provider
    if (!chain.includes("tavily") && hasTavily) {
      chain.push("tavily");
    }
    if (!chain.includes("serper") && hasSerper) {
      chain.push("serper");
    }

    // 3. DuckDuckGo 作为最终兜底（免费，无需 API Key）
    if (!chain.includes("duckduckgo")) {
      chain.push("duckduckgo");
    }

    this.logger.debug(`[Search] Failover chain: ${chain.join(" → ")}`);
    return chain;
  }

  /**
   * 执行搜索
   * ★ 返回使用的 Key 以便追踪健康状态
   */
  private async executeSearch(
    provider: SearchProvider,
    query: string,
    maxResults: number,
    since: Date | undefined,
    searchConfig: SearchConfig,
  ): Promise<{ result: WebSearchResponse; usedKey: string | null }> {
    switch (provider) {
      case "tavily":
        return this.executeWithKeyRetry(
          "tavily",
          searchConfig.tavilyKeys,
          (apiKey) => this.searchWithTavily(query, apiKey, maxResults, since),
        );
      case "serper":
        return this.executeWithKeyRetry(
          "serper",
          searchConfig.serperKeys,
          (apiKey) => this.searchWithSerper(query, apiKey, maxResults, since),
        );
      case "duckduckgo": {
        const result = await this.searchWithDuckduckgo(
          query,
          maxResults,
          since,
        );
        return { result, usedKey: null };
      }
      default:
        throw new BadRequestException(`Unknown search provider: ${provider}`);
    }
  }

  /**
   * 同 Provider 内多 Key 重试
   * ★ 一个 Key 失败后尝试下一个健康 Key，而非直接降级到下一个 Provider
   */
  private async executeWithKeyRetry(
    provider: SearchProvider,
    keys: string[],
    searchFn: (apiKey: string) => Promise<WebSearchResponse>,
  ): Promise<{ result: WebSearchResponse; usedKey: string | null }> {
    const validKeys = keys.filter((k) => k && k.trim() !== "");
    const triedKeys = new Set<string>();
    let lastError: unknown = null;

    for (let attempt = 0; attempt < validKeys.length; attempt++) {
      const apiKey = this.getHealthyKey(provider, validKeys);
      if (!apiKey || triedKeys.has(apiKey)) {
        break; // 没有更多可用 key 或已经试过
      }
      triedKeys.add(apiKey);

      try {
        const result = await searchFn(apiKey);
        return { result, usedKey: apiKey };
      } catch (error) {
        lastError = error;
        const err = error as {
          response?: { status?: number; data?: { message?: string } };
        };
        const statusCode = err.response?.status;
        const respMsg = err.response?.data?.message ?? "";

        // ★ 2026-05-12: 400/422 是 query 本身坏（非法字符 / 太长 / 编码错），
        //   重试别的 key 也会再炸。立即抛让上层换 query/provider，并且不要
        //   markKeyFailed 误杀好 key。
        //   例外：serper free tier 配额耗尽返回 400 + body "Quota exceeded"
        //   ——这类需要按 402 标失败做长冷却。
        // ★ 2026-05-13: 扩展正则到所有"配额 / 充值 / 余额"语义；用户实证
        //   Serper paid plan 用尽时返回 400/403 + body "Not enough credits"，
        //   原 /quota.*exceed/ 不匹配 → key 不被标失败 → admin UI 谎报"正常"。
        const looksLikeQuotaInBody =
          /quota.*exceed|exceeded.*quota|not enough credits?|insufficient credits?|out of credits?|payment required|insufficient[_ ]?funds|insufficient[_ ]?balance|account.*suspend|free plan limit/i.test(
            respMsg,
          );
        if (
          statusCode !== undefined &&
          isClientRequestError(statusCode) &&
          !looksLikeQuotaInBody
        ) {
          this.logger.warn(
            `[Search] ${provider} HTTP ${statusCode} on query (key OK, request bad); ` +
              `aborting key-failover for this query`,
          );
          throw error;
        }

        this.logger.warn(
          `[Search] ${provider} key ${this.getMaskedKey(apiKey)} failed` +
            `${statusCode !== undefined ? ` (HTTP ${statusCode})` : ""}, ` +
            `trying next key (${attempt + 1}/${validKeys.length})`,
        );

        if (statusCode !== undefined) {
          // serper 400 + "Quota exceeded" body → 当 402 处理走 24h 冷却
          const effectiveCode = looksLikeQuotaInBody ? 402 : statusCode;
          this.markKeyFailed(provider, apiKey, effectiveCode);
        }
      }
    }

    // 所有 key 都失败，抛出最后一个错误让上层降级处理
    if (lastError) {
      throw lastError;
    }
    throw new ServiceUnavailableException(
      `No healthy ${provider} API key available`,
    );
  }

  /**
   * Get search API configuration
   * ★ M1 Fix: 统一使用 Secret Manager 获取 API Key
   *
   * 密钥来源优先级：
   * 1. Secret Manager (TAVILY_API_KEY, SERPER_API_KEY)
   * 2. 环境变量 (兼容旧配置)
   */
  private async getSearchConfig(): Promise<SearchConfig> {
    // 环境变量作为备用 (支持逗号分隔多个 Key)
    const tavilyEnvKey = this.configService.get<string>("TAVILY_API_KEY");
    const tavilyEnvKeys = tavilyEnvKey
      ? tavilyEnvKey
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
      : [];
    const serperEnvKey = this.configService.get<string>("SERPER_API_KEY");
    const serperEnvKeys = serperEnvKey
      ? serperEnvKey
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
      : [];

    try {
      // ★ 使用统一的 SECRET_NAMES 映射获取 API Keys
      // 不允许在此硬编码 Secret 名称
      const tavilyKeys: string[] = [];
      const serperKeys: string[] = [];
      // ★ 2026-05-12: 并行收集 keyId 让失败/成功反馈能同步到 SecretKey.testStatus
      const tavilyKeyIds: Array<string | null> = [];
      const serperKeyIds: Array<string | null> = [];

      // 从 Secret Manager 获取 Tavily Key（使用统一映射）
      //   ★ 优先走 getValueInternalAllKeys：返回每个 SecretKey 行的 value + keyId
      //     parallel array，让我们后续能 markSecretFailure(name, msg, keyId)
      //     DB 同步。仅当 SecretKey 表为空且 legacy 单行兜底时 keyId=null。
      const tavilyRows = await this.secretsService.getValueInternalAllKeys(
        SECRET_NAMES.TAVILY_SEARCH,
      );
      for (const row of tavilyRows) {
        // 对于 legacy 单行 comma-separated 情况，仍要 split；新模式 1 row = 1 key
        const splits = row.value
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        for (const k of splits) {
          tavilyKeys.push(k);
          // legacy comma 多 key 在同一 SecretKey 行下，全部共享同一 keyId
          tavilyKeyIds.push(row.keyId);
        }
      }

      // 从 Secret Manager 获取 Serper Key（使用统一映射）
      const serperRows = await this.secretsService.getValueInternalAllKeys(
        SECRET_NAMES.SERPER,
      );
      for (const row of serperRows) {
        const splits = row.value
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        for (const k of splits) {
          serperKeys.push(k);
          serperKeyIds.push(row.keyId);
        }
      }

      // 如果 Secret Manager 没有配置，回退到环境变量（env 没有 keyId 可标）
      if (tavilyKeys.length === 0) {
        tavilyKeys.push(...tavilyEnvKeys);
        tavilyKeyIds.push(...tavilyEnvKeys.map(() => null));
      }
      if (serperKeys.length === 0) {
        serperKeys.push(...serperEnvKeys);
        serperKeyIds.push(...serperEnvKeys.map(() => null));
      }

      // ★ 2026-05-27 BYOK 全量化：若处于用户上下文，按 BYOK 优先级替换 key 列表
      //   （用户 Key 优先 → 授权 → strict/fallback）。无 userId 的系统任务不受影响。
      const tavilyByok = await this.applyByokToolKeys(
        "tavily",
        tavilyKeys,
        tavilyKeyIds,
      );
      const serperByok = await this.applyByokToolKeys(
        "serper",
        serperKeys,
        serperKeyIds,
      );
      tavilyKeys.length = 0;
      tavilyKeys.push(...tavilyByok.keys);
      tavilyKeyIds.length = 0;
      tavilyKeyIds.push(...tavilyByok.keyIds);
      serperKeys.length = 0;
      serperKeys.push(...serperByok.keys);
      serperKeyIds.length = 0;
      serperKeyIds.push(...serperByok.keyIds);

      // 获取 provider 配置（仍从 SystemSetting 获取，因为这不是密钥）
      let provider: string = "tavily";
      let enabled = true;

      const providerSetting = await this.prisma.systemSetting.findFirst({
        where: { key: "search.provider" },
      });
      if (providerSetting?.value) {
        try {
          provider = JSON.parse(providerSetting.value);
        } catch {
          provider = providerSetting.value;
        }
      }

      const enabledSetting = await this.prisma.systemSetting.findFirst({
        where: { key: "search.enabled" },
      });
      if (enabledSetting?.value) {
        try {
          enabled = JSON.parse(enabledSetting.value) !== false;
        } catch {
          enabled = enabledSetting.value !== "false";
        }
      }

      if (!enabled) {
        return {
          provider: "tavily",
          enabled: false,
          tavilyKeys: [],
          serperKeys: [],
          tavilyKeyIds: [],
          serperKeyIds: [],
        };
      }

      // 根据可用的 Key 自动选择 provider
      if (
        provider === "tavily" &&
        tavilyKeys.length === 0 &&
        serperKeys.length > 0
      ) {
        provider = "serper";
      } else if (
        provider === "serper" &&
        serperKeys.length === 0 &&
        tavilyKeys.length > 0
      ) {
        provider = "tavily";
      }

      this.logger.debug(
        `[Search] Config: provider=${provider}, tavily=${tavilyKeys.length} keys, serper=${serperKeys.length} keys (source: Secret Manager)`,
      );

      return {
        provider,
        enabled: true,
        tavilyKeys,
        serperKeys,
        tavilyKeyIds,
        serperKeyIds,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to get search config: ${error instanceof Error ? error.message : String(error)}, using env vars`,
      );
    }

    // Fallback to environment variables when Secret Manager access fails（env 无 keyId）
    return {
      provider:
        tavilyEnvKeys.length > 0
          ? "tavily"
          : serperEnvKeys.length > 0
            ? "serper"
            : "duckduckgo",
      enabled: true,
      tavilyKeys: tavilyEnvKeys,
      serperKeys: serperEnvKeys,
      tavilyKeyIds: tavilyEnvKeys.map(() => null),
      serperKeyIds: serperEnvKeys.map(() => null),
    };
  }

  /**
   * Search using Tavily API with advanced options
   * https://tavily.com/
   */
  private async searchWithTavily(
    query: string,
    apiKey: string,
    maxResults: number,
    since?: Date,
  ): Promise<WebSearchResponse> {
    this.logger.debug(`Searching with Tavily: "${query}"`);

    // Request more results for better ranking/filtering
    const requestedResults = Math.min(maxResults * 2, 20);

    // ★ Calculate days parameter for time range filtering
    let days: number | undefined;
    if (since) {
      const now = new Date();
      const diffMs = now.getTime() - since.getTime();
      days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      this.logger.debug(`Tavily: filtering results to last ${days} days`);
    }

    // Parse site: operators from query and convert to Tavily's include_domains
    const sitePattern = /\bsite:([^\s]+)/gi;
    const extractedDomains: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = sitePattern.exec(query)) !== null) {
      extractedDomains.push(match[1]);
    }
    let tavilyQuery = query
      .replace(/\bsite:[^\s]+/gi, "")
      .replace(/\bOR\b/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!tavilyQuery && extractedDomains.length > 0) {
      tavilyQuery = extractedDomains.join(" ");
    }

    const requestBody: Record<string, unknown> = {
      api_key: apiKey,
      query: tavilyQuery,
      max_results: requestedResults,
      search_depth: "advanced", // Use advanced for better quality
      include_answer: false,
      include_raw_content: false,
      include_domains: extractedDomains,
      exclude_domains: [], // No exclusions
    };

    // ★ Add days parameter if time range is specified
    if (days && days > 0) {
      requestBody.days = days;
    }

    const response = await firstValueFrom(
      this.httpService.post("https://api.tavily.com/search", requestBody, {
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
      }),
    );

    const rawResults: WebSearchResult[] = (response.data.results || []).map(
      (r: {
        title: string;
        url: string;
        content: string;
        score?: number;
        published_date?: string;
      }) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        rawScore: r.score,
        domain: this.extractDomain(r.url),
        publishedDate: r.published_date,
      }),
    );

    // Apply comprehensive ranking algorithm
    const rankedResults = this.rankSearchResults(
      rawResults,
      tavilyQuery,
      maxResults,
    );

    this.logger.debug(
      `Tavily returned ${rawResults.length} results, ranked to ${rankedResults.length}`,
    );
    return { success: true, results: rankedResults };
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  /**
   * Comprehensive ranking algorithm based on industry best practices
   * Factors: Relevance, Freshness, Quality, Diversity
   */
  private rankSearchResults(
    results: WebSearchResult[],
    query: string,
    maxResults: number,
  ): WebSearchResult[] {
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    // Score each result
    const scoredResults = results.map((result) => {
      let finalScore = 0;

      // 1. Relevance Score (40% weight) - Based on Tavily score + keyword matching
      const relevanceScore = this.calculateRelevanceScore(result, queryTerms);
      finalScore += relevanceScore * 0.4;

      // 2. Quality Score (30% weight) - Domain authority, content length
      const qualityScore = this.calculateQualityScore(result);
      finalScore += qualityScore * 0.3;

      // 3. Freshness Score (20% weight) - Recent content preferred
      const freshnessScore = this.calculateFreshnessScore(result);
      finalScore += freshnessScore * 0.2;

      // 4. Content Depth Score (10% weight) - Longer, more detailed content
      const depthScore = this.calculateDepthScore(result);
      finalScore += depthScore * 0.1;

      return {
        ...result,
        score: finalScore,
      };
    });

    // Sort by score descending
    scoredResults.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Apply diversity filter - ensure variety across domains
    const diverseResults = this.applyDiversityFilter(scoredResults, maxResults);

    return diverseResults;
  }

  /**
   * Calculate relevance score based on query matching
   */
  private calculateRelevanceScore(
    result: WebSearchResult,
    queryTerms: string[],
  ): number {
    let score = 0;

    // Start with Tavily's raw score if available
    if (result.rawScore) {
      score = result.rawScore * 50; // Tavily scores are typically 0-1
    }

    const titleLower = (result.title || "").toLowerCase();
    const contentLower = (result.content || "").toLowerCase();

    for (const term of queryTerms) {
      // Title match (high weight)
      if (titleLower.includes(term)) {
        score += 20;
        // Exact word match bonus — 转义元字符防止 ReDoS
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`\\b${escaped}\\b`).test(titleLower)) {
          score += 10;
        }
      }

      // Content match
      if (contentLower.includes(term)) {
        score += 10;
      }
    }

    // All terms match bonus
    if (queryTerms.every((term) => titleLower.includes(term))) {
      score += 25;
    }

    return Math.min(score, 100);
  }

  /**
   * Calculate quality score based on domain authority
   */
  private calculateQualityScore(result: WebSearchResult): number {
    let score = 50; // Base score
    const domain = result.domain || "";

    // High-authority domains (research, major news, official sources)
    const highAuthorityDomains = [
      // Academic & Research
      "arxiv.org",
      "nature.com",
      "science.org",
      "ieee.org",
      "acm.org",
      "researchgate.net",
      "scholar.google.com",
      "pubmed.ncbi.nlm.nih.gov",
      "journals.plos.org",
      "springer.com",
      "wiley.com",
      "elsevier.com",
      // Tech & Industry
      "techcrunch.com",
      "wired.com",
      "arstechnica.com",
      "theverge.com",
      "venturebeat.com",
      "zdnet.com",
      "cnet.com",
      "engadget.com",
      // Major News (Global)
      "reuters.com",
      "bloomberg.com",
      "ft.com",
      "wsj.com",
      "nytimes.com",
      "theguardian.com",
      "bbc.com",
      "economist.com",
      "forbes.com",
      // Analysis & Reports
      "mckinsey.com",
      "bcg.com",
      "hbr.org",
      "gartner.com",
      "forrester.com",
      "statista.com",
      "idc.com",
      "cb-insights.com",
      // Official
      "github.com",
      "stackoverflow.com",
      "medium.com",
      "dev.to",
    ];

    // Medium authority domains
    const mediumAuthorityDomains = [
      "wikipedia.org",
      "linkedin.com",
      "twitter.com",
      "reddit.com",
      "quora.com",
      "hackernews.com",
      "slashdot.org",
    ];

    // Low quality domains to deprioritize
    const lowQualityPatterns = [
      "pinterest",
      "facebook.com/",
      "instagram.com",
      "tiktok.com",
      "yelp.com",
      "tripadvisor",
    ];

    if (highAuthorityDomains.some((d) => domain.includes(d))) {
      score += 40;
    } else if (mediumAuthorityDomains.some((d) => domain.includes(d))) {
      score += 20;
    }

    // Penalize low-quality sources
    if (lowQualityPatterns.some((p) => domain.includes(p))) {
      score -= 30;
    }

    // Bonus for .edu, .gov, .org domains
    if (domain.endsWith(".edu") || domain.endsWith(".gov")) {
      score += 25;
    } else if (domain.endsWith(".org")) {
      score += 10;
    }

    return Math.max(0, Math.min(score, 100));
  }

  /**
   * Calculate freshness score (prefer recent content)
   */
  private calculateFreshnessScore(result: WebSearchResult): number {
    if (!result.publishedDate) {
      return 50; // Unknown date gets neutral score
    }

    try {
      const pubDate = new Date(result.publishedDate);
      const now = new Date();
      const daysDiff =
        (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24);

      if (daysDiff <= 7) return 100; // Last week
      if (daysDiff <= 30) return 85; // Last month
      if (daysDiff <= 90) return 70; // Last quarter
      if (daysDiff <= 180) return 55; // Last 6 months
      if (daysDiff <= 365) return 40; // Last year
      return 25; // Older content
    } catch {
      return 50;
    }
  }

  /**
   * Calculate content depth score
   */
  private calculateDepthScore(result: WebSearchResult): number {
    const contentLength = (result.content || "").length;

    if (contentLength >= 400) return 100;
    if (contentLength >= 300) return 80;
    if (contentLength >= 200) return 60;
    if (contentLength >= 100) return 40;
    return 20;
  }

  /**
   * Apply diversity filter to ensure variety across domains
   * Limits results from same domain while maintaining top results
   */
  private applyDiversityFilter(
    results: WebSearchResult[],
    maxResults: number,
  ): WebSearchResult[] {
    const domainCounts = new Map<string, number>();
    const maxPerDomain = 2; // Maximum results from same domain
    const diverseResults: WebSearchResult[] = [];

    for (const result of results) {
      if (diverseResults.length >= maxResults) break;

      const domain = result.domain || "unknown";
      const currentCount = domainCounts.get(domain) || 0;

      if (currentCount < maxPerDomain) {
        diverseResults.push(result);
        domainCounts.set(domain, currentCount + 1);
      }
    }

    // If we don't have enough results, add more (allow duplicates)
    if (diverseResults.length < maxResults) {
      for (const result of results) {
        if (diverseResults.length >= maxResults) break;
        if (!diverseResults.includes(result)) {
          diverseResults.push(result);
        }
      }
    }

    return diverseResults;
  }

  /**
   * Search using Serper API (Google Search)
   * https://serper.dev/
   */
  private async searchWithSerper(
    query: string,
    apiKey: string,
    maxResults: number,
    since?: Date,
  ): Promise<WebSearchResponse> {
    this.logger.debug(`Searching with Serper: "${query}"`);

    // ★ Calculate time range for Google search (tbs parameter)
    let tbs: string | undefined;
    if (since) {
      const now = new Date();
      const diffMs = now.getTime() - since.getTime();
      const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      // Google tbs parameter: qdr:d (day), qdr:w (week), qdr:m (month), qdr:y (year)
      if (days <= 1) {
        tbs = "qdr:d";
      } else if (days <= 7) {
        tbs = "qdr:w";
      } else if (days <= 30) {
        tbs = "qdr:m";
      } else if (days <= 365) {
        tbs = "qdr:y";
      }
      // For longer periods, no tbs parameter (all time)
      this.logger.debug(`Serper: using time filter tbs=${tbs || "all time"}`);
    }

    const requestBody: Record<string, unknown> = {
      q: query,
      num: maxResults,
    };

    // ★ Add time range parameter if specified
    if (tbs) {
      requestBody.tbs = tbs;
    }

    const response = await firstValueFrom(
      this.httpService.post("https://google.serper.dev/search", requestBody, {
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }),
    );

    const results: WebSearchResult[] = (response.data.organic || []).map(
      (r: { title: string; link: string; snippet: string; date?: string }) => ({
        title: r.title,
        url: r.link,
        content: r.snippet,
        domain: this.extractDomain(r.link),
        // ★ Serper returns date in organic results
        publishedDate: r.date || undefined,
      }),
    );

    // ★ Apply ranking for consistency with other providers
    const rankedResults = this.rankSearchResults(results, query, maxResults);

    this.logger.debug(
      `Serper returned ${results.length} results, ranked to ${rankedResults.length}`,
    );
    return { success: true, results: rankedResults };
  }

  /**
   * Search using DuckDuckGo (no API key required)
   * ★ 2026-05-28 加反爬熔断：串行队列 + 最小间隔 + 命中 anomaly 后冷却跳过，
   *   避免 mission 并发搜索把 DDG 打到反爬后无限刷屏。
   */
  private async searchWithDuckduckgo(
    query: string,
    maxResults: number,
    since?: Date,
  ): Promise<WebSearchResponse> {
    // 串行化：把并发 DDG 请求排队，链尾接最小间隔，降低反爬触发概率。
    const run = this.ddgQueue.then(() =>
      this.executeDuckduckgo(query, maxResults, since),
    );
    this.ddgQueue = run.then(
      () => this.ddgSpacing(),
      () => this.ddgSpacing(),
    );
    return run;
  }

  /** DDG 串行间隔：冷却中直接放行（反正会快速跳过），否则隔开请求。 */
  private ddgSpacing(): Promise<void> {
    if (Date.now() < this.ddgCooldownUntil) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, DDG_MIN_SPACING_MS));
  }

  private async executeDuckduckgo(
    query: string,
    maxResults: number,
    since?: Date,
  ): Promise<WebSearchResponse> {
    // ★ 熔断：冷却窗口内直接快速失败，不再发请求刷屏。
    const cdNow = Date.now();
    if (cdNow < this.ddgCooldownUntil) {
      const remainSec = Math.ceil((this.ddgCooldownUntil - cdNow) / 1000);
      this.logger.warn(
        `[Search] DuckDuckGo in anti-bot cooldown ${remainSec}s — skipped`,
      );
      return {
        success: false,
        results: [],
        error: `DuckDuckGo in anti-bot cooldown for ${remainSec}s`,
      };
    }

    this.logger.debug(`Searching with DuckDuckGo: "${query}"`);

    try {
      // ★ Calculate time filter for DuckDuckGo
      let timeFilter: duckDuckScrape.SearchTimeType | undefined;
      if (since) {
        const now = new Date();
        const diffMs = now.getTime() - since.getTime();
        const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (days <= 1) {
          timeFilter = duckDuckScrape.SearchTimeType.DAY;
        } else if (days <= 7) {
          timeFilter = duckDuckScrape.SearchTimeType.WEEK;
        } else if (days <= 30) {
          timeFilter = duckDuckScrape.SearchTimeType.MONTH;
        } else if (days <= 365) {
          timeFilter = duckDuckScrape.SearchTimeType.YEAR;
        }
        this.logger.debug(
          `DuckDuckGo: using time filter ${timeFilter || "all time"}`,
        );
      }

      const searchOptions: duckDuckScrape.SearchOptions = {
        safeSearch: duckDuckScrape.SafeSearchType.MODERATE,
      };

      // ★ Add time filter if specified
      if (timeFilter) {
        searchOptions.time = timeFilter;
      }

      const searchResults = await duckDuckScrape.search(query, searchOptions);

      if (searchResults.noResults) {
        this.logger.debug("DuckDuckGo returned no results");
        return { success: true, results: [] };
      }

      const rawResults: WebSearchResult[] = searchResults.results
        .slice(0, maxResults * 2) // Get more for ranking
        .map((r) => ({
          title: r.title,
          url: r.url,
          content: r.description || r.rawDescription || "",
          domain: r.hostname,
        }));

      // Apply ranking algorithm
      const rankedResults = this.rankSearchResults(
        rawResults,
        query,
        maxResults,
      );

      this.logger.debug(
        `DuckDuckGo returned ${searchResults.results.length} results, ranked to ${rankedResults.length}`,
      );
      return { success: true, results: rankedResults };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const msg = err.message || String(error);
      // ★ 反爬/限流 → 进入冷却，停止继续打 DDG。
      if (/anomaly|too quickly|rate.?limit|\b429\b/i.test(msg)) {
        this.ddgCooldownUntil = Date.now() + DDG_COOLDOWN_MS;
        this.logger.warn(
          `[Search] DuckDuckGo anti-bot detected → cooldown ${DDG_COOLDOWN_MS / 1000}s (后续搜索将跳过 DDG)`,
        );
      }
      this.logger.error(`DuckDuckGo search failed: ${msg}`);
      return {
        success: false,
        results: [],
        error: `DuckDuckGo search failed: ${msg}`,
      };
    }
  }

  /**
   * Format search results for AI context injection
   */
  formatResultsForContext(results: WebSearchResult[]): string {
    if (results.length === 0) return "";

    const formatted = results
      .map(
        (r, i) => `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.content}`,
      )
      .join("\n\n");

    return `## Web Search Results\nRecent information from the web:\n\n${formatted}`;
  }

  /**
   * Extract URLs from text content
   */
  extractUrls(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
    const matches = text.match(urlRegex) || [];
    // Remove trailing punctuation that might be captured
    return matches.map((url) => url.replace(/[.,;:!?)]+$/, ""));
  }

  /**
   * Fetch content from a URL and extract main text
   * ★ 超时优化：普通页面 30s，PDF/大文件 45s
   */
  async fetchUrlContent(url: string): Promise<{
    success: boolean;
    title?: string;
    content?: string;
    html?: string;
    error?: string;
  }> {
    try {
      this.logger.debug(`Fetching URL content: ${url}`);

      // ★ 跳过 PDF URL：PDF 文件通常超过 5MB 限制，下载后也会被截断到 3000 字符
      // 使用搜索引擎返回的 snippet 即可，避免浪费请求时间和错误日志噪音
      const lowerUrl = url.toLowerCase();
      if (
        lowerUrl.endsWith(".pdf") ||
        lowerUrl.includes("/pdf/") ||
        lowerUrl.includes(".pdf?")
      ) {
        this.logger.debug(`Skipping PDF URL (use snippet instead): ${url}`);
        return {
          success: false,
          error: "PDF skipped — using snippet",
        };
      }

      // ★ 大文件使用更长的超时时间
      const isLargeFile = lowerUrl.includes(".gov/"); // 政府网站通常较慢
      const timeout = isLargeFile ? 45000 : 30000;

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            Connection: "keep-alive",
            "Cache-Control": "max-age=0",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
          },
          timeout,
          // 2026-06-07：3→5。nature.com 等多级重定向（http→https→规范化→区域）
          //   在 3 跳下报 "Maximum number of redirects exceeded"，整页抓取失败 →
          //   researcher 拿不到正文只能退回 snippet。5 跳覆盖常见重定向链，仍防环。
          maxRedirects: 5,
          // ★ 2026-05-04 修：50MB 在 anthropic llms-full.txt（80MB+）/ 其他
          //   超大 docs 仍触发 "maxContentLength size of 52428800 exceeded"。
          //   提到 200MB 覆盖典型大文档；下游 extractMainContent 会截到 markdown
          //   合理大小，OOM 风险不变。
          maxContentLength: 200 * 1024 * 1024,
          maxBodyLength: 200 * 1024 * 1024,
          decompress: true,
        }),
      );

      let html = response.data;
      if (!html || typeof html !== "string") {
        return { success: false, error: "No HTML content received" };
      }
      // ★ 2026-05-04 截断兜底：响应超 10MB 截到前 10MB
      //   axios maxContentLength=200MB 防"超限抛错"，这里再砍到 10MB 防
      //   extractMainContent 跑正则在大字符串上 OOM + 复制双倍内存峰值。
      //   anthropic llms-full.txt (80MB) → 截到 10MB 仍是几千 KB 的有效文档前缀。
      const HTML_TRUNCATE_BYTES = 10 * 1024 * 1024;
      if (html.length > HTML_TRUNCATE_BYTES) {
        this.logger.warn(
          `[fetchUrlContent] truncating ${url}: ${html.length} → ${HTML_TRUNCATE_BYTES} bytes (large doc)`,
        );
        html = html.substring(0, HTML_TRUNCATE_BYTES);
      }

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : url;

      // Extract main content - remove scripts, styles, and HTML tags
      let content = html
        // Remove script tags and content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        // Remove style tags and content
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        // Remove HTML comments
        .replace(/<!--[\s\S]*?-->/g, "")
        // Remove all HTML tags
        .replace(/<[^>]+>/g, " ")
        // Decode HTML entities
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // Normalize whitespace
        .replace(/\s+/g, " ")
        .trim();

      // Limit content length for AI context
      // CRITICAL FIX: Reduced from 8000 to 3000 to prevent context overflow
      if (content.length > 3000) {
        content = content.substring(0, 3000) + "...";
      }

      // ★ 保留去除 script/style 但保留 HTML 标签的版本，用于图片提取
      // 截断到 200KB 防止内存压力（图片标签通常在页面前半部分）
      const MAX_HTML_FOR_FIGURES = 200 * 1024;
      const htmlForFigures = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .substring(0, MAX_HTML_FOR_FIGURES);

      this.logger.debug(
        `Fetched URL content: ${title} (${content.length} chars)`,
      );

      return { success: true, title, content, html: htmlForFigures };
    } catch (error: unknown) {
      const err = error as {
        response?: { status?: number; statusText?: string };
        message?: string;
      };
      const statusCode = err.response?.status;
      const errorMessage = statusCode
        ? `HTTP ${statusCode}: ${err.response?.statusText || ""}`
        : err.message || String(error);
      // ★ 403/404/451 are expected for bot-blocked or missing pages — debug level
      // Other errors (network, 5xx) get warn level
      const isExpected =
        statusCode === 403 || statusCode === 404 || statusCode === 451;
      this.logger[isExpected ? "debug" : "warn"](
        `Failed to fetch URL ${url}: ${errorMessage}`,
      );
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Fetch multiple URLs and format for AI context
   */
  async fetchUrlsForContext(urls: string[]): Promise<string> {
    if (urls.length === 0) return "";

    const results: string[] = [];

    // Limit to 3 URLs to avoid context overflow
    const urlsToFetch = urls.slice(0, 3);

    for (const url of urlsToFetch) {
      const result = await this.fetchUrlContent(url);
      if (result.success && result.content) {
        results.push(
          `### ${result.title || url}\nURL: ${url}\n\n${result.content}`,
        );
      }
    }

    if (results.length === 0) return "";

    return `## Fetched Web Page Content\nThe following content was fetched from URLs mentioned in the conversation:\n\n${results.join("\n\n---\n\n")}`;
  }
}
