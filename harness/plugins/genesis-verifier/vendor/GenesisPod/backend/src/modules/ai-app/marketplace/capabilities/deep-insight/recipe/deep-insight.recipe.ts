/**
 * playground.config.ts —— Mission Pipeline 配置（v5.1 §3.2 / §5）
 *
 * 把 13 step（s1-budget → s11-persist，含 s8b / s9b）映射到 R1 generic primitive，
 * 由 `MissionPipelineOrchestrator` 执行；s12 self-evolution 由 dispatcher 在 mission
 * terminal 后 fire-and-forget 触发（非 pipeline.steps 一员）。
 *
 * R2-C 单轨化（2026-05-04）后：本 config 是 mission orchestrator 的唯一配置来源，
 * legacy `team.mission.ts` 已删除，`PLAYGROUND_RUNTIME` flag 已删除。
 */
import * as fs from "fs";
import * as path from "path";
import {
  defineMissionPipeline,
  type MissionPipelineConfig,
  type ResolvedRole,
} from "@/modules/ai-harness/facade";
import { loadSkill } from "@/modules/ai-engine/facade";
import type { ZodType } from "zod";
// ★ 2026-06-07: 市场投影展示元数据（标准 28）—— display 信息归位到本 config 的
//   meta.catalog（单源），company 市场目录据此投影，不另建台账。
import type { PipelineCatalogMeta } from "@/modules/ai-app/contracts/pipeline-catalog.contract";

/**
 * 把 SKILL.md frontmatter + 整个 markdown body 装成最小 ISkillExecSpec；
 * outputSchema 暂用 always-pass z.unknown() 占位（真实 SkillSpecBuilder 集成
 * 留给 R2-A.1 第一个 stage 迁移时补）。
 */
// P9c (2026-05-24): SKILL.md loader 上提到 ai-engine,callers 传 agentsRootDir。
// ★ 2026-06-08 上架沉淀(P2)：recipe 与 agents 同住 deep-insight 能力家。recipe/ → ../agents/。
const AGENTS_ROOT_DIR = path.resolve(__dirname, "..", "agents");

function buildSkillSpecFromMd(agentDir: string): ResolvedRole["skillSpec"] {
  const skillPath = path.resolve(AGENTS_ROOT_DIR, agentDir, "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    throw new Error(`[playground.config] missing SKILL.md: ${skillPath}`);
  }
  const skill = loadSkill(agentDir, AGENTS_ROOT_DIR);
  // systemPrompt = soul + 全部 duties 拼接；duty-loader 在真实 stage 内会按 phase
  // 选具体 duty 渲染；R2-A.0 阶段 systemPrompt 给完整 body 做占位。
  const sections: string[] = [];
  if (skill.soul) sections.push(skill.soul);
  for (const dutyName of skill.frontmatter.duties) {
    sections.push(skill.duties[dutyName]);
  }
  return {
    id: skill.frontmatter.id,
    systemPrompt: sections.join("\n\n---\n\n"),
    allowedToolIds: [...skill.frontmatter.allowedTools],
    allowedModels: [...skill.frontmatter.allowedModels],
    outputSchema: {
      safeParse: (value: unknown) => ({ success: true as const, data: value }),
    } as unknown as ZodType,
    meta: {
      skillVersion: skill.frontmatter.version,
      skillDomain: skill.frontmatter.domain,
    },
  };
}

/**
 * 工作流货架的市场投影展示元数据。stages 数量与 PLAYGROUND_PIPELINE.steps 对齐 ——
 * 由 __tests__/playground-catalog.spec.ts 守护防漂移。
 * 注：角色 agent 不在此登记 —— 由 contracts/agent-spec-catalog.ts 的真 @DefineAgent
 * 类经 readDefineAgentMeta 投影到 Agent 货架（单一源、可执行解析）。
 */
const DEEP_INSIGHT_CATALOG: PipelineCatalogMeta = {
  name: "深度研究 Mission（14 阶段）",
  description:
    "Leader 领衔的 8 角色深度研究流水线：预算闸 → 规划 → 并行调研 → 评估 → 跨维对账 → 综合分析 → 大纲 → 成稿 → 质量增强 → 元批评 → 客观评估 → 序言签发 → 持久化。",
  category: "深度研究",
  stages: [
    "预算闸",
    "Leader 规划",
    "并行调研",
    "Leader 评估",
    "跨维对账",
    "综合分析",
    "大纲规划",
    "报告初稿",
    "质量增强",
    "元批评",
    "客观评估",
    "Leader 序言签发",
    "最终持久化",
  ],
  // 呈现面绑定：跑完用前端 deep-insight MissionKit 渲染（resolveMissionKit）。
  missionType: "deep-insight",
};

