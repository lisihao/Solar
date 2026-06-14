'use client';

/**
 * Eval Dashboard
 *
 * 支柱五 5b：AI 质量评估 Admin 页面
 *
 * 列出最近 50 条 Trace，允许管理员手动触发三层质量评估
 * 并实时展示 Layer1 结构分、Layer2 AI Judge 分、综合分及改进建议。
 */

import { useState, useCallback, useEffect } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  BarChart3,
  RefreshCw,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Loader,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { AdminPageLayout } from '@/components/admin/layout';
import { apiClient } from '@/lib/api/client';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { TruncatedCell } from '@/components/common/tables';

// ─── Types ───────────────────────────────────────────────

type TraceStatus = 'running' | 'success' | 'error';

interface TraceSummary {
  id: string;
  name: string;
  type: string;
  status: TraceStatus;
  duration?: number;
  startTime: string;
  // Backend 返回 spanCount: number（trace-collector listTraces 仅返回汇总，不返回
  // spans 数组）。原 spans: { id }[] 是 lying type，trace.spans.length 必炸。
  spanCount?: number;
}

interface DimensionScore {
  accuracy: number;
  relevance: number;
  readability: number;
  completeness: number;
}

interface StructuralChecks {
  spanSuccessRate: number;
  hasOutput: boolean;
  durationReasonable: boolean;
  toolSuccessRate: number;
  passed: boolean;
  failReason?: string;
}

interface EvalResult {
  traceId: string;
  structuralScore: number;
  judgeScore: number | null;
  dimensions: DimensionScore | null;
  overallScore: number;
  structuralChecks: StructuralChecks;
  suggestions: string | null;
  judgeEvaluated: boolean;
  evaluatedAt: string;
}

interface EvalRunSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  passRate: number;
  averageScore: number;
}

interface EvalRunResult {
  id: string;
  datasetId: string;
  datasetName: string;
  datasetVersion?: string;
  status: 'completed' | 'failed';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  summary: EvalRunSummary;
}

// ─── Helpers ─────────────────────────────────────────────

function formatDuration(ms?: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 50) return 'text-yellow-600';
  return 'text-red-600';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-green-100 text-green-700';
  if (score >= 50) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

function DimensionBar({ label, value }: { label: string; value: number }) {
  const pct = ((value - 1) / 4) * 100;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{label}</span>
        <span className="font-medium text-gray-700">{value.toFixed(1)}/5</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TraceStatus }) {
  if (status === 'success')
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-green-600">
        <CheckCircle className="h-3 w-3" />
        success
      </span>
    );
  if (status === 'error')
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-red-600">
        <XCircle className="h-3 w-3" />
        error
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-blue-600">
      <Loader className="h-3 w-3 animate-spin" />
      running
    </span>
  );
}

// ─── Eval Result Panel ───────────────────────────────────

