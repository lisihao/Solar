/**
 * LeaderAgent —— Mission 唯一最终负责对象（multi-phase）
 *
 * 设计 (Lead-Replanner-Lite, baseline §Leader-as-Single-Responsibility):
 *   • 单一 LLM agent spec，全程在 4 个 milestone 在场
 *   • 每个 phase 的 input 包含"自己之前说过的话"，让 LLM 真正承担过程责任
 *   • 业务规则强制 M7 的 accountabilityNote 引用过去决策（防止橡皮图章签字）
 *
 * 4 个 phase:
 *   M0 plan            — 维度规划 + 声明 successCriteria/qualityBar/deliverables
 *   M1 assess-research — researchers 完成后做过程管理（accept/patch/redirect/abort）
 *   M6 foreword        — 写 meta-level 综合摘要（vs Writer 的 ExecutiveSummary）
 *   M7 signoff         — 签字 + 自评分 + accountabilityNote
 *
 * Prompt 不嵌在 .ts 里 —— 走 SKILL.md `<!-- duty:<phase>:start -->` body anchor，
 * 由 duty-loader（委托 skill-md-loader）加载并模板渲染。
 *
 * 生命周期:
 *   AgentRunner.run(LeaderAgent, { phase: ..., ... })
 *   ↑ 由 LeaderService.create() → SupervisedMission 在每个 milestone 调用，
 *     传入累积的 missionContext
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../_shared/skill-loader";
import { DIMENSION_FACETS } from "../../../api/contracts/dimension-tool-matrix";

// ── 共享子 schema ──
const Goals = z.object({
  successCriteria: z.array(z.string().min(8)).min(1).max(10),
  qualityBar: z.object({
    minSources: z.number().int().min(0).max(50),
    minCoverage: z.number().int().min(0).max(100),
    hardConstraints: z.array(z.string()).default([]),
  }),
  deliverables: z.array(z.string().min(4)).min(1).max(8),
});

const InitialRisk = z.object({
  type: z.string().min(2),
  severity: z.enum(["low", "medium", "high"]),
  mitigation: z.string().min(8),
});

const Dimension = z.object({
  id: z.string(),
  // ★ PR-A0 (2026-05-06 v1.4 安全 B9): dim.name 入装前防 CRLF / H2 注入：
  //   - 长度 ≤200（防超长撑爆）
  //   - 禁 \r / \n（StructuralReportAssembler 会 prepend `## {name}`，多行注入会插入新章节）
  //   下游 sanitizePlan 仍会再 strip + slice 兜底，但 schema 层先拒不合规输入
  name: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^\r\n]+$/, "dim.name 不得含换行（防 H2 章节注入）"),
  rationale: z.string(),
  // ★ 2026-05-22 矩阵配置：维度业务类型。Leader 只做这一个分类，工具集由
  //   FACET_TOOL_MATRIX 确定性派生（见 dimension-tool-matrix.ts）。缺省 general 兜底。
  facet: z.enum(DIMENSION_FACETS).default("general"),
  toolHint: z.object({
    categories: z.array(z.string()).min(1),
    preferIds: z.array(z.string()).optional(),
  }),
  dependsOn: z.array(z.string()).optional(),
});

/** Leader 自己历史决策的简化记录（喂给后续 phase 用） */
const PastDecision = z.object({
  phase: z.enum(["plan", "assess-research", "foreword"]),
  at: z.string(),
  decision: z.string(),
  rationale: z.string(),
});

const ResearcherOutcome = z.object({
  dimensionId: z.string(),
  dimensionName: z.string(),
  state: z.enum(["completed", "degraded", "failed"]),
  findingsCount: z.number().int().min(0),
  sources: z.array(z.string()),
  summary: z.string(),
  failureCode: z.string().optional(),
  // ★ 2026-05-07 P0 修法 A：S4 stage 注入的明确达标判定（避免 Leader LLM 心算偏差）
  meetsMinSources: z.boolean().optional(),
  minSourcesRequired: z.number().int().min(0).optional(),
  minSourcesDelta: z.number().int().min(0).optional(),
  // ★ 2026-05-21 P2 闭环：唯一域名数（单域 dim 已折进 meetsMinSources=false 触发重采）
  uniqueDomains: z.number().int().min(0).optional(),
});

