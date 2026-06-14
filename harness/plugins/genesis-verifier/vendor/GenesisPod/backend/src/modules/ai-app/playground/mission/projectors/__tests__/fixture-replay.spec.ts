/**
 * fixture-replay.spec.ts —— Fixture replay catalog spec
 *
 * 落地依据：thinning plan §B1-3 / §6.8 / §B2-4 / §6.8.1.b
 *
 * 当前状态（2026-05-26，P0-4 完成后）：
 * 9 类 fixture 全部 materialize（6 单点 + 3 组合态）：
 *   单点（§6.8.1）：playground-completed / -failed / -quality-failed / -cancelled
 *                    / -resumable / -reopened
 *   组合态（§6.8.1.b）：playground-partial-failure-mid-run /
 *                       -multi-stage-rerun-in-flight / -multi-agent-retry
 *
 * 断言走 listMaterializedFixtures（loadFixture 自动跳过 PLACEHOLDER.md）。
 * 投影对比通过 projectMissionView() 输出对照 expected-view.json。
 */

import {
  KNOWN_FIXTURE_IDS,
  listMaterializedFixtures,
  loadFixture,
  type FixtureBundle,
} from "../../../../../../__tests__/fixtures/mission/types";
import {
  TERMINAL_MISSION_STATUSES,
  type MissionStatus,
} from "../../../api/contracts/view-state.contract";
import type { MissionDetail } from "../../lifecycle/mission-store.service";
import type { MissionQueryInputs } from "../../query/mission-query.service";
import { projectMissionView } from "../mission-view.projector";

describe("§6.8 fixture catalog", () => {
  it("KNOWN_FIXTURE_IDS 覆盖 6 单点 + 3 组合态 = 9 类（§6.8.1 + §6.8.1.b）", () => {
    expect(KNOWN_FIXTURE_IDS).toHaveLength(9);
    expect(KNOWN_FIXTURE_IDS).toEqual(
      expect.arrayContaining([
        "playground-completed",
        "playground-failed",
        "playground-quality-failed",
        "playground-cancelled",
        "playground-reopened",
        "playground-resumable",
        "playground-partial-failure-mid-run",
        "playground-multi-stage-rerun-in-flight",
        "playground-multi-agent-retry",
      ]),
    );
  });

  it("至少 1 个 fixture 已 materialize（B1-2 reference fixture）", () => {
    const materialized = listMaterializedFixtures();
    expect(materialized.length).toBeGreaterThanOrEqual(1);
    expect(materialized).toContain("playground-completed");
  });
});

describe("§6.8 materialized fixture 形状一致性", () => {
  const materialized = listMaterializedFixtures();

  it.each(materialized)("[%s] meta.kind 必声明（§6.8.4.b mandatory）", (id) => {
    const bundle = loadFixture(id);
    expect(bundle.meta.kind).toMatch(
      /^(real-anonymized|synthetic|benchmark|stress)$/,
    );
  });

  it.each(materialized)(
    "[%s] mission-row 与 expected-view 的 mission.id 一致",
    (id) => {
      const bundle = loadFixture(id);
      expect(bundle.expectedView.mission.id).toBe(bundle.missionRow.id);
    },
  );

  it.each(materialized)(
    "[%s] expected-view.mission.status 在 §6.4.1 允许集合内",
    (id) => {
      const bundle = loadFixture(id);
      const allowed: ReadonlySet<MissionStatus> = new Set([
        "starting",
        "running",
        "completed",
        "failed",
        "cancelled",
        "quality-failed",
      ]);
      expect(allowed.has(bundle.expectedView.mission.status)).toBe(true);
    },
  );

  it.each(materialized)(
    "[%s] terminal status 必伴随 resumable=false（除非 reopened/resumable 类显式覆盖）",
    (id) => {
      const bundle = loadFixture(id);
      const isTerminal = TERMINAL_MISSION_STATUSES.has(
        bundle.expectedView.mission.status,
      );
      if (
        isTerminal &&
        id !== "playground-resumable" &&
        id !== "playground-reopened"
      ) {
        expect(bundle.expectedView.mission.resumable).toBe(false);
      }
    },
  );

  it.each(materialized)("[%s] events seq 严格单调递增", (id) => {
    const bundle = loadFixture(id);
    for (let i = 1; i < bundle.events.length; i++) {
      expect(bundle.events[i].seq).toBeGreaterThan(bundle.events[i - 1].seq);
    }
  });

  it.each(materialized)(
    "[%s] events 数 ≤ 50 除非 meta 标 benchmark/stress（§6.8.4.b limit）",
    (id) => {
      const bundle = loadFixture(id);
      const isBenchmark =
        bundle.meta.kind === "benchmark" || bundle.meta.kind === "stress";
      if (!isBenchmark) {
        expect(bundle.events.length).toBeLessThanOrEqual(50);
      }
    },
  );
});

