'use client';

/**
 * AssetDetailLayout - 通用资产详情页双栏骨架
 *
 * 抽出自 TopicResearchLayout 的双栏结构：
 * - 顶部 Header：返回 + 图标 + 标题 + 描述 + 状态徽章 + 操作槽
 * - 主体：左侧固定宽度可折叠面板（Agent Team / 信息）+ 右侧伸缩内容区（Tabs）
 *
 * 不包含：
 * - 权限/可见性弹窗（由调用方放在 settingsModal slot 中或独立组件）
 * - Tab 路由（差异大，由 rightPanel 调用方自己实现）
 */

import { useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/common';

export interface AssetDetailLayoutProps {
  /** Header 标题 */
  title: ReactNode;
  /** Header 副标题/描述 */
  description?: ReactNode;
  /** Header 左侧图标节点 */
  icon?: ReactNode;
  /** Header 图标背景渐变 */
  gradient?: string;
  /** 返回回调；不传则不显示返回按钮 */
  onBack?: () => void;
  backLabel?: string;

  /** Header 右侧状态徽章（如「研究中…」） */
  headerStatus?: ReactNode;
  /** Header 右侧自定义操作（设置 / 导出 等） */
  headerActions?: ReactNode;

  /** 左侧面板内容（一般是 Agent Team / 元信息） */
  leftPanel: ReactNode;
  /** 左侧面板标题（折叠头展示） */
  leftPanelTitle?: string;
  /** 左侧面板宽度 px，默认 360 */
  leftPanelWidth?: number;
  /** 是否允许折叠，默认 true */
  collapsible?: boolean;
  /** 默认是否折叠，默认 false */
  defaultCollapsed?: boolean;
  /** 折叠状态变更回调 */
  onCollapseChange?: (collapsed: boolean) => void;

  /** 右侧内容区（Tabs / Canvas / 报告等） */
  rightPanel: ReactNode;

  /** 设置弹窗等附加节点 */
  modals?: ReactNode;

  /** 国际化文案 */
  labels?: {
    back?: string;
    expand?: string;
    collapse?: string;
  };
}

export function AssetDetailLayout({
  title,
  description,
  icon,
  gradient = 'from-violet-500 to-fuchsia-600',
  onBack,
  backLabel,
  headerStatus,
  headerActions,
  leftPanel,
  leftPanelTitle,
  leftPanelWidth = 360,
  collapsible = true,
  defaultCollapsed = false,
  onCollapseChange,
  rightPanel,
  modals,
  labels,
}: AssetDetailLayoutProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    onCollapseChange?.(next);
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              title={backLabel ?? labels?.back ?? 'Back'}
              aria-label={backLabel ?? labels?.back ?? 'Back'}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}

          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <div
                className={cn(
                  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-md',
                  gradient
                )}
              >
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-gray-900">
                {title}
              </h1>
              {description && (
                <p className="max-w-md truncate text-sm text-gray-500">
                  {description}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {headerStatus}
          {headerActions}
        </div>
      </header>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div
          className={cn(
            'flex-shrink-0 border-r border-gray-200 bg-white transition-all duration-300'
          )}
          style={{ width: collapsed ? 48 : leftPanelWidth }}
        >
          {collapsed ? (
            <div className="flex h-full flex-col items-center py-4">
              {collapsible && (
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  title={labels?.expand ?? 'Expand'}
                  aria-label={labels?.expand ?? 'Expand'}
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
              {leftPanelTitle && (
                <span
                  className="mt-4 text-xs text-gray-500"
                  style={{ writingMode: 'vertical-rl' }}
                >
                  {leftPanelTitle}
                </span>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {(leftPanelTitle || collapsible) && (
                <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                  {leftPanelTitle ? (
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {leftPanelTitle}
                    </span>
                  ) : (
                    <span />
                  )}
                  {collapsible && (
                    <button
                      type="button"
                      onClick={toggleCollapsed}
                      className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      title={labels?.collapse ?? 'Collapse'}
                      aria-label={labels?.collapse ?? 'Collapse'}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
              <div className="flex-1 overflow-hidden">{leftPanel}</div>
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div className="flex-1 overflow-hidden">{rightPanel}</div>
      </div>

      {modals}
    </div>
  );
}
