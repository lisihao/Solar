/**
 * BillingRuntimeEnvAdapter — 把 platform/credits + RuntimeEnvironmentService
 * 适配为 Harness 的 IRuntimeEnvironment 接口。
 *
 * 业务方参考实现：fork 改成自己的 BillingContext 适配器即可。
 *
 * 真实路径：
 *   - CreditsService.getBalance（真扣 / 真查）
 *   - RuntimeEnvironmentService.snapshot 拿 BYOK 候选 model 池
 *   - suggestFallback 按余额状态返回真实降级建议
 *
 * disabledModels 存储层（PR-E P0-3）：
 *   - 传入 CacheService 时：Redis HASH，key = harness:billing:disabled-models:{instanceKey}
 *     TTL 4h（对齐 mission wall-time），支持 multi-pod 一致。
 *   - 未传入时（旧调用方向后兼容）：进程内 Record<string, string>，行为与原 Map 等价。
 */

import type {
  ByokStatus,
  ICreditState,
  IFallbackHint,
  IModelAvailability,
  IQuotaSnapshot,
  IRuntimeEnvironment,
} from "../../agents/abstractions";
import { CREDITS_TO_TOKENS } from "../budget/resolved-budget-caps";
import type { CreditsService } from "../../../platform/credits/credits.service";
import type { RuntimeEnvironmentService } from "../../../ai-harness/guardrails/runtime/runtime-environment.service";
import type { EnvironmentSnapshot } from "../../../ai-harness/guardrails/runtime/runtime-environment.types";
import type { CacheService } from "../../../../common/cache/cache.service";

const LOW_BALANCE_THRESHOLD = 500;
const CRITICAL_BALANCE_THRESHOLD = 100;
/** balance 缓存 TTL —— 30s 内 getCreditState/getQuotaSnapshot/suggestFallback 共享一次 DB 查询 */
const BALANCE_CACHE_TTL_MS = 30_000;
/** disabledModels Redis TTL：对齐 mission wall-time 上限 4h */
const DISABLED_MODELS_TTL_SEC = 4 * 3600;

type BalanceAcct = Awaited<ReturnType<CreditsService["getBalance"]>>;

/** Redis key for per-instance disabledModels hash */
function disabledModelsKey(instanceKey: string): string {
  return `harness:billing:disabled-models:${instanceKey}`;
}

export class BillingRuntimeEnvAdapter implements IRuntimeEnvironment {
  /** mission 内 balance 缓存：8+ 次 runner.run 只查 1 次 DB */
  private balanceCache: { acct: BalanceAcct; expiresAt: number } | null = null;

  /**
   * ★ 跨 mission 失败模式接入点：mission 启动前由 FailureLearnerService.lookup
   * 喂入"已知会撞墙的 (modelId → 备选 modelId)"映射。
   * getModelAvailability 命中 disabled set 时返回 available=false + fallbackTo，
   * 现有 react-loop 的 tier-model fallback 链路自动接住。
   *
   * 存储层：CacheService 存在时走 Redis；否则回退到 localDisabledModels（进程内）。
   */

  /** 进程内回退存储（无 CacheService 时使用，向后兼容旧调用方） */
  private readonly localDisabledModels: Record<string, string> = {};

  /** 唯一标识本 adapter 实例的 key，用于 Redis namespace 隔离 */
  private readonly instanceKey: string;

