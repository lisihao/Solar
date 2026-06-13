/**
 * BusinessAgentTeam — Lifecycle State Transitions contract (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-lifecycle.helper.ts
 *
 * 抽出 mission 状态机通用机制：
 *   - writeCompleted / writeCancelled / writeFailed —— 条件写 WHERE status='running' 首写者赢
 *   - markReopened —— failed/quality-failed → running 反向 transition（带事件 audit）
 *   - report payload 超限保护（hard limit 抛 PayloadTooLarge / soft limit warn truncate）
 *
 * 业务方注入：
 *   - mission 行 update / updateMany 接口（Prisma delegate 注入）
 *   - reopened 事件 emit 接口
 *   - 业务专属 completed / failed / cancelled 字段映射函数
 */

import type { MissionFailureCode } from "../../../../lifecycle/mission-lifecycle/abstractions/mission-failure";

/** Hard report payload 上限（10MB）—— 超出直接拒。 */
export const REPORT_HARD_LIMIT_BYTES = 10 * 1024 * 1024;
/** Soft report payload 上限（5MB）—— 超出 truncate fullMarkdown 末尾。 */
export const REPORT_SOFT_LIMIT_BYTES = 5 * 1024 * 1024;
/** errorMessage 截断（业务方实现侧约定）。 */
export const ERROR_MESSAGE_MAX = 2000;

/** Framework 接受的 reopened 白名单（业务方可覆盖）。 */
export const DEFAULT_REOPENABLE_STATUSES = [
  "failed",
  "quality-failed",
] as const;

/** Framework 通用 update 输入（业务方决定具体表 / 字段）。 */
export type UpdateData = Record<string, unknown>;

/**
 * 业务方提供的 lifecycle transitions hooks（机制 vs 业务）。
 *
 * @template TCompletedDetail business completed detail shape
 * @template TFailedDetail business failed detail shape
 */
export interface LifecycleTransitionHooks<TCompletedDetail, TFailedDetail> {
  /** 业务方负责把 completed detail → DB update payload。 */
  readonly buildCompletedUpdate: (detail: TCompletedDetail) => UpdateData;
  /** 业务方负责把 failed detail → DB update payload；返回 isLeadRefusal 用于 status 选择。 */
  readonly buildFailedUpdate: (detail: TFailedDetail) => {
    readonly update: UpdateData;
    readonly isLeadRefusal?: boolean;
    /** 实现侧返回的 effective failureCode（业务侧可能根据 isLeadRefusal 补 leader_signoff_rejected）。 */
    readonly effectiveFailureCode?: MissionFailureCode | null;
  };
  /** 业务方负责 cancelled update payload（通常含 errorMessage 提示）。 */
  readonly buildCancelledUpdate: () => UpdateData;
  /** 写 mission 行：where status='running'（+ optional userId）；返回 affected rows。 */
  readonly conditionalUpdate: (
    missionId: string,
    where: { readonly userId?: string },
    data: UpdateData,
  ) => Promise<number>;
  /** Checkpoint 清理（终态写完后调用）。 */
  readonly clearCheckpoint: (missionId: string) => Promise<void>;
  /** Reopen：原子地把 mission 从白名单状态搬回 running，并 emit reopened 事件。 */
  readonly reopenTransaction: (
    missionId: string,
    userId: string,
    allowedFromStatuses: readonly string[],
  ) => Promise<{
    readonly affected: number;
    readonly currentStatus: string | null;
  }>;
  /** Reopened 后的业务侧字段 reset shape（业务方决定哪些列 set null）。 */
  readonly reopenResetData: UpdateData;
  /** 可选覆盖白名单（默认 `failed` / `quality-failed`）。 */
  readonly reopenableStatuses?: readonly string[];
}
