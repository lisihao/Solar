/**
 * MissionQueryService — Canonical mission detail view inputs aggregator（B2-1）
 *
 * 落地依据：thinning plan §B2-1 / §6.2 / §6.4.1.a / §6.5.1 / §6.7.1 / §5.3
 *
 * 职责（精确）：
 * 1. ownership 校验（§6.5.1 rule 3 ownership in MissionQueryService before projection）
 * 2. 加载 mission row（含 starting placeholder 路径，§6.4.1.a rule 1）
 * 3. 加载 replay events（buffer 优先 + persisted fallback）
 * 4. 加载 checkpoint availability 委托给 ResumeRerunPolicyService
 * 5. 调 ResumeRerunPolicyService 得到 resumable + rerunnableStages 决策
 * 6. 暴露单一 loadInputs() 返回 projector 所需全部数据，不做任何投影
 *
 * 不做：
 * - 不直接调 projector
 * - 不直接决定 mission status enum（projector §6.4.1.a 负责）
 * - 不在 controller 中混用（controller 仅 wire）
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";

import { MissionOwnershipRegistry } from "@/modules/ai-harness/facade";

import {
  MissionStore,
  type MissionDetail,
} from "../lifecycle/mission-store.service";
import type { PlaygroundReportVersionRow } from "../lifecycle/mission-report.helper";
import { MissionEventBuffer } from "../lifecycle/mission-event-buffer.service";
import {
  ResumeRerunPolicyService,
  type ResumeDecision,
} from "../rerun/resume-rerun-policy.service";
import { ArtifactComposerService } from "../services/artifact-composer.service";
import type { RerunnableStageEntry } from "../../api/contracts/view-state.contract";
import type { ReportArtifactV2 } from "../../api/contracts/artifact.contract";
import type { EmptyArtifactSentinel } from "../../api/contracts/view-state.contract";

// ============================================================================
// Output bundle（projector 输入）
// ============================================================================

export interface MissionQueryInputs {
  /**
   * starting placeholder 模式：row 尚未持久化，ownership 已确认。
   * projector 据此走 §6.4.1.a rule 1 surface starting。
   */
  mode: "starting-placeholder" | "row-loaded";
  missionId: string;
  /** starting placeholder 模式下为 null。 */
  row: MissionDetail | null;
  /** §6.7.1 timelineVersion 计算用的事件序列。优先 in-memory，缺则走 persisted fallback。 */
  events: ReadonlyArray<{
    type: string;
    payload: unknown;
    timestamp: number;
    agentId?: string;
    traceId?: string;
  }>;
  /** §6.5 决策结果（projector 不再重复计算）。 */
  resume: ResumeDecision;
  rerunnableStages: RerunnableStageEntry[];
  /**
   * 报告版本列表（来自 mission-store.listReportVersions），P0-1 真实投影到
   * view.reportVersions（取代之前 first-cut 的 []）。canonical 字段，§B3-3 actions 3
   * "add any minimal supporting metadata such as report versions"。
   */
  reportVersions: readonly PlaygroundReportVersionRow[];
  /**
   * P0-2：ArtifactComposerService 预组合的 canonical artifact。
   * 包含 R2 off-load fetch 结果（§6.6.4），projector 直接消费不再 inline 调用。
   * starting-placeholder 路径下为 sentinel。
   */
  composedArtifact: ReportArtifactV2 | EmptyArtifactSentinel;
}

// ============================================================================
// Service
// ============================================================================

@Injectable()
export class MissionQueryService {
  private readonly log = new Logger(MissionQueryService.name);

  constructor(
    private readonly store: MissionStore,
    private readonly eventBuffer: MissionEventBuffer,
    private readonly ownership: MissionOwnershipRegistry,
    private readonly policy: ResumeRerunPolicyService,
    private readonly artifactComposer: ArtifactComposerService,
  ) {}

