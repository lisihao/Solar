/**
 * DeepInsightStageBindings —— deep-insight 14 阶段执行内核（能力家提供）。
 *
 * 设计依据：docs/architecture/capability-execution-architecture.md §2.1 / §3 / §4。
 *
 * 职责：为 recipe 的每个 step 提供该 step primitive 所需的 ResolvedStageHooks。
 *   - 调哪个 agent / 产出写哪 / 喂下游什么 —— 全部在此 wiring（**不重写 prompt**：
 *     agent 与 skill 是共享的，recipe 已 load SKILL.md；本文件只是 wiring）。
 *   - 中间态全程走 harness CrossStageState（key 用 deep-insight.* 前缀），零 app DB。
 *   - LLM 调用统一经 invokeAgent → harness AgentRunner（共享 @DefineAgent）。
 *
 * 逻辑来源（§3 下沉表）：playground 13 个角色服务（Leader/Reconciler/Analyst/Writer/
 * Reviewer/Verifier/Steward + 评判组合）的"调哪个 agent + 写哪 + 喂什么"编排逻辑，
 * 改写为调共享 agent + 写 CrossStageState。
 *
 * 铁律（§1.2 R1/R2/R5）：零 app import；只依赖 harness facade + 共享 agent + 端口。
 */
import { Logger } from "@nestjs/common";
import type {
  AgentRunner,
  CrossStageState,
  ResolvedStageHooks,
  StageRunArgs,
} from "@/modules/ai-harness/facade";
import { defineStageHooks } from "@/modules/ai-harness/facade";
import type {
  ReportArtifactAssembler,
  SectionSelfEvalService,
  SectionRemediationService,
  ReportEvaluationService,
  QualityTraceComputeService,
  RemediationAction,
  FigureRelevanceService,
  ExtractedFigure,
} from "../../runner-deps";
import {
  CS_KEY,
  readPipelineInput,
  type StageBindings,
  type AgentInvocation,
} from "../ports";
import { invokeAgent, emitDomain } from "./agent-invoke.helper";
import {
  runGuardedSectionRemediation,
  type RemediableSection,
} from "./chapter-stream.helper";
import {
  computeDimensionGrades,
  type DimensionOutcomeLite,
} from "./dimension-grade.helper";
import {
  buildAssembleInput,
  buildChapterInputs,
  buildCriticArtifactSummary,
  asArtifact,
  type PlanShape,
  type AnalystShape,
  type WriterReportShape,
  type ReconciliationShape,
  type ReportArtifactLite,
} from "./report-assembler.helper";

const log = new Logger("DeepInsightStageBindings");

/**
 * 富评判 / 富组装服务束（全部 @Global HarnessModule 提供，runner 构造函数注入后透传）。
 * 设计依据：capability-execution-architecture.md §3「认知决策/编排下沉能力家；
 * 无状态打分/组装基元留 harness，能力家组合它」——本束即「组合」的注入点。
 */
export interface RichServices {
  readonly reportArtifactAssembler: ReportArtifactAssembler;
  readonly sectionSelfEval: SectionSelfEvalService;
  readonly sectionRemediation: SectionRemediationService;
  readonly reportEvaluation: ReportEvaluationService;
  readonly qualityTrace: QualityTraceComputeService;
  // ★ figure re-home（2026-06-09）：Stage-3 图文相关性精排（embedding），
  //   s8 组装前对 researcher 产出的 figureCandidates 按维度精排（与 playground s3 等价）。
  readonly figureRelevance: FigureRelevanceService;
}

/** plan 阶段的 Goals 形状（来自 leader plan Output.goals，供 s4/s10 myPlan.goals）。 */
interface GoalsShape {
  successCriteria: string[];
  qualityBar: {
    minSources: number;
    minCoverage: number;
    hardConstraints: string[];
  };
  deliverables: string[];
}

/** plan 阶段产物（维度拆解 + goals）。 */
interface PlanResult {
  themeSummary: string;
  dimensions: {
    id: string;
    name: string;
    rationale: string;
    toolHint?: { categories: string[]; preferIds?: string[] };
    facet?: string;
  }[];
  goals?: GoalsShape;
}

/** 单维 researcher 产物（findings + summary）。 */
interface ResearcherResult {
  dimension: string;
  findings: Array<{
    claim?: string;
    evidence?: string;
    source?: string;
    sourceTitle?: string;
    sourceSnippet?: string;
  }>;
  summary: string;
}

/** researcher 产出的图候选（图文相关性精排入参的原始形状）。 */
interface FigureCandidate {
  sourceUrl: string;
  imageUrl?: string;
  caption: string;
  sourcePageOrSection?: string;
  relevanceHint?: "high" | "medium" | "low";
}

/** 带可选图候选的 researcher 产物视图（rankFigureCandidates 用）。 */
interface FigureRankableResearcher {
  dimension: string;
  figureCandidates?: FigureCandidate[];
  [key: string]: unknown;
}

/** leaderJournal 单条记录（s2/s4/s10 各 append 一条）。 */
interface LeaderJournalEntry {
  stage: string;
  decision: string;
  summary: string;
  ts: number;
}

export class DeepInsightStageBindings implements StageBindings {
  constructor(
    private readonly runner: AgentRunner,
    private readonly rich: RichServices,
  ) {}

  buildHooksForStep(stepId: string): ResolvedStageHooks {
    switch (stepId) {
      case "s1-budget":
        return this.buildBudgetHooks();
      case "s2-leader-plan":
        return this.buildPlanHooks();
      case "s3-researcher-collect":
        return this.buildResearchHooks();
      case "s4-leader-assess":
        return this.buildAssessHooks();
      case "s5-reconciler":
        return this.buildReconcileHooks();
      case "s6-analyst":
        return this.buildAnalyzeHooks();
      case "s7-writer-outline":
        return this.buildOutlineHooks();
      case "s8-writer":
        return this.buildWriterHooks();
      case "s8b-quality-enhancement":
        return this.buildQualityEnhanceHooks();
      case "s9-critic":
        return this.buildCriticHooks();
      case "s9b-objective-eval":
        return this.buildObjectiveEvalHooks();
      case "s10-leader-foreword-signoff":
        return this.buildSignoffHooks();
      case "s11-persist":
        return this.buildPersistHooks();
      default:
        throw new Error(
          `[deep-insight bindings] 无 hook builder for step "${stepId}"`,
        );
    }
  }

  // ── S1 budget gate（persist primitive，budget-pre 模式；无 LLM）──────────────
  private buildBudgetHooks(): ResolvedStageHooks {
    return defineStageHooks({
      persist: async (): Promise<void> => {
        // budget gate 是预算闸；能力内核不直连 DB——预算/计费由消费方在 ctx 注入。
        // 本 step 仅作 pipeline 锚点（s1-budget），无 app 副作用。
      },
    });
  }

