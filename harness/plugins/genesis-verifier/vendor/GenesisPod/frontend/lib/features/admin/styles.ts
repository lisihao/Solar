/**
 * Admin UI 样式常量
 * 统一所有 Admin 模块的色彩系统和样式规范
 *
 * Domain 体系（Wave 2 重定义，对应 L1 Infrastructure 4 实体）：
 *  - user   → 用户实体（蓝，信任/身份）
 *  - secret → 密钥实体（琥珀，警示/凭据）
 *  - data   → 数据实体（绿）
 *  - system → 系统实体（石板灰）
 *
 * 保留 domain（不属于 L1 重组）：
 *  - overview / ai / support
 *
 * Deprecated（Wave 6 移除）：
 *  - access  → 拆为 user + secret + system，pages 迁移完成后删除
 */

// 功能域主色调
export const ADMIN_COLORS = {
  // 概览 - 蓝色
  overview: {
    primary: 'blue',
    gradient: 'from-blue-500 to-cyan-500',
    bg: 'bg-blue-50',
    bgHover: 'hover:bg-blue-100',
    text: 'text-blue-700',
    textMuted: 'text-blue-600',
    border: 'border-blue-200',
    icon: 'text-blue-600',
    ring: 'ring-blue-500',
  },

  // AI 配置 - 紫色
  ai: {
    primary: 'violet',
    gradient: 'from-violet-500 to-purple-500',
    bg: 'bg-violet-50',
    bgHover: 'hover:bg-violet-100',
    text: 'text-violet-700',
    textMuted: 'text-violet-600',
    border: 'border-violet-200',
    icon: 'text-violet-600',
    ring: 'ring-violet-500',
  },

  // 用户管理 - 蓝色（身份/信任）
  user: {
    primary: 'blue',
    gradient: 'from-blue-500 to-indigo-500',
    bg: 'bg-blue-50',
    bgHover: 'hover:bg-blue-100',
    text: 'text-blue-700',
    textMuted: 'text-blue-600',
    border: 'border-blue-200',
    icon: 'text-blue-600',
    ring: 'ring-blue-500',
  },

  // 密钥管理 - 琥珀色（凭据/警示）
  secret: {
    primary: 'amber',
    gradient: 'from-amber-500 to-orange-500',
    bg: 'bg-amber-50',
    bgHover: 'hover:bg-amber-100',
    text: 'text-amber-700',
    textMuted: 'text-amber-600',
    border: 'border-amber-200',
    icon: 'text-amber-600',
    ring: 'ring-amber-500',
  },

  // 数据管理 - 绿色
  data: {
    primary: 'emerald',
    gradient: 'from-emerald-500 to-green-500',
    bg: 'bg-emerald-50',
    bgHover: 'hover:bg-emerald-100',
    text: 'text-emerald-700',
    textMuted: 'text-emerald-600',
    border: 'border-emerald-200',
    icon: 'text-emerald-600',
    ring: 'ring-emerald-500',
  },

  /**
   * @deprecated 用 `user` / `secret` / `system` 替代。
   * 此 key 将在 Wave 6 完成所有 access 页面迁移后移除。
   */
  access: {
    primary: 'amber',
    gradient: 'from-amber-500 to-orange-500',
    bg: 'bg-amber-50',
    bgHover: 'hover:bg-amber-100',
    text: 'text-amber-700',
    textMuted: 'text-amber-600',
    border: 'border-amber-200',
    icon: 'text-amber-600',
    ring: 'ring-amber-500',
  },

  // 系统设置 - 灰蓝色
  system: {
    primary: 'slate',
    gradient: 'from-slate-500 to-gray-500',
    bg: 'bg-slate-50',
    bgHover: 'hover:bg-slate-100',
    text: 'text-slate-700',
    textMuted: 'text-slate-600',
    border: 'border-slate-200',
    icon: 'text-slate-600',
    ring: 'ring-slate-500',
  },

  // 支持/反馈 - 红色/粉色
  support: {
    primary: 'rose',
    gradient: 'from-rose-500 to-pink-500',
    bg: 'bg-rose-50',
    bgHover: 'hover:bg-rose-100',
    text: 'text-rose-700',
    textMuted: 'text-rose-600',
    border: 'border-rose-200',
    icon: 'text-rose-600',
    ring: 'ring-rose-500',
  },
} as const;