const QualitySnapshot = z.object({
  sourceCount: z.number().int().min(0),
  coverageScore: z.number().int().min(0).max(100),
  overall: z.number().int().min(0).max(100),
  finalVerdict: z.string(),
  reviewerAvgScore: z.number().int().min(0).max(100).optional(),
  criticVerdict: z.enum(["pass", "concerns", "fail"]).optional(),
  criticBlindspots: z.array(z.string()).default([]),
  criticBiases: z.array(z.string()).default([]),
  // ★ 沉淀消费 v3 (2026-04-29): 10 维客观评审（EVALUATOR 模型独立打分）
  objectiveScore: z.number().int().min(0).max(100).optional(),
  objectiveGrade: z.string().optional(),
  objectiveFeedback: z.string().optional(),
});

// ── Input: discriminated union by phase ──
const Input = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("plan"),
    topic: z.string(),
    /** 选填长文本描述，由 RunMissionInput.description 透传 */
    description: z.string().max(10000).optional(),
    depth: z.enum(["quick", "standard", "deep"]),
    language: z.enum(["zh-CN", "en-US"]),
    userProfile: z.unknown().optional(),
    // ★ P0#2 (2026-04-29): S12 → S2 闭环
    // 用户最近 3 个同 namespace 的 postmortem，让 Leader plan 阶段
    // 显式参考"过去同 user 的失败教训 / 拒签原因 / 改进建议"
    priorPostmortems: z
      .array(
        z.object({
          missionId: z.string(),
          topic: z.string(),
          summary: z.string(),
          recommendations: z.array(z.string()),
          leaderSigned: z.boolean().nullable(),
          qualityScore: z.number().nullable(),
          createdAt: z.string(), // ISO date string
        }),
      )
      .default([]),
  }),
  z.object({
    phase: z.literal("assess-research"),
    topic: z.string(),
    description: z.string().max(10000).optional(),
    language: z.enum(["zh-CN", "en-US"]),
    myPlan: z.object({
      goals: Goals,
      dimensions: z.array(Dimension),
    }),
    researcherOutcomes: z.array(ResearcherOutcome),
  }),
  z.object({
    phase: z.literal("foreword"),
    topic: z.string(),
    description: z.string().max(10000).optional(),
    language: z.enum(["zh-CN", "en-US"]),
    myPlan: z.object({ goals: Goals, dimensions: z.array(Dimension) }),
    myDecisions: z.array(PastDecision).default([]),
    stageOutcomes: z.object({
      researcherStates: z.array(
        z.object({
          name: z.string(),
          state: z.enum(["completed", "degraded", "failed"]),
        }),
      ),
      reconciliation: z
        .object({
          factCount: z.number().int(),
          conflictCount: z.number().int(),
          criticalGaps: z.array(z.string()).default([]),
        })
        .optional(),
      writerSections: z.array(z.string()),
      qualitySnapshot: QualitySnapshot,
    }),
  }),
  z.object({
    phase: z.literal("signoff"),
    topic: z.string(),
    description: z.string().max(10000).optional(),
    language: z.enum(["zh-CN", "en-US"]),
    myPlan: z.object({ goals: Goals, dimensions: z.array(Dimension) }),
    myDecisions: z.array(PastDecision).default([]),
    myForeword: z.object({
      whatWeAnswered: z.array(
        z.object({
          criterion: z.string(),
          addressed: z.enum(["yes", "partial", "no"]),
          evidence: z.string(),
        }),
      ),
      whatRemainsUnclear: z.array(z.string()).default([]),
    }),
    finalQuality: z.object({
      sourceCount: z.number().int(),
      coverageScore: z.number().int(),
      overall: z.number().int(),
      finalVerdict: z.string(),
      wordCount: z.number().int(),
      reviewerAvgScore: z.number().int().optional(),
      criticVerdict: z.enum(["pass", "concerns", "fail"]).optional(),
      // ★ 沉淀消费 v3 (2026-04-29): 10 维客观评审（EVALUATOR 模型独立打分）
      objectiveScore: z.number().int().optional(),
      objectiveGrade: z.string().optional(),
      objectiveFeedback: z.string().optional(),
      // ★ P0#3 (2026-04-29): 字数兑现率 — <60 强制 verdict ≤ acceptable
      lengthAccuracy: z.number().int().optional(),
      targetWordCount: z.number().int().optional(),
    }),
    dimensionStates: z.array(
      z.object({
        name: z.string(),
        state: z.enum(["completed", "degraded", "failed"]),
      }),
    ),
  }),
]);

