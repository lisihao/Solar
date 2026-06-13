'use client';

/**
 * CitationPreview - 引用预览组件
 * 用于 RAG 回答中的精确引用展示
 */

import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileText,
  Shield,
  ShieldAlert,
  ShieldQuestion,
} from 'lucide-react';

export interface Citation {
  id: string;
  sourceId: string;
  sourceTitle: string;
  paragraphIndex: number;
  exactQuote: string;
  confidence: 'high' | 'medium' | 'low';
  verifiable: boolean;
  hoverPreview: string;
  sourceUrl?: string;
}

export interface CitationMetrics {
  groundedRatio: number;
  sourceCount: number;
  verifiedCount: number;
  overallConfidence: 'high' | 'medium' | 'low';
}

interface CitationPreviewProps {
  citation: Citation;
  isActive?: boolean;
  onClick?: () => void;
  compact?: boolean;
}

interface CitationListProps {
  citations: Citation[];
  metrics?: CitationMetrics;
  activeCitationId?: string | null;
  onCitationClick?: (id: string) => void;
}

interface CitationBadgeProps {
  number: number;
  confidence: 'high' | 'medium' | 'low';
  onClick?: () => void;
}

const CONFIDENCE_COLORS = {
  high: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    badge: 'bg-green-100 text-green-700',
    icon: <Shield className="h-4 w-4" />,
  },
  medium: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-700',
    badge: 'bg-yellow-100 text-yellow-700',
    icon: <ShieldQuestion className="h-4 w-4" />,
  },
  low: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-700',
    icon: <ShieldAlert className="h-4 w-4" />,
  },
};

const getConfidenceLabels = (t: (key: string) => string) => ({
  high: t('topicResearch.deepResearch.citations.confidence.high'),
  medium: t('topicResearch.deepResearch.citations.confidence.medium'),
  low: t('topicResearch.deepResearch.citations.confidence.low'),
});

export function CitationBadge({
  number,
  confidence,
  onClick,
}: CitationBadgeProps) {
  const { t } = useI18n();
  const confidenceLabels = getConfidenceLabels(t);
  const colors = CONFIDENCE_COLORS[confidence];

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs font-medium transition-colors hover:opacity-80 ${colors.badge}`}
      title={confidenceLabels[confidence]}
    >
      [{number}]
    </button>
  );
}

export function CitationPreview({
  citation,
  isActive = false,
  onClick,
  compact = false,
}: CitationPreviewProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const confidenceLabels = getConfidenceLabels(t);
  const colors = CONFIDENCE_COLORS[citation.confidence];

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`cursor-pointer rounded-lg border p-2 transition-all ${
          isActive
            ? `${colors.bg} ${colors.border}`
            : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={colors.text}>{colors.icon}</span>
          <span className="truncate text-sm font-medium text-gray-900">
            {citation.sourceTitle}
          </span>
          {citation.verifiable && (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-500" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border transition-all ${
        isActive
          ? `${colors.bg} ${colors.border} shadow-sm`
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between p-3"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`rounded-lg p-2 ${colors.bg}`}>
            <FileText className={`h-4 w-4 ${colors.text}`} />
          </div>
          <div>
            <h4 className="font-medium text-gray-900">
              {citation.sourceTitle}
            </h4>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
              <span className={`rounded px-1.5 py-0.5 ${colors.badge}`}>
                {confidenceLabels[citation.confidence]}
              </span>
              {citation.verifiable && (
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  {t('topicResearch.deepResearch.citations.verified')}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {citation.sourceUrl && (
            <a
              href={citation.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-100 p-3">
          <p className="text-sm leading-relaxed text-gray-600">
            {citation.exactQuote}
          </p>
          <div className="mt-2 text-xs text-gray-400">
            {t('topicResearch.deepResearch.citations.paragraph', {
              index: citation.paragraphIndex + 1,
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function CitationMetricsBar({ metrics }: { metrics: CitationMetrics }) {
  const { t } = useI18n();
  const confidenceLabels = getConfidenceLabels(t);
  const colors = CONFIDENCE_COLORS[metrics.overallConfidence];
  const groundedPercent = Math.round(metrics.groundedRatio * 100);

  return (
    <div className={`rounded-lg border p-3 ${colors.bg} ${colors.border}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">
          {t('topicResearch.deepResearch.citations.quality')}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${colors.badge}`}
        >
          {confidenceLabels[metrics.overallConfidence]}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="mb-2 h-2 overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full transition-all ${
            metrics.overallConfidence === 'high'
              ? 'bg-green-500'
              : metrics.overallConfidence === 'medium'
                ? 'bg-yellow-500'
                : 'bg-red-500'
          }`}
          style={{ width: `${groundedPercent}%` }}
        />
      </div>

      {/* Stats */}
      <div className="flex justify-between text-xs text-gray-600">
        <span>
          {t('topicResearch.deepResearch.citations.groundedPercent', {
            percent: groundedPercent,
          })}
        </span>
        <span>
          {t('topicResearch.deepResearch.citations.verifiedSources', {
            verified: metrics.verifiedCount,
            total: metrics.sourceCount,
          })}
        </span>
      </div>
    </div>
  );
}

export default function CitationList({
  citations,
  metrics,
  activeCitationId,
  onCitationClick,
}: CitationListProps) {
  const { t } = useI18n();

  if (citations.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
        <AlertCircle className="mx-auto mb-2 h-8 w-8 text-gray-400" />
        <p className="text-sm text-gray-500">
          {t('topicResearch.deepResearch.citations.noCitations')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Metrics */}
      {metrics && <CitationMetricsBar metrics={metrics} />}

      {/* Citation List */}
      <div className="space-y-2">
        {citations.map((citation, index) => (
          <CitationPreview
            key={citation.id}
            citation={citation}
            isActive={citation.id === activeCitationId}
            onClick={() => onCitationClick?.(citation.id)}
          />
        ))}
      </div>
    </div>
  );
}

// Inline citation component for use within text
export function InlineCitation({
  number,
  citation,
  onClick,
}: {
  number: number;
  citation: Citation;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const [showTooltip, setShowTooltip] = useState(false);
  const colors = CONFIDENCE_COLORS[citation.confidence];

  return (
    <span className="relative inline-block">
      <button
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`inline-flex items-center justify-center rounded px-1 py-0.5 text-xs font-medium transition-colors ${colors.badge} hover:opacity-80`}
      >
        [{number}]
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 transform">
          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
            <div className="mb-1 flex items-center gap-2">
              <span className={colors.text}>{colors.icon}</span>
              <span className="text-sm font-medium text-gray-900">
                {citation.sourceTitle}
              </span>
            </div>
            <p className="line-clamp-3 text-xs text-gray-600">
              {citation.exactQuote}
            </p>
            {citation.sourceUrl && (
              <a
                href={citation.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                {t('topicResearch.deepResearch.citations.viewSource')}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {/* Arrow */}
          <div className="absolute left-1/2 top-full -translate-x-1/2 transform">
            <div className="border-4 border-transparent border-t-white" />
          </div>
        </div>
      )}
    </span>
  );
}
