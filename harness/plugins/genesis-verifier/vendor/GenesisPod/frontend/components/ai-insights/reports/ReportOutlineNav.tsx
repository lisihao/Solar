'use client';

/**
 * Report Outline Navigation Component
 *
 * v7.0 报告大纲导航:
 * - 报告目录树
 * - 点击跳转
 * - 字数统计
 */

import { useMemo, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import type { TopicReport } from '@/lib/types/topic-insights';
import { countWords } from '@/lib/markdown/countWords';
import { LoadingState } from '@/components/ui/states';

interface OutlineItem {
  id: string;
  title: string;
  level: number;
  wordCount: number;
  children?: OutlineItem[];
}

interface ReportOutlineNavProps {
  report: TopicReport | null;
  isLoading?: boolean;
  onNavigate?: (sectionId: string) => void;
  activeSection?: string;
}

// Icons
const ChevronRightIcon = ({ className }: { className?: string }) => (
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
      d="M9 5l7 7-7 7"
    />
  </svg>
);

const DocumentTextIcon = ({ className }: { className?: string }) => (
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
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

export function ReportOutlineNav({
  report,
  isLoading = false,
  onNavigate,
  activeSection,
}: ReportOutlineNavProps) {
  const { t } = useI18n();

  // Build outline from report
  const outline = useMemo<OutlineItem[]>(() => {
    if (!report) return [];

    const items: OutlineItem[] = [];

    // Add summary section
    if (report.summary) {
      items.push({
        id: 'summary',
        title: t('topicResearch.reportPanels.outline.summary'),
        level: 1,
        wordCount: countWords(report.summary),
      });
    }

    // Add highlights section
    if (report.highlights && report.highlights.length > 0) {
      const highlightChildren: OutlineItem[] = report.highlights.map(
        (h, idx) => ({
          id: `highlight-${idx}`,
          title: h.title,
          level: 2,
          wordCount: countWords(h.content),
        })
      );

      items.push({
        id: 'highlights',
        title: t('topicResearch.reportPanels.outline.keyInsights'),
        level: 1,
        wordCount: highlightChildren.reduce((sum, c) => sum + c.wordCount, 0),
        children: highlightChildren,
      });
    }

    // Add dimension analyses
    if (report.dimensionAnalyses && report.dimensionAnalyses.length > 0) {
      report.dimensionAnalyses.forEach((analysis) => {
        const dimName =
          analysis.dimension?.name ||
          t('topicResearch.reportPanels.outline.dimensionAnalysis');
        const children: OutlineItem[] = [];

        // Key findings
        if (analysis.keyFindings && analysis.keyFindings.length > 0) {
          children.push({
            id: `${analysis.id}-findings`,
            title: t('topicResearch.reportPanels.outline.keyFindings'),
            level: 2,
            wordCount: analysis.keyFindings.reduce(
              (sum, f) => sum + countWords(f.finding),
              0
            ),
          });
        }

        // Trends
        if (analysis.trends && analysis.trends.length > 0) {
          children.push({
            id: `${analysis.id}-trends`,
            title: t('topicResearch.reportPanels.outline.trendAnalysis'),
            level: 2,
            wordCount: analysis.trends.reduce(
              (sum, t) => sum + countWords(t.trend || ''),
              0
            ),
          });
        }

        // Detailed content
        if (analysis.detailedContent) {
          children.push({
            id: `${analysis.id}-detail`,
            title: t('topicResearch.reportPanels.outline.detailedContent'),
            level: 2,
            wordCount: countWords(analysis.detailedContent),
          });
        }

        const sectionWordCount =
          countWords(analysis.summary || '') +
          children.reduce((sum, c) => sum + c.wordCount, 0);

        items.push({
          id: analysis.id,
          title: dimName,
          level: 1,
          wordCount: sectionWordCount,
          children: children.length > 0 ? children : undefined,
        });
      });
    }

    return items;
  }, [report, t]);

  // Total word count
  const totalWordCount = useMemo(() => {
    return outline.reduce((sum, item) => sum + item.wordCount, 0);
  }, [outline]);

  // Handle navigation
  const handleNavigate = useCallback(
    (sectionId: string) => {
      onNavigate?.(sectionId);
    },
    [onNavigate]
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <LoadingState size="sm" text="" />
      </div>
    );
  }

  if (!report || outline.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <DocumentTextIcon className="h-8 w-8 text-gray-300" />
        <p className="mt-2 text-sm text-gray-500">
          {t('topicResearch.reportPanels.outline.noOutline')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {t('topicResearch.reportPanels.outline.title')}
        </h3>
        <p className="mt-1 text-xs text-gray-400">
          {t('topicResearch.reportPanels.outline.totalWords', {
            count: totalWordCount,
          })}
        </p>
      </div>

      {/* Outline tree */}
      <div className="flex-1 overflow-auto p-2">
        <nav className="space-y-0.5">
          {outline.map((item) => (
            <OutlineItemComponent
              key={item.id}
              item={item}
              activeSection={activeSection}
              onNavigate={handleNavigate}
            />
          ))}
        </nav>
      </div>
    </div>
  );
}

// Outline item component
interface OutlineItemComponentProps {
  item: OutlineItem;
  activeSection?: string;
  onNavigate: (sectionId: string) => void;
  depth?: number;
}

function OutlineItemComponent({
  item,
  activeSection,
  onNavigate,
  depth = 0,
}: OutlineItemComponentProps) {
  const { t } = useI18n();
  const isActive = activeSection === item.id;
  const hasChildren = item.children && item.children.length > 0;

  return (
    <div>
      <button
        onClick={() => onNavigate(item.id)}
        className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
          isActive
            ? 'bg-blue-50 text-blue-700'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {hasChildren && (
          <ChevronRightIcon className="h-3 w-3 flex-shrink-0 text-gray-400" />
        )}
        {!hasChildren && <span className="w-3" />}

        <span className="flex-1 truncate text-sm text-gray-900">
          {item.title}
        </span>

        <span className="flex-shrink-0 text-xs text-gray-400 opacity-0 transition-opacity group-hover:opacity-100">
          {item.wordCount}
          {t('topicResearch.reportPanels.outline.wordsUnit')}
        </span>
      </button>

      {hasChildren && (
        <div className="mt-0.5">
          {item.children!.map((child) => (
            <OutlineItemComponent
              key={child.id}
              item={child}
              activeSection={activeSection}
              onNavigate={onNavigate}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
