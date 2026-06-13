'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * 可折叠的引用块组件
 * 当引用内容超过一定高度时自动折叠，保持界面整洁
 */
export const CollapsibleBlockquote = ({
  children,
  ...props
}: React.PropsWithChildren<React.HTMLAttributes<HTMLQuoteElement>>) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLQuoteElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      // 如果高度超过 160px (约 6-7 行)，则启用折叠
      const MAX_HEIGHT = 160;
      setIsOverflowing(contentRef.current.scrollHeight > MAX_HEIGHT);
    }
  }, [children]);

  return (
    <div className="group relative my-4">
      <blockquote
        ref={contentRef}
        className={`rounded-r border-l-4 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)] py-3 pl-4 pr-4 italic text-gray-700 transition-all duration-300 ${
          !isExpanded && isOverflowing ? 'max-h-40 overflow-hidden' : ''
        }`}
        {...props}
      >
        {children}
      </blockquote>

      {/* 展开按钮 - 仅在溢出且未展开时显示 */}
      {!isExpanded && isOverflowing && (
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center rounded-b bg-gradient-to-t from-[hsl(var(--primary)/0.06)] via-[hsl(var(--primary)/0.05)] to-transparent pb-2 pt-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(true);
            }}
            className="flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-primary shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:opacity-80"
          >
            <ChevronDown className="h-3 w-3" />
            展开引用
          </button>
        </div>
      )}

      {/* 收起按钮 - 仅在展开且溢出时显示，且鼠标悬停时显示 */}
      {isExpanded && isOverflowing && (
        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(false);
            }}
            className="flex items-center gap-1 rounded bg-white/50 px-2 py-1 text-xs text-gray-500 backdrop-blur-sm hover:bg-white hover:text-gray-700"
          >
            <ChevronUp className="h-3 w-3" />
            收起
          </button>
        </div>
      )}
    </div>
  );
};