/**
 * 完整 13-step pipeline 声明（v5.1 §5 stage 映射表）
 */
export const PLAYGROUND_PIPELINE: MissionPipelineConfig = defineMissionPipeline(
  {
    id: "playground",
    roles: [
      {
        id: "leader",
        skillSpec: buildSkillSpecFromMd("leader"),
        stateful: true,
      },
      {
        id: "researcher",
        skillSpec: buildSkillSpecFromMd("researcher"),
        stateful: false,
      },
      {
        id: "reconciler",
        skillSpec: buildSkillSpecFromMd("reconciler"),
        stateful: false,
      },
      {
        id: "analyst",
        skillSpec: buildSkillSpecFromMd("analyst"),
        stateful: false,
      },
      {
        id: "writer",
        skillSpec: buildSkillSpecFromMd("writer"),
        stateful: false,
      },
      {
        id: "reviewer",
        skillSpec: buildSkillSpecFromMd("reviewer"),
        stateful: false,
      },
      {
        id: "verifier",
        skillSpec: buildSkillSpecFromMd("verifier"),
        stateful: false,
      },
      {
        id: "steward",
        skillSpec: buildSkillSpecFromMd("steward"),
        stateful: false,
      },
    ],
    // ★ 2026-05-06 重大整改: 平台层 mission-pipeline-orchestrator 已删除 stage
    //   死秒表机制。step.timeoutMs 现在仅作 stage:stalled 警告阈值（× 1.5 后 emit
    //   stage:stalled，不再杀 stage）。stage 真死活由：
    //     1. MissionLivenessGuard（inactivity 5min，监听 EventBus 事件流）
    //     2. mission-runtime-shell wallTimer（mission 总长上限）
    //     3. primitive 内部 LLM HTTP timeout 抛错冒泡
    //   下面 timeoutMs 数值仅供"stage 跑超 X 分钟还没完"的可见性 warning。
    steps: [
      // S1 — budget gate (no role, persist primitive in pre-mode)
      // DB write only；30s 内完成是预期，超过 ~45s emit stalled warning。
      {
        primitive: "persist",
        id: "s1-budget",
        mode: "budget-pre",
        timeoutMs: 30_000,
        // PR-R1: S1 是预算闸不可重跑（重跑等于改用户 input 配置）
        dag: {
          ctxReads: ["input"],
          ctxWrites: [],
          dbWrites: ["max_credits"],
          successors: [],
          rerunable: false,
          rerunableReason: "预算闸不可重跑（如需调整请新建 mission）",
        },
      },
      // S2 — leader plan
      {
        primitive: "plan",
        id: "s2-leader-plan",
        roleId: "leader",
        timeoutMs: 900_000,
        // PR-R1: S2 重跑 = 改 plan = 全 mission 重跑（cascade 链覆盖 S3-S11）
        // 真允许但 UI 应警告等于全跑
        dag: {
          ctxReads: ["input"],
          ctxWrites: ["plan"],
          dbWrites: ["dimensions", "theme_summary"],
          successors: [
            "s3-researcher-collect",
            "s4-leader-assess",
            "s5-reconciler",
            "s6-analyst",
            "s7-writer-outline",
            "s8-writer",
            "s8b-quality-enhancement",
            "s9-critic",
            "s9b-objective-eval",
            "s10-leader-foreword-signoff",
            "s11-persist",
          ],
          rerunable: true,
          resetFields: [
            "dimensions",
            "theme_summary",
            "reconciliation_report",
            "analyst_output",
            "outline_plan",
            "report_full",
            "report_artifact_version",
            "verdicts",
            "leader_signed",
            "leader_overall_score",
            "leader_verdict",
            "final_score",
            "completed_at",
            "error_message",
          ],
        },
      },
      // S3 — researcher fan-out
      {
        primitive: "research",
        id: "s3-researcher-collect",
        roleId: "researcher",
        mode: "byPlanDimensions",
        timeoutMs: 1_200_000,
        // ★ 并发派遣（2026-06-10）：不配 params.concurrency——research.primitive
        //   滑动窗并发，解析优先级为 用户档位（input.invocation.concurrency）>
        //   params.concurrency > min(维度数, 6)（= 基线 fc22d9a Phase A 语义，
        //   deep 档 12 维 6 路并行）。此处配死数值会盖掉 min(dims,6) 默认。
        dag: {
          ctxReads: ["plan", "input"],
          ctxWrites: ["researcherResults"],
          // research_results / chapter_drafts 存独立子表，dbWrites 仅列 mission 行字段
          dbWrites: [],
          successors: [
            "s4-leader-assess",
            "s5-reconciler",
            "s6-analyst",
            "s7-writer-outline",
            "s8-writer",
            "s8b-quality-enhancement",
            "s9-critic",
            "s9b-objective-eval",
            "s10-leader-foreword-signoff",
            "s11-persist",
          ],
          rerunable: true,
          resetFields: [
            "reconciliation_report",
            "analyst_output",
            "outline_plan",
            "report_full",
            "report_artifact_version",
            "verdicts",
            "leader_signed",
            "leader_overall_score",
            "leader_verdict",
            "final_score",
            "completed_at",
            "error_message",
          ],
        },
      },
      // S4 — leader assess
      {
        primitive: "assess",
        id: "s4-leader-assess",
        roleId: "leader",
        timeoutMs: 600_000,
        dag: {
          ctxReads: ["plan", "researcherResults"],
          ctxWrites: [],
          dbWrites: ["leader_journal"],
          successors: [
            "s5-reconciler",
            "s6-analyst",
            "s7-writer-outline",
            "s8-writer",
            "s8b-quality-enhancement",
            "s9-critic",
            "s9b-objective-eval",
            "s10-leader-foreword-signoff",
            "s11-persist",
          ],
          rerunable: true,
          resetFields: [
            "reconciliation_report",
            "analyst_output",
            "outline_plan",
            "report_full",
            "report_artifact_version",
            "verdicts",
            "leader_signed",
            "completed_at",
            "error_message",
          ],
        },
      },
      // S5 — reconciler
      {
        primitive: "synthesize",
        id: "s5-reconciler",
        roleId: "reconciler",
        mode: "reconcile",
        timeoutMs: 300_000,
        dag: {
          ctxReads: ["researcherResults"],
          ctxWrites: ["reconciliationReport"],
          dbWrites: ["reconciliation_report"],
          successors: [
            "s6-analyst",
            "s7-writer-outline",
            "s8-writer",
            "s8b-quality-enhancement",
            "s9-critic",
            "s9b-objective-eval",
            "s10-leader-foreword-signoff",
            "s11-persist",
          ],
          rerunable: true,
          resetFields: [
            "reconciliation_report",
            "analyst_output",
            "outline_plan",
            "report_full",
            "report_artifact_version",
            "verdicts",
            "leader_signed",
            "completed_at",
            "error_message",
          ],
        },
      },
      // S6 — analyst
      {
        primitive: "synthesize",
        id: "s6-analyst",
        roleId: "analyst",
        mode: "analyze",
        timeoutMs: 600_000,
        dag: {
          ctxReads: ["researcherResults", "reconciliationReport"],
          ctxWrites: ["analystOutput"],
          dbWrites: ["analyst_output"],
          successors: [
            "s7-writer-outline",
            "s8-writer",
            "s8b-quality-enhancement",
            "s9-critic",
            "s9b-objective-eval",
            "s10-leader-foreword-signoff",
            "s11-persist",
          ],
          rerunable: true,
          resetFields: [
            "analyst_output",
            "outline_plan",
            "report_full",
            "report_artifact_version",
            "verdicts",
            "leader_signed",
            "completed_at",
            "error_message",
          ],
        },
      },
      // S7 — writer outline
      {
        primitive: "draft",
        id: "s7-writer-outline",
        roleId: "writer",
        mode: "outline",
        timeoutMs: 300_000,
        dag: {
          ctxReads: ["analystOutput", "plan"],
          ctxWrites: ["outlinePlan"],
          dbWrites: ["outline_plan"],
          successors: [
            "s8-writer",
            "s8b-quality-enhancement",
            "s9-critic",
            "s9b-objective-eval",
            "s10-leader-foreword-signoff",
            "s11-persist",
          ],
          rerunable: true,
          resetFields: [
            "outline_plan",
            "report_full",
            "report_artifact_version",
            "verdicts",
            "leader_signed",
            "completed_at",
            "error_message",
          ],
        },
      },
      // S8 — writer full draft
      {
        primitive: "draft",
        id: "s8-writer",
        roleId: "writer",
        mode: "full",
        timeoutMs: 1_500_000,
        dag: {
          ctxReads: [
            "outlinePlan",
            "analystOutput",
            "researcherResults",
            "reconciliationReport",
            "plan",
          ],
          ctxWrites: [
            "report",
            "reportArtifact",
            "reviewScore",
            "verifierVerdicts",
            "trajectoryStored",
          ],
          dbWrites: ["report_full", "report_artifact_version"],
          successors: [
            "s8b-quality-enhancement",
            "s9-critic",
            "s9b-objective-eval",
            "s10-leader-foreword-signoff",
            "s11-persist",
          ],
          rerunable: true,
          resetFields: [
            "report_full",
            "report_artifact_version",
            "verdicts",
            "leader_signed",
            "completed_at",
            "error_message",
          ],
        },
      },
      // S8B — section quality enhancement
      {
        primitive: "review",
        id: "s8b-quality-enhancement",
        roleId: "reviewer",
        mode: "quality-enhance",
        timeoutMs: 600_000,
        dag: {
          ctxReads: ["reportArtifact"],
          ctxWrites: ["reportArtifact"],
          dbWrites: ["report_full"],
          successors: [
            "s9-critic",
            "s9b-objective-eval",
            "s10-leader-foreword-signoff",
            "s11-persist",
          ],
          rerunable: true,
          resetFields: [
            "report_full",
            "verdicts",
            "leader_signed",
            "completed_at",
            "error_message",
          ],
        },
      },
      // S9 — meta critic
      {
        primitive: "review",
        id: "s9-critic",
        roleId: "reviewer",
        mode: "meta-critic",
        timeoutMs: 300_000,
        dag: {
          ctxReads: ["reportArtifact"],
          ctxWrites: ["reportArtifact"],
          dbWrites: ["report_full"],
          successors: [
            "s9b-objective-eval",
            "s10-leader-foreword-signoff",
            "s11-persist",
          ],
          rerunable: true,
          resetFields: ["leader_signed", "completed_at", "error_message"],
        },
      },
      // S9B — objective evaluation
      {
        primitive: "review",
        id: "s9b-objective-eval",
        roleId: "reviewer",
        mode: "objective",
        timeoutMs: 300_000,
        dag: {
          ctxReads: ["reportArtifact"],
          ctxWrites: ["reportArtifact"],
          dbWrites: ["report_full", "verdicts"],
          successors: ["s10-leader-foreword-signoff", "s11-persist"],
          rerunable: true,
          resetFields: ["leader_signed", "completed_at", "error_message"],
        },
      },
      // S10 — leader foreword + signoff
      {
        primitive: "signoff",
        id: "s10-leader-foreword-signoff",
        roleId: "leader",
        timeoutMs: 300_000,
        dag: {
          ctxReads: ["reportArtifact", "verifierVerdicts"],
          ctxWrites: ["leaderSignOff"],
          dbWrites: [
            "leader_signed",
            "leader_overall_score",
            "leader_verdict",
            "leader_journal",
          ],
          successors: ["s11-persist"],
          rerunable: true,
          resetFields: ["completed_at", "error_message", "final_score"],
        },
      },
      // S11 — final persist (c195035f 主用例：用户最常重跑此 stage)
      {
        primitive: "persist",
        id: "s11-persist",
        mode: "final",
        timeoutMs: 120_000,
        dag: {
          ctxReads: [
            "reportArtifact",
            "verifierVerdicts",
            "leaderSignOff",
            "trajectoryStored",
          ],
          ctxWrites: [],
          dbWrites: [
            "report_full",
            "report_artifact_version",
            "completed_at",
            "final_score",
            "status",
            "tokens_used",
            "cost_usd",
            "trajectory_stored",
            "last_completed_stage",
          ],
          successors: [], // 终点
          rerunable: true,
          resetFields: ["error_message", "completed_at"],
        },
      },
      // ★ 2026-05-06 (A-7): S12 self-evolution 从 pipeline.steps 移除，改由 dispatcher
      //   在 mission terminal 后 fire-and-forget 触发，emit mission:postlude:* 事件流。
      //   原因：S12 是 best-effort 后置任务（postmortem 统计 + memory 索引），不该挂在
      //   stage:lifecycle 上让前端误以为是 mission 一部分进度。前端 todo-ledger 单独
      //   按 mission:postlude:* 推 s12 todo 状态。
    ],
    defaultStepTimeoutMs: 10 * 60_000, // 10 分钟 / step（深度研究长任务保守值）
    meta: {
      description: "deep-insight full mission pipeline (v5.1)",
      eventPrefix: "playground",
      runtimeVersion: "pipeline-v1",
      // ★ 2026-06-07: 市场投影展示元数据（标准 28，单源归位）
      catalog: DEEP_INSIGHT_CATALOG,
    },
  },
);

/**
 * ★ W2（能力即产品）：deep-insight 自洽命名别名。
 *
 * recipe 当前同时作 playground 私有 pipeline（id="playground"，由 playground
 * onModuleInit 注册）。能力家 DeepInsightDefaultRunner 不直接注册本 config，而是
 * 据它派生出 id="deep-insight" 的副本（挂能力家 bindings 的 hooks）再注册——
 * 故此处仅提供命名别名，**不**改 id（改 id 会破 playground 存量注册）。
 * W3 playground 改消费能力后，可把 id 收口为 deep-insight 单源。
 */
export const DEEP_INSIGHT_PIPELINE = PLAYGROUND_PIPELINE;
