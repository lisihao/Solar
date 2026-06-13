/**
 * ModelElectionService · 环境感知选举
 *
 * 输入：RuntimeEnvironmentService 产出的候选池 + 本次调用需求
 * 输出：唯一 modelId 以及打分明细（可观测）
 *
 * 打分维度（v1，可演进）：
 *   [硬过滤]   isEnabled · modelType 匹配 · healthy · BYOK · 黑名单
 *   [Tier]     根据 TaskProfile 目标 tier（STRONG / STANDARD / BASIC）加权
 *   [Role]     leader → reasoning; researcher/writer/reviewer → STRONG; extractor → BASIC
 *   [Cost]     costBias cheap/balanced/quality
 *   [Health]   recentErrorRate 越低越好；> 0.5 直接 reject
 *   [Tie-break] priority DESC → isDefault → stable
 *
 * 与 AiChatService.chat 的关系：
 *   chat() 的 else 分支（没 model / 没 modelType）之前直接读 DEFAULT_AI_MODEL env 抛错。
 *   现在 harness/LlmExecutor 会先 elect(...) 拿到 modelId，再用 model= 显式调 chat，
 *   不会触发 else 分支。保留 chat 的旧兜底作为"纯 adapter 遗留调用"的最后一道防线。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
import { AiModelConfigService } from "../config/ai-model-config.service";
import type { AIModelConfig } from "../../chat/ai-chat.service";
import { classifyModelTier, ModelTier } from "../../types/model-tier.types";
import {
  scoreHealthRate,
  scorePriority,
  scoreDiversity as sharedScoreDiversity,
} from "@/modules/ai-engine/routing/scoring-formulas";
import type { TaskProfile } from "../../types";
import {
  NoEligibleModelError,
  type ElectionCandidate,
  type ElectionRequest,
  type ElectionResult,
  type ElectionRoleHint,
  type ElectionScore,
} from "./model-election.types";

interface ScoredCandidate {
  readonly config: AIModelConfig;
  readonly score: ElectionScore;
}

@Injectable()
export class ModelElectionService {
  private readonly logger = new Logger(ModelElectionService.name);

  constructor(
    private readonly modelConfigService: AiModelConfigService,
    @Optional() private readonly keyResolver?: KeyResolverService,
  ) {}

  /**
   * 执行一次选举。
   * 注意：本方法对调用方完全纯粹——不触发 DB 写入，不缓存结果（每次重算）。
   */
  async elect(request: ElectionRequest): Promise<ElectionResult> {
    const {
      modelType,
      candidates,
      taskProfile,
      role = "default",
      userId,
      costBias = "balanced",
      excludeModelIds = [],
      previouslyElected = [],
    } = request;

    // ============ Step 1 · 候选池归一化 ============
    // 候选池可能来自 RuntimeEnvironmentService（推荐路径），也可能为空
    // （纯单元测试 / runtime 未注入）。空时退化到 DB 全表查询，保证不会因
    // 环境感知模块缺失而无法选举。
    const pool =
      candidates.length > 0
        ? candidates
        : await this.loadCandidatesFromDb(modelType);

    // ============ Step 2 · 硬过滤 ============
    const excluded = new Set(excludeModelIds);
    const typeMatched = pool.filter((c) =>
      this.isTypeCompatible(c.modelType, modelType),
    );
    // ★ healthy 三态语义：unhealthy 一定排除；unknown/undefined 容忍（避免新接 BYOK 模型
    //   全被淘汰）。仍用 recentErrorRate < 0.5 作为最后一道兜底。
    const healthy = typeMatched.filter(
      (c) => c.healthy !== "unhealthy" && (c.recentErrorRate ?? 0) < 0.5,
    );
    let notBlacklisted = healthy.filter((c) => !excluded.has(c.modelId));

    if (notBlacklisted.length === 0) {
      // ★ 2026-05-22 单模型 / 全降级部署的最后一道保命：与其因"0 健康候选"硬抛
      //   NoEligibleModelError 把整个 mission 判废（根因：平台只启用 1 个模型且无
      //   fallback 档，该模型 recentErrorRate≥0.5 或被标 unhealthy 时此处必空），不如
      //   退回到 type-matched 里"最不坏"的候选，交给上层 react-loop 的退避/重试。
      //   仅在本来必抛错时触发；多模型健康部署永不进入此分支，对正常路径零影响。
      const lastResort = this.pickLastResort(typeMatched, excluded);
      if (lastResort.length === 0) {
        throw new NoEligibleModelError(
          modelType,
          `pool=${pool.length} typeMatched=${typeMatched.length} ` +
            `healthy=${healthy.length} afterBlacklist=0`,
        );
      }
      this.logger.warn(
        `[elect] no healthy candidate for modelType=${modelType} role=${role}; ` +
          `falling back to last-resort [${lastResort
            .map((c) => c.modelId)
            .join(", ")}] (degraded — health/errorRate may be poor)`,
      );
      notBlacklisted = lastResort;
    }

    // ============ Step 3 · BYOK 过滤 ============
    // 2026-05-12 BYOK fix：用 getHealthyProviders 而不是 getAvailableProviders
    //   ——后者只看"DB 里有没有 key"，前者再叠 KeyHealthStore.filterUsable，
    //   quota-exhausted / DEAD / 长 cooldown 的 key 整体剔除。
    //   场景：用户有 1 个 deepseek key 但已 quota exhausted，election 池里
    //   deepseek-reasoner 被打分压过 grok（cheap + reasoning role），chat 调
    //   deepseek → AllKeysFailedError(QUOTA_EXCEEDED)。本过滤把整条 deepseek
    //   provider 剔除，避免下游再炸一次。
    //
    //   KeyHealthStore 未注入（spec / 旧 wiring）时 getHealthyProviders 退化为
    //   getAvailableProviders，行为对齐原有 BYOK 过滤。
    let byokFiltered = notBlacklisted;
    if (userId && this.keyResolver) {
      try {
        const providers = await this.keyResolver.getHealthyProviders(userId);
        const providerSet = new Set(providers.map((p) => p.toLowerCase()));
        // providers 空 == 用户没配任何 key（或所有 key 都 quota-exhausted）；
        // 这种情况交给 chat() 的 BYOK 预检抛 NoAvailableKeyError，election
        // 这里不强制过滤（否则报错信息不对）。
        if (providerSet.size > 0) {
          byokFiltered = notBlacklisted.filter((c) =>
            providerSet.has(c.provider.toLowerCase()),
          );
          if (byokFiltered.length === 0) {
            // BYOK 过滤空了 —— 用户没任何命中 provider 的模型。退回到全量，
            // 让下游 AiChatService 抛 BYOK 错误（有清晰错误码），比 election
            // 自己抛"没候选"更利于排查。
            this.logger.warn(
              `[elect] userId=${userId} has healthy providers=[${[...providerSet]}] ` +
                `but no candidate matches; falling back to unfiltered pool`,
            );
            byokFiltered = notBlacklisted;
          }
        }
      } catch (err) {
        this.logger.warn(
          `[elect] BYOK provider lookup failed for userId=${userId}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ============ Step 4 · 为每个候选查 DB config 并打分 ============
    const scored: ScoredCandidate[] = [];
    const targetTier = this.resolveTargetTier(taskProfile, role);

    for (const cand of byokFiltered) {
      const cfg = await this.modelConfigService.getModelConfig(cand.modelId);
      if (!cfg) {
        // 候选池里有但 DB 查不到（刚被禁用 / 脏数据）—— 跳过
        continue;
      }
      const score = this.score({
        candidate: cand,
        config: cfg,
        targetTier,
        role,
        costBias,
        previouslyElected,
      });
      scored.push({ config: cfg, score });
    }

    if (scored.length === 0) {
      throw new NoEligibleModelError(
        modelType,
        `all ${byokFiltered.length} candidates missing DB config: ` +
          `[${byokFiltered.map((c) => c.modelId).join(", ")}]`,
      );
    }

    // ============ Step 5 · 排序 + tie-break ============
    scored.sort((a, b) => {
      const diff = b.score.total - a.score.total;
      if (diff !== 0) return diff;
      // tie-break #1: priority DESC
      const prioDiff = (b.config.priority ?? 50) - (a.config.priority ?? 50);
      if (prioDiff !== 0) return prioDiff;
      // tie-break #2: isDefault first
      if (a.config.isDefault !== b.config.isDefault) {
        return b.config.isDefault ? 1 : -1;
      }
      // tie-break #3: stable modelId lex order（确定性）
      return a.config.modelId.localeCompare(b.config.modelId);
    });

    const winner = scored[0];
    const reason = this.buildReason(winner, targetTier, role, costBias);

    this.logger.debug(
      `[elect] modelType=${modelType} role=${role} tier=${targetTier} ` +
        `candidates=${pool.length} → ${winner.config.modelId} (score=${winner.score.total})`,
    );

    return {
      elected: winner.config,
      scores: scored.map((s) => s.score),
      reason,
    };
  }

  /**
   * 最后保命候选——仅当 health/blacklist 过滤把池子清空、但仍有 type-matched 候选时调用。
   * 取舍优先级：未被本轮黑名单 > 黑名单；非 unhealthy > unhealthy；recentErrorRate 最低。
   * 返回"最不坏"的同分子集（可能 >1 个），交给后续打分 / tie-break 最终定夺。
   */
  private pickLastResort(
    typeMatched: ElectionCandidate[],
    excluded: Set<string>,
  ): ElectionCandidate[] {
    if (typeMatched.length === 0) return [];
    const notExcluded = typeMatched.filter((c) => !excluded.has(c.modelId));
    const base = notExcluded.length > 0 ? notExcluded : typeMatched;
    const notDead = base.filter((c) => c.healthy !== "unhealthy");
    const finalPool = notDead.length > 0 ? notDead : base;
    const minErr = Math.min(...finalPool.map((c) => c.recentErrorRate ?? 0));
    return finalPool.filter((c) => (c.recentErrorRate ?? 0) === minErr);
  }

  // ============================================================
  // 打分内部实现
  // ============================================================

  private score(args: {
    candidate: ElectionCandidate;
    config: AIModelConfig;
    targetTier: ModelTier;
    role: ElectionRoleHint;
    costBias: "cheap" | "balanced" | "quality";
    previouslyElected: ReadonlyArray<string>;
  }): ElectionScore {
    const { candidate, config, targetTier, role, costBias, previouslyElected } =
      args;
    const tier = classifyModelTier(config.modelId);

    const tierScore = this.scoreTier(tier, targetTier);
    const roleScore = this.scoreRole(role, config, tier);
    const costScore = this.scoreCost(costBias, candidate.costTier, tier);
    const healthScore = scoreHealthRate(candidate.recentErrorRate);
    const priorityScore = scorePriority(config.priority); // 0-10
    const isDefaultScore = config.isDefault ? 5 : 0;
    const diversityScore = sharedScoreDiversity(
      config.modelId,
      previouslyElected,
    );

    const total =
      tierScore +
      roleScore +
      costScore +
      healthScore +
      priorityScore +
      isDefaultScore +
      diversityScore;

    return {
      modelId: config.modelId,
      total: Math.round(total * 100) / 100,
      breakdown: {
        tier: tierScore,
        role: roleScore,
        cost: costScore,
        health: healthScore,
        priority: priorityScore,
        isDefault: isDefaultScore,
        diversity: diversityScore,
      },
    };
  }

  /** tier 匹配：目标命中 +25；相邻 +10；更远 0 */
  private scoreTier(actual: ModelTier, target: ModelTier): number {
    if (actual === target) return 25;
    const order = [ModelTier.BASIC, ModelTier.STANDARD, ModelTier.STRONG];
    const distance = Math.abs(order.indexOf(actual) - order.indexOf(target));
    return distance === 1 ? 10 : 0;
  }

  /**
   * role 偏好（2026-05-10 §3 反 multi-model 坍缩）
   *
   * 之前 writer/reviewer 都给 STRONG 同一个 +15，配合 priority 决定
   * 让所有 STRONG 角色一边倒选 priority 最高那个 provider（如 grok-3），
   * "多模型自动选择"实际坍缩成"单模型一拉到底"。
   *
   * 新规则按角色专长再分一档：
   * - leader / reviewer 偏 reasoning（规划 / 批判性思考）
   * - writer 反偏 reasoning（reasoning 模型话术僵硬，叙事型 STRONG 更佳）
   *
   * 用户在只配了 xai + deepseek 时：
   *   leader/reviewer → deepseek-r1（reasoning 加分）
   *   writer/researcher → grok-3（非 reasoning STRONG 加分）
   * 自然分布到两个 provider，不再坍缩。
   */
  private scoreRole(
    role: ElectionRoleHint,
    config: AIModelConfig,
    tier: ModelTier,
  ): number {
    switch (role) {
      case "leader":
        // 规划/分配：reasoning 模型最佳
        return config.isReasoning ? 20 : tier === ModelTier.STRONG ? 10 : 0;
      case "reviewer":
        // 批判性思考 → reasoning 优先；非 reasoning STRONG 也合格
        if (tier === ModelTier.STRONG) return config.isReasoning ? 18 : 12;
        return tier === ModelTier.STANDARD ? 5 : 0;
      case "researcher":
        // 综合研究：需要强模型，但不应像 pure reasoning 那样重偏审稿型语气
        if (tier === ModelTier.STRONG) return config.isReasoning ? 14 : 16;
        return tier === ModelTier.STANDARD ? 6 : 0;
      case "writer":
        // 叙事/长文：非 reasoning STRONG 最佳；reasoning 反偏（话术僵硬）
        if (tier === ModelTier.STRONG) return config.isReasoning ? 8 : 18;
        return tier === ModelTier.STANDARD ? 5 : 0;
      case "extractor":
      case "classifier":
        // 结构化抽取：BASIC 够用，不浪费 STRONG
        return tier === ModelTier.BASIC
          ? 10
          : tier === ModelTier.STANDARD
            ? 5
            : 0;
      case "default":
      default:
        return 0;
    }
  }

  /** 成本策略 */
  private scoreCost(
    bias: "cheap" | "balanced" | "quality",
    costTier: "basic" | "standard" | "strong" | "unknown" | undefined,
    tier: ModelTier,
  ): number {
    // unknown / undefined 都退到 tier 派生值
    const effective =
      costTier && costTier !== "unknown" ? costTier : this.tierToCost(tier);
    if (bias === "cheap") {
      return effective === "basic" ? 15 : effective === "standard" ? 5 : 0;
    }
    if (bias === "quality") {
      return effective === "strong" ? 15 : effective === "standard" ? 5 : 0;
    }
    return effective === "standard" ? 10 : 5; // balanced
  }

  // ============================================================
  // 辅助
  // ============================================================

  private resolveTargetTier(
    profile: TaskProfile | undefined,
    role: ElectionRoleHint,
  ): ModelTier {
    // Profile 强信号优先
    if (profile) {
      const isHighCreativity =
        profile.creativity === "high" || profile.creativity === "medium";
      const isLongOutput =
        profile.outputLength === "long" || profile.outputLength === "extended";
      const isMinimalOutput = profile.outputLength === "minimal";
      const isDeterministic = profile.creativity === "deterministic";

      if (isHighCreativity && isLongOutput) return ModelTier.STRONG;
      if (isDeterministic && isMinimalOutput) return ModelTier.BASIC;
    }

    // Role 兜底
    switch (role) {
      case "leader":
      case "researcher":
      case "writer":
      case "reviewer":
        return ModelTier.STRONG;
      case "extractor":
      case "classifier":
        return ModelTier.BASIC;
      default:
        return ModelTier.STANDARD;
    }
  }

  private tierToCost(tier: ModelTier): "basic" | "standard" | "strong" {
    if (tier === ModelTier.STRONG) return "strong";
    if (tier === ModelTier.BASIC) return "basic";
    return "standard";
  }

  /**
   * Type 兼容性：
   *   REASONING 候选（来自 discoverModels 的 additive REASONING 桶）对
   *   modelType=CHAT 的请求也兼容——它们底层也是 CHAT API。
   */
  private isTypeCompatible(
    candidateType: ElectionCandidate["modelType"],
    requested: AIModelType,
  ): boolean {
    if (candidateType === requested) return true;
    if (requested === AIModelType.CHAT && candidateType === "REASONING")
      return true;
    return false;
  }

  private async loadCandidatesFromDb(
    modelType: AIModelType,
  ): Promise<ElectionCandidate[]> {
    const configs =
      await this.modelConfigService.getAllEnabledModelsByType(modelType);
    return configs.map((c) => ({
      modelId: c.modelId,
      provider: c.provider,
      modelType,
      // DB 全表 fallback 场景没有 metrics 输入，标 unknown 让评分逻辑走中位
      healthy: "unknown" as const,
    }));
  }

  private buildReason(
    winner: ScoredCandidate,
    tier: ModelTier,
    role: ElectionRoleHint,
    bias: string,
  ): string {
    const b = winner.score.breakdown;
    return (
      `elected=${winner.config.modelId} tier=${tier} role=${role} ` +
      `costBias=${bias} score=${winner.score.total} ` +
      `[tier=${b.tier} role=${b.role} cost=${b.cost} health=${b.health} ` +
      `prio=${b.priority} default=${b.isDefault} diversity=${b.diversity}]`
    );
  }
}
