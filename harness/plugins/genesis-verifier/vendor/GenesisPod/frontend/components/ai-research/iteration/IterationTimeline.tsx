'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  Search,
  Lightbulb,
  Code2,
  TrendingUp,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Timer,
  Send,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { TruncatedCell } from '@/components/common/tables';
import type { IterationRound } from '@/hooks/features/useIterativeResearch';

// ==================== Types ====================

export type { IterationRound };

export interface IterationTimelineProps {
  iterations: IterationRound[];
  currentRound: number;
  exitReason: string | null;
  finalScore: number | null;
  isActive: boolean;
  maxIterations?: number;
  /** P1-3: Quality threshold from backend config for transparency */
  qualityThreshold?: number | null;
  /** P1-3: Research depth from backend config */
  depth?: string | null;
  awaitingFeedback?: {
    round: number;
    score: number;
    gaps: { dataGaps: string[]; ideaGaps: string[] };
    timeoutMs: number;
  } | null;
  onSendFeedback?: (text: string) => Promise<void>;
  className?: string;
}

// ==================== Helpers ====================

function getScoreColor(score: number): string {
  if (score >= 70) return 'text-green-500';
  if (score >= 40) return 'text-yellow-500';
  return 'text-red-500';
}

function getScoreBgColor(score: number): string {
  if (score >= 70) return 'bg-green-500';
  if (score >= 40) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getScoreBorderColor(score: number): string {
  if (score >= 70) return 'border-green-500/30';
  if (score >= 40) return 'border-yellow-500/30';
  return 'border-red-500/30';
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

function formatExitReason(reason: string): string {
  const map: Record<string, string> = {
    quality_met: '质量达标',
    budget_exhausted: '达到最大迭代次数',
    no_gaps: '所有差距已解决',
    information_saturated: '信息饱和',
    converged: '分数收敛',
    completed: '研究完成',
    user_stopped: '用户停止',
    round_error: '迭代中发生错误，已保存已有成果',
  };
  return map[reason] ?? reason;
}

function formatDepth(depth: string): string {
  const map: Record<string, string> = {
    quick: '快速',
    standard: '标准',
    thorough: '深度',
  };
  return map[depth] ?? depth;
}

// ==================== Sub-components ====================

interface DataLayerCardProps {
  research: NonNullable<IterationRound['research']>;
  isExpanded: boolean;
}

function DataLayerCard({ research, isExpanded }: DataLayerCardProps) {
  const [showAll, setShowAll] = useState(false);
  const PREVIEW_COUNT = 3;
  const hasMore = research.queries.length > PREVIEW_COUNT;
  const displayQueries = showAll
    ? research.queries
    : research.queries.slice(0, PREVIEW_COUNT);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 shadow-sm">
      <div className="flex items-center gap-1.5">
        <Search className="h-3.5 w-3.5 text-blue-700" />
        <span className="text-xs font-semibold text-blue-700">数据层</span>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">
            {research.newSources}
          </span>{' '}
          来源
        </span>
        <span>
          <span className="font-medium text-foreground">
            {Math.round(research.informationGain * 100)}%
          </span>{' '}
          信息增益
        </span>
        <span>
          <span className="font-medium text-foreground">
            {research.queries.length}
          </span>{' '}
          搜索
        </span>
      </div>

      {isExpanded && research.queries.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          {displayQueries.map((q, i) => (
            <p
              key={i}
              className="flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800"
            >
              <AlertCircle className="h-3 w-3 flex-shrink-0 text-blue-500" />
              <TruncatedCell className="max-w-[260px] text-blue-800">
                {q}
              </TruncatedCell>
            </p>
          ))}
          {hasMore && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-0.5 text-left text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              {showAll
                ? '收起'
                : `+${research.queries.length - PREVIEW_COUNT} 条`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface CognitiveLayerCardProps {
  ideas: NonNullable<IterationRound['ideas']>;
  isExpanded: boolean;
  isInit: boolean;
}

function CognitiveLayerCard({
  ideas,
  isExpanded,
  isInit,
}: CognitiveLayerCardProps) {
  const [showAll, setShowAll] = useState(false);
  const PREVIEW_COUNT = 3;
  const newInsightsCount = isInit
    ? ideas.totalInsights
    : ideas.newInsights.length;
  const newCreativeCount = isInit
    ? ideas.totalCreativeIdeas
    : ideas.newCreativeIdeas.length;
  const displayItems = isInit
    ? ideas.newInsights
    : [...ideas.newInsights, ...ideas.newCreativeIdeas];
  const hasMore = displayItems.length > PREVIEW_COUNT;
  const visibleItems = showAll
    ? displayItems
    : displayItems.slice(0, PREVIEW_COUNT);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-purple-200 bg-purple-50 p-3 shadow-sm">
      <div className="flex items-center gap-1.5">
        <Lightbulb className="h-3.5 w-3.5 text-purple-700" />
        <span className="text-xs font-semibold text-purple-700">认知层</span>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">
            {isInit ? '' : '+'}
            {newInsightsCount}
          </span>{' '}
          洞察
        </span>
        <span>
          <span className="font-medium text-foreground">
            {isInit ? '' : '+'}
            {newCreativeCount}
          </span>{' '}
          创意
        </span>
      </div>

      {isExpanded && displayItems.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          {visibleItems.map((item, i) => (
            <p
              key={i}
              className="flex items-center gap-1 rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-800"
            >
              <Lightbulb className="h-3 w-3 flex-shrink-0 text-purple-500" />
              <TruncatedCell className="max-w-[260px] text-purple-800">
                {item.title}
              </TruncatedCell>
            </p>
          ))}
          {hasMore && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-0.5 text-left text-xs font-medium text-purple-600 hover:text-purple-800"
            >
              {showAll ? '收起' : `+${displayItems.length - PREVIEW_COUNT} 条`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface ProductLayerCardProps {
  round: IterationRound;
  isExpanded: boolean;
}

function ProductLayerCard({ round, isExpanded }: ProductLayerCardProps) {
  const [showAll, setShowAll] = useState(false);
  const PREVIEW_COUNT = 4; // 2 data + 2 idea
  const { score, gaps, demo } = round;
  const totalGaps = gaps.dataGaps.length + gaps.ideaGaps.length;
  const isGenerating = demo?.status === 'generating';
  const hasMore = totalGaps > PREVIEW_COUNT;

  const previewDataCount = showAll ? gaps.dataGaps.length : 2;
  const previewIdeaCount = showAll ? gaps.ideaGaps.length : 2;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 shadow-sm">
      <div className="flex items-center gap-1.5">
        <Code2 className="h-3.5 w-3.5 text-amber-700" />
        <span className="text-xs font-semibold text-amber-700">质量评估</span>
        {isGenerating && (
          <Loader2 className="ml-auto h-3 w-3 animate-spin text-amber-600" />
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <div className="mb-1 flex items-baseline gap-1">
            <span className={cn('text-sm font-bold', getScoreColor(score))}>
              {score.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground">得分</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-amber-100">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                getScoreBgColor(score)
              )}
              style={{ width: `${Math.min(score, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{totalGaps}</span>{' '}
        个待改进项
      </div>

      {isExpanded && totalGaps > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          {gaps.dataGaps.slice(0, previewDataCount).map((g, i) => (
            <p
              key={`d-${i}`}
              className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
            >
              <AlertCircle className="h-3 w-3 flex-shrink-0 text-amber-600" />
              <TruncatedCell className="max-w-[260px] text-amber-800">
                {g}
              </TruncatedCell>
            </p>
          ))}
          {gaps.ideaGaps.slice(0, previewIdeaCount).map((g, i) => (
            <p
              key={`i-${i}`}
              className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
            >
              <Lightbulb className="h-3 w-3 flex-shrink-0 text-amber-600" />
              <TruncatedCell className="max-w-[260px] text-amber-800">
                {g}
              </TruncatedCell>
            </p>
          ))}
          {hasMore && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-0.5 text-left text-xs font-medium text-amber-600 hover:text-amber-800"
            >
              {showAll ? '收起' : `+${totalGaps - PREVIEW_COUNT} 条`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== Markdown Record Renderer ====================

interface MarkdownRecordProps {
  content: string;
}

function MarkdownRecord({ content }: MarkdownRecordProps) {
  const lines = content.split('\n');

  type Block =
    | { type: 'h1'; text: string }
    | { type: 'h2'; text: string }
    | { type: 'h3'; text: string }
    | { type: 'table'; rows: string[][] }
    | { type: 'list'; items: string[] }
    | { type: 'paragraph'; text: string };

  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('# ') && !line.startsWith('## ')) {
      // Skip top-level title (redundant with round header)
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4).trim() });
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
      i++;
      continue;
    }

    if (line.trim().startsWith('|')) {
      // Collect table rows
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = lines[i]
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((cell) => cell.trim());
        // Skip separator rows (---|--- pattern)
        if (!row.every((cell) => /^[-: ]+$/.test(cell))) {
          rows.push(row);
        }
        i++;
      }
      if (rows.length > 0) {
        blocks.push({ type: 'table', rows });
      }
      continue;
    }

    if (line.trim().startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        let text = lines[i].trim().slice(2);
        // Strip markdown checkbox syntax "[ ] " or "[x] "
        if (/^\[[ x]\] /.test(text)) text = text.slice(4);
        items.push(text);
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    if (line.trim().length > 0) {
      blocks.push({ type: 'paragraph', text: line.trim() });
    }

    i++;
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      {blocks.map((block, idx) => {
        if (block.type === 'h1') return null;

        if (block.type === 'h2') {
          return (
            <div
              key={idx}
              className="border-b border-gray-200 pb-1 pt-1 text-xs font-semibold text-gray-700"
            >
              {block.text}
            </div>
          );
        }

        if (block.type === 'h3') {
          return (
            <div key={idx} className="text-xs font-medium text-gray-600">
              {block.text}
            </div>
          );
        }

        if (block.type === 'table') {
          const [header, ...bodyRows] = block.rows;
          return (
            <div
              key={idx}
              className="overflow-x-auto rounded border border-gray-200"
            >
              <Table className="w-full text-xs">
                {header && (
                  <THead>
                    <Tr className="bg-gray-100">
                      {header.map((cell, ci) => (
                        <Th
                          key={ci}
                          className="px-2 py-1 text-left font-medium text-gray-700"
                        >
                          {cell}
                        </Th>
                      ))}
                    </Tr>
                  </THead>
                )}
                <TBody>
                  {bodyRows.map((row, ri) => (
                    <Tr
                      key={ri}
                      className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                    >
                      {row.map((cell, ci) => (
                        <Td key={ci} className="px-2 py-1 text-gray-600">
                          {cell}
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          );
        }

        if (block.type === 'list') {
          return (
            <ul key={idx} className="flex flex-col gap-0.5 pl-2">
              {block.items.map((item, ii) => (
                <li
                  key={ii}
                  className="flex items-start gap-1.5 text-xs text-gray-600"
                >
                  <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'paragraph') {
          return (
            <p key={idx} className="text-xs text-gray-600">
              {block.text}
            </p>
          );
        }

        return null;
      })}
    </div>
  );
}

// ==================== Record Panel ====================

interface RecordPanelProps {
  record: string;
}

function RecordPanel({ record }: RecordPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
      >
        <FileText className="h-3.5 w-3.5" />
        <span>{isOpen ? '收起详细记录' : '查看详细记录'}</span>
        {isOpen ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>
      {isOpen && <MarkdownRecord content={record} />}
    </div>
  );
}

// ==================== Round Row ====================

interface RoundRowProps {
  iteration: IterationRound;
  isCurrent: boolean;
  isLast: boolean;
  isActive: boolean;
  defaultExpanded: boolean;
}

function RoundRow({
  iteration,
  isCurrent,
  isLast,
  isActive,
  defaultExpanded,
}: RoundRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isInit = iteration.round === 0;
  const delta = iteration.score - iteration.previousScore;
  const showDelta = !isInit && Math.abs(delta) > 0.01;

  return (
    <div className="relative flex gap-4">
      {/* Timeline connector */}
      {!isLast && (
        <div className="absolute left-5 top-10 h-full w-px bg-border" />
      )}

      {/* Round badge */}
      <div className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center">
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold',
            isCurrent && isActive
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground'
          )}
        >
          {isCurrent && isActive ? (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-foreground" />
            </span>
          ) : (
            iteration.round
          )}
        </div>
      </div>

      {/* Round content */}
      <div className="mb-6 min-w-0 flex-1">
        {/* Round header */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mb-3 flex w-full items-center gap-2 text-left"
        >
          <span className="text-sm font-semibold text-foreground">
            {isInit
              ? '第 0 轮 — 初始分析'
              : `第 ${iteration.round} 轮 — 迭代优化`}
          </span>

          {showDelta && (
            <span
              className={cn(
                'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium',
                delta >= 0
                  ? 'bg-green-500/10 text-green-600'
                  : 'bg-red-500/10 text-red-600'
              )}
            >
              <TrendingUp
                className={cn('h-3 w-3', delta < 0 && 'rotate-180')}
              />
              {formatDelta(delta)}
            </span>
          )}

          <span className="ml-auto text-xs text-muted-foreground">
            {new Date(iteration.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>

          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
        </button>

        {/* Three-layer cards */}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {iteration.research ? (
            <DataLayerCard
              research={iteration.research}
              isExpanded={expanded}
            />
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-blue-200 p-3">
              <span className="text-xs text-muted-foreground">
                初始轮无搜索数据
              </span>
            </div>
          )}

          {iteration.ideas ? (
            <CognitiveLayerCard
              ideas={iteration.ideas}
              isExpanded={expanded}
              isInit={isInit}
            />
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-purple-200 p-3">
              <span className="text-xs text-muted-foreground">
                暂无创意数据
              </span>
            </div>
          )}

          <ProductLayerCard round={iteration} isExpanded={expanded} />
        </div>

        {/* Iteration Record */}
        {iteration.record && <RecordPanel record={iteration.record} />}
      </div>
    </div>
  );
}

// ==================== Feedback Countdown Card ====================

interface FeedbackCountdownProps {
  awaitingFeedback: NonNullable<IterationTimelineProps['awaitingFeedback']>;
  onSendFeedback?: (text: string) => Promise<void>;
}

function FeedbackCountdownCard({
  awaitingFeedback,
  onSendFeedback,
}: FeedbackCountdownProps) {
  const [countdown, setCountdown] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');

  useEffect(() => {
    const total = Math.ceil(awaitingFeedback.timeoutMs / 1000);
    setCountdown(total);
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [awaitingFeedback]);

  const handleSend = useCallback(async () => {
    if (!feedbackText.trim() || !onSendFeedback) return;
    await onSendFeedback(feedbackText.trim());
    setFeedbackText('');
  }, [feedbackText, onSendFeedback]);

  const progressPct =
    (countdown / Math.ceil(awaitingFeedback.timeoutMs / 1000)) * 100;

  return (
    <div className="relative flex gap-4">
      {/* Timeline badge */}
      <div className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-blue-400 bg-blue-50">
          <Timer className="h-4 w-4 text-blue-600" />
        </div>
      </div>

      {/* Countdown content */}
      <div className="mb-6 min-w-0 flex-1">
        <div className="rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">
                第 {awaitingFeedback.round} 轮评估完成
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-bold',
                  awaitingFeedback.score >= 70
                    ? 'bg-green-100 text-green-700'
                    : awaitingFeedback.score >= 40
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-red-100 text-red-700'
                )}
              >
                {awaitingFeedback.score.toFixed(1)}/100
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Timer className="h-3.5 w-3.5" />
              <span>
                {countdown > 0 ? `${countdown}s 后自动继续` : '自动继续中...'}
              </span>
            </div>
          </div>

          {/* Countdown progress bar */}
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-1000"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Gaps summary */}
          <div className="mb-3 grid grid-cols-2 gap-3">
            {awaitingFeedback.gaps.dataGaps.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-500">
                  数据差距
                </p>
                <ul className="space-y-0.5">
                  {awaitingFeedback.gaps.dataGaps.slice(0, 3).map((gap, i) => (
                    <li
                      key={i}
                      className="flex items-center text-xs text-gray-700"
                    >
                      <span className="mr-1 shrink-0 text-blue-500">-</span>
                      <TruncatedCell className="max-w-[200px] text-gray-700">
                        {gap}
                      </TruncatedCell>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {awaitingFeedback.gaps.ideaGaps.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-500">
                  创意差距
                </p>
                <ul className="space-y-0.5">
                  {awaitingFeedback.gaps.ideaGaps.slice(0, 3).map((gap, i) => (
                    <li
                      key={i}
                      className="flex items-center text-xs text-gray-700"
                    >
                      <span className="mr-1 shrink-0 text-indigo-500">-</span>
                      <TruncatedCell className="max-w-[200px] text-gray-700">
                        {gap}
                      </TruncatedCell>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Feedback input */}
          {onSendFeedback && (
            <div>
              <p className="mb-1.5 text-xs text-purple-600">
                输入反馈以引导下一轮研究方向，或等待自动继续
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSend();
                  }}
                  placeholder="输入研究方向建议..."
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100"
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={!feedbackText.trim()}
                  className={cn(
                    'flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                    feedbackText.trim()
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'cursor-not-allowed bg-gray-200 text-gray-400'
                  )}
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== Exit Footer ====================

interface ExitFooterProps {
  exitReason: string;
  finalScore: number | null;
}

function ExitFooter({ exitReason, finalScore }: ExitFooterProps) {
  const isError = exitReason === 'round_error';
  const isSuccess =
    !isError &&
    (exitReason === 'quality_met' ||
      exitReason === 'no_gaps' ||
      exitReason === 'completed');

  return (
    <div className="relative flex gap-4">
      {/* Badge */}
      <div className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center">
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full',
            isError
              ? 'bg-red-50 text-red-700'
              : isSuccess
                ? 'bg-green-50 text-green-700'
                : 'bg-muted text-muted-foreground'
          )}
        >
          {isSuccess ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
        </div>
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex flex-1 items-center gap-3 rounded-lg border px-3 py-2',
          isError
            ? 'border-red-200 bg-red-50'
            : isSuccess
              ? 'border-green-200 bg-green-50'
              : 'border-border bg-muted/30'
        )}
      >
        <div>
          <p
            className={cn(
              'text-sm font-semibold',
              isError
                ? 'text-red-800'
                : isSuccess
                  ? 'text-green-800'
                  : 'text-foreground'
            )}
          >
            {formatExitReason(exitReason)}
          </p>
          {finalScore !== null && (
            <p className={cn('text-xs font-medium', getScoreColor(finalScore))}>
              最终得分: {finalScore.toFixed(1)}%
            </p>
          )}
        </div>

        {finalScore !== null && (
          <div
            className={cn(
              'ml-auto flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold',
              getScoreColor(finalScore),
              getScoreBorderColor(finalScore)
            )}
          >
            {finalScore.toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Main Component ====================

export function IterationTimeline({
  iterations,
  currentRound,
  exitReason,
  finalScore,
  isActive,
  maxIterations,
  qualityThreshold,
  depth,
  awaitingFeedback,
  onSendFeedback,
  className,
}: IterationTimelineProps) {
  if (iterations.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 py-12',
          className
        )}
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">等待首轮迭代...</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header with progress */}
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">迭代优化历程</h3>
        <span className="ml-auto flex items-center gap-2">
          {isActive && maxIterations && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
              进度 {iterations.length}/{maxIterations + 1}
            </span>
          )}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {iterations.length} 轮
          </span>
        </span>
      </div>

      {/* P1-3: Exit criteria transparency panel */}
      {(maxIterations || qualityThreshold || depth) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500">
          {depth && (
            <span>
              深度:{' '}
              <span className="font-medium text-gray-700">
                {formatDepth(depth)}
              </span>
            </span>
          )}
          {maxIterations && (
            <span>
              最大迭代:{' '}
              <span className="font-medium text-gray-700">
                {maxIterations} 轮
              </span>
            </span>
          )}
          {qualityThreshold != null && (
            <span>
              质量目标:{' '}
              <span className="font-medium text-gray-700">
                {(qualityThreshold * 100).toFixed(0)}%
              </span>
            </span>
          )}
          {exitReason && (
            <span className="ml-auto">
              退出原因:{' '}
              <span className="font-medium text-gray-700">
                {formatExitReason(exitReason)}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Score progression summary */}
      {iterations.length > 1 && (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>分数趋势</span>
            <span>
              {iterations[0].score.toFixed(1)}% →{' '}
              {iterations[iterations.length - 1].score.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-end gap-1" style={{ height: '32px' }}>
            {iterations.map((iter, i) => {
              const maxScore = Math.max(...iterations.map((it) => it.score), 1);
              const heightPct = (iter.score / maxScore) * 100;
              const isCurrent = iter.round === currentRound;
              return (
                <div
                  key={i}
                  className="flex flex-1 flex-col items-center justify-end"
                  style={{ height: '100%' }}
                >
                  <div
                    className={cn(
                      'w-full rounded-t transition-all duration-300',
                      isCurrent && isActive
                        ? 'bg-primary'
                        : getScoreBgColor(iter.score),
                      'opacity-80'
                    )}
                    style={{ height: `${heightPct}%`, minHeight: '4px' }}
                    title={`第 ${iter.round} 轮: ${iter.score.toFixed(1)}%`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="flex flex-col">
        {iterations.map((iteration, i) => {
          const isCurrent = iteration.round === currentRound;
          const isLastIteration = i === iterations.length - 1 && !exitReason;
          return (
            <RoundRow
              key={iteration.round}
              iteration={iteration}
              isCurrent={isCurrent}
              isLast={isLastIteration && !exitReason && !awaitingFeedback}
              isActive={isActive}
              defaultExpanded={isCurrent || i === iterations.length - 1}
            />
          );
        })}

        {/* Feedback countdown card */}
        {awaitingFeedback && isActive && (
          <FeedbackCountdownCard
            awaitingFeedback={awaitingFeedback}
            onSendFeedback={onSendFeedback}
          />
        )}

        {/* Exit footer */}
        {exitReason && (
          <ExitFooter exitReason={exitReason} finalScore={finalScore} />
        )}

        {/* Active indicator when still running (not awaiting feedback) */}
        {isActive && !exitReason && !awaitingFeedback && (
          <div className="relative flex gap-4">
            <div className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
            <div className="flex flex-1 items-center pb-2">
              <p className="text-sm text-muted-foreground">
                正在执行第 {currentRound + 1} 轮研究...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
