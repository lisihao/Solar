'use client';

import { LayoutGrid, List } from 'lucide-react';

export type ViewMode = 'grid' | 'list';

interface ViewToggleProps {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}

/**
 * 视图切换组件 - Grid/List 视图切换
 * 可复用于 Google Drive、Notion 等文件列表
 */
export function ViewToggle({
  viewMode,
  onChange,
  className = '',
}: ViewToggleProps) {
  return (
    <div
      className={`flex items-center rounded-lg border border-gray-200 bg-white p-0.5 ${className}`}
    >
      <button
        onClick={() => onChange('grid')}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
          viewMode === 'grid'
            ? 'bg-gray-900 text-white'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`}
        title="Grid view"
      >
        <LayoutGrid className="h-4 w-4" />
        <span className="hidden sm:inline">Grid</span>
      </button>
      <button
        onClick={() => onChange('list')}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
          viewMode === 'list'
            ? 'bg-gray-900 text-white'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`}
        title="List view"
      >
        <List className="h-4 w-4" />
        <span className="hidden sm:inline">List</span>
      </button>
    </div>
  );
}
