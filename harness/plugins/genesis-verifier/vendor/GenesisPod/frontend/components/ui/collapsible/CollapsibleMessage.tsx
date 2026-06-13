'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsibleMessageProps {
  children: React.ReactNode;
  maxHeight?: number;
  className?: string;
  gradientColor?: string; // e.g. 'from-white'
}

/**
 * Collapsible message component
 * Automatically collapses content when it exceeds a certain height
 * Used for long AI responses to improve readability
 */
export const CollapsibleMessage = ({
  children,
  maxHeight = 400, // Default to ~15-20 lines
  className = '',
  gradientColor = 'from-white',
}: CollapsibleMessageProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      // Check if content exceeds max height
      // We use a small buffer (20px) to avoid collapsing if it's just barely over
      setIsOverflowing(contentRef.current.scrollHeight > maxHeight + 20);
    }
  }, [children, maxHeight]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={contentRef}
        className={`transition-all duration-300 ${
          !isExpanded && isOverflowing ? 'overflow-hidden' : ''
        }`}
        style={{
          maxHeight: !isExpanded && isOverflowing ? `${maxHeight}px` : 'none',
        }}
      >
        {children}
      </div>

      {/* Expand Button Overlay */}
      {!isExpanded && isOverflowing && (
        <div
          className={`absolute bottom-0 left-0 right-0 flex items-end justify-center rounded-b-xl bg-gradient-to-t ${gradientColor} via-${gradientColor.replace('from-', '')}/90 to-transparent pb-2 pt-16`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(true);
            }}
            className="group flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-1.5 text-xs font-medium text-primary shadow-sm ring-1 ring-[hsl(var(--primary)/0.2)] backdrop-blur-sm transition-all hover:bg-[hsl(var(--primary)/0.06)] hover:opacity-90"
          >
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-hover:translate-y-0.5" />
            <span>展开全文</span>
          </button>
        </div>
      )}

      {/* Collapse Button (Bottom) */}
      {isExpanded && isOverflowing && (
        <div className="mt-4 flex justify-center border-t border-gray-100 pt-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(false);
              // Optional: Scroll partially up if needed
              // contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
            className="group flex items-center gap-1.5 rounded-full bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-700"
          >
            <ChevronUp className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5" />
            <span>收起</span>
          </button>
        </div>
      )}
    </div>
  );
};
