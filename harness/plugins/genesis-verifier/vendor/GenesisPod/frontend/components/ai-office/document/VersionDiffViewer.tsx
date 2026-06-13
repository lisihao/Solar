'use client';

/**
 * 版本对比差异查看器
 * 展示两个文档版本之间的详细差异
 */

import React, { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { DocumentVersion } from '@/lib/types/ai-office';
import { logger } from '@/lib/utils/logger';
import {
  comparePPTVersions,
  compareDocVersions,
  getDiffColor,
  getDiffIcon,
  type VersionComparison,
  type DiffChange,
} from '@/lib/utils/version-diff';

interface VersionDiffViewerProps {
  oldVersion: DocumentVersion;
  newVersion: DocumentVersion;
  documentType: 'ppt' | 'doc';
  onClose: () => void;
}

export default function VersionDiffViewer({
  oldVersion,
  newVersion,
  documentType,
  onClose,
}: VersionDiffViewerProps) {
  // 计算版本对比结果
  const comparison: VersionComparison | null = useMemo(() => {
    try {
      const oldContent =
        'markdown' in oldVersion.content
          ? oldVersion.content.markdown || ''
          : '';
      const newContent =
        'markdown' in newVersion.content
          ? newVersion.content.markdown || ''
          : '';

      const oldMeta = {
        id: oldVersion.id,
        timestamp: new Date(oldVersion.timestamp),
        title: oldVersion.metadata.title || '旧版本',
      };

      const newMeta = {
        id: newVersion.id,
        timestamp: new Date(newVersion.timestamp),
        title: newVersion.metadata.title || '新版本',
      };

      if (documentType === 'ppt') {
        return comparePPTVersions(oldContent, newContent, oldMeta, newMeta);
      } else {
        return compareDocVersions(oldContent, newContent, oldMeta, newMeta);
      }
    } catch (error) {
      logger.error('版本对比失败:', error);
      return null;
    }
  }, [oldVersion, newVersion, documentType]);

  if (!comparison) {
    return (
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="text-center text-gray-500">
          <p>无法对比版本，请重试</p>
          <button
            onClick={onClose}
            className="mt-4 rounded bg-gray-200 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-300"
          >
            关闭
          </button>
        </div>
      </div>
    );
  }

  const { changes, stats, summary } = comparison;

  return (
    <div className="rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">版本对比</h3>
            <div className="mt-2 flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-500">旧版本:</span>
                <span className="font-medium text-gray-900">
                  {comparison.oldVersion.title}
                </span>
                <span className="text-gray-400">
                  {format(comparison.oldVersion.timestamp, 'yyyy-MM-dd HH:mm', {
                    locale: zhCN,
                  })}
                </span>
              </div>
              <span className="text-gray-400">→</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">新版本:</span>
                <span className="font-medium text-gray-900">
                  {comparison.newVersion.title}
                </span>
                <span className="text-gray-400">
                  {format(comparison.newVersion.timestamp, 'yyyy-MM-dd HH:mm', {
                    locale: zhCN,
                  })}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-gray-600"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Stats Summary */}
        <div className="mt-4 flex items-center gap-4">
          <div className="rounded-lg bg-gray-50 px-4 py-2">
            <span className="text-sm font-medium text-gray-700">{summary}</span>
          </div>
          <div className="flex gap-3 text-sm">
            {stats.added > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-green-600">➕</span>
                <span className="text-gray-700">
                  新增 <strong className="text-green-600">{stats.added}</strong>
                </span>
              </div>
            )}
            {stats.modified > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-yellow-600">✏️</span>
                <span className="text-gray-700">
                  修改{' '}
                  <strong className="text-yellow-600">{stats.modified}</strong>
                </span>
              </div>
            )}
            {stats.deleted > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-red-600">➖</span>
                <span className="text-gray-700">
                  删除 <strong className="text-red-600">{stats.deleted}</strong>
                </span>
              </div>
            )}
            {stats.unchanged > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-gray-400">✓</span>
                <span className="text-gray-500">未变 {stats.unchanged}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Changes List */}
      <div className="max-h-[60vh] overflow-y-auto p-6">
        {changes.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-16 w-16" />}
            title="两个版本内容相同"
            description="未检测到任何变化"
          />
        ) : (
          <div className="space-y-4">
            {changes.map((change, index) => (
              <DiffChangeCard key={index} change={change} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 单个差异项卡片
 */
function DiffChangeCard({ change }: { change: DiffChange }) {
  const colorClasses = getDiffColor(change.type);
  const icon = getDiffIcon(change.type);

  return (
    <div className={`rounded-lg border p-4 ${colorClasses}`}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <div>
            <h4 className="font-semibold">
              {change.section}: {change.sectionTitle}
            </h4>
            <p className="text-xs opacity-75">
              {change.type === 'added' && '新增内容'}
              {change.type === 'modified' && '内容已修改'}
              {change.type === 'deleted' && '已删除'}
              {change.type === 'unchanged' && '未变化'}
            </p>
          </div>
        </div>
      </div>

      {/* Change Details */}
      {change.changes.length > 0 && (
        <div className="space-y-2">
          {change.changes.map((detail, idx) => (
            <div key={idx} className="rounded bg-white/50 p-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 rounded bg-white px-1.5 py-0.5 text-xs font-medium opacity-75">
                  {detail.type === 'text' && '文本'}
                  {detail.type === 'structure' && '结构'}
                  {detail.type === 'metadata' && '元数据'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{detail.description}</p>
                  {detail.oldValue && detail.newValue && (
                    <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded bg-red-50 p-2">
                        <span className="font-medium text-red-700">旧:</span>{' '}
                        <span className="text-red-600">{detail.oldValue}</span>
                      </div>
                      <div className="rounded bg-green-50 p-2">
                        <span className="font-medium text-green-700">新:</span>{' '}
                        <span className="text-green-600">
                          {detail.newValue}
                        </span>
                      </div>
                    </div>
                  )}
                  {detail.oldValue && !detail.newValue && (
                    <div className="mt-1 rounded bg-red-50 p-2 text-xs">
                      <span className="font-medium text-red-700">删除:</span>{' '}
                      <span className="text-red-600">{detail.oldValue}</span>
                    </div>
                  )}
                  {!detail.oldValue && detail.newValue && (
                    <div className="mt-1 rounded bg-green-50 p-2 text-xs">
                      <span className="font-medium text-green-700">新增:</span>{' '}
                      <span className="text-green-600">{detail.newValue}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Content Preview (for added/deleted) */}
      {(change.type === 'added' || change.type === 'deleted') &&
        (change.newContent || change.oldContent) && (
          <div className="mt-3 rounded bg-white/50 p-3">
            <p className="mb-2 text-xs font-medium opacity-75">
              {change.type === 'added' ? '新增内容预览' : '删除内容预览'}
            </p>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs">
              {(change.newContent || change.oldContent || '').substring(0, 500)}
              {(change.newContent || change.oldContent || '').length > 500
                ? '\n...(已截断)'
                : ''}
            </pre>
          </div>
        )}

      {/* Modified Content Side-by-Side */}
      {change.type === 'modified' && change.oldContent && change.newContent && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded bg-red-50 p-3">
            <p className="mb-2 text-xs font-medium text-red-700">旧版本内容</p>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-red-600">
              {change.oldContent.substring(0, 300)}
              {change.oldContent.length > 300 ? '\n...' : ''}
            </pre>
          </div>
          <div className="rounded bg-green-50 p-3">
            <p className="mb-2 text-xs font-medium text-green-700">
              新版本内容
            </p>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-green-600">
              {change.newContent.substring(0, 300)}
              {change.newContent.length > 300 ? '\n...' : ''}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
