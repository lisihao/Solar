/**
 * SocialBusinessOrchestrator —— 业务编排（stage runner 表 + STAGE_NUMBER）
 *
 * 从 dispatcher 抽出"业务编排"职责（mirror playground/
 * playground-business-orchestrator.service.ts）。dispatcher 留 runtime-glue：
 * sessions Map / runMission 主入口 / cleanup。
 *
 * 2026-05-24 (Wave-1 P7) 继承 BusinessTeamOrchestratorFramework：把
 * bindSessionLookup / getEntry / hooks dispatch / abort 保护下沉到 framework；
 * 业务侧只填 resolveStageRunner switch（stepId → stage adapter）。
 *
 * Stage 全部用 persist primitive（hooks.persist），原因：
 *   - social 12 个 stage 都是 side-effect 操作（写浏览器 / 远端 API / DB）
 *   - persist 是无 LLM primitive，hook 形态最贴合 stage adapter (ctx, deps)
 *   - LLM 调用 / agent 执行仍由 SocialAgentInvoker → AgentRunner 在 stage
 *     adapter 内部完成；这层 hook 只是把 orchestrator 的 generic step run
 *     接到 social mission state（SessionEntry.ctx）
 */

import { Injectable } from "@nestjs/common";
import {
  BusinessTeamOrchestratorFramework,
  type BusinessTeamStageRunner,
} from "@/modules/ai-harness/facade";
import {
  runMissionBudgetEvalStage,
  runPlatformProbeStage,
  runContentTransformStage,
  runLeaderAssessTransformStage,
  runCoverCraftStage,
  runBodyComposeStage,
  runPolishReviewStage,
  runPublishExecuteStage,
  runPublishRetryStage,
  runPublishVerifyStage,
  runLeaderSignoffStage,
  runMissionPersistStage,
} from "./stages";
import type { SessionEntry } from "./social-pipeline-dispatcher.service";

/** stepId → DB stage number（s8b 同 s8 阶段，s12 不入 stage 计数） */
const STAGE_NUMBER: Record<string, number> = {
  "s1-mission-budget-eval": 1,
  "s2-platform-probe": 2,
  "s3-content-transform": 3,
  "s4-leader-assess-transform": 4,
  "s5-cover-craft": 5,
  "s6-body-compose": 6,
  "s7-polish-review": 7,
  "s8-publish-execute": 8,
  "s8b-publish-retry": 8,
  "s9-publish-verify": 9,
  "s10-leader-signoff": 10,
  "s11-mission-persist": 11,
};

@Injectable()
export class SocialBusinessOrchestrator extends BusinessTeamOrchestratorFramework<SessionEntry> {
  // 暴露给 dispatcher 兼容旧 import（dispatcher.markStageComplete 直接读 this.STAGE_NUMBER）
  readonly STAGE_NUMBER = STAGE_NUMBER;

  constructor() {
    super({ namespace: "social", stageNumber: STAGE_NUMBER });
  }

  protected resolveStageRunner(
    stepId: string,
  ): BusinessTeamStageRunner<SessionEntry> | null {
    switch (stepId) {
      case "s1-mission-budget-eval":
        return async (e) => {
          await runMissionBudgetEvalStage(e.ctx, e.deps);
        };
      case "s2-platform-probe":
        return async (e) => {
          await runPlatformProbeStage(e.ctx, e.deps);
        };
      case "s3-content-transform":
        return async (e) => {
          await runContentTransformStage(e.ctx, e.deps);
        };
      case "s4-leader-assess-transform":
        return async (e) => {
          await runLeaderAssessTransformStage(e.ctx, e.deps);
        };
      case "s5-cover-craft":
        return async (e) => {
          await runCoverCraftStage(e.ctx, e.deps);
        };
      case "s6-body-compose":
        return async (e) => {
          await runBodyComposeStage(e.ctx, e.deps);
        };
      case "s7-polish-review":
        return async (e) => {
          await runPolishReviewStage(e.ctx, e.deps);
        };
      case "s8-publish-execute":
        return async (e) => {
          await runPublishExecuteStage(e.ctx, e.deps);
        };
      case "s8b-publish-retry":
        return async (e) => {
          await runPublishRetryStage(e.ctx, e.deps);
        };
      case "s9-publish-verify":
        return async (e) => {
          await runPublishVerifyStage(e.ctx, e.deps);
        };
      case "s10-leader-signoff":
        return async (e) => {
          await runLeaderSignoffStage(e.ctx, e.deps);
        };
      case "s11-mission-persist":
        return async (e) => {
          await runMissionPersistStage(e.ctx, e.deps);
        };
      default:
        return null;
    }
  }
}
