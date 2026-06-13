/**
 * P6 fixture：fake "MarsTeam" lifecycle mock 子类骨架，证明 framework 真可被复用。
 *
 * 每个 lifecycle framework 的 spec import 此处 fake 子类，验证 framework 调度 /
 * hook 调用顺序 / 错误捕获 / cleanup 等机制——而不只测 reference impl 子类（那就
 * 等于复制 reference impl）。
 */

import { BusinessTeamCheckpointStoreFramework } from "../../business-team-checkpoint-store.framework";
import { BusinessTeamEventBufferFramework } from "../../business-team-event-buffer.framework";
import { BusinessTeamLifecycleTransitionsFramework } from "../../business-team-lifecycle-transitions.framework";
import { BusinessTeamMissionStoreFramework } from "../../business-team-mission-store.framework";
import { BusinessTeamUpdateHelperFramework } from "../../business-team-update-helper.framework";
import { BusinessTeamPostmortemHelperFramework } from "../../business-team-postmortem-helper.framework";
import { BusinessTeamReportHelperFramework } from "../../business-team-report-helper.framework";
import type { CheckpointStoreHooks } from "../../abstractions/checkpoint-store.contract";
import type { EventBufferHooks } from "../../abstractions/event-buffer.contract";
import type { LifecycleTransitionHooks } from "../../abstractions/lifecycle-state-transitions.contract";
import type {
  MissionCreateBaseInput,
  MissionStoreHooks,
} from "../../abstractions/mission-store.contract";
import type {
  PostmortemHelperHooks,
  PostmortemListBase,
  PostmortemRecordBase,
} from "../../abstractions/postmortem-helper.contract";
import type {
  ReportHelperHooks,
  ReportVersionListItem,
} from "../../abstractions/report-helper.contract";
import type { UpdateHelperHooks } from "../../abstractions/update-helper.contract";

// ── 1. FakeMarsCheckpointStore ───────────────────────────────────────────────
export interface MarsCheckpointPayload {
  readonly mission: string;
  readonly stage: number;
}

export class FakeMarsCheckpointStore extends BusinessTeamCheckpointStoreFramework<MarsCheckpointPayload> {}

export function makeFakeMarsCheckpointHooks(
  initial?: Record<string, Record<string, unknown> | null>,
): CheckpointStoreHooks<MarsCheckpointPayload> & {
  store: Record<string, Record<string, unknown> | null>;
} {
  const store: Record<string, Record<string, unknown> | null> = {
    ...(initial ?? {}),
  };
  return {
    store,
    loadJsonContainer: jest.fn(
      async (missionId: string) => store[missionId] ?? null,
    ),
    upsertJsonKey: jest.fn(async (missionId, key, persisted) => {
      const j = store[missionId] ?? {};
      j[key] = persisted as unknown as Record<string, unknown>;
      store[missionId] = j;
    }),
    removeJsonKey: jest.fn(async (missionId, key) => {
      const j = store[missionId];
      if (!j) return;
      delete j[key];
    }),
    listRunningWithJson: jest.fn(async () =>
      Object.entries(store).map(([missionId, json]) => ({ missionId, json })),
    ),
  };
}

// ── 2. FakeMarsEventBuffer ───────────────────────────────────────────────────
export class FakeMarsEventBuffer extends BusinessTeamEventBufferFramework {}

export function makeFakeMarsEventBufferHooks(): EventBufferHooks & {
  persisted: Array<unknown>;
} {
  const persisted: Array<unknown> = [];
  return {
    adapterId: "fake-mars.mission-buffer",
    acceptsEvent: (t) => t.startsWith("mars."),
    persistEvent: jest.fn(async (e) => {
      persisted.push(e);
    }),
    fetchPersisted: jest.fn(async () => []),
    persisted,
  };
}

// ── 3. FakeMarsLifecycleTransitions ──────────────────────────────────────────
export interface MarsCompletedDetail {
  readonly tokens?: number;
  readonly report?: unknown;
}
export interface MarsFailedDetail {
  readonly errorMessage?: string;
  readonly report?: unknown;
}

export class FakeMarsLifecycleTransitions extends BusinessTeamLifecycleTransitionsFramework<
  MarsCompletedDetail,
  MarsFailedDetail
> {}

export function makeFakeMarsLifecycleHooks(options?: {
  affected?: number;
}): LifecycleTransitionHooks<MarsCompletedDetail, MarsFailedDetail> & {
  conditionalUpdate: jest.Mock;
  clearCheckpoint: jest.Mock;
  reopenTransaction: jest.Mock;
} {
  return {
    buildCompletedUpdate: jest.fn((d) => ({
      status: "completed",
      tokens: d.tokens,
    })),
    buildFailedUpdate: jest.fn((d) => ({
      update: { status: "failed", error: d.errorMessage },
    })),
    buildCancelledUpdate: jest.fn(() => ({ status: "cancelled" })),
    conditionalUpdate: jest.fn(async () => options?.affected ?? 1),
    clearCheckpoint: jest.fn(async () => undefined),
    reopenTransaction: jest.fn(async () => ({
      affected: 1,
      currentStatus: "running",
    })),
    reopenResetData: { errorMessage: null },
  };
}

