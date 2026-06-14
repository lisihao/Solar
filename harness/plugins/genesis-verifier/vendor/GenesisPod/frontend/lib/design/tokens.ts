/**
 * Playground Design Tokens
 *
 * 唯一颜色 / 字号 / 间距 / 图标尺寸事实来源。所有 playground UI 组件必须
 * 引用这里的 token，禁止再写裸 Tailwind 颜色（如 bg-emerald-50）。
 *
 * 命名规范：
 *   - surface: 背景层（卡片、面板）
 *   - text:    文本色阶
 *   - border:  边框色阶
 *   - status:  语义状态色（done / running / failed / pending / blocked / cancelled）
 *   - role:    Agent 角色色（leader / researcher / writer / reviewer / critic 等）
 *   - tone:    叙事语气（info / success / warn / error / neutral）
 *
 * 灵感：Tailwind UI、TI 现有 ResearchTodoList / TodoDetailPanel 视觉风格。
 */

// ─── Surface（背景）─────────────────────────────────────
export const surface = {
  /** 页面底色 */
  base: 'bg-gray-50',
  /** 默认卡片背景 */
  card: 'bg-white',
  /** 弱化分组背景（section header / 区分） */
  subtle: 'bg-gray-50/80',
  /** 高亮交互（hover/selected） */
  hover: 'hover:bg-gray-50',
  /** 强调容器（焦点强信号） */
  elevated: 'bg-white shadow-sm',
} as const;

// ─── Text（文本色阶）────────────────────────────────────
export const text = {
  primary: 'text-gray-900',
  secondary: 'text-gray-700',
  tertiary: 'text-gray-500',
  muted: 'text-gray-400',
  inverse: 'text-white',
  link: 'text-violet-700 hover:text-violet-800',
} as const;

// ─── Typography（字号 + 字重）── 5 级，统一全部组件 ──
export const typography = {
  /** 18px / Drawer / Section title */
  h1: 'text-base font-semibold',
  /** 14px / Card title / Stage label */
  h2: 'text-sm font-semibold',
  /** 12px / Sub label / Section header */
  h3: 'text-[12px] font-semibold uppercase tracking-wide',
  /** 13px / Body */
  body: 'text-[13px] leading-relaxed',
  /** 12px / Body small */
  bodySmall: 'text-xs leading-relaxed',
  /** 11px / Caption / Meta */
  caption: 'text-[11px]',
  /** 10px / Micro / Timestamp */
  micro: 'text-[10px]',
} as const;

// ─── Border（边框）──────────────────────────────────────
export const border = {
  default: 'border border-gray-200',
  subtle: 'border border-gray-100',
  strong: 'border border-gray-300',
  divider: 'divide-y divide-gray-100',
} as const;

// ─── Radius ─────────────────────────────────────────────
export const radius = {
  sm: 'rounded-md',
  md: 'rounded-lg',
  lg: 'rounded-xl',
  full: 'rounded-full',
} as const;

// ─── Spacing rhythm（仅 4-step：xs/sm/md/lg）──
export const spacing = {
  /** 4px */
  xs: 'gap-1',
  /** 8px */
  sm: 'gap-2',
  /** 12px */
  md: 'gap-3',
  /** 16px */
  lg: 'gap-4',
  /** 24px */
  xl: 'gap-6',
} as const;

export const padding = {
  xs: 'p-1.5',
  sm: 'p-2',
  md: 'p-3',
  lg: 'p-4',
} as const;

// ─── Icon sizes（仅 3 级）─────────────────────────────────
export const iconSize = {
  /** 12px — chip / inline */
  xs: 'h-3 w-3',
  /** 14px — default */
  sm: 'h-3.5 w-3.5',
  /** 16px — section header / button */
  md: 'h-4 w-4',
  /** 20px — drawer / modal */
  lg: 'h-5 w-5',
} as const;

// ─── Status (语义状态色)──────────────────────────────────
export type StatusKey =
  | 'done'
  | 'running'
  | 'failed'
  | 'pending'
  | 'blocked'
  | 'cancelled';

export const statusToken: Record<
  StatusKey,
  {
    /** 主文字色 */
    text: string;
    /** 浅底色 */
    bg: string;
    /** 边框 / ring */
    ring: string;
    /** 中文标签 */
    label: string;
  }
