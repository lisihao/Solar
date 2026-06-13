/**
 * todo-board-projector.contract.ts —— Base shapes consumed by
 * BusinessTeamTodoBoardProjectorFramework.
 *
 * App-specific projectors define their TEntry / TRow / TSentinel extending
 * these bases. The framework operates generically on the base shape.
 */

export type TodoBoardEntryStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "failed"
  | "cancelled"
  | "blocked";

/** Minimal shape every concrete todo board entry must satisfy. */
export interface BaseTodoBoardEntry {
  id: string;
  origin: string;
  scope: string;
  status: TodoBoardEntryStatus;
  title: string;
  systemStageId?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

/** Stage preset = ordered placeholder slot for a system stage. */
export interface BaseStagePreset {
  id: string;
  title: string;
}

/** Mission row shape needed by the framework. App rows extend this. */
export interface BaseProjectorRow {
  status: string;
  startedAt: Date | string | null;
}

/** Source event shape (mission events the framework consumes). */
export interface BaseProjectorEvent {
  type: string;
  payload: unknown;
  timestamp: number;
  agentId?: string;
}

/** Mutable in-progress projection state owned by the framework. */
export interface BuilderState<TEntry> {
  todos: Map<string, TEntry>;
  /** Insertion order — used as tie-breaker in sort. */
  order: string[];
}
