import { Injectable, Logger, Optional } from "@nestjs/common";
import { CacheService } from "@/common/cache";
import { ClassifiedError } from "./key-error-classifier";
import { KEY_COOLDOWN_MS } from "./key-cooldown-policy";

/**
 * KeyHealthStore — per-key 健康状态 + LastGood 粘性 + provider 级 cooldown，全部 Redis-backed。
 *
 * 单 source-of-truth：
 * - 不接 DB（DB 镜像由 PR-6 加 healthState 列时同步）；本层是 Redis 唯一权威源，重启后从 Redis 重建
 * - 跨 pod 一致：CacheService 走 nestjs cache-manager，prod 用 Redis backend
 *
 * 三类 Redis key（namespace 隔离）：
 *   keyhealth:{keyId}                       JSON {state, cooldownUntil, failureCount, ...}
 *   keyhealth:lastgood:{userId}:{provider}  string (keyId)             TTL 7d
 *   keyhealth:provider:cooldown:{provider}  "1"                        TTL classified.cooldownMs
 *
 * 启发式：30s 窗口内 >=2 个不同 key 在同一 provider 收到 429，升级为 provider-级 cooldown。
 *   实现：每次 markFailure(RATE_LIMIT_KEY) 写一条 `keyhealth:rate-window:{provider}:{keyId}` TTL 30s，
 *   然后用 delByPrefix 数前缀长度。计数 >=2 触发 setProviderCooldown。
 */

export type KeyHealthState = "HEALTHY" | "COOLDOWN" | "DEAD";

export interface KeyHealthRecord {
  readonly state: KeyHealthState;
  /** state=COOLDOWN 时设置；HEALTHY/DEAD 时 0。Number.MAX_SAFE_INTEGER = 永久（DEAD 才用） */
  readonly cooldownUntil: number;
  /** 连续失败次数；markSuccess 重置为 0 */
  readonly failureCount: number;
  /** 末次失败时间戳（ms） */
  readonly lastFailureAt: number | null;
  /** 末次成功时间戳（ms） */
  readonly lastSuccessAt: number | null;
  /** 末次失败原因（用于 UI 展示） */
  readonly lastReason: string | null;
  /**
   * 连续 AUTH_FAILED 次数。非-auth 失败或 markSuccess 重置为 0。
   * 用于"偶发 401 不立即 DEAD"：网关瞬时故障会偶发回 401，但 key 实际有效，
   * 需累计到 AUTH_DEAD_THRESHOLD 次才真正标 DEAD。旧记录无此字段 → 视为 0。
   */
  readonly authFailureCount?: number;
}

const KEY_HEALTH_PREFIX = "keyhealth:";
const LASTGOOD_PREFIX = "keyhealth:lastgood:";
const PROVIDER_COOLDOWN_PREFIX = "keyhealth:provider:cooldown:";
const RATE_WINDOW_PREFIX = "keyhealth:rate-window:";

const LASTGOOD_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const RATE_WINDOW_TTL_SECONDS = 30; // 30s 滑窗
const RATE_WINDOW_THRESHOLD = 2; // ≥2 个 key → 升级为 provider 级
const PROVIDER_COOLDOWN_DEFAULT_SECONDS = 5 * 60; // 5 min

/**
 * 连续 AUTH_FAILED 达到此次数才把 key 标 DEAD（防 provider 网关偶发 401 误杀有效 key）。
 * 单次 401 仅给短熔断，且能被 single-key degraded fallback 兜底。
 */
const AUTH_DEAD_THRESHOLD = 3;
/** 单次/少量 AUTH_FAILED 的临时熔断时长——分钟级自愈，可被 degraded fallback 兜底。 */
const AUTH_TRANSIENT_COOLDOWN_MS = KEY_COOLDOWN_MS.RATE_LIMIT; // 60s

/**
 * KeyId 解析结果，用于 markSuccess 时反查 (userId, provider) 来设置 LastGood。
 *   personal:{userId}:{provider}:{label}
 *   assigned:{assignmentId}                 → 不带 userId/provider，需要 caller 主动传
 *   system:{secretName}                     → 不带 userId
 */