// ── 4. FakeMarsMissionStore ──────────────────────────────────────────────────
export interface MarsCreateInput extends MissionCreateBaseInput {
  readonly mission: string;
}

export class FakeMarsMissionStore extends BusinessTeamMissionStoreFramework<MarsCreateInput> {}

export function makeFakeMarsMissionStoreHooks(
  overrides?: Partial<MissionStoreHooks<MarsCreateInput>>,
): MissionStoreHooks<MarsCreateInput> {
  return {
    loggerNamespace: "fake-mars-mission-store",
    createMission: jest.fn(async () => undefined),
    writeHeartbeat: jest.fn(async () => undefined),
    resetHeartbeat: jest.fn(async () => undefined),
    findOrphanRunning: jest.fn(async () => []),
    claimOrphanFailed: jest.fn(async () => true),
    writeStageProgress: jest.fn(async () => undefined),
    countRunning: jest.fn(async () => 0),
    isMissionRowMissing: jest.fn((err) => {
      const c = (err as { code?: string })?.code;
      return c === "P2003" || c === "P2025";
    }),
    emergencyAbort: jest.fn(() => undefined),
    ...overrides,
  };
}

// ── 5. FakeMarsUpdateHelper ──────────────────────────────────────────────────
export class FakeMarsUpdateHelper extends BusinessTeamUpdateHelperFramework {
  /** Expose runUpdate for tests. */
  public async testRunUpdate(
    ...args: Parameters<FakeMarsUpdateHelper["runUpdate"]>
  ): Promise<void> {
    return this.runUpdate(...args);
  }
  /** Expose resetFieldsFrameworkCore for tests. */
  public async testResetFields(
    ...args: Parameters<FakeMarsUpdateHelper["resetFieldsFrameworkCore"]>
  ): Promise<void> {
    return this.resetFieldsFrameworkCore(...args);
  }
}

export function makeFakeMarsUpdateHooks(): UpdateHelperHooks {
  return {
    updateManyByOwner: jest.fn(async () => undefined),
    updateAnyById: jest.fn(async () => undefined),
    loggerNamespace: "fake-mars-update",
  };
}

// ── 6. FakeMarsPostmortemHelper ──────────────────────────────────────────────
export interface MarsPostmortemRecord extends PostmortemRecordBase {
  readonly recommendations?: string[];
}
export interface MarsPostmortemListItem extends PostmortemListBase {
  readonly recommendations: string[];
}

export class FakeMarsPostmortemHelper extends BusinessTeamPostmortemHelperFramework<
  MarsPostmortemRecord,
  MarsPostmortemListItem
> {}

export function makeFakeMarsPostmortemHooks(opts?: {
  recentMissionId?: string | null;
  rowsSequence?: Array<readonly MarsPostmortemListItem[]>;
  embedding?: number[] | "throw" | null;
}): PostmortemHelperHooks<MarsPostmortemRecord, MarsPostmortemListItem> & {
  listCallCount: () => number;
} {
  let listCallIdx = 0;
  const sequence = opts?.rowsSequence ?? [[]];
  const list = jest.fn(async () => {
    const r = sequence[Math.min(listCallIdx, sequence.length - 1)];
    listCallIdx++;
    return r;
  });
  return {
    embeddingPort:
      opts?.embedding === undefined
        ? undefined
        : {
            generateEmbedding: jest.fn(async () => {
              if (opts.embedding === "throw") throw new Error("embed fail");
              if (opts.embedding == null) return null;
              return { embedding: opts.embedding };
            }),
          },
    createVectorMemory: jest.fn(async () => undefined),
    findRecentMissionId: jest.fn(async () => opts?.recentMissionId ?? null),
    listVectorMemories: list,
    loggerNamespace: "fake-mars-postmortem",
    listCallCount: () => listCallIdx,
  };
}

// ── 7. FakeMarsReportHelper ──────────────────────────────────────────────────
export interface MarsReportRow extends ReportVersionListItem {
  readonly mission: string;
}

export class FakeMarsReportHelper extends BusinessTeamReportHelperFramework<MarsReportRow> {}

export function makeFakeMarsReportHooks(opts?: {
  maxVersion?: number;
  rows?: MarsReportRow[];
}): ReportHelperHooks<MarsReportRow> {
  return {
    aggregateMaxVersion: jest.fn(async () => opts?.maxVersion ?? 0),
    createVersion: jest.fn(async () => undefined),
    runSerializable: jest.fn(async (fn) => fn({})),
    findVersion: jest.fn(
      async (_id, v) => (opts?.rows ?? []).find((r) => r.version === v) ?? null,
    ),
    listVersions: jest.fn(async () => opts?.rows ?? []),
    loggerNamespace: "fake-mars-report",
  };
}
