'use client';

/**
 * Report Edit Panel - 报告编辑面板
 *
 * 整合编辑、历史和批注功能的完整编辑面板
 * 参考 PRD: docs/prd/topic-research-report-editing.md
 *
 * 功能:
 * - 三种视图模式：预览/编辑/分屏
 * - AI 辅助编辑工具
 * - 版本历史管理
 * - 批注协作功能
 * - 快捷键支持
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { ReportEditor } from './ReportEditor';
import { ReportRevisionHistory } from './ReportRevisionHistory';
import { ReportAnnotations } from '@/components/common/annotations/ReportAnnotations';
import { ReportChartRenderer } from '@/components/common/chart-viewer/ReportChartRenderer';
import type { TopicReport, TopicEvidence } from '@/lib/types/topic-insights';
import type { AIEditOperation, TextSelection } from '../types';

import { logger } from '@/lib/utils/logger';
import { LoadingState } from '@/components/ui/states';
// View modes - removed split mode (space is limited)
type ViewMode = 'preview' | 'edit';

// Report revision type (compatible with both TopicContentPanel and ReportRevisionHistory)
interface ReportRevision {
  id: string;
  version: number;
  createdAt: string | Date;
  summary?: string;
  // Optional fields for full revision history
  title?: string;
  changeType?: 'create' | 'edit' | 'ai_edit' | 'rollback';
  changeDescription?: string;
  author?: string;
  wordCount?: number;
  wordCountDelta?: number;
}

// Annotation type (matching existing component)
interface ReportAnnotation {
  id: string;
  reportId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  selectedText: string;
  content: string;
  startOffset: number;
  endOffset: number;
  sectionId?: string;
  color: 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
  status: 'active' | 'resolved' | 'archived';
  createdAt: string;
  updatedAt: string;
  replies?: AnnotationReply[];
}

interface AnnotationReply {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  content: string;
  createdAt: string;
}

// Side panel type - exported for parent component use
export type SidePanelType = null | 'history' | 'annotations';

interface ReportEditPanelProps {
  report: TopicReport | null;
  evidence: TopicEvidence[];
  revisions?: ReportRevision[];
  annotations?: ReportAnnotation[];
  currentUserId?: string;
  currentUserName?: string;
  isLoading?: boolean;
  // Toolbar control
  hideToolbar?: boolean;
  // Disable internal side panel when parent handles it (e.g., fullscreen mode)
  disableSidePanel?: boolean;
  // Side panel control from parent
  sidePanelType?: SidePanelType;
  onSidePanelChange?: (type: SidePanelType) => void;
  onSave?: (content: string) => Promise<void>;
  /**
   * New AI edit callback - opens modal for AI editing
   * (Preferred over onAIEdit)
   */
  onOpenAIEdit?: (selection: {
    text: string;
    startOffset: number;
    endOffset: number;
    selectorPrefix?: string;
    selectorSuffix?: string;
  }) => void;
  /**
   * Legacy AI edit callback
   * @deprecated Use onOpenAIEdit instead
   */
  onAIEdit?: (
    operation: AIEditOperation,
    selection?: TextSelection
  ) => Promise<string>;
  onRollback?: (revisionId: string) => Promise<void>;
  onAnnotationAdd?: (
    annotation: Omit<
      ReportAnnotation,
      'id' | 'createdAt' | 'updatedAt' | 'replies'
    >
  ) => Promise<void>;
  onAnnotationUpdate?: (annotationId: string, content: string) => Promise<void>;
  onAnnotationDelete?: (annotationId: string) => Promise<void>;
  onAnnotationResolve?: (annotationId: string) => Promise<void>;
  onAnnotationReply?: (annotationId: string, content: string) => Promise<void>;
  onSubmitFeedback?: (annotationId: string) => Promise<void>;
}

// Icons
const HistoryIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const AnnotationIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
    />
  </svg>
);

const SaveIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
    />
  </svg>
);

const ExportIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
    />
  </svg>
);

const CloseIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
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
);

