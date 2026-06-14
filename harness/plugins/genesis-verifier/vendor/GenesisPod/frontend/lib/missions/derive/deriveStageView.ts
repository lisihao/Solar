/**
 * deriveStageView — Stage progression 投影（canonical 派生层）
 *
 * 蓝图 §9.6：各 feature 内部 stage 模型不同（playground 5 阶段、social N 阶段、
 * radar 流水线 stage），这里给一个 canonical 形态用于通用 StageStepper / stage
 * progression UI。
 *
 * 输入：feature 已经派生好的 stage list（各 feature 的字符串 status 不同）
 * 输出：归一化的 StageView[]
 *
 * 纯函数，无副作用、无 React 依赖。
 */

/** Stage canonical 状态（与 StageStepper / 各 feature StageStatus 共通） */
export type CanonicalStageStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

export interface StageView {
  /** stage 唯一 id（feature 内部使用） */
  id: string;
  /** 短名（用于 stepper 格子标题） */
  short: string;
  /** canonical 状态 */
  status: CanonicalStageStatus;
  /** 详细文本（如 "3/5 dimensions complete"） */
  detail?: string;
  /** 顺序 index（feature 之间不可比，仅 feature 内部排序用） */
  order?: number;
}

/** Feature 喂进来的最小 stage 契约。 */
export interface StageDeriveInput {
  id: string;
  short?: string;
  /** feature 内部字符串状态 */
  status: string;
  detail?: string;
}

/**
 * 把 feature 内部 stage list 归一化成 canonical StageView[]。
 *
 * 字符串状态归一：
 *   - done / completed / success → done
 *   - running / in_progress / active → running
 *   - failed / error / rejected → failed
 *   - skipped → skipped
 *   - 其余 → pending
 */
export function deriveStageView(input: StageDeriveInput[]): StageView[] {
  return input.map((s, idx) => ({
    id: s.id,
    short: s.short ?? s.id,
    status: normalizeStageStatus(s.status),
    detail: s.detail,
    order: idx,
  }));
}

function normalizeStageStatus(raw: string): CanonicalStageStatus {
  const v = raw.toLowerCase();
  if (v === 'done' || v === 'completed' || v === 'success') return 'done';
  if (v === 'running' || v === 'in_progress' || v === 'active')
    return 'running';
  if (v === 'failed' || v === 'error' || v === 'rejected') return 'failed';
  if (v === 'skipped') return 'skipped';
  return 'pending';
}

/** stage list 整体进度（done / total） */
export function stageProgress(stages: StageView[]): {
  done: number;
  total: number;
  ratio: number;
} {
  const total = stages.length;
  const done = stages.filter((s) => s.status === 'done').length;
  return {
    done,
    total,
    ratio: total > 0 ? done / total : 0,
  };
}
