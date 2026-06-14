/**
 * business-team-todo-board-projector.framework.spec.ts
 *
 * 覆盖框架的 plumbing 不变量（与 radar / social / playground 业务 hook 解耦）：
 *   1. project(null, []) → emptySentinel
 *   2. row 存在 → 预占 stage placeholders（status=pending, systemStageId 对齐）
 *   3. stage:started / stage.started → pending → in_progress + startedAt
 *   4. stage:completed → status done + endedAt
 *   5. stage:failed → status failed + endedAt
 *   6. mission terminal (completed / failed / cancelled / aborted / rejected) 收尾
 *   7. mapTerminalStatus override 生效
 *   8. preAllocateExtras + sortKeyForExtra 生效
 *   9. handleBusinessEvent 接管非 stage 事件
 *  10. anchor sort: system 按 ordinal，extra 按 sortKeyForExtra
 */

import { BusinessTeamTodoBoardProjectorFramework } from "../business-team-todo-board-projector.framework";
import type {
  BaseProjectorEvent,
  BaseStagePreset,
  BaseTodoBoardEntry,
  BuilderState,
  TodoBoardEntryStatus,
} from "../abstractions/todo-board-projector.contract";

// ── Test fixture: 最小 subclass ────────────────────────────────────────

interface TestEntry extends BaseTodoBoardEntry {
  /** test-only field for sortKeyForExtra coverage */
  extraAnchor?: number;
}

interface TestRow {
  status: string;
  startedAt: Date | string | null;
}

type TestSentinel =
  | { kind: "empty"; items?: undefined }
  | { kind: "loaded"; items: TestEntry[] };

const TEST_PRESETS: ReadonlyArray<BaseStagePreset> = [
  { id: "s1-alpha", title: "Alpha" },
  { id: "s2-beta", title: "Beta" },
  { id: "s3-gamma", title: "Gamma" },
];

function makeProjector(
  overrides: {
    preAllocateExtras?: (
      row: TestRow,
      ts: number,
      state: BuilderState<TestEntry>,
    ) => void;
    sortKeyForExtra?: (todo: TestEntry) => number | undefined;
    handleBusinessEvent?: (
      state: BuilderState<TestEntry>,
      ev: BaseProjectorEvent,
    ) => void;
    mapTerminalStatus?: (rowStatus: string) => "done" | "failed" | null;
  } = {},
) {
  class TestProjector extends BusinessTeamTodoBoardProjectorFramework<
    TestEntry,
    TestRow,
    TestSentinel
  > {
    protected systemStagePresets() {
      return TEST_PRESETS;
    }
    protected makeSystemStageTodo(preset: BaseStagePreset, ts: number) {
      return {
        id: `system:${preset.id}`,
        origin: "system-stage",
        scope: "system",
        status: "pending" as TodoBoardEntryStatus,
        title: preset.title,
        systemStageId: preset.id,
        createdAt: ts,
      };
    }
    protected emptySentinel(): TestSentinel {
      return { kind: "empty" };
    }
    protected loadedSentinel(items: TestEntry[]): TestSentinel {
      return { kind: "loaded", items };
    }
    protected preAllocateExtras = overrides.preAllocateExtras;
    protected sortKeyForExtra = overrides.sortKeyForExtra;
    protected handleBusinessEvent = overrides.handleBusinessEvent;
    protected mapTerminalStatus = overrides.mapTerminalStatus;
  }
  return new TestProjector();
}

const ROW: TestRow = {
  status: "running",
  startedAt: new Date("2026-05-27T00:00:00Z"),
};

// ── Tests ──────────────────────────────────────────────────────────────

