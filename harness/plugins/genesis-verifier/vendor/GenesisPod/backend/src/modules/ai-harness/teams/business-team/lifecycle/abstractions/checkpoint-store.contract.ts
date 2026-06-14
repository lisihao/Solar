/**
 * BusinessAgentTeam — Mission Checkpoint Store contract (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/prisma-mission-checkpoint.store.ts
 *
 * 抽出 checkpoint 持久化通用契约。业务方注入：
 *   - JSON 字段读写策略（mission 表 / 独立表均可）
 *   - completedKeys / status shape（与 MissionCheckpointSnapshot 对齐）
 *   - reserved JSON key（默认 `__checkpoint`，业务可改）
 *
 * Framework 提供机制：
 *   - save 失败计数 + degraded 阈值（默认 3 次）
 *   - savedAt ISO 解析容错（NaN 视作无效 checkpoint）
 *   - listResumable 应用层 cutoff 过滤
 */
import type { MissionCheckpointSnapshot } from "../../../../memory/mission-checkpoint/checkpoint-store.interface";

/** 默认 reserved JSON key（业务可在 hooks.reservedKey 覆盖）。 */
export const DEFAULT_CHECKPOINT_KEY = "__checkpoint";

/** 默认 degraded 阈值（连续 save 失败 N 次后视为退化）。 */
export const DEFAULT_DEGRADED_THRESHOLD = 3;

/**
 * Framework 持久化形状（按 ISO string 保存以避免 JSON Date 漂移）。
 */
export interface PersistedCheckpoint<TPayload> {
  readonly savedAt: string;
  readonly payload: TPayload;
  readonly completedKeys: readonly string[];
  readonly status: MissionCheckpointSnapshot["status"];
}

/** 业务方提供的 checkpoint store IO hooks（机制 vs 业务）。 */
export interface CheckpointStoreHooks<TPayload> {
  /** 业务专属 reserved key（默认 `__checkpoint`）。 */
  readonly reservedKey?: string;
  /** 业务专属 degraded 阈值（默认 3）。 */
  readonly degradedThreshold?: number;
  /** 读：返回该 mission 的 reserved JSON 容器（business 表 / 字段抽象）。 */
  readonly loadJsonContainer: (
    missionId: string,
  ) => Promise<Record<string, unknown> | null>;
  /** 写：atomic upsert reserved key 到 JSON 容器（业务方负责 SQL）。 */
  readonly upsertJsonKey: (
    missionId: string,
    key: string,
    persisted: PersistedCheckpoint<TPayload>,
  ) => Promise<void>;
  /** 删：从 JSON 容器移除 reserved key。 */
  readonly removeJsonKey: (missionId: string, key: string) => Promise<void>;
  /** 列出该用户 status=running 的 mission 与其 JSON 容器（用于 listResumable）。 */
  readonly listRunningWithJson: (userId: string) => Promise<
    Array<{
      readonly missionId: string;
      readonly json: Record<string, unknown> | null;
    }>
  >;
}
