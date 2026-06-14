/**
 * ReportViewer - 通用报告三视图框架类型契约
 *
 * 抽自 Topic Insights `reportViewMode` 切换逻辑（continuous / chapter / quick）。
 * 平台层不假设具体业务字段（report.fullReport / dimensionAnalyses 等），
 * 由调用方按 mode 注入对应 renderer。
 */

import type { ReactNode } from 'react';

/** 三视图模式 */
export type ReportViewMode = 'continuous' | 'chapter' | 'quick';

/** 单视图配置 */
export interface ReportViewModeConfig {
  /** 模式标识 */
  mode: ReportViewMode;
  /** 显示标签（i18n 由调用方处理） */
  label: string;
  /** 描述（hover tooltip 用） */
  description?: string;
  /** 图标 ReactNode */
  icon?: ReactNode;
  /** 该模式的渲染内容（由调用方提供具体业务实现） */
  render: () => ReactNode;
  /** 是否禁用（如某些数据缺失时） */
  disabled?: boolean;
  /** 禁用提示 */
  disabledReason?: string;
}

export interface ReportViewModeToggleProps {
  /** 三个视图配置（顺序即展示顺序） */
  modes: ReportViewModeConfig[];
  /** 当前激活模式 */
  activeMode: ReportViewMode;
  /** 切换回调 */
  onChange: (mode: ReportViewMode) => void;
  /** 自定义 className */
  className?: string;
}

export interface ReportViewerProps {
  /** 视图配置（一般传入 [continuous, chapter, quick] 三项） */
  modes: ReportViewModeConfig[];
  /** 当前模式（受控） */
  activeMode: ReportViewMode;
  /** 模式切换 */
  onModeChange: (mode: ReportViewMode) => void;
  /** 顶部工具栏内容（可选 —— 标题 / 字数 / 导出按钮等） */
  toolbar?: ReactNode;
  /** 是否显示模式切换 toggle，默认 true */
  showToggle?: boolean;
  className?: string;
}