export function ReportEditPanel({
  report,
  evidence,
  revisions = [],
  annotations = [],
  currentUserId,
  currentUserName,
  isLoading = false,
  hideToolbar = false,
  disableSidePanel = false,
  sidePanelType: externalSidePanelType,
  onSidePanelChange,
  onSave,
  onOpenAIEdit,
  onAIEdit,
  onRollback,
  onAnnotationAdd,
  onAnnotationUpdate,
  onAnnotationDelete,
  onAnnotationResolve,
  onAnnotationReply,
  onSubmitFeedback,
}: ReportEditPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [internalSidePanelType, setInternalSidePanelType] =
    useState<SidePanelType>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Use external state if provided, otherwise use internal state
  const sidePanelType =
    externalSidePanelType !== undefined
      ? externalSidePanelType
      : internalSidePanelType;

  // Helper to toggle side panel that works with both internal and external state
  const toggleSidePanel = useCallback(
    (panel: 'history' | 'annotations') => {
      const newValue = sidePanelType === panel ? null : panel;
      if (onSidePanelChange) {
        onSidePanelChange(newValue);
      } else {
        setInternalSidePanelType(newValue);
      }
    },
    [sidePanelType, onSidePanelChange]
  );

  // Direct setter for side panel
  const setSidePanelType = useCallback(
    (value: SidePanelType) => {
      if (onSidePanelChange) {
        onSidePanelChange(value);
      } else {
        setInternalSidePanelType(value);
      }
    },
    [onSidePanelChange]
  );

  // State for highlighted annotation (for navigation from annotation panel)
  const [highlightedAnnotationId, setHighlightedAnnotationId] = useState<
    string | null
  >(null);

  // Handle navigation to annotation in report
  const handleNavigateToAnnotation = useCallback((annotationId: string) => {
    setHighlightedAnnotationId(annotationId);
    // Auto-clear highlight after 3 seconds
    setTimeout(() => {
      setHighlightedAnnotationId(null);
    }, 3000);
  }, []);

  // Handle annotation add from context menu
  const handleAddAnnotationFromMenu = useCallback(
    (data: {
      selectedText: string;
      startOffset: number;
      endOffset: number;
      color: 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
    }) => {
      if (!onAnnotationAdd || !report) return;

      // Create full annotation object
      const annotation: Omit<
        ReportAnnotation,
        'id' | 'createdAt' | 'updatedAt' | 'replies'
      > = {
        reportId: report.id,
        userId: currentUserId || 'anonymous',
        userName: currentUserName || '匿名用户',
        selectedText: data.selectedText,
        content: '', // Empty content, user will fill in the annotation panel
        startOffset: data.startOffset,
        endOffset: data.endOffset,
        color: data.color,
        status: 'active',
      };

      onAnnotationAdd(annotation);
      // Open annotation panel to let user add content
      setSidePanelType('annotations');
    },
    [onAnnotationAdd, report, currentUserId, currentUserName]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+1: Preview mode
      if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        setViewMode('preview');
      }
      // Ctrl+2: Edit mode
      else if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        setViewMode('edit');
      }
      // Ctrl+H: History panel
      else if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        toggleSidePanel('history');
      }
      // Ctrl+M: Annotations panel
      else if (e.ctrlKey && e.key === 'm') {
        e.preventDefault();
        toggleSidePanel('annotations');
      }
      // Ctrl+S: Save (if in edit mode)
      else if (e.ctrlKey && e.key === 's' && viewMode === 'edit') {
        e.preventDefault();
        // Note: onSave is handled by ReportEditor component internally
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, toggleSidePanel]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!onSave) return;

    setIsSaving(true);
    try {
      // Save is handled by ReportEditor component
      // This is just a wrapper for potential additional logic
    } catch (error) {
      logger.error('Save failed:', error);
    } finally {
      setIsSaving(false);
    }
  }, [onSave]);

  // Current version
  const currentVersion = useMemo(() => {
    if (!report) return 0;
    return report.version;
  }, [report]);

  // Convert revisions to full format for ReportRevisionHistory
  const fullRevisions = useMemo(() => {
    return revisions.map((rev) => ({
      id: rev.id,
      version: rev.version,
      title: rev.title || `版本 ${rev.version}`,
      summary: rev.summary || '',
      changeType: rev.changeType || ('edit' as const),
      changeDescription: rev.changeDescription || rev.summary || '报告更新',
      author: rev.author || '未知',
      createdAt:
        typeof rev.createdAt === 'string'
          ? rev.createdAt
          : rev.createdAt.toISOString(),
      wordCount: rev.wordCount || 0,
      wordCountDelta: rev.wordCountDelta || 0,
    }));
  }, [revisions]);

  // Stats
  const stats = useMemo(() => {
    const activeAnnotations = annotations.filter(
      (a) => a.status === 'active'
    ).length;
    return {
      version: currentVersion,
      revisions: revisions.length,
      annotations: annotations.length,
      activeAnnotations,
    };
  }, [currentVersion, revisions.length, annotations]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingState text="加载报告..." />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Toolbar - conditionally hidden */}
      {!hideToolbar && (
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 shadow-sm">
          {/* Left: Title */}
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">
              {report?.title || '洞察报告'}
            </h2>
            <span className="text-sm text-gray-400">v{stats.version}</span>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* History button */}
            <button
              onClick={() => toggleSidePanel('history')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                sidePanelType === 'history'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="版本历史 (Ctrl+H)"
            >
              <HistoryIcon className="h-4 w-4" />
              <span>历史</span>
              {stats.revisions > 0 && (
                <span className="ml-1 rounded-full bg-gray-200 px-1.5 py-0.5 text-xs">
                  {stats.revisions}
                </span>
              )}
            </button>

            {/* Annotations button */}
            <button
              onClick={() => toggleSidePanel('annotations')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                sidePanelType === 'annotations'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="批注 (Ctrl+M)"
            >
              <AnnotationIcon className="h-4 w-4" />
              <span>批注</span>
              {stats.activeAnnotations > 0 && (
                <span className="ml-1 rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white">
                  {stats.activeAnnotations}
                </span>
              )}
            </button>

            {/* Divider */}
            <div className="mx-1 h-6 w-px bg-gray-300" />

            {/* Save button (only in edit mode) */}
            {viewMode === 'edit' && onSave && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-blue-400"
                title="保存 (Ctrl+S)"
              >
                <SaveIcon className="h-4 w-4" />
                <span>{isSaving ? '保存中...' : '保存'}</span>
              </button>
            )}

            {/* Export button */}
            <button
              className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
              title="导出报告"
            >
              <ExportIcon className="h-4 w-4" />
              <span>导出</span>
            </button>
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main editor */}
        <div
          className={`min-h-0 flex-1 overflow-hidden ${sidePanelType ? 'border-r border-gray-200' : ''}`}
        >
          <ReportEditor
            report={report}
            evidence={evidence}
            isLoading={isLoading}
            onSave={onSave}
            onOpenAIEdit={onOpenAIEdit}
            onAIEdit={
              onAIEdit
                ? async (operation: AIEditOperation, selection?: string) => {
                    if (!selection) {
                      return onAIEdit(operation, undefined);
                    }
                    const textSelection: TextSelection = {
                      text: selection,
                      startOffset: 0,
                      endOffset: selection.length,
                    };
                    return onAIEdit(operation, textSelection);
                  }
                : undefined
            }
            onAddAnnotation={
              onAnnotationAdd ? handleAddAnnotationFromMenu : undefined
            }
            annotations={annotations}
            highlightedAnnotationId={highlightedAnnotationId}
            showAnnotationHighlights={sidePanelType === 'annotations'}
          />
        </div>

        {/* Side panel - disabled when parent handles it (e.g., fullscreen mode) */}
        {sidePanelType && !disableSidePanel && (
          <div className="w-96 flex-shrink-0 border-l border-gray-200 bg-white">
            <div className="flex h-full flex-col">
              {/* Panel header */}
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-gray-700">
                  {sidePanelType === 'history' && '版本历史'}
                  {sidePanelType === 'annotations' && '批注'}
                </h3>
                <button
                  onClick={() => setSidePanelType(null)}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  title="关闭"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>

              {/* Panel content */}
              <div className="flex-1 overflow-hidden">
                {sidePanelType === 'history' && (
                  <ReportRevisionHistory
                    revisions={fullRevisions}
                    currentVersion={currentVersion}
                    isLoading={false}
                    onRollback={onRollback}
                  />
                )}

                {sidePanelType === 'annotations' && (
                  <ReportAnnotations
                    annotations={annotations}
                    currentUserId={currentUserId}
                    isLoading={false}
                    onAdd={onAnnotationAdd}
                    onUpdate={onAnnotationUpdate}
                    onDelete={onAnnotationDelete}
                    onResolve={onAnnotationResolve}
                    onReply={onAnnotationReply}
                    onSubmitFeedback={onSubmitFeedback}
                    onNavigate={handleNavigateToAnnotation}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status bar - 简洁版 (excluded from export) */}
      <div
        className="border-t border-gray-200 bg-white px-4 py-1.5"
        data-export-exclude
      >
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-3">
            <span>v{stats.version}</span>
            {stats.activeAnnotations > 0 && (
              <span className="text-amber-500">
                {stats.activeAnnotations} 待处理
              </span>
            )}
          </div>
          <span>Ctrl+H 历史 · Ctrl+S 保存</span>
        </div>
      </div>
    </div>
  );
}
