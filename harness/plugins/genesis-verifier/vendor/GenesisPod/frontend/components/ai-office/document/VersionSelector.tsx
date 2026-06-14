'use client';

/**
 * Genspark 风格版本选择器
 * 下拉式版本切换，显示保存点列表
 */

import React, { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  ChevronDownIcon,
  ClockIcon,
  SparklesIcon,
  PencilIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import type { DocumentVersion } from '@/lib/types/ai-office';
import { useDocumentStore } from '@/stores/aiOfficeStore';

interface VersionSelectorProps {
  documentId: string;
  onOpenHistory?: () => void; // 打开完整版本历史弹窗
}

export default function VersionSelector({
  documentId,
  onOpenHistory,
}: VersionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 从store中读取document和versions
  const currentDocument = useDocumentStore((state) =>
    state.documents.find((d) => d._id === documentId)
  );
  const { restoreVersion, saveVersion } = useDocumentStore();

  const versions = currentDocument?.versions || [];
  const currentVersionId = currentDocument?.currentVersionId;

  // 按时间倒序排列
  const sortedVersions = [...versions].sort(
    (a: DocumentVersion, b: DocumentVersion) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // 当前版本信息
  const currentVersion = versions.find(
    (v: DocumentVersion) => v.id === currentVersionId
  );
  const currentVersionIndex = sortedVersions.findIndex(
    (v: DocumentVersion) => v.id === currentVersionId
  );

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getVersionIcon = (trigger: DocumentVersion['trigger']) => {
    switch (trigger) {
      case 'ai_generation':
        return <SparklesIcon className="h-4 w-4 text-purple-500" />;
      case 'user_edit':
        return <PencilIcon className="h-4 w-4 text-blue-500" />;
      case 'manual_save':
        return <CheckCircleIcon className="h-4 w-4 text-green-500" />;
      default:
        return <ClockIcon className="h-4 w-4 text-gray-500" />;
    }
  };

  const getVersionLabel = (trigger: DocumentVersion['trigger']) => {
    switch (trigger) {
      case 'ai_generation':
        return 'AI生成';
      case 'user_edit':
        return '编辑';
      case 'manual_save':
        return '手动保存';
      default:
        return '自动保存';
    }
  };

  const handleVersionSelect = (versionId: string) => {
    if (versionId !== currentVersionId) {
      restoreVersion(documentId, versionId);
    }
    setIsOpen(false);
  };

  const handleManualSave = () => {
    saveVersion(documentId, 'manual', 'manual_save', '手动保存');
    setIsOpen(false);
  };

  // 如果没有版本，显示简化版
  if (versions.length === 0) {
    return (
      <button
        onClick={handleManualSave}
        className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
      >
        <CheckCircleIcon className="h-4 w-4" />
        <span>创建保存点</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* 触发器按钮 - Genspark 风格 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="hover:to-gray-150 flex items-center gap-2 rounded-lg bg-gradient-to-r from-gray-50 to-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-all hover:from-gray-100 hover:shadow"
      >
        {currentVersion ? (
          <>
            {getVersionIcon(currentVersion.trigger)}
            <span className="max-w-[120px] truncate">
              保存点-
              {currentVersionIndex >= 0
                ? sortedVersions.length - currentVersionIndex
                : versions.length}
            </span>
          </>
        ) : (
          <>
            <ClockIcon className="h-4 w-4" />
            <span>最新版本</span>
          </>
        )}
        <ChevronDownIcon
          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5">
          {/* 头部操作栏 */}
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
            <span className="text-xs font-medium text-gray-500">
              共 {versions.length} 个保存点
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleManualSave}
                className="rounded-md bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600"
              >
                新建保存点
              </button>
              {onOpenHistory && (
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onOpenHistory();
                  }}
                  className="rounded-md bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-300"
                >
                  查看全部
                </button>
              )}
            </div>
          </div>

          {/* 版本列表 */}
          <div className="max-h-64 overflow-y-auto">
            {sortedVersions
              .slice(0, 10)
              .map((version: DocumentVersion, index: number) => {
                const isCurrent = version.id === currentVersionId;
                const versionNumber = sortedVersions.length - index;

                return (
                  <button
                    key={version.id}
                    onClick={() => handleVersionSelect(version.id)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                      isCurrent ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* 图标 */}
                    <div className="mt-0.5 flex-shrink-0">
                      {getVersionIcon(version.trigger)}
                    </div>

                    {/* 内容 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium ${isCurrent ? 'text-blue-700' : 'text-gray-900'}`}
                        >
                          保存点-{versionNumber}
                        </span>
                        {isCurrent && (
                          <span className="rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            当前
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                        <span>{getVersionLabel(version.trigger)}</span>
                        <span>·</span>
                        <span>
                          {format(new Date(version.timestamp), 'MM/dd HH:mm', {
                            locale: zhCN,
                          })}
                        </span>
                      </div>
                      {version.metadata.description && (
                        <p className="mt-1 truncate text-xs text-gray-600">
                          {version.metadata.description}
                        </p>
                      )}
                      {version.metadata.slideCount && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          {version.metadata.slideCount} 页
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>

          {/* 底部提示 */}
          {versions.length > 10 && (
            <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-center">
              <button
                onClick={() => {
                  setIsOpen(false);
                  onOpenHistory?.();
                }}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                查看更多 ({versions.length - 10} 个隐藏)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
