/**
 * P5 fixture：fake "MarsTeam" mock 子类骨架，证明 framework 真可被复用。
 *
 * 每个 framework 的 spec import 此处 fake 子类，验证 framework 调度 / hook 调用顺序 /
 * 错误捕获 / cleanup 等机制——而不只测 reference impl 子类（那就等于复制 reference impl）。
 */

import { Logger } from "@nestjs/common";
import {
  BusinessTeamRerunGuardFramework,
  type BusinessRerunGuardDetailMinimal,
  type BusinessTeamRerunGuardHooks,
} from "../../business-team-rerun-guard.framework";
import { BusinessTeamStageRerunDispatcherFramework } from "../../business-team-stage-rerun-dispatcher.framework";
import { BusinessTeamCtxHydratorFramework } from "../../business-team-ctx-hydrator.framework";
import { BusinessTeamRerunRuntimeBuilderFramework } from "../../business-team-rerun-runtime-builder.framework";
import { BusinessTeamRerunOrchestratorFramework } from "../../business-team-rerun-orchestrator.framework";
import type {
  CascadeRunHooks,
  CascadeRunInput,
  CascadeRunResult,
} from "../../abstractions/stage-rerun-handler.contract";
import type {
  CtxHydratorDetailMinimal,
  CtxHydratorSchemaProvider,
} from "../../abstractions/ctx-hydrator-schema.contract";
import type {
  BusinessTeamRerunRuntimeSession,
  RerunRuntimeComposerHooks,
} from "../../abstractions/rerun-runtime-builder.contract";
import type { MissionRerunOrchestratorHooks } from "../../abstractions/rerun-orchestrator.contract";
import type {
  MissionLifecycleManager,
  MissionTerminalArbiter,
} from "../../../../../lifecycle/mission-lifecycle/mission-lifecycle-manager";
import { MissionAbortRegistry } from "../../../../../lifecycle/mission-lifecycle/abort-registry";

// ── 1. fake MarsTeam guard ────────────────────────────────────────────────
export interface MarsDetail extends BusinessRerunGuardDetailMinimal {
  readonly mission: string; // fake business 字段
}
export interface MarsTerminalExtra {
  readonly kind: "failed";
  readonly userId: string;
  readonly tag: string;
}

export class FakeMarsRerunGuard extends BusinessTeamRerunGuardFramework<
  MarsDetail,
  MarsTerminalExtra
> {}

export function makeFakeMarsGuardHooks(overrides?: {
  detail?: MarsDetail | null;
  latestEventTs?: number | null;
  clearHeartbeat?: jest.Mock;
  emitZombie?: jest.Mock;
  arbiter?: MissionTerminalArbiter;
}): BusinessTeamRerunGuardHooks<MarsDetail, MarsTerminalExtra> {
  return {
    detailReader: jest.fn().mockResolvedValue(overrides?.detail ?? null),
    latestBusinessEventTsReader: jest
      .fn()
      .mockResolvedValue(overrides?.latestEventTs ?? null),
    clearHeartbeat:
      overrides?.clearHeartbeat ?? jest.fn().mockResolvedValue(undefined),
    emitZombieCleanup:
      overrides?.emitZombie ?? jest.fn().mockResolvedValue(undefined),
    terminalArbiter:
      overrides?.arbiter ??
      ({
        tryFinalize: jest.fn().mockResolvedValue(true),
      } as unknown as MissionTerminalArbiter),
    buildZombieTerminalExtra: ({ userId }): MarsTerminalExtra => ({
      kind: "failed",
      userId,
      tag: "mars-zombie",
    }),
    eventTypes: { zombieCleanup: "mars.mission:zombie-cleanup" },
    namespace: "mars",
  };
}

export function makeFakeLifecycleManager(opts?: {
  finalizeResult?: unknown;
  finalizeThrow?: Error;
}): MissionLifecycleManager {
  const finalize = opts?.finalizeThrow
    ? jest.fn().mockRejectedValue(opts.finalizeThrow)
    : jest.fn().mockResolvedValue(opts?.finalizeResult ?? { status: "failed" });
  return { finalize } as unknown as MissionLifecycleManager;
}

// ── 2. fake dispatcher ────────────────────────────────────────────────────
export interface MarsCtx {
  missionId: string;
  userId: string;
  marsField?: string;
}
export interface MarsStubs {
  readonly log: Logger;
  readonly counter: { value: number };
}
export type MarsEmit = jest.Mock & {
  (event: { type: string; payload?: unknown }): Promise<void>;
};

