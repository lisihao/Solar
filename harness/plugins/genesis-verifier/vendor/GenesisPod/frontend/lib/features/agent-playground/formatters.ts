/**
 * agent-playground 格式化工具函数 — 单一来源
 *
 * 所有 playground 组件的数字/时间格式化必须从这里导入，禁止组件内重复定义。
 */

// ─── 金额 (USD) ─────────────────────────────────────────

/** 精简 USD 格式：$0 / $0.0001 / $0.001 / $0.003 */
export function fmtUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.001) return `$${n.toFixed(5)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

// ─── Tokens ──────────────────────────────────────────────

/** 紧凑 token 数：1234 → "1.2k"，1234567 → "1.23M" */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// ─── 延迟 / 耗时 ─────────────────────────────────────────

/** 工具延迟：0ms / 123ms / 1.2s / 1m 23s */
export function fmtLatency(ms: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** 两个时间戳之间的持续时长（用于 stage/agent 卡片）*/
export function fmtDuration(startedAt?: number, endedAt?: number): string {
  if (!startedAt) return '—';
  const end = endedAt ?? Date.now();
  const ms = end - startedAt;
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** wall-clock 总耗时（ms → 可读字符串，用于 CapabilityMeters 等宏观显示） */
export function fmtWallTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

/** 时间戳（毫秒） → HH:MM:SS（用于事件流时间轴） */
export function fmtTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

/** 相对偏移时间（用于 TodoDetailDrawer 事件轴 anchor 对齐） */
export function fmtRelative(ts: number, anchor: number): string {
  const ms = ts - anchor;
  if (ms < 0) return fmtTimestamp(ts);
  if (ms < 1000) return `+${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `+${m}m ${rs}s`;
}

// ─── 评分阈值 ────────────────────────────────────────────

/** 评分颜色：>=80 绿 / >=60 橙 / <60 红 */
export function scoreColor(s: number): string {
  if (s >= 80) return 'text-emerald-600';
  if (s >= 60) return 'text-amber-600';
  return 'text-red-600';
}

/** 评分进度条颜色（深色 bar fill）：>=80 绿 / >=60 橙 / <60 红 */
export function scoreBgColor(s: number): string {
  if (s >= 80) return 'bg-emerald-400';
  if (s >= 60) return 'bg-amber-400';
  return 'bg-red-400';
}

/** 评分容器背景色（浅色 100 shade，用于图标背景）：>=80 绿 / >=60 橙 / <60 红 */
export function scoreBgLight(s: number): string {
  if (s >= 80) return 'bg-emerald-100';
  if (s >= 60) return 'bg-amber-100';
  return 'bg-red-100';
}

// ─── Stage / Role 标签 ───────────────────────────────────

/** 5 大 stage 的中文/英文标签（同时服务 CostBreakdownPanel、ComputeUsagePanel） */
export const STAGE_LABEL: Record<string, string> = {
  leader: 'Leader',
  researchers: 'Researchers',
  reconciler: 'Reconciler',
  analyst: 'Analyst',
  writer: 'Writer',
  reviewer: 'Reviewer',
  critic: 'Critic',
};

/** Agent role → 展示标签（同时服务 ComputeUsagePanel、MissionFlowView） */
export const ROLE_LABEL: Record<string, string> = {
  leader: 'Leader',
  researcher: 'Researcher',
  analyst: 'Analyst',
  writer: 'Writer',
  reviewer: 'Reviewer',
  critic: 'Critic',
  reconciler: 'Reconciler',
  mission: 'Mission',
};
