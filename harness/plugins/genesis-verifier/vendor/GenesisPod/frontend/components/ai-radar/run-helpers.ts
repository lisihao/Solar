/**
 * AI Radar mission 详情页公用 helpers —— STAGE_GROUPS（含 agent 角色）+
 * stage 状态计算 + format / status 文案。
 *
 * 由 /ai-radar/topic/[id]/runs/[runId] 页面 和 StageTaskDrawer 共享。
 */

import type { RadarRun, RadarRunStatus } from '@/services/ai-radar/types';

// ──────────────────────────────────────────────────────────────────────
// Stage groups (5 visible groups = 5 Agent roles)
// ──────────────────────────────────────────────────────────────────────

export type StageMetricKey =
  | 'itemsFetched'
  | 'itemsDeduped'
  | 'itemsInserted'
  | 'itemsAccepted'
  | 'sourcesAttempted'
  | 'sourcesFailed';

export interface StageGroup {
  id: string;
  label: string;
  hint: string;
  /** 对应 raw stage 字符串前缀（mission emit 的 stage 名） */
  stages: ReadonlyArray<string>;
  /** stage 在 mission lifecycle 中的编号（1-8） */
  stageNumStart: number;
  stageNumEnd: number;
  /** 该 stage 由哪个 agent 角色负责 */
  agent: {
    role: string;
    name: string;
    description: string;
    /** 是否调 LLM —— 决定是否显示模型列 */
    usesLLM: boolean;
  };
  /** 该 stage 完成后写入 metrics 的字段（用于子指标展示） */
  metricKey?: StageMetricKey;
  metricLabel?: string;
}

export const STAGE_GROUPS: ReadonlyArray<StageGroup> = [
  {
    id: 'collect',
    label: '采集源数据',
    hint: '从每个数据源拉取原始 item（RSS / YouTube / 自定义 URL），并验证可达性',
    stages: ['s1-source-resolve', 's2-collect'],
    stageNumStart: 1,
    stageNumEnd: 2,
    agent: {
      role: 'collector',
      name: 'Source Collector',
      description:
        '解析数据源 URL，按各源协议（RSS/YouTube/HTTP）拉取原始 item',
      usesLLM: false,
    },
    metricKey: 'itemsFetched',
    metricLabel: '抓取条数',
  },
  {
    id: 'dedupe',
    label: '去重',
    hint: '相同 URL / 内容哈希的 item 合并，避免重复推送',
    stages: ['s3-dedupe'],
    stageNumStart: 3,
    stageNumEnd: 3,
    agent: {
      role: 'deduper',
      name: 'Deduper',
      description: '对抓取到的 item 按 URL / 内容哈希去重',
      usesLLM: false,
    },
    // R10.5 2026-05-19: 修语义混淆 —— 旧 metricKey=itemsDeduped 实际是"被
    // 去重移除的重复数"，前台展示为"去重后剩余"产生 user 困惑。改用
    // itemsInserted 反映"进入评分阶段的剩余 item 数"（= 真正的 dedup 之后）。
    metricKey: 'itemsInserted',
    metricLabel: '去重后剩余',
  },
  {
    id: 'score',
    label: '评分（相关性 + 质量）',
    hint: 'LLM 打两个分：是否相关、质量高低；低分 item 不入候选',
    stages: ['s4-relevance', 's5-quality'],
    stageNumStart: 4,
    stageNumEnd: 5,
    agent: {
      role: 'scorer',
      name: 'Relevance & Quality Scorer',
      description: '调 LLM 对每条 item 打"相关性"+"质量"两维度分',
      usesLLM: true,
    },
  },
  {
    id: 'enrich',
    label: '实体抽取 + 洞察',
    hint: 'LLM 抽出人/公司/产品/事件实体，对照历史生成洞察',
    stages: ['s6-entity', 's7-insight'],
    stageNumStart: 6,
    stageNumEnd: 7,
    agent: {
      role: 'enricher',
      name: 'Enrichment Analyst',
      description: '调 LLM 抽实体、对照历史生成洞察 signal',
      usesLLM: true,
    },
  },
  {
    id: 'finalize',
    label: '生成精选 + 持久化',
    hint: '从候选挑出 N 条今日精选，写入 daily briefing',
    stages: ['s8-persist'],
    stageNumStart: 8,
    stageNumEnd: 8,
    agent: {
      role: 'persister',
      name: 'Persister',
      description: '挑出 N 条今日精选，落库到 daily briefing',
      usesLLM: false,
    },
    // R10.5 2026-05-19: 旧 metricKey=itemsInserted 实际是"插入 DB 数"，
    // 不等于"最终通过精选门槛的数"。改 itemsAccepted（s8 在评分后才置位）。
    metricKey: 'itemsAccepted',
    metricLabel: '入库条数',
  },
];