describe("§ BusinessTeamTodoBoardProjectorFramework", () => {
  it("(1) null row → emptySentinel", () => {
    const out = makeProjector().project(null, []);
    expect(out.kind).toBe("empty");
  });

  it("(2) row + 无事件 → 预占 3 个 stage placeholder（status=pending）", () => {
    const out = makeProjector().project(ROW, []);
    expect(out.kind).toBe("loaded");
    if (out.kind !== "loaded") throw new Error("unreachable");
    expect(out.items).toHaveLength(3);
    expect(out.items.map((t) => t.systemStageId)).toEqual([
      "s1-alpha",
      "s2-beta",
      "s3-gamma",
    ]);
    expect(out.items.every((t) => t.status === "pending")).toBe(true);
  });

  it("(3) stage:started → pending → in_progress + startedAt", () => {
    const out = makeProjector().project(ROW, [
      {
        type: "x.stage:started",
        payload: { stepId: "s1-alpha" },
        timestamp: 100,
      },
    ]);
    if (out.kind !== "loaded") throw new Error("unreachable");
    const t = out.items.find((x) => x.systemStageId === "s1-alpha")!;
    expect(t.status).toBe("in_progress");
    expect(t.startedAt).toBe(100);
  });

  it("(3b) DOT variant stage.started 同样生效", () => {
    const out = makeProjector().project(ROW, [
      {
        type: "x.stage.started",
        payload: { stepId: "s2-beta" },
        timestamp: 200,
      },
    ]);
    if (out.kind !== "loaded") throw new Error("unreachable");
    const t = out.items.find((x) => x.systemStageId === "s2-beta")!;
    expect(t.status).toBe("in_progress");
  });

  it("(4) stage:completed → done + endedAt", () => {
    const out = makeProjector().project(ROW, [
      {
        type: "x.stage:started",
        payload: { stepId: "s1-alpha" },
        timestamp: 100,
      },
      {
        type: "x.stage:completed",
        payload: { stepId: "s1-alpha" },
        timestamp: 200,
      },
    ]);
    if (out.kind !== "loaded") throw new Error("unreachable");
    const t = out.items.find((x) => x.systemStageId === "s1-alpha")!;
    expect(t.status).toBe("done");
    expect(t.endedAt).toBe(200);
  });

  it("(5) stage:failed → failed + endedAt", () => {
    const out = makeProjector().project(ROW, [
      {
        type: "x.stage:failed",
        payload: { stepId: "s3-gamma" },
        timestamp: 300,
      },
    ]);
    if (out.kind !== "loaded") throw new Error("unreachable");
    const t = out.items.find((x) => x.systemStageId === "s3-gamma")!;
    expect(t.status).toBe("failed");
    expect(t.endedAt).toBe(300);
  });

  it("(6a) terminal=completed → 所有 pending/in_progress 转 done", () => {
    const row: TestRow = { ...ROW, status: "completed" };
    const out = makeProjector().project(row, []);
    if (out.kind !== "loaded") throw new Error("unreachable");
    expect(out.items.every((t) => t.status === "done")).toBe(true);
  });

  it("(6b) terminal=failed/cancelled/aborted/rejected → 转 failed", () => {
    for (const s of ["failed", "cancelled", "aborted", "rejected"]) {
      const row: TestRow = { ...ROW, status: s };
      const out = makeProjector().project(row, []);
      if (out.kind !== "loaded") throw new Error(`unreachable for ${s}`);
      expect(out.items.every((t) => t.status === "failed")).toBe(true);
    }
  });

  it("(6c) terminal cleanup 不回退已 done 的 todo", () => {
    const row: TestRow = { ...ROW, status: "failed" };
    const out = makeProjector().project(row, [
      {
        type: "x.stage:completed",
        payload: { stepId: "s1-alpha" },
        timestamp: 100,
      },
    ]);
    if (out.kind !== "loaded") throw new Error("unreachable");
    const t = out.items.find((x) => x.systemStageId === "s1-alpha")!;
    expect(t.status).toBe("done"); // 不被覆盖为 failed
  });

  it("(7) mapTerminalStatus override 生效（playground rejected → done）", () => {
    const proj = makeProjector({
      mapTerminalStatus: (s) => (s === "rejected" ? "done" : null),
    });
    const row: TestRow = { ...ROW, status: "rejected" };
    const out = proj.project(row, []);
    if (out.kind !== "loaded") throw new Error("unreachable");
    expect(out.items.every((t) => t.status === "done")).toBe(true);
  });

  it("(8) preAllocateExtras + sortKeyForExtra 生效", () => {
    const proj = makeProjector({
      preAllocateExtras: (_row, ts, state) => {
        state.todos.set("extra:foo", {
          id: "extra:foo",
          origin: "extra",
          scope: "extra",
          status: "pending",
          title: "Extra Foo",
          createdAt: ts,
          extraAnchor: 1.5, // 锚到 s1 后 s2 前
        });
        state.order.push("extra:foo");
      },
      sortKeyForExtra: (t) => t.extraAnchor,
    });
    const out = proj.project(ROW, []);
    if (out.kind !== "loaded") throw new Error("unreachable");
    expect(out.items.map((t) => t.id)).toEqual([
      "system:s1-alpha", // ord 1
      "extra:foo", // 1.5
      "system:s2-beta", // ord 2
      "system:s3-gamma", // ord 3
    ]);
  });

  it("(9) handleBusinessEvent 接管非 stage 事件", () => {
    const captured: BaseProjectorEvent[] = [];
    const proj = makeProjector({
      handleBusinessEvent: (_state, ev) => {
        captured.push(ev);
      },
    });
    proj.project(ROW, [
      {
        type: "x.publish:executed",
        payload: { platform: "wechat" },
        timestamp: 100,
      },
      {
        type: "x.stage:started",
        payload: { stepId: "s1-alpha" },
        timestamp: 200,
      },
    ]);
    expect(captured).toHaveLength(1);
    expect(captured[0].type).toBe("x.publish:executed");
  });

  it("(10) anchor sort: system 按 ordinal", () => {
    const out = makeProjector().project(ROW, [
      // 故意乱序 emit
      {
        type: "x.stage:started",
        payload: { stepId: "s3-gamma" },
        timestamp: 100,
      },
      {
        type: "x.stage:started",
        payload: { stepId: "s1-alpha" },
        timestamp: 200,
      },
      {
        type: "x.stage:started",
        payload: { stepId: "s2-beta" },
        timestamp: 300,
      },
    ]);
    if (out.kind !== "loaded") throw new Error("unreachable");
    expect(out.items.map((t) => t.systemStageId)).toEqual([
      "s1-alpha",
      "s2-beta",
      "s3-gamma",
    ]);
  });

  it("(11) 缺失 preset 的 stepId 自动建 placeholder（title=stepId fallback）", () => {
    const out = makeProjector().project(ROW, [
      {
        type: "x.stage:started",
        payload: { stepId: "s4-unknown" },
        timestamp: 100,
      },
    ]);
    if (out.kind !== "loaded") throw new Error("unreachable");
    const t = out.items.find((x) => x.systemStageId === "s4-unknown")!;
    expect(t.status).toBe("in_progress");
    expect(t.title).toBe("s4-unknown");
  });

  it("(12a) resolveStepId 把 raw stepId 翻译成 canonical stageId", () => {
    class MappingProjector extends BusinessTeamTodoBoardProjectorFramework<
      TestEntry,
      TestRow,
      TestSentinel
    > {
      protected systemStagePresets() {
        return TEST_PRESETS;
      }
      protected makeSystemStageTodo(preset: BaseStagePreset, ts: number) {
        return {
          id: `system:${preset.id}`,
          origin: "system-stage",
          scope: "system",
          status: "pending" as TodoBoardEntryStatus,
          title: preset.title,
          systemStageId: preset.id,
          createdAt: ts,
        };
      }
      protected emptySentinel(): TestSentinel {
        return { kind: "empty" };
      }
      protected loadedSentinel(items: TestEntry[]): TestSentinel {
        return { kind: "loaded", items };
      }
      // raw "s1-raw" → "s1-alpha"
      protected resolveStepId(raw: string): string {
        return raw === "s1-raw" ? "s1-alpha" : raw;
      }
    }
    const out = new MappingProjector().project(ROW, [
      {
        type: "x.stage:started",
        payload: { stepId: "s1-raw" },
        timestamp: 100,
      },
    ]);
    if (out.kind !== "loaded") throw new Error("unreachable");
    const t = out.items.find((x) => x.systemStageId === "s1-alpha")!;
    expect(t.status).toBe("in_progress");
  });

  it("(12b) onStageTransitionApplied 在 status 变更后被调用", () => {
    const captured: Array<{
      stageId: string;
      transition: string;
      hasStatusUpdated: boolean;
    }> = [];
    class HookProjector extends BusinessTeamTodoBoardProjectorFramework<
      TestEntry,
      TestRow,
      TestSentinel
    > {
      protected systemStagePresets() {
        return TEST_PRESETS;
      }
      protected makeSystemStageTodo(preset: BaseStagePreset, ts: number) {
        return {
          id: `system:${preset.id}`,
          origin: "system-stage",
          scope: "system",
          status: "pending" as TodoBoardEntryStatus,
          title: preset.title,
          systemStageId: preset.id,
          createdAt: ts,
        };
      }
      protected emptySentinel(): TestSentinel {
        return { kind: "empty" };
      }
      protected loadedSentinel(items: TestEntry[]): TestSentinel {
        return { kind: "loaded", items };
      }
      protected onStageTransitionApplied(
        state: BuilderState<TestEntry>,
        stageId: string,
        _ts: number,
        transition: "started" | "completed" | "failed",
      ): void {
        const t = state.todos.get(`system:${stageId}`);
        captured.push({
          stageId,
          transition,
          hasStatusUpdated: t?.status !== "pending",
        });
      }
    }
    new HookProjector().project(ROW, [
      {
        type: "x.stage:started",
        payload: { stepId: "s1-alpha" },
        timestamp: 100,
      },
      {
        type: "x.stage:completed",
        payload: { stepId: "s1-alpha" },
        timestamp: 200,
      },
    ]);
    expect(captured).toEqual([
      { stageId: "s1-alpha", transition: "started", hasStatusUpdated: true },
      { stageId: "s1-alpha", transition: "completed", hasStatusUpdated: true },
    ]);
  });

  it("(13) startedAt as ISO string 也正确 parse", () => {
    const row: TestRow = { ...ROW, startedAt: "2026-05-27T00:00:00Z" };
    const out = makeProjector().project(row, []);
    if (out.kind !== "loaded") throw new Error("unreachable");
    expect(out.items.every((t) => t.createdAt > 0)).toBe(true);
  });
});

it("(14) it.each fallback was unused — placeholder removed", () => {
  // sentinel test to prove the suite ran
  expect(TEST_PRESETS).toHaveLength(3);
});