export interface ParsedKeyId {
  readonly type: "personal" | "assigned" | "system";
  readonly userId?: string;
  readonly provider?: string;
  readonly label?: string;
  readonly assignmentId?: string;
  readonly secretName?: string;
}

export function parseKeyId(keyId: string): ParsedKeyId | null {
  const segments = keyId.split(":");
  if (segments.length < 2) return null;
  const [type, ...rest] = segments;
  switch (type) {
    case "personal":
      if (rest.length < 3) return null;
      return {
        type: "personal",
        userId: rest[0],
        provider: rest[1],
        label: rest.slice(2).join(":"),
      };
    case "assigned":
      return { type: "assigned", assignmentId: rest.join(":") };
    case "system":
      return { type: "system", secretName: rest.join(":") };
    default:
      return null;
  }
}

export function buildPersonalKeyId(
  userId: string,
  provider: string,
  label: string,
): string {
  return `personal:${userId}:${provider.toLowerCase()}:${label.toLowerCase()}`;
}

export function buildAssignedKeyId(assignmentId: string): string {
  return `assigned:${assignmentId}`;
}

export function buildSystemKeyId(secretName: string): string {
  return `system:${secretName}`;
}

/**
 * 从 cooldown 中的 key 里挑出最早恢复的那个，作为 filterUsable 的 degraded
 * fallback。
 *
 * 排除：DEAD（永久不可用）+ cooldownUntil = MAX_SAFE_INTEGER（QUOTA_EXCEEDED
 * 等永久 cooldown，retry 也是浪费）。
 */
function pickEarliestFiniteCooldown(
  keyIds: string[],
  records: (KeyHealthRecord | null | undefined)[],
): string | null {
  let bestId: string | null = null;
  let bestExpiry = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < keyIds.length; i++) {
    const rec = records[i];
    if (!rec) continue;
    if (rec.state !== "COOLDOWN") continue;
    if (rec.cooldownUntil >= Number.MAX_SAFE_INTEGER) continue;
    if (rec.cooldownUntil < bestExpiry) {
      bestExpiry = rec.cooldownUntil;
      bestId = keyIds[i];
    }
  }
  return bestId;
}

@Injectable()
export class KeyHealthStore {
  private readonly logger = new Logger(KeyHealthStore.name);

  constructor(@Optional() private readonly cache?: CacheService) {}

  // ─────────────────────────── 核心健康操作 ───────────────────────────