export type StageState =
  | 'completed'
  | 'running'
  | 'failed'
  | 'cancelled'
  | 'pending';

/**
 * 计算 stage group 在某次 run 里的视觉状态。
 *
 * - run.status='completed'  → 所有 stage 都 completed（mission 整体成功 ⇒ 8 个
 *   原子 stage 必然全跑完，即便 lastCompletedStage 字段历史缺失也强制满）
 * - run.status='failed':    lastDone+1 落在本 group 内 → failed；落本 group 之前
 *   → completed；落之后 → pending
 * - run.status='cancelled': 同 failed 逻辑，仅替换 failed 标签为 cancelled
 * - run.status='running':   currentStage 落本 group 内 / lastDone+1 落本 group 起始 → running;
 *   lastDone >= stageNumEnd → completed; 否则 pending
 * - run.status='rejected':  全部 pending（mission 在预算闸前被拒绝，没真跑）
 */
export function stageGroupStatus(
  run: RadarRun,
  group: StageGroup,
  currentStage: string | null
): StageState {
  // ★ Hotfix 2026-05-18：mission 终态完成 → 所有 stage 视为已完成。
  //   原实现只看 lastCompletedStage 字段，老 mission 该字段为 null → 全部
  //   走到 pending 分支，导致历史 run 详情页所有 Agent 显示"待执行"。
  //   completed 状态的语义就是「全部 8 stage 跑完了」，可以无视字段缺失。
  if (run.status === 'completed') return 'completed';

  // ★ 2026-05-18 R6: rejected 显式分支 —— 预算闸 / 入口限额阶段被拒绝，
  //   没真跑任何 stage，全部 pending。原实现靠隐式 fallthrough 到末尾
  //   return 'pending'，对维护者不明显，未来修改可能误触。
  if (run.status === 'rejected') return 'pending';

  const lastDone = run.lastCompletedStage ?? 0;
  if (lastDone >= group.stageNumEnd) return 'completed';
  if (run.status === 'failed') {
    if (
      lastDone + 1 >= group.stageNumStart &&
      lastDone + 1 <= group.stageNumEnd
    )
      return 'failed';
    return 'pending';
  }
  if (run.status === 'cancelled') {
    if (
      lastDone + 1 >= group.stageNumStart &&
      lastDone + 1 <= group.stageNumEnd
    )
      return 'cancelled';
    return 'pending';
  }
  if (run.status === 'running') {
    if (currentStage && group.stages.some((s) => currentStage.startsWith(s)))
      return 'running';
    if (
      lastDone < group.stageNumEnd &&
      lastDone + 1 >= group.stageNumStart &&
      lastDone + 1 <= group.stageNumEnd
    )
      return 'running';
  }
  return 'pending';
}

/**
 * 派生 "已完成的 stage 数"（用于 Mission Progress 进度条 N/8）。
 *
 * 同步处理 status='completed' 但 lastCompletedStage=null（老历史数据）场景。
 */
export function effectiveLastCompletedStage(run: RadarRun): number {
  if (run.status === 'completed') return 8;
  return run.lastCompletedStage ?? 0;
}