function EvalResultPanel({ result }: { result: EvalResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      {/* Score row */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Overall</span>
          <span
            className={`text-base font-bold ${scoreColor(result.overallScore)}`}
          >
            {result.overallScore.toFixed(0)}
          </span>
          <span className="text-xs text-gray-400">/100</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Structural</span>
          <span
            className={`text-sm font-semibold ${scoreColor(result.structuralScore)}`}
          >
            {result.structuralScore}
          </span>
        </div>
        {result.judgeScore !== null && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">AI Judge</span>
            <span
              className={`text-sm font-semibold ${scoreColor(((result.judgeScore - 1) / 4) * 100)}`}
            >
              {result.judgeScore.toFixed(2)}/5
            </span>
          </div>
        )}
        {!result.structuralChecks.passed && (
          <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">
            <AlertTriangle className="h-3 w-3" />
            {result.structuralChecks.failReason}
          </span>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {expanded ? 'Less' : 'Details'}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Structural checks */}
          <div>
            <p className="mb-1 text-xs font-medium text-gray-600">
              Layer 1 — Structural
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-gray-500">
              <span>
                Span success rate:{' '}
                <strong className="text-gray-700">
                  {(result.structuralChecks.spanSuccessRate * 100).toFixed(0)}%
                </strong>
              </span>
              <span>
                Tool success rate:{' '}
                <strong className="text-gray-700">
                  {(result.structuralChecks.toolSuccessRate * 100).toFixed(0)}%
                </strong>
              </span>
              <span>
                Has output:{' '}
                <strong className="text-gray-700">
                  {result.structuralChecks.hasOutput ? 'Yes' : 'No'}
                </strong>
              </span>
              <span>
                Duration OK:{' '}
                <strong className="text-gray-700">
                  {result.structuralChecks.durationReasonable ? 'Yes' : 'No'}
                </strong>
              </span>
            </div>
          </div>

          {/* Dimensions */}
          {result.dimensions && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-600">
                Layer 2 — AI Judge Dimensions
              </p>
              <div className="space-y-1.5">
                <DimensionBar
                  label="Accuracy"
                  value={result.dimensions.accuracy}
                />
                <DimensionBar
                  label="Relevance"
                  value={result.dimensions.relevance}
                />
                <DimensionBar
                  label="Readability"
                  value={result.dimensions.readability}
                />
                <DimensionBar
                  label="Completeness"
                  value={result.dimensions.completeness}
                />
              </div>
            </div>
          )}

          {/* Suggestions */}
          {result.suggestions && (
            <div className="rounded border border-blue-100 bg-blue-50 p-2 text-xs text-blue-700">
              <strong className="mb-0.5 block">Suggestions:</strong>
              {result.suggestions}
            </div>
          )}

          <p className="text-xs text-gray-400">
            Evaluated at {formatTime(result.evaluatedAt)}
            {result.judgeEvaluated ? ' · AI Judge ran' : ' · AI Judge skipped'}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Trace Row ───────────────────────────────────────────

function TraceRow({
  trace,
  evalResult,
  evaluating,
  onEvaluate,
}: {
  trace: TraceSummary;
  evalResult: EvalResult | null;
  evaluating: boolean;
  onEvaluate: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        {/* Left */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={trace.status} />
            <span className="truncate font-medium text-gray-900">
              {trace.name}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
            <span className="font-mono rounded-full bg-gray-100 px-2 py-0.5">
              {trace.type}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(trace.duration)}
            </span>
            <span>{trace.spanCount ?? 0} spans</span>
            <span>{formatTime(trace.startTime)}</span>
          </div>
        </div>

        {/* Right: eval button + score badge */}
        <div className="flex shrink-0 items-center gap-2">
          {evalResult && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${scoreBg(evalResult.overallScore)}`}
            >
              {evalResult.overallScore.toFixed(0)}
            </span>
          )}
          <button
            onClick={() => onEvaluate(trace.id)}
            disabled={evaluating || trace.status === 'running'}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {evaluating ? (
              <Loader className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {evaluating ? 'Evaluating…' : 'Evaluate'}
          </button>
        </div>
      </div>

      {/* Eval Result */}
      {evalResult && <EvalResultPanel result={evalResult} />}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────

export default function EvalDashboardPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvalRunResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [evalResults, setEvalResults] = useState<Record<string, EvalResult>>(
    {}
  );
  const [evaluating, setEvaluating] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchTraces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<TraceSummary[]>(
        '/admin/monitoring/traces?limit=50'
      );
      setTraces(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load traces');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEvalRuns = useCallback(async () => {
    try {
      const data = await apiClient.get<EvalRunResult[]>(
        '/admin/evals/runs?limit=10'
      );
      setEvalRuns(Array.isArray(data) ? data : []);
    } catch {
      setEvalRuns([]);
    }
  }, []);

  useEffect(() => {
    fetchTraces();
    fetchEvalRuns();
  }, [fetchTraces, fetchEvalRuns]);

  const handleEvaluate = useCallback(async (traceId: string) => {
    setEvaluating((prev) => ({ ...prev, [traceId]: true }));
    try {
      const result = await apiClient.post<EvalResult>(
        `/admin/monitoring/traces/${traceId}/evaluate`
      );
      setEvalResults((prev) => ({ ...prev, [traceId]: result }));
    } catch {
      // Silently ignore eval errors — row stays evaluatable, button re-enabled
    } finally {
      setEvaluating((prev) => ({ ...prev, [traceId]: false }));
    }
  }, []);

  const evaluatedCount = Object.keys(evalResults).length;
  const avgScore =
    evaluatedCount > 0
      ? Object.values(evalResults).reduce((s, r) => s + r.overallScore, 0) /
        evaluatedCount
      : null;

  const refreshButton = (
    <button
      onClick={() => {
        fetchTraces();
        fetchEvalRuns();
      }}
      disabled={loading}
      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      Refresh
    </button>
  );

  const body = (
    <>
      {/* 嵌入模式：actions 内联到顶部 */}
      {embedded && <div className="mb-4 flex justify-end">{refreshButton}</div>}
      {/* Summary bar */}
      {evaluatedCount > 0 && (
        <div className="mb-6 flex items-center gap-6 rounded-xl border border-gray-100 bg-white px-6 py-4 shadow-sm">
          <div>
            <p className="text-xs text-gray-500">Evaluated</p>
            <p className="text-2xl font-bold text-gray-900">{evaluatedCount}</p>
          </div>
          {avgScore !== null && (
            <div>
              <p className="text-xs text-gray-500">Average Score</p>
              <p className={`text-2xl font-bold ${scoreColor(avgScore)}`}>
                {avgScore.toFixed(1)}
                <span className="text-sm font-normal text-gray-400">/100</span>
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500">Judge Ran</p>
            <p className="text-2xl font-bold text-gray-900">
              {
                Object.values(evalResults).filter((r) => r.judgeEvaluated)
                  .length
              }
            </p>
          </div>
        </div>
      )}

      {evalRuns.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Recent Eval Runs
              </h2>
              <p className="text-xs text-gray-500">
                Stored dataset and experiment runs from the harness eval API
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
              {evalRuns.length} runs
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[20%]" />
              </colgroup>
              <THead className="border-b text-xs uppercase text-gray-400">
                <Tr>
                  <Th className="py-2 pr-4">Dataset</Th>
                  <Th className="py-2 pr-4">Status</Th>
                  <Th className="py-2 pr-4">Score</Th>
                  <Th className="py-2 pr-4">Pass Rate</Th>
                  <Th className="py-2 pr-4">Cases</Th>
                  <Th className="py-2 pr-4">Started</Th>
                </Tr>
              </THead>
              <TBody className="divide-y">
                {evalRuns.map((run) => (
                  <Tr key={run.id}>
                    <Td className="py-2 pr-4">
                      <TruncatedCell
                        className="max-w-[200px] font-medium text-gray-900"
                        tooltip={`${run.datasetId}${run.datasetVersion ? `:${run.datasetVersion}` : ''}`}
                      >
                        {run.datasetName}
                      </TruncatedCell>
                      <TruncatedCell className="font-mono max-w-[200px] text-xs text-gray-400">
                        {run.datasetId}
                        {run.datasetVersion ? `:${run.datasetVersion}` : ''}
                      </TruncatedCell>
                    </Td>
                    <Td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          run.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {run.status}
                      </span>
                    </Td>
                    <Td
                      className={`py-2 pr-4 font-semibold ${scoreColor(
                        run.summary.averageScore
                      )}`}
                    >
                      {run.summary.averageScore}
                    </Td>
                    <Td className="py-2 pr-4 text-gray-700">
                      {(run.summary.passRate * 100).toFixed(0)}%
                    </Td>
                    <Td className="py-2 pr-4 text-gray-500">
                      {run.summary.passed}/{run.summary.total}
                    </Td>
                    <Td className="py-2 pr-4 text-gray-500">
                      {formatTime(run.startedAt)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && traces.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl bg-gray-100"
            />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && traces.length === 0 && !error && (
        <EmptyState
          icon={<BarChart3 className="h-12 w-12" />}
          title="No traces found"
          description="Run some AI tasks first."
          size="md"
        />
      )}

      {/* Trace list */}
      <div className="space-y-3">
        {traces.map((trace) => (
          <TraceRow
            key={trace.id}
            trace={trace}
            evalResult={evalResults[trace.id] ?? null}
            evaluating={evaluating[trace.id] ?? false}
            onEvaluate={handleEvaluate}
          />
        ))}
      </div>
    </>
  );

  if (embedded) return body;

  return (
    <AdminPageLayout
      title="Eval Dashboard"
      description="AI execution quality evaluation — 3-layer scoring for Agent traces"
      icon={BarChart3}
      domain="ai"
      actions={refreshButton}
    >
      {body}
    </AdminPageLayout>
  );
}
