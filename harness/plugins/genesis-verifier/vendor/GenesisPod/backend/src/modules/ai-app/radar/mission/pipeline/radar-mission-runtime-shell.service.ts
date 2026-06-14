/**
 * RadarMissionRuntimeShell —— Radar 业务 adapter（thin wrapper to framework）
 *
 * 完全对齐 playground/MissionRuntimeShellService 范式：
 *   - 不再自己实现 lifecycle（wallTimer / heartbeat / abort / cleanup）
 *   - 通过 IMissionRuntimeAdapter 注入业务专属决策，剩下让框架处理
 *   - 复用 ai-harness/teams/business-team/lifecycle/mission-runtime-shell.framework
 */
import { Injectable, Logger } from "@nestjs/common";
import {
  EventBus,
  MissionRuntimeShellFramework,
  type IMissionRuntimeAdapter,
  type MissionRuntimeSession,
} from "@/modules/ai-harness/facade";
import { RadarMissionStore } from "../lifecycle/radar-mission-store.service";
import { buildRadarConfigSnapshot } from "../lifecycle/radar-mission-config-snapshot";
import {
  RunRadarDiscoveryMissionInput,
  RunRadarRefreshMissionInput,
  resolveRadarBudgetMultiplier,
  resolveRadarDiscoveryMaxCredits,
  resolveRadarDiscoveryWallTimeMs,
  resolveRadarMaxCredits,
  resolveRadarMissionWallTimeMs,
} from "../../api/dto/run-radar-refresh-mission.dto";
import { RadarRunTrigger } from "@prisma/client";

type RadarMissionInput =
  | RunRadarRefreshMissionInput
  | RunRadarDiscoveryMissionInput;

function isDiscoveryInput(
  input: RadarMissionInput,
): input is RunRadarDiscoveryMissionInput {
  return "existingSources" in input;
}

export type { MissionRuntimeSession };

const RADAR_EVENT_NAMESPACE = "ai-radar";
const RADAR_BILLING_MODULE_TYPE = "ai-radar";

@Injectable()
export class RadarMissionRuntimeShell {
  private readonly log = new Logger(RadarMissionRuntimeShell.name);

  constructor(
    private readonly framework: MissionRuntimeShellFramework,
    private readonly store: RadarMissionStore,
    private readonly eventBus: EventBus,
  ) {}

  async openSession(args: {
    missionId: string;
    input: RadarMissionInput;
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
    return this.framework.runWithinContext(
      session,
      RADAR_EVENT_NAMESPACE,
      RADAR_BILLING_MODULE_TYPE,
      fn,
    );
  }

  /** Radar 业务 adapter：注入业务专属决策给 framework */
  private buildAdapter(): IMissionRuntimeAdapter<RadarMissionInput> {
    const store = this.store;
    const eventBus = this.eventBus;
    const log = this.log;
    return {
      eventNamespace: RADAR_EVENT_NAMESPACE,
      billingModuleType: RADAR_BILLING_MODULE_TYPE,
      resolveWallTimeCapMs: (input) =>
        isDiscoveryInput(input)
          ? resolveRadarDiscoveryWallTimeMs()
          : resolveRadarMissionWallTimeMs(),
      resolveMaxCredits: (input) =>
        isDiscoveryInput(input)
          ? resolveRadarDiscoveryMaxCredits()
          : resolveRadarMaxCredits(),
      resolveBudgetMultiplier: () => resolveRadarBudgetMultiplier(),
      createMissionRow: async ({
        missionId,
        userId,
        workspaceId,
        input,
        effectiveMaxCredits,
      }) => {
        // Discovery mission 是无 audit row 短查询，不写 radar_runs 表
        if (isDiscoveryInput(input)) return;
        const businessInput = {
          topicId: input.topicId,
          topicName: input.topicName,
          description: input.description ?? null,
          keywords: input.keywords,
          entityType: input.entityType ?? null,
          refreshCron: input.refreshCron,
          trigger: input.trigger,
        };
        await store.createAtomic({
          id: missionId,
          topicId: input.topicId,
          userId,
          workspaceId,
          trigger: mapTrigger(input.trigger),
          maxCredits: effectiveMaxCredits,
          wallTimeCapMs: resolveRadarMissionWallTimeMs(),
          payload: businessInput,
          // ★ C5/G7（三 app 统一）：冻结 canonical config snapshot。
          configSnapshot: buildRadarConfigSnapshot({
            businessInput,
            maxCredits: effectiveMaxCredits,
            budgetMultiplier: resolveRadarBudgetMultiplier(),
            wallTimeCapMs: resolveRadarMissionWallTimeMs(),
          }),
        });
      },
      refreshHeartbeat: async (missionId, podId) => {
        await store.refreshHeartbeat(missionId, podId);
      },
      emitMissionEvent: async ({ type, missionId, userId, payload }) => {
        await eventBus
          .emit({
            type,
            scope: { missionId, userId },
            payload,
            timestamp: Date.now(),
          })
          .catch((err: unknown) => {
            // eventBus 自己 log + drop schema 校验失败；保留 warn 防完全静默
            log.warn(
              `[radar-runtime] emit ${type} for ${missionId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      },
    };
  }
}

function mapTrigger(
  trigger: "MANUAL" | "SCHEDULED" | "FIRST_RUN",
): RadarRunTrigger {
  switch (trigger) {
    case "SCHEDULED":
      return RadarRunTrigger.SCHEDULED;
    case "FIRST_RUN":
      return RadarRunTrigger.FIRST_RUN;
    default:
      return RadarRunTrigger.MANUAL;
  }
}