describe("§B2-4 projector replay", () => {
  const materialized = listMaterializedFixtures();

  it.each(materialized)(
    "[%s] projectMissionView 输出与 expected-view 关键字段一致",
    (id) => {
      const bundle = loadFixture(id);
      const inputs = bundleToInputs(bundle);
      const actual = projectMissionView(inputs);

      // mission 核心字段
      expect(actual.mission.id).toBe(bundle.expectedView.mission.id);
      expect(actual.mission.status).toBe(bundle.expectedView.mission.status);
      expect(actual.mission.title).toBe(bundle.expectedView.mission.title);
      expect(actual.mission.failureCode ?? null).toBe(
        bundle.expectedView.mission.failureCode ?? null,
      );
      expect(actual.mission.reportArtifactVersion ?? null).toBe(
        bundle.expectedView.mission.reportArtifactVersion ?? null,
      );

      // stages 数量 + 顺序锁定为 14
      expect(actual.stages).toHaveLength(14);
      expect(actual.stages.map((s) => s.id)).toEqual(
        bundle.expectedView.stages.map((s) => s.id),
      );

      // 每个 stage 的 status 必与 expected 一致
      for (let i = 0; i < actual.stages.length; i++) {
        expect(actual.stages[i].status).toBe(
          bundle.expectedView.stages[i].status,
        );
      }

      // cost 核心字段
      expect(actual.cost?.currency).toBe("USD");
      expect(actual.cost?.costUsd).toBe(bundle.expectedView.cost?.costUsd);

      // sentinel 形状
      expect(actual.reportArtifact).toMatchObject({ kind: expect.any(String) });
      expect(actual.todoBoard).toMatchObject({ kind: expect.any(String) });
    },
  );

  // P0-3：TodoBoard 实质 port 后的行为锁定
  it.each(materialized)(
    "[%s] todoBoard 含 14 个 system-stage placeholder（mission:started 预占语义）",
    (id) => {
      const bundle = loadFixture(id);
      const inputs = bundleToInputs(bundle);
      const view = projectMissionView(inputs);
      const board = view.todoBoard;
      expect(board?.kind).toBe("todo-board");
      const items = board?.items ?? [];
      const systemStageTodos = items.filter((t) => t.scope === "system");
      expect(systemStageTodos).toHaveLength(14);
      // 14 个 system-stage 标准 id 必须都在
      const stageIds = systemStageTodos.map((t) => t.systemStageId).sort();
      expect(stageIds).toEqual(
        [
          "s1-budget",
          "s2-leader-plan",
          "s3-researchers",
          "s4-leader-assess",
          "s5-reconciler",
          "s6-analyst",
          "s7-writer-outline",
          "s8-writer-draft",
          "s8b-quality-enhancement",
          "s9-critic-l4",
          "s9b-objective-evaluation",
          "s10-leader-signoff",
          "s11-persist",
          "s12-self-evolution",
        ].sort(),
      );
    },
  );

  it.each(materialized)(
    "[%s] todoBoard isFirstCutTruncated = false（P0-3 后核心 case 已 port）",
    (id) => {
      const bundle = loadFixture(id);
      const inputs = bundleToInputs(bundle);
      const view = projectMissionView(inputs);
      expect(view.todoBoard?.isFirstCutTruncated).toBe(false);
    },
  );

  it.each(materialized)(
    "[%s] todoBoard entry 必填字段（assignee / narrativeLog / artifacts / createdBy / reasonText）",
    (id) => {
      const bundle = loadFixture(id);
      const inputs = bundleToInputs(bundle);
      const view = projectMissionView(inputs);
      const items = view.todoBoard?.items ?? [];
      for (const item of items) {
        expect(item.assignee).toMatchObject({ role: expect.any(String) });
        expect(Array.isArray(item.narrativeLog)).toBe(true);
        expect(Array.isArray(item.artifacts)).toBe(true);
        expect(typeof item.createdBy).toBe("string");
        expect(typeof item.reasonText).toBe("string");
      }
    },
  );

  it("benchmark: 500 event synthetic fixture 投影 < 200ms (§B2-4 第 4 条)", () => {
    const events = Array.from({ length: 500 }, (_, i) => ({
      type: "playground.stage.started",
      payload: { stepId: "s5-reconciler" },
      timestamp: 1700000000000 + i,
    }));

    const benchmarkRow: MissionDetail = synthesizeMinimalMissionDetail();
    const inputs: MissionQueryInputs = {
      mode: "row-loaded",
      missionId: benchmarkRow.id,
      row: benchmarkRow,
      events,
      resume: { resumable: false, reason: "benchmark" },
      rerunnableStages: [],
      reportVersions: [],
      composedArtifact: {
        kind: "empty-artifact",
        reason: "not-yet-materialized",
      },
    };

    const t0 = Date.now();
    const view = projectMissionView(inputs);
    const elapsed = Date.now() - t0;

    expect(view.timelineVersion).toBe(500);
    // §10.3 p95 < 200ms 是 staging endpoint gate；纯 projector 远低于此
    expect(elapsed).toBeLessThan(200);
  });
});