// ── Output: discriminated union by phase ──
const Output = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("plan"),
    themeSummary: z.string().min(20),
    dimensions: z.array(Dimension).min(2).max(12),
    goals: Goals,
    initialRisks: z.array(InitialRisk).default([]),
  }),
  z.object({
    phase: z.literal("assess-research"),
    decision: z.enum(["accept-all", "patch", "redirect", "abort"]),
    rationale: z.string().min(20),
    perDimension: z.array(
      z.object({
        dimensionId: z.string(),
        action: z.enum([
          "accept",
          "accept-degraded",
          "retry-with-critique",
          "replace-spec",
          "abort",
        ]),
        critique: z.string().optional(),
        newAgentSpecId: z.string().optional(),
        // ★ 2026-04-30 REDESIGN (task #61): retry 双路径策略
        // fresh-collect: 重新跑 researcher（findings 不可信，需重新采集）→ 新 todo 行 + 独立 pipeline
        // reuse-recompute: 利旧 findings（findings 可用，只是写作/评估有问题）→ 不新增 todo, 重跑 chapter+grade，原 dim todo 退回 in_progress 显示新 grade
        // 仅 action=retry-with-critique/replace-spec 时有效，accept/accept-degraded/abort 忽略
        strategy: z
          .enum(["fresh-collect", "reuse-recompute"])
          .optional()
          .describe(
            "retry 策略：fresh-collect=重新采集（findings 不可信）/ reuse-recompute=利旧重算（findings 可用，只重写章节+评分）",
          ),
      }),
    ),
    newDimensions: z.array(Dimension).default([]),
  }),
  z.object({
    phase: z.literal("foreword"),
    whatWeAnswered: z
      .array(
        z.object({
          criterion: z.string().min(4),
          addressed: z.enum(["yes", "partial", "no"]),
          evidence: z.string().min(8),
        }),
      )
      .min(1)
      .max(10),
    whatRemainsUnclear: z.array(z.string().min(4)).max(8).default([]),
    howToRead: z.string().min(20).max(500),
    recommendedFollowUp: z.array(z.string().min(4)).max(6).default([]),
  }),
  z.object({
    phase: z.literal("signoff"),
    leaderOverallScore: z.number().int().min(0).max(100),
    leaderVerdict: z.enum(["excellent", "good", "acceptable", "failed"]),
    accountabilityNote: z.string().min(50).max(1500),
    signed: z.boolean(),
    refusalReason: z.string().optional(),
  }),
]);

// 公开类型方便 LeaderService / orchestrator 使用
export type LeaderInput = z.infer<typeof Input>;
export type LeaderOutput = z.infer<typeof Output>;
export type LeaderPlanOutput = Extract<LeaderOutput, { phase: "plan" }>;
export type LeaderAssessResearchOutput = Extract<
  LeaderOutput,
  { phase: "assess-research" }
>;
export type LeaderForewordOutput = Extract<LeaderOutput, { phase: "foreword" }>;
export type LeaderSignoffOutput = Extract<LeaderOutput, { phase: "signoff" }>;