  /**
   * 批量过滤出当前可用的 keyId（HEALTHY 或 COOLDOWN-已过期）。
   * 顺序保留输入顺序，方便上层做 LastGood 提升。
   *
   * ★ 2026-05-13 (P0-#2 fix): 当全部 key 都在 finite cooldown 时，退一步返回
   * cooldownUntil 最早结束的那个作为 degraded fallback。否则单 key BYOK 用户
   * 任何一次偶发 TIMEOUT（30s cooldown）/ RATE_LIMIT（60s） 都会让整个 cooldown
   * 窗口里所有调用直接 throw NoAvailableKeyError，多个 mission 并发时雪崩。
   *
   * 排除：DEAD（auth 失败永远不行）和 cooldownUntil = MAX_SAFE_INTEGER（QUOTA_EXCEEDED
   * 等永久 cooldown，账单恢复才能用，retry 也是浪费）。
   */
  async filterUsable(keyIds: string[]): Promise<string[]> {
    if (!this.cache || keyIds.length === 0) return [...keyIds];
    const now = Date.now();
    const records = await Promise.all(
      keyIds.map((id) =>
        this.cache!.get<KeyHealthRecord>(`${KEY_HEALTH_PREFIX}${id}`),
      ),
    );
    const usable: string[] = [];
    for (let i = 0; i < keyIds.length; i++) {
      const rec = records[i];
      if (!rec) {
        usable.push(keyIds[i]);
        continue;
      }
      if (rec.state === "DEAD") continue;
      if (rec.state === "COOLDOWN" && rec.cooldownUntil > now) continue;
      usable.push(keyIds[i]);
    }
    if (usable.length === 0) {
      const fallbackId = pickEarliestFiniteCooldown(keyIds, records);
      if (fallbackId) {
        this.logger.warn(
          `[filterUsable] all ${keyIds.length} key(s) in cooldown; returning earliest-expiry key as degraded fallback (avoid single-key user lockout)`,
        );
        return [fallbackId];
      }
      // ★ 2026-06-02 单 key 用户最后兜底：唯一一把 key 升级为 DEAD（连续 auth 失败）时，
      //   仍作为 last-resort 返回，避免无备用 key 的用户被一串 401 彻底锁死。配合 Fix1
      //   （偶发 401 不立即 DEAD），真正走到这里的多是"反复 401"——给一次重试机会，若仍
      //   失败上层会再 markFailure，不比硬锁死 30 天更糟。QUOTA/billing 永久熔断（state
      //   仍是 COOLDOWN，非 DEAD）不在此列：retry 必然再失败、只会空烧调用。
      if (keyIds.length === 1) {
        const only = records[0];
        if (only && only.state === "DEAD") {
          this.logger.warn(
            `[filterUsable] single key is DEAD; returning it as last-resort fallback (no alternative key for this user/provider — auth failure may be transient, see Test Connection)`,
          );
          return [keyIds[0]];
        }
      }
    }
    return usable;
  }

  /** 获取单 key 当前健康记录（无记录视为 HEALTHY） */
  async get(keyId: string): Promise<KeyHealthRecord> {
    if (!this.cache) return this.defaultRecord();
    const rec = await this.cache.get<KeyHealthRecord>(
      `${KEY_HEALTH_PREFIX}${keyId}`,
    );
    return rec ?? this.defaultRecord();
  }

  /**
   * 标记一次失败，按 ClassifiedError 决定状态机走向。
   * provider 参数仅用于 RATE_LIMIT_KEY 的 account-wide 启发式（30s 内多 key 429 → 升级）。
   */
  async markFailure(
    keyId: string,
    classified: ClassifiedError,
    provider?: string,
  ): Promise<void> {
    if (!this.cache) return;
    const now = Date.now();
    const prev = await this.get(keyId);

    // ★ 2026-06-02 防偶发 401 误杀有效 key：provider 网关在大上下文/瞬时故障下会偶发
    //   回 401（key 实际有效，可用 Test Connection 复验），单次就永久 DEAD 会把无备用
    //   key 的用户锁死 30 天。改为：连续 AUTH_FAILED 累计到 AUTH_DEAD_THRESHOLD 才真正
    //   标 DEAD；其余次只给短熔断（可被 single-key degraded fallback 兜底）。
    //   非 AUTH 的 markDead（当前无）仍按原语义立即 DEAD。
    const isAuth = classified.reason === "AUTH_FAILED";
    const nextAuthFailureCount = isAuth ? (prev.authFailureCount ?? 0) + 1 : 0;
    const escalateDead =
      classified.markDead &&
      (!isAuth || nextAuthFailureCount >= AUTH_DEAD_THRESHOLD);
    const effectiveCooldownMs =
      classified.markDead && isAuth && !escalateDead
        ? AUTH_TRANSIENT_COOLDOWN_MS
        : classified.cooldownMs;

    const next: KeyHealthRecord = {
      state: escalateDead
        ? "DEAD"
        : effectiveCooldownMs > 0
          ? "COOLDOWN"
          : "HEALTHY",
      cooldownUntil: escalateDead
        ? Number.MAX_SAFE_INTEGER
        : effectiveCooldownMs === Number.POSITIVE_INFINITY
          ? Number.MAX_SAFE_INTEGER
          : effectiveCooldownMs > 0
            ? now + effectiveCooldownMs
            : 0,
      failureCount: prev.failureCount + 1,
      authFailureCount: nextAuthFailureCount,
      lastFailureAt: now,
      lastSuccessAt: prev.lastSuccessAt,
      lastReason: classified.reason,
    };
    await this.cache.set(
      `${KEY_HEALTH_PREFIX}${keyId}`,
      next,
      this.persistTtlSeconds(next),
    );

    // Account-wide 429 启发式
    if (provider && classified.reason === "RATE_LIMIT_KEY") {
      await this.recordRateWindow(provider, keyId);
    }

    // 失效的 key 如果是 LastGood，清理掉——仅在真正升级为 DEAD 时（偶发 401 暂 COOLDOWN 不动）
    if (escalateDead) {
      const parsed = parseKeyId(keyId);
      if (parsed?.userId && parsed.provider) {
        const last = await this.getLastGood(parsed.userId, parsed.provider);
        if (last === keyId) {
          await this.clearLastGood(parsed.userId, parsed.provider);
        }
      }
    }
  }

