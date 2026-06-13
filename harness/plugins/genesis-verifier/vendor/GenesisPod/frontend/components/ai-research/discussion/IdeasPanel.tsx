'use client';

/**
 * IdeasPanel - Creative ideas display (CREATIVE_IDEA type)
 *
 * Each idea card shows:
 * - Collapsed: title, concept, feasibility, dimension badge, star button
 * - Expanded: + innovation points + approach + generate demo button
 *
 * Data model (metadata):
 * - concept: core concept description
 * - innovationPoints: string[] of innovation highlights
 * - approach: implementation path
 * - feasibility: 'high' | 'medium' | 'low'
 * - dimension: creative dimension category
 */

import { useState, useMemo, useEffect } from 'react';
import {
  Lightbulb,
  Star,
  Archive,
  Play,
  Loader2,
  Sparkles,
  Target,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Zap,
  Route,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import type { ResearchIdea } from '@/hooks/features/useResearchIdeas';

// ==================== Types ====================

interface DemoSummary {
  ideaId: string;
  status: string;
}

interface IdeasPanelProps {
  ideas: ResearchIdea[];
  isLoading: boolean;
  isExtracting?: boolean;
  onUpdateIdea: (
    ideaId: string,
    data: { status?: 'DISCOVERED' | 'STARRED' | 'ARCHIVED' }
  ) => void;
  onGenerateDemo?: (ideaId: string) => void;
  onExtractCreativeIdeas?: () => void;
  /** The idea ID currently being generated */
  generatingIdeaId?: string | null;
  /** All demos for duplicate checking */
  demos?: DemoSummary[];
  defaultSessionFilter?: string | null;
  sessions?: Array<{ id: string; query: string }>;
  className?: string;
}

type FilterKey = 'all' | 'DISCOVERED' | 'STARRED' | 'ARCHIVED';

interface CreativeMetadata {
  concept?: string;
  innovationPoints?: string[];
  approach?: string;
  feasibility?: 'high' | 'medium' | 'low';
  dimension?: string;
  sourceInsightIds?: string[];
}

// ==================== Constants ====================

const STATUS_CONFIG: Record<
  string,
  { icon: LucideIcon; label: string; color: string }
> = {
  DISCOVERED: {
    icon: Sparkles,
    label: '新发现',
    color: 'bg-blue-50 text-blue-700',
  },
  STARRED: {
    icon: Star,
    label: '已收藏',
    color: 'bg-amber-50 text-amber-700',
  },
  ARCHIVED: {
    icon: Archive,
    label: '已归档',
    color: 'bg-gray-100 text-gray-500',
  },
};

const FEASIBILITY_CONFIG: Record<
  'high' | 'medium' | 'low',
  { label: string; dotColor: string; textColor: string; borderColor: string }
> = {
  high: {
    label: '高可行',
    dotColor: 'bg-emerald-500',
    textColor: 'text-emerald-700',
    borderColor: 'border-l-emerald-500',
  },
  medium: {
    label: '中可行',
    dotColor: 'bg-amber-500',
    textColor: 'text-amber-700',
    borderColor: 'border-l-amber-500',
  },
  low: {
    label: '低可行',
    dotColor: 'bg-gray-400',
    textColor: 'text-gray-600',
    borderColor: 'border-l-gray-400',
  },
};

const DIMENSION_COLORS: Record<string, string> = {
  新理念: 'bg-violet-100 text-violet-700',
  新方案: 'bg-blue-100 text-blue-700',
  新方法: 'bg-teal-100 text-teal-700',
  新实践: 'bg-orange-100 text-orange-700',
};

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'DISCOVERED', label: '新发现' },
  { key: 'STARRED', label: '已收藏' },
  { key: 'ARCHIVED', label: '已归档' },
];

// ==================== Component ====================

