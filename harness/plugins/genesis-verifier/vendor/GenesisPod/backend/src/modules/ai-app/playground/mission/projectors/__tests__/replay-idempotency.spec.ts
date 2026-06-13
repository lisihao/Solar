/**
 * replay-idempotency.spec.ts —— Replay 幂等不变量（ARCHITECTURE_RULES §6 / 硬规则 #5）
 *
 * 规则：projectMissionView(events) 对相同 events 多次调用必须 deep-equal。
 *   - 跑 1 次 → 跑 2 次 → 跑 5 次，三次输出必须完全一致
 *   - 任何"projector 把累计状态写在自己 closure / module-level Map" 都会被这个 spec 抓到
 *   - 是 §6.1 durability 关键不变量
 *
 * 用现成的 fixture catalog 输入。
 */

import {
  listMaterializedFixtures,
  loadFixture,
  type FixtureBundle,
} from "../../../../../../__tests__/fixtures/mission/types";
import type { MissionDetail } from "../../lifecycle/mission-store.service";
import type { MissionQueryInputs } from "../../query/mission-query.service";
import { projectMissionView } from "../mission-view.projector";

function synthesizeMissionDetailFromFixture(
  bundle: FixtureBundle,
): MissionDetail {
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
    terminalOutcome: r.status === "completed" ? "completed" : null,
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

function bundleToInputs(bundle: FixtureBundle): MissionQueryInputs {
  return {
    mode: "row-loaded",
    missionId: bundle.missionRow.id,
    row: synthesizeMissionDetailFromFixture(bundle),
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

/**
 * 深度比较两个 view（忽略 Date 对象差异，turn into ISO）。
 * 用 JSON serialize 做粗略比较 —— 字段顺序差异导致的误判由 jest 的 toEqual 处理。
 */
function freeze(view: unknown): string {
  return JSON.stringify(view, (_k, v) => {
    if (v instanceof Map) return Array.from(v.entries());
    if (v instanceof Set) return Array.from(v.values());
    if (v instanceof Date) return v.toISOString();
    return v;
  });
}

describe("§ replay idempotency —— projector × N replays must be deep-equal", () => {
  const materialized = listMaterializedFixtures();

  it("发现 fixture 集合非空（防 spec 自身退化）", () => {
    expect(materialized.length).toBeGreaterThan(0);
  });

  it.each(materialized)(
    "[%s] 5 次重放 projectMissionView 输出完全一致（不变量）",
    (id) => {
      const bundle = loadFixture(id);
      const inputs = bundleToInputs(bundle);
      const v1 = freeze(projectMissionView(inputs));
      const v2 = freeze(projectMissionView(inputs));
      const v3 = freeze(projectMissionView(inputs));
      const v4 = freeze(projectMissionView(inputs));
      const v5 = freeze(projectMissionView(inputs));
      expect(v2).toBe(v1);
      expect(v3).toBe(v1);
      expect(v4).toBe(v1);
      expect(v5).toBe(v1);
    },
  );

  it.each(materialized)(
    "[%s] 事件流复制（events ⊕ events）展示形态稳定（partial-prefix 不影响最终态对 events 集合敏感的字段）",
    (id) => {
      const bundle = loadFixture(id);
      const inputs = bundleToInputs(bundle);

      const v1 = projectMissionView(inputs);

      // events × 2 复制 —— 实际生产不会发生，但作为侵入性测试发现"projector
      // 把 chapter / agent push 进数组而非 find-or-create" 的回归。
      const doubled = {
        ...inputs,
        events: [...inputs.events, ...inputs.events],
      };
      const v2 = projectMissionView(doubled);

      // chapter 数 / agent 数不应翻倍（idempotency invariant by chapterIndex / agentId）
      for (const [dim, pipe] of Object.entries(v1.dimensionPipelines ?? {})) {
        const pipe2 = v2.dimensionPipelines?.[dim];
        expect(pipe2).toBeDefined();
        expect(pipe2.chapters.length).toBe(pipe.chapters.length);
      }
      expect(v2.agents.length).toBe(v1.agents.length);
    },
  );
});
