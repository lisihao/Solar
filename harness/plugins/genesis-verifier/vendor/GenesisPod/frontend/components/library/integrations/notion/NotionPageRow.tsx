'use client';

import { Check, ExternalLink } from 'lucide-react';
import type { NotionPage } from '@/services/notion/api';
import { formatDateSafe } from '@/lib/utils/date';

interface NotionPageRowProps {
  page: NotionPage;
  isSelected: boolean;
  onSelect: (pageId: string, e: React.MouseEvent) => void;
  onClick: (page: NotionPage) => void;
}

/**
 * Notion 页面行组件 (列表视图)
 * 显示单个 Notion 页面的列表行
 */
export function NotionPageRow({
  page,
  isSelected,
  onSelect,
  onClick,
}: NotionPageRowProps) {
  // 格式化日期
  const formatDate = (dateStr: string) => {
    return formatDateSafe(dateStr, 'date');
  };

  // 判断是否为 URL
  const isUrl = (str: string | null | undefined): boolean => {
    if (!str) return false;
    return str.startsWith('http://') || str.startsWith('https://');
  };

  // 渲染页面图标
  const renderPageIcon = () => {
    if (!page.icon) {
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded bg-gray-100">
          <svg
            className="h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
      );
    }

    if (isUrl(page.icon)) {
      return (
        <img src={page.icon} alt="" className="h-6 w-6 rounded object-cover" />
      );
    }

    return <span className="text-xl">{page.icon}</span>;
  };

  return (
    <div
      onClick={() => onClick(page)}
      className={`group flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-all hover:border-gray-300 hover:bg-gray-50 ${
        isSelected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
      }`}
    >
      {/* 选择框 */}
      <button
        onClick={(e) => onSelect(page.id, e)}
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-all ${
          isSelected
            ? 'border-blue-500 bg-blue-500'
            : 'border-gray-300 bg-white'
        }`}
      >
        {isSelected && <Check className="h-3 w-3 text-white" />}
      </button>

      {/* 图标 */}
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
        {renderPageIcon()}
      </div>

      {/* 页面名 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-sm font-medium text-gray-900 group-hover:text-blue-600"
            title={page.title || 'Untitled'}
          >
            {page.title || 'Untitled'}
          </span>
        </div>
        {/* 状态标签 */}
        <div className="mt-0.5 flex items-center gap-2">
          {page.isLocallyModified && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-600">
              <svg
                className="h-2.5 w-2.5"
                fill="currentColor"
                viewBox="0 0 8 8"
              >
                <circle cx="4" cy="4" r="3" />
              </svg>
              Modified
            </span>
          )}
          {page.linkedResourceId && (
            <span className="text-xs text-blue-600">Linked</span>
          )}
        </div>
      </div>

      {/* 修改日期 */}
      <div className="hidden w-28 flex-shrink-0 text-right sm:block">
        <span className="text-sm text-gray-500">
          {formatDate(page.notionUpdatedAt)}
        </span>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <a
          href={page.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          title="Open in Notion"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
