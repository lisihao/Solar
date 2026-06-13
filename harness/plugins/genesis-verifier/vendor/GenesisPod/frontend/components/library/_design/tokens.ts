/**
 * Library 设计令牌
 * 知识库 + 数据源卡片共享的视觉规范
 */

export interface GradientToken {
  gradient: string;
  shadow: string;
}

/**
 * 卡片渐变色板（哈希驱动选色，与 ai-research/page.tsx 保持一致的语言）
 * 同一 ID 永远落到同一色块，形成视觉记忆点。
 */
export const CARD_GRADIENTS: GradientToken[] = [
  { gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/30' },
  { gradient: 'from-indigo-500 to-blue-600', shadow: 'shadow-indigo-500/30' },
  { gradient: 'from-blue-500 to-cyan-500', shadow: 'shadow-blue-500/30' },
  { gradient: 'from-emerald-500 to-teal-500', shadow: 'shadow-emerald-500/30' },
  { gradient: 'from-cyan-500 to-blue-500', shadow: 'shadow-cyan-500/30' },
  { gradient: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-500/30' },
  { gradient: 'from-fuchsia-500 to-pink-500', shadow: 'shadow-fuchsia-500/30' },
  { gradient: 'from-pink-500 to-rose-500', shadow: 'shadow-pink-500/30' },
];

export function pickGradient(seed: string): GradientToken {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return CARD_GRADIENTS[Math.abs(hash) % CARD_GRADIENTS.length];
}

/**
 * 全局品牌色（用于 Header logo / 主 CTA / Tab 下划线）
 * 与 AI Office、AI Research 保持一致
 */
export const BRAND_GRADIENT: GradientToken = {
  gradient: 'from-violet-500 to-purple-600',
  shadow: 'shadow-violet-500/25',
};

/**
 * 知识库状态视觉规范
 */
export type KnowledgeBaseStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'READY'
  | 'UPDATING'
  | 'ERROR';

export interface StatusToken {
  label: string;
  bg: string;
  text: string;
  dot: string;
}

export const KB_STATUS_TOKENS: Record<KnowledgeBaseStatus, StatusToken> = {
  PENDING: {
    label: '待处理',
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    dot: 'bg-gray-400',
  },
  PROCESSING: {
    label: '处理中',
    bg: 'bg-blue-50',
    text: 'text-blue-600',
    dot: 'bg-blue-500 animate-pulse',
  },
  READY: {
    label: '就绪',
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    dot: 'bg-emerald-500',
  },
  UPDATING: {
    label: '更新中',
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    dot: 'bg-amber-500 animate-pulse',
  },
  ERROR: {
    label: '错误',
    bg: 'bg-red-50',
    text: 'text-red-600',
    dot: 'bg-red-500',
  },
};

/**
 * 连接器（数据源）状态视觉规范
 */
export type ConnectorState =
  | 'connected'
  | 'syncing'
  | 'needs_reauth'
  | 'error'
  | 'disconnected';

export const CONNECTOR_STATUS_TOKENS: Record<ConnectorState, StatusToken> = {
  connected: {
    label: '已连接',
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    dot: 'bg-emerald-500',
  },
  syncing: {
    label: '同步中',
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    dot: 'bg-amber-500 animate-pulse',
  },
  needs_reauth: {
    label: '需重新授权',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
  },
  error: {
    label: '失败',
    bg: 'bg-red-50',
    text: 'text-red-600',
    dot: 'bg-red-500',
  },
  disconnected: {
    label: '未连接',
    bg: 'bg-gray-100',
    text: 'text-gray-500',
    dot: 'bg-gray-300',
  },
};
