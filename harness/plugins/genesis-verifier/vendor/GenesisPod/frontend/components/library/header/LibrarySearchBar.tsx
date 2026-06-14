'use client';

import { Search, X } from 'lucide-react';

interface LibrarySearchBarProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * 知识库搜索框（单行紧凑）。
 * 从 LibraryHeader 拆出 —— 学习 Agent 市场范式：Tab 在上、搜索在下。
 */
export default function LibrarySearchBar({
  placeholder,
  value,
  onChange,
}: LibrarySearchBarProps) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-9 text-sm shadow-sm placeholder:text-gray-400 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