export class FakeMarsStageDispatcher extends BusinessTeamStageRerunDispatcherFramework<
  MarsCtx,
  MarsStubs,
  MarsEmit
> {
  async run(
    args: CascadeRunInput<MarsCtx, MarsEmit>,
  ): Promise<CascadeRunResult> {
    return this.runFromStageWithCascade(args);
  }
}

export function makeFakeDispatcherHooks(opts: {
  chain: string[];
  handlers: Map<
    string,
    (ctx: MarsCtx, emit: MarsEmit, stubs: MarsStubs) => Promise<MarsCtx | void>
  >;
  assertResult?: { rerunable: true } | { rerunable: false; reason: string };
  markStageProgress?: jest.Mock;
  withCascadeScope?: <T>(ctx: MarsCtx, fn: () => Promise<T>) => Promise<T>;
}): CascadeRunHooks<MarsCtx, MarsStubs, MarsEmit> {
  return {
    handlers: opts.handlers,
    computeChain: jest.fn(() => opts.chain),
    assertRerunable: jest.fn(() => opts.assertResult ?? { rerunable: true }),
    buildStubs: jest.fn(() => ({
      log: new Logger("FakeMarsStubs"),
      counter: { value: 0 },
    })),
    eventTypes: {
      stageStarted: "mars.rerun:stage-started",
      cascadeAborted: "mars.rerun:cascade-aborted",
    },
    markStageProgress: opts.markStageProgress,
    log: new Logger("FakeMarsDispatcher"),
    withCascadeScope: opts.withCascadeScope,
    forwardEmit: async (rawEmit, _ctx, event) => {
      await rawEmit({ type: event.type, payload: event.payload });
    },
  };
}

// ── 3. fake hydrator ──────────────────────────────────────────────────────
export interface MarsHydratorDetail extends CtxHydratorDetailMinimal {
  readonly marsTopic?: string;
}
export interface MarsHydratedCtx {
  readonly missionId: string;
  readonly userId: string;
  readonly marsTopic: string;
  readonly __hydrated: true;
}

export class FakeMarsCtxHydrator extends BusinessTeamCtxHydratorFramework<
  MarsHydratorDetail,
  MarsHydratedCtx
> {}

export function makeFakeHydratorSchema(opts?: {
  detail?: MarsHydratorDetail | null;
  snapshotOk?: boolean;
  snapshotReason?: string;
  buildHydratedThrow?: Error;
  maxReportFullBytes?: number;
}): CtxHydratorSchemaProvider<MarsHydratorDetail, MarsHydratedCtx> {
  const detail = opts?.detail;
  return {
    fetchDetail: jest.fn().mockResolvedValue(detail ?? null),
    assertSnapshotSupported: jest.fn(() =>
      opts?.snapshotOk === false
        ? { ok: false, reason: opts.snapshotReason ?? "snapshot missing" }
        : { ok: true },
    ),
    buildHydrated: opts?.buildHydratedThrow
      ? jest.fn().mockRejectedValue(opts.buildHydratedThrow)
      : jest.fn().mockImplementation(async ({ missionId, userId }) => ({
          missionId,
          userId,
          marsTopic: detail?.marsTopic ?? "fake-topic",
          __hydrated: true,
        })),
    ...(opts?.maxReportFullBytes != null
      ? { maxReportFullBytes: opts.maxReportFullBytes }
      : {}),
  };
}

// ── 4. fake runtime builder ───────────────────────────────────────────────
export interface MarsSession extends BusinessTeamRerunRuntimeSession {
  readonly extras: Record<string, unknown>;
}
export interface MarsComposed {
  readonly missionId: string;
  readonly userId: string;
  readonly marsTopic: string;
  readonly billingTag: string;
}

export class FakeMarsRuntimeBuilder extends BusinessTeamRerunRuntimeBuilderFramework<
  MarsHydratedCtx,
  MarsComposed,
  MarsSession
> {
  // 暴露 protected helper 给 spec 验证
  testProtectStale(missionId: string): void {
    this.protectStaleAbortController(missionId);
  }
  testMakeCleanup(missionId: string, after?: () => void): () => void {
    return this.makeCleanup(missionId, after);
  }
}