  constructor(
    public readonly userId: string,
    public readonly workspaceId: string | undefined,
    private readonly credits: CreditsService,
    private readonly runtimeEnv: RuntimeEnvironmentService,
    private readonly cache?: CacheService,
  ) {
    // 用 userId + 随机后缀生成实例唯一 key，保证同用户并发 mission 不串 namespace
    this.instanceKey = `${userId}:${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── disabledModels 存储层 helpers ─────────────────────────────────────────

  /** 读取 disabledModels（Redis 优先，无 CacheService 回退进程内） */
  private async readDisabledMap(): Promise<Record<string, string>> {
    if (this.cache) {
      const stored = await this.cache.get<Record<string, string>>(
        disabledModelsKey(this.instanceKey),
      );
      return stored ?? {};
    }
    return { ...this.localDisabledModels };
  }

  /** 写入 disabledModels（Redis 优先，无 CacheService 写进程内） */
  private async writeDisabledMap(map: Record<string, string>): Promise<void> {
    if (this.cache) {
      await this.cache.set(
        disabledModelsKey(this.instanceKey),
        map,
        DISABLED_MODELS_TTL_SEC,
      );
    } else {
      for (const [k, v] of Object.entries(map)) {
        this.localDisabledModels[k] = v;
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * 标记某 modelId 在本 mission 内禁用（pattern 已知会失败），并提供 fallback。
   * 由 orchestrator 调用：lookup 失败模式 → 命中且有 lastFallbackModel → 标记。
   */
  async markModelDisabled(
    failedModelId: string,
    fallbackModelId: string,
  ): Promise<void> {
    const current = await this.readDisabledMap();
    current[failedModelId] = fallbackModelId;
    await this.writeDisabledMap(current);
  }

  /** 当 mission 内某次调用走了 fallback 并跑通后，外部调用方 query 用 */
  async getDisabledModels(): Promise<ReadonlyMap<string, string>> {
    const map = await this.readDisabledMap();
    return new Map(Object.entries(map));
  }

  /** 带 TTL 的 balance 查询 — DB 调用聚合到一次 */
  private async getCachedBalance(): Promise<BalanceAcct> {
    const now = Date.now();
    if (this.balanceCache && this.balanceCache.expiresAt > now) {
      return this.balanceCache.acct;
    }
    const acct = await this.credits.getBalance(this.userId);
    this.balanceCache = {
      acct,
      expiresAt: now + BALANCE_CACHE_TTL_MS,
    };
    return acct;
  }

  /** 显式失效（如刚扣了费想立刻查最新） */
  invalidateBalanceCache(): void {
    this.balanceCache = null;
  }

  /**
   * 失效 snapshot 缓存——QUOTA_EXCEEDED 后 ReActLoop 会调，让下一次
   * suggestFallback 重读 DB 拿最新 model health（之前会拿到 30s 旧快照，
   * 死掉的 BYOK 仍标 healthy 导致 findSiblingModel 不切）。
   */
  invalidate(): void {
    this.balanceCache = null;
    this.runtimeEnv.invalidate(this.userId);
  }

  async getByokStatus(): Promise<ByokStatus> {
    // RuntimeEnvironmentService.snapshot 已自带 30s cache
    const snap = await this.runtimeEnv.snapshot({ userId: this.userId });
    if (snap.userKeys.hasByok) return "personal";
    // ★ 2026-05-29 W4a：共享/授权 key 原误标 "donated"，归一为 "assigned"
    if (snap.userKeys.sharedKeyAvailable) return "assigned";
    return "platform";
  }

  async getCreditState(): Promise<ICreditState> {
    const acct = await this.getCachedBalance();
    return {
      balance: acct.balance,
      softLimit: LOW_BALANCE_THRESHOLD,
      hardLimit: CRITICAL_BALANCE_THRESHOLD,
      currency: "credit",
    };
  }

  /**
   * ★ Phase P1-16: ToolACL 真实接入（mission-pipeline-tool-acl.md）
   *
   * 当前实现：从 RuntimeEnvironmentService.snapshot 读 userKeys 推 entitlements。
   *   - 任何用户都视为有 'public' entitlement
   *   - 有 BYOK 的用户额外得 'image.generation'（用户自费，可启图像生成）
   *   - 平台 admin entitlement 暂不实现（需 user_subscription 表，P2）
   */
  async getUserEntitlements(): Promise<{
    keys: string[];
    expiresAt?: Record<string, Date>;
  }> {
    try {
      const snap = await this.runtimeEnv.snapshot({ userId: this.userId });
      const keys = ["public"];
      if (snap.userKeys.hasByok) {
        keys.push("image.generation"); // 自费 BYOK 用户可调图像生成
      }
      return { keys };
    } catch {
      // fail-closed
      return { keys: ["public"] };
    }
  }

  async getModelAvailability(modelId: string): Promise<IModelAvailability> {
    // ★ 优先级 #1：本 mission 内已标记禁用（来自 FailureLearnerService 的
    // 历史失败模式）—— 直接返回 fallback 候选，绕开浪费 token 重蹈覆辙。
    const disabledMap = await this.readDisabledMap();
    const disabledFallback = disabledMap[modelId];
    if (disabledFallback) {
      return {
        modelId,
        available: false,
        unavailableReason: "outage",
        fallbackTo: [disabledFallback],
      };
    }
    const snap = await this.runtimeEnv.snapshot({ userId: this.userId });
    for (const pool of Object.values(snap.models)) {
      const found = pool.find((m) => m.modelId === modelId);
      if (found) {
        // ★ 三态语义：unhealthy 才报 outage；unknown 不阻断（避免新接 BYOK
        //   模型从未调用过被错杀），让 LLM 真去打一次，失败由 ToolCircuitBreaker
        //   / metrics 表反过来更新 healthy。
        if (found.healthy === "unhealthy") {
          const fallback = pool.find(
            (m) =>
              m.healthy !== "unhealthy" &&
              m.costTier === found.costTier &&
              m.modelId !== modelId,
          );
          return {
            modelId,
            available: false,
            unavailableReason: "outage",
            fallbackTo: fallback ? [fallback.modelId] : undefined,
          };
        }
        return { modelId, available: true };
      }
    }
    return {
      modelId,
      available: false,
      unavailableReason: "not_subscribed",
    };
  }

  async listAvailableModels(): Promise<readonly IModelAvailability[]> {
    const snap = await this.runtimeEnv.snapshot({ userId: this.userId });
    const all: IModelAvailability[] = [];
    for (const pool of Object.values(snap.models)) {
      for (const m of pool) {
        // available = healthy !== "unhealthy"（unknown 也算可用）
        all.push({ modelId: m.modelId, available: m.healthy !== "unhealthy" });
      }
    }
    return all;
  }

  async getEnvironmentSnapshot(): Promise<EnvironmentSnapshot> {
    return this.runtimeEnv.snapshot({ userId: this.userId });
  }

  /**
   * Phase P3-7: stage 预检（mission-pipeline-baseline.md §9.3 Q10）
   *
   * 估算给定 budget 是否可负担。返回:
   *   - affordable: 当前余额是否够
   *   - shortfall: 不够时差多少
   *   - suggestion: 'proceed'|'downgrade'|'abort' 决策建议
   */
  async estimateAffordable(budget: { maxTokens?: number }): Promise<{
    affordable: boolean;
    shortfall: number;
    suggestion: "proceed" | "downgrade" | "abort";
    estimatedCredits: number;
    currentBalance: number;
  }> {
    // ★ R2-#46: route through CREDITS_TO_TOKENS (single source in ResolvedBudgetCaps).
    //   Eliminates the divergent inline /1000 literal so this matches the pre-flight
    //   gate in s1-mission-estimate-budget.stage.ts exactly.
    const estimatedCredits = Math.ceil(
      (budget.maxTokens ?? 0) / CREDITS_TO_TOKENS,
    );
    // ★ BYOK 豁免：personal key 用户花自己 provider 的钱，chat.facade 已确认不扣平台
    //   credit（consumeCredits 跳过 personal）。因此平台余额（可能为 0）不该卡住 mission
    //   启动——单点在此豁免，所有调用方（s1 预检等）自动受益。仍返回 estimatedCredits
    //   供前端展示，但不查 balance、永远 affordable。currentBalance 用 -1 表示
    //   "BYOK 不适用平台余额"（避免 Infinity 进事件 JSON），下游仅在非 affordable
    //   分支才读它，BYOK 走 affordable 分支不会暴露。
    if ((await this.getByokStatus()) === "personal") {
      return {
        affordable: true,
        shortfall: 0,
        suggestion: "proceed",
        estimatedCredits,
        currentBalance: -1,
      };
    }
    const acct = await this.getCachedBalance();
    if (acct.balance >= estimatedCredits) {
      return {
        affordable: true,
        shortfall: 0,
        suggestion: "proceed",
        estimatedCredits,
        currentBalance: acct.balance,
      };
    }
    const shortfall = estimatedCredits - acct.balance;
    if (acct.balance >= estimatedCredits / 2) {
      return {
        affordable: false,
        shortfall,
        suggestion: "downgrade",
        estimatedCredits,
        currentBalance: acct.balance,
      };
    }
    return {
      affordable: false,
      shortfall,
      suggestion: "abort",
      estimatedCredits,
      currentBalance: acct.balance,
    };
  }

  async getQuotaSnapshot(): Promise<IQuotaSnapshot> {
    const acct = await this.getCachedBalance();
    // CreditsService.getBalance 只暴露 balance / todaySpent
    return {
      balance: { used: 0, limit: acct.balance },
      daily_credit: {
        used: acct.todaySpent,
        limit: acct.balance + acct.todaySpent,
        resetAt: this.tomorrowMidnight(),
      },
    };
  }

  async suggestFallback(input: {
    failedModelId?: string;
    reason: string;
  }): Promise<IFallbackHint> {
    // ── 基础设施级（老）──
    if (input.reason === "no_credit") {
      const acct = await this.getCachedBalance();
      if (acct.balance <= CRITICAL_BALANCE_THRESHOLD) {
        return {
          action: "notify_user",
          reason: "余额已耗尽，请充值后重试",
          userMessage: `当前积分 ${acct.balance}，不足以完成本次任务。请前往 /credits 充值。`,
        };
      }
      return {
        action: "downgrade",
        reason: `本次预算超限；建议降级到便宜模型`,
      };
    }
    if (input.reason === "rate_limit") {
      return { action: "retry", reason: "rate-limit", retryAfterMs: 2000 };
    }
    if (input.reason === "outage" && input.failedModelId) {
      const fb = await this.findSiblingModel(input.failedModelId);
      if (fb) {
        return {
          action: "downgrade",
          reason: `${input.failedModelId} 不可用，切到 ${fb}`,
          fallbackModelId: fb,
        };
      }
    }
    // ★ 2026-05-12: BYOK 单源原则——配额耗尽不自动跨 provider fallback。
    //   用户须显式申请 admin 批 KeyAssignment（也属 BYOK），或在 BYOK 管理
    //   续费当前 provider。这里返 notify_user 把诊断 + 行动指引一次说清。
    if (input.reason === "byok_quota_exceeded") {
      return {
        action: "notify_user",
        reason: "byok-quota-exceeded",
        userMessage:
          `您当前 BYOK 模型「${input.failedModelId ?? "?"}」的 provider 配额已耗尽。` +
          `请前往 个人中心 → BYOK 管理 续费或更换 key；` +
          `也可向 管理员 申请临时分配其他模型的访问权限（admin 批准后同样按 BYOK 计入）。`,
      };
    }
    if (input.reason === "context_too_long" || input.reason === "no_quota") {
      return { action: "abort", reason: input.reason };
    }

    // ── LLM 协议级（新增）──
    // safety_refusal / reasoning_exhaustion / empty_response：
    // 切到一个非 reasoning model（绕开 reasoning CoT 撞墙 + safety filter
    // 在 reasoning 模型上更激进的双重问题）。找不到非 reasoning 的就 abort。
    if (
      input.reason === "safety_refusal" ||
      input.reason === "reasoning_exhaustion" ||
      input.reason === "empty_response"
    ) {
      const nonReasoning = await this.findNonReasoningModel(
        input.failedModelId,
      );
      if (nonReasoning) {
        return {
          action: "downgrade",
          reason: `${input.reason} on ${input.failedModelId ?? "?"}，切到非 reasoning 模型 ${nonReasoning}`,
          fallbackModelId: nonReasoning,
        };
      }
      return {
        action: "abort",
        reason: `${input.reason}：无非 reasoning 候选模型可切换`,
      };
    }
    // truncated：调用方应调高 maxTokens 重试 1 次；这里只给 retry 信号
    if (input.reason === "truncated") {
      return {
        action: "retry",
        reason: "增大 maxTokens 重试",
        retryAfterMs: 0,
      };
    }
    // parse_failure：让 Reflexion 自己 critique-revise，retry 信号
    if (input.reason === "parse_failure") {
      return {
        action: "retry",
        reason: "parse 失败由 Reflexion 重试",
        retryAfterMs: 0,
      };
    }
    // model_not_found：走候选池（findSiblingModel 在同 provider 内挑近似替代）
    if (input.reason === "model_not_found" && input.failedModelId) {
      const fb = await this.findSiblingModel(input.failedModelId);
      if (fb) {
        return {
          action: "downgrade",
          reason: `${input.failedModelId} 不存在，切到 ${fb}`,
          fallbackModelId: fb,
        };
      }
      return { action: "abort", reason: "model_not_found 无候选" };
    }

    // ── 执行级（新增）──
    if (input.reason === "tool_failure") {
      return {
        action: "retry",
        reason: "tool 失败，调用方决定换工具或绕开",
        retryAfterMs: 0,
      };
    }
    if (
      input.reason === "verifier_low_score" ||
      input.reason === "schema_mismatch"
    ) {
      return {
        action: "retry",
        reason: "由 Reflexion critique-revise 处理",
        retryAfterMs: 0,
      };
    }

    return { action: "abort", reason: `no fallback for ${input.reason}` };
  }

  /**
   * 在同 costTier 的 BYOK 候选池里找一个 healthy 且非 input modelId 的备选。
   */
  private async findSiblingModel(
    failedModelId: string,
  ): Promise<string | undefined> {
    const snap = await this.runtimeEnv.snapshot({ userId: this.userId });
    for (const pool of Object.values(snap.models)) {
      const found = pool.find((m) => m.modelId === failedModelId);
      if (!found) continue;
      const sibling = pool.find(
        (m) =>
          m.modelId !== failedModelId &&
          m.healthy !== "unhealthy" &&
          m.costTier === found.costTier,
      );
      if (sibling) return sibling.modelId;
      // 没同 tier 备选 → 同池任一健康模型
      const anyHealthy = pool.find(
        (m) => m.modelId !== failedModelId && m.healthy !== "unhealthy",
      );
      if (anyHealthy) return anyHealthy.modelId;
    }
    return undefined;
  }

  /**
   * 在所有 BYOK 池里找一个非 reasoning 的 healthy 模型。
   * 用于 reasoning model 撞 safety filter / CoT exhaustion 时绕开。
   *
   * 注：snapshot 里的 model 描述未必有 isReasoning 字段，这里按命名约定
   * 兜底（o1/o3/o4/deepseek-reasoner/gpt-5 系列认为是 reasoning）。
   */
  private async findNonReasoningModel(
    excludeModelId?: string,
  ): Promise<string | undefined> {
    const snap = await this.runtimeEnv.snapshot({ userId: this.userId });
    const reasoningPattern =
      /^(o[1-9]|o\d+|deepseek-reasoner|gpt-5|grok-.*reason)/i;
    for (const pool of Object.values(snap.models)) {
      const candidate = pool.find(
        (m) =>
          m.modelId !== excludeModelId &&
          m.healthy !== "unhealthy" &&
          !reasoningPattern.test(m.modelId),
      );
      if (candidate) return candidate.modelId;
    }
    return undefined;
  }

  private tomorrowMidnight(): number {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }
}
