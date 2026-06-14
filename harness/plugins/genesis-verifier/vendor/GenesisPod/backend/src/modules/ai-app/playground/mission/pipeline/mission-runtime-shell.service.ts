/**
 * MissionRuntimeShellService — playground 业务 adapter + thin wrapper
 *
 * 2026-05-08 PR-E0：原 ~260 行 lifecycle 框架已上提到
 * `ai-harness/teams/business-team/lifecycle/mission-runtime-shell.framework.ts`。
 * 本文件保留作为 playground 业务 adapter（提供 event namespace / store schema /
 * billing moduleType / wallTime/credits 解析），调用 framework.openSession 完成 lifecycle 装配。
 */

import { Injectable } from "@nestjs/common";
import {
  MissionRuntimeShellFramework,
  type IMissionRuntimeAdapter,
  type MissionRuntimeSession,
} from "@/modules/ai-harness/facade";
import {
  resolveBudgetMultiplier,
  resolveMissionCredits,
  resolveMissionWallTimeMs,
  type RunMissionInput,
} from "../../api/dto/run-mission.dto";
import { MissionStore } from "../lifecycle/mission-store.service";
import { AgentInvoker } from "../roles";
import { PlaygroundMissionInputRebuilder } from "../../runtime/playground.input-rebuilder";

export type { MissionRuntimeSession };

/**
 * 心跳"活动窗口"——shell 的盲 30s 计时器每次刷心跳前，要求 mission 在过去这段
 * 时间内有过事件产出（真实进度），否则跳过刷心跳，让 heartbeatAt 随事件一同老化。
 *
 * 取值约束：必须远小于 LivenessGuard 的 staleThresholdMs(playground=15min)——
 * staleThreshold 才是真正的"容忍 N 分钟静默"阈值；本窗口只决定心跳多紧地跟随
 * 事件。3min ≫ 心跳 tick(30s)（健康 mission 每 tick 都有事件→正常刷心跳，不误冻），
 * 又 ≪ 15min（卡死后心跳约在静默 3min 即停刷，叠加 15min stale → 约 18min 回收）。
 * stage 完成另由 store.markStageComplete 直接刷心跳（进度型），与此互补。
 */
const HEARTBEAT_ACTIVITY_WINDOW_MS = 3 * 60 * 1000;

@Injectable()
export class MissionRuntimeShellService {
  constructor(
    private readonly framework: MissionRuntimeShellFramework,
    private readonly invoker: AgentInvoker,
    private readonly store: MissionStore,
    private readonly rebuilder: PlaygroundMissionInputRebuilder,
  ) {}

  async openSession(args: {
    missionId: string;
    input: RunMissionInput;
    userId: string;
    workspaceId?: string;
  }): Promise<MissionRuntimeSession> {
    return this.framework.openSession({
      missionId: args.missionId,
      input: args.input,
      userId: args.userId,
      workspaceId: args.workspaceId,
      adapter: this.buildAdapter(),
    });
  }

  async runWithinContext<T>(
    session: MissionRuntimeSession,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.framework.runWithinContext(session, "playground", "team", fn);
  }

  /** Playground 业务 adapter：注入业务专属决策给 framework */
  private buildAdapter(): IMissionRuntimeAdapter<RunMissionInput> {
    const store = this.store;
    const invoker = this.invoker;
    const rebuilder = this.rebuilder;
    return {
      eventNamespace: "playground",
      billingModuleType: "playground",
      resolveWallTimeCapMs: (input) => resolveMissionWallTimeMs(input),
      resolveMaxCredits: (input) => resolveMissionCredits(input),
      resolveBudgetMultiplier: (input) => resolveBudgetMultiplier(input),
      createMissionRow: async ({
        missionId,
        userId,
        workspaceId,
        input,
        effectiveMaxCredits,
      }) => {
        // ★ 2026-06-11 同-id 续跑/重跑（78/79 诉求）：行已存在 = 重跑或后端重启续跑，
        //   不新建行（否则撞 P2002 → 旧逻辑被迫新建 missionId="新任务"）。
        //   - 终态行（failed/quality-failed/cancelled）→ markReopened：状态翻回 running +
        //     bump runCount（"增加一个版本"）+ 清终态字段。
        //   - running 孤儿（重启续跑）→ markReopened 白名单不含 running → no-op，直接复用现有行。
        //   两种情况 runMission 随后都从 checkpoint 原地续跑（R2-#37 已实现）。
        const existing = await store.getStatusById(missionId).catch(() => null);
        if (existing) {
          await store.markReopened(missionId, userId).catch(() => undefined);
          return;
        }
        await store.create({
          id: missionId,
          userId,
          workspaceId,
          topic: input.topic,
          depth: input.depth,
          language: input.language,
          maxCredits: effectiveMaxCredits,
          userProfile: {
            depth: input.depth,
            language: input.language,
            budgetProfile: input.budgetProfile,
            styleProfile: input.styleProfile,
            lengthProfile: input.lengthProfile,
            audienceProfile: input.audienceProfile,
            withFigures: input.withFigures,
            auditLayers: input.auditLayers,
            concurrency: input.concurrency,
            viewMode: input.viewMode,
            searchTimeRange: input.searchTimeRange,
            // ★ 2026-05-22 单一源 + 修"重跑预算丢失"：存**有效值**（缺省已按 depth 档位
            //   解析），让 cloneInputFromMission 重跑时读得到。maxCredits 仍存权威列字段
            //   （effectiveMaxCredits），multiplier / wallTime 无独立列故存此 JSON。
            //   写路径（此处 + updateBudgetByUser）= 读路径（cloneInputFromMission）。
            budgetMultiplierOverride: resolveBudgetMultiplier(input),
            wallTimeCapMs: resolveMissionWallTimeMs(input),
            knowledgeBaseIds: input.knowledgeBaseIds,
            inheritFromMissionId: input.inheritFromMissionId,
          } as Record<string, unknown>,
          // ★ C5/G7：冻结 typed config snapshot(单一真源,rerun/hydrate 将只读它)。
          //   与 userProfile 并写属"expand 阶段"(读路径未切,无双读);S3 切读后 S4 删 userProfile。
          configSnapshot: rebuilder.buildForFreshRun(input),
        });
      },
      refreshHeartbeat: async (missionId, podId) => {
        // ★ 进度门控（2026-06-11 修"mission 卡死永不收尾"）：仅当近期有事件产出
        //   （真实进度）才刷心跳；无进度则跳过，心跳随事件一同老化，让
        //   LivenessGuard 的"心跳 AND 事件双 stale"正确触发回收。盲刷会让卡在
        //   某 stage 的 mission 心跳永远新鲜 → 永久卡 running（实测 14.5h）。
        const hasProgress = await store
          .hasRecentEvent(missionId, HEARTBEAT_ACTIVITY_WINDOW_MS)
          // 查询失败时退回"刷心跳"——宁可漏判卡死，不误杀健康 mission。
          .catch(() => true);
        if (!hasProgress) return;
        await store.refreshHeartbeat(missionId, podId);
      },
      emitMissionEvent: async ({ type, missionId, userId, payload }) => {
        await invoker.emitEvent({ type, missionId, userId, payload });
      },
    };
  }
}