// ============================================================================
// helpers
// ============================================================================

function bundleToInputs(bundle: FixtureBundle): MissionQueryInputs {
  const row = synthesizeMissionDetailFromFixture(bundle);
  return {
    mode: "row-loaded",
    missionId: bundle.missionRow.id,
    row,
    events: bundle.events.map((e) => ({
      type: e.type,
      payload: e.payload,
      timestamp: new Date(e.timestamp).getTime(),
    })),
    resume: {
      resumable: bundle.expectedView.mission.resumable,
      reason: undefined,
    },
    rerunnableStages: bundle.expectedView.mission.rerunnableStages,
    reportVersions: [],
    composedArtifact: {
      kind: "empty-artifact",
      reason: "not-yet-materialized",
    },
  };
}

function synthesizeMissionDetailFromFixture(
  bundle: FixtureBundle,
): MissionDetail {
  // fixture mission-row.json 只含 projector 真正读的字段子集；其余 MissionDetail 字段
  // 填合理默认。projector 不读未列出字段，cast 安全。
  const r = bundle.missionRow;
  return {
    id: r.id,
    userId: r.userId,
    topic: r.topic ?? "",
    depth: r.depth ?? "",
    language: r.language ?? "",
    status: r.status,
    startedAt: new Date(r.startedAt),
    completedAt: r.completedAt ? new Date(r.completedAt) : null,
    elapsedWallTimeMs:
      (r.elapsedWallTimeMs as number | null | undefined) ?? null,
    finalScore: r.finalScore ?? null,
    tokensUsed: r.tokensUsed != null ? Number(r.tokensUsed) : null,
    costUsd: r.costUsd ?? null,
    reportTitle: r.reportTitle ?? null,
    reportSummary: r.reportSummary ?? null,
    errorMessage: r.errorMessage ?? null,
    terminalOutcome: deriveTerminalOutcome(r.status),
    failureCode: r.failureCode ?? null,
    configSnapshot: r.configSnapshot ?? null,
    maxCredits: (r.maxCredits as number | null | undefined) ?? null,
    themeSummary: r.themeSummary ?? null,
    dimensions: r.dimensions ?? null,
    reportFull: r.reportFull ?? null,
    verdicts: null,
    trajectoryStored: null,
    reportArtifactVersion: r.reportArtifactVersion ?? null,
    userProfile: null,
    reconciliationReport: null,
    leaderJournal: null,
    leaderOverallScore: null,
    leaderSigned: r.status === "completed" ? true : null,
    leaderVerdict: null,
    lastCompletedStage: null,
    outlinePlan: null,
    analystOutput: null,
    heartbeatAt: null,
    visibility: "PRIVATE",
  } as unknown as MissionDetail;
}

function synthesizeMinimalMissionDetail(): MissionDetail {
  return {
    id: "bench-0001",
    userId: "bench-user",
    topic: "benchmark",
    depth: "standard",
    language: "zh-CN",
    status: "running",
    startedAt: new Date(),
    completedAt: null,
    elapsedWallTimeMs: null,
    finalScore: null,
    tokensUsed: null,
    costUsd: null,
    reportTitle: null,
    reportSummary: null,
    errorMessage: null,
    terminalOutcome: null,
    failureCode: null,
    configSnapshot: null,
    maxCredits: 300,
    themeSummary: null,
    dimensions: null,
    reportFull: null,
    verdicts: null,
    trajectoryStored: null,
    reportArtifactVersion: null,
    userProfile: null,
    reconciliationReport: null,
    leaderJournal: null,
    leaderOverallScore: null,
    leaderSigned: null,
    leaderVerdict: null,
    lastCompletedStage: null,
    outlinePlan: null,
    analystOutput: null,
    heartbeatAt: null,
    visibility: "PRIVATE",
  } as unknown as MissionDetail;
}

function deriveTerminalOutcome(status: string): string | null {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "rejected":
      return "quality-failed";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}
