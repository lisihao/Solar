'use client';

/**
 * Topic References Panel - 参考文献面板
 *
 * 展示和管理研究中引用的所有证据来源
 */

import { useState, useEffect, useMemo } from 'react';
import { useTopicContent } from './TopicContentContext';
import { ClientDate } from '@/components/common/ClientDate';
import { useI18n } from '@/lib/i18n';
import { DeepDiveButton } from './DeepDiveButton';

// Icons
const SpinnerIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24">
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

const LinkIcon = ({ className }: { className?: string }) => (
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
      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
    />
  </svg>
);

interface TopicReferencesPanelProps {
  autoExpandId?: string | null;
  onAutoExpandHandled?: () => void;
}

export function TopicReferencesPanel({
  autoExpandId,
  onAutoExpandHandled,
}: TopicReferencesPanelProps) {
  const { t } = useI18n();
  const { report, dimensions, evidence, isLoadingEvidence, topicId } =
    useTopicContent();

  const safeEvidence = Array.isArray(evidence) ? evidence : [];

  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>(
    'all'
  );
  const [sortBy, setSortBy] = useState<'credibility' | 'date'>('credibility');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Auto-expand evidence card when navigated from citation
  useEffect(() => {
    if (autoExpandId) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(autoExpandId);
        return next;
      });
      onAutoExpandHandled?.();
    }
  }, [autoExpandId, onAutoExpandHandled]);

  // Build citation locations map
  const citationLocations = useMemo(() => {
    const locations = new Map<
      string,
      { dimensionName: string; count: number }[]
    >();

    if (!report?.dimensionAnalyses) return locations;

    // Build dimension ID to name map
    const dimensionNameMap = new Map<string, string>();
    dimensions.forEach((dim) => {
      dimensionNameMap.set(dim.id, dim.name);
    });

    // Build evidence index map
    const evidenceIndexMap = new Map<number, string>();
    safeEvidence.forEach((e, idx) => {
      evidenceIndexMap.set(idx + 1, e.id);
    });

    // Iterate through dimension analyses and find citations
    report.dimensionAnalyses.forEach((analysis) => {
      const dimName =
        dimensionNameMap.get(analysis.dimensionId) ||
        t('topicResearch.topics.referencesPanel.unknownDimension');
      const content =
        (analysis.detailedContent || '') + (analysis.summary || '');

      // Match various citation formats: [1], [1, 2], [temp-x-y], [uuid]
      const citationPattern =
        /\[(\d+(?:\s*,\s*\d+)*)\]|\[(temp-\d+-\d+)\]|\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;
      const foundEvidenceIds = new Set<string>();

      let match;
      while ((match = citationPattern.exec(content)) !== null) {
        if (match[1]) {
          // Number format [1] or [1, 2]
          const indices = match[1].split(/\s*,\s*/).map((s) => parseInt(s, 10));
          indices.forEach((idx) => {
            const evidenceId = evidenceIndexMap.get(idx);
            if (evidenceId) foundEvidenceIds.add(evidenceId);
          });
        } else if (match[2]) {
          // temp-x-y format
          const evidenceId = match[2];
          if (safeEvidence.some((e) => e.id === evidenceId)) {
            foundEvidenceIds.add(evidenceId);
          }
        } else if (match[3]) {
          // UUID format
          const evidenceId = match[3];
          if (safeEvidence.some((e) => e.id === evidenceId)) {
            foundEvidenceIds.add(evidenceId);
          }
        }
      }

      // Update citation locations for each evidence
      foundEvidenceIds.forEach((evidenceId) => {
        const existing = locations.get(evidenceId) || [];
        const dimEntry = existing.find((e) => e.dimensionName === dimName);
        if (dimEntry) {
          dimEntry.count++;
        } else {
          existing.push({ dimensionName: dimName, count: 1 });
        }
        locations.set(evidenceId, existing);
      });
    });

    return locations;
  }, [report, dimensions, safeEvidence]);

  // Filter and sort
  const filteredEvidence = useMemo(() => {
    let result = [...safeEvidence];

    if (filter !== 'all') {
      result = result.filter((e) => {
        const score = e.credibilityScore || 0;
        if (filter === 'high') return score >= 70;
        if (filter === 'medium') return score >= 40 && score < 70;
        if (filter === 'low') return score < 40;
        return true;
      });
    }

    result.sort((a, b) => {
      if (sortBy === 'credibility') {
        return (b.credibilityScore || 0) - (a.credibilityScore || 0);
      }
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return dateB - dateA;
    });

    return result;
  }, [safeEvidence, filter, sortBy]);

  // Statistics
  const stats = useMemo(() => {
    const high = safeEvidence.filter(
      (e) => (e.credibilityScore || 0) >= 70
    ).length;
    const medium = safeEvidence.filter(
      (e) => (e.credibilityScore || 0) >= 40 && (e.credibilityScore || 0) < 70
    ).length;
    const low = safeEvidence.filter(
      (e) => (e.credibilityScore || 0) < 40
    ).length;
    return { total: safeEvidence.length, high, medium, low };
  }, [safeEvidence]);

  if (isLoadingEvidence) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center px-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
          <SpinnerIcon className="h-10 w-10 animate-spin text-blue-600" />
        </div>
        <p className="mt-4 text-sm text-gray-500">
          {t('topicResearch.topics.referencesPanel.loadingEvidence')}
        </p>
      </div>
    );
  }

  if (safeEvidence.length === 0) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center px-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
          <LinkIcon className="h-10 w-10 text-gray-400" />
        </div>
        <h3 className="mt-4 text-lg font-medium text-gray-900">
          {t('topicResearch.topics.referencesPanel.noEvidence')}
        </h3>
        <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
          {t('topicResearch.topics.referencesPanel.noEvidenceHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {t('topicResearch.topics.referencesPanel.totalSources', {
              total: stats.total,
            })}
          </span>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-green-600">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              {t('topicResearch.topics.referencesPanel.highCredibility', {
                count: stats.high,
              })}
            </span>
            <span className="flex items-center gap-1 text-yellow-600">
              <span className="h-2 w-2 rounded-full bg-yellow-500"></span>
              {t('topicResearch.topics.referencesPanel.mediumCredibility', {
                count: stats.medium,
              })}
            </span>
            <span className="flex items-center gap-1 text-red-600">
              <span className="h-2 w-2 rounded-full bg-red-500"></span>
              {t('topicResearch.topics.referencesPanel.lowCredibility', {
                count: stats.low,
              })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
          >
            <option value="all">
              {t('topicResearch.topics.referencesPanel.filterAll')}
            </option>
            <option value="high">
              {t('topicResearch.topics.referencesPanel.filterHigh')}
            </option>
            <option value="medium">
              {t('topicResearch.topics.referencesPanel.filterMedium')}
            </option>
            <option value="low">
              {t('topicResearch.topics.referencesPanel.filterLow')}
            </option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
          >
            <option value="credibility">
              {t('topicResearch.topics.referencesPanel.sortByCredibility')}
            </option>
            <option value="date">
              {t('topicResearch.topics.referencesPanel.sortByDate')}
            </option>
          </select>
        </div>
      </div>

      {/* Evidence list */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid gap-4 md:grid-cols-2">
          {filteredEvidence.map((item) => {
            const citationIndex =
              item.citationIndex ??
              safeEvidence.findIndex((e) => e.id === item.id) + 1;
            const isExpanded = expandedIds.has(item.id);
            return (
              <div
                key={item.id}
                id={`evidence-${item.id}`}
                className="group rounded-lg border border-gray-200 bg-white transition-all hover:border-blue-300 hover:shadow-md"
              >
                {/* Header */}
                <div
                  className="cursor-pointer p-4"
                  onClick={() => toggleExpanded(item.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <span className="flex-shrink-0 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-bold text-purple-700">
                          [{citationIndex}]
                        </span>
                        <h4 className="font-medium text-gray-900">
                          {item.title}
                        </h4>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {item.domain}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.credibilityScore !== null && (
                        <span
                          className={`flex-shrink-0 rounded-full px-2 py-1 text-xs font-bold ${
                            item.credibilityScore >= 70
                              ? 'bg-green-100 text-green-700'
                              : item.credibilityScore >= 40
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {item.credibilityScore}%
                        </span>
                      )}
                      <svg
                        className={`h-5 w-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </div>
                  </div>

                  {!isExpanded && item.snippet && (
                    <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                      {item.snippet}
                    </p>
                  )}
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {item.snippet && (
                      <div className="max-h-64 overflow-y-auto bg-gray-50 p-4">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                          {item.snippet}
                        </p>
                      </div>
                    )}

                    {/* Citation locations */}
                    {citationLocations.get(item.id) &&
                      citationLocations.get(item.id)!.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-4 py-3">
                          <span className="text-xs text-gray-500">
                            {t('topicResearch.topics.referencesPanel.citedIn')}
                          </span>
                          {citationLocations.get(item.id)!.map((loc, idx) => (
                            <span
                              key={idx}
                              className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600"
                              title={t(
                                'topicResearch.topics.referencesPanel.citedInDimension',
                                {
                                  dimension: loc.dimensionName,
                                  count: loc.count,
                                }
                              )}
                            >
                              {loc.dimensionName}
                              {loc.count > 1 && (
                                <span className="ml-0.5 opacity-70">
                                  ×{loc.count}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}

                    {/* Footer */}
                    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5">
                          {item.sourceType ||
                            t('topicResearch.topics.referencesPanel.webpage')}
                        </span>
                        {item.publishedAt && (
                          <ClientDate date={item.publishedAt} format="date" />
                        )}
                      </div>
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t(
                            'topicResearch.topics.referencesPanel.openOriginal'
                          )}{' '}
                          ↗
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Collapsed footer */}
                {!isExpanded && (
                  <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5">
                        {item.sourceType ||
                          t('topicResearch.topics.referencesPanel.webpage')}
                      </span>
                      {citationLocations.get(item.id) &&
                        citationLocations.get(item.id)!.length > 0 && (
                          <span className="text-blue-500">
                            {t(
                              'topicResearch.topics.referencesPanel.citedTimes',
                              { count: citationLocations.get(item.id)!.length }
                            )}
                          </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                      {topicId && (
                        <DeepDiveButton
                          topicId={topicId}
                          contextTitle={item.title}
                          contextSummary={item.snippet?.slice(0, 200)}
                          size="xs"
                        />
                      )}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t('topicResearch.topics.referencesPanel.original')} ↗
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
