/**
 * LeaderService —— Mission "领导"在工程层的承载体
 *
 * 设计决策 (mission-pipeline-baseline.md §Leader-as-Single-Responsibility):
 *   • 业务概念"领导（Leader）"在工程上是 SupervisedMission 实例
 *   • LeaderService 是 NestJS provider 工厂：每个 mission create() 一个 SupervisedMission
 *   • SupervisedMission 是 TypeScript 类，承载跨 milestone 的 missionContext
 *   • 全程委托同一个 LeaderAgent LLM spec 完成 4 个 milestone 的认知决策
 *   • 让 LeaderAgent 在 M7 签字时能引用自己 M0/M1/M6 的历史决策做真正的问责
 *
 * 用法:
 *   const leader = leaderService.create(missionId, userId, task, runFn);
 *   const plan = await leader.plan();
 *   // ...researchers 跑完...
 *   const m1 = await leader.assessResearchers(researcherOutcomes);
 *   // ...reconciler / analyst / writer / reviewer / critic 跑完...
 *   const foreword = await leader.writeForeword(stageOutcomes);
 *   const signOff = await leader.signOff(finalQuality, dimensionStates);
 *   if (!signOff.signed) { mission status = quality-failed }
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  LeaderAgent,
  type LeaderAssessResearchOutput,
  type LeaderForewordOutput,
  type LeaderPlanOutput,
  type LeaderSignoffOutput,
} from "../agents/leader/leader.agent";

export type { LeaderPlanOutput } from "../agents/leader/leader.agent";
import { MissionStore } from "../lifecycle/mission-store.service";
import { describeLeaderFailure } from "./leader-failure-diagnostic.utils";
// ★ 2026-05-22 矩阵配置：维度 facet → 推荐工具集 确定性派生
import { resolveFacetPreferredTools } from "../../api/contracts/dimension-tool-matrix";

// ── Public types ──

export interface LeaderTask {
  topic: string;
  /** 选填长文本"研究描述"——补充用户意图细节，进 Leader 4 phase prompt 提升 plan 质量 */
  description?: string;
  depth: "quick" | "standard" | "deep";
  language: "zh-CN" | "en-US";
  userProfile?: unknown;
}

export interface LeaderResearcherOutcome {
  dimensionId: string;
  dimensionName: string;
  state: "completed" | "degraded" | "failed";
  findingsCount: number;
  sources: string[];
  summary: string;
  failureCode?: string;
}

export interface LeaderStageOutcomes {
  researcherStates: {
    name: string;
    state: "completed" | "degraded" | "failed";
  }[];
  reconciliation?: {
    factCount: number;
    conflictCount: number;
    criticalGaps: string[];
  };
  writerSections: string[];
  qualitySnapshot: {
    sourceCount: number;
    coverageScore: number;
    overall: number;
    finalVerdict: string;
    reviewerAvgScore?: number;
    criticVerdict?: "pass" | "concerns" | "fail";
    criticBlindspots: string[];
    criticBiases: string[];
    // ★ 沉淀消费 v3 (2026-04-29): 10 维客观评审注入
    objectiveScore?: number;
    objectiveGrade?: string;
    objectiveFeedback?: string;
  };
}

export interface LeaderFinalQuality {
  sourceCount: number;
  coverageScore: number;
  overall: number;
  finalVerdict: string;
  wordCount: number;
  reviewerAvgScore?: number;
  criticVerdict?: "pass" | "concerns" | "fail";
  // ★ 沉淀消费 v3 (2026-04-29): 10 维客观评审注入
  objectiveScore?: number;
  objectiveGrade?: string;
  objectiveFeedback?: string;
  // ★ P0#3 (2026-04-29): lengthAccuracy 反向闭环到 leader signoff 决策
  // 由 ReportAssembler.buildQualityStub 计算（实际字数 vs lengthProfile target ±20%/40%/60%）
  // 0-100：≥80=兑现承诺；<60=严重缩水（如 mega 承诺 200K 实际 50K），leader 应限制 verdict ≤ acceptable
  lengthAccuracy?: number;
  /** 用户期望字数（lengthProfile 推算的 target），给 leader 看实际 vs 期望差距 */
  targetWordCount?: number;
}

interface PastDecision {
  phase: "plan" | "assess-research" | "foreword";
  at: string;
  decision: string;
  rationale: string;
}

interface MissionContext {
  missionId: string;
  userId: string;
  task: LeaderTask;
  plan?: LeaderPlanOutput;
  decisions: PastDecision[];
  foreword?: LeaderForewordOutput & { generatedAt: string };
}

