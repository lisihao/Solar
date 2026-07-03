/**
 * ChangeReviewPanel - 变更审核面板
 *
 * Phase 1.1: 信息展示优化
 *
 * 功能：
 * - 展示报告更新的变更摘要
 * - 支持逐条审核和批量确认
 * - 变更高亮显示（新增/修改/删除）
 * - 引用来源追溯
 */

'use client';

import React, { useState, useMemo } from 'react';
import {
  CheckCircle,
  XCircle,
  Plus,
  Minus,
  Edit3,
  ChevronDown,
  ChevronUp,
  CheckCheck,
  FileText,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { LoadingState } from '@/components/ui/states';

// ==================== Types ====================

export interface ReportChange {
  id: string;
  changeType: 'ADDED' | 'MODIFIED' | 'DELETED';
  sectionId?: string;
  sectionName?: string;
  previousContent?: string;
  currentContent: string;
  startOffset: number;
  endOffset: number;
  wordsDiff: number;
  confidence: number;
  checkedInAt: string | null;
  checkedInById: string | null;
  createdAt: string;
}

export interface ChangeSummary {
  totalChanges: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  wordsAdded: number;
  wordsRemoved: number;
  pendingCount: number;
  checkedInCount: number;
}

export interface ChangeReviewPanelProps {
  reportId: string;
  reportVersion: number;
  changes: ReportChange[];
  summary?: ChangeSummary;
  isLoading?: boolean;
  onCheckin: (changeId: string) => Promise<void>;
  onCheckinAll: (changeIds: string[]) => Promise<void>;
  onRevert?: (changeId: string) => Promise<void>;
  onViewInReport?: (change: ReportChange) => void;
}

// ==================== Styles ====================

const changeTypeStyles = {
  ADDED: {
    bg: 'bg-green-50 dark:bg-green-950/30',
    border: 'border-l-4 border-green-500',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    icon: Plus,
    label: '新增',
  },
  MODIFIED: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/30',
    border: 'border-l-4 border-yellow-500',
    badge:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    icon: Edit3,
    label: '修改',
  },
  DELETED: {
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-l-4 border-red-500',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    icon: Minus,
    label: '删除',
  },
};

// ==================== Sub Components ====================

/**
 * 变更摘要卡片
 */
