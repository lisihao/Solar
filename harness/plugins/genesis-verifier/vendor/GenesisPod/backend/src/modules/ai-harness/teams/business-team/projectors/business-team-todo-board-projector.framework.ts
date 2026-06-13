/**
 * business-team-todo-board-projector.framework.ts —— Generic todo-board
 * projection plumbing.
 *
 * 落地依据：projector-framework-lift-plan §3.2 (Phase A).
 *
 * 框架职责（"plumbing"）：
 *   1. Pre-allocate system-stage placeholder todos
 *   2. stage:started / stage.started → status pending → in_progress
 *   3. stage:completed / stage.completed → status done + endedAt
 *   4. stage:failed / stage.failed → status failed + endedAt
 *   5. Mission terminal cleanup（with mapTerminalStatus hook）
 *   6. Anchor sort by STAGE_ORDINAL + createdAt（with sortKeyForExtra hook）
 *   7. Builder utilities：upsert / evSuffix / getStepId / getString / getNumber
 *
 * App-specific（通过 hook 注入）：
 *   - systemStagePresets / makeSystemStageTodo / emptySentinel / loadedSentinel
 *   - handleBusinessEvent (chapter / publish / dim 等业务事件)
 *   - preAllocateExtras (per-platform / per-dim 预占)
 *   - sortKeyForExtra (platform / extra todo 锚位)
 *   - mapTerminalStatus (按业务语义定制 terminal cleanup)
 *   - resolveStepId (raw stepId → canonical stageId)
 *   - onStageTransitionApplied (narrative / audit 副作用)
 */

import {
  type BaseProjectorEvent,
  type BaseProjectorRow,
  type BaseStagePreset,
  type BaseTodoBoardEntry,
  type BuilderState,
  type TodoBoardEntryStatus,
} from "./abstractions/todo-board-projector.contract";

export abstract class BusinessTeamTodoBoardProjectorFramework<
  TEntry extends BaseTodoBoardEntry,
  TRow extends BaseProjectorRow,
  TSentinel,
  TPreset extends BaseStagePreset = BaseStagePreset,