@DefineAgent({
  id: "playground.leader",
  version: "2.0.0",
  identity: {
    role: "leader",
    description:
      "Mission 唯一最终负责对象。在 plan / assess-research / foreword / signoff 4 个 milestone 全程在场，对最终产物签字承担问责。",
  },
  loop: "react",
  // PR-X-skill-bridge: Leader 4 个 phase 的协议都激活；SkillActivator 把
  // SKILL.md instructions 注入为 high-priority reminder，LLM 按 phase 选用
  skills: [
    "mece-mission-planning", // M0
    "leader-mid-mission-assess", // M1
    "leader-foreword", // M6
    "leader-signoff", // M7
  ],
  toolCategories: ["information"],
  taskProfile: {
    creativity: "low",
    outputLength: "medium",
    reasoningDepth: "moderate",
  },
  inputSchema: Input,
  outputSchema: Output,
  // 不显式配 maxWallTimeMs —— harnessed-agent 提供全局 5min 默认（2026-05-05
  // 机制性修复：所有 agent 自动兜底 wall-time，避免散点补充）
  budget: { maxTokens: 16_000, maxIterations: 4 },
})
export class LeaderAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const dutyName: Record<typeof input.phase, string> = {
      plan: "plan",
      "assess-research": "assess-research",
      foreword: "foreword",
      signoff: "signoff",
    };
    // 计算 plan phase 才用得到的辅助变量
    const enriched: Record<string, unknown> = {
      ...(input as unknown as Record<string, unknown>),
    };
    if (input.phase === "plan") {
      enriched.currentDate = new Date().toISOString().slice(0, 10);
      enriched.currentYear = new Date().getFullYear();
      // ★ 2026-05-07: 洞察类型定义 v1（用户对齐：deep = 10-12 维 × 6-8 章 × 1500-2500 字 ≈ 12-15万字）
      enriched.dimensionsTarget =
        input.depth === "quick"
          ? "3-5"
          : input.depth === "deep"
            ? "10-12"
            : "5-8";
    }
    return buildPromptFromDuty("leader", dutyName[input.phase], enriched);
  }

  /**
   * 业务规则校验（mission-pipeline-baseline.md §Leader）
   *
   * 重点:
   *   - plan: dim 数量符合 depth target + dim id 唯一
   *   - assess-research: perDimension 必须覆盖所有 dim, retry/replace 必填补充字段
   *   - foreword: 有 degraded / critical gap 时 whatRemainsUnclear 不能为空
   *   - signoff:
   *     · signed=false 必须填 refusalReason
   *     · verdict ↔ score 一致
   *     · accountabilityNote 必须引用历史决策
   */
  validateBusinessRules(
    output: z.infer<typeof Output>,
    ctx: { input?: z.infer<typeof Input>; identity: unknown },
  ): void {
    const issues: string[] = [];
    // ★ 防御性 guard：harness 链路异常时 ctx.input 可能是 undefined。
    //   不再依赖 ctx.input.phase 做分支 —— 用 output.phase（discriminated
    //   union 自带 phase 字段）做主分支判断，需要 input 字段的检查在内部
    //   显式判 ctx.input 是否存在，缺失时跳过该项校验而不是崩溃。
    const inputPhase = ctx.input?.phase;

    if (output.phase === "plan") {
      // depth-dim count 检查需要 ctx.input.depth；缺失时跳过这一条但仍校验 id 唯一
      if (ctx.input && inputPhase === "plan") {
        const target =
          ctx.input.depth === "quick"
            ? [3, 5]
            : ctx.input.depth === "deep"
              ? [8, 12]
              : [5, 8];
        if (
          output.dimensions.length < target[0] ||
          output.dimensions.length > target[1]
        ) {
          issues.push(
            `depth=${ctx.input.depth} 要求 ${target[0]}-${target[1]} dim, 实际 ${output.dimensions.length}`,
          );
        }
      }
      const ids = new Set<string>();
      for (const d of output.dimensions) {
        if (ids.has(d.id))
          issues.push(`dimension id "${d.id}" 重复（M0 必须唯一）`);
        ids.add(d.id);
      }
    }

    if (
      output.phase === "assess-research" &&
      ctx.input &&
      inputPhase === "assess-research"
    ) {
      const dimIds = new Set(
        ctx.input.researcherOutcomes.map((r) => r.dimensionId),
      );
      const coveredIds = new Set(output.perDimension.map((p) => p.dimensionId));
      for (const id of dimIds) {
        if (!coveredIds.has(id)) {
          issues.push(
            `perDimension 缺少 dim ${id} 的处理决策（必须覆盖所有 dim）`,
          );
        }
      }
      if (
        output.decision === "patch" &&
        output.perDimension.every((p) => p.action === "accept")
      ) {
        issues.push(
          `decision=patch 但 perDimension 全是 accept（应至少 1 个 retry/replace/abort/accept-degraded）`,
        );
      }
      for (const p of output.perDimension) {
        if (p.action === "retry-with-critique" && !p.critique) {
          issues.push(
            `dim ${p.dimensionId} action=retry-with-critique 但 critique 缺失`,
          );
        }
        if (p.action === "replace-spec" && !p.newAgentSpecId) {
          issues.push(
            `dim ${p.dimensionId} action=replace-spec 但 newAgentSpecId 缺失`,
          );
        }
        // ★ 2026-04-30 REDESIGN (task #61): strategy 缺省 fresh-collect 向后兼容旧路径
        // schema 已声明 strategy 为 optional，不强制业务校验避免老 case 被拒签
      }
    }

    if (output.phase === "foreword" && ctx.input && inputPhase === "foreword") {
      const hasDegraded = ctx.input.stageOutcomes.researcherStates.some(
        (s) => s.state !== "completed",
      );
      const hasCriticalGap =
        (ctx.input.stageOutcomes.reconciliation?.criticalGaps.length ?? 0) > 0;
      const hasCriticConcern =
        ctx.input.stageOutcomes.qualitySnapshot.criticVerdict === "fail" ||
        ctx.input.stageOutcomes.qualitySnapshot.criticBlindspots.length > 0;
      if (
        (hasDegraded || hasCriticalGap || hasCriticConcern) &&
        output.whatRemainsUnclear.length === 0
      ) {
        issues.push(
          `存在 degraded dim / critical gap / critic concern，但 whatRemainsUnclear 为空（Lead 必须诚实）`,
        );
      }
      const expectedCount = ctx.input.myPlan.goals.successCriteria.length;
      if (output.whatWeAnswered.length < expectedCount) {
        issues.push(
          `whatWeAnswered 只覆盖 ${output.whatWeAnswered.length} 条，应覆盖 ${expectedCount} 条 successCriteria`,
        );
      }
    }

    if (output.phase === "signoff") {
      if (!output.signed && !output.refusalReason) {
        issues.push("signed=false 时必须填 refusalReason");
      }
      const v = output.leaderVerdict;
      const s = output.leaderOverallScore;
      if (v === "excellent" && s < 80)
        issues.push(`verdict=excellent 但 score=${s} < 80`);
      if (v === "good" && (s < 65 || s >= 90))
        issues.push(`verdict=good 但 score=${s} 不在 [65,90)`);
      if (v === "acceptable" && (s < 45 || s >= 75))
        issues.push(`verdict=acceptable 但 score=${s} 不在 [45,75)`);
      if (v === "failed" && s >= 60)
        issues.push(`verdict=failed 但 score=${s} >= 60`);
      const note = output.accountabilityNote;
      if (!/M[0-9]|我在|我决定|我让|我之前|当时|我作为|本次/.test(note)) {
        issues.push(
          `accountabilityNote 必须引用历史决策（含 "我在/我决定/M0/M1/M6/当时" 等关键词），不接受空话`,
        );
      }
      // ★ P0#3 (2026-04-29): lengthAccuracy 兜底
      // 即使 LLM 给出 excellent/good，但实际字数严重缩水（<60 即承诺 vs 实际偏差 > 40%）
      // 时强制降级为 acceptable，避免 leader 给 mega 承诺 200K 实际 50K 的报告"excellent"
      if (
        ctx.input &&
        typeof ctx.input === "object" &&
        "phase" in ctx.input &&
        ctx.input.phase === "signoff"
      ) {
        const fq = ctx.input.finalQuality;
        if (
          typeof fq.lengthAccuracy === "number" &&
          fq.lengthAccuracy < 60 &&
          (v === "excellent" || v === "good")
        ) {
          issues.push(
            `lengthAccuracy=${fq.lengthAccuracy} (字数严重偏离 lengthProfile target，` +
              `实际 ${fq.wordCount} vs 期望 ${fq.targetWordCount ?? "?"}），` +
              `verdict 不能高于 acceptable。请重新 sign off：调整 verdict ≤ acceptable，` +
              `并在 accountabilityNote 中说明 mission 未达成字数承诺。`,
          );
        }
      }
    }

    if (issues.length > 0) {
      throw new Error(issues.join("; "));
    }
  }
}
