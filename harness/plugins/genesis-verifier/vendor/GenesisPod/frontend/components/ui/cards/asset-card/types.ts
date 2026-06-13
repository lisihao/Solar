/**
 * AssetCard - 通用资产卡片类型定义
 *
 * 用于 Topic Insights / AI Writing / AI Research / AI Planning 等
 * 「Agent 驱动型资产」模块的列表卡片。
 *
 * 抽取原则：结构、行为、布局共用；色彩主题、徽章文案、可见性级别由调用方注入。
 */

import type { ReactNode } from 'react';

/** 标准可见性级别 —— 不强制三层都启用，由调用方按 visibilityLevels 配置 */
export type AssetVisibility = 'PRIVATE' | 'SHARED' | 'PUBLIC';

/** 卡片右上角悬停展示的操作按钮 */
export interface AssetCardAction {
  /** 唯一 key，用于 React 列表 */
  key: string;
  /** 图标节点 */
  icon: ReactNode;
  /** 鼠标悬停 tooltip */
  title: string;
  /** 点击回调（已自动 stopPropagation） */
  onClick: () => void;
  /** 颜色风格，对应 Tailwind 配色组 */
  tone?: 'default' | 'success' | 'danger' | 'info' | 'warning';
  /** 是否显示，默认 true */
  visible?: boolean;
}

/** 卡片主体下方的 stats 展示项（图标 + 文本） */
export interface AssetCardStat {
  key: string;
  icon: ReactNode;
  text: ReactNode;
}

/** 进度展示（completed / total），可选 */
export interface AssetCardProgress {
  current: number;
  total: number;
  /** 进度条颜色，默认跟随 gradient */
  gradient?: string;
}

/** 顶部分类徽章 */
export interface AssetCardBadge {
  key: string;
  label: ReactNode;
  /** Tailwind 颜色组合，如 "bg-blue-100 text-blue-600" */
  className?: string;
  icon?: ReactNode;
}

/** 可见性配置项 */
export interface AssetVisibilityOption {
  value: AssetVisibility;
  label: string;
  icon: ReactNode;
  /** Tailwind 颜色，如 "bg-gray-100 text-gray-600" */
  className: string;
}

export interface AssetCardProps {
  /** 卡片标题 */
  title: string;
  /** 卡片描述 */
  description?: string | null;

  /** 主图标节点（一般是 svg） */
  icon?: ReactNode;
  /** 图标背景渐变 Tailwind 类，如 "from-blue-500 to-cyan-600" */
  gradient?: string;
  /**
   * 顶部宽幅媒体区（aspect-video / 缩略图）。
   * 提供时会**取代** icon 区，撑满卡片宽度（用于 Slides / Image 等缩略图优先场景）。
   */
  media?: ReactNode;

  /** 顶部徽章数组（类型 / 状态 等） */
  badges?: AssetCardBadge[];

  /** 当前可见性 */
  visibility?: AssetVisibility;
  /** 可见性配置（label / icon / 颜色），调用方提供以满足国际化 */
  visibilityOptions?: Record<AssetVisibility, AssetVisibilityOption>;
  /**
   * 点击可见性徽章时触发（一般用于打开分享/权限弹窗）。
   * 仅在 isOwner=true 时生效；不传则徽章不可点击。
   */
  onVisibilityClick?: () => void;
  /**
   * 直接切换可见性（卡片右上角的快速切换按钮）。
   * 不传则不渲染快速切换按钮。
   */
  onVisibilityToggle?: (next: AssetVisibility) => void;
  /**
   * 快速切换的循环顺序，例如 ['PRIVATE','PUBLIC'] 表示在两个状态间切换。
   * 默认 ['PRIVATE','PUBLIC']。
   */
  visibilityToggleCycle?: AssetVisibility[];

  /** 是否所有者（控制操作按钮的展示） */
  isOwner?: boolean;

  /** 内置编辑回调（hover 区右上角铅笔按钮） */
  onEdit?: () => void;
  /** 内置删除回调 */
  onDelete?: () => void;
  /** 社交分享回调（可见性=PUBLIC 时才展示） */
  onShareToSocial?: () => void;
  /** 额外操作按钮（按顺序追加在删除按钮之前） */
  extraActions?: AssetCardAction[];

  /** 卡片点击回调 */
  onClick?: () => void;

  /** 主体 stats（下方统计项） */
  stats?: AssetCardStat[];
  /** 进度条 */
  progress?: AssetCardProgress;
  /**
   * 自定义内容区，渲染在 description 之后、stats 之前。
   * 用于域特定的可视化（如 Planning 的多阶段指示、Image 的缩略图等）。
   */
  customSection?: ReactNode;

  /** 底部时间戳 + 标签（如「最后刷新」 + 时间） */
  timestampLabel?: string;
  timestamp?: string | Date | null;
  /** 底部右侧自定义节点（如「申请加入」按钮） */
  footerExtra?: ReactNode;

  /** 自定义 className，覆盖根容器样式 */
  className?: string;

  /** i18n 文案：用于内置按钮 tooltip。不传则使用英文 fallback */
  labels?: {
    setPrivate?: string;
    setPublic?: string;
    shareToSocial?: string;
    edit?: string;
    delete?: string;
    /** 点击可见性徽章 tooltip */
    clickVisibility?: string;
  };
}
