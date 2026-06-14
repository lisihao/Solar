/**
 * LeaderChat - 通用 Leader 对话平台类型
 *
 * 抽自 agent-playground/LeaderChatModal，作为 Topic Insights / AI Planning /
 * AI Writing / AI Teams 等模块「与 Leader 对话」的统一入口。
 *
 * 分层：
 * - LeaderChat：纯 UI（messages + input），数据驱动，不连 API
 * - LeaderChatDock：modal / minimized 容器，状态机由本组件管
 *
 * 业务侧职责：fetch messages、call API、把 send 回调连到后端
 */

import type { ReactNode } from 'react';

/** 单条消息 */
export interface LeaderChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /**
   * 消息内容（assistant 支持 markdown）。
   * 特殊值 `__THINKING__` 渲染为打字气泡指示器。
   */
  content: string;
  tokensUsed?: number | null;
  createdAt: string | Date;
  /**
   * 调用方业务字段（如 TI 的 decisionType / understanding / todoCreated / clarifyOptions）。
   * 由 renderAssistantHeaderExtra / renderAssistantBodyExtra 槽消费。
   */
  meta?: Record<string, unknown>;
}

/** Dock 三态 */
export type LeaderChatDockMode = 'modal' | 'minimized';

/** LeaderChat 纯 UI 组件 props */
export interface LeaderChatProps {
  /** 消息列表 */
  messages: LeaderChatMessage[];
  /** 历史加载中 */
  loading?: boolean;
  /** 错误信息（顶部红色提示） */
  error?: string | null;
  /** 发送中 */
  sending?: boolean;
  /** 发送回调；可抛错 */
  onSend: (text: string) => Promise<void> | void;

  /** i18n */
  labels?: {
    placeholder?: string;
    loading?: string;
    emptyTitle?: string;
    emptyHint?: string;
    thinking?: string;
    sendFailed?: string;
    send?: string;
  };

  /** 品牌图标（assistant / user / empty） */
  assistantIcon?: ReactNode;
  userIcon?: ReactNode;
  emptyIcon?: ReactNode;

  /** 主色 Tailwind 类前缀，默认 violet（如 "violet" / "blue"） */
  accentColor?: 'violet' | 'blue' | 'emerald' | 'amber';

  /** 是否启用 Markdown 渲染（默认 true） */
  enableMarkdown?: boolean;

  /** assistant 消息名字旁边的额外节点（如 decisionType chip） */
  renderAssistantHeaderExtra?: (msg: LeaderChatMessage) => ReactNode;
  /** assistant 消息正文之后的额外节点（如 TODO 按钮 / clarify 选项） */
  renderAssistantBodyExtra?: (msg: LeaderChatMessage) => ReactNode;
  /** assistant 消息正文之前的额外节点（如 💭 understanding） */
  renderAssistantBodyPrefix?: (msg: LeaderChatMessage) => ReactNode;

  /** 自定义角色名称（默认 "Leader" / "User"） */
  assistantName?: string;
  userName?: string;
}

/** LeaderChatDock props（包含 LeaderChatProps + 容器配置） */
export interface LeaderChatDockProps extends LeaderChatProps {
  /** 是否打开（false 时返回 null） */
  open: boolean;
  /** 关闭回调（用户点击 X 或遮罩） */
  onClose: () => void;

  /** Header 标题 */
  title?: string;
  /** Header 副标题（一般是 topic / mission 上下文） */
  subtitle?: string;
  /** Header icon */
  headerIcon?: ReactNode;
  /** Header 渐变背景类 */
  headerGradient?: string;

  /** 是否允许最小化（默认 true） */
  allowMinimize?: boolean;
  /** 默认形态（默认 'modal'） */
  defaultMode?: LeaderChatDockMode;

  /** 最小化按钮 tooltip */
  minimizeLabel?: string;
  /** 关闭按钮 tooltip */
  closeLabel?: string;
  /** 最小化浮球 tooltip */
  restoreLabel?: string;
}
