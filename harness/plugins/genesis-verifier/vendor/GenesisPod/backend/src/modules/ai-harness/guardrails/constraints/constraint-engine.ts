/**
 * AI Engine - Constraint Engine Implementation
 * 约束引擎实现
 *
 * 集成 ai-engine/constraint/CostController 进行成本记录
 */

import { Injectable } from "@nestjs/common";
import {
  ConstraintProfile,
  CostConstraint,
  QualityConstraint,
  EfficiencyConstraint,
  ModelPreference,
  QualityDepth,
  createConstraintProfile,
} from "./constraint-profile";
import type {
  IConstraintEngine,
  ConstraintEvaluation,
  CostEvaluation,
  QualityEvaluation,
  EfficiencyEvaluation,
  ConstraintWarning,
  ConstraintViolation,
  ConstraintSuggestion,
  ResourceRequirement,
  ResourceAllocation,
  ResourceUsage,
  CostEstimate,
  CostBreakdown,
  DegradationStrategy,
} from "./constraint-engine.interface";
import { CostController } from "../resources/cost-controller";
import {
  ModelPricingRegistry,
  type ModelTier,
} from "@/modules/ai-engine/llm/models/pricing/model-pricing.registry";
import { Optional } from "@nestjs/common";

/**
 * 把 ConstraintEngine 的 ModelPreference 映射到 ModelPricingRegistry 的 ModelTier。
 *   cheap    ↔ basic
 *   balanced ↔ standard
 *   premium  ↔ strong
 */
const PREFERENCE_TO_TIER: Record<ModelPreference, ModelTier> = {
  cheap: "basic",
  balanced: "standard",
  premium: "strong",
};

/**
 * ONLY used when the admin DB has zero registered models; NOT a substitute for
 * live ModelPricingRegistry pricing.
 *
 * 触发条件：ModelPricingRegistry 未注入，或该 tier 下 `pickModelForTier()` 返回
 * null（即 admin 后台尚未为该 tier 配置任何模型）。
 *
 * 这些数字仅用于"mission 大概多少钱"的事前 ROI 估算（USD per 1K tokens），
 * 不影响真实记账（真实记账走 ModelPricingRegistry → DB ai_models 表）。
 * 一旦 admin 为某 tier 配置了至少一个模型 + price，此表不再被使用。
 */
const EMERGENCY_TIER_COSTS_NO_MODELS: Record<
  ModelPreference,
  { input: number; output: number }
> = {
  cheap: { input: 0.1, output: 0.2 },
  balanced: { input: 0.5, output: 1.0 },
  premium: { input: 2.0, output: 4.0 },
};

/**
 * 模型层级映射
 *
 * 注意：这里返回的是语义化的层级标签，而非具体的模型 ID。
 * 实际的模型选择由 LLMFactory/AiModelConfigService 根据以下规则动态解析：
 * - "fast": 解析为最便宜的启用模型（通常是 gpt-4o-mini 或同类）
 * - "default": 解析为默认模型（由系统配置决定，通常是 gpt-4o）
 * - "premium": 解析为最高能力模型（通常是 claude-3-5-sonnet 或同类）
 *
 * 这种设计确保约束引擎不依赖具体模型 ID，符合分层架构原则。
 */
const MODEL_MAPPING: Record<ModelPreference, string> = {
  cheap: "fast", // 快速/廉价层级
  balanced: "default", // 平衡/默认层级
  premium: "premium", // 高级/能力层级
};

/**
 * 约束引擎实现
 *
 * 负责业务级约束评估（成本/质量/效率铁三角）
 * 集成 CostController 进行运维级成本追踪
 */
@Injectable()
export class ConstraintEngine implements IConstraintEngine {
  constructor(
    private readonly costController?: CostController,
    @Optional() private readonly pricingRegistry?: ModelPricingRegistry,
  ) {}

