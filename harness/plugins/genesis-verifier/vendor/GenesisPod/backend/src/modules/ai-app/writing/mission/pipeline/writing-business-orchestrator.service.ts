/**
 * WritingBusinessOrchestrator — stage runner 表 + STAGE_NUMBER
 *
 * 照 social/mission/pipeline/social-business-orchestrator.service.ts 形态：
 *   - extends BusinessTeamOrchestratorFramework<WritingSessionEntry>
 *   - 空构造器（仅 super({ namespace, stageNumber })）
 *   - 唯一 abstract 实现：resolveStageRunner switch（stepId → stage adapter）
 *   - 直接吃 framework 默认 adaptRunnerToHooks（persist primitive，无 override）
 *
 * Stage 全部用 persist primitive（hooks.persist），原因（照 social 同设计决策）：
 *   - 8 个 stage 都是 side-effect 操作（写世界观/大纲/章节/质量/产物到 DB）
 *   - persist 不需要 ResolvedRole（roles:[]），hook 形态贴合 stage adapter (ctx, deps)
 *   - LLM 调用 / agent 执行在 stage 内部（stage → role service → invoker），
 *     orchestrator 这层只是把 generic step run 接到 WritingSessionEntry
 *
 * WritingSessionEntry — social 形态（fat entry = ctx + deps）:
 *   - ctx: WritingMissionContext（跨 stage 可变状态包）
 *   - deps: WritingMissionDeps（stage 注入依赖）
 *   - 风险 §4.6：stage runner 签名 = (entry) => Promise<void>，内部取 e.ctx / e.deps
 *     显式传给 free 函数，不能用 radar 瘦 entry
 *
 * 迁移规格 §4 锁定决策：
 *   - full_story 走 WRITING_PIPELINE（s1→s8 全量）
 *   - 其它 task type 走独立 pipeline id，复用同一批 stage runner（stepId 全局唯一）
 *   - dispatcher(B4) onModuleInit 注册 5 条 pipeline + bindSessionLookup
 */

import { Injectable } from "@nestjs/common";
import {
  BusinessTeamOrchestratorFramework,
  type BusinessTeamStageRunner,
  type MissionRuntimeSession,
} from "@/modules/ai-harness/facade";
import {
  runBudgetEvalStage,
  runWorldBuildStage,
  runOutlinePlanStage,
  runChapterFanoutStage,
  runConsistencyCheckStage,
  runEditPolishStage,
  runQualityEvaluateStage,
  runMissionPersistStage,
} from "./stages";
import type { WritingMissionContext } from "../context/mission-context";
import type { WritingMissionDeps } from "../context/mission-deps";

// ─── WritingSessionEntry ──────────────────────────────────────────────────
/**
 * SessionEntry — social 形态（fat entry：ctx + deps）。
 *
 * dispatcher 在 runMission 中将装配好的 ctx + deps 存入 sessions Map；
 * BusinessTeamOrchestratorFramework 通过 bindSessionLookup 回调取到本 entry，
 * 然后将其传给 resolveStageRunner 返回的 runner 闭包。
 *
 * 风险 §4.6 约束：必须同时挂 ctx + deps（social 形态），不能用 radar 瘦 entry。
 */
export interface WritingSessionEntry {
  /** 框架 session（由 runtimeShell.openSession 返回） */
  session: MissionRuntimeSession;
  /** 任务开始时间戳（ms）*/
  t0: number;
  /** 任务输入 */
  input: WritingMissionContext["input"];
  /** 关联项目 id */
  projectId: string;
  /** 跨 stage 可变状态包 */
  ctx: WritingMissionContext;
  /** stage 注入依赖包 */
  deps: WritingMissionDeps;
}

// ─── stepId → DB stage number ────────────────────────────────────────────
/** stepId → DB stage number（迁移规格 §1.2 8 个 step，s8 = 8） */
const STAGE_NUMBER: Record<string, number> = {
  "s1-mission-budget-eval": 1,
  "s2-world-build": 2,
  "s3-outline-plan": 3,
  "s4-chapter-fanout": 4,
  "s5-consistency-check": 5,
  "s6-edit-polish": 6,
  "s7-quality-evaluate": 7,
  "s8-mission-persist": 8,
};

// ─── WritingBusinessOrchestrator ─────────────────────────────────────────
@Injectable()
export class WritingBusinessOrchestrator extends BusinessTeamOrchestratorFramework<WritingSessionEntry> {
  /** 暴露给 dispatcher 兼容读取（同 social 同名字段） */
  readonly STAGE_NUMBER = STAGE_NUMBER;

  constructor() {
    super({ namespace: "writing", stageNumber: STAGE_NUMBER });
  }

  protected resolveStageRunner(
    stepId: string,
  ): BusinessTeamStageRunner<WritingSessionEntry> | null {
    switch (stepId) {
      case "s1-mission-budget-eval":
        return async (e) => {
          await runBudgetEvalStage(e.ctx, e.deps);
        };
      case "s2-world-build":
        return async (e) => {
          await runWorldBuildStage(e.ctx, e.deps);
        };
      case "s3-outline-plan":
        return async (e) => {
          await runOutlinePlanStage(e.ctx, e.deps);
        };
      case "s4-chapter-fanout":
        return async (e) => {
          await runChapterFanoutStage(e.ctx, e.deps);
        };
      case "s5-consistency-check":
        return async (e) => {
          await runConsistencyCheckStage(e.ctx, e.deps);
        };
      case "s6-edit-polish":
        return async (e) => {
          await runEditPolishStage(e.ctx, e.deps);
        };
      case "s7-quality-evaluate":
        return async (e) => {
          await runQualityEvaluateStage(e.ctx, e.deps);
        };
      case "s8-mission-persist":
        return async (e) => {
          await runMissionPersistStage(e.ctx, e.deps);
        };
      default:
        return null;
    }
  }
}
