/**
 * todo-board-critic-verdict.spec.ts —— 防 critic 批评刷屏 + 全"已放弃"回归（IMG_9111-9113）
 *
 * 根因复述：projector 原先对 critic:verdict.warnings[] 逐条建独立 todo（origin
 * critic-blindspot, status in_progress），导致 L4 一次复审出 N 条意见 = 任务板 N 个
 * 独立任务刷屏；且它们永不被"完成"，mission 收尾一律扫成 cancelled → 全部"已放弃"。
 *
 * 本 spec 验证：critic:verdict 聚合为单一 todo，N 条意见落 narrativeLog，状态随
 * verdict 落终态（不再刷屏、不再被收尾扫成 cancelled）。
 */

import { projectTodoBoard } from "../todo-board.projector";
import type { MissionDetail } from "../../lifecycle/mission-store.service";

function fakeRow(status = "completed"): MissionDetail {
  return {
    id: "m-test",
    userId: "u-test",
    topic: "test",
    depth: "deep",
    language: "zh-CN",
    status,
    startedAt: new Date("2026-06-11T00:00:00Z"),
    completedAt: new Date("2026-06-11T01:00:00Z"),
    maxCredits: 300,
    visibility: "PRIVATE",
  } as unknown as MissionDetail;
}

const criticEvent = (
  warnings: unknown[],
  verdict = "concerns",
  ts = 1700000000000,
) => ({
  type: "playground.critic:verdict",
  payload: {
    verdict,
    overall: verdict,
    blindspotCount: 2,
    biasCount: 1,
    suggestionCount: 1,
    rationale: "样本理由",
    warnings,
  },
  timestamp: ts,
});

const sampleWarnings = [
  { kind: "l4-blindspot", message: "缺少存储成本分析", severity: "warning" },
  { kind: "l4-blindspot", message: "未覆盖 Google TPU / AWS Trainium", severity: "warning" },
  { kind: "l4-bias", message: "措辞偏乐观", severity: "warning" },
  { kind: "l4-suggestion", message: "补充时间线", severity: "info" },
];

function criticTodos(out: ReturnType<typeof projectTodoBoard>) {
  const items = out.kind === "todo-board" ? (out.items ?? []) : [];
  return items.filter((t) => t.origin === "critic-blindspot");
}

describe("§ todo-board projector × critic:verdict 聚合（IMG_9111-9113 regression guard）", () => {
  it("N 条 warning → 仅 1 个聚合 todo（不再逐条刷屏）", () => {
    const out = projectTodoBoard(fakeRow(), [criticEvent(sampleWarnings)]);
    const todos = criticTodos(out);
    expect(todos).toHaveLength(1);
    // N 条意见落在单个 todo 的 narrativeLog
    expect(todos[0].narrativeLog).toHaveLength(sampleWarnings.length);
  });

  it("verdict=concerns → 落终态 done，mission 收尾后不被扫成 cancelled（不再'已放弃'）", () => {
    const out = projectTodoBoard(fakeRow("completed"), [
      criticEvent(sampleWarnings, "concerns"),
    ]);
    const todos = criticTodos(out);
    expect(todos[0].status).toBe("done");
  });

  it("verdict=fail → 落 failed（而非 cancelled/已放弃）", () => {
    const out = projectTodoBoard(fakeRow("completed"), [
      criticEvent(sampleWarnings, "fail"),
    ]);
    const todos = criticTodos(out);
    expect(todos[0].status).toBe("failed");
  });

  it("空 warnings → 不建 critic todo", () => {
    const out = projectTodoBoard(fakeRow(), [criticEvent([])]);
    expect(criticTodos(out)).toHaveLength(0);
  });

  it("s9-critic 重跑（两次 critic:verdict）→ 仍只 1 条，最新一次覆盖（IMG_9114）", () => {
    const firstRun = criticEvent(sampleWarnings.slice(0, 2), "concerns", 1700000000000);
    // 重跑：不同时间戳 + 不同 verdict/意见数
    const rerun = criticEvent(sampleWarnings, "fail", 1700000009999);
    const out = projectTodoBoard(fakeRow("completed"), [firstRun, rerun]);
    const todos = criticTodos(out);
    // 稳定 id → 重跑更新同一条，不新增第二条
    expect(todos).toHaveLength(1);
    // 反映最新一次复审：verdict=fail → failed，意见数 = 重跑的 4 条
    expect(todos[0].status).toBe("failed");
    expect(todos[0].narrativeLog).toHaveLength(sampleWarnings.length);
    expect(todos[0].endedAt).toBe(1700000009999);
  });
});