  /**
   * 取该 ModelPreference 对应的 (input, output) per-1K USD 价格。
   * 优先：ModelPricingRegistry → 该 tier 注册的代表模型 (pickModelForTier) →
   *       priceInputPerM/1000、priceOutputPerM/1000
   * 降级：EMERGENCY_TIER_COSTS_NO_MODELS（仅 admin 没配置任何模型时）
   *
   * isFallback=true 表示走了兜底表（admin 零模型 edge case），
   * isFallback=false 表示来自 ModelPricingRegistry 的真实价格。
   */
  private getCostPerKTokens(pref: ModelPreference): {
    input: number;
    output: number;
    isFallback: boolean;
  } {
    if (this.pricingRegistry) {
      const tier = PREFERENCE_TO_TIER[pref];
      const modelId = this.pricingRegistry.pickModelForTier(tier);
      if (modelId) {
        const p = this.pricingRegistry.get(modelId);
        if (p) {
          return {
            input: p.inputPricePerM / 1000,
            output: p.outputPricePerM / 1000,
            isFallback: false,
          };
        }
      }
    }
    return { ...EMERGENCY_TIER_COSTS_NO_MODELS[pref], isFallback: true };
  }

  /**
   * 记录成本（委托给 CostController）
   */
  recordCost(
    operation: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    missionId?: string,
  ): number {
    const cost =
      this.costController?.calculateCost(model, inputTokens, outputTokens) ??
      this.estimateCostForModel(inputTokens + outputTokens, "balanced");

    if (this.costController) {
      this.costController.recordCost({
        category: "llm",
        operation,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
        },
        cost,
        sessionId: missionId,
      });
    }