  /** 标记成功：状态回 HEALTHY + 更新 lastSuccessAt + setLastGood（如能解析出 user/provider） */
  async markSuccess(
    keyId: string,
    providerHint?: string,
    userIdHint?: string,
  ): Promise<void> {
    if (!this.cache) return;
    const now = Date.now();
    const next: KeyHealthRecord = {
      state: "HEALTHY",
      cooldownUntil: 0,
      failureCount: 0,
      authFailureCount: 0,
      lastFailureAt: null,
      lastSuccessAt: now,
      lastReason: null,
    };
    await this.cache.set(
      `${KEY_HEALTH_PREFIX}${keyId}`,
      next,
      this.persistTtlSeconds(next),
    );

    // setLastGood：personal 可从 keyId 自解析，assigned/system 需 hint
    const parsed = parseKeyId(keyId);
    const userId = userIdHint ?? parsed?.userId;
    const provider = providerHint ?? parsed?.provider;
    if (userId && provider) {
      await this.setLastGood(userId, provider, keyId);
    }
  }

  /** Admin override：手动把 key 拉回 HEALTHY（用于 BYOK UI "Test Connection" 成功后） */
  async forceHealthy(keyId: string): Promise<void> {
    await this.markSuccess(keyId);
  }

  /** key 被删除时调用，彻底清状态 */
  async delete(keyId: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.del(`${KEY_HEALTH_PREFIX}${keyId}`);
  }

  // ─────────────────────────── LastGood 粘性 ───────────────────────────

  async getLastGood(userId: string, provider: string): Promise<string | null> {
    if (!this.cache) return null;
    const v = await this.cache.get<string>(this.lastGoodKey(userId, provider));
    return v ?? null;
  }

  async setLastGood(
    userId: string,
    provider: string,
    keyId: string,
  ): Promise<void> {
    if (!this.cache) return;
    await this.cache.set(
      this.lastGoodKey(userId, provider),
      keyId,
      LASTGOOD_TTL_SECONDS,
    );
  }

  async clearLastGood(userId: string, provider: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.del(this.lastGoodKey(userId, provider));
  }

  // ─────────────────────────── Provider-级 cooldown ───────────────────────────

  async isProviderCooldown(provider: string): Promise<boolean> {
    if (!this.cache) return false;
    const v = await this.cache.get<string>(this.providerCooldownKey(provider));
    return v !== undefined && v !== null;
  }

  /**
   * 距 provider cooldown 解除的剩余毫秒数（0 = 无 cooldown）。
   * value 存绝对到期时间戳，免去 Redis TTL 反查。兼容旧 "1" 值（按默认时长处理）。
   */
  async getProviderCooldownMs(provider: string): Promise<number> {
    if (!this.cache) return 0;
    const v = await this.cache.get<string>(this.providerCooldownKey(provider));
    if (v === undefined || v === null) return 0;
    const expiryMs = Number(v);
    if (!Number.isFinite(expiryMs)) {
      // 旧格式 "1"：无到期时间戳，保守按默认 cooldown 时长返回。
      return PROVIDER_COOLDOWN_DEFAULT_SECONDS * 1000;
    }
    return Math.max(0, expiryMs - Date.now());
  }

