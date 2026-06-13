'use client';

/**
 * Slides Presentation Mode
 *
 * 全屏演示模式组件
 */

import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { PageState } from '@/lib/types/slides';

interface PresentationModeProps {
  pages: PageState[];
  onClose: () => void;
}

export function PresentationMode({ pages, onClose }: PresentationModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 确保容器获得焦点（防止 iframe 抢占焦点导致键盘事件失效）
  useEffect(() => {
    // 短暂延迟后聚焦容器，确保 DOM 已渲染
    const focusTimer = setTimeout(() => {
      containerRef.current?.focus();
    }, 100);
    return () => clearTimeout(focusTimer);
  }, []);

  // 键盘导航 - 使用 capture 模式确保优先处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 确保容器保持焦点
      if (document.activeElement !== containerRef.current) {
        containerRef.current?.focus();
      }

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
        case 'PageDown':
          e.preventDefault();
          e.stopPropagation();
          setCurrentIndex((prev) => Math.min(prev + 1, pages.length - 1));
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          e.stopPropagation();
          setCurrentIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          e.stopPropagation();
          setCurrentIndex(0);
          break;
        case 'End':
          e.preventDefault();
          e.stopPropagation();
          setCurrentIndex(pages.length - 1);
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    };

    // 使用 capture 模式优先捕获键盘事件
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [pages.length, onClose]);

  // 进入/退出全屏
  useEffect(() => {
    const container = containerRef.current;
    if (container && document.fullscreenEnabled) {
      container.requestFullscreen?.().catch(() => {
        // 全屏请求失败，静默处理
      });
    }

    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

  const currentPage = pages[currentIndex];

  // 固定画布尺寸 (16:9)
  const SLIDE_WIDTH = 1280;
  const SLIDE_HEIGHT = 720;

  // 计算全屏缩放
  const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const screenHeight =
    typeof window !== 'undefined' ? window.innerHeight : 1080;
  const scaleX = screenWidth / SLIDE_WIDTH;
  const scaleY = screenHeight / SLIDE_HEIGHT;
  const scale = Math.min(scaleX, scaleY);

  const scaledWidth = Math.floor(SLIDE_WIDTH * scale);
  const scaledHeight = Math.floor(SLIDE_HEIGHT * scale);

  // 为 iframe 添加缩放样式
  const enhanceHtmlForPresentation = (
    html: string,
    zoomScale: number
  ): string => {
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
    if (html.includes('</head>')) {
      return html.replace('</head>', enhancementStyles + '</head>');
    }
    if (html.includes('<body')) {
      return html.replace('<body', enhancementStyles + '<body');
    }
    return enhancementStyles + html;
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="fixed inset-0 z-50 flex flex-col bg-black outline-none"
      onClick={(e) => {
        // 点击空白区域下一页
        if (e.target === e.currentTarget) {
          setCurrentIndex((prev) => Math.min(prev + 1, pages.length - 1));
        }
      }}
      onMouseMove={() => {
        // 鼠标移动时确保容器获得焦点
        containerRef.current?.focus();
      }}
    >
      {/* 幻灯片内容 */}
      <div className="flex flex-1 items-center justify-center">
        {currentPage?.html ? (
          <iframe
            srcDoc={enhanceHtmlForPresentation(currentPage.html, scale)}
            style={{
              width: scaledWidth,
              height: scaledHeight,
              border: 'none',
              display: 'block',
              backgroundColor: '#0f172a',
              pointerEvents: 'none', // 防止 iframe 截获交互
            }}
            tabIndex={-1} // 防止 iframe 获得焦点
            sandbox="allow-scripts"
          />
        ) : (
          <div className="text-center text-white">
            <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin" />
            <p>加载中...</p>
          </div>
        )}
      </div>

      {/* 控制栏 */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-6 py-4 opacity-0 transition-opacity hover:opacity-100">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
            title="退出演示 (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
          <span className="text-sm text-white/80">
            按 Esc 退出 | 方向键或空格切换页面
          </span>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
            disabled={currentIndex === 0}
            className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20 disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <span className="min-w-[80px] text-center text-sm font-medium text-white">
            {currentIndex + 1} / {pages.length}
          </span>

          <button
            onClick={() =>
              setCurrentIndex((prev) => Math.min(prev + 1, pages.length - 1))
            }
            disabled={currentIndex === pages.length - 1}
            className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20 disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