export function IdeasPanel({
  ideas,
  isLoading,
  isExtracting = false,
  onUpdateIdea,
  onGenerateDemo,
  onExtractCreativeIdeas,
  generatingIdeaId,
  defaultSessionFilter,
  demos = [],
  sessions,
  className,
}: IdeasPanelProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sessionFilter, setSessionFilter] = useState<string>(
    defaultSessionFilter || 'all'
  );

  // Sync filter when viewing a different session
  useEffect(() => {
    setSessionFilter(defaultSessionFilter || 'all');
  }, [defaultSessionFilter]);

  const filteredIdeas = useMemo(() => {
    let result =
      filter === 'all' ? ideas : ideas.filter((idea) => idea.status === filter);
    if (sessionFilter !== 'all') {
      result = result.filter((idea) => idea.sessionId === sessionFilter);
    }
    return result;
  }, [ideas, filter, sessionFilter]);

  const stats = useMemo(() => {
    const starred = ideas.filter((i) => i.status === 'STARRED').length;
    const withDemos = ideas.filter((i) => i.demos && i.demos.length > 0).length;
    return { total: ideas.length, starred, withDemos };
  }, [ideas]);

  const toggleExpand = (ideaId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ideaId)) {
        next.delete(ideaId);
      } else {
        next.add(ideaId);
      }
      return next;
    });
  };

  const handleToggleStar = (idea: ResearchIdea) => {
    const newStatus = idea.status === 'STARRED' ? 'DISCOVERED' : 'STARRED';
    onUpdateIdea(idea.id, { status: newStatus });
  };

  const handleArchive = (ideaId: string) => {
    onUpdateIdea(ideaId, { status: 'ARCHIVED' });
  };

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center py-16',
          className
        )}
      >
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  // Empty state
  if (ideas.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center py-16',
          className
        )}
      >
        <div className="mb-4 rounded-2xl bg-purple-50 p-4">
          <Lightbulb className="h-12 w-12 text-purple-500" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-gray-900">
          暂无研究创意
        </h3>
        <p className="mb-6 max-w-md text-center text-sm text-gray-500">
          先从讨论中提取观点,然后从观点中提炼创意方案
        </p>
        {onExtractCreativeIdeas && (
          <button
            onClick={onExtractCreativeIdeas}
            disabled={isExtracting}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors',
              isExtracting
                ? 'cursor-not-allowed bg-purple-400'
                : 'bg-purple-600 hover:bg-purple-700'
            )}
          >
            {isExtracting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isExtracting ? 'AI 提取中...' : '从观点中提取创意'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header with stats */}
      <div className="rounded-xl bg-gradient-to-r from-purple-50 to-indigo-50 p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-purple-100 p-2">
              <Target className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">研究创意</h3>
              <p className="mt-1 text-sm text-gray-600">
                从观点中提炼的创新方案和可落地创意
              </p>
            </div>
          </div>
          {onExtractCreativeIdeas && (
            <button
              onClick={onExtractCreativeIdeas}
              disabled={isExtracting}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors',
                isExtracting
                  ? 'cursor-not-allowed bg-purple-400'
                  : 'bg-purple-600 hover:bg-purple-700'
              )}
            >
              {isExtracting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isExtracting ? 'AI 提取中...' : '从观点中提取创意'}
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="mt-4 flex flex-wrap gap-3">
          <StatBadge
            icon={Lightbulb}
            label="总创意"
            count={stats.total}
            color="purple"
          />
          <StatBadge
            icon={Star}
            label="已收藏"
            count={stats.starred}
            color="amber"
          />
          <StatBadge
            icon={Play}
            label="已生成演示"
            count={stats.withDemos}
            color="blue"
          />
        </div>
      </div>

      {/* Session filter */}
      {sessions && sessions.length > 1 && (
        <div className="flex items-center gap-2">
          <select
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-purple-400 focus:outline-none"
          >
            <option value="all">全部研究</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.query.slice(0, 30)}
                {s.query.length > 30 ? '...' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              filter === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            )}
          >
            {tab.label}
            {tab.key !== 'all' && (
              <span className="ml-1.5 text-xs text-gray-400">
                {
                  ideas.filter((i) => tab.key === 'all' || i.status === tab.key)
                    .length
                }
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Ideas list (single column) */}
      <div className="space-y-3">
        {filteredIdeas.map((idea) => {
          const metadata = (idea.metadata || {}) as CreativeMetadata;
          const concept = metadata.concept || idea.description;
          const innovationPoints = metadata.innovationPoints || [];
          const approach = metadata.approach || '';
          const feasibility = metadata.feasibility || 'medium';
          const dimension = metadata.dimension || '';

          const isExpanded = expandedIds.has(idea.id);
          const feasibilityCfg = FEASIBILITY_CONFIG[feasibility];
          const StatusIcon = STATUS_CONFIG[idea.status].icon;
          const dimensionColor =
            DIMENSION_COLORS[dimension] || 'bg-gray-100 text-gray-700';

          return (
            <div
              key={idea.id}
              className={cn(
                'overflow-hidden rounded-xl border border-l-4 bg-white transition-shadow hover:shadow-md',
                feasibilityCfg.borderColor,
                idea.status === 'STARRED' && 'ring-1 ring-amber-200',
                idea.status === 'ARCHIVED' && 'opacity-60'
              )}
            >
              {/* Card content */}
              <div className="p-4">
                {/* Collapsed state always visible */}
                <div className="space-y-3">
                  {/* Top row: Feasibility + Title + Star */}
                  <div className="flex items-start gap-3">
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <div
                        className={cn(
                          'h-2 w-2 rounded-full',
                          feasibilityCfg.dotColor
                        )}
                      />
                      <span
                        className={cn(
                          'text-xs font-medium',
                          feasibilityCfg.textColor
                        )}
                      >
                        {feasibilityCfg.label}
                      </span>
                    </div>
                    <h4 className="flex-1 text-sm font-bold leading-snug text-gray-900">
                      {idea.title}
                    </h4>
                    <button
                      onClick={() => handleToggleStar(idea)}
                      className={cn(
                        'flex-shrink-0 rounded p-1 transition-colors',
                        idea.status === 'STARRED'
                          ? 'text-amber-500 hover:text-amber-600'
                          : 'text-gray-300 hover:text-amber-400'
                      )}
                    >
                      <Star
                        className="h-4 w-4"
                        fill={
                          idea.status === 'STARRED' ? 'currentColor' : 'none'
                        }
                      />
                    </button>
                  </div>

                  {/* Concept */}
                  <p className="text-sm leading-relaxed text-gray-600">
                    {concept}
                  </p>

                  {/* Bottom row: Dimension + Tags + Status */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Dimension badge */}
                    {dimension && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                          dimensionColor
                        )}
                      >
                        <Lightbulb className="h-3 w-3" />
                        {dimension}
                      </span>
                    )}

                    {/* Tags */}
                    {idea.tags
                      .filter((tag) => tag !== dimension)
                      .map((tag, idx) => (
                        <span
                          key={idx}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                        >
                          {tag}
                        </span>
                      ))}

                    {/* Status badge */}
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        STATUS_CONFIG[idea.status].color
                      )}
                    >
                      <StatusIcon className="h-3 w-3" />
                      {STATUS_CONFIG[idea.status].label}
                    </span>
                  </div>
                </div>

                {/* Expanded state sections */}
                {isExpanded && (
                  <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                    {/* Innovation Points */}
                    {innovationPoints.length > 0 && (
                      <div className="rounded-lg bg-violet-50 p-3">
                        <div className="mb-2 flex items-center gap-1.5">
                          <Zap className="h-4 w-4 text-violet-600" />
                          <span className="text-xs font-semibold text-gray-700">
                            创新点
                          </span>
                        </div>
                        <ul className="space-y-1.5">
                          {innovationPoints.map((point, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2 text-xs text-gray-600"
                            >
                              <Zap className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-500" />
                              <span className="flex-1">{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Approach */}
                    {approach && (
                      <div className="rounded-lg bg-blue-50 p-3">
                        <div className="mb-2 flex items-center gap-1.5">
                          <Route className="h-4 w-4 text-blue-600" />
                          <span className="text-xs font-semibold text-gray-700">
                            实现路径
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-gray-700">
                          {approach}
                        </p>
                      </div>
                    )}

                    {/* Action buttons (expanded) */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleStar(idea)}
                        className={cn(
                          'flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                          idea.status === 'STARRED'
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        )}
                      >
                        {idea.status === 'STARRED' ? '取消收藏' : '收藏'}
                      </button>
                      {idea.status !== 'ARCHIVED' && (
                        <button
                          onClick={() => handleArchive(idea.id)}
                          className="flex-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200"
                        >
                          归档
                        </button>
                      )}
                      {onGenerateDemo &&
                        (() => {
                          const isGenerating = generatingIdeaId === idea.id;
                          const hasPendingDemo = demos.some(
                            (d) =>
                              d.ideaId === idea.id &&
                              (d.status === 'PENDING' ||
                                d.status === 'GENERATING')
                          );
                          const hasCompletedDemo = demos.some(
                            (d) =>
                              d.ideaId === idea.id && d.status === 'COMPLETED'
                          );

                          return (
                            <button
                              onClick={() => onGenerateDemo(idea.id)}
                              disabled={isGenerating}
                              className={cn(
                                'flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                                isGenerating || hasPendingDemo
                                  ? 'cursor-not-allowed bg-purple-200 text-purple-500'
                                  : hasCompletedDemo
                                    ? 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                                    : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                              )}
                            >
                              <span className="inline-flex items-center gap-1">
                                {isGenerating ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Play className="h-3 w-3" />
                                )}
                                {isGenerating
                                  ? '生成中...'
                                  : hasPendingDemo
                                    ? '生成中...'
                                    : hasCompletedDemo
                                      ? '重新生成'
                                      : '生成演示'}
                              </span>
                            </button>
                          );
                        })()}
                    </div>
                  </div>
                )}

                {/* Expand/Collapse toggle */}
                <button
                  onClick={() => toggleExpand(idea.id)}
                  className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5" />
                      收起详情
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" />
                      展开详情
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filtered empty */}
      {filteredIdeas.length === 0 && ideas.length > 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">没有符合筛选条件的创意</p>
        </div>
      )}
    </div>
  );
}

// ==================== Sub Components ====================

function StatBadge({
  icon: Icon,
  label,
  count,
  color,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    purple: 'bg-purple-100 text-purple-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    gray: 'bg-gray-100 text-gray-700',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
        colorMap[color] || colorMap.gray
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {count} {label}
    </span>
  );
}

export default IdeasPanel;