> {
  // ── Required hooks ────────────────────────────────────────────────

  protected abstract systemStagePresets(): ReadonlyArray<TPreset>;
  protected abstract makeSystemStageTodo(preset: TPreset, ts: number): TEntry;
  protected abstract emptySentinel(): TSentinel;
  protected abstract loadedSentinel(items: TEntry[]): TSentinel;

  // ── Optional hooks ────────────────────────────────────────────────

  /** App-specific business event handler. Mutate state via upsert(); return value
   *  ignored (framework always continues to next event). */
  protected handleBusinessEvent?(
    state: BuilderState<TEntry>,
    ev: BaseProjectorEvent,
  ): void;

  /** Pre-allocate non-stage todos (e.g., per-platform for social). */
  protected preAllocateExtras?(
    row: TRow,
    missionCreatedAt: number,
    state: BuilderState<TEntry>,
  ): void;

  /** Custom sort key for non-system todos. Returns undefined → fallback to end. */
  protected sortKeyForExtra?(todo: TEntry): number | undefined;

  /** Map row.status → todo status when cleaning pending/in_progress at terminal.
   *  Default: completed→done; failed/cancelled/aborted/rejected→failed; else null. */
  protected mapTerminalStatus?(rowStatus: string): "done" | "failed" | null;

  /** Translate raw stepId (event payload) to canonical systemStageId before upsert.
   *  Default: identity. Subclasses can override to map raw IDs to display IDs. */
  protected resolveStepId?(rawStepId: string): string;

  /** Side-effect hook called after a stage transition has been applied (status
   *  / startedAt / endedAt set). Used for narrative logging, audit trail. */
  protected onStageTransitionApplied?(
    state: BuilderState<TEntry>,
    stageId: string,
    ts: number,
    transition: "started" | "completed" | "failed",
    ev: BaseProjectorEvent,
  ): void;

  // ── Framework entry ───────────────────────────────────────────────

  project(
    row: TRow | null,
    events: ReadonlyArray<BaseProjectorEvent>,
  ): TSentinel {
    if (!row) return this.emptySentinel();

    const state: BuilderState<TEntry> = { todos: new Map(), order: [] };
    const missionCreatedAt = this.parseStartedAt(row.startedAt);
    const presets = this.systemStagePresets();

    // 1. Pre-allocate system-stage placeholders
    for (const preset of presets) {
      this.upsert(state, `system:${preset.id}`, () =>
        this.makeSystemStageTodo(preset, missionCreatedAt),
      );
    }

    // 2. Pre-allocate extras
    this.preAllocateExtras?.(row, missionCreatedAt, state);

    // 3. Iterate events
    for (const ev of events) {
      const suffix = this.evSuffix(ev.type);
      const ts = ev.timestamp;
      const transition = STAGE_LIFECYCLE_SUFFIX[suffix];

      if (transition) {
        const rawStepId = this.getStepId(ev);
        if (!rawStepId) {
          // 没 stepId 让 app hook 兜底
          this.handleBusinessEvent?.(state, ev);
          continue;
        }
        const stageId = this.resolveStepId
          ? this.resolveStepId(rawStepId)
          : rawStepId;
        this.applyStageTransition(state, presets, stageId, ts, transition);
        this.onStageTransitionApplied?.(state, stageId, ts, transition, ev);
        continue;
      }

      // 非 stage lifecycle → 业务事件
      this.handleBusinessEvent?.(state, ev);
    }

    // 4. Terminal cleanup
    this.applyTerminalCleanup(state, row.status);

    // 5. Sort by anchor
    const items = this.sortByAnchor(state, presets);

    return this.loadedSentinel(items);
  }

  // ── Internal helpers (protected so subclasses can call) ────────────

  protected upsert(
    state: BuilderState<TEntry>,
    id: string,
    init: () => TEntry,
    mutate?: (t: TEntry) => void,
  ): TEntry {
    let cur = state.todos.get(id);
    if (!cur) {
      cur = init();
      state.todos.set(id, cur);
      state.order.push(id);
    }
    if (mutate) mutate(cur);
    return cur;
  }

  protected evSuffix(type: string): string {
    return type.includes(".") ? type.slice(type.indexOf(".") + 1) : type;
  }

  protected getStepId(ev: BaseProjectorEvent): string | null {
    const p = ev.payload as Record<string, unknown> | null;
    if (p && typeof p.stepId === "string") return p.stepId;
    return null;
  }

  protected getString(p: unknown, key: string): string | undefined {
    if (!p || typeof p !== "object") return undefined;
    const v = (p as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  }

  protected getNumber(p: unknown, key: string): number | undefined {
    if (!p || typeof p !== "object") return undefined;
    const v = (p as Record<string, unknown>)[key];
    return typeof v === "number" ? v : undefined;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private parseStartedAt(v: Date | string | null): number {
    if (v == null) return 0;
    if (typeof v === "string") return new Date(v).getTime();
    return v.getTime();
  }

  private applyStageTransition(
    state: BuilderState<TEntry>,
    presets: ReadonlyArray<TPreset>,
    stepId: string,
    ts: number,
    transition: "started" | "completed" | "failed",
  ): void {
    this.upsert(
      state,
      `system:${stepId}`,
      () => {
        const preset =
          presets.find((p) => p.id === stepId) ??
          ({ id: stepId, title: stepId } as TPreset);
        return this.makeSystemStageTodo(preset, ts);
      },
      (t) => {
        if (transition === "started") {
          if (t.status === "pending") t.status = "in_progress";
          if (!t.startedAt) t.startedAt = ts;
        } else if (transition === "completed") {
          t.status = "done";
          t.endedAt = ts;
        } else {
          t.status = "failed";
          t.endedAt = ts;
        }
      },
    );
  }

  private applyTerminalCleanup(
    state: BuilderState<TEntry>,
    rowStatus: string,
  ): void {
    const target: TodoBoardEntryStatus | null = this.mapTerminalStatus
      ? this.mapTerminalStatus(rowStatus)
      : this.defaultTerminalMap(rowStatus);
    if (!target) return;
    for (const t of state.todos.values()) {
      if (t.status === "pending" || t.status === "in_progress") {
        t.status = target;
      }
    }
  }

  private defaultTerminalMap(rowStatus: string): "done" | "failed" | null {
    if (rowStatus === "completed") return "done";
    if (
      rowStatus === "failed" ||
      rowStatus === "cancelled" ||
      rowStatus === "aborted" ||
      rowStatus === "rejected"
    ) {
      return "failed";
    }
    return null;
  }

  private sortByAnchor(
    state: BuilderState<TEntry>,
    presets: ReadonlyArray<TPreset>,
  ): TEntry[] {
    const ordinalMap: Record<string, number> = {};
    presets.forEach((p, idx) => {
      ordinalMap[p.id] = idx + 1;
    });
    const fallback = presets.length + 1;

    const all = state.order.map((id) => state.todos.get(id)!);
    return all.slice().sort((a, b) => {
      const ka = this.sortKey(a, ordinalMap, fallback);
      const kb = this.sortKey(b, ordinalMap, fallback);
      if (ka !== kb) return ka - kb;
      return a.createdAt - b.createdAt;
    });
  }

  private sortKey(
    t: TEntry,
    ordinalMap: Record<string, number>,
    fallback: number,
  ): number {
    if (t.scope === "system" && t.systemStageId) {
      return ordinalMap[t.systemStageId] ?? fallback;
    }
    const extra = this.sortKeyForExtra?.(t);
    if (extra != null) return extra;
    return fallback;
  }
}

const STAGE_LIFECYCLE_SUFFIX: Record<
  string,
  "started" | "completed" | "failed"
> = {
  "stage:started": "started",
  "stage.started": "started",
  "stage:completed": "completed",
  "stage.completed": "completed",
  "stage:failed": "failed",
  "stage.failed": "failed",
};