> = {
  done: {
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
    ring: 'ring-emerald-200',
    label: '已完成',
  },
  running: {
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    ring: 'ring-blue-200',
    label: '进行中',
  },
  failed: {
    text: 'text-red-700',
    bg: 'bg-red-50',
    ring: 'ring-red-200',
    label: '失败',
  },
  pending: {
    text: 'text-gray-600',
    bg: 'bg-gray-50',
    ring: 'ring-gray-200',
    label: '待启动',
  },
  blocked: {
    text: 'text-amber-700',
    bg: 'bg-amber-50',
    ring: 'ring-amber-200',
    label: '阻塞',
  },
  cancelled: {
    text: 'text-gray-500',
    bg: 'bg-gray-100',
    ring: 'ring-gray-200',
    label: '已放弃',
  },
};

// ─── Role color（Agent 角色色 token）─────────────────────
export type RoleKey =
  | 'leader'
  | 'researcher'
  | 'analyst'
  | 'writer'
  | 'reviewer'
  | 'critic'
  | 'reconciler'
  | 'mission';

export const roleToken: Record<
  RoleKey,
  { text: string; bg: string; ring: string; label: string }
> = {
  leader: {
    text: 'text-violet-700',
    bg: 'bg-violet-50',
    ring: 'ring-violet-200',
    label: 'Leader',
  },
  researcher: {
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    ring: 'ring-blue-200',
    label: 'Researcher',
  },
  analyst: {
    text: 'text-amber-700',
    bg: 'bg-amber-50',
    ring: 'ring-amber-200',
    label: 'Analyst',
  },
  writer: {
    text: 'text-rose-700',
    bg: 'bg-rose-50',
    ring: 'ring-rose-200',
    label: 'Writer',
  },
  reviewer: {
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
    ring: 'ring-emerald-200',
    label: 'Reviewer',
  },
  critic: {
    text: 'text-red-700',
    bg: 'bg-red-50',
    ring: 'ring-red-200',
    label: 'Critic',
  },
  reconciler: {
    text: 'text-sky-700',
    bg: 'bg-sky-50',
    ring: 'ring-sky-200',
    label: 'Reconciler',
  },
  mission: {
    text: 'text-gray-700',
    bg: 'bg-gray-50',
    ring: 'ring-gray-200',
    label: 'Mission',
  },
};

// ─── Tone（叙事语气）──────────────────────────────────────
export type ToneKey = 'info' | 'success' | 'warn' | 'error' | 'neutral';

export const toneToken: Record<
  ToneKey,
  { text: string; bg: string; ring: string }
> = {
  info: {
    text: 'text-blue-700',
    bg: 'bg-blue-50/70',
    ring: 'ring-blue-100',
  },
  success: {
    text: 'text-emerald-700',
    bg: 'bg-emerald-50/70',
    ring: 'ring-emerald-100',
  },
  warn: {
    text: 'text-amber-700',
    bg: 'bg-amber-50/70',
    ring: 'ring-amber-100',
  },
  error: {
    text: 'text-red-700',
    bg: 'bg-red-50/70',
    ring: 'ring-red-100',
  },
  neutral: {
    text: 'text-gray-600',
    bg: 'bg-gray-50',
    ring: 'ring-gray-100',
  },
};

/**
 * 装饰性渐变色板（非模块识别色）。集中在 design 层，feature 不得写死
 * `from-/to-{hue}` 渐变（T6 焊死规则）。用于 Agent 头像、市场货架图标等纯装饰色。
 */
export const AVATAR_GRADIENTS = [
  'from-slate-600 to-slate-800',
  'from-sky-500 to-blue-600',
  'from-fuchsia-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-600',
  'from-cyan-500 to-sky-600',
] as const;

/** 智能体市场货架的图标渐变（装饰色，非模块识别色）。 */
export const MARKET_KIND_GRADIENTS = {
  team: 'from-rose-500 to-pink-600',
  agent: 'from-green-500 to-emerald-600',
  skill: 'from-amber-500 to-orange-600',
  tool: 'from-blue-500 to-indigo-600',
  workflow: 'from-violet-500 to-purple-600',
} as const;