  // ── S2 leader plan（plan primitive）──────────────────────────────────────────
  private buildPlanHooks(): ResolvedStageHooks {
    return defineStageHooks({
      runRole: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        const onEvent = input.invocation.onEvent;
        // ★ #16a 增量复用：plan 已由 inheritedBaseline seed（消费方"更新"场景）→ 直接复用，
        //   跳过 leader plan LLM。等价 OFF 路 hydrateInheritedPlan 后 S2 跳过。fresh run 时
        //   S2 入口 CS_KEY.plan 必为 undefined（只有本 hook 写它），crash-resume 整步跳过 S2，
        //   故"入口已有 plan"唯一对应 inherited 场景，判定无歧义。
        const seededPlan = full.crossStageState.get<PlanResult>(CS_KEY.plan);
        if (seededPlan) {
          // P2-b：seeded plan 复用时通知用户，避免 S2 静默跳过无任何反馈。
          emitDomain(onEvent, "agent:narrative", {
            stage: "s2-leader-plan",
            role: "leader",
            tag: "info",
            text: `复用上次 mission 的维度规划（${seededPlan.dimensions.length} 个维度），跳过重新规划`,
          });
          return seededPlan;
        }
        // ★ #16b narrate：S2 开始
        emitDomain(onEvent, "agent:narrative", {
          stage: "s2-leader-plan",
          role: "leader",
          tag: "thinking",
          text: "Leader 开始分析 topic，准备维度规划与声明 successCriteria",
        });
        const res = await invokeAgent({
          runner: this.runner,
          specId: "playground.leader",
          input: {
            phase: "plan",
            topic: input.topic,
            language: input.language,
            // ★ leader agent input schema 要求 depth 必填（深度档位决定维度数 target）。
            //   缺省回退 standard，避免硬切到能力轨后真 LLM 校验 "depth: Required" 失败。
            depth: input.invocation.depth ?? "standard",
            ...(input.invocation.description
              ? { description: input.invocation.description }
              : {}),
            // ★ env5 task3：透传历史 postmortem（leader plan 阶段看到历史教训再规划）。
            priorPostmortems: input.invocation.priorPostmortems
              ? [...input.invocation.priorPostmortems]
              : [],
          },
          invocation: input.invocation,
          crossStageState: full.crossStageState,
          signal: full.ctx.signal,
          stepId: "s2-leader-plan",
          role: "leader",
          operationType: "plan",
          onEvent,
        });
        const plan = this.normalizePlan(
          res.output,
          input.topic,
          input.invocation.depth ?? "standard",
        );
        full.crossStageState.set<PlanResult>(CS_KEY.plan, plan);
        // ★ goals 单独存一份方便 s4/s10 快速取（plan 整体也有，两份同步无冗余风险）。
        if (plan.goals) {
          full.crossStageState.set<GoalsShape>(CS_KEY.goals, plan.goals);
        }
        // ★ F2/F1 leaderJournal：s2 plan 决策追加一条。
        full.crossStageState.append<LeaderJournalEntry>(CS_KEY.leaderJournal, {
          stage: "s2-leader-plan",
          decision: "plan",
          summary: `规划 ${plan.dimensions.length} 个研究维度：${plan.dimensions
            .slice(0, 3)
            .map((d) => d.name)
            .join("、")}${plan.dimensions.length > 3 ? " 等" : ""}`,
          ts: Date.now(),
        });
        // ★ #16b P1：emit leader:goals-set domain 事件（对齐 OFF 路 s2 emitExtras）。
        emitDomain(onEvent, "leader:goals-set", {
          goals: plan.goals ?? {},
          initialRisks: [],
          dimensions: plan.dimensions,
        });
        // ★ #16b narrate：S2 完成
        emitDomain(onEvent, "agent:narrative", {
          stage: "s2-leader-plan",
          role: "leader",
          tag: "planning",
          text: `Leader 拆出 ${plan.dimensions.length} 个研究维度：${plan.dimensions
            .slice(0, 3)
            .map((d) => d.name)
            .join(" / ")}${plan.dimensions.length > 3 ? " 等" : ""}`,
        });
        // ★ #16b P1：stage:metrics（S2 完成）
        // C5 修复：dimensions 必须是 array of records（与 StageMetricsSchema 对齐），
        //   不能是 number；只投影 id/name/toolHint/rationale 四个文档化字段。
        emitDomain(onEvent, "stage:metrics", {
          stepId: "s2-leader-plan",
          dimensions: plan.dimensions.map((d) => ({
            id: d.id,
            name: d.name,
            toolHint: d.toolHint,
            rationale: d.rationale,
          })),
          themeSummary: plan.themeSummary,
        });
        return plan;
      },
      extractPlanFields: (raw: unknown) => {
        const plan = raw as PlanResult | undefined;
        return { dimensions: plan?.dimensions ?? [] };
      },
    });
  }

  // ── S3 researcher fan-out（research primitive）────────────────────────────────
  private buildResearchHooks(): ResolvedStageHooks {
    return defineStageHooks({
      fanOut: (args: { ctx: StageRunArgs["ctx"] }): ReadonlyArray<unknown> => {
        const full = this.fullArgs(args.ctx);
        const plan = full.crossStageState.get<PlanResult>(CS_KEY.plan);
        if (!plan) {
          throw new Error("[s3-researcher-collect] 无 plan（s2 未产出）");
        }
        // ★ #16b narrate：S3 开始派遣
        const input = readPipelineInput(full.ctx);
        const onEvent = input.invocation.onEvent;
        emitDomain(onEvent, "agent:narrative", {
          stage: "s3-researcher-collect",
          role: "researcher",
          tag: "info",
          text: `派遣 ${plan.dimensions.length} 个 Researcher 并行采集维度`,
        });
        return plan.dimensions;
      },
      perItemPipeline: async (args: {
        item: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        const onEvent = input.invocation.onEvent;
        const dim = args.item as { id: string; name: string };
        // ★ #16b P0：dimension:research:started
        emitDomain(onEvent, "dimension:research:started", {
          dimension: dim.name,
          stepId: "s3-researcher-collect",
        });
        // ★ #16a 增量复用：该维已有上次 mission 的 researcher 产物（inheritedBaseline seed 进
        //   暂存桶）→ 复用、跳过 web 检索（增量场景最贵/最慢的一段）。append 到 researcherResults
        //   走与 fresh 同一路径（终态产物形状一致），从暂存桶取避免重复 append。
        const inherited = full.crossStageState.get<ResearcherResult[]>(
          CS_KEY.inheritedResearch,
        );
        const reused = inherited?.find(
          (r) => (r as ResearcherResult | undefined)?.dimension === dim.name,
        );
        if (reused) {
          full.crossStageState.append<ResearcherResult>(
            CS_KEY.researcherResults,
            reused,
          );
          // Fix4：summary 截为 200 字预览，避免 multi-KB payload 洪泛 WS 总线。
          // summary 与 summaryPreview 同值——消费方期待 summary 字段，summaryPreview 保留向后兼容。
          emitDomain(onEvent, "dimension:research:completed", {
            dimension: dim.name,
            findingsCount: reused.findings?.length ?? 0,
            summary: (reused.summary ?? "").slice(0, 200),
            summaryPreview: (reused.summary ?? "").slice(0, 200),
            reused: true,
          });
          // Fix4：researcher:completed（复用路径同步）。
          emitDomain(onEvent, "researcher:completed", {
            dimension: dim.name,
            state: "completed",
            findingsCount: reused.findings?.length ?? 0,
            summary: (reused.summary ?? "").slice(0, 200),
          });
          return reused;
        }
        const res = await invokeAgent({
          runner: this.runner,
          specId: "playground.researcher",
          input: {
            topic: input.topic,
            dimension: dim.name,
            language: input.language,
            withFigures: input.invocation.withFigures ?? false,
            ...(input.invocation.description
              ? { description: input.invocation.description }
              : {}),
            ...(input.invocation.knowledgeBaseIds?.length
              ? { knowledgeBaseIds: [...input.invocation.knowledgeBaseIds] }
              : {}),
            ...(input.invocation.searchTimeRange
              ? { searchTimeRange: input.invocation.searchTimeRange }
              : {}),
          },
          invocation: input.invocation,
          crossStageState: full.crossStageState,
          signal: full.ctx.signal,
          stepId: "s3-researcher-collect",
          role: "researcher",
          dimension: dim.name,
          operationType: "research",
          onEvent,
        });
        // ReActLoop 到 maxIterations 未 finalize 时 output=null，不能伪装成功。
        if (res.output == null) {
          // ★ 恢复维度失败终态信号（projector ~:1128 dimension:graded handler）。
          // 选择依据：projector 无独立 "dimension:failed" handler；dimension:graded 是
          //   projector 中最近的"终态" handler，能 upsert dim todo 并追加 0/100 评分 artifact。
          //   handler 对已终态（cancelled/failed）保护，对 pending/in_progress 推进到 done。
          //   UI 显示 0/100，配合 agent:narrative error 叙述，用户可见失败原因。
          emitDomain(onEvent, "dimension:graded", {
            dimension: dim.name,
            overall: 0,
            grade: "F",
            summary: "采集失败（ReAct 未产出 findings），标记为不可用",
            state: "failed",
            action: "failed",
          });
          emitDomain(onEvent, "agent:narrative", {
            stage: "s3-researcher-collect",
            role: "researcher",
            tag: "error",
            dimension: dim.name,
            text: `维度"${dim.name}"采集失败（ReAct 未产出 findings），标记为不可用`,
          });
          throw new Error(
            `[s3-researcher-collect] dim "${dim.name}" 无有效产出`,
          );
        }
        const result = res.output as ResearcherResult;
        full.crossStageState.append<ResearcherResult>(
          CS_KEY.researcherResults,
          result,
        );
        // ★ #16b P0：dimension:research:completed
        // Fix4：summary 截为 200 字预览，避免 multi-KB payload 洪泛 WS 总线。
        // summary 与 summaryPreview 同值——消费方期待 summary 字段，summaryPreview 保留向后兼容。
        emitDomain(onEvent, "dimension:research:completed", {
          dimension: dim.name,
          findingsCount: result.findings?.length ?? 0,
          summary: (result.summary ?? "").slice(0, 200),
          summaryPreview: (result.summary ?? "").slice(0, 200),
          reused: false,
        });
        // Fix4：researcher:completed（对齐 projector researcher:completed 分支 handler）。
        // 形状对标 s3-researcher-collect-findings.stage.ts:780 老 emitter。
        emitDomain(onEvent, "researcher:completed", {
          dimension: dim.name,
          state: "completed",
          findingsCount: result.findings?.length ?? 0,
          summary: (result.summary ?? "").slice(0, 200),
        });
        return result;
      },
      onPatchFailure: (_args: { item: unknown; error: unknown }): void => {
        // 单维失败不阻断 mission（research primitive 已计 failureCount）；
        // 终态有效产出数量由 runner 兜底判定（全失败 → failed）。
        // 注：维度失败终态信号在 perItemPipeline null-output throw 路径前发射
        // （见 throw 前的 emitDomain dimension:graded / agent:narrative），不在此重复。
      },
    });
  }

  // ── S4 leader assess（assess primitive，真决策 + patch 失败跟踪）─────────────────
  //
  // 富增强（W2.5，对齐 playground s4-leader-assess）：
  //   1. runRole 跑 leader assess-research，产出 decision ∈ accept-all/patch/redirect/abort
  //      + perDimension（每维 accept/retry-with-critique/replace-spec/abort）。
  //   2. parseDecision 把 leader verdict 映射到 assess primitive 的 4 路决策：
  //      abort → abort-mission（primitive 原生抛 StageAbortError 终止 mission）；
  //      patch/redirect → retry-some（标记需补救）；accept-all → continue。
  //   3. dispatchAssessActions 把 patch/redirect 的弱维度记进 ctx.s4PatchFailures——
  //      s10 signoff 的 accountability hook 据此强制拒签（防"评估说要补救但没补就签字"）。
  //
  // 范围说明（已在返回里 flag 为后续波）：本波**不做**并行重派 researcher 的完整
  //   patch-retry 闭环（需 DAGExecutor 重跑 per-dim pipeline，属更大子系统）。本波交付
  //   "真决策 + abort 终止 + 失败跟踪供 s10 硬门"，这是 signoff 完整性的 parity-critical 部分。
  private buildAssessHooks(): ResolvedStageHooks {
    return defineStageHooks({
      runRole: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        const onEvent = input.invocation.onEvent;
        const plan = full.crossStageState.get<PlanResult>(CS_KEY.plan);
        const researcherResults =
          full.crossStageState.get<ResearcherResult[]>(
            CS_KEY.researcherResults,
          ) ?? [];
        // ★ #16b narrate：S4 开始评审
        emitDomain(onEvent, "agent:narrative", {
          stage: "s4-leader-assess",
          role: "leader",
          tag: "thinking",
          text: `Leader 开始评审 ${plan?.dimensions.length ?? 0} 个维度的产出，决定是否需要补研究`,
        });
        // ★ goals + dimensions 合成真实 myPlan（对齐 s4-leader-assess-research.stage.ts:84-124）。
        const goals: GoalsShape = full.crossStageState.get<GoalsShape>(
          CS_KEY.goals,
        ) ??
          plan?.goals ?? {
            successCriteria: ["完成研究报告，覆盖所有关键维度"],
            qualityBar: { minSources: 0, minCoverage: 0, hardConstraints: [] },
            deliverables: ["研究报告"],
          };
        const minSourcesRequired = goals.qualityBar.minSources ?? 0;
        // ★ researcherOutcomes 按 OFF 路 s4 stage:84-124 真实构造（非直传 researcherResults）。
        const researcherOutcomes = (plan?.dimensions ?? []).map((d) => {
          const r = researcherResults.find((x) => x.dimension === d.name);
          const findings = r?.findings ?? [];
          const summary = r?.summary ?? "";
          const state: "completed" | "degraded" | "failed" =
            findings.length === 0
              ? "failed"
              : summary.startsWith("(failed") || summary.startsWith("(error")
                ? "degraded"
                : "completed";
          const sources = findings
            .map((f) => f.source)
            .filter((s): s is string => typeof s === "string")
            .slice(0, 5);
          const meetsMinSources =
            minSourcesRequired === 0 || findings.length >= minSourcesRequired;
          const minSourcesDelta = Math.max(
            0,
            minSourcesRequired - findings.length,
          );
          // uniqueDomains: 简单按 sources 去重域名数。
          const uniqueDomains = new Set(
            sources.map((s) => {
              try {
                return new URL(s).hostname;
              } catch {
                return s;
              }
            }),
          ).size;
          return {
            dimensionId: d.id,
            dimensionName: d.name,
            state,
            findingsCount: findings.length,
            sources,
            summary: summary.slice(0, 300),
            meetsMinSources,
            minSourcesRequired,
            minSourcesDelta,
            uniqueDomains,
          };
        });
        try {
          const res = await invokeAgent({
            runner: this.runner,
            specId: "playground.leader",
            input: {
              phase: "assess-research",
              topic: input.topic,
              language: input.language,
              myPlan: { goals, dimensions: plan?.dimensions ?? [] },
              researcherOutcomes,
            },
            invocation: input.invocation,
            crossStageState: full.crossStageState,
            signal: full.ctx.signal,
            stepId: "s4-leader-assess",
            role: "leader",
            operationType: "assess",
            onEvent,
          });
          const output = res.output ?? { decision: "accept-all" };
          // ★ #16b P1：leader:decision domain 事件（对齐 OFF 路 leader.assessResearchers → narrate）。
          const decisionVal = this.readLeaderAssessDecision(output);
          emitDomain(onEvent, "leader:decision", {
            phase: "assess-research",
            decision: decisionVal,
            perDimension:
              (output as { perDimension?: unknown }).perDimension ?? [],
          });
          // Fix4 / P1-3：dimension:graded — 对每个维度 emit（projector 据此在 ASSESSMENT 阶段完结维度 todo）。
          // 形状：{ dimension, overall/overallScore, state }（projector ~line 1128 读 dimension/overall/overallScore）。
          // 复用私有方法，catch 降级路径同样调用保证收口。
          this.emitAssessGraded(onEvent, researcherOutcomes, output);
          // Fix4：S4 substance narrative with per-dimension summary.
          const acceptedCount = researcherOutcomes.filter(
            (o) => o.state === "completed",
          ).length;
          emitDomain(onEvent, "agent:narrative", {
            stage: "s4-leader-assess",
            role: "leader",
            tag: "signing",
            text: `Leader 评估完成：决定 ${decisionVal}（${acceptedCount}/${researcherOutcomes.length} 维度达标）`,
          });
          // ★ #16b P1：stage:metrics
          // C5 修复：dimensions 不传（StageMetricsSchema 不支持 number 类型）；
          //   维度数量由 accepted/degraded/failed 三字段隐含（passthrough 允许额外字段）。
          emitDomain(onEvent, "stage:metrics", {
            stepId: "s4-leader-assess",
            accepted: researcherOutcomes.filter((o) => o.state === "completed")
              .length,
            degraded: researcherOutcomes.filter((o) => o.state === "degraded")
              .length,
            failed: researcherOutcomes.filter((o) => o.state === "failed")
              .length,
          });
          // ★ F2/F1 leaderJournal：s4 assess 决策追加一条。
          full.crossStageState.append<LeaderJournalEntry>(
            CS_KEY.leaderJournal,
            {
              stage: "s4-leader-assess",
              decision: decisionVal,
              summary:
                `评估 ${researcherOutcomes.length} 个维度，` +
                `通过 ${researcherOutcomes.filter((o) => o.state === "completed").length} 个，` +
                `决定：${decisionVal}`,
              ts: Date.now(),
            },
          );
          return output;
        } catch (err) {
          // P1-3：assess 可降级——leader 评估失败不阻断（视为 accept-all，下游照常成稿）。
          // (a) 发警告叙事；(b) 对每个维度发 dimension:graded（启发式兜底），保证全维收口不卡死。
          const errSummary =
            err instanceof Error
              ? err.message.slice(0, 120)
              : String(err).slice(0, 120);
          emitDomain(onEvent, "agent:narrative", {
            stage: "s4-leader-assess",
            role: "leader",
            tag: "warning",
            text: `Leader 评审失败（${errSummary}），按启发式评分继续`,
          });
          // 降级路径：无 perDimension verdict，全用启发式兜底分。
          this.emitAssessGraded(onEvent, researcherOutcomes, undefined);
          return { decision: "accept-all" };
        }
      },
      // 把 leader verdict 映射到 assess primitive 的 4 路决策。
      parseDecision: (
        raw: unknown,
      ): "continue" | "retry-some" | "abort-mission" | "patch-then-retry" => {
        const decision = this.readLeaderAssessDecision(raw);
        switch (decision) {
          case "abort":
            return "abort-mission";
          case "patch":
          case "redirect":
            return "retry-some";
          case "accept-all":
          default:
            return "continue";
        }
      },
      // patch/redirect → 把弱维度记进 s4PatchFailures（s10 硬门依据）。
      dispatchAssessActions: (args: {
        decision:
          | "continue"
          | "retry-some"
          | "abort-mission"
          | "patch-then-retry";
        raw: unknown;
        ctx: StageRunArgs["ctx"];
        crossStageState: CrossStageState;
      }): void => {
        if (args.decision !== "retry-some") return;
        // 用 runner 绑定的 crossState（与 s10 读取同一实例）。
        const cs = this.fullArgs(args.ctx).crossStageState;
        // P1-4：把 plan 传给 extractWeakDimensions，供 dimensionId → dimensionName 解析。
        const plan = cs.get<PlanResult>(CS_KEY.plan);
        const weak = this.extractWeakDimensions(args.raw, plan);
        for (const dim of weak) {
          cs.append<{ dimension: string; reason: string }>(
            CS_KEY.s4PatchFailures,
            dim,
          );
        }
      },
    });
  }

  // ── S5 reconciler（synthesize primitive，reconcile 模式）───────────────────────
  private buildReconcileHooks(): ResolvedStageHooks {
    return defineStageHooks({
      // P2-c：单维度场景无需跨维对账，直接短路（synthesize primitive singleDimensionShortCircuit 钩子）。
      singleDimensionShortCircuit: (args: {
        ctx: StageRunArgs["ctx"];
        previousOutputs: StageRunArgs["previousOutputs"];
      }): unknown | undefined => {
        void args.previousOutputs; // 短路路径不需要 previousOutputs，声明避免 lint 警告。
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        const onEvent = input.invocation.onEvent;
        const researcherResults =
          full.crossStageState.get<ResearcherResult[]>(
            CS_KEY.researcherResults,
          ) ?? [];
        if (researcherResults.length !== 1) return undefined;
        // 单维度：跳过跨维对账，设 reconciliationReport=null 并发叙事。
        full.crossStageState.set(CS_KEY.reconciliationReport, null);
        emitDomain(onEvent, "agent:narrative", {
          stage: "s5-reconciler",
          role: "reconciler",
          tag: "info",
          text: "单维度任务无需跨维对账，已跳过",
        });
        // 返回 null 作为 synthesize 产物（primitive 以此作为短路结果）。
        return null;
      },
      synthesize: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        const onEvent = input.invocation.onEvent;
        const plan = full.crossStageState.get<PlanResult>(CS_KEY.plan);
        const researcherResults =
          full.crossStageState.get<ResearcherResult[]>(
            CS_KEY.researcherResults,
          ) ?? [];
        emitDomain(onEvent, "agent:narrative", {
          stage: "s5-reconciler",
          role: "analyst",
          tag: "analyzing",
          text: "Reconciler 对各维度数据进行跨维对账与事实核查",
        });
        try {
          const res = await invokeAgent({
            runner: this.runner,
            specId: "playground.reconciler",
            input: {
              topic: input.topic,
              language: input.language,
              plan,
              researcherResults,
            },
            invocation: input.invocation,
            crossStageState: full.crossStageState,
            signal: full.ctx.signal,
            stepId: "s5-reconciler",
            role: "reconciler",
            operationType: "reconcile",
            onEvent,
          });
          full.crossStageState.set(CS_KEY.reconciliationReport, res.output);
          // Fix4：S5 substance narrative（reconciliation outcome：conflicts/gaps counts）。
          const rec = res.output as
            | {
                conflicts?: unknown[];
                gaps?: unknown[];
                factTable?: unknown[];
                overlaps?: unknown[];
                figureCandidates?: unknown[];
                alternativeHypotheses?: unknown[];
              }
            | null
            | undefined;
          const conflictCount = Array.isArray(rec?.conflicts)
            ? rec.conflicts.length
            : 0;
          const gapCount = Array.isArray(rec?.gaps) ? rec.gaps.length : 0;
          const factCount = Array.isArray(rec?.factTable)
            ? rec.factTable.length
            : 0;
          const overlapCount = Array.isArray(rec?.overlaps)
            ? rec.overlaps.length
            : 0;
          const figureCandidateCount = Array.isArray(rec?.figureCandidates)
            ? rec.figureCandidates.length
            : 0;
          const alternativeHypothesisCount = Array.isArray(
            rec?.alternativeHypotheses,
          )
            ? rec.alternativeHypotheses.length
            : 0;
          // ★ 恢复 reconciliation:completed 事件（projector reconciler-gap todo ~:820-841）。
          // 形状照抄旧 s5-reconciler-cross-dim-fact-check.stage.ts:143-163 payload。
          emitDomain(onEvent, "reconciliation:completed", {
            factCount,
            conflictCount,
            overlapCount,
            gapCount,
            figureCandidateCount,
            alternativeHypothesisCount,
          });
          emitDomain(onEvent, "agent:narrative", {
            stage: "s5-reconciler",
            role: "reconciler",
            tag: gapCount > 0 ? "warning" : "success",
            text: `对账完成：${factCount} 条事实，${conflictCount} 处冲突，${gapCount} 处缺口`,
          });
          return res.output;
        } catch {
          // reconciler 可降级：失败不阻断，下游 analyst 收空对账报告。
          // ★ 失败路径补 warning narrative（对账失败，跳过），对齐旧 stage catch 行为。
          emitDomain(onEvent, "agent:narrative", {
            stage: "s5-reconciler",
            role: "reconciler",
            tag: "warning",
            text: "对账失败，跳过（下游 Analyst 走退化路径）",
          });
          full.crossStageState.set(CS_KEY.reconciliationReport, null);
          return null;
        }
      },
    });
  }

  // ── S6 analyst（synthesize primitive，analyze 模式）────────────────────────────
  private buildAnalyzeHooks(): ResolvedStageHooks {
    return defineStageHooks({
      synthesize: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        const onEvent = input.invocation.onEvent;
        const researcherResults =
          full.crossStageState.get<ResearcherResult[]>(
            CS_KEY.researcherResults,
          ) ?? [];
        const rec = full.crossStageState.get<{
          reconciliationReport?: string;
          factTable?: unknown[];
          overlaps?: unknown[];
          gaps?: unknown[];
        }>(CS_KEY.reconciliationReport);
        emitDomain(onEvent, "agent:narrative", {
          stage: "s6-analyst",
          role: "analyst",
          tag: "analyzing",
          text: `Analyst 综合 ${researcherResults.length} 个维度的研究成果，提炼核心洞察`,
        });
        const res = await invokeAgent({
          runner: this.runner,
          specId: "playground.analyst",
          input: {
            topic: input.topic,
            language: input.language,
            researcherResults,
            reconciliationReport: {
              reconciliationReport: rec?.reconciliationReport ?? "",
              factTable: rec?.factTable ?? [],
              overlaps: rec?.overlaps ?? [],
              gaps: rec?.gaps ?? [],
            },
          },
          invocation: input.invocation,
          crossStageState: full.crossStageState,
          signal: full.ctx.signal,
          stepId: "s6-analyst",
          role: "analyst",
          operationType: "analyze",
          onEvent,
        });
        full.crossStageState.set(CS_KEY.analystOutput, res.output);
        return res.output;
      },
    });
  }

  // ── S7 writer outline（draft primitive，outline 模式）──────────────────────────
  private buildOutlineHooks(): ResolvedStageHooks {
    return defineStageHooks({
      draftOnce: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        const onEvent = input.invocation.onEvent;
        const plan = full.crossStageState.get<PlanResult>(CS_KEY.plan);
        const depth = input.invocation.depth ?? "standard";
        // C8 auditLayers 门控：等价 s7-writer-plan-outline.stage.ts:48 的旧 stage 语义。
        //   auditLayers 为 string[]（消费方包装）；只在 thorough/thorough+ 时跑 outline LLM。
        const layers = input.invocation.auditLayers ?? [];
        const hasDeepAudit =
          layers.includes("thorough") || layers.includes("thorough+");
        if (!hasDeepAudit) {
          // ★ S7 gated-skip 可见化：让用户不再看到"done 但空白"。
          emitDomain(onEvent, "agent:narrative", {
            stage: "s7-writer-outline",
            role: "writer",
            tag: "info",
            text: `按审核档位（${layers.join(",") || "default"}）跳过大纲规划`,
          });
          full.crossStageState.set(CS_KEY.outlinePlan, null);
          return null;
        }
        emitDomain(onEvent, "agent:narrative", {
          stage: "s7-writer-outline",
          role: "writer",
          tag: "planning",
          text: "Writer 规划报告大纲结构与章节布局",
        });
        try {
          const res = await invokeAgent({
            runner: this.runner,
            specId: "playground.writer.outline-planner",
            input: {
              topic: input.topic,
              language: input.language,
              depth,
              // ★ task5 4 档位透传：使用 invocation 档位，缺省回退原硬编码值。
              audienceProfile:
                input.invocation.audienceProfile ?? "domain-expert",
              styleProfile: input.invocation.styleProfile ?? "academic",
              lengthProfile: input.invocation.lengthProfile ?? "standard",
              withFigures: input.invocation.withFigures ?? false,
              plan: {
                themeSummary: plan?.themeSummary ?? input.topic,
                dimensions: plan?.dimensions ?? [],
              },
            },
            invocation: input.invocation,
            crossStageState: full.crossStageState,
            signal: full.ctx.signal,
            stepId: "s7-writer-outline",
            role: "writer",
            operationType: "outline",
            onEvent,
          });
          full.crossStageState.set(CS_KEY.outlinePlan, res.output);
          // Fix4：dimension:outline:planned（projector ~line 1598 handler）。
          // 形状：{ chapterCount }（projector 读 chapterCount / count 两个别名）。
          const outlineOutput = res.output as
            | { chapterOutlines?: unknown[] }
            | null
            | undefined;
          const chapterCount = Array.isArray(outlineOutput?.chapterOutlines)
            ? outlineOutput.chapterOutlines.length
            : 0;
          emitDomain(onEvent, "dimension:outline:planned", {
            chapterCount,
          });
          // ★ dimension:outline:planned 无 dimension 字段，projector ~:1615 `if (dim)` 会丢弃。
          // 补发 agent:narrative（stage 级，无 dimension），让编排叙事可见大纲规划完成。
          emitDomain(onEvent, "agent:narrative", {
            stage: "s7-writer-outline",
            role: "writer",
            tag: "success",
            text: `大纲规划完成：${chapterCount} 章`,
          });
          return res.output ?? null;
        } catch {
          // outline 可降级：缺失则 writer 从零规划（writer schema outlinePlan 可选）。
          full.crossStageState.set(CS_KEY.outlinePlan, null);
          return null;
        }
      },
    });
  }

  // ── S8 writer full draft（draft primitive，full 模式）──────────────────────────
  private buildWriterHooks(): ResolvedStageHooks {
    return defineStageHooks({
      draftOnce: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        const plan = full.crossStageState.get<PlanResult>(CS_KEY.plan);
        const analyst = (full.crossStageState.get<{
          insights?: unknown[];
          themeSummary?: string;
          contradictions?: unknown[];
        }>(CS_KEY.analystOutput) ?? {
          insights: [],
          themeSummary: plan?.themeSummary ?? input.topic,
        }) as {
          insights?: unknown[];
          themeSummary?: string;
          contradictions?: unknown[];
        };
        const outlinePlan = full.crossStageState.get(CS_KEY.outlinePlan);
        const onEvent = input.invocation.onEvent;
        emitDomain(onEvent, "agent:narrative", {
          stage: "s8-writer",
          role: "writer",
          tag: "writing",
          text: "Writer 开始根据分析结果撰写完整研究报告",
        });
        const res = await invokeAgent({
          runner: this.runner,
          specId: "playground.writer",
          input: {
            topic: input.topic,
            depth: input.invocation.depth ?? "standard",
            language: input.language,
            insights: analyst.insights ?? [],
            themeSummary:
              analyst.themeSummary ?? plan?.themeSummary ?? input.topic,
            ...(analyst.contradictions
              ? { contradictions: analyst.contradictions }
              : {}),
            ...(outlinePlan ? { outlinePlan } : {}),
          },
          invocation: input.invocation,
          crossStageState: full.crossStageState,
          signal: full.ctx.signal,
          stepId: "s8-writer",
          role: "writer",
          operationType: "write",
          onEvent,
        });
        full.crossStageState.set(CS_KEY.report, res.output);
        // Fix4：chapter:writing:started + chapter:writing:completed per section。
        // projector 据这两个事件驱动 chapter todo（handler ~670/708）。
        // ★ 字段名必须是 chapterIndex（非 index）——ChapterWritingCompletedSchema 是
        //   strict object（无 .passthrough()），chapterIndex 为必填 number；发 index 会令
        //   event-bus safeParse 整事件丢弃 → 章节进度永远空（矩阵表3 P0）。
        // deep-insight writer 按 topic 维（无单独维度）→ 用 topic 作 dimension；
        // 维度信息从 plan.dimensions 逐一映射章节（近似），dimensionId 取对应维 id 显式带出
        // （不靠 chapterIndex 近似映射），无对应维时省略。
        const writerSections =
          (
            res.output as {
              sections?: Array<{ heading?: string; body?: string }>;
            } | null
          )?.sections ?? [];
        const planDims =
          full.crossStageState.get<{
            dimensions?: Array<{ id: string; name: string }>;
          }>(CS_KEY.plan)?.dimensions ?? [];
        for (let idx = 0; idx < writerSections.length; idx++) {
          const sec = writerSections[idx];
          const heading = sec.heading ?? `Section ${idx + 1}`;
          // 尝试按索引匹配维度名；多出或少时回退 topic。
          const dim = idx < planDims.length ? planDims[idx] : undefined;
          const dimension = dim?.name ?? input.topic;
          const wordCount =
            typeof sec.body === "string"
              ? Math.round(sec.body.length / 2)
              : undefined;
          // started（立即跟 completed，因 writer 是一次性产出而非流式）。
          emitDomain(onEvent, "chapter:writing:started", {
            dimension,
            heading,
            chapterIndex: idx,
            ...(dim?.id ? { dimensionId: dim.id } : {}),
          });
          emitDomain(onEvent, "chapter:writing:completed", {
            dimension,
            heading,
            chapterIndex: idx,
            ...(dim?.id ? { dimensionId: dim.id } : {}),
            ...(wordCount !== undefined ? { wordCount } : {}),
          });
        }
        return res.output ?? null;
      },
      // 富组装（W2.5，对齐 playground s8 reportArtifact）：writer 原始 report →
      // ReportArtifactAssembler.assemble（sections 树 / citations 编号 + occurrences /
      // figures 五项硬规则 / quickView / factTable / 50+ 格式自动修复 / 10 维质量评分）。
      // assemble 是纯代码（无 LLM），失败时降级回 writer 原始 report 不阻断终态。
      reportArtifactAssembler: async (args: {
        artifact: unknown;
        ctx: StageRunArgs["ctx"];
        crossStageState: CrossStageState;
      }): Promise<unknown> => {
        // 用 runner 绑定的 crossState（fullArgs），与其它 hook + 终态组装同一实例。
        // primitive 透传的 args.crossStageState 是 orchestrator 自己那份（记账用），
        // 与 runner 绑定那份不同——业务产物必须写绑定那份才能被 s9b/s10/终态读到。
        const cs = this.fullArgs(args.ctx).crossStageState;
        const input = readPipelineInput(args.ctx);
        const plan = cs.get<PlanResult>(CS_KEY.plan);
        const researcherResults =
          cs.get<ResearcherResult[]>(CS_KEY.researcherResults) ?? [];
        const analyst = cs.get<AnalystShape>(CS_KEY.analystOutput);
        const startedAt = cs.get<number>(CS_KEY.startedAt) ?? Date.now();
        // ★ figure re-home（2026-06-09）：组装前对 figureCandidates 做 embedding 相关性
        //   精排（与 playground s3 的 filterRelevantFigures 等价）。fail-open：精排失败
        //   返回原 researcherResults，不阻断报告组装。
        const rankedResearcherResults = await this.rankFigureCandidates(
          researcherResults as unknown as FigureRankableResearcher[],
          plan,
          input.topic,
        );
        try {
          // S5 对账产物（factTable/conflicts）→ assembler buildFactTable + 质量评分输入。
          const reconciliation = cs.get<ReconciliationShape>(
            CS_KEY.reconciliationReport,
          );
          // 真实模型轨迹（每次 agent 调用去重累积），填 metadata.modelTrail。
          const modelTrail = cs.get<string[]>(CS_KEY.modelTrail) ?? [];
          const assembleInput = buildAssembleInput({
            profile: {
              topic: input.topic,
              language: input.language,
              ...(input.invocation.depth
                ? { depth: input.invocation.depth }
                : {}),
              // 用户在 Dialog 选定的档位透传（非硬编码 academic/domain-expert/standard）。
              ...(input.invocation.styleProfile
                ? { styleProfile: input.invocation.styleProfile }
                : {}),
              ...(input.invocation.lengthProfile
                ? { lengthProfile: input.invocation.lengthProfile }
                : {}),
              ...(input.invocation.audienceProfile
                ? { audienceProfile: input.invocation.audienceProfile }
                : {}),
              ...(input.invocation.searchTimeRange
                ? { searchTimeRange: input.invocation.searchTimeRange }
                : {}),
            },
            plan: plan as PlanShape | undefined,
            researcherResults: rankedResearcherResults as never,
            analyst,
            writerReport: args.artifact as WriterReportShape | undefined,
            reconciliation,
            usage: {
              totalTokens: cs.get<number>(CS_KEY.tokensUsed) ?? 0,
              totalCostCents: cs.get<number>(CS_KEY.costCents) ?? 0,
              generationTimeMs: Math.max(0, Date.now() - startedAt),
            },
            modelTrail,
          });
          const artifact =
            this.rich.reportArtifactAssembler.assemble(assembleInput);
          cs.set(CS_KEY.reportArtifact, artifact);
          return artifact;
        } catch {
          // assemble 失败降级：reportArtifact = writer 原始 report（不退化终态产出）。
          cs.set(CS_KEY.reportArtifact, args.artifact);
          return args.artifact;
        }
      },
    });
  }

  // ── S8b section quality enhancement（review primitive，afterReview 富补救）──────
  //
  // 富增强（W2.5，对齐 playground s8b-section-quality-enhancement）：
  //   review 跑 reviewer agent 给主评分 + 合成 reviewVerdict（company gate 不退化）。
  //   afterReview 跑 SectionSelfEval（4 维写后自评）→ SectionRemediation（弱维度定向补救）
  //   逐 section 闭环 + QualityTrace.recordDimensionRemediationLoop 记前/后/delta，
  //   把补救后的 section 回写 reportArtifact（纯 LLM + 纯映射，失败降级不阻断）。
  private buildQualityEnhanceHooks(): ResolvedStageHooks {
    return defineStageHooks({
      review: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<{ verdict: unknown; score?: number }> =>
        this.runReviewerScore(args.ctx, "s8b-quality-enhancement"),
      afterReview: async (args: {
        ctx: StageRunArgs["ctx"];
        crossStageState: CrossStageState;
      }): Promise<void> => {
        // 用 runner 绑定的 crossState（与产物同一实例）。
        const cs = this.fullArgs(args.ctx).crossStageState;
        await this.runSectionRemediation(args.ctx, cs);
      },
    });
  }

  // ── S9 meta-critic（review primitive，独立 critic 复审 + 降权）────────────────────
  //
  // 富增强（W2.5，对齐 playground s9-reviewer-critic-l4）：critic agent 独立复审
  //   产出 verdict（pass/concerns/fail）；afterReview 据 verdict 对 reportArtifact.quality
  //   降权（fail → overall ×0.7；concerns → ×0.9），让 s10 leader 看到真实质量信号。
  private buildCriticHooks(): ResolvedStageHooks {
    return defineStageHooks({
      review: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<{ verdict: unknown }> => {
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        // C8 auditLayers 门控：等价 s9-reviewer-critic-l4.stage.ts:55-58 的旧 stage 语义。
        //   minimal 直接跳过；executive 受众在非 minimal 时启用；thorough/thorough+ 必开。
        const layers = input.invocation.auditLayers ?? [];
        const isMinimal = layers.includes("minimal");
        const hasDeepAudit =
          layers.includes("thorough") || layers.includes("thorough+");
        const isExecutive = input.invocation.audienceProfile === "executive";
        const enableCritic = hasDeepAudit || (isExecutive && !isMinimal);
        const onEvent = input.invocation.onEvent;
        if (!enableCritic) {
          // ★ S9 gated-skip 可见化：让用户不再看到"done 但空白"。
          emitDomain(onEvent, "agent:narrative", {
            stage: "s9-critic",
            role: "critic",
            tag: "info",
            text: `按审核档位（${layers.join(",") || "default"}）跳过独立评审`,
          });
          return { verdict: null };
        }
        const artifact = full.crossStageState.get(CS_KEY.reportArtifact);
        emitDomain(onEvent, "agent:narrative", {
          stage: "s9-critic",
          role: "reviewer",
          tag: "reviewing",
          text: "Critic 独立复审报告，进行盲点识别与质量信号校准",
        });
        try {
          const res = await invokeAgent({
            runner: this.runner,
            specId: "playground.critic",
            input: {
              topic: input.topic,
              language: input.language,
              // ★ task5 4 档位透传：使用 invocation 档位，缺省回退原硬编码值。
              audienceProfile:
                input.invocation.audienceProfile ?? "domain-expert",
              artifactSummary: buildCriticArtifactSummary(
                asArtifact(artifact),
                input.topic,
              ),
            },
            invocation: input.invocation,
            crossStageState: full.crossStageState,
            signal: full.ctx.signal,
            stepId: "s9-critic",
            role: "critic",
            operationType: "meta-critic",
            onEvent,
          });
          // ★ 恢复 critic:verdict 事件（projector blindspot todos ~:785-817）。
          // 形状照抄旧 s9-reviewer-critic-l4.stage.ts:150-184 payload（warnings 数组含
          // blindspots / biasFlags / suggestions 分条目）。
          if (res.output != null) {
            const rawOut = res.output as Record<string, unknown>;
            const validVerdicts = ["pass", "concerns", "fail"] as const;
            const overallVerdict = validVerdicts.includes(
              rawOut.overallVerdict as "pass" | "concerns" | "fail",
            )
              ? (rawOut.overallVerdict as "pass" | "concerns" | "fail")
              : ("concerns" as const);
            const blindspots = Array.isArray(rawOut.blindspots)
              ? (rawOut.blindspots as string[])
              : [];
            const biasFlags = Array.isArray(rawOut.biasFlags)
              ? (rawOut.biasFlags as string[])
              : [];
            const suggestions = Array.isArray(rawOut.suggestions)
              ? (rawOut.suggestions as string[])
              : [];
            const rationale =
              typeof rawOut.rationale === "string" ? rawOut.rationale : "";
            const criticOut = {
              overallVerdict,
              blindspots,
              biasFlags,
              suggestions,
              rationale,
            };
            // 存 critic 产物供 s10 读取 blindspots/biases（替代硬编码 []）。
            full.crossStageState.set("deep-insight.criticVerdict", criticOut);
            emitDomain(onEvent, "critic:verdict", {
              verdict: criticOut.overallVerdict,
              overall: criticOut.overallVerdict,
              blindspotCount: criticOut.blindspots.length,
              biasCount: criticOut.biasFlags.length,
              suggestionCount: criticOut.suggestions.length,
              rationale: criticOut.rationale,
              warnings: [
                ...criticOut.blindspots.map((b) => ({
                  kind: "l4-blindspot",
                  message: b,
                  severity: "warning",
                })),
                ...criticOut.biasFlags.map((b) => ({
                  kind: "l4-bias",
                  message: b,
                  severity: "warning",
                })),
                ...criticOut.suggestions.map((s) => ({
                  kind: "l4-suggestion",
                  message: s,
                  severity: "info",
                })),
              ],
            });
            // ★ critic:verdict schema 若再漂移被 safeParse 丢弃，此完成 narrative 兜底
            //   （基线 s9-reviewer-critic-l4.stage.ts 在 emit 后即 narrate 完成行）——
            //   保证用户在时间线至少能看到 L4 复审结论，不再只有"开始复审"一句。
            emitDomain(onEvent, "agent:narrative", {
              stage: "s9-critic",
              role: "critic",
              tag:
                criticOut.overallVerdict === "pass"
                  ? "success"
                  : criticOut.overallVerdict === "fail"
                    ? "warning"
                    : "info",
              text: `L4 独立复审完成 · ${criticOut.overallVerdict} · 盲点 ${criticOut.blindspots.length} / 偏见 ${criticOut.biasFlags.length} / 建议 ${criticOut.suggestions.length}`,
            });
          }
          return { verdict: res.output };
        } catch {
          return { verdict: null };
        }
      },
      afterReview: (args: {
        verdict: unknown;
        ctx: StageRunArgs["ctx"];
        crossStageState: CrossStageState;
      }): void => {
        // 用 runner 绑定的 crossState（与产物同一实例）。
        const cs = this.fullArgs(args.ctx).crossStageState;
        this.applyCriticDowngrade(args.verdict, cs);
      },
    });
  }

  // ── S9b objective evaluation（review primitive，10 维客观评分）────────────────────
  //
  // 富增强（W2.5，对齐 playground s9b-report-objective-evaluation）：
  //   review 跑 reviewer agent 主评分；objectiveEvalInjection 跑 ReportEvaluation 10 维
  //   结构化评审（按 section 拆 ChapterInput），结果落 reportArtifact.metadata.pipelineEvaluation
  //   + 记 finalScore（overallScore），供 s10 leader signoff 参考。
  private buildObjectiveEvalHooks(): ResolvedStageHooks {
    return defineStageHooks({
      review: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<{ verdict: unknown; score?: number }> =>
        this.runReviewerScore(args.ctx, "s9b-objective-eval"),
      objectiveEvalInjection: async (args: {
        verdict: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        const artifact = asArtifact(
          full.crossStageState.get(CS_KEY.reportArtifact),
        );
        const chapters = buildChapterInputs(artifact);
        if (chapters.length === 0) return args.verdict;
        try {
          const evalResult = await this.rich.reportEvaluation.evaluateReport({
            reportTitle: artifact?.title ?? input.topic,
            topicType: input.topic,
            chapters,
            language: input.language,
          });
          full.crossStageState.set(CS_KEY.pipelineEvaluation, evalResult);
          // 把 10 维评估落进 reportArtifact.metadata.pipelineEvaluation（前端可见）。
          if (artifact) {
            const meta = artifact.metadata ?? {};
            meta.pipelineEvaluation = evalResult;
            artifact.metadata = meta;
            full.crossStageState.set(CS_KEY.reportArtifact, artifact);
          }
          // ★ 恢复 verifier:verdict 事件（projector s8/s9 score artifact ~:1198-1225）。
          // 形状：projector 读 verifierId + score（verifierId 含 "critic" → 路由到 s9-critic-l4 todo）。
          // 旧路径（s9b-report-objective-evaluation.stage.ts）无此事件，等价语义是
          //   reviewerAvgScore 通过 evaluateReport 输出；此处以 verifierId="critic-eval"
          //   + score=overallScore 触发 projector verifier:verdict handler，让 todo 得分。
          const onEvent = input.invocation.onEvent;
          if (typeof evalResult?.overallScore === "number") {
            // ★ verifierId 是 VerifierVerdictSchema + projector（mission-view.projector:242
            //   `typeof p.verifierId === "string"`）正确字段名——必须保留 verifierId。
            //   富化 critique/modelId/attempt（10 维评估现成数据，无则不造）：
            //     critique ← evalResult.feedback；modelId ← evaluatorModel；attempt=1
            //     （单次客观评估，非多轮 judge retry）。VerifyConsensusPanel 据此展示评语/模型。
            const ev = evalResult as {
              overallScore: number;
              feedback?: string;
              evaluatorModel?: string;
            };
            emitDomain(onEvent, "verifier:verdict", {
              verifierId: "critic-eval",
              score: ev.overallScore,
              attempt: 1,
              ...(typeof ev.feedback === "string" && ev.feedback
                ? { critique: ev.feedback }
                : {}),
              ...(typeof ev.evaluatorModel === "string" && ev.evaluatorModel
                ? { modelId: ev.evaluatorModel }
                : {}),
            });
          }
        } catch {
          // 客观评估失败降级：不阻断 mission（s10 仍可凭 reviewScore 签字）。
        }
        return args.verdict;
      },
    });
  }

  /** s8b / s9b 共用：跑 reviewer agent 拿主评分 + 合成 reviewVerdict（company gate 不退化）。 */
  private async runReviewerScore(
    ctx: StageRunArgs["ctx"],
    stepId: string,
  ): Promise<{ verdict: unknown; score?: number }> {
    const full = this.fullArgs(ctx);
    const input = readPipelineInput(full.ctx);
    const artifact =
      asArtifact(full.crossStageState.get(CS_KEY.reportArtifact)) ??
      full.crossStageState.get(CS_KEY.report);
    // ★ draftReport 从 reportArtifact 映射为 ResearchReportSchema 合法形状
    //   （title≥2, summary≥20, sections≥1 且 heading+body 非空, conclusion≥20）。
    const rawSections = (artifact as { sections?: unknown[] } | undefined)
      ?.sections;
    const mappedSections =
      Array.isArray(rawSections) && rawSections.length > 0
        ? rawSections.map((s: unknown) => {
            const sec = s as Record<string, unknown>;
            const heading = String(sec.title ?? sec.heading ?? "Section");
            const body = String(sec.content ?? sec.body ?? "");
            const result: {
              heading: string;
              body: string;
              sources?: string[];
            } = {
              heading: heading || "Section",
              body: body || "内容",
            };
            const cits = sec.citations;
            if (Array.isArray(cits) && cits.length > 0) {
              result.sources = cits
                .map((c: unknown) =>
                  typeof c === "string"
                    ? c
                    : String((c as Record<string, unknown>)?.url ?? c),
                )
                .filter((u) => u.startsWith("http"));
            }
            return result;
          })
        : [{ heading: "摘要", body: "报告内容" }];
    // quickView.executiveSummary / conclusion fallback
    const qv = (artifact as Record<string, unknown> | undefined)?.quickView as
      | Record<string, unknown>
      | undefined;
    const rawSummary = String(
      (qv?.executiveSummary as Record<string, unknown> | undefined)?.markdown ??
        (artifact as Record<string, unknown> | undefined)?.summary ??
        mappedSections[0]?.body?.slice(0, 300) ??
        "报告摘要",
    );
    const summary =
      rawSummary.length >= 20
        ? rawSummary
        : rawSummary + "（自动补全至摘要最小长度）";
    const rawConclusion = String(
      (qv?.conclusion as Record<string, unknown> | undefined)?.markdown ??
        (artifact as Record<string, unknown> | undefined)?.conclusion ??
        mappedSections[mappedSections.length - 1]?.body?.slice(0, 300) ??
        "综合以上研究，本报告提供了深入的分析与见解。",
    );
    const conclusion =
      rawConclusion.length >= 20
        ? rawConclusion
        : rawConclusion + "（自动补全至结论最小长度）";
    const rawTitle = String(
      (artifact as Record<string, unknown> | undefined)?.title ?? input.topic,
    );
    const title = rawTitle.length >= 2 ? rawTitle : input.topic;
    const draftReport = {
      title,
      summary,
      sections: mappedSections,
      conclusion,
    };
    const onEvent = input.invocation.onEvent;
    emitDomain(onEvent, "agent:narrative", {
      stage: stepId,
      role: "reviewer",
      tag: "reviewing",
      text:
        stepId === "s9b-objective-eval"
          ? "Reviewer 对报告进行客观多维评估打分"
          : "Reviewer 对报告质量进行全面评审",
    });
    const res = await invokeAgent({
      runner: this.runner,
      specId: "playground.reviewer",
      input: {
        topic: input.topic,
        language: input.language,
        draftReport,
      },
      invocation: input.invocation,
      crossStageState: full.crossStageState,
      signal: full.ctx.signal,
      stepId,
      role: "reviewer",
      operationType:
        stepId === "s9b-objective-eval" ? "objective-eval" : "quality-enhance",
      onEvent,
    });
    const verdict = res.output;
    const score = this.extractScore(verdict);
    if (typeof score === "number") {
      full.crossStageState.set(CS_KEY.reviewScore, score);
    }
    const synth = this.synthReviewVerdict(verdict);
    if (synth) {
      // 写最新单条（向后兼容读 reviewVerdict 的消费方）。
      full.crossStageState.set(CS_KEY.reviewVerdict, synth);
      // ★ F2/F1 #36 verdict 累积：每轮 reviewer 结果 append 到 reviewVerdicts 桶，
      //   s10 accountability hook 据此合成共识，避免 s9b 覆盖 s8b 的独立评判。
      full.crossStageState.append<{ stepId: string } & typeof synth>(
        CS_KEY.reviewVerdicts,
        { stepId, ...synth },
      );
    }
    return { verdict, ...(typeof score === "number" ? { score } : {}) };
  }

  /**
   * s8b 富补救：逐 section 跑 SectionSelfEval（4 维）→ 弱维度 SectionRemediation 定向补救，
   * QualityTrace 记补救闭环，补救后 section 回写 reportArtifact.sections + content.fullMarkdown。
   * 任何单 section 失败降级跳过（fail-open，不阻断 mission）。
   */
  private async runSectionRemediation(
    ctx: StageRunArgs["ctx"],
    crossStageState: CrossStageState,
  ): Promise<void> {
    const input = readPipelineInput(ctx);
    const artifact = asArtifact(crossStageState.get(CS_KEY.reportArtifact));
    const sections = artifact?.sections;
    if (!artifact || !Array.isArray(sections) || sections.length === 0) return;

    // S8B 三重时间护栏（审计 #34/#35）下沉 chapter-stream.helper：
    //   单 call withTimeout（self-eval 60s / remediate 90s）+ 20min wall-time 守卫 +
    //   auditLayers="minimal" 整段跳过。本方法只做 wiring（提供 rich 服务 deps + 回写）。
    const trace = this.rich.qualityTrace.createTrace(ctx.missionId);
    const result = await runGuardedSectionRemediation<RemediationAction>({
      sections: sections as RemediableSection[],
      topic: input.topic,
      language: input.language,
      auditLayers: input.invocation.auditLayers ?? [],
      ...(input.invocation.preferredModelId
        ? { preferredModelId: input.invocation.preferredModelId }
        : {}),
      deps: {
        evaluateSection: (i) => this.rich.sectionSelfEval.evaluateSection(i),
        determineRemediationActions: (e, t, l) =>
          // helper 把 eval 结果标注为更宽的 SelfEvalLite（readonly weakAreas）；
          // 运行时 e 即 evaluateSection 真实返回的 SectionSelfEvalResult，安全收窄。
          this.rich.sectionSelfEval.determineRemediationActions(
            e as Parameters<
              SectionSelfEvalService["determineRemediationActions"]
            >[0],
            t,
            l,
          ),
        remediate: (i) => this.rich.sectionRemediation.remediate(i),
        recordLoop: (info) =>
          this.rich.qualityTrace.recordDimensionRemediationLoop(
            trace,
            info.sectionKey,
            {
              selfEvalScoresBefore: info.before,
              selfEvalScoresAfter: info.after,
              weakAreasResolved: info.weakAreasResolved,
              ...(info.remediationModel
                ? { remediationModel: info.remediationModel }
                : {}),
            },
          ),
      },
      warn: (msg) => log.warn(`[${ctx.missionId}] ${msg}`),
    });

    if (result.mutated) {
      // section 内容变了 → 重建 content.fullMarkdown（前端连续阅读 / 复制 markdown 用）。
      this.rebuildArtifactMarkdown(artifact);
      crossStageState.set(CS_KEY.reportArtifact, artifact);
    }
  }

  // ── S10 leader foreword + signoff（signoff primitive，多层 verdict + 硬门）─────────
  //
  // 富增强（W2.5，对齐 playground s10-leader-foreword-and-signoff）：
  //   runRole 两次调用 leader：
  //     1. phase="foreword"：写 whatWeAnswered / whatRemainsUnclear / howToRead。
  //     2. phase="signoff"：签字 + 自评分（依赖 foreword 产出 + finalQuality + dimensionStates）。
  //   accountability hook 做最终问责裁决（在 LLM 签字之上叠加业务硬门）：
  //     1. s4 patch 失败（ctx.s4PatchFailures 非空）→ 强制 signed=false（防"说要补救没补就签"）。
  //     2. finalScore 经 QualityTrace 客观计算（从 10 维评估 + reviewScore 融合），落 CS_KEY.finalScore。
  //   forcedDegraded=true 时 signoff primitive 会让 stage 标记降级（前端可见）。
  private buildSignoffHooks(): ResolvedStageHooks {
    return defineStageHooks({
      runRole: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const full = this.fullArgs(args.ctx);
        const input = readPipelineInput(full.ctx);
        const onEvent = input.invocation.onEvent;
        const plan = full.crossStageState.get<PlanResult>(CS_KEY.plan);
        const researcherResults =
          full.crossStageState.get<ResearcherResult[]>(
            CS_KEY.researcherResults,
          ) ?? [];
        const artifact = asArtifact(
          full.crossStageState.get(CS_KEY.reportArtifact),
        );
        const goals: GoalsShape = full.crossStageState.get<GoalsShape>(
          CS_KEY.goals,
        ) ??
          plan?.goals ?? {
            successCriteria: ["完成研究报告，覆盖所有关键维度"],
            qualityBar: { minSources: 0, minCoverage: 0, hardConstraints: [] },
            deliverables: ["研究报告"],
          };
        // ★ dimensionStates（参照 s10 stage: dimStateOf）。
        const dimensionStates = (plan?.dimensions ?? []).map((d) => {
          const r = researcherResults.find((x) => x.dimension === d.name);
          const findings = r?.findings ?? [];
          const summary = r?.summary ?? "";
          const state: "completed" | "degraded" | "failed" =
            findings.length === 0
              ? "failed"
              : summary.startsWith("(failed")
                ? "degraded"
                : "completed";
          return { name: d.name, state };
        });
        // ★ reconciliation stats（从 CS_KEY.reconciliationReport 提取）。
        const rec = full.crossStageState.get<Record<string, unknown>>(
          CS_KEY.reconciliationReport,
        );
        const reconciliation = rec
          ? {
              factCount: Array.isArray(rec.factTable)
                ? rec.factTable.length
                : 0,
              conflictCount: Array.isArray(rec.conflicts)
                ? rec.conflicts.length
                : 0,
              criticalGaps: Array.isArray(rec.gaps)
                ? (
                    rec.gaps as Array<{
                      severity?: string;
                      expectedAspects?: string[];
                    }>
                  )
                    .filter((g) => g.severity === "critical")
                    .map((g) => (g.expectedAspects ?? []).join(", "))
                    .filter(Boolean)
                : ([] as string[]),
            }
          : undefined;
        // ★ QualitySnapshot（参照 s10 stage 构造，artifact 字段兜底避免 int 校验失败）。
        const reviewScore = full.crossStageState.get<number>(
          CS_KEY.reviewScore,
        );
        const pipelineEval = full.crossStageState.get<{
          overallScore?: number;
          grade?: string;
          feedback?: string;
        }>(CS_KEY.pipelineEvaluation);
        const qualitySnapshot = {
          sourceCount: Array.isArray(artifact?.citations)
            ? artifact.citations.length
            : 0,
          coverageScore:
            typeof (artifact?.quality as Record<string, unknown> | undefined)
              ?.dimensions === "object"
              ? (((
                  (artifact?.quality as Record<string, unknown>)
                    ?.dimensions as Record<string, unknown>
                )?.coverage as number | undefined) ?? 0)
              : 0,
          overall:
            typeof artifact?.quality?.overall === "number"
              ? artifact.quality.overall
              : 0,
          finalVerdict:
            typeof (artifact?.quality as Record<string, unknown> | undefined)
              ?.finalVerdict === "string"
              ? String(
                  (artifact?.quality as Record<string, unknown>).finalVerdict,
                )
              : "?",
          ...(typeof reviewScore === "number"
            ? { reviewerAvgScore: reviewScore }
            : {}),
          // ★ 从 CS 读 S9 critic 产物的 blindspots/biases（替代硬编码 []）。
          criticBlindspots:
            full.crossStageState.get<{
              blindspots?: string[];
            }>("deep-insight.criticVerdict")?.blindspots ?? ([] as string[]),
          criticBiases:
            full.crossStageState.get<{
              biasFlags?: string[];
            }>("deep-insight.criticVerdict")?.biasFlags ?? ([] as string[]),
          ...(typeof pipelineEval?.overallScore === "number"
            ? { objectiveScore: pipelineEval.overallScore }
            : {}),
          ...(pipelineEval?.grade
            ? { objectiveGrade: pipelineEval.grade }
            : {}),
          ...(pipelineEval?.feedback
            ? { objectiveFeedback: pipelineEval.feedback }
            : {}),
        };
        emitDomain(onEvent, "agent:narrative", {
          stage: "s10-leader-signoff",
          role: "leader",
          tag: "reviewing",
          text: "Leader 开始对最终报告进行前言与签字评估...",
        });
        try {
          // ── Phase 1: foreword ──────────────────────────────────────────────
          const forewordRes = await invokeAgent({
            runner: this.runner,
            specId: "playground.leader",
            input: {
              phase: "foreword",
              topic: input.topic,
              language: input.language,
              myPlan: { goals, dimensions: plan?.dimensions ?? [] },
              myDecisions: [],
              stageOutcomes: {
                researcherStates: dimensionStates,
                ...(reconciliation ? { reconciliation } : {}),
                writerSections: Array.isArray(artifact?.sections)
                  ? (
                      artifact.sections as Array<{
                        title?: string;
                        heading?: string;
                      }>
                    ).map((s) => s.title ?? s.heading ?? "")
                  : [],
                qualitySnapshot,
              },
            },
            invocation: input.invocation,
            crossStageState: full.crossStageState,
            signal: full.ctx.signal,
            stepId: "s10-leader-foreword-signoff",
            role: "leader",
            operationType: "foreword",
            onEvent,
          });
          const forewordOutput = forewordRes.output as {
            whatWeAnswered?: Array<{
              criterion: string;
              addressed: "yes" | "partial" | "no";
              evidence: string;
            }>;
            whatRemainsUnclear?: string[];
            howToRead?: string;
          } | null;
          // ★ F2/F1 leaderForeword：写入 CS_KEY（报告组装阶段读取）。
          if (forewordOutput) {
            full.crossStageState.set(CS_KEY.leaderForeword, forewordOutput);
          }
          // ★ 恢复 leader:foreword 事件（projector ~:1007-1023，s10 todo in_progress + foreword artifact）。
          // 形状照抄旧 s10-leader-foreword-and-signoff.stage.ts:281-290：payload 就是 leaderForeword 对象。
          emitDomain(onEvent, "leader:foreword", {
            ...(forewordOutput ?? {}),
          });
          // ── Phase 2: signoff ──────────────────────────────────────────────
          const wordCount =
            typeof artifact?.metadata?.wordCount === "number"
              ? artifact.metadata.wordCount
              : 0;
          const finalQuality = {
            sourceCount: qualitySnapshot.sourceCount,
            coverageScore: qualitySnapshot.coverageScore,
            overall: qualitySnapshot.overall,
            finalVerdict: qualitySnapshot.finalVerdict,
            wordCount,
            ...(typeof reviewScore === "number"
              ? { reviewerAvgScore: reviewScore }
              : {}),
            ...(typeof pipelineEval?.overallScore === "number"
              ? { objectiveScore: pipelineEval.overallScore }
              : {}),
            ...(pipelineEval?.grade
              ? { objectiveGrade: pipelineEval.grade }
              : {}),
            ...(pipelineEval?.feedback
              ? { objectiveFeedback: pipelineEval.feedback }
              : {}),
          };
          // myForeword：使用 foreword 产出；兜底给 schema 合法最小值。
          const whatWeAnswered =
            Array.isArray(forewordOutput?.whatWeAnswered) &&
            forewordOutput.whatWeAnswered.length > 0
              ? forewordOutput.whatWeAnswered
              : [
                  {
                    criterion: "研究目标",
                    addressed: "yes" as const,
                    evidence: "完成了所有研究维度的分析",
                  },
                ];
          const myForeword = {
            whatWeAnswered,
            whatRemainsUnclear: Array.isArray(
              forewordOutput?.whatRemainsUnclear,
            )
              ? forewordOutput.whatRemainsUnclear
              : [],
          };
          const signoffRes = await invokeAgent({
            runner: this.runner,
            specId: "playground.leader",
            input: {
              phase: "signoff",
              topic: input.topic,
              language: input.language,
              myPlan: { goals, dimensions: plan?.dimensions ?? [] },
              myDecisions: [],
              myForeword,
              finalQuality,
              dimensionStates,
            },
            invocation: input.invocation,
            crossStageState: full.crossStageState,
            signal: full.ctx.signal,
            stepId: "s10-leader-foreword-signoff",
            role: "leader",
            operationType: "signoff",
            onEvent,
          });
          const signoff = signoffRes.output as
            | { signed?: boolean }
            | null
            | undefined;
          emitDomain(onEvent, "agent:narrative", {
            stage: "s10-leader-signoff",
            role: "leader",
            tag: "signing",
            text:
              signoff?.signed === false
                ? "Leader 拒绝签字，报告需进一步修订..."
                : "Leader 完成签字，报告通过最终质量审核。",
          });
          // ★ F2/F1 leaderJournal：s10 signoff 决策追加一条。
          full.crossStageState.append<LeaderJournalEntry>(
            CS_KEY.leaderJournal,
            {
              stage: "s10-leader-foreword-signoff",
              decision: signoff?.signed === false ? "rejected" : "signed",
              summary:
                signoff?.signed === false
                  ? `Leader 拒绝签字：${
                      (
                        signoffRes.output as
                          | Record<string, unknown>
                          | null
                          | undefined
                      )?.refusalReason ?? "质量未达标"
                    }`
                  : "Leader 完成签字，报告通过最终质量审核",
              ts: Date.now(),
            },
          );
          // ★ 恢复 leader:signed 事件（projector ~:1027-1081，s10 done/failed + score/verdict/拒签原因）。
          // 形状照抄旧 s10-leader-foreword-and-signoff.stage.ts:118-131：payload 就是 leaderSignOff 对象。
          if (signoffRes.output != null) {
            const so = signoffRes.output as Record<string, unknown>;
            emitDomain(onEvent, "leader:signed", {
              signed: so.signed ?? true,
              ...(typeof so.leaderOverallScore === "number"
                ? { leaderOverallScore: so.leaderOverallScore }
                : {}),
              ...(typeof so.leaderVerdict === "string"
                ? { leaderVerdict: so.leaderVerdict }
                : {}),
              ...(typeof so.refusalReason === "string"
                ? { refusalReason: so.refusalReason }
                : {}),
              ...(typeof so.accountabilityNote === "string"
                ? { accountabilityNote: so.accountabilityNote }
                : {}),
            });
          }
          return signoffRes.output;
        } catch {
          // signoff 可降级：缺 leader 签字不阻断终态产出。
          return null;
        }
      },
      accountability: (args: {
        raw: unknown;
        ctx: StageRunArgs["ctx"];
        crossStageState: CrossStageState;
      }): { forcedDegraded?: boolean; signoff: unknown } => {
        // 用 runner 绑定的 crossState（与 s4 写入、终态读取同一实例）。
        const cs = this.fullArgs(args.ctx).crossStageState;
        const input = readPipelineInput(args.ctx);
        const onEvent = input.invocation.onEvent;
        const patchFailures =
          cs.get<Array<{ dimension: string }>>(CS_KEY.s4PatchFailures) ?? [];
        const objectiveScore = this.objectiveFinalScore(cs);
        if (typeof objectiveScore === "number") {
          cs.set(CS_KEY.finalScore, objectiveScore);
        }
        let signoff = args.raw;
        let forcedDegraded = false;
        // s4 patch 失败 → 强制拒签（覆盖 LLM 的 signed）。
        if (
          patchFailures.length > 0 &&
          signoff &&
          typeof signoff === "object"
        ) {
          const s = { ...(signoff as Record<string, unknown>) };
          s.signed = false;
          s.refusalReason =
            (typeof s.refusalReason === "string" && s.refusalReason) ||
            `s4 评估标记 ${patchFailures.length} 个维度需补救但未完成闭环，按问责规则强制拒签`;
          signoff = s;
          forcedDegraded = true;
          // ★ 强制拒签路径发 leader:signed（projector ~:1626-1638 对应旧 emitLeaderSigned）。
          emitDomain(onEvent, "leader:signed", {
            signed: false,
            refusalReason: s.refusalReason as string,
            ...(typeof s.accountabilityNote === "string"
              ? { accountabilityNote: s.accountabilityNote }
              : {}),
          });
        }
        cs.set(CS_KEY.leaderSignOff, signoff ?? null);

        // ★ F2/F1 增强：把 leaderForeword / leaderJournal / verdictConsensus /
        //   citations occurrences 注入 reportArtifact.metadata（纯 CS 读写，不落库）。
        const artifact = asArtifact(cs.get(CS_KEY.reportArtifact));
        if (artifact) {
          const meta = artifact.metadata ?? {};

          // (1) leaderForeword：把 s10 foreword 产物写进 metadata。
          const foreword = cs.get<{
            whatWeAnswered?: unknown[];
            whatRemainsUnclear?: string[];
            howToRead?: string;
          }>(CS_KEY.leaderForeword);
          if (foreword) {
            meta.leaderForeword = foreword;
          }

          // (2) leaderJournal：决策轨迹附录。
          const journal =
            cs.get<LeaderJournalEntry[]>(CS_KEY.leaderJournal) ?? [];
          if (journal.length > 0) {
            meta.leaderJournal = journal;
          }

          // (3) verdictConsensus (#36)：多轮 reviewer verdict 合成共识。
          const accumulated =
            cs.get<
              Array<{
                stepId: string;
                score?: number;
                verdict?: "approve" | "revise" | "reject";
                notes?: string[];
              }>
            >(CS_KEY.reviewVerdicts) ?? [];
          if (accumulated.length > 0) {
            meta.verdictConsensus =
              this.synthesizeVerdictConsensus(accumulated);
          }

          // (4) citations occurrences (#36)：确保 citations 数量呈现在 metadata。
          const citationCount = Array.isArray(artifact.citations)
            ? artifact.citations.length
            : 0;
          if (citationCount > 0) {
            meta.citationsCount = citationCount;
          }

          // (5) A3：从 10 维客观评估派生逐维 verifierVerdicts，落 CS_KEY.verifierVerdicts。
          //     满足 recipe ctxWrites 声明 + runner :425 读取 → CapabilityRunResult.verdicts
          //     + 持久化 mission.verdicts（恢复"重载完成态显示 verdicts"；此前该 key 从无
          //     人写，runner 读到恒 null，verdicts 字段静默缺失）。
          const qualityDims = (
            artifact.quality as
              | { dimensions?: Record<string, unknown> }
              | undefined
          )?.dimensions;
          if (qualityDims && typeof qualityDims === "object") {
            // ★ 正确字段名是 verifierId——mission-view.projector:206/242 按 verifierId 过滤
            //   持久化 row.verdicts；旧写法只有 dimension 字段 → 完成态 verdicts 被滤成空数组。
            //   保留 dimension 别名（第一波 projector 兼容回退读 dimension，不破坏）。
            const verifierVerdicts = Object.entries(qualityDims)
              .filter(([, score]) => typeof score === "number")
              .map(([dimension, score]) => ({
                verifierId: dimension,
                dimension,
                score: score as number,
              }));
            if (verifierVerdicts.length > 0) {
              cs.set(CS_KEY.verifierVerdicts, verifierVerdicts);
            }
          }

          artifact.metadata = meta;
          cs.set(CS_KEY.reportArtifact, artifact);
        }

        return { signoff: signoff ?? null, forcedDegraded };
      },
    });
  }

  // ── S11 final persist（persist primitive，final 模式；无 LLM，落库经端口由 runner 做）
  private buildPersistHooks(): ResolvedStageHooks {
    return defineStageHooks({
      persist: async (): Promise<void> => {
        // 终态落库（applyTerminalIfRunning）+ checkpoint 清理由 runner 在
        // orchestrator.run 返回后经 ctx.persistence 做；本 step 仅作 pipeline 终点锚点。
      },
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────────

  /**
   * 部分 primitive 的 hook 签名只给 { ctx } 子集（如 plan.runRole / synthesize.synthesize），
   * 不透传 crossStageState。但 ctx.missionId 全程稳定——runner 在 run 前用
   * attachState(missionId, crossStageState) 把本次 run 的 crossStageState 绑到
   * missionId，hook 内 fullArgs(ctx) 据 ctx.missionId 取回（与 playground 据
   * missionId 取 SessionEntry.crossState 同款）。
   */
  private fullArgs(ctx: StageRunArgs["ctx"]): {
    ctx: StageRunArgs["ctx"];
    crossStageState: CrossStageState;
  } {
    const cs = STATE_BY_MISSION.get(ctx.missionId);
    if (!cs) {
      throw new Error(
        "[deep-insight bindings] crossStageState 未绑定到 missionId（attachState 未调用）",
      );
    }
    return { ctx, crossStageState: cs };
  }

  private normalizePlan(
    raw: unknown,
    topic: string,
    depth: "quick" | "standard" | "deep" = "standard",
  ): PlanResult {
    const p = raw as
      | {
          themeSummary?: unknown;
          dimensions?: Array<{
            id?: unknown;
            name?: unknown;
            rationale?: unknown;
            facet?: unknown;
            toolHint?: { categories?: string[]; preferIds?: string[] };
          }>;
          goals?: GoalsShape;
        }
      | undefined;
    const rawDims = Array.isArray(p?.dimensions) ? p.dimensions : [];
    // ★ 维度上限按 depth 档位（与 leader.agent.ts 校验区间上限一致：quick 3-5 /
    //   standard 5-8 / deep 8-12）。此前硬编码 slice(0,6) 把 deep 档位 leader 产出的
    //   10-12 个维度一律砍到 6，深度模式名存实亡（2026-06-10 用户实测报告修复）。
    const dimCap = depth === "quick" ? 5 : depth === "deep" ? 12 : 8;
    const dimensions = rawDims
      .filter(
        (
          d,
        ): d is {
          id?: unknown;
          name: string;
          rationale?: unknown;
          facet?: unknown;
          toolHint?: { categories?: string[]; preferIds?: string[] };
        } => !!d && typeof (d as { name?: unknown }).name === "string",
      )
      .slice(0, dimCap)
      .map((d, i) => ({
        id: typeof d.id === "string" ? d.id : `dim-${i + 1}`,
        name: String(d.name),
        rationale: typeof d.rationale === "string" ? d.rationale : "",
        // ★ toolHint 是 Dimension schema 必填（categories min 1）；LLM 产出如缺失则
        //   补 "general" 兜底，确保 s4/s10 myPlan.dimensions safeParse 不失败。
        toolHint: d.toolHint?.categories?.length
          ? {
              categories: d.toolHint.categories,
              ...(d.toolHint.preferIds
                ? { preferIds: d.toolHint.preferIds }
                : {}),
            }
          : { categories: ["general"] },
        ...(d.facet ? { facet: String(d.facet) } : {}),
      }));
    if (dimensions.length === 0) {
      dimensions.push({
        id: "dim-1",
        name: topic,
        rationale: "",
        toolHint: { categories: ["general"] },
      });
    }
    // ★ goals 保留（GoalsShape），供 s4 / s10 myPlan.goals；LLM 缺产时给最小合法默认值。
    const rawGoals = p?.goals;
    const goals: GoalsShape = rawGoals
      ? {
          successCriteria:
            Array.isArray(rawGoals.successCriteria) &&
            rawGoals.successCriteria.length > 0
              ? rawGoals.successCriteria.map(String)
              : ["完成研究报告"],
          qualityBar: {
            minSources:
              typeof rawGoals.qualityBar?.minSources === "number"
                ? rawGoals.qualityBar.minSources
                : 0,
            minCoverage:
              typeof rawGoals.qualityBar?.minCoverage === "number"
                ? rawGoals.qualityBar.minCoverage
                : 0,
            hardConstraints: Array.isArray(rawGoals.qualityBar?.hardConstraints)
              ? rawGoals.qualityBar.hardConstraints.map(String)
              : [],
          },
          deliverables:
            Array.isArray(rawGoals.deliverables) &&
            rawGoals.deliverables.length > 0
              ? rawGoals.deliverables.map(String)
              : ["研究报告"],
        }
      : {
          successCriteria: ["完成研究报告，覆盖所有关键维度"],
          qualityBar: { minSources: 0, minCoverage: 0, hardConstraints: [] },
          deliverables: ["研究报告"],
        };
    return {
      themeSummary:
        typeof p?.themeSummary === "string" ? p.themeSummary : topic,
      dimensions,
      goals,
    };
  }

  /** 从 leader assess-research 产出读 decision（accept-all/patch/redirect/abort）。 */
  private readLeaderAssessDecision(
    raw: unknown,
  ): "accept-all" | "patch" | "redirect" | "abort" {
    if (!raw || typeof raw !== "object") return "accept-all";
    const d = (raw as { decision?: unknown }).decision;
    if (
      d === "patch" ||
      d === "redirect" ||
      d === "abort" ||
      d === "accept-all"
    ) {
      return d;
    }
    return "accept-all";
  }

  /**
   * 从 leader assess perDimension 抽出非 accept 的弱维度（s4PatchFailures 记账）。
   *
   * P1-4 修复：leader schema 真实字段是 dimensionId（不是 dimension），读取顺序为
   *   r.dimensionId ?? r.dimensionName ?? r.dimension。
   *   若有 plan，优先把 dimensionId 经 plan.dimensions 解析为维度名；解析不到才落 "(unknown)"。
   */
  private extractWeakDimensions(
    raw: unknown,
    plan?: PlanResult,
  ): Array<{ dimension: string; reason: string }> {
    if (!raw || typeof raw !== "object") return [];
    const per = (raw as { perDimension?: unknown }).perDimension;
    if (!Array.isArray(per)) return [];
    const out: Array<{ dimension: string; reason: string }> = [];
    for (const item of per) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const action = typeof r.action === "string" ? r.action : "";
      if (!action || action === "accept") continue;
      // dimensionId 是 leader schema 真实字段；兼容旧 dimensionName / dimension 写法。
      const rawId =
        typeof r.dimensionId === "string"
          ? r.dimensionId
          : typeof r.dimensionName === "string"
            ? r.dimensionName
            : typeof r.dimension === "string"
              ? r.dimension
              : undefined;
      // 先尝试从 plan.dimensions 按 id 或名称反查，保证维度名准确。
      let dimName = "(unknown)";
      if (rawId && plan) {
        const found =
          plan.dimensions.find((d) => d.id === rawId) ??
          plan.dimensions.find((d) => d.name === rawId);
        dimName = found?.name ?? rawId;
      } else if (rawId) {
        dimName = rawId;
      }
      out.push({ dimension: dimName, reason: action });
    }
    return out;
  }

  /**
   * S4 assess：对每个 researcherOutcome 发 dimension:graded 事件（成功路径 + 降级路径共用）。
   *
   * P1-3 提取：成功路径和 catch 降级路径共享同一发射逻辑，避免复制粘贴。
   *   - 成功路径传入 LLM output（有 perDimension verdict），结合启发式打分；
   *   - 降级路径传入 undefined，全部用启发式兜底（completed→60+min(findings×5,40)、degraded→50、failed→30）。
   */
  private emitAssessGraded(
    onEvent: AgentInvocation["onEvent"],
    researcherOutcomes: ReadonlyArray<DimensionOutcomeLite>,
    output: unknown,
  ): void {
    // grade/summary/overall 纯计算下沉 dimension-grade.helper（god-class size guard）；
    // axes 不发（deep-insight 启发式打分无 5 轴 grader，schema axes optional 缺省合法）。
    for (const g of computeDimensionGrades(researcherOutcomes, output)) {
      emitDomain(onEvent, "dimension:graded", g);
    }
  }

  /**
   * s9 critic verdict → reportArtifact.quality.overall 降权（fail ×0.7 / concerns ×0.9）。
   * 让 s10 leader 看到经独立复审修正后的真实质量信号。
   */
  private applyCriticDowngrade(
    verdict: unknown,
    crossStageState: CrossStageState,
  ): void {
    if (!verdict || typeof verdict !== "object") return;
    const v = (verdict as { overallVerdict?: unknown }).overallVerdict;
    const factor = v === "fail" ? 0.7 : v === "concerns" ? 0.9 : 1;
    if (factor === 1) return;
    const artifact = asArtifact(crossStageState.get(CS_KEY.reportArtifact));
    if (!artifact?.quality || typeof artifact.quality.overall !== "number") {
      return;
    }
    artifact.quality.overall = Math.round(artifact.quality.overall * factor);
    crossStageState.set(CS_KEY.reportArtifact, artifact);
  }

  /**
   * s10 客观 finalScore：优先 10 维客观评估 overallScore；缺则回退 reviewScore；
   * 再缺则回退 reportArtifact.quality.overall。纯计算，无 LLM。
   */
  private objectiveFinalScore(
    crossStageState: CrossStageState,
  ): number | undefined {
    const evalResult = crossStageState.get<{ overallScore?: number }>(
      CS_KEY.pipelineEvaluation,
    );
    if (typeof evalResult?.overallScore === "number") {
      return Math.round(evalResult.overallScore);
    }
    const reviewScore = crossStageState.get<number>(CS_KEY.reviewScore);
    if (typeof reviewScore === "number") return Math.round(reviewScore);
    const artifact = asArtifact(crossStageState.get(CS_KEY.reportArtifact));
    if (typeof artifact?.quality?.overall === "number") {
      return Math.round(artifact.quality.overall);
    }
    return undefined;
  }

  /**
   * figure re-home（2026-06-09）：组装前对每维 figureCandidates 做 embedding 相关性精排。
   *
   * 等价 playground s3 的 `filterRelevantFigures(candidates, dim.name)`：
   *   - 按 dimension 分别精排（每维 caption 对标该维 name，缺则回退 topic）；
   *   - 候选缺 imageUrl 不可成图，精排前剔除（但保留在结果外，不污染相关性判断）；
   *   - FigureRelevance 入参是 ExtractedFigure（需 type）；researcher 候选是 web 抓取图，
   *     统一映射 type="photo"（触发 caption 语义判断，正是精排目标）；
   *   - fail-open：单维精排失败保留该维原候选；整体异常返回原 researcherResults，不阻断报告。
   */
  private async rankFigureCandidates(
    researcherResults: FigureRankableResearcher[],
    plan: PlanResult | undefined,
    topic: string,
  ): Promise<FigureRankableResearcher[]> {
    try {
      return await Promise.all(
        researcherResults.map(async (r) => {
          const candidates = r.figureCandidates;
          if (!candidates || candidates.length === 0) return r;
          // 维度名：candidate 无 dimension 锚点，用 researcher.dimension 对标该维；缺则回退 topic。
          const dimName =
            plan?.dimensions.find((d) => d.name === r.dimension)?.name ??
            r.dimension ??
            topic;
          // 仅可成图（有 imageUrl）的候选进精排；映射成 ExtractedFigure（type=photo 触发语义判断）。
          const rankable = candidates.filter(
            (c): c is FigureCandidate & { imageUrl: string } =>
              typeof c.imageUrl === "string" && c.imageUrl.length > 0,
          );
          if (rankable.length === 0) return r;
          const figures: ExtractedFigure[] = rankable.map((c) => ({
            imageUrl: c.imageUrl,
            caption: c.caption ?? "",
            type: "photo",
          }));
          try {
            const relevant =
              await this.rich.figureRelevance.filterRelevantFigures(
                figures,
                dimName,
              );
            const keptUrls = new Set(
              relevant.map((f: ExtractedFigure) => f.imageUrl),
            );
            // 精排只保留通过的候选（顺序保持），其余（含无 imageUrl 的）一律剔除——
            // 无 imageUrl 的候选本就不可渲染成图，不应入图库。
            const kept = candidates.filter(
              (c) => typeof c.imageUrl === "string" && keptUrls.has(c.imageUrl),
            );
            return { ...r, figureCandidates: kept };
          } catch {
            // 单维精排失败 fail-open：保留该维原候选。
            return r;
          }
        }),
      );
    } catch {
      // 整体异常 fail-open：返回原 researcherResults，不阻断报告组装。
      return researcherResults;
    }
  }

  /** s8b 补救后 section 内容变了 → 重建 content.fullMarkdown（标题 ## + body 拼接）。 */
  private rebuildArtifactMarkdown(artifact: ReportArtifactLite): void {
    const parts: string[] = [];
    if (artifact.title) parts.push(`# ${artifact.title}`);
    for (const s of artifact.sections ?? []) {
      const heading = s.title ?? s.heading;
      if (heading) parts.push(`## ${heading}`);
      const body = s.content ?? s.body;
      if (body) parts.push(body);
    }
    const fullMarkdown = parts.join("\n\n");
    artifact.content = {
      fullMarkdown,
      fullReportSize: Buffer.byteLength(fullMarkdown, "utf8"),
    };
  }

  private extractScore(verdict: unknown): number | undefined {
    if (!verdict || typeof verdict !== "object") return undefined;
    const v = verdict as Record<string, unknown>;
    return typeof v.score === "number" ? v.score : undefined;
  }

  private synthReviewVerdict(verdict: unknown):
    | {
        score?: number;
        verdict?: "approve" | "revise" | "reject";
        notes?: string[];
      }
    | undefined {
    if (!verdict || typeof verdict !== "object") return undefined;
    const r = verdict as Record<string, unknown>;
    const score = typeof r.score === "number" ? r.score : undefined;
    const v =
      r.verdict === "approve" ||
      r.verdict === "revise" ||
      r.verdict === "reject"
        ? (r.verdict as "approve" | "revise" | "reject")
        : undefined;
    const notes = Array.isArray(r.notes)
      ? r.notes.filter((n): n is string => typeof n === "string")
      : undefined;
    if (score === undefined && v === undefined) return undefined;
    return {
      ...(score !== undefined ? { score } : {}),
      ...(v !== undefined ? { verdict: v } : {}),
      ...(notes?.length ? { notes } : {}),
    };
  }

  /**
   * ★ F2/F1 #36 verdict 共识合成：
   *   多轮 reviewer verdict（s8b + s9b）→ 加权平均分 + 多数表决。
   *   规则：s9b 是更后的客观评分，权重 ×1.5；s8b 权重 ×1。
   *   verdict 多数表决（approve > revise > reject 优先级，票数相同取更严格的）。
   */
  private synthesizeVerdictConsensus(
    accumulated: Array<{
      stepId: string;
      score?: number;
      verdict?: "approve" | "revise" | "reject";
      notes?: string[];
    }>,
  ): {
    consensusVerdict: "approve" | "revise" | "reject" | "unknown";
    avgScore?: number;
    sources: string[];
    notes: string[];
  } {
    const WEIGHT: Record<string, number> = {
      "s9b-objective-eval": 1.5,
      "s8b-quality-enhancement": 1,
    };
    let weightedScoreSum = 0;
    let totalWeight = 0;
    const verdictWeights: Record<string, number> = {
      approve: 0,
      revise: 0,
      reject: 0,
    };
    const allNotes: string[] = [];
    const sources: string[] = [];

    for (const v of accumulated) {
      const w = WEIGHT[v.stepId] ?? 1;
      sources.push(v.stepId);
      if (typeof v.score === "number") {
        weightedScoreSum += v.score * w;
        totalWeight += w;
      }
      if (
        v.verdict === "approve" ||
        v.verdict === "revise" ||
        v.verdict === "reject"
      ) {
        verdictWeights[v.verdict] = (verdictWeights[v.verdict] ?? 0) + w;
      }
      if (v.notes) {
        allNotes.push(...v.notes);
      }
    }

    const avgScore =
      totalWeight > 0 ? Math.round(weightedScoreSum / totalWeight) : undefined;

    // 多数表决：取加权最高的；同权时优先更严格（reject > revise > approve）。
    const priority: Array<"approve" | "revise" | "reject"> = [
      "reject",
      "revise",
      "approve",
    ];
    let consensusVerdict: "approve" | "revise" | "reject" | "unknown" =
      "unknown";
    let maxWeight = 0;
    for (const label of priority) {
      const w = verdictWeights[label] ?? 0;
      // 严格大于：所有 reviewer 均无 verdict 字段（权重全 0）时保留 "unknown" 缺省，
      // 不被 priority 末项 "approve" 误覆盖。
      if (w > maxWeight) {
        maxWeight = w;
        consensusVerdict = label;
      }
    }

    return {
      consensusVerdict,
      ...(avgScore !== undefined ? { avgScore } : {}),
      sources,
      notes: allNotes,
    };
  }
}

/**
 * missionId → crossStageState 绑定表。
 *
 * 背景：部分 primitive 的 hook 签名只给 { ctx } 子集（如 plan.runRole /
 * synthesize.synthesize），不透传 crossStageState。但 orchestrator 内部对每个
 * mission 只构造一份 crossStageState 并全程透传；runner 在 orchestrator.run 前
 * 用同一份 crossStageState 调 attachState(missionId, cs)，hook 内据 ctx.missionId
 * 取回。
 *
 * 注意：本表 key 为 missionId（per-run 隔离），runner 在 run 的 finally 必须
 * detachState(missionId) 清理，避免 module-level 可变态泄漏 / 跨 run 污染
 * （对齐 Claude Code 反向洞察 #8：禁跨 thread 污染 module-level state）。
 */
const STATE_BY_MISSION = new Map<string, CrossStageState>();

/** runner 在 orchestrator.run 前调用：把本次 run 的 crossStageState 绑到 missionId。 */
export function attachState(
  missionId: string,
  crossStageState: CrossStageState,
): void {
  STATE_BY_MISSION.set(missionId, crossStageState);
}

/** runner 在 run 的 finally 调用：清理绑定，防 module-level state 泄漏。 */
export function detachState(missionId: string): void {
  STATE_BY_MISSION.delete(missionId);
}
