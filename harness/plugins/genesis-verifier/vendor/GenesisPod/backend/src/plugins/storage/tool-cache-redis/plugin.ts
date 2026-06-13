/**
 * tool-cache-redis plugin 实现（v5.1 R0.5 PR-8）
 *
 * 设计要点：
 * - TOOL_BEFORE: 算 cacheKey → 查 redis → 命中则 ctx.abort('cache-hit', cached)
 * - TOOL_AFTER: cacheHit=false + result.success → 写入 redis（异步 fire-and-forget）
 * - cache key 含 toolId + input hash + missionId（业务无关 namespace）
 * - HIGH-3: abort 携带 cached payload，由 ToolPipeline 在 abort 路径仍 fire TOOL_AFTER
 *   让 billing/audit/telemetry 能记录 cache-hit 事件
 * - 异常吞掉防止 redis outage 影响主流程（cache fail-open）
 */
import * as crypto from "crypto";
import type {
  IPlugin,
  IPluginContext,
  HookHandler,
  PluginHealth,
  ToolBeforePayload,
  ToolAfterPayload,
} from "@/plugins/core/abstractions";
import { CORE_HOOKS } from "@/plugins/core/abstractions";
import { TOOL_CACHE_REDIS_MANIFEST } from "./manifest";
import {
  type IRedisClient,
  InMemoryRedisClient,
} from "./redis-client.interface";

export interface ToolCacheRedisConfig {
  /** TTL 秒，默认 3600（1h） */
  readonly ttl?: number;
  /** key 前缀；plugin-core 已经强制加 plugin:<id>: 前缀，这里再加一层语义前缀 */
  readonly keyPrefix?: string;
  /** 哪些 toolId 启用缓存（白名单；空数组=全部）*/
  readonly enabledToolIds?: ReadonlyArray<string>;
}

export class ToolCacheRedisPlugin implements IPlugin<ToolCacheRedisConfig> {
  readonly manifest = TOOL_CACHE_REDIS_MANIFEST;

  private redis: IRedisClient;
  private ttl = 3600;
  private keyPrefix = "tool-cache";
  private enabledToolIds: ReadonlySet<string> | null = null;
  private logger?: IPluginContext["logger"];

  /** 构造期可注入 redis（spec 用 InMemoryRedisClient；生产 init 时通过 getService）*/
  constructor(redis?: IRedisClient) {
    this.redis = redis ?? new InMemoryRedisClient();
  }

  setRedisClient(redis: IRedisClient): void {
    this.redis = redis;
  }

  async init(ctx: IPluginContext, config: ToolCacheRedisConfig): Promise<void> {
    this.logger = ctx.logger;
    this.ttl = config.ttl ?? 3600;
    this.keyPrefix = config.keyPrefix ?? "tool-cache";
    this.enabledToolIds =
      config.enabledToolIds && config.enabledToolIds.length > 0
        ? new Set(config.enabledToolIds)
        : null;

    ctx.hooks.register(CORE_HOOKS.TOOL_BEFORE, this.onToolBefore, {
      priority: 100, // 高 priority：在 telemetry 之前处理 cache 命中
    });
    ctx.hooks.register(CORE_HOOKS.TOOL_AFTER, this.onToolAfter);
  }

  async healthCheck(): Promise<PluginHealth> {
    try {
      const probeKey = `${this.keyPrefix}:__health__`;
      await this.redis.set(probeKey, "1", 5);
      const v = await this.redis.get(probeKey);
      return v === "1"
        ? { status: "healthy" }
        : { status: "degraded", message: "redis read mismatch" };
    } catch (err) {
      return {
        status: "unhealthy",
        message: err instanceof Error ? err.message : "redis probe failed",
      };
    }
  }

  // ── hook handlers ──

  private onToolBefore: HookHandler<ToolBeforePayload> = async (ctx) => {
    const toolId = this.extractToolId(ctx.payload);
    if (!this.shouldCache(toolId)) {
      return ctx.next();
    }

    const key = this.buildKey(ctx.payload);
    let cached: string | null;
    try {
      cached = await this.redis.get(key);
    } catch (err) {
      // fail-open: redis outage 不阻塞 tool 调用
      this.logger?.warn(`[tool-cache-redis] redis.get failed: ${String(err)}`);
      return ctx.next();
    }

    if (cached === null) {
      return ctx.next();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(cached);
    } catch {
      // 损坏 entry：删除 + miss
      await this.redis.del(key).catch(() => undefined);
      return ctx.next();
    }

    // HIGH-3: abort 短路，由 ToolPipeline 在 abort 分支 fire TOOL_AFTER (cacheHit=true)
    return ctx.abort("cache-hit", parsed);
  };

  private onToolAfter: HookHandler<ToolAfterPayload> = async (ctx) => {
    const payload = ctx.payload;
    if (payload.cacheHit) {
      // 已经是缓存命中，不需要再写入
      return ctx.next();
    }
    if (payload.abortReason && payload.abortReason !== "cache-hit") {
      // rate-limited / timeout 等其他 abort 不写入缓存
      return ctx.next();
    }

    const toolId = this.extractToolId(payload);
    if (!this.shouldCache(toolId)) {
      return ctx.next();
    }
    const result = payload.result as { success?: boolean } | null | undefined;
    if (!result || result.success !== true) {
      // 失败结果不缓存
      return ctx.next();
    }

    const key = this.buildKey(payload);
    try {
      await this.redis.set(key, JSON.stringify(payload.result), this.ttl);
    } catch (err) {
      this.logger?.warn(`[tool-cache-redis] redis.set failed: ${String(err)}`);
      // fail-open
    }
    return ctx.next();
  };

  // ── helpers ──

  /** key 形态：<prefix>:<missionId>:<toolId>:<input-hash>，全部业务无关 */
  private buildKey(payload: ToolBeforePayload | ToolAfterPayload): string {
    const callTyped = payload.call as
      | { toolId?: string; input?: unknown }
      | undefined;
    const toolId = callTyped?.toolId ?? "_";
    const missionId = payload.meta.missionId ?? "_";
    const inputHash = this.hashInput(callTyped?.input);
    return `${this.keyPrefix}:${missionId}:${toolId}:${inputHash}`;
  }

  /** SHA-1 input hash（avoid huge cache keys for big inputs）*/
  private hashInput(input: unknown): string {
    try {
      const json = JSON.stringify(input ?? null);
      return crypto.createHash("sha1").update(json).digest("hex").slice(0, 16);
    } catch {
      return "unhashable";
    }
  }

  private extractToolId(payload: ToolBeforePayload | ToolAfterPayload): string {
    const callTyped = payload.call as { toolId?: string } | undefined;
    return callTyped?.toolId ?? "unknown";
  }

  private shouldCache(toolId: string): boolean {
    if (!this.enabledToolIds) return true;
    return this.enabledToolIds.has(toolId);
  }
}