export function makeFakeRuntimeHooks(opts: {
  buildSession: (args: {
    ctx: MarsHydratedCtx;
    workspaceId?: string;
  }) => MarsSession;
  composeMissionContext?: (
    ctx: MarsHydratedCtx,
    session: MarsSession,
  ) => MarsComposed;
  writeBackToHydrated?: (
    composed: MarsComposed,
    hydrated: MarsHydratedCtx,
  ) => MarsHydratedCtx;
}): RerunRuntimeComposerHooks<MarsHydratedCtx, MarsComposed, MarsSession> {
  return {
    buildSession: jest.fn(opts.buildSession),
    composeMissionContext: jest.fn(
      opts.composeMissionContext ??
        ((ctx, _s): MarsComposed => ({
          missionId: ctx.missionId,
          userId: ctx.userId,
          marsTopic: ctx.marsTopic,
          billingTag: "mars-billing",
        })),
    ),
    writeBackToHydrated: jest.fn(
      opts.writeBackToHydrated ?? ((_c, h): MarsHydratedCtx => h),
    ),
  };
}

export function makeAbortRegistry(): MissionAbortRegistry {
  return new MissionAbortRegistry();
}

// ── 5. fake orchestrator ──────────────────────────────────────────────────
export interface MarsSourceMission {
  readonly id: string;
  readonly status: string;
  readonly topic: string;
  readonly userId: string;
}
export interface MarsRunInput {
  readonly topic: string;
  readonly inheritFromMissionId?: string;
}
export interface MarsTodoBody {
  readonly origin: string;
  readonly reason: string;
}

export class FakeMarsRerunOrchestrator extends BusinessTeamRerunOrchestratorFramework<
  MarsSourceMission,
  MarsRunInput,
  MarsTodoBody
> {
  // public wrappers exposing framework protected core for spec
  async run(request: {
    sourceMissionId: string;
    userId: string;
    mode?: "fresh" | "incremental";
  }): Promise<{ missionId: string; streamNamespace: string }> {
    return this["rerunFullMissionFrameworkCore"](request);
  }
  async runFromTodo(
    request: {
      sourceMissionId: string;
      userId: string;
      todoId: string;
      todoBody: MarsTodoBody;
    },
    buildEmitPayload: (body: MarsTodoBody) => Record<string, unknown>,
    extractTopicOverride?: (
      body: MarsTodoBody,
      sourceTopic: string,
    ) => string | undefined,
    topicLimit?: number,
  ): Promise<{ missionId: string; streamNamespace: string }> {
    return this["rerunFromTodoFrameworkCore"](
      request,
      buildEmitPayload,
      extractTopicOverride,
      topicLimit,
    );
  }
}

export function makeFakeOrchestratorHooks(opts?: {
  source?: MarsSourceMission | null;
  rerunnableStatuses?: readonly string[];
  ensureRerunableThrow?: Error;
  cloneCheckpoint?: jest.Mock;
  runMission?: jest.Mock;
  emit?: jest.Mock;
  assignOwnership?: jest.Mock;
}): MissionRerunOrchestratorHooks<
  MarsSourceMission,
  MarsRunInput,
  MarsTodoBody
> {
  const ensureRerunable = opts?.ensureRerunableThrow
    ? jest.fn().mockRejectedValue(opts.ensureRerunableThrow)
    : jest.fn().mockResolvedValue(undefined);
  return {
    rerunGuard: {
      checkInFlight: jest.fn(),
      ensureRerunable,
    },
    sourceMissionResolver: jest.fn().mockResolvedValue(opts?.source ?? null),
    rerunnableStatuses:
      opts?.rerunnableStatuses ??
      (["completed", "failed", "cancelled"] as const),
    extractStatus: (s): string => s.status,
    extractTopic: (s): string => s.topic,
    cloneInput: jest.fn(
      (s, ov): MarsRunInput => ({
        topic: ov.topic ?? s.topic,
        inheritFromMissionId: ov.inheritFromMissionId,
      }),
    ),
    runMission: opts?.runMission ?? jest.fn().mockResolvedValue(undefined),
    assignOwnership: opts?.assignOwnership ?? jest.fn(),
    cloneCheckpoint: opts?.cloneCheckpoint,
    emit: opts?.emit ?? jest.fn().mockResolvedValue(undefined),
    streamNamespace: "mars",
    eventNames: {
      manualRerunFromTodo: "mars.mission:manual-rerun-from-todo",
    },
  };
}
