/**
 * todo-board-stage-lifecycle.spec.ts —— 防 stage:lifecycle 回归（Screenshot_52）
 *
 * 根因复述：BusinessTeamMissionDispatcher emit 单事件 `stage:lifecycle` with
 * `payload.status="started"|"completed"|"failed"`。todo-board projector 之前
 * 只识别 split 形态（stage.started / stage:started 等），完全 miss 单事件 →
 * system stage todos 永远 status='pending' → UI 14 stage 行卡 "待启动"。
 *
 * 本 spec 验证 projector 正确处理 stage:lifecycle 单事件路径，避免再回归。
 */

import { projectTodoBoard } from "../todo-board.projector";
import type { MissionDetail } from "../../lifecycle/mission-store.service";

function fakeRow(): MissionDetail {
  return {
    id: "m-test",
    userId: "u-test",
    topic: "test",
    depth: "deep",
    language: "zh-CN",
    status: "running",
    startedAt: new Date("2026-05-27T00:00:00Z"),
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

describe("§ todo-board projector × stage:lifecycle (Screenshot_52 regression guard)", () => {
  it("stage:lifecycle status=started → system todo 转 in_progress + startedAt", () => {
    const out = projectTodoBoard(fakeRow(), [
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s2-leader-plan", status: "started" },
        timestamp: 1700000000000,
      },
    ]);
    expect(out.kind).toBe("todo-board");
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const s2 = items.find((t) => t.systemStageId === "s2-leader-plan");
    expect(s2).toBeDefined();
    expect(s2!.status).toBe("in_progress");
    expect(s2!.startedAt).toBe(1700000000000);
  });

  it("stage:lifecycle status=completed → system todo 转 done + endedAt", () => {
    const out = projectTodoBoard(fakeRow(), [
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s2-leader-plan", status: "started" },
        timestamp: 1700000000000,
      },
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s2-leader-plan", status: "completed" },
        timestamp: 1700000001000,
      },
    ]);
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const s2 = items.find((t) => t.systemStageId === "s2-leader-plan");
    expect(s2!.status).toBe("done");
    expect(s2!.endedAt).toBe(1700000001000);
  });

  it("stage:lifecycle status=failed → system todo 转 failed + error narrative", () => {
    const out = projectTodoBoard(fakeRow(), [
      {
        type: "playground.stage:lifecycle",
        payload: {
          stepId: "s5-reconciler",
          status: "failed",
          error: "LLM timeout",
        },
        timestamp: 1700000000000,
      },
    ]);
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const s5 = items.find((t) => t.systemStageId === "s5-reconciler");
    expect(s5!.status).toBe("failed");
    expect(s5!.endedAt).toBe(1700000000000);
    // narrative 包含 error 文本
    const errorNarr = s5!.narrativeLog.find((n) => n.text === "LLM timeout");
    expect(errorNarr).toBeDefined();
    expect(errorNarr!.tone).toBe("error");
  });

  it("已 done 不被重复 started 事件回退（status 状态机只前进）", () => {
    const out = projectTodoBoard(fakeRow(), [
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s2-leader-plan", status: "completed" },
        timestamp: 1700000001000,
      },
      // 之后又来一个 started（rerun 等场景）—— in_progress upsert 仅在 status===pending
      // 时生效，已 done 的不回退
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s2-leader-plan", status: "started" },
        timestamp: 1700000002000,
      },
    ]);
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const s2 = items.find((t) => t.systemStageId === "s2-leader-plan");
    expect(s2!.status).toBe("done"); // 维持 done，未回退
  });

  it("旧 split 形态（stage:started）兼容路径仍正常（fixture / legacy）", () => {
    const out = projectTodoBoard(fakeRow(), [
      {
        type: "playground.stage:started",
        payload: { stepId: "s2-leader-plan" },
        timestamp: 1700000000000,
      },
    ]);
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const s2 = items.find((t) => t.systemStageId === "s2-leader-plan");
    expect(s2!.status).toBe("in_progress");
  });

  it("cancelled mission 但持久化产物证明 s1-s8 跑完 → 即便事件全被 evict 仍显 done（Screenshot_29 额度耗尽回归）", () => {
    // 生产实证 mission 06be38c5：多轮重跑后 MissionEventBuffer FIFO 把**所有** stage
    // 事件挤掉（此处传 [] 模拟全 evict），但 row 里 themeSummary/reconciliationReport/
    // analystOutput/outlinePlan/reportFull 全在（s1-s8 实际跑完），verdicts(s9)/
    // leaderSigned(s10) 缺。改用产物 high-water 后，s1-s8 应显 done 而非满屏红。
    const row = fakeRow();
    Object.assign(row as Record<string, unknown>, {
      status: "cancelled",
      themeSummary: "算力负载预测",
      dimensions: [{ id: "d1", name: "硬件" }],
      reconciliationReport: { gaps: [] },
      analystOutput: { insights: [] },
      outlinePlan: { chapterOutlines: [] },
      reportFull: { content: {}, sections: [] },
      verdicts: null,
      leaderSigned: false,
    });
    const out = projectTodoBoard(row, []); // 事件全 evict
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const byStage = (id: string) => items.find((t) => t.systemStageId === id);
    // 产物 high-water = s8-writer-draft（reportFull 存在）→ s1..s8 全 done
    for (const id of [
      "s1-budget",
      "s2-leader-plan",
      "s3-researchers",
      "s4-leader-assess",
      "s5-reconciler",
      "s6-analyst",
      "s7-writer-outline",
      "s8-writer-draft",
    ]) {
      expect(byStage(id)!.status).toBe("done");
    }
    // high-water 之上（verdicts/签字 缺）→ 维持 pending，前端按 cancelled 终态扫成灰
    expect(byStage("s9-critic-l4")!.status).toBe("pending");
    expect(byStage("s10-leader-signoff")!.status).toBe("pending");
    expect(byStage("s11-persist")!.status).toBe("pending");
  });

  it("quality-failed mission（此前不匹配任何分支，gap#1）→ 产物证明的 s1-s8 仍 done", () => {
    // quality-failed = leader 拒签/质量闸门未过，是终态但既非 completed 也非 failed。
    // 重构前它不匹配 projector 任何分支 → 零补偿 → 满屏红。统一后按产物 high-water 收尾。
    const row = fakeRow();
    Object.assign(row as Record<string, unknown>, {
      status: "quality-failed",
      themeSummary: "算力负载预测",
      reconciliationReport: { gaps: [] },
      analystOutput: { insights: [] },
      outlinePlan: { chapterOutlines: [] },
      reportFull: { content: {}, sections: [] },
      verdicts: null,
      leaderSigned: false,
    });
    const out = projectTodoBoard(row, []); // 事件全 evict
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const byStage = (id: string) => items.find((t) => t.systemStageId === id);
    for (const id of [
      "s1-budget",
      "s2-leader-plan",
      "s3-researchers",
      "s4-leader-assess",
      "s5-reconciler",
      "s6-analyst",
      "s7-writer-outline",
      "s8-writer-draft",
    ]) {
      expect(byStage(id)!.status).toBe("done");
    }
    expect(byStage("s9-critic-l4")!.status).toBe("pending");
  });

  it("running mission + 早期事件被 evict（gap#2）→ 产物补 done，但保留 live in_progress 不回退", () => {
    const row = fakeRow();
    Object.assign(row as Record<string, unknown>, {
      status: "running",
      themeSummary: "x",
      reconciliationReport: {},
      analystOutput: {},
      outlinePlan: {},
      reportFull: { content: {}, sections: [] }, // high-water = s8
    });
    // 早期 s1-s8 事件已 evict（缺失），只剩 s9 的 live started 事件：
    const out = projectTodoBoard(row, [
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s9-critic", status: "started" },
        timestamp: 1700000009000,
      },
    ]);
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const byStage = (id: string) => items.find((t) => t.systemStageId === id);
    // 产物补偿：s1-s8 pending → done（即便 running）
    expect(byStage("s1-budget")!.status).toBe("done");
    expect(byStage("s8-writer-draft")!.status).toBe("done");
    // live 阶段不回退：s9 维持 in_progress（high-water 之上，运行中不动）
    expect(byStage("s9-critic-l4")!.status).toBe("in_progress");
    // s10+ 仍 pending（既无产物也无事件）
    expect(byStage("s10-leader-signoff")!.status).toBe("pending");
  });

  it("completed mission + 维度 todo 事件被 evict（gap#6）→ 维度显 done 而非灰 cancelled", () => {
    const row = fakeRow();
    (row as { status: string }).status = "completed";
    // 维度 todo 由事件创建为 in_progress（completed 事件被 evict）；主维度 origin=leader-plan
    const out = projectTodoBoard(row, [
      {
        type: "playground.dimension:research:started",
        payload: { dimension: "硬件产能与供应链天花板" },
        timestamp: 1700000003000,
      },
    ]);
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const dim = items.find((t) => t.dimensionRef === "硬件产能与供应链天花板");
    expect(dim).toBeDefined();
    // completed mission 的主维度 → done（不再 blanket 扫成 cancelled）
    expect(dim!.status).toBe("done");
  });

  it("failed mission 早期失败、无任何持久化产物 → 不误补任何 stage 为 done", () => {
    const row = fakeRow();
    (row as { status: string }).status = "failed";
    const out = projectTodoBoard(row, [
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s1-budget", status: "failed", error: "余额不足" },
        timestamp: 1700000000000,
      },
    ]);
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const byStage = (id: string) => items.find((t) => t.systemStageId === id);
    expect(byStage("s1-budget")!.status).toBe("failed");
    // 无产物 high-water（artifactHighWater=-1）→ 不补任何 done，s2+ 维持 pending
    expect(byStage("s2-leader-plan")!.status).toBe("pending");
    expect(byStage("s6-analyst")!.status).toBe("pending");
  });

  it("step-id 映射：s3-researcher-collect → s3-researchers（mapStepToFrontendStage）", () => {
    const out = projectTodoBoard(fakeRow(), [
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s3-researcher-collect", status: "started" },
        timestamp: 1700000000000,
      },
    ]);
    const items = out.kind === "todo-board" ? (out.items ?? []) : [];
    const s3 = items.find((t) => t.systemStageId === "s3-researchers");
    expect(s3).toBeDefined();
    expect(s3!.status).toBe("in_progress");
  });
});