    return cost;
  }

  /**
   * 检查预算（委托给 CostController）
   */
  checkBudget(estimatedCost: number): boolean {
    if (!this.costController) return true;
    const result = this.costController.checkBudget(estimatedCost, "llm");
    return result.allowed;
  }

  /**
   * 验证约束配置
   */
  validate(constraints: ConstraintProfile): {
    valid: boolean;
    violations: Array<{ type: string; message: string }>;
  } {
    const violations: Array<{ type: string; message: string }> = [];

    // 验证成本约束
    if (constraints.cost.budget <= 0) {
      violations.push({ type: "cost", message: "Budget must be positive" });
    }

    // 验证质量约束
    if (
      constraints.quality.minReviewScore < 0 ||
      constraints.quality.minReviewScore > 10
    ) {
      violations.push({
        type: "quality",
        message: "Review score must be between 0 and 10",
      });
    }

    // 验证效率约束
    if (constraints.efficiency.maxDuration <= 0) {
      violations.push({
        type: "efficiency",
        message: "Max duration must be positive",
      });
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * 评估当前约束状态
   */
  evaluate(
    constraints: ConstraintProfile,
    currentUsage: ResourceUsage,
  ): ConstraintEvaluation {
    const cost = this.evaluateCost(constraints.cost, currentUsage);
    const quality = this.evaluateQuality(constraints.quality, currentUsage);
    const efficiency = this.evaluateEfficiency(
      constraints.efficiency,
      currentUsage,
    );

    const warnings: ConstraintWarning[] = [];
    const violations: ConstraintViolation[] = [];
    const suggestions: ConstraintSuggestion[] = [];

    // 收集成本警告和违规
    if (cost.status === "warning") {
      warnings.push({
        type: "cost",
        code: "COST_WARNING",
        message: `成本使用率达到 ${(cost.usageRate * 100).toFixed(1)}%，接近预算上限`,
        currentValue: cost.currentUsage,
        threshold: constraints.cost.budget * constraints.cost.warningThreshold,
        severity: "medium",
      });
    } else if (cost.status === "critical") {
      warnings.push({
        type: "cost",
        code: "COST_CRITICAL",
        message: `成本使用率达到 ${(cost.usageRate * 100).toFixed(1)}%，即将超出预算`,
        currentValue: cost.currentUsage,
        threshold: constraints.cost.budget * 0.95,
        severity: "high",
      });
    } else if (cost.status === "exceeded") {
      violations.push({
        type: "cost",
        code: "BUDGET_EXCEEDED",
        message: `已超出预算，当前消耗 ${cost.currentUsage}，预算 ${cost.budget}`,
        currentValue: cost.currentUsage,
        limit: cost.budget,
        excess: cost.currentUsage - cost.budget,
        recoverable: constraints.cost.allowOverBudget,
      });
    }

    // 收集质量警告和违规
    if (quality.status === "poor") {
      violations.push({
        type: "quality",
        code: "QUALITY_BELOW_THRESHOLD",
        message: `质量分数 ${quality.currentScore} 低于最低要求 ${quality.requiredScore}`,
        currentValue: quality.currentScore,
        limit: quality.requiredScore,
        excess: quality.requiredScore - quality.currentScore,
        recoverable: quality.reworkCount < quality.maxReworks,
      });
    }

    if (quality.reworkCount >= quality.maxReworks) {
      warnings.push({
        type: "quality",
        code: "MAX_REWORKS_REACHED",
        message: `已达到最大返工次数 ${quality.maxReworks}`,
        currentValue: quality.reworkCount,
        threshold: quality.maxReworks,
        severity: "high",
      });
    }

    // 收集效率警告和违规
    if (efficiency.status === "at_risk") {
      warnings.push({
        type: "efficiency",
        code: "TIME_WARNING",
        message: `时间使用率达到 ${(efficiency.timeUsageRate * 100).toFixed(1)}%，进度可能受影响`,
        currentValue: efficiency.elapsedTime,
        threshold: efficiency.maxDuration * 0.7,
        severity: "medium",
      });
    } else if (efficiency.status === "delayed") {
      warnings.push({
        type: "efficiency",
        code: "TIME_CRITICAL",
        message: `时间使用率达到 ${(efficiency.timeUsageRate * 100).toFixed(1)}%，可能超时`,
        currentValue: efficiency.elapsedTime,
        threshold: efficiency.maxDuration * 0.9,
        severity: "high",
      });
    } else if (efficiency.status === "timeout") {
      violations.push({
        type: "efficiency",
        code: "TIMEOUT",
        message: `已超时，用时 ${efficiency.elapsedTime}ms，限制 ${efficiency.maxDuration}ms`,
        currentValue: efficiency.elapsedTime,
        limit: efficiency.maxDuration,
        excess: efficiency.elapsedTime - efficiency.maxDuration,
        recoverable: false,
      });
    }

    // 生成建议
    if (cost.willExceedBudget) {
      suggestions.push({
        type: "cost",
        code: "SUGGEST_MODEL_DOWNGRADE",
        message: "建议降级到更便宜的模型以控制成本",
        expectedImprovement: "可节省约 50-80% 成本",
        priority: 1,
      });
    }

    if (efficiency.willTimeout && currentUsage.progress < 0.8) {
      suggestions.push({
        type: "efficiency",
        code: "SUGGEST_REDUCE_PARALLELISM",
        message: "建议减少任务并行度以提高效率",
        expectedImprovement: "可能缩短 20-30% 时间",
        priority: 2,
      });
    }

    // 计算整体健康度
    const healthScore = this.calculateHealthScore(cost, quality, efficiency);

    return {
      satisfied: violations.length === 0,
      cost,
      quality,
      efficiency,
      healthScore,
      warnings,
      violations,
      suggestions,
    };
  }

  /**
   * 分配资源
   */
  allocate(
    requirements: ResourceRequirement,
    constraints: ConstraintProfile,
  ): ResourceAllocation {
    // 根据约束确定模型层级
    let modelTier = constraints.cost.modelPreference;

    // 如果预算紧张，考虑降级
    const estimatedCost = this.estimateCostForModel(
      requirements.estimatedTokens,
      modelTier,
    );
    if (estimatedCost > constraints.cost.budget * 0.8) {
      modelTier = this.downgradeModelTier(modelTier);
    }

    // 确定并行度
    let parallelism = Math.min(
      requirements.parallelismNeeded,
      constraints.efficiency.maxParallelism,
    );
    if (!constraints.efficiency.allowParallel) {
      parallelism = 1;
    }

    // 确定超时时间
    const timeout = Math.min(
      requirements.estimatedDuration * 2,
      constraints.efficiency.maxDuration,
    );

    // 确定质量深度
    const qualityDepth = constraints.quality.depth;

    // 确定是否启用审核
    const reviewEnabled = constraints.quality.reviewRequired;

    return {
      model: MODEL_MAPPING[modelTier],
      modelTier,
      maxTokens: this.calculateMaxTokens(constraints.cost.budget, modelTier),
      timeout,
      parallelism,
      qualityDepth,
      reviewEnabled,
      reasoning: this.generateAllocationReasoning(constraints, modelTier),
    };
  }

  /**
   * 预估成本
   */
  estimateCost(
    requirements: ResourceRequirement,
    constraints: ConstraintProfile,
  ): CostEstimate {
    const modelTier = constraints.cost.modelPreference;
    const { input, output, isFallback } = this.getCostPerKTokens(modelTier);

    // 假设输入输出 token 比例为 3:1
    const inputTokens = requirements.estimatedTokens * 0.75;
    const outputTokens = requirements.estimatedTokens * 0.25;

    const inputCost = (inputTokens / 1000) * input;
    const outputCost = (outputTokens / 1000) * output;
    const baseCost = inputCost + outputCost;

    // 如果需要审核，增加额外成本
    let reviewCost = 0;
    if (constraints.quality.reviewRequired) {
      reviewCost = baseCost * 0.2; // 审核增加 20% 成本
    }

    // 如果需要多次迭代，增加成本
    const iterationMultiplier =
      constraints.quality.depth === "comprehensive"
        ? 1.5
        : constraints.quality.depth === "standard"
          ? 1.2
          : 1.0;

    const totalCost = (baseCost + reviewCost) * iterationMultiplier;

    const breakdown: CostBreakdown[] = [
      {
        category: "模型调用",
        description: `${MODEL_MAPPING[modelTier]} 输入/输出`,
        cost: baseCost,
        percentage: baseCost / totalCost,
      },
    ];

    if (reviewCost > 0) {
      breakdown.push({
        category: "质量审核",
        description: "Leader 审核成本",
        cost: reviewCost,
        percentage: reviewCost / totalCost,
      });
    }

    if (iterationMultiplier > 1) {
      breakdown.push({
        category: "迭代成本",
        description: `${constraints.quality.depth} 深度迭代`,
        cost: totalCost - baseCost - reviewCost,
        percentage: (totalCost - baseCost - reviewCost) / totalCost,
      });
    }

    return {
      totalCost: Math.round(totalCost),
      breakdown,
      estimatedDuration: requirements.estimatedDuration,
      confidence: 0.8,
      withinBudget: totalCost <= constraints.cost.budget,
      overBudgetAmount:
        totalCost > constraints.cost.budget
          ? totalCost - constraints.cost.budget
          : undefined,
      pricingSource: isFallback ? "fallback" : "registry",
    };
  }

  /**
   * 建议降级策略
   */
  suggestDegradation(
    violation: ConstraintViolation,
    constraints: ConstraintProfile,
  ): DegradationStrategy[] {
    const strategies: DegradationStrategy[] = [];

    if (violation.type === "cost") {
      // 成本超标：建议模型降级
      if (constraints.cost.modelPreference !== "cheap") {
        strategies.push({
          type: "model_downgrade",
          description: "降级到更便宜的模型",
          expectedSaving: {
            cost: violation.excess * 0.6,
          },
          qualityImpact: "minor",
          apply: () => ({
            cost: {
              ...constraints.cost,
              modelPreference: this.downgradeModelTier(
                constraints.cost.modelPreference,
              ),
            },
          }),
        });
      }

      // 减少并行度
      if (constraints.efficiency.maxParallelism > 1) {
        strategies.push({
          type: "reduce_parallelism",
          description: "减少并行执行数量",
          expectedSaving: {
            cost: violation.excess * 0.3,
          },
          qualityImpact: "none",
          apply: () => ({
            efficiency: {
              ...constraints.efficiency,
              maxParallelism: Math.max(
                1,
                constraints.efficiency.maxParallelism - 1,
              ),
            },
          }),
        });
      }
    }

    if (violation.type === "efficiency") {
      // 时间超标：跳过审核
      if (constraints.quality.reviewRequired) {
        strategies.push({
          type: "skip_review",
          description: "跳过质量审核环节",
          expectedSaving: {
            time: violation.excess * 0.3,
          },
          qualityImpact: "moderate",
          apply: () => ({
            quality: {
              ...constraints.quality,
              reviewRequired: false,
            },
          }),
        });
      }

      // 降低质量深度
      if (constraints.quality.depth !== "quick") {
        strategies.push({
          type: "reduce_iterations",
          description: "降低研究深度",
          expectedSaving: {
            time: violation.excess * 0.4,
          },
          qualityImpact: "moderate",
          apply: () => ({
            quality: {
              ...constraints.quality,
              depth: this.downgradeQualityDepth(constraints.quality.depth),
            },
          }),
        });
      }
    }

    return strategies;
  }

  /**
   * 重新平衡约束
   */
  rebalance(
    constraints: ConstraintProfile,
    priority: "cost" | "quality" | "efficiency",
  ): ConstraintProfile {
    switch (priority) {
      case "cost":
        // 优先成本：降低质量和效率要求
        return createConstraintProfile("fast", {
          cost: constraints.cost,
        });

      case "quality":
        // 优先质量：增加预算和时间
        return createConstraintProfile("thorough", {
          quality: constraints.quality,
        });

      case "efficiency":
        // 优先效率：降低质量，增加并行
        return {
          ...constraints,
          quality: {
            ...constraints.quality,
            depth: "quick",
            reviewRequired: false,
          },
          efficiency: {
            ...constraints.efficiency,
            maxParallelism: 5,
            allowParallel: true,
          },
        };

      default:
        return constraints;
    }
  }

  /**
   * 检查是否可以继续执行
   */
  canContinue(
    constraints: ConstraintProfile,
    currentUsage: ResourceUsage,
  ): { canContinue: boolean; reason?: string } {
    // 检查成本
    if (
      currentUsage.costUsed > constraints.cost.budget &&
      !constraints.cost.allowOverBudget
    ) {
      return {
        canContinue: false,
        reason: `已超出预算限制（${currentUsage.costUsed}/${constraints.cost.budget}）`,
      };
    }

    // 检查时间
    if (currentUsage.timeElapsed > constraints.efficiency.maxDuration) {
      return {
        canContinue: false,
        reason: `已超出时间限制（${currentUsage.timeElapsed}ms/${constraints.efficiency.maxDuration}ms）`,
      };
    }

    // 检查返工次数
    if (currentUsage.reworkCount > constraints.quality.maxReworks) {
      return {
        canContinue: false,
        reason: `已达到最大返工次数（${currentUsage.reworkCount}/${constraints.quality.maxReworks}）`,
      };
    }

    return { canContinue: true };
  }

  // ==================== 私有方法 ====================

  /**
   * 评估成本
   */
  private evaluateCost(
    constraint: CostConstraint,
    usage: ResourceUsage,
  ): CostEvaluation {
    const usageRate = usage.costUsed / constraint.budget;
    const estimatedTotal =
      usage.progress > 0 ? usage.costUsed / usage.progress : usage.costUsed * 2;

    let status: CostEvaluation["status"];
    if (usageRate >= 1) {
      status = "exceeded";
    } else if (usageRate >= 0.9) {
      status = "critical";
    } else if (usageRate >= constraint.warningThreshold) {
      status = "warning";
    } else {
      status = "healthy";
    }

    return {
      currentUsage: usage.costUsed,
      budget: constraint.budget,
      usageRate,
      remaining: constraint.budget - usage.costUsed,
      estimatedTotal,
      willExceedBudget: estimatedTotal > constraint.budget,
      status,
    };
  }

  /**
   * 评估质量
   */
  private evaluateQuality(
    constraint: QualityConstraint,
    usage: ResourceUsage,
  ): QualityEvaluation {
    const currentScore = usage.qualityScore ?? 0;
    const meetRequirement = currentScore >= constraint.minReviewScore;

    let status: QualityEvaluation["status"];
    if (currentScore >= 9) {
      status = "excellent";
    } else if (currentScore >= 7) {
      status = "good";
    } else if (currentScore >= constraint.minReviewScore) {
      status = "acceptable";
    } else {
      status = "poor";
    }

    return {
      currentScore,
      requiredScore: constraint.minReviewScore,
      meetRequirement,
      reviewCount: usage.reviewCount,
      reworkCount: usage.reworkCount,
      maxReworks: constraint.maxReworks,
      status,
    };
  }

  /**
   * 评估效率
   */
  private evaluateEfficiency(
    constraint: EfficiencyConstraint,
    usage: ResourceUsage,
  ): EfficiencyEvaluation {
    const timeUsageRate = usage.timeElapsed / constraint.maxDuration;
    const estimatedCompletion =
      usage.progress > 0
        ? usage.timeElapsed / usage.progress
        : usage.timeElapsed * 2;

    let status: EfficiencyEvaluation["status"];
    if (timeUsageRate >= 1) {
      status = "timeout";
    } else if (timeUsageRate >= 0.9) {
      status = "delayed";
    } else if (timeUsageRate >= 0.7) {
      status = "at_risk";
    } else {
      status = "on_track";
    }

    return {
      elapsedTime: usage.timeElapsed,
      maxDuration: constraint.maxDuration,
      timeUsageRate,
      remainingTime: constraint.maxDuration - usage.timeElapsed,
      estimatedCompletion,
      willTimeout: estimatedCompletion > constraint.maxDuration,
      status,
    };
  }

  /**
   * 计算整体健康度
   */
  private calculateHealthScore(
    cost: CostEvaluation,
    quality: QualityEvaluation,
    efficiency: EfficiencyEvaluation,
  ): number {
    // 各维度权重
    const weights = { cost: 0.3, quality: 0.4, efficiency: 0.3 };

    // 成本得分
    const costScore =
      cost.status === "healthy"
        ? 1
        : cost.status === "warning"
          ? 0.7
          : cost.status === "critical"
            ? 0.4
            : 0;

    // 质量得分
    const qualityScore =
      quality.status === "excellent"
        ? 1
        : quality.status === "good"
          ? 0.8
          : quality.status === "acceptable"
            ? 0.6
            : 0.3;

    // 效率得分
    const efficiencyScore =
      efficiency.status === "on_track"
        ? 1
        : efficiency.status === "at_risk"
          ? 0.7
          : efficiency.status === "delayed"
            ? 0.4
            : 0;

    return (
      weights.cost * costScore +
      weights.quality * qualityScore +
      weights.efficiency * efficiencyScore
    );
  }

  /**
   * 降级模型层级
   */
  private downgradeModelTier(tier: ModelPreference): ModelPreference {
    if (tier === "premium") return "balanced";
    if (tier === "balanced") return "cheap";
    return "cheap";
  }

  /**
   * 降级质量深度
   */
  private downgradeQualityDepth(depth: QualityDepth): QualityDepth {
    if (depth === "comprehensive") return "standard";
    if (depth === "standard") return "quick";
    return "quick";
  }

  /**
   * 计算指定模型的成本
   */
  private estimateCostForModel(tokens: number, tier: ModelPreference): number {
    const { input, output } = this.getCostPerKTokens(tier);
    const inputTokens = tokens * 0.75;
    const outputTokens = tokens * 0.25;
    return (inputTokens / 1000) * input + (outputTokens / 1000) * output;
  }

  /**
   * 计算最大 Token 数
   */
  private calculateMaxTokens(budget: number, tier: ModelPreference): number {
    const { input, output } = this.getCostPerKTokens(tier);
    const avgCostPer1K = input * 0.75 + output * 0.25;
    return Math.floor((budget / avgCostPer1K) * 1000);
  }

  /**
   * 生成分配理由
   */
  private generateAllocationReasoning(
    constraints: ConstraintProfile,
    actualTier: ModelPreference,
  ): string {
    const reasons: string[] = [];

    if (actualTier !== constraints.cost.modelPreference) {
      reasons.push(
        `模型从 ${constraints.cost.modelPreference} 降级到 ${actualTier} 以控制成本`,
      );
    }

    if (constraints.quality.reviewRequired) {
      reasons.push("已启用质量审核");
    }

    if (constraints.quality.depth === "comprehensive") {
      reasons.push("使用深度研究模式，可能需要更多迭代");
    }

    return reasons.length > 0 ? reasons.join("；") : "标准配置分配";
  }
}
