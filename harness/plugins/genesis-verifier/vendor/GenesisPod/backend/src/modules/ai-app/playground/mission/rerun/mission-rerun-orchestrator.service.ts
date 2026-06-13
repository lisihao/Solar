/**
 * MissionRerunOrchestratorService —— playground 业务子类(继承
 * BusinessTeamRerunOrchestratorFramework)
 *
 * 2026-05-24 P5 (Wave 1)：rerun guard + status whitelist + ownership + checkpoint
 * clone + emit + fire-and-forget 骨架已上提到 ai-harness/teams/business-team/rerun/
 * business-team-rerun-orchestrator.framework。本类只剩 playground hook：
 *   - sourceMissionResolver / extractStatus / extractTopic：业务表 schema
 *   - cloneInput：configSnapshot → RunMissionInput 重建
 *   - runMission：调 playground pipeline dispatcher
 *   - emit / eventNames：playground 业务事件 type
 *   - rerunFromTodo 业务规则：origin / scope 黑名单 + dimensionRef / chapterIndex DTO
 */

import {
  BadRequestException,
  Injectable,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { PlaygroundPipelineDispatcher } from "../pipeline/playground.pipeline";
import {
  MissionStore,
  type MissionDetail,
} from "../lifecycle/mission-store.service";
// MissionDetail (basic mission row)

import { MissionEventBuffer } from "../lifecycle/mission-event-buffer.service";
import {
  BusinessTeamRerunOrchestratorFramework,
  MissionCheckpointService,
  MissionOwnershipRegistry,
  type MissionRerunOrchestratorHooks,
  type MissionRerunResult,
} from "@/modules/ai-harness/facade";
import { type RunMissionInput } from "../../api/dto/run-mission.dto";
import type { PlaygroundConfigSnapshot } from "../../runtime/playground.input-rebuilder";
import { RerunGuardService } from "./rerun-guard.service";

interface RerunTodoBody {
  origin?: string;
  scope?: "dimension" | "chapter" | "review" | "system" | "mission";
  dimensionRef?: string;
  chapterIndex?: number;
  todoTitle?: string;
  reasonText?: string;
}

@Injectable()
export class MissionRerunOrchestratorService extends BusinessTeamRerunOrchestratorFramework<
  MissionDetail,
  RunMissionInput,
  RerunTodoBody
> {
  // ★ 2026-06-11 同-id 续跑/重跑：fresh 模式清 checkpoint 用（incremental 保留续跑）。
  private readonly checkpointRef: MissionCheckpointService;

  constructor(
    // ★ P-DUR2 (2026-05-30): dispatcher 现在反向 inject 本 orchestrator（orphan boot
    //   续跑），形成模块内循环依赖 → forwardRef 解。
    @Inject(forwardRef(() => PlaygroundPipelineDispatcher))
    orchestrator: PlaygroundPipelineDispatcher,
    store: MissionStore,
    buffer: MissionEventBuffer,
    ownership: MissionOwnershipRegistry,
    checkpoint: MissionCheckpointService,
    rerunGuard: RerunGuardService,
  ) {
    const hooks: MissionRerunOrchestratorHooks<
      MissionDetail,
      RunMissionInput,
      RerunTodoBody
    > = {
      rerunGuard,
      sourceMissionResolver: (sourceMissionId, userId) =>
        store.getById(sourceMissionId, userId),
      // 全覆盖审计修 (2026-05-06): 白名单校验，cancelled 也允许 rerun（用户感知 OK）
      rerunnableStatuses: [
        "completed",
        "failed",
        "quality-failed",
        "cancelled",
      ] as const,
      extractStatus: (m) => m.status,
      extractTopic: (m) => m.topic,
      cloneInput: (source, overrides) => {
        // C5/G7 S3：rerun 输入只从 typed config snapshot 重建(单一真源),不读 userProfile
        const snap = (source as { configSnapshot?: unknown })
          .configSnapshot as PlaygroundConfigSnapshot | null;
        if (snap?.schemaVersion == null) {
          throw new BadRequestException(
            `mission ${source.id} 早于 config snapshot 上线(legacy),不支持重跑。`,
          );
        }
        const b = snap.businessInput;
        return {
          topic: overrides.topic ?? snap.topic,
          depth: b.depth,
          language: snap.language as RunMissionInput["language"],
          budgetProfile: b.budgetProfile,
          styleProfile: b.styleProfile,
          lengthProfile: b.lengthProfile,
          audienceProfile: b.audienceProfile,
          withFigures: b.withFigures,
          auditLayers: b.auditLayers,
          concurrency: b.concurrency,
          viewMode: b.viewMode,
          searchTimeRange: b.searchTimeRange,
          knowledgeBaseIds: b.knowledgeBaseIds,
          maxCredits: snap.budget.maxCredits,
          budgetMultiplierOverride: snap.budget.budgetMultiplier,
          wallTimeCapMs: snap.runtimeLimits.wallTimeCapMs,
          inheritFromMissionId: overrides.inheritFromMissionId,
        };
      },
      runMission: async (missionId, input, userId) => {
        await orchestrator.runMission(missionId, input, userId);
      },
      assignOwnership: (missionId, userId) =>
        ownership.assign(missionId, userId),
      cloneCheckpoint: (sourceMissionId, newMissionId) =>
        checkpoint.cloneCheckpoint(sourceMissionId, newMissionId),
      emit: async ({ type, missionId, userId, payload }) => {
        await buffer.broadcast({
          type,
          scope: { missionId, userId },
          payload,
          timestamp: Date.now(),
        });
      },
      streamNamespace: "playground",
      eventNames: {
        manualRerunFromTodo: "playground.mission:manual-rerun-from-todo",
      },
    };
    super(hooks, "playground");
    this.checkpointRef = checkpoint;
  }

  /**
   * Playground 专属 rerunFromTodo 业务规则封装：
   *  - origin/scope 黑名单（leader-assess-abort / s11-persist）
   *  - dimensionRef / chapterIndex / todoTitle / reasonText 字段透传给 emit payload
   *  - topic 200 字符 trim（防 header truncate 失效）
   *
   *  保留旧签名 (controller 直接调对象参数,framework 的 rerunFromTodo 是对象 + 多个 callback)。
   */
  async rerunFromTodo(args: {
    sourceMissionId: string;
    userId: string;
    todoId: string;
    body: RerunTodoBody;
  }): Promise<MissionRerunResult> {
    const { sourceMissionId, userId, todoId, body } = args;
    const origin = (body?.origin ?? "").trim();
    if (origin === "leader-assess-abort") {
      throw new BadRequestException(
        "Aborted dimensions cannot be re-run; create a new mission instead",
      );
    }
    if (origin === "system-stage" && todoId.endsWith("s11-persist")) {
      throw new BadRequestException(
        "Persistence stage cannot be re-run — re-run the whole mission instead",
      );
    }

    return this["rerunFromTodoFrameworkCore"](
      { sourceMissionId, userId, todoId, todoBody: body },
      (todoBody) => {
        const scope = todoBody?.scope ?? "mission";
        const dimRef = (todoBody?.dimensionRef ?? "").trim();
        const todoTitle = (todoBody?.todoTitle ?? "").trim();
        const reasonText = (todoBody?.reasonText ?? "").trim();
        return {
          origin: (todoBody?.origin ?? "").trim(),
          scope,
          dimensionRef: dimRef || undefined,
          chapterIndex: todoBody?.chapterIndex,
          todoTitle: todoTitle || undefined,
          reasonText: reasonText || undefined,
        };
      },
      (_todoBody, sourceTopic) => sourceTopic.slice(0, 200),
    );
  }

  /**
   * 全 mission 重跑 —— ★ 2026-06-11 改为**同-id 原地续跑/重跑**（78/79 诉求：
   * "在原来的任务上更新，无非增加一个版本"，不再 randomUUID 新建 missionId + clone
   * checkpoint = 出现"新任务"）。
   *   - incremental（默认）：保留 checkpoint → runMission 原地从上次完成的 stage 续跑（R2-#37）。
   *   - fresh：清 checkpoint → 同 id 从头重跑。
   * 两种都经 createMissionRow 的 reopen 分支：markReopened（终态→running + bump runCount
   * = "增加一个版本" + 清终态字段）。missionId 不变，前端停在原任务、版本号自增。
   */
  async rerunFullMission(
    sourceMissionId: string,
    userId: string,
    mode: "fresh" | "incremental" = "incremental",
  ): Promise<MissionRerunResult> {
    const original = await this.assertSourceMissionRerunnable(
      sourceMissionId,
      userId,
    );
    // 同-id：有 checkpoint 时不传 inheritFromMissionId（checkpoint resume 与轨迹
    // 继承叠加会自继承语义混乱）—— checkpoint 路径优先。
    const input = this.hooks.cloneInput(original, {});
    if (mode === "fresh") {
      // 同 id 从头：清自己的 checkpoint，runMission 不会命中 resume 分支。
      await this.checkpointRef.clear(sourceMissionId).catch(() => undefined);
    } else {
      // ★ 2026-06-12 修「更新全量重跑」（用户实证：失联 mission 点更新 → 14 维度全部重做）：
      //   同-id incremental 在 **无可用 checkpoint** 时（死在首个 stage 断点之前 /
      //   超 24h 恢复窗，正是停滞击杀 mission 的常态），此前静默退化为 fresh ——
      //   S2 重新规划生成**不同的维度名** → S3 per-dim 持久化缓存
      //   (agent_playground_research_results 按 dimension 名命中) 全部 miss → 全量重跑。
      //   修复：无 checkpoint 时退化为 self-inherit —— hydrate 自己已持久化的
      //   plan（S2 跳过重新规划，维度名稳定）+ per-dim research results + 章节草稿，
      //   已完成的维度/章节真正跳过，incremental 兑现"保留已完成任务"的承诺。
      const decision = await this.checkpointRef
        .canResume(sourceMissionId)
        .catch(() => null);
      if (!decision?.canResume) {
        input.inheritFromMissionId = sourceMissionId;
      }
    }
    void this.hooks
      .runMission(sourceMissionId, input, userId)
      .catch((err: unknown) => {
        this.log.error(
          `mission ${sourceMissionId} (in-place rerun, mode=${mode}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    return {
      missionId: sourceMissionId,
      streamNamespace: this.hooks.streamNamespace,
    };
  }
}