  /**
   * 主入口：加载 projector 所需全部输入。
   *
   * ownership 校验在此处完成（§6.5.1 rule 3 / §5.3 anchor），projector 接收
   * already-authorized inputs，不重复 auth（§6.5.1 rule 4 of resumable Important section）。
   */
  async loadInputs(
    missionId: string,
    userId: string | undefined,
  ): Promise<MissionQueryInputs> {
    if (!userId) {
      throw new ForbiddenException("Authentication required");
    }

    // 1. mission row（store.getById 已含 where { id, userId } ownership 过滤）
    const row = await this.store.getById(missionId, userId);

    if (row) {
      return this.buildRowLoadedInputs(row);
    }

    // 2. row 不存在 → 走 §6.4.1.a rule 1 starting placeholder 路径
    //    与现有 mission-read.controller.ts:120-135 已有逻辑对齐
    const owner = this.ownership.getOwner(missionId);
    if (owner && owner === userId) {
      this.log.debug(
        `[loadInputs ${missionId}] row not yet persisted; returning starting-placeholder inputs`,
      );
      return this.buildStartingPlaceholderInputs(missionId);
    }

    throw new ForbiddenException(`mission ${missionId} not found`);
  }

  // ---------------------------------------------------------------------------

  private async buildRowLoadedInputs(
    row: MissionDetail,
  ): Promise<MissionQueryInputs> {
    // 3. events（buffer 优先 + persisted fallback）
    const events = await this.loadEvents(row.id);

    // P0-1：listReportVersions（真实投影 view.reportVersions，不再固定 []）
    const reportVersions = await this.store
      .listReportVersions(row.id)
      .catch((err: unknown) => {
        this.log.warn(
          `[loadInputs ${row.id}] listReportVersions failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [] as PlaygroundReportVersionRow[];
      });

    // P0-2：ArtifactComposerService（含 R2 off-load fetch）
    const composedArtifact = await this.artifactComposer.composeArtifactView(row);

    // 4. checkpoint availability
    const { hasConfigSnapshot, hasCheckpoint } =
      await this.policy.loadCheckpointAvailability(row);

    // 5. 决策（§6.4.1.a publicStatus 由 projector 负责，policy 接收的 publicStatus 用
    //    persisted status 的"启发式投影"。projector 最终输出 status 时不会反向修改 policy 结果——
    //    policy 决策只依赖 hasConfigSnapshot / hasCheckpoint / lastCompletedStage 三个事实，
    //    publicStatus 的边界态影响有限。)
    const publicStatusHint = this.projectPublicStatusForPolicy(row);

    const resume = this.policy.computeResumable({
      publicStatus: publicStatusHint,
      hasConfigSnapshot,
      hasCheckpoint,
      lastCompletedStageOrdinal: row.lastCompletedStage ?? null,
    });

    const rerunnableStages = this.policy.computeRerunnableStages({
      publicStatus: publicStatusHint,
      hasConfigSnapshot,
      hasCheckpoint,
      lastCompletedStageOrdinal: row.lastCompletedStage ?? null,
    });

    return {
      mode: "row-loaded",
      missionId: row.id,
      row,
      events,
      resume,
      rerunnableStages,
      reportVersions,
      composedArtifact,
    };
  }

  private buildStartingPlaceholderInputs(
    missionId: string,
  ): MissionQueryInputs {
    return {
      mode: "starting-placeholder",
      missionId,
      row: null,
      events: [],
      resume: {
        resumable: false,
        reason: "mission still bootstrapping",
      },
      // starting 状态下 rerun 全 denied
      rerunnableStages: this.policy.computeRerunnableStages({
        publicStatus: "starting",
        hasConfigSnapshot: false,
        hasCheckpoint: false,
        lastCompletedStageOrdinal: null,
      }),
      reportVersions: [],
      composedArtifact: {
        kind: "empty-artifact",
        reason: "not-yet-materialized",
      },
    };
  }

  private async loadEvents(missionId: string) {
    const buffered = this.eventBuffer.read(missionId);
    if (buffered.length > 0) return buffered;
    return this.eventBuffer.readPersisted(missionId);
  }

  /**
   * 给 policy 用的状态启发式投影。
   * 与 §6.4.1.a 完整映射有差异，仅供 policy 决策——policy 行为只对 running/starting
   * 与 completed/quality-failed 做不同分支（详见 ResumeRerunPolicyService.computeResumable），
   * 不依赖 cancelled vs failed 的细分。
   */
  private projectPublicStatusForPolicy(
    row: MissionDetail,
  ):
    | "starting"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "quality-failed" {
    switch (row.status) {
      case "completed":
        return "completed";
      case "rejected":
        return "quality-failed";
      case "failed":
        return "failed";
      case "running":
        return "running";
      default:
        // future Prisma 状态值（如 cancelled）保守降级
        return row.terminalOutcome ? "failed" : "running";
    }
  }
}
