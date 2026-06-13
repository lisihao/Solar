/**
 * Mission fixture bundle types and loader（B1-2）
 *
 * 单一源：本文件是 fixture 形状 + loader 入口。fixture-replay.spec.ts 与 B2 projector 测试
 * 必须从这里导入，禁止直接读 JSON。
 *
 * 落地依据：
 *   docs/architecture/ai-app/playground/agent-team-thinning-plan-2026-05-26.md
 *   §6.8 / §6.8.1.b / §6.8.4.b
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

import type { PlaygroundDomainView } from "../../../modules/ai-app/playground/api/contracts/view-state.contract";

// ============================================================================
// Known fixture ids（§6.8.1 + §6.8.1.b）
// ============================================================================

export const KNOWN_FIXTURE_IDS = [
  // single-point §6.8.1
  "playground-completed",
  "playground-failed",
  "playground-quality-failed",
  "playground-cancelled",
  "playground-reopened",
  "playground-resumable",
  // combined-state §6.8.1.b
  "playground-partial-failure-mid-run",
  "playground-multi-stage-rerun-in-flight",
  "playground-multi-agent-retry",
] as const;

export type FixtureId = (typeof KNOWN_FIXTURE_IDS)[number];

// ============================================================================
// Fixture file shapes
// ============================================================================

/**
 * 锚定到 §6.8.4.b：每个 fixture 必须声明 kind。
 * benchmark/stress 标签解锁 >50 events 限制（§6.8.4.b "Fixture limits" rule 2）。
 */
export interface FixtureMeta {
  kind: "real-anonymized" | "synthetic" | "benchmark" | "stress";
  source?: string;
  capturedAt?: string;
  note?: string;
}

/**
 * mission-row.json 形状（partial AgentPlaygroundMission 列）。
 * fixture loader 不做 schema 校验——projector 在 B2 实际跑时若字段缺失会显式 fail。
 */
export interface FixtureMissionRow {
  id: string;
  userId: string;
  status: string;
  topic?: string;
  depth?: string;
  language?: string;
  startedAt: string;
  completedAt?: string | null;
  finalScore?: number | null;
  reportTitle?: string | null;
  reportSummary?: string | null;
  errorMessage?: string | null;
  failureCode?: string | null;
  reportArtifactVersion?: number | null;
  reportFull?: unknown;
  reportFullUri?: string | null;
  reportFullSize?: number | null;
  dimensions?: unknown;
  themeSummary?: string | null;
  configSnapshot?: unknown;
  userProfile?: unknown;
  /** electionState / committedModelIds / reservations 显式不暴露给 view, 但 row dump 含此字段（§6.3 line 963-969）。 */
  electionState?: unknown;
  [k: string]: unknown;
}

/**
 * events.json 单条事件形状。
 * 完整 schema 锚定到 `GET /playground/replay/:missionId` 返回（§6.8 admission rule 3）。
 */
export interface FixtureEvent {
  seq: number;
  type: string;
  timestamp: string;
  payload: unknown;
}

/**
 * checkpoint.json 形状。legacy mission 直接写 `{ kind: "legacy-null" }`。
 */
export type FixtureCheckpoint =
  | { kind: "legacy-null" }
  | { kind: "config-snapshot"; snapshot: unknown };

/**
 * 完整 fixture bundle。
 */
export interface FixtureBundle {
  id: FixtureId;
  meta: FixtureMeta;
  missionRow: FixtureMissionRow;
  events: FixtureEvent[];
  checkpoint: FixtureCheckpoint | null;
  expectedView: PlaygroundDomainView;
}

// ============================================================================
// Loader
// ============================================================================

const FIXTURE_ROOT = __dirname;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

/**
 * 加载单个 fixture bundle。
 * 不存在的 fixture 抛错——避免静默漏测。
 */
export function loadFixture(id: FixtureId): FixtureBundle {
  const dir = join(FIXTURE_ROOT, id);

  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) {
    throw new Error(
      `[fixtures/mission] ${id}/meta.json missing. ` +
        `Per §6.8.4.b every fixture must declare kind in meta.json.`,
    );
  }

  const meta = readJson<FixtureMeta>(metaPath);
  const missionRow = readJson<FixtureMissionRow>(join(dir, "mission-row.json"));
  const events = readJson<FixtureEvent[]>(join(dir, "events.json"));
  const expectedView = readJson<PlaygroundDomainView>(
    join(dir, "expected-view.json"),
  );

  const checkpointPath = join(dir, "checkpoint.json");
  const checkpoint = existsSync(checkpointPath)
    ? readJson<FixtureCheckpoint>(checkpointPath)
    : null;

  return { id, meta, missionRow, events, checkpoint, expectedView };
}

/**
 * 列出实际已落盘的 fixture（用于 fixture-replay.spec.ts 遍历）。
 * KNOWN_FIXTURE_IDS 中尚未落盘的 fixture 不会被加载——避免 B1 阶段把
 * 8 个 placeholder 当真 fixture 跑挂测试。
 */
export function listMaterializedFixtures(): FixtureId[] {
  return KNOWN_FIXTURE_IDS.filter((id) =>
    existsSync(join(FIXTURE_ROOT, id, "expected-view.json")),
  );
}