  async setProviderCooldown(
    provider: string,
    cooldownMs: number,
  ): Promise<void> {
    if (!this.cache) return;
    const effectiveMs =
      cooldownMs > 0 && Number.isFinite(cooldownMs)
        ? cooldownMs
        : PROVIDER_COOLDOWN_DEFAULT_SECONDS * 1000;
    const ttl = Math.max(1, Math.ceil(effectiveMs / 1000));
    await this.cache.set(
      this.providerCooldownKey(provider),
      String(Date.now() + effectiveMs),
      ttl,
    );
  }

  async clearProviderCooldown(provider: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.del(this.providerCooldownKey(provider));
  }

  // ─────────────────────────── 内部 ───────────────────────────

  private defaultRecord(): KeyHealthRecord {
    return {
      state: "HEALTHY",
      cooldownUntil: 0,
      failureCount: 0,
      authFailureCount: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      lastReason: null,
    };
  }

  /**
   * key 健康记录的 Redis TTL：
   *   HEALTHY: 7d（避免无活跃 user 长期占用）
   *   COOLDOWN: cooldownUntil + buffer
   *   DEAD: 永久（直到 user 手动 re-test 才 markSuccess）
   *     —— TTL 实现上给 30d，避免 key 已删但 store 还残留
   */
  private persistTtlSeconds(rec: KeyHealthRecord): number {
    if (rec.state === "DEAD") return 30 * 24 * 60 * 60;
    if (rec.state === "COOLDOWN") {
      const remainMs = rec.cooldownUntil - Date.now();
      return Math.max(60, Math.ceil(remainMs / 1000) + 60);
    }
    return 7 * 24 * 60 * 60;
  }

  private lastGoodKey(userId: string, provider: string): string {
    return `${LASTGOOD_PREFIX}${userId}:${provider.toLowerCase()}`;
  }

  private providerCooldownKey(provider: string): string {
    return `${PROVIDER_COOLDOWN_PREFIX}${provider.toLowerCase()}`;
  }

  private async recordRateWindow(
    provider: string,
    keyId: string,
  ): Promise<void> {
    if (!this.cache) return;
    const slotKey = `${RATE_WINDOW_PREFIX}${provider.toLowerCase()}:${keyId}`;
    await this.cache.set(slotKey, "1", RATE_WINDOW_TTL_SECONDS);

    // 数 30s 内同 provider 命中数（用 delByPrefix 借底层 keys 接口）
    // CacheService.delByPrefix 内部用 store.keys；我们要的是 count，所以另写一个轻量方法
    const count = await this.countRateWindowSlots(provider);
    if (count >= RATE_WINDOW_THRESHOLD) {
      this.logger.warn(
        `[KeyHealthStore] account-wide 429 detected for ${provider} (${count} keys hit in 30s) → setProviderCooldown 5min`,
      );
      await this.setProviderCooldown(
        provider,
        PROVIDER_COOLDOWN_DEFAULT_SECONDS * 1000,
      );
    }
  }

  /** 借 CacheService 内部 store.keys 实现 prefix-count；失败降级返回 1（保守） */
  private async countRateWindowSlots(provider: string): Promise<number> {
    if (!this.cache) return 0;
    try {
      const cacheManager = this.cache as unknown as {
        cacheManager?: {
          stores?: Array<{ keys?: (pattern: string) => Promise<string[]> }>;
          store?: { keys?: (pattern: string) => Promise<string[]> };
        };
      };
      const internal = cacheManager.cacheManager;
      const store = internal?.stores?.[0] || internal?.store;
      if (!store?.keys) return 1;
      const keys = await store.keys(
        `${RATE_WINDOW_PREFIX}${provider.toLowerCase()}:*`,
      );
      return keys?.length ?? 0;
    } catch {
      return 1;
    }
  }
}
