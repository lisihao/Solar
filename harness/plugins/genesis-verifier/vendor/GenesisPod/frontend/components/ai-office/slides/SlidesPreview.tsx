'use client';

/**
 * Slides Preview - 预览面板组件
 *
 * 包含 PreviewPanel 和 ThumbnailCard
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Layers,
  Eye,
  Terminal,
  Brain,
  Copy,
  Loader2,
  AlertCircle,
  Grid3X3,
  FileText,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useSlidesStore } from '@/stores';
import type { PageState } from '@/lib/types/slides';
import { sanitizeSlideHtml } from '@/lib/utils/sanitize';
import { CodePreview } from './CodePreview';
import { ThinkingPanel } from './ThinkingPanel';

// ============================================================================
// 类型定义
// ============================================================================

type ViewMode = 'preview' | 'code' | 'thinking';

// ============================================================================
// PreviewPanel 组件
// ============================================================================

export function PreviewPanel() {
  const { pages, selectedPageIndex, setSelectedPageIndex } = useSlidesStore();
  const currentPage = pages[selectedPageIndex];
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const lastWheelTime = useRef<number>(0);
  const accumulatedDelta = useRef<number>(0);

  // 鼠标滚轮切换页面（仅垂直滚动时，允许水平滚动正常工作）
  // 添加防抖和阈值控制，防止滚动太快
  const handleThumbnailWheel = useCallback(
    (e: React.WheelEvent) => {
      if (pages.length <= 1) return;

      // 如果是水平滚动（deltaX 大于 deltaY），让原生滚动处理
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        return; // 不阻止默认行为，允许水平滚动
      }

      // 垂直滚动时切换页面
      e.preventDefault();

      const now = Date.now();
      const timeSinceLastWheel = now - lastWheelTime.current;

      // 如果距离上次滚动超过 150ms，重置累积值
      if (timeSinceLastWheel > 150) {
        accumulatedDelta.current = 0;
      }

      // 累积滚动量
      accumulatedDelta.current += e.deltaY;

      // 需要累积足够的滚动量才触发翻页（阈值 50）
      // 并且距离上次翻页至少 200ms（防抖）
      if (
        Math.abs(accumulatedDelta.current) >= 50 &&
        timeSinceLastWheel >= 200
      ) {
        if (accumulatedDelta.current > 0) {
          // 下一页
          setSelectedPageIndex(
            Math.min(selectedPageIndex + 1, pages.length - 1)
          );
        } else {
          // 上一页
          setSelectedPageIndex(Math.max(selectedPageIndex - 1, 0));
        }
        // 重置
        accumulatedDelta.current = 0;
        lastWheelTime.current = now;
      }
    },
    [pages.length, selectedPageIndex, setSelectedPageIndex]
  );

  // 自动滚动缩略图到当前选中页
  useEffect(() => {
    if (thumbnailStripRef.current && pages.length > 0) {
      const strip = thumbnailStripRef.current;
      const selectedThumb = strip.children[selectedPageIndex] as HTMLElement;
      if (selectedThumb) {
        selectedThumb.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
      }
    }
  }, [selectedPageIndex, pages.length]);

  // 使用 ResizeObserver 监听容器尺寸变化
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 初始化时立即获取尺寸
    const rect = container.getBoundingClientRect();
    setDimensions({ width: rect.width, height: rect.height });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // 固定画布尺寸 (16:9)
  const SLIDE_WIDTH = 1280;
  const SLIDE_HEIGHT = 720;
  const PADDING = 24;

  // 检查容器尺寸是否已正确测量
  const isDimensionsReady = dimensions.width > 100 && dimensions.height > 100;

  // 计算可用空间 - 只在尺寸准备好后使用真实值
  const availableWidth = isDimensionsReady ? dimensions.width - PADDING : 800; // 默认宽度
  const availableHeight = isDimensionsReady ? dimensions.height - PADDING : 450; // 默认高度 (16:9)

  // 计算缩放比例，保持宽高比，允许放大以填充空间
  const scaleX = availableWidth / SLIDE_WIDTH;
  const scaleY = availableHeight / SLIDE_HEIGHT;
  const scale = Math.min(scaleX, scaleY); // 移除最大 1 的限制，允许放大

  // 缩放后的尺寸
  const scaledWidth = Math.floor(SLIDE_WIDTH * scale);
  const scaledHeight = Math.floor(SLIDE_HEIGHT * scale);

  // 为 iframe 内容添加缩放样式 - 使用内部缩放而非外部 transform
  // 这样渲染更清晰，因为浏览器会重新渲染而不是缩放像素
  const enhanceHtmlForClarity = useCallback(
    (html: string, zoomScale: number): string => {
      // 注入缩放和字体平滑样式
      const enhancementStyles = `
      <style>
        * {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }
        html {
          zoom: ${zoomScale};
        }
        body {
          margin: 0;
          padding: 0;
          width: ${SLIDE_WIDTH}px;
          height: ${SLIDE_HEIGHT}px;
          overflow: hidden;
        }
      </style>
    `;
      // 在 </head> 前插入样式
      if (html.includes('</head>')) {
        return html.replace('</head>', enhancementStyles + '</head>');
      }
      // 如果没有 head，在 body 前插入
      if (html.includes('<body')) {
        return html.replace('<body', enhancementStyles + '<body');
      }
      return enhancementStyles + html;
    },
    []
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-gradient-to-br from-slate-100 to-slate-200">
      {/* 缩略图区域 - 支持鼠标滚轮切换页面和水平滚动 */}
      <div
        className="flex-shrink-0 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur-sm"
        onWheel={handleThumbnailWheel}
      >
        <div
          ref={thumbnailStripRef}
          className="scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent flex items-center gap-2 overflow-x-auto pb-1"
        >
          {pages.length === 0 ? (
            <div className="flex h-14 w-full items-center justify-center text-sm text-slate-500">
              <Layers className="mr-2 h-4 w-4 opacity-50" />
              开始生成后将显示缩略图
            </div>
          ) : (
            pages.map((page, index) => (
              <ThumbnailCard
                key={page.pageNumber}
                page={page}
                index={index}
                isSelected={index === selectedPageIndex}
                onClick={() => setSelectedPageIndex(index)}
              />
            ))
          )}
        </div>
      </div>

      {/* 视图模式切换标签 - Preview | Code | Thinking */}
      <div className="flex-shrink-0 border-b border-slate-200 bg-white/60 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('preview')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              viewMode === 'preview'
                ? 'bg-orange-100 text-orange-700 shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            )}
          >
            <Eye className="h-4 w-4" />
            Preview
          </button>
          <button
            onClick={() => setViewMode('code')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              viewMode === 'code'
                ? 'bg-orange-100 text-orange-700 shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            )}
          >
            <Terminal className="h-4 w-4" />
            Code
          </button>
          <button
            onClick={() => setViewMode('thinking')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              viewMode === 'thinking'
                ? 'bg-orange-100 text-orange-700 shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            )}
          >
            <Brain className="h-4 w-4" />
            Thinking
          </button>

          {/* 右侧操作按钮 */}
          {currentPage?.html && viewMode === 'code' && (
            <div className="ml-auto">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(currentPage.html || '');
                }}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-700"
              >
                <Copy className="h-4 w-4" />
                Copy
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 主内容区域 - 根据 viewMode 显示不同内容 */}
      <div
        ref={containerRef}
        className="relative flex min-h-0 flex-1 overflow-hidden"
      >
        {/* Preview 模式 */}
        {viewMode === 'preview' && (
          <div className="flex flex-1 items-center justify-center p-4">
            {currentPage ? (
              <div
                className="relative rounded-xl shadow-2xl ring-1 ring-slate-700/50"
                style={{
                  width: scaledWidth,
                  height: scaledHeight,
                  overflow: 'hidden',
                  willChange: 'transform',
                  backfaceVisibility: 'hidden',
                  perspective: 1000,
                }}
              >
                {currentPage.html ? (
                  <iframe
                    srcDoc={enhanceHtmlForClarity(currentPage.html, scale)}
                    style={{
                      width: scaledWidth,
                      height: scaledHeight,
                      border: 'none',
                      display: 'block',
                      backgroundColor: '#0f172a',
                    }}
                    sandbox="allow-scripts"
                  />
                ) : (
                  <div
                    className="flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900"
                    style={{ width: '100%', height: '100%' }}
                  >
                    {currentPage.status === 'generating' ? (
                      <div className="text-center">
                        <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-orange-400" />
                        <p className="text-sm font-medium text-slate-300">
                          正在生成第 {currentPage.pageNumber} 页...
                        </p>
                        <p className="mt-1 text-xs text-slate-500">请稍候</p>
                      </div>
                    ) : currentPage.status === 'error' ? (
                      <div className="text-center">
                        <AlertCircle className="mx-auto mb-4 h-10 w-10 text-red-400" />
                        <p className="text-sm font-medium text-red-300">
                          {currentPage.error || '生成失败'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          请重试或检查内容
                        </p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <Layers className="mx-auto mb-4 h-10 w-10 text-slate-600" />
                        <p className="text-sm font-medium text-slate-400">
                          等待生成...
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-200">
                  <Grid3X3 className="h-10 w-10 text-slate-400" />
                </div>
                <p className="text-lg font-medium text-slate-700">
                  开始生成演示文稿
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  在左侧输入内容并点击生成
                </p>
              </div>
            )}
          </div>
        )}

        {/* Code 模式 - 使用 V5 CodePreview 组件 */}
        {viewMode === 'code' && (
          <CodePreview
            html={currentPage?.html}
            isVisible={true}
            className="flex-1"
          />
        )}

        {/* Thinking 模式 - 使用 V5 ThinkingPanel 组件 */}
        {viewMode === 'thinking' && (
          <ThinkingPanel isVisible={true} className="flex-1" />
        )}
      </div>

      {/* 属性面板 */}
      {currentPage && (
        <div className="flex-shrink-0 border-t border-slate-200 bg-white/90 px-6 py-3 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">模板:</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                  {currentPage.outline?.templateType || '未知'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">状态:</span>
                <span
                  className={cn('rounded px-2 py-0.5 font-medium', {
                    'bg-green-100 text-green-700':
                      currentPage.status === 'completed',
                    'bg-orange-100 text-orange-700':
                      currentPage.status === 'generating',
                    'bg-red-100 text-red-700': currentPage.status === 'error',
                    'bg-slate-100 text-slate-600':
                      currentPage.status === 'pending',
                  })}
                >
                  {getStatusText(currentPage.status)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-slate-700">
                {selectedPageIndex + 1}
              </span>
              <span className="text-slate-400">/</span>
              <span className="text-slate-500">{pages.length} 页</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ThumbnailCard 组件
// ============================================================================

export function ThumbnailCard({
  page,
  index,
  isSelected,
  onClick,
}: {
  page: PageState;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative aspect-[16/9] w-24 flex-shrink-0 overflow-hidden rounded-lg transition-all',
        isSelected
          ? 'shadow-lg ring-2 ring-orange-500 ring-offset-2'
          : 'ring-1 ring-slate-200 hover:ring-slate-300'
      )}
    >
      {page.html ? (
        <div
          className="pointer-events-none h-full w-full bg-slate-900"
          style={{
            transform: 'scale(0.1)',
            transformOrigin: 'top left',
            width: '1000%',
            height: '1000%',
          }}
          dangerouslySetInnerHTML={{ __html: sanitizeSlideHtml(page.html) }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
          {page.status === 'generating' ? (
            <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
          ) : page.status === 'error' ? (
            <AlertCircle className="h-4 w-4 text-red-500" />
          ) : (
            <span className="text-xs font-medium text-slate-400">
              {index + 1}
            </span>
          )}
        </div>
      )}

      <div className="absolute bottom-1 right-1 rounded bg-black/50 px-1 text-[10px] text-white">
        {index + 1}
      </div>
    </button>
  );
}

// ============================================================================
// 辅助函数
// ============================================================================

function getStatusText(status: string): string {
  switch (status) {
    case 'pending':
      return '待生成';
    case 'generating':
      return '生成中';
    case 'completed':
      return '已完成';
    case 'error':
      return '失败';
    default:
      return status;
  }
}

function formatHtmlCode(html: string): string {
  // 简单的 HTML 格式化
  return html
    .replace(/></g, '>\n<')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}
