'use client';

/**
 * Slides Toolbar Components
 *
 * 包含 Header、ExportDropdown 和 ProgressBar 组件
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  History,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  ChevronDown,
  Sparkles,
  LayoutGrid,
  List,
  Plus,
  ArrowLeft,
  Play,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useSlidesStore, selectOverallProgress, toast } from '@/stores';
import { useCheckpoints } from '@/hooks/features/slides';
import { SlidesHistoryItem, formatRelativeTime } from '@/stores';
import { config } from '@/lib/utils/config';
import { AIAssistMenu } from './AIAssistMenu';
import { AIEditDropdown } from './AIEditDropdown';

import { logger } from '@/lib/utils/logger';
import { useI18n } from '@/lib/i18n/i18n-context';
// ============================================================================
// Header 组件
// ============================================================================

interface HeaderProps {
  title?: string;
  showHistory: boolean;
  onToggleHistory: () => void;
  onCreateCheckpoint: () => void;
  onBackToGallery?: () => void;
  viewMode?: 'grid' | 'list';
  onViewModeChange?: (mode: 'grid' | 'list') => void;
  onNewClick?: () => void;
  onStartPresentation?: () => void;
  onSmartTags?: () => Promise<void>;
  showViewToggle?: boolean;
  showBackButton?: boolean;
  hasPages?: boolean;
  // V5.0: AI Edit
  sessionId?: string;
  selectedPageIndex?: number;
  onAIEditComplete?: (action: string, result: unknown) => void;
}

export function Header({
  title,
  showHistory,
  onToggleHistory,
  onCreateCheckpoint,
  onBackToGallery,
  viewMode,
  onViewModeChange,
  onNewClick,
  onStartPresentation,
  onSmartTags,
  showViewToggle = false,
  showBackButton = false,
  hasPages = false,
  sessionId,
  selectedPageIndex,
  onAIEditComplete,
}: HeaderProps) {
  const { t } = useI18n();
  const [showExportMenu, setShowExportMenu] = useState(false);

  return (
    <header className="flex-shrink-0 border-b border-gray-200 bg-white">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          {/* 返回按钮 */}
          {showBackButton && onBackToGallery && (
            <button
              onClick={onBackToGallery}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              title={t('office.slides.backToHistory')}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">
              {title || t('office.slides.title')}
            </h1>
            <p className="text-xs text-gray-500">
              {t('office.slides.smartPPTGeneration')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 新建按钮 */}
          {onNewClick && (
            <button
              onClick={onNewClick}
              className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
            >
              <Plus className="h-4 w-4" />
              {t('office.slides.new')}
            </button>
          )}

          {/* AI 辅助菜单 - 首页显示在新建按钮旁 */}
          {onNewClick && (
            <AIAssistMenu onSmartTags={onSmartTags} disabled={!hasPages} />
          )}

          {/* 视图切换 */}
          {showViewToggle && viewMode && onViewModeChange && (
            <div className="flex items-center rounded-lg border border-gray-200 p-1">
              <button
                onClick={() => onViewModeChange('grid')}
                className={cn(
                  'rounded p-1.5 transition-colors',
                  viewMode === 'grid'
                    ? 'bg-orange-100 text-orange-600'
                    : 'text-gray-400 hover:text-gray-600'
                )}
                title={t('office.slides.gridView')}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => onViewModeChange('list')}
                className={cn(
                  'rounded p-1.5 transition-colors',
                  viewMode === 'list'
                    ? 'bg-orange-100 text-orange-600'
                    : 'text-gray-400 hover:text-gray-600'
                )}
                title={t('office.slides.listView')}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* 历史记录 - 仅在首页显示，编辑页隐藏 */}
          {!showBackButton && (
            <button
              onClick={onToggleHistory}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors',
                showHistory
                  ? 'bg-orange-100 text-orange-600'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              <History className="h-4 w-4" />
              {t('office.slides.history')}
            </button>
          )}

          {/* 创建保存点 */}
          <button
            onClick={onCreateCheckpoint}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            <Save className="h-4 w-4" />
            {t('office.slides.createCheckpoint')}
          </button>

          {/* AI 辅助菜单 */}
          {hasPages && (
            <AIAssistMenu onSmartTags={onSmartTags} disabled={false} />
          )}

          {/* V5.0: AI Edit Dropdown */}
          {hasPages && sessionId && (
            <AIEditDropdown
              sessionId={sessionId}
              pageIndex={selectedPageIndex}
              onEditComplete={onAIEditComplete}
            />
          )}

          {/* 播放演示 */}
          {hasPages && onStartPresentation && (
            <button
              onClick={onStartPresentation}
              className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm text-white hover:bg-orange-600"
            >
              <Play className="h-4 w-4" />
              {t('office.slides.play')}
            </button>
          )}

          {/* 导出 */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
            >
              <Download className="h-4 w-4" />
              {t('office.slides.export')}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showExportMenu && (
              <ExportDropdown onClose={() => setShowExportMenu(false)} />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// ============================================================================
// 历史记录面板
// ============================================================================

interface HistoryPanelProps {
  show: boolean;
  history: SlidesHistoryItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onRestore: (item: SlidesHistoryItem) => void;
}

export function HistoryPanel({
  show,
  history,
  onRemove,
  onClear,
  onRestore,
}: HistoryPanelProps) {
  const { t } = useI18n();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden border-b border-gray-200 bg-gray-50"
        >
          <div className="max-h-[280px] overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">
                {t('office.slides.generationHistory')}
              </h3>
              {history.length > 0 && (
                <button
                  onClick={onClear}
                  className="text-xs text-red-500 hover:text-red-600"
                >
                  {t('office.slides.clear')}
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-400">
                {t('office.slides.noHistory')}
              </p>
            ) : (
              <div className="space-y-2">
                {history.slice(0, 20).map((item) => (
                  <div
                    key={item.id}
                    onClick={() => item.sessionId && onRestore(item)}
                    className={cn(
                      'flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 transition-colors',
                      item.sessionId
                        ? 'cursor-pointer hover:border-orange-300 hover:bg-orange-50'
                        : 'hover:border-gray-300'
                    )}
                  >
                    <div className="mr-2 min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {item.title}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          {formatRelativeTime(item.timestamp)}
                        </span>
                        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-600">
                          {t('office.slides.pageCount', {
                            count: item.targetPages || 0,
                          })}
                        </span>
                        {item.status === 'success' ? (
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                        ) : item.status === 'error' ? (
                          <AlertCircle className="h-3 w-3 text-red-500" />
                        ) : (
                          <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                        )}
                        {item.sessionId && (
                          <span className="text-xs text-orange-500">
                            {t('office.slides.clickToRestore')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(item.id);
                        }}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-500"
                        title={t('common.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// 导出下拉菜单
// ============================================================================

interface ExportDropdownProps {
  onClose: () => void;
}

export function ExportDropdown({ onClose }: ExportDropdownProps) {
  const { t } = useI18n();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { session } = useSlidesStore();
  const [exporting, setExporting] = useState<'pptx' | 'pdf' | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleExport = useCallback(
    async (format: 'pptx' | 'pdf') => {
      if (!session?.id) {
        toast.warning(t('office.slides.pleaseGenerateFirst'));
        return;
      }

      setExporting(format);
      try {
        const response = await fetch(
          `${config.apiUrl}/ai-office/slides/sessions/${session.id}/export`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              format,
              quality: 'high',
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message ||
              t('office.slides.exportFailed', { message: response.status })
          );
        }

        // 获取文件名
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `slides.${format}`;
        if (contentDisposition) {
          const match = contentDisposition.match(/filename="?([^"]+)"?/);
          if (match) {
            filename = match[1];
          }
        }

        // 下载文件
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        onClose();
      } catch (error: unknown) {
        logger.error('Export failed:', error);
        toast.error(
          error instanceof Error
            ? error.message
            : t('office.slides.exportError')
        );
      } finally {
        setExporting(null);
      }
    },
    [session?.id, onClose, t]
  );

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-2 shadow-lg"
    >
      <button
        onClick={() => handleExport('pptx')}
        disabled={exporting !== null || !session?.id}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {exporting === 'pptx' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
        {t('office.slides.exportPPTX')}
      </button>
      <button
        onClick={() => handleExport('pdf')}
        disabled={exporting !== null || !session?.id}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {exporting === 'pdf' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
        {t('office.slides.exportPDF')}
      </button>
    </div>
  );
}

// ============================================================================
// ProgressBar 组件
// ============================================================================

export function ProgressBar() {
  const { t } = useI18n();
  const overallProgress = useSlidesStore(selectOverallProgress);
  const { progress, pages, generating } = useSlidesStore();
  const { checkpoints } = useCheckpoints();

  if (!generating && pages.length === 0) {
    return null;
  }

  const completedPages = pages.filter((p) => p.status === 'completed').length;
  const latestCheckpoint = checkpoints[0];

  return (
    <div className="flex h-12 flex-shrink-0 items-center justify-between border-t border-gray-200 bg-white px-6">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-48 overflow-hidden rounded-full bg-gray-200">
            <motion.div
              className="h-full bg-gradient-to-r from-orange-500 to-orange-400"
              initial={{ width: 0 }}
              animate={{ width: `${overallProgress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <span className="text-sm font-medium text-gray-700">
            {overallProgress}%
          </span>
        </div>

        <span className="text-sm text-gray-500">
          {t('office.slides.pageCount', {
            count: `${completedPages} / ${pages.length}`,
          })}
        </span>
      </div>

      {latestCheckpoint && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Save className="h-4 w-4" />
          <span>
            {t('office.slides.checkpoint', { name: latestCheckpoint.name })}
          </span>
        </div>
      )}
    </div>
  );
}