// ──────────────────────────────────────────────────────────────────────
// Format helpers
// ──────────────────────────────────────────────────────────────────────

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}分${sec}秒`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  // R6: SSR (UTC) 与 CSR (用户时区) hydration mismatch ——
  // getMonth/getHours 是本地时区，服务器渲染时是 UTC，客户端 hydrate 时用本地，
  // React 会报 hydration mismatch + 闪烁。统一用 UTC 方法保证两端字节级一致。
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function statusLabel(s: RadarRunStatus): string {
  switch (s) {
    case 'running':
      return '运行中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    case 'rejected':
      return '已拒绝';
  }
}

export function statusBadgeClass(s: RadarRunStatus): string {
  switch (s) {
    case 'running':
      return 'bg-violet-100 text-violet-700 ring-violet-200';
    case 'completed':
      return 'bg-emerald-100 text-emerald-700 ring-emerald-200';
    case 'failed':
      return 'bg-red-100 text-red-700 ring-red-200';
    case 'cancelled':
      return 'bg-slate-100 text-slate-600 ring-slate-200';
    case 'rejected':
      return 'bg-amber-100 text-amber-700 ring-amber-200';
  }
}

export function triggerLabel(t: RadarRun['trigger']): string {
  if (t === 'MANUAL') return '手动';
  if (t === 'SCHEDULED') return '定时';
  return '首次';
}

// ──────────────────────────────────────────────────────────────────────
// Agent role styling tokens（与 stage 配色协调，不引入 playground-ui 耦合）
// ──────────────────────────────────────────────────────────────────────

export function agentRoleTone(role: string): {
  bg: string;
  text: string;
  ring: string;
  dot: string;
} {
  switch (role) {
    case 'collector':
      return {
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        ring: 'ring-blue-200',
        dot: 'bg-blue-500',
      };
    case 'deduper':
      return {
        bg: 'bg-sky-50',
        text: 'text-sky-700',
        ring: 'ring-sky-200',
        dot: 'bg-sky-500',
      };
    case 'scorer':
      return {
        bg: 'bg-violet-50',
        text: 'text-violet-700',
        ring: 'ring-violet-200',
        dot: 'bg-violet-500',
      };
    case 'enricher':
      return {
        bg: 'bg-fuchsia-50',
        text: 'text-fuchsia-700',
        ring: 'ring-fuchsia-200',
        dot: 'bg-fuchsia-500',
      };
    case 'persister':
      return {
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        ring: 'ring-emerald-200',
        dot: 'bg-emerald-500',
      };
    default:
      return {
        bg: 'bg-gray-50',
        text: 'text-gray-700',
        ring: 'ring-gray-200',
        dot: 'bg-gray-400',
      };
  }
}

// stage state → 行高亮 / 状态 chip 配色
export function stageStateTone(st: StageState): {
  bg: string;
  text: string;
  ring: string;
  rowBorder: string;
  label: string;
} {
  switch (st) {
    case 'completed':
      return {
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        ring: 'ring-emerald-200',
        rowBorder: 'border-l-emerald-400',
        label: '已完成',
      };
    case 'running':
      return {
        bg: 'bg-violet-50',
        text: 'text-violet-700',
        ring: 'ring-violet-300',
        rowBorder: 'border-l-violet-500',
        label: '进行中',
      };
    case 'failed':
      return {
        bg: 'bg-red-50',
        text: 'text-red-700',
        ring: 'ring-red-200',
        rowBorder: 'border-l-red-400',
        label: '失败',
      };
    case 'cancelled':
      return {
        bg: 'bg-slate-50',
        text: 'text-slate-700',
        ring: 'ring-slate-200',
        rowBorder: 'border-l-slate-400',
        label: '已取消',
      };
    case 'pending':
      return {
        bg: 'bg-gray-50',
        text: 'text-gray-500',
        ring: 'ring-gray-200',
        rowBorder: 'border-l-transparent',
        label: '待执行',
      };
  }
}
