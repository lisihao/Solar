'use client';

/**
 * InsightsPanel - Structured, expandable research insights display
 *
 * Each insight card shows:
 * - Collapsed: title, core insight, impact level, agent, tags, star button
 * - Expanded: + evidence bullets + research direction + actions
 *
 * Data model:
 * - metadata.coreInsight (display text)
 * - metadata.evidence (array of supporting points)
 * - metadata.researchDirection (suggested next steps)
 * - metadata.impactLevel ('high' | 'medium' | 'low')
 */

import { useState, useMemo, useEffect } from 'react';
import {
  Crown,
  Search,
  BarChart3,
  PenLine,
  ShieldCheck,
  Brain,
  Star,
  Archive,
  Loader2,
  Sparkles,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Compass,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import type { ResearchIdea } from '@/hooks/features/useResearchIdeas';

// ==================== Types ====================

interface InsightsPanelProps {
  ideas: ResearchIdea[];
  isLoading: boolean;
  isExtracting?: boolean;
  onUpdateIdea: (
    ideaId: string,
    data: { status?: 'DISCOVERED' | 'STARRED' | 'ARCHIVED' }
  ) => void;
  onExtractIdeas?: (sessionId: string) => void;
  activeSessionId?: string | null;
  defaultSessionFilter?: string | null;
  sessions?: Array<{ id: string; query: string }>;
  className?: string;
}

type FilterKey = 'all' | 'DISCOVERED' | 'STARRED' | 'ARCHIVED';

interface IdeaMetadata {
  coreInsight?: string;
  evidence?: string[];
  researchDirection?: string;
  impactLevel?: 'high' | 'medium' | 'low';
}

// ==================== Constants ====================

const ROLE_ICON: Record<string, LucideIcon> = {
  director: Crown,
  researcher: Search,
  analyst: BarChart3,
  writer: PenLine,
  reviewer: ShieldCheck,
};

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  director: { bg: 'bg-purple-100', text: 'text-purple-700' },
  researcher: { bg: 'bg-blue-100', text: 'text-blue-700' },
  analyst: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  writer: { bg: 'bg-amber-100', text: 'text-amber-700' },
  reviewer: { bg: 'bg-rose-100', text: 'text-rose-700' },
};

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

const IMPACT_CONFIG: Record<
  'high' | 'medium' | 'low',
  { label: string; dotColor: string; textColor: string; borderColor: string }
> = {
  high: {
    label: '高影响',
    dotColor: 'bg-red-500',
    textColor: 'text-red-700',
    borderColor: 'border-l-red-500',
  },
  medium: {
    label: '中影响',
    dotColor: 'bg-amber-500',
    textColor: 'text-amber-700',
    borderColor: 'border-l-amber-500',
  },
  low: {
    label: '低影响',
    dotColor: 'bg-gray-400',
    textColor: 'text-gray-600',
    borderColor: 'border-l-gray-400',
  },
};

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'DISCOVERED', label: '新发现' },
  { key: 'STARRED', label: '已收藏' },
  { key: 'ARCHIVED', label: '已归档' },
];

// ==================== Component ====================