// 状态色
export const STATUS_COLORS = {
  active: {
    bg: 'bg-green-100',
    text: 'text-green-700',
    border: 'border-green-200',
    dot: 'bg-green-500',
  },
  pending: {
    bg: 'bg-amber-100',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  error: {
    bg: 'bg-red-100',
    text: 'text-red-700',
    border: 'border-red-200',
    dot: 'bg-red-500',
  },
  inactive: {
    bg: 'bg-gray-100',
    text: 'text-gray-500',
    border: 'border-gray-200',
    dot: 'bg-gray-400',
  },
  configured: {
    bg: 'bg-green-100',
    text: 'text-green-700',
    border: 'border-green-200',
    dot: 'bg-green-500',
  },
} as const;

// 功能域类型
export type AdminDomain = keyof typeof ADMIN_COLORS;
export type StatusType = keyof typeof STATUS_COLORS;

// 侧边栏样式
export const SIDEBAR_STYLES = {
  width: {
    expanded: 'w-64',
    collapsed: 'w-16',
  },
  transition: 'transition-all duration-300 ease-in-out',
  item: {
    base: 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
    active: 'bg-gray-100 text-gray-900',
    inactive: 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
  },
  group: {
    title:
      'px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider',
  },
} as const;

// 页面布局样式
export const PAGE_LAYOUT_STYLES = {
  container: 'flex-1 overflow-auto bg-gray-50/50',
  header: {
    wrapper: 'border-b border-gray-100 bg-white/80 backdrop-blur-sm px-6 py-4',
    title: 'text-xl font-semibold text-gray-900',
    description: 'text-sm text-gray-500 mt-0.5',
  },
  content: {
    wrapper: 'p-6',
    maxWidth: 'max-w-7xl mx-auto',
  },
} as const;

// 卡片样式
export const CARD_STYLES = {
  base: 'bg-white rounded-xl border border-gray-100 shadow-sm',
  header: {
    wrapper:
      'flex items-center justify-between px-5 py-4 border-b border-gray-100',
    title: 'text-base font-semibold text-gray-900',
    description: 'text-sm text-gray-500 mt-0.5',
  },
  content: 'px-5 py-4',
  footer: 'px-5 py-3 border-t border-gray-100 bg-gray-50/50',
} as const;

// 表单样式
export const FORM_STYLES = {
  section: {
    wrapper: 'space-y-4',
    title: 'text-sm font-medium text-gray-900',
    description: 'text-sm text-gray-500',
  },
  field: {
    wrapper: 'space-y-1.5',
    label: 'block text-sm font-medium text-gray-700',
    input:
      'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
    error: 'text-sm text-red-600 mt-1',
    hint: 'text-sm text-gray-500 mt-1',
  },
} as const;

// 表格样式
export const TABLE_STYLES = {
  wrapper: 'overflow-hidden rounded-lg border border-gray-200',
  table: 'min-w-full divide-y divide-gray-200',
  header: {
    row: 'bg-gray-50',
    cell: 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider',
  },
  body: {
    row: 'bg-white hover:bg-gray-50 transition-colors',
    rowAlt: 'bg-gray-50/50 hover:bg-gray-100 transition-colors',
    cell: 'px-4 py-3 text-sm text-gray-900 whitespace-nowrap',
  },
  empty: {
    wrapper: 'px-4 py-12 text-center',
    icon: 'mx-auto h-12 w-12 text-gray-400',
    title: 'mt-2 text-sm font-medium text-gray-900',
    description: 'mt-1 text-sm text-gray-500',
  },
} as const;

// 辅助函数：获取域颜色
export function getDomainColors(domain: AdminDomain) {
  return ADMIN_COLORS[domain];
}

// 辅助函数：获取状态颜色
export function getStatusColors(status: StatusType) {
  return STATUS_COLORS[status];
}

// 辅助函数：获取状态标签样式
export function getStatusBadgeClasses(status: StatusType) {
  const colors = STATUS_COLORS[status];
  return `inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text} border ${colors.border}`;
}
