/**
 * deriveMissionView — Mission summary 投影（canonical 派生层）
 *
 * 蓝图 §9.6：把"事件流 / persisted snapshot → mission summary"派生成 P28+
 * 各 feature（playground / social / radar / writing / topic-insights / office）
 * 可复用的最小投影。
 *
 * 实现策略：本文件**不重新扫事件**，而是接受 feature 自己已经派生好的"完整 view"
 * （例：playground 的 deriveView(events).mission），把其中 mission summary 部分
 * 标准化成 canonical 形态。这样：
 *   - 不重复 1000+ 行的事件 reducer（playground/social 已各有一份成熟版本）
 *   - 给 P28 提供稳定的"mission summary"读取接口（feature 内部 derive 改动不破协议）
 *   - 纯函数，无 React 依赖，可单测
 */

/**
 * Mission 状态枚举（canonical 6 态）。各 feature 内部如有更细 status，需在
 * 自己的 derive 内 collapse 到这 6 态再传过来。
 */
export type CanonicalMissionStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'quality-failed';

/**
 * Mission summary canonical 形态。所有字段都 optional —— feature 阶段不一定能
 * 提供，view shell 渲染时按可见性优雅 fallback。
 */
export interface MissionView {
  /** mission 唯一 id（DB row id） */
  missionId: string;
  /** 用户输入的主题 / mission 名称 */
  topic?: string;
  /** 状态 */
  status: CanonicalMissionStatus;
  /** epoch ms */
  startedAt?: number;
  /** epoch ms — completed/failed/cancelled 任一时间 */
  finishedAt?: number;
  /** 失败 / 取消的原因（人读） */
  failureMessage?: string;
  /** Mission 最终评分（如适用） */
  finalScore?: number;
}

/**
 * Feature 派生结果中 mission summary 必备字段的最小契约。
 * 各 feature 实际的 mission 对象通常更大，这里只取 canonical 关心的字段。
 */
export interface MissionDeriveInput {
  missionId: string;
  topic?: string;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  cancelledAt?: number;
  failedMessage?: string;
  finalScore?: number;
  /** feature 自己的 status 字符串（如 playground 的 starting/running/quality-failed/...） */
  status?: string;
}

/**
 * 把 feature 内部 mission 摘要投影成 canonical MissionView。
 *
 * 时间归一：startedAt 来自输入；finishedAt 取 completedAt / failedAt / cancelledAt 第一个非空。
 * 状态归一：优先看显式终态时间戳，否则读 status 字符串。
 */
export function deriveMissionView(input: MissionDeriveInput): MissionView {
  const finishedAt =
    input.completedAt ?? input.failedAt ?? input.cancelledAt ?? undefined;

  const status = resolveStatus(input);

  return {
    missionId: input.missionId,
    topic: input.topic,
    status,
    startedAt: input.startedAt,
    finishedAt,
    failureMessage: input.failedMessage,
    finalScore: input.finalScore,
  };
}

function resolveStatus(input: MissionDeriveInput): CanonicalMissionStatus {
  // 显式状态字符串优先（feature 自己已 reduce 好的真值）
  if (input.status === 'quality-failed') return 'quality-failed';
  if (input.status === 'cancelled' || input.cancelledAt) return 'cancelled';
  if (
    input.status === 'failed' ||
    input.status === 'rejected' ||
    input.failedAt
  ) {
    return 'failed';
  }
  if (input.status === 'completed' || input.completedAt) return 'completed';
  if (input.status === 'starting' && !input.startedAt) return 'starting';
  return 'running';
}

/** mission 是否已经到达终态（不再活跃） */
export function isMissionTerminal(view: MissionView): boolean {
  return (
    view.status === 'completed' ||
    view.status === 'failed' ||
    view.status === 'cancelled' ||
    view.status === 'quality-failed'
  );
}

/** mission 是否在跑（含 starting / running） */
export function isMissionRunning(view: MissionView): boolean {
  return view.status === 'starting' || view.status === 'running';
}
