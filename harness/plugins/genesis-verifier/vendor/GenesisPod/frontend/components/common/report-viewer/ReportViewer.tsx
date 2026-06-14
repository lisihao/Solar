'use client';

/**
 * ReportViewer - 报告三视图容器
 *
 * 抽自 Topic Insights TopicContentPanel 的 `reportViewMode` 切换逻辑，
 * 沉淀为跨模块平台能力。
 *
 * 设计要点：
 * - 受控组件：activeMode + onModeChange 由调用方管理（一般来自 URL 或 store）
 * - 模式驱动：modes[] 数组配置每个视图的 label / icon / render，
 *   平台层不假设具体业务字段，调用方注入对应 renderer
 * - 与 ReportViewModeToggle 解耦：toolbar slot 可单独使用 toggle
 *
 * 适用场景：
 * - TI 报告（continuous / chapter / quick）
 * - AI Writing 长文（完整 / 大纲 / 速览）
 * - AI Research 多迭代报告（完整 / 章节 / 摘要）
 *
 * 不在平台层做的：
 * - 具体 markdown / chart / quick view 渲染（由 modes[i].render 提供）
 * - 数据加载 / 持久化（业务侧）
 * - 编辑能力（ReportEditor 是独立组件）
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils/common';
import { ReportViewModeToggle } from './ReportViewModeToggle';
import type { ReportViewerProps } from './types';

export function ReportViewer({
  modes,
  activeMode,
  onModeChange,
  toolbar,
  showToggle = true,
  className,
}: ReportViewerProps) {
  const activeConfig = useMemo(
    () => modes.find((m) => m.mode === activeMode),
    [modes, activeMode]
  );

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {(toolbar || showToggle) && (
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-2">
          <div className="flex items-center gap-3">{toolbar}</div>
          {showToggle && (
            <ReportViewModeToggle
              modes={modes}
              activeMode={activeMode}
              onChange={onModeChange}
            />
          )}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {activeConfig ? activeConfig.render() : null}
      </div>
    </div>
  );
}