export function InsightsPanel({
  ideas,
  isLoading,
  isExtracting = false,
  onUpdateIdea,
  onExtractIdeas,
  activeSessionId,
  defaultSessionFilter,
  sessions,
  className,
}: InsightsPanelProps) {
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
    return { total: ideas.length, starred };
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
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
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
        <div className="mb-4 rounded-2xl bg-indigo-50 p-4">
          <Brain className="h-12 w-12 text-indigo-500" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-gray-900">
          暂无研究观点
        </h3>
        <p className="mb-6 max-w-md text-center text-sm text-gray-500">
          开始一次讨论,AI 团队将自动从讨论中提炼观点
        </p>
        {activeSessionId && onExtractIdeas && (
          <button
            onClick={() => onExtractIdeas(activeSessionId)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <Sparkles className="h-4 w-4" />
            从最近讨论中提取观点
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header with stats */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-50 to-blue-50 p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-indigo-100 p-2">
              <Brain className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">观点荟萃</h3>
              <p className="mt-1 text-sm text-gray-600">
                从讨论中提炼的分析判断和研究洞察
              </p>
            </div>
          </div>
          {activeSessionId && onExtractIdeas && (
            <button
              onClick={() => onExtractIdeas(activeSessionId)}
              disabled={isExtracting}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors',
                isExtracting
                  ? 'cursor-not-allowed bg-indigo-400'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              )}
            >
              {isExtracting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isExtracting ? 'AI 提取中...' : '提取观点'}
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="mt-4 flex flex-wrap gap-3">
          <StatBadge
            icon={Brain}
            label="总观点"
            count={stats.total}
            color="indigo"
          />
          <StatBadge
            icon={Star}
            label="已收藏"
            count={stats.starred}
            color="amber"
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

      {/* Insights list (single column) */}
      <div className="space-y-3">
        {filteredIdeas.map((idea) => {
          const metadata = (idea.metadata || {}) as IdeaMetadata;
          const coreInsight = metadata.coreInsight || idea.description;
          const evidence = metadata.evidence || [];
          const researchDirection = metadata.researchDirection || '';
          const impactLevel = metadata.impactLevel || 'medium';

          const isExpanded = expandedIds.has(idea.id);
          const impactCfg = IMPACT_CONFIG[impactLevel];
          const RoleIcon = ROLE_ICON[idea.agentRole || ''] || Brain;
          const roleColors = ROLE_COLORS[idea.agentRole || ''] || {
            bg: 'bg-gray-100',
            text: 'text-gray-700',
          };
          const StatusIcon = STATUS_CONFIG[idea.status].icon;

          return (
            <div
              key={idea.id}
              className={cn(
                'overflow-hidden rounded-xl border border-l-4 bg-white transition-shadow hover:shadow-md',
                impactCfg.borderColor,
                idea.status === 'STARRED' && 'ring-1 ring-amber-200',
                idea.status === 'ARCHIVED' && 'opacity-60'
              )}
            >
              {/* Card content */}
              <div className="p-4">
                {/* Collapsed state always visible */}
                <div className="space-y-3">
                  {/* Top row: Impact + Title + Star */}
                  <div className="flex items-start gap-3">
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <div
                        className={cn(
                          'h-2 w-2 rounded-full',
                          impactCfg.dotColor
                        )}
                      />
                      <span
                        className={cn(
                          'text-xs font-medium',
                          impactCfg.textColor
                        )}
                      >
                        {impactCfg.label}
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

                  {/* Core insight */}
                  <p className="text-sm leading-relaxed text-gray-600">
                    {coreInsight}
                  </p>

                  {/* Bottom row: Agent + Tags + Status */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Agent badge */}
                    {idea.agentRole && idea.agentName && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                          roleColors.bg,
                          roleColors.text
                        )}
                      >
                        <RoleIcon className="h-3 w-3" />
                        {idea.agentName}
                      </span>
                    )}

                    {/* Category tags */}
                    {idea.tags.map((tag, idx) => (
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
                    {/* Evidence section */}
                    {evidence.length > 0 && (
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="mb-2 flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span className="text-xs font-semibold text-gray-700">
                            支撑论据
                          </span>
                        </div>
                        <ul className="space-y-1.5">
                          {evidence.map((point, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2 text-xs text-gray-600"
                            >
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                              <span className="flex-1">{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Research Direction section */}
                    {researchDirection && (
                      <div className="rounded-lg bg-blue-50 p-3">
                        <div className="mb-2 flex items-center gap-1.5">
                          <Compass className="h-4 w-4 text-blue-600" />
                          <span className="text-xs font-semibold text-gray-700">
                            研究方向
                          </span>
                        </div>
                        <p className="text-xs italic leading-relaxed text-gray-700">
                          {researchDirection}
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
          <p className="mt-2 text-sm text-gray-500">没有符合筛选条件的观点</p>
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
    indigo: 'bg-indigo-100 text-indigo-700',
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

export default InsightsPanel;
