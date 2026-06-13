/**
 * RateLimitService — ai-engine 核心限速服务（v5.1 R0.5-E 重新归位）
 *
 * 历史：原作为 plugins/resilience/rate-limit；2026-05-04 修正分类后回归 engine
 * （token-bucket 算法标准实现，非可换 backend，不该做成 plugin）。
 *
 * 维度（业务无关）：
 *   - global：所有 LLM/Tool 调用共享 quota
 *   - per-tenant：按 meta.tenantId 分组
 *   - per-agent-type：按 meta.agentType 分组（agent 类型标签）
 *
 * 用法（直接注入）：
 *   constructor(private rateLimit: RateLimitService) {}
 *   const ok = await rateLimit.checkAndConsume("llm", { tenantId, agentType });
 *   if (!ok.allowed) throw new RateLimitedError(ok.scope, ok.retryAfterMs);
 *
 * 接入 ToolPipeline middleware：见 rate-limit.middleware.ts
 */
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from "@nestjs/common";
import { CacheService } from "@/common/cache/cache.service";
import {
  type ITokenBucketStore,
  InMemoryTokenBucketStore,
  RedisTokenBucketStore,
} from "@/modules/platform/resilience";

export interface RateLimitConfig {
  /** 全局 RPM（默认 600 req/min = 10 rps） */
  readonly globalRpm?: number;
  /** 每租户 RPM（默认 60 req/min） */
  readonly perTenantRpm?: number;
  /** 按 agentType 限流（业务无关标签） */
  readonly perAgentTypeRpm?: Readonly<Record<string, number>>;
  /** 默认 agentType 限流（未在 perAgentTypeRpm 列出的） */
  readonly defaultAgentTypeRpm?: number;
}

export interface RateLimitCheckResult {
  readonly allowed: boolean;
  readonly scope?: "global" | "tenant" | "agentType";
  readonly retryAfterMs?: number;
  /** 仅在 scope=tenant 时填 */
  readonly tenantId?: string;
  /** 仅在 scope=agentType 时填 */
  readonly agentType?: string;
}

const DEFAULT_PER_TENANT_RPM = 60;

@Injectable()
export class RateLimitService implements OnModuleInit {
  private readonly logger = new Logger(RateLimitService.name);
  private store: ITokenBucketStore = new InMemoryTokenBucketStore();
  private storeExplicitlySet = false;
  // M6 fix：global 桶默认**关闭**（undefined）。旧 RateLimiter 无 global tier；
  // 默认开 600 RPM 共享桶会噪声邻居（聚合超限时全租户一起被拒）。仅 configure()
  // 显式给 globalRpm 才启用。
  private globalRpm: number | undefined = undefined;
  private perTenantRpm = DEFAULT_PER_TENANT_RPM;
  private perAgentTypeRpm: Record<string, number> = {};
  private defaultAgentTypeRpm: number | undefined;

  constructor(
    // H1 fix：注入 Redis CacheService（reliability.module 已 imports CacheModule）。
    // 无 cache（如纯单测 new RateLimitService()）→ 保持 InMemory。
    @Optional() @Inject(CacheService) private readonly cache?: CacheService,
  ) {}

  onModuleInit(): void {
    // H1 fix：生产默认走 Redis-backed store（多 pod 一致），除非调用方已显式
    // setStore（如测试注入 InMemory）。原先永远 InMemory → 每副本各算一份 quota。
    if (this.cache && !this.storeExplicitlySet) {
      this.store = new RedisTokenBucketStore(this.cache);
      this.logger.log(
        "[RateLimit] using Redis-backed token bucket (multi-pod consistent)",
      );
    }
  }

  /** 启动期或运行期注入自定义 store（测试用 InMemory，或显式覆盖默认 Redis） */
  setStore(store: ITokenBucketStore): void {
    this.store = store;
    this.storeExplicitlySet = true;
  }

  /** retryAfter：按该 tier 的 RPM 折算补 1 个 token 所需毫秒（不再硬编 1000ms） */
  private retryMs(rpm: number): number {
    return Math.ceil(60_000 / Math.max(1, rpm));
  }

  configure(config: RateLimitConfig): void {
    // globalRpm 不给 = 保持关闭（opt-in，见字段注释）；给了才启用 global tier
    this.globalRpm = config.globalRpm;
    this.perTenantRpm = config.perTenantRpm ?? DEFAULT_PER_TENANT_RPM;
    this.perAgentTypeRpm = { ...(config.perAgentTypeRpm ?? {}) };
    this.defaultAgentTypeRpm = config.defaultAgentTypeRpm;
  }

  /**
   * 三维度检查并消耗 quota（任一超限即拒）。
   *
   * @param domain  业务无关分类（"llm" / "tool" / "embedding" 等）
   * @param keys    分组键
   * @returns       allowed=false 时携带 scope + retryAfterMs
   */
  async checkAndConsume(
    domain: string,
    keys: { tenantId?: string; agentType?: string },
  ): Promise<RateLimitCheckResult> {
    // ① global（M6：仅在显式启用时生效，默认关闭，避免噪声邻居）
    if (this.globalRpm !== undefined && this.globalRpm > 0) {
      const globalRefill = this.globalRpm / 60;
      const ok1 = await this.store
        .tryConsume(`global:${domain}`, this.globalRpm, globalRefill)
        .catch(() => true); // fail-open（store 故障不阻塞主流程）
      if (!ok1) {
        this.logger.warn(`[RateLimit] global quota exceeded for ${domain}`);
        return {
          allowed: false,
          scope: "global",
          retryAfterMs: this.retryMs(this.globalRpm),
        };
      }
    }

    // ② per-tenant
    if (keys.tenantId) {
      const refill = this.perTenantRpm / 60;
      const ok2 = await this.store
        .tryConsume(
          `tenant:${keys.tenantId}:${domain}`,
          this.perTenantRpm,
          refill,
        )
        .catch(() => true);
      if (!ok2) {
        return {
          allowed: false,
          scope: "tenant",
          tenantId: keys.tenantId,
          retryAfterMs: this.retryMs(this.perTenantRpm),
        };
      }
    }

    // ③ per-agent-type
    if (keys.agentType) {
      const rpm = this.resolveAgentTypeRpm(keys.agentType);
      if (rpm !== undefined) {
        const refill = rpm / 60;
        const ok3 = await this.store
          .tryConsume(`agentType:${keys.agentType}:${domain}`, rpm, refill)
          .catch(() => true);
        if (!ok3) {
          return {
            allowed: false,
            scope: "agentType",
            agentType: keys.agentType,
            retryAfterMs: this.retryMs(rpm),
          };
        }
      }
    }

    return { allowed: true };
  }

  private resolveAgentTypeRpm(agentType: string): number | undefined {
    if (this.perAgentTypeRpm[agentType] !== undefined) {
      return this.perAgentTypeRpm[agentType];
    }
    return this.defaultAgentTypeRpm;
  }
}

/**
 * 限速错误（service 抛 / middleware 捕）
 */
export class RateLimitedError extends Error {
  constructor(
    public readonly scope: "global" | "tenant" | "agentType",
    public readonly retryAfterMs: number,
    public readonly tenantId?: string,
    public readonly agentType?: string,
  ) {
    super(
      `Rate-limited (scope=${scope}${tenantId ? `, tenantId=${tenantId}` : ""}${agentType ? `, agentType=${agentType}` : ""}, retryAfter=${retryAfterMs}ms)`,
    );
    this.name = "RateLimitedError";
  }
}
