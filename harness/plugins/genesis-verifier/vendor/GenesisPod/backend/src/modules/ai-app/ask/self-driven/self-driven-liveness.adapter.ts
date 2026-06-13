/**
 * SelfDrivenLivenessAdapter — orphan/dead-pod safety for self-driven missions.
 *
 * Registers a MissionLivenessGuard adapter so a mission whose pod died (DB
 * heartbeat stops AND no new events) is markFailed: the terminal status is
 * arbitrated through the store and a self-driven.error event is journaled, so
 * the UI unsticks via /replay. This is v1 scope (durable events + orphan
 * detection) — NOT full crash-resume of a half-run generator.
 *
 * Why staleThreshold > the 10-min HITL gate: while the human is deciding, the
 * runner emits no events, but the dispatcher's independent 30s heartbeat keeps
 * the heartbeat fresh — so a live-but-waiting mission is never reclaimed; only a
 * dead pod (heartbeat frozen) trips the guard.
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  MissionFailureCode,
  MissionLifecycleManager,
  MissionLivenessGuard,
  SelfDrivenEventRelay,
} from "@/modules/ai-harness/facade";
import { AskSelfDrivenMissionStore } from "./ask-self-driven-mission.store";

@Injectable()
export class SelfDrivenLivenessAdapter implements OnModuleInit {
  private readonly logger = new Logger(SelfDrivenLivenessAdapter.name);

  constructor(
    private readonly liveness: MissionLivenessGuard,
    private readonly store: AskSelfDrivenMissionStore,
    private readonly lifecycle: MissionLifecycleManager,
    private readonly relay: SelfDrivenEventRelay,
  ) {}

  onModuleInit(): void {
    this.liveness.registerAdapter(
      "self-driven",
      {
        fetchRunningMissions: () => this.store.listRunning(200),
        getMostRecentEventTs: (ids, sinceMs) =>
          this.store.mostRecentEventTs(ids, sinceMs),
        markFailed: async (missionId, reason, errorMessage) => {
          const userId = (await this.store.getOwnerById(missionId)) ?? "";
          const failureCode =
            reason === "wall-time-exceeded"
              ? MissionFailureCode.wall_time_exceeded
              : MissionFailureCode.runtime_crashed;
          await this.lifecycle.finalize({
            missionId,
            intent: { status: "failed", failureCode, errorMessage },
            arbiter: this.store,
            onWon: async () => {
              await this.relay
                .emitMissionEvent(
                  { type: "error", missionId, message: errorMessage },
                  userId,
                )
                .catch(() => undefined);
            },
          });
          this.logger.warn(
            `[liveness] self-driven mission ${missionId} reclaimed (${reason})`,
          );
        },
      },
      {
        // 30s heartbeat keeps live missions safe; only a dead pod trips this.
        staleThresholdMs: 12 * 60 * 1000,
        wallTimeCapMs: 2 * 60 * 60 * 1000,
        startupGraceMs: 5 * 60 * 1000,
        scanIntervalMs: 60_000,
        bootDelayMs: 60_000,
      },
    );
    this.logger.log("Self-Driven liveness adapter registered");
  }
}