function ChangeSummaryCard({ summary }: { summary: ChangeSummary }) {
  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
        本次更新概览
      </h3>

      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        {/* 新增 */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
            <Plus className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              {summary.addedCount} 处
            </div>
            <div className="text-xs text-gray-500">
              +{summary.wordsAdded} 字
            </div>
          </div>
        </div>

        {/* 修改 */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900">
            <Edit3 className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              {summary.modifiedCount} 处
            </div>
            <div className="text-xs text-gray-500">修改</div>
          </div>
        </div>

        {/* 删除 */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
            <Minus className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              {summary.deletedCount} 处
            </div>
            <div className="text-xs text-gray-500">
              -{summary.wordsRemoved} 字
            </div>
          </div>
        </div>

        {/* 待确认 */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
            <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              {summary.pendingCount} 处
            </div>
            <div className="text-xs text-gray-500">待确认</div>
          </div>
        </div>
      </div>

      {/* 进度条 */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-gray-500">
          <span>审核进度</span>
          <span>
            {summary.checkedInCount}/{summary.totalChanges}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{
              width: `${
                summary.totalChanges > 0
                  ? (summary.checkedInCount / summary.totalChanges) * 100
                  : 0
              }%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * 单条变更卡片
 */
function ChangeCard({
  change,
  isExpanded,
  isChecking,
  onToggle,
  onCheckin,
  onRevert,
  onViewInReport,
}: {
  change: ReportChange;
  isExpanded: boolean;
  isChecking: boolean;
  onToggle: () => void;
  onCheckin: () => void;
  onRevert?: () => void;
  onViewInReport?: () => void;
}) {
  const style = changeTypeStyles[change.changeType];
  const Icon = style.icon;
  const isCheckedIn = !!change.checkedInAt;

  return (
    <div
      className={cn(
        'rounded-lg border transition-all duration-200',
        style.bg,
        style.border,
        isCheckedIn && 'opacity-60'
      )}
    >
      {/* 头部 */}
      <div
        className="flex cursor-pointer items-center justify-between p-3"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {/* 类型图标 */}
          <div
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full',
              style.badge
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>

          {/* 章节名称 */}
          <div>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {change.sectionName || '未分类内容'}
            </span>
            <span
              className={cn('ml-2 rounded px-1.5 py-0.5 text-xs', style.badge)}
            >
              {style.label}
            </span>
          </div>

          {/* 字数变化 */}
          {change.wordsDiff !== 0 && (
            <span
              className={cn(
                'text-xs',
                change.wordsDiff > 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              )}
            >
              {change.wordsDiff > 0 ? '+' : ''}
              {change.wordsDiff} 字
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 状态标记 */}
          {isCheckedIn ? (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              已确认
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <AlertCircle className="h-4 w-4" />
              待确认
            </span>
          )}

          {/* 展开/收起 */}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </div>

      {/* 展开内容 */}
      {isExpanded && (
        <div className="border-t border-gray-200 px-3 pb-3 pt-3 dark:border-gray-700">
          {/* 变更对比 */}
          <div className="mb-3 space-y-2">
            {/* 删除的内容 */}
            {change.previousContent && change.changeType !== 'ADDED' && (
              <div className="rounded bg-red-50 p-2 dark:bg-red-950/50">
                <div className="mb-1 text-xs font-medium text-red-600 dark:text-red-400">
                  原内容：
                </div>
                <div className="text-sm text-red-800 line-through dark:text-red-200">
                  {change.previousContent.length > 300
                    ? change.previousContent.slice(0, 300) + '...'
                    : change.previousContent}
                </div>
              </div>
            )}

            {/* 新增/修改后的内容 */}
            {change.changeType !== 'DELETED' && (
              <div className="rounded bg-green-50 p-2 dark:bg-green-950/50">
                <div className="mb-1 text-xs font-medium text-green-600 dark:text-green-400">
                  {change.changeType === 'ADDED' ? '新内容：' : '修改后：'}
                </div>
                <div className="text-sm text-green-800 dark:text-green-200">
                  {change.currentContent.length > 300
                    ? change.currentContent.slice(0, 300) + '...'
                    : change.currentContent}
                </div>
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          {!isCheckedIn && (
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCheckin();
                }}
                disabled={isChecking}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors',
                  'bg-green-500 text-white hover:bg-green-600',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                <CheckCircle className="h-4 w-4" />
                {isChecking ? '确认中...' : '确认变更'}
              </button>

              {onRevert && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRevert();
                  }}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/50"
                >
                  <XCircle className="h-4 w-4" />
                  撤销变更
                </button>
              )}

              {onViewInReport && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewInReport();
                  }}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <FileText className="h-4 w-4" />
                  在报告中查看
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== Main Component ====================

export function ChangeReviewPanel({
  reportId,
  reportVersion,
  changes,
  summary: providedSummary,
  isLoading = false,
  onCheckin,
  onCheckinAll,
  onRevert,
  onViewInReport,
}: ChangeReviewPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [isCheckingAll, setIsCheckingAll] = useState(false);

  // 计算摘要
  const summary = useMemo<ChangeSummary>(() => {
    if (providedSummary) return providedSummary;

    return changes.reduce(
      (acc, change) => {
        acc.totalChanges++;
        if (change.changeType === 'ADDED') {
          acc.addedCount++;
          acc.wordsAdded += Math.max(0, change.wordsDiff);
        } else if (change.changeType === 'MODIFIED') {
          acc.modifiedCount++;
          if (change.wordsDiff > 0) acc.wordsAdded += change.wordsDiff;
          else acc.wordsRemoved += Math.abs(change.wordsDiff);
        } else if (change.changeType === 'DELETED') {
          acc.deletedCount++;
          acc.wordsRemoved += Math.abs(change.wordsDiff);
        }
        if (change.checkedInAt) acc.checkedInCount++;
        else acc.pendingCount++;
        return acc;
      },
      {
        totalChanges: 0,
        addedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        wordsAdded: 0,
        wordsRemoved: 0,
        pendingCount: 0,
        checkedInCount: 0,
      } as ChangeSummary
    );
  }, [changes, providedSummary]);

  // 待确认的变更
  const pendingChanges = useMemo(
    () => changes.filter((c) => !c.checkedInAt),
    [changes]
  );

  // 切换展开状态
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 确认单条变更
  const handleCheckin = async (changeId: string) => {
    setCheckingIds((prev) => new Set(prev).add(changeId));
    try {
      await onCheckin(changeId);
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(changeId);
        return next;
      });
    }
  };

  // 确认所有变更
  const handleCheckinAll = async () => {
    const pendingIds = pendingChanges.map((c) => c.id);
    if (pendingIds.length === 0) return;

    setIsCheckingAll(true);
    try {
      await onCheckinAll(pendingIds);
    } finally {
      setIsCheckingAll(false);
    }
  };

  // 加载状态
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingState text="加载变更记录..." />
      </div>
    );
  }

  // 无变更
  if (changes.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <CheckCircle className="mb-3 h-12 w-12 text-green-500" />
        <div className="mb-1 text-lg font-medium text-gray-900 dark:text-white">
          暂无变更记录
        </div>
        <div className="text-sm text-gray-500">
          当前版本 (v{reportVersion}) 没有检测到内容变更
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          报告更新审核 (v{reportVersion})
        </h2>

        {/* 全部确认按钮 */}
        {summary.pendingCount > 0 && (
          <button
            onClick={handleCheckinAll}
            disabled={isCheckingAll}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-blue-500 text-white hover:bg-blue-600',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            <CheckCheck className="h-4 w-4" />
            {isCheckingAll ? '确认中...' : `全部确认 (${summary.pendingCount})`}
          </button>
        )}
      </div>

      {/* 摘要卡片 */}
      <ChangeSummaryCard summary={summary} />

      {/* 变更列表 */}
      <div className="space-y-3">
        {changes.map((change) => (
          <ChangeCard
            key={change.id}
            change={change}
            isExpanded={expandedIds.has(change.id)}
            isChecking={checkingIds.has(change.id)}
            onToggle={() => toggleExpand(change.id)}
            onCheckin={() => handleCheckin(change.id)}
            onRevert={onRevert ? () => onRevert(change.id) : undefined}
            onViewInReport={
              onViewInReport ? () => onViewInReport(change) : undefined
            }
          />
        ))}
      </div>

      {/* 全部确认提示 */}
      {summary.pendingCount === 0 && summary.totalChanges > 0 && (
        <div className="rounded-lg bg-green-50 py-4 text-center dark:bg-green-950/30">
          <CheckCircle className="mx-auto mb-2 h-8 w-8 text-green-500" />
          <div className="text-sm font-medium text-green-700 dark:text-green-300">
            所有变更已确认
          </div>
        </div>
      )}
    </div>
  );
}

export default ChangeReviewPanel;
