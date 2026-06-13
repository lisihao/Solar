'use client';

/**
 * 资源列表组件
 * 显示已选择的数据源（YouTube、Papers、Web等）
 */

import React from 'react';
import { useResourceStore } from '@/stores/aiOfficeStore';
import { Youtube, FileText, Globe, Plus, X } from 'lucide-react';
import type { Resource } from '@/lib/types/ai-office';
import { EmptyState } from '@/components/ui/states/EmptyState';

const getResourceIcon = (type: string) => {
  switch (type) {
    case 'youtube_video':
      return Youtube;
    case 'academic_paper':
      return FileText;
    case 'web_page':
      return Globe;
    default:
      return FileText;
  }
};

interface ResourceCardProps {
  resource: Resource;
}

function ResourceCard({ resource }: ResourceCardProps) {
  const { removeResource, selectResource, deselectResource } =
    useResourceStore();
  const selectedIds = useResourceStore((state) => state.selectedResourceIds);

  const isSelected = selectedIds.includes(resource._id);
  const Icon = getResourceIcon(resource.resourceType);

  // 获取资源的显示标题（根据类型不同，metadata结构不同）
  const getTitle = () => {
    if ('metadata' in resource && resource.metadata) {
      return resource.metadata.title || '无标题';
    }
    return '无标题';
  };

  const handleToggleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.target.checked
      ? selectResource(resource._id)
      : deselectResource(resource._id);
  };

  const statusText =
    resource.status === 'collected'
      ? '已采集'
      : resource.status === 'collecting'
        ? '采集中'
        : resource.status === 'failed'
          ? '失败'
          : '待采集';

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      {/* 复选框 */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={handleToggleSelect}
        className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        aria-label={`选择 ${getTitle()}`}
      />

      {/* 图标 */}
      <Icon className="h-5 w-5 flex-shrink-0 text-gray-600" />

      {/* 标题 - 可悬浮查看完整内容 */}
      <div className="min-w-0 flex-1">
        <h4
          className="truncate text-sm font-medium text-gray-900"
          title={getTitle()}
        >
          {getTitle()}
        </h4>
      </div>

      {/* 状态指示 */}
      <span
        className={`h-2 w-2 flex-shrink-0 rounded-full ${
          resource.status === 'collected'
            ? 'bg-green-500'
            : resource.status === 'collecting'
              ? 'animate-pulse bg-yellow-500'
              : resource.status === 'failed'
                ? 'bg-red-500'
                : 'bg-gray-400'
        }`}
        title={statusText}
      />

      {/* 移除按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          removeResource(resource._id);
        }}
        className="flex-shrink-0 rounded p-1 transition-colors hover:bg-gray-200"
        title="移除资源"
      >
        <X className="h-4 w-4 text-gray-500" />
      </button>
    </div>
  );
}

export default function ResourceList() {
  const resources = useResourceStore((state) => state.resources);
  const selectedResourceIds = useResourceStore(
    (state) => state.selectedResourceIds
  );
  const { selectResource, deselectResource, clearSelection } =
    useResourceStore();

  // 全选/取消全选
  const handleToggleSelectAll = () => {
    if (
      selectedResourceIds.length === resources.length &&
      resources.length > 0
    ) {
      clearSelection();
    } else {
      resources.forEach((resource) => selectResource(resource._id));
    }
  };

  const allSelected =
    resources.length > 0 && selectedResourceIds.length === resources.length;

  return (
    <div className="flex h-full flex-col">
      {/* 资源管理工具栏 */}
      {resources.length > 0 && (
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={handleToggleSelectAll}
              className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              title={allSelected ? '取消全选' : '全选'}
            />
            <span className="text-xs text-gray-600">
              已选 {selectedResourceIds.length}/{resources.length}
            </span>
          </div>
          {selectedResourceIds.length > 0 && (
            <button
              onClick={() => {
                selectedResourceIds.forEach((id) =>
                  useResourceStore.getState().removeResource(id)
                );
                clearSelection();
              }}
              className="text-xs font-medium text-red-600 hover:text-red-700"
            >
              删除选中
            </button>
          )}
        </div>
      )}

      {/* 资源列表 */}
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {resources.length === 0 ? (
          <EmptyState
            icon={<Plus className="h-12 w-12" />}
            title="还没有添加资源"
            description='在 Explore 页面点击"AI Reports"添加资源'
          />
        ) : (
          resources.map((resource) => (
            <ResourceCard key={resource._id} resource={resource} />
          ))
        )}
      </div>
    </div>
  );
}