// ── Runner abstraction (parameter, avoid circular DI) ──

/**
 * 注入到 SupervisedMission 的 runner 抽象。
 * orchestrator 已经持有真实的 AgentRunner（来自 ai-harness/facade），
 * 直接传函数避免循环依赖 + 让 supervisor 跟 orchestrator 共享 envAdapter / billing context。
 */
export type LeaderRunFn = <TIn, TOut>(args: {
  spec: typeof LeaderAgent;
  input: TIn;
  agentId: string;
}) => Promise<{
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: TOut;
  events?: readonly unknown[];
}>;

// ── SupervisedMission：单 mission 的 Lead 容器 ──

export class SupervisedMission {
  private context: MissionContext;

  constructor(
    missionId: string,
    userId: string,
    task: LeaderTask,
    private readonly runFn: LeaderRunFn,
    private readonly store: MissionStore,
    private readonly log: Logger,
  ) {
    this.context = { missionId, userId, task, decisions: [] };
  }

  /** ★ M0: 拆分维度 + 声明目标（带 self-heal：第一次挂在可恢复码 → 自动重试一次） */
  async plan(opts?: {
    priorPostmortems?: {
      missionId: string;
      topic: string;
      summary: string;
      recommendations: string[];
      leaderSigned: boolean | null;
      qualityScore: number | null;
      createdAt: string;
    }[];
  }): Promise<LeaderPlanOutput> {
    const planInput = {
      phase: "plan" as const,
      topic: this.context.task.topic,
      description: this.context.task.description,
      depth: this.context.task.depth,
      language: this.context.task.language,
      userProfile: this.context.task.userProfile,
      // ★ P0#2 (2026-04-29): S12 → S2 闭环
      priorPostmortems: opts?.priorPostmortems ?? [],
    };

    let res = await this.runFn<unknown, LeaderPlanOutput>({
      spec: LeaderAgent,
      input: planInput,
      agentId: "leader",
    });

    // self-heal：第一次挂在可恢复码（schema 不达标 / 截断 / 空响应）→ 自动重试一次
    if (
      res.state !== "completed" ||
      !res.output ||
      res.output.phase !== "plan"
    ) {
      const fail0 = describeLeaderFailure("plan", res);
      if (fail0.recoverable) {
        this.log.warn(
          `[supervisor.plan ${this.context.missionId}] first attempt failed (${fail0.code}: ${fail0.message.slice(0, 200)}); retrying once`,
        );
        res = await this.runFn<unknown, LeaderPlanOutput>({
          spec: LeaderAgent,
          input: planInput,
          agentId: "leader.retry1",
        });
      }
    }

    if (
      res.state !== "completed" ||
      !res.output ||
      res.output.phase !== "plan"
    ) {
      const fail = describeLeaderFailure("plan", res);
      // 抛出带完整诊断信息的错误：上层 catch 会把它写到 mission.errorMessage / lifecycle.error，
      // 前端任务详情就能看到具体失败码和消息（不再是 generic "did not return valid plan"）
      throw new Error(`Leader.plan failed [${fail.code}]: ${fail.message}`);
    }
    // ★ 防御 LLM 违反 plan.md prompt：
    //    plan.md 第 84 行明确："minCoverage 给 60-80，不要给 90+，原因：90+ 几乎不可能在多 dim 并行采集时全达标"
    //    但实测 LLM 经常无视该建议，给出 minCoverage=85/90/95，导致拒签线 (× 0.7) = 60+ 也无法达标
    //    对策：output 后处理 clamp 到 80，并把原值记到 decisions 让 leader 自己看到调整
    {
      const qb = res.output.goals?.qualityBar;
      if (qb && typeof qb.minCoverage === "number" && qb.minCoverage > 80) {
        const original = qb.minCoverage;
        qb.minCoverage = 80;
        this.log.warn(
          `[supervisor.plan ${this.context.missionId}] clamped minCoverage ${original}→80 (LLM violated plan.md guidance)`,
        );
        this.context.decisions.push({
          phase: "plan",
          at: new Date().toISOString(),
          decision: `clamp-minCoverage:${original}→80`,
          rationale:
            "Leader 在 plan 阶段提出的 minCoverage 超过 plan.md 建议上限 80，系统自动 clamp。M7 sign-off 时拒签线为 minCoverage × 0.7 = 56。",
        });
      }
    }
    // ★ 2026-05-22 矩阵配置（机制非 prompt）：用 FACET_TOOL_MATRIX 按维度 facet
    //   确定性派生 toolHint.preferIds（→ researcher <available_tools> 里标 ★ recommended），
    //   覆盖 LLM 自猜的 preferIds —— "选哪些专用工具"由矩阵说了算，不靠 LLM 心情。
    res.output.dimensions = res.output.dimensions.map((d) => ({
      ...d,
      toolHint: {
        categories: d.toolHint.categories,
        preferIds: [...resolveFacetPreferredTools(d.facet)],
      },
    }));
    this.context.plan = res.output;
    this.context.decisions.push({
      phase: "plan",
      at: new Date().toISOString(),
      decision: `plan:${res.output.dimensions.length}-dim`,
      rationale: res.output.themeSummary.slice(0, 200),
    });
    await this.store
      .appendLeaderJournal(this.context.missionId, {
        plan: {
          themeSummary: res.output.themeSummary,
          dimensionsCount: res.output.dimensions.length,
          dimensions: res.output.dimensions,
          goals: res.output.goals,
          initialRisks: res.output.initialRisks,
          createdAt: new Date().toISOString(),
        },
      })
      .catch((err) =>
        this.log.warn(
          `[supervisor.plan ${this.context.missionId}] journal write failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    return res.output;
  }

  /** ★ M1: researchers 完成后做过程管理决策 */
  async assessResearchers(
    researcherOutcomes: LeaderResearcherOutcome[],
  ): Promise<LeaderAssessResearchOutput> {
    if (!this.context.plan) {
      throw new Error("must call plan() before assessResearchers()");
    }
    const res = await this.runFn<unknown, LeaderAssessResearchOutput>({
      spec: LeaderAgent,
      input: {
        phase: "assess-research",
        topic: this.context.task.topic,
        description: this.context.task.description,
        language: this.context.task.language,
        myPlan: {
          goals: this.context.plan.goals,
          dimensions: this.context.plan.dimensions,
        },
        researcherOutcomes,
      },
      agentId: "leader",
    });
    if (
      res.state !== "completed" ||
      !res.output ||
      res.output.phase !== "assess-research"
    ) {
      const fail = describeLeaderFailure("assess-research", res);
      throw new Error(
        `Leader.assessResearchers failed [${fail.code}]: ${fail.message}`,
      );
    }
    const decision: PastDecision = {
      phase: "assess-research",
      at: new Date().toISOString(),
      decision: `${res.output.decision}: ${res.output.perDimension.map((p) => `${p.dimensionId}=${p.action}`).join(", ")}`,
      rationale: res.output.rationale,
    };
    this.context.decisions.push(decision);
    await this.store
      .appendLeaderJournal(this.context.missionId, {
        decisions: [decision],
      })
      .catch((err) =>
        this.log.warn(
          `[supervisor.assess ${this.context.missionId}] journal write failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    return res.output;
  }

  /** ★ M6: 写综合 foreword */
  async writeForeword(
    stageOutcomes: LeaderStageOutcomes,
  ): Promise<LeaderForewordOutput & { generatedAt: string }> {
    if (!this.context.plan) {
      throw new Error("must call plan() before writeForeword()");
    }
    const res = await this.runFn<unknown, LeaderForewordOutput>({
      spec: LeaderAgent,
      input: {
        phase: "foreword",
        topic: this.context.task.topic,
        description: this.context.task.description,
        language: this.context.task.language,
        myPlan: {
          goals: this.context.plan.goals,
          dimensions: this.context.plan.dimensions,
        },
        myDecisions: this.context.decisions.filter(
          (d) => d.phase !== "foreword",
        ),
        stageOutcomes,
      },
      agentId: "leader",
    });
    if (
      res.state !== "completed" ||
      !res.output ||
      res.output.phase !== "foreword"
    ) {
      const fail = describeLeaderFailure("foreword", res);
      throw new Error(
        `Leader.writeForeword failed [${fail.code}]: ${fail.message}`,
      );
    }
    const foreword = { ...res.output, generatedAt: new Date().toISOString() };
    this.context.foreword = foreword;
    this.context.decisions.push({
      phase: "foreword",
      at: foreword.generatedAt,
      decision: `foreword: yes=${
        res.output.whatWeAnswered.filter((a) => a.addressed === "yes").length
      } / partial=${
        res.output.whatWeAnswered.filter((a) => a.addressed === "partial")
          .length
      } / no=${
        res.output.whatWeAnswered.filter((a) => a.addressed === "no").length
      }`,
      rationale: res.output.howToRead.slice(0, 200),
    });
    await this.store
      .appendLeaderJournal(this.context.missionId, {
        foreword,
      })
      .catch((err) =>
        this.log.warn(
          `[supervisor.foreword ${this.context.missionId}] journal write failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    return foreword;
  }

  /** ★ M7: 终极签字（必须引用过去自己决策做问责） */
  async signOff(
    finalQuality: LeaderFinalQuality,
    dimensionStates: {
      name: string;
      state: "completed" | "degraded" | "failed";
    }[],
  ): Promise<LeaderSignoffOutput> {
    if (!this.context.plan || !this.context.foreword) {
      throw new Error("must call plan() and writeForeword() before signOff()");
    }
    // ★ P2-R3-1 (round 3) + P1-R4-D (round 4): decisions 数组无上限累积，长 mission
    // 可能积累 20+ 条让 M7 prompt token 增长。
    // round 4 修正：先保留所有 plan / foreword 类（关键审议决策），再用最近 15 条 assess
    // 兜底，避免无脑 slice(-15) 把第 0 条 plan 决策截掉让 M7 看不到 M0 计划。
    const MAX_ASSESS_DECISIONS_FOR_SIGNOFF = 15;
    const allDecisions = this.context.decisions;
    const planAndForeword = allDecisions.filter(
      (d) => d.phase === "plan" || d.phase === "foreword",
    );
    const recentAssess = allDecisions
      .filter((d) => d.phase === "assess-research")
      .slice(-MAX_ASSESS_DECISIONS_FOR_SIGNOFF);
    const decisionsForSignoff = [...planAndForeword, ...recentAssess];
    const res = await this.runFn<unknown, LeaderSignoffOutput>({
      spec: LeaderAgent,
      input: {
        phase: "signoff",
        topic: this.context.task.topic,
        description: this.context.task.description,
        language: this.context.task.language,
        myPlan: {
          goals: this.context.plan.goals,
          dimensions: this.context.plan.dimensions,
        },
        myDecisions: decisionsForSignoff,
        myForeword: {
          whatWeAnswered: this.context.foreword.whatWeAnswered,
          whatRemainsUnclear: this.context.foreword.whatRemainsUnclear,
        },
        finalQuality,
        dimensionStates,
      },
      agentId: "leader",
    });
    if (
      res.state !== "completed" ||
      !res.output ||
      res.output.phase !== "signoff"
    ) {
      const fail = describeLeaderFailure("signoff", res);
      throw new Error(`Leader.signOff failed [${fail.code}]: ${fail.message}`);
    }
    return res.output;
  }

  /**
   * ★ 2026-05-30 单维度/中途重跑修复：cascade 从 s3+ 开始时 s2-leader-plan 不重跑，
   *   leader.plan() 永不被调用 → assessResearchers / writeForeword / signOff 的
   *   `if (!this.context.plan)` guard 全部 throw "must call plan() before X()"
   *   （生产日志实证 mission 06be38c5：M1 assess-research failed: must call plan()...）。
   *
   *   用持久化的 leaderJournal.plan 无损回灌 context.plan（themeSummary/dimensions/
   *   goals/initialRisks 在 plan() 阶段已整份写盘，见上方 appendLeaderJournal），不需
   *   重新调用 LLM 规划。foreword 不在此回灌：cascade 到 s10 时 writeForeword 会先于
   *   signOff 重新生成并 set context.foreword，使 signOff 的双重 guard 自然通过。
   */
  hydratePlan(plan: LeaderPlanOutput): void {
    this.context.plan = plan;
    // 重新种入一条 plan 决策，让 M7 signOff 的问责 prompt 仍能引用 M0 计划
    // （rerun leader 的 decisions 从空开始，否则 signoff 看不到 M0 决策）。
    if (!this.context.decisions.some((d) => d.phase === "plan")) {
      this.context.decisions.push({
        phase: "plan",
        at: new Date().toISOString(),
        decision: `plan(hydrated):${plan.dimensions.length}-dim`,
        rationale: plan.themeSummary.slice(0, 200),
      });
    }
  }

  getContext(): Readonly<MissionContext> {
    return this.context;
  }
}

// ── Factory service (Nest provider) ──

@Injectable()
export class LeaderService {
  private readonly log = new Logger(LeaderService.name);

  constructor(private readonly store: MissionStore) {}

  create(
    missionId: string,
    userId: string,
    task: LeaderTask,
    runFn: LeaderRunFn,
  ): SupervisedMission {
    return new SupervisedMission(
      missionId,
      userId,
      task,
      runFn,
      this.store,
      this.log,
    );
  }
}
