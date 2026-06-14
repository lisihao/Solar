'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  Cpu,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  XCircle,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Ban,
  Zap,
  Ghost,
  CircleDot,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { AdminPageLayout } from '@/components/admin/layout';
import ClientDate from '@/components/common/ClientDate';
import { TruncatedCell } from '@/components/common/tables';

// ============================
// Types
// ============================

type ProcessState =
  | 'CREATED'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'WAITING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ZOMBIE';

interface ProcessSnapshot {
  id: string;
  userId: string;
  parentId: string | null;
  agentId: string;
  teamSessionId: string | null;
  state: ProcessState;
  priority: number;
  tokenBudget: number;
  tokensUsed: number;
  costBudget: number;
  costUsed: number;
  input: unknown;
  output: unknown;
  error: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface JournalEntry {
  id: string;
  processId: string;
  sequence: number;
  type: string;
  payload: unknown;
  createdAt: string;
}

interface BudgetStatus {
  canProceed: boolean;
  reason?: string;
}

interface ProcessListResponse {
  processes: ProcessSnapshot[];
  total: number;
}

interface ProcessJournalResponse {
  entries: JournalEntry[];
  total: number;
}

interface ActionResponse {
  success: boolean;
  process: ProcessSnapshot;
}

// ============================
// Constants
// ============================

const STATE_FILTERS: Array<ProcessState | 'ALL'> = [
  'ALL',
  'RUNNING',
  'PAUSED',
  'WAITING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'CREATED',
  'READY',
  'ZOMBIE',
];

const STATE_BADGE_CLASSES: Record<ProcessState, string> = {
  RUNNING: 'bg-green-100 text-green-800',
  PAUSED: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-blue-100 text-blue-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-600',
  CREATED: 'bg-slate-100 text-slate-700',
  READY: 'bg-slate-100 text-slate-700',
  WAITING: 'bg-purple-100 text-purple-800',
  ZOMBIE: 'bg-orange-100 text-orange-800',
};

// ============================
// Helpers
// ============================

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatTokens(used: number, budget: number): string {
  return `${used.toLocaleString()} / ${budget.toLocaleString()}`;
}

function getStateIcon(state: ProcessState) {
  switch (state) {
    case 'RUNNING':
      return Loader2;
    case 'PAUSED':
      return Pause;
    case 'COMPLETED':
      return CheckCircle;
    case 'FAILED':
      return AlertCircle;
    case 'CANCELLED':
      return Ban;
    case 'CREATED':
    case 'READY':
      return CircleDot;
    case 'WAITING':
      return Clock;
    case 'ZOMBIE':
      return Ghost;
    default:
      return CircleDot;
  }
}

// ============================
// StatCard
// ============================

interface StatCardProps {
  label: string;
  value: number;
  colorClass: string;
}

function StatCard({ label, value, colorClass }: StatCardProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}

// ============================
// StateBadge
// ============================

function StateBadge({ state }: { state: ProcessState }) {
  const StateIcon = getStateIcon(state);
  const classes = STATE_BADGE_CLASSES[state] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      <StateIcon
        className={`h-3 w-3 ${state === 'RUNNING' ? 'animate-spin' : ''}`}
      />
      {state}
    </span>
  );
}

// ============================
// ActionButtons
// ============================

interface ActionButtonsProps {
  process: ProcessSnapshot;
  apiUrl: string;
  onUpdate: (updated: ProcessSnapshot) => void;
}

function ActionButtons({ process, apiUrl, onUpdate }: ActionButtonsProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const perform = useCallback(
    async (action: 'pause' | 'resume' | 'cancel') => {
      setLoading(action);
      try {
        const res = await fetch(
          `${apiUrl}/admin/kernel/processes/${process.id}/${action}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeader(),
            },
          }
        );
        if (!res.ok) throw new Error(`Action ${action} failed: ${res.status}`);
        const json = await res.json();
        const data = (json?.data ?? json) as ActionResponse;
        onUpdate(data.process);
      } catch (err) {
        logger.error('KernelProcesses', `Action ${action} failed`, err);
      } finally {
        setLoading(null);
      }
    },
    [apiUrl, process.id, onUpdate]
  );

  const canPause = process.state === 'RUNNING' || process.state === 'WAITING';
  const canResume = process.state === 'PAUSED';
  const canCancel =
    process.state === 'RUNNING' ||
    process.state === 'PAUSED' ||
    process.state === 'WAITING' ||
    process.state === 'CREATED' ||
    process.state === 'READY';

  if (!canPause && !canResume && !canCancel) {
    return <span className="text-xs text-gray-400">-</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {canPause && (
        <button
          title="Pause"
          disabled={loading !== null}
          onClick={(e) => {
            e.stopPropagation();
            void perform('pause');
          }}
          className="rounded p-1 text-yellow-600 hover:bg-yellow-50 disabled:opacity-40"
        >
          {loading === 'pause' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Pause className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      {canResume && (
        <button
          title="Resume"
          disabled={loading !== null}
          onClick={(e) => {
            e.stopPropagation();
            void perform('resume');
          }}
          className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-40"
        >
          {loading === 'resume' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      {canCancel && (
        <button
          title="Cancel"
          disabled={loading !== null}
          onClick={(e) => {
            e.stopPropagation();
            void perform('cancel');
          }}
          className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          {loading === 'cancel' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

// ============================
// ProcessDetailPanel
// ============================

interface ProcessDetailPanelProps {
  process: ProcessSnapshot;
  apiUrl: string;
}

function ProcessDetailPanel({ process, apiUrl }: ProcessDetailPanelProps) {
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [loadingJournal, setLoadingJournal] = useState(true);
  const [loadingBudget, setLoadingBudget] = useState(true);

  useEffect(() => {
    const fetchJournal = async () => {
      setLoadingJournal(true);
      try {
        const res = await fetch(
          `${apiUrl}/admin/kernel/processes/${process.id}/journal?limit=10&offset=0`,
          { headers: getAuthHeader() }
        );
        if (!res.ok) throw new Error(`Journal fetch failed: ${res.status}`);
        const json = await res.json();
        const data = (json?.data ?? json) as ProcessJournalResponse;
        setJournal(data.entries);
      } catch (err) {
        logger.error('KernelProcesses', 'Failed to fetch journal', err);
      } finally {
        setLoadingJournal(false);
      }
    };

    const fetchBudget = async () => {
      setLoadingBudget(true);
      try {
        const res = await fetch(
          `${apiUrl}/admin/kernel/processes/${process.id}/budget`,
          { headers: getAuthHeader() }
        );
        if (!res.ok) throw new Error(`Budget fetch failed: ${res.status}`);
        const json = await res.json();
        const data = (json?.data ?? json) as BudgetStatus;
        setBudget(data);
      } catch (err) {
        logger.error('KernelProcesses', 'Failed to fetch budget', err);
      } finally {
        setLoadingBudget(false);
      }
    };

    void fetchJournal();
    void fetchBudget();
  }, [apiUrl, process.id]);

  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      {/* Process Details */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Process Details
        </h4>
        <div className="rounded-lg border bg-white p-3 text-xs">
          <dl className="space-y-1.5">
            <div className="flex justify-between">
              <dt className="text-gray-500">Full ID</dt>
              <dd className="font-mono text-gray-800">{process.id}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Agent</dt>
              <dd className="font-mono text-gray-800">{process.agentId}</dd>
            </div>
            {process.teamSessionId && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Team Session</dt>
                <dd className="font-mono text-gray-800">
                  {process.teamSessionId}
                </dd>
              </div>
            )}
            {process.parentId && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Parent ID</dt>
                <dd className="font-mono text-gray-800">{process.parentId}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-500">User</dt>
              <dd className="font-mono text-gray-800">{process.userId}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Priority</dt>
              <dd className="text-gray-800">{process.priority}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Version</dt>
              <dd className="text-gray-800">{process.version}</dd>
            </div>
            {process.error && (
              <div className="mt-2 rounded border border-red-200 bg-red-50 p-2">
                <dt className="mb-1 font-medium text-red-700">Error</dt>
                <dd className="text-red-600">{process.error}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Budget Status */}
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Budget Status
        </h4>
        <div className="rounded-lg border bg-white p-3 text-xs">
          {loadingBudget ? (
            <div className="flex items-center gap-1.5 text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading budget...
            </div>
          ) : !budget ? (
            <span className="text-gray-400">Unavailable</span>
          ) : (
            <dl className="space-y-1.5">
              <div className="flex items-center justify-between">
                <dt className="text-gray-500">Can Proceed</dt>
                <dd>
                  {budget.canProceed ? (
                    <span className="flex items-center gap-1 text-green-700">
                      <CheckCircle className="h-3.5 w-3.5" />
                      Yes
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-red-700">
                      <XCircle className="h-3.5 w-3.5" />
                      No
                    </span>
                  )}
                </dd>
              </div>
              {budget.reason && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Reason</dt>
                  <dd className="text-gray-800">{budget.reason}</dd>
                </div>
              )}
              <div className="mt-2 space-y-1.5">
                <div>
                  <div className="mb-0.5 flex justify-between text-gray-500">
                    <span>Tokens</span>
                    <span>
                      {process.tokensUsed.toLocaleString()} /{' '}
                      {process.tokenBudget.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full rounded-full ${
                        process.tokenBudget > 0 &&
                        process.tokensUsed / process.tokenBudget > 0.9
                          ? 'bg-red-500'
                          : 'bg-blue-500'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          process.tokenBudget > 0
                            ? (process.tokensUsed / process.tokenBudget) * 100
                            : 0
                        )}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-0.5 flex justify-between text-gray-500">
                    <span>Cost</span>
                    <span>
                      {formatCost(process.costUsed)} /{' '}
                      {formatCost(process.costBudget)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full rounded-full ${
                        process.costBudget > 0 &&
                        process.costUsed / process.costBudget > 0.9
                          ? 'bg-red-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          process.costBudget > 0
                            ? (process.costUsed / process.costBudget) * 100
                            : 0
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </dl>
          )}
        </div>
      </div>

      {/* Event Journal */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Event Journal (Latest 10)
        </h4>
        <div className="rounded-lg border bg-white p-3">
          {loadingJournal ? (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading events...
            </div>
          ) : journal.length === 0 ? (
            <div className="text-xs text-gray-400">No events recorded</div>
          ) : (
            <div className="relative space-y-0">
              {journal.map((entry, idx) => (
                <div key={entry.id} className="flex gap-3">
                  {/* Timeline spine */}
                  <div className="flex flex-col items-center">
                    <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-violet-400" />
                    {idx < journal.length - 1 && (
                      <div className="w-px flex-1 bg-gray-200" />
                    )}
                  </div>
                  {/* Content */}
                  <div className="min-w-0 pb-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium text-gray-800">
                        {entry.type}
                      </span>
                      <span className="text-xs text-gray-400">
                        #{entry.sequence}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-400">
                      <ClientDate date={entry.createdAt} format="datetime" />
                    </div>
                    {entry.payload !== null && entry.payload !== undefined && (
                      <TruncatedCell
                        className="font-mono max-w-[240px] text-xs text-gray-500"
                        tooltip={JSON.stringify(entry.payload)}
                      >
                        {JSON.stringify(entry.payload)}
                      </TruncatedCell>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================
// ProcessRow
// ============================

interface ProcessRowProps {
  process: ProcessSnapshot;
  apiUrl: string;
  onUpdate: (updated: ProcessSnapshot) => void;
}

function ProcessRow({ process, apiUrl, onUpdate }: ProcessRowProps) {
  const [expanded, setExpanded] = useState(false);

  const handleToggle = () => {
    setExpanded((prev) => !prev);
  };

  return (
    <>
      <Tr className="cursor-pointer hover:bg-gray-50" onClick={handleToggle}>
        {/* Expand toggle */}
        <Td className="w-8 px-4 py-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </Td>
        {/* State */}
        <Td className="px-4 py-3">
          <StateBadge state={process.state} />
        </Td>
        {/* Process ID */}
        <Td className="px-4 py-3">
          <TruncatedCell className="font-mono max-w-[120px] text-xs text-gray-700">
            {process.id}
          </TruncatedCell>
        </Td>
        {/* Agent ID */}
        <Td className="px-4 py-3">
          <TruncatedCell className="max-w-[180px] text-sm text-gray-700">
            {process.agentId}
          </TruncatedCell>
        </Td>
        {/* Team Session */}
        <Td className="px-4 py-3">
          {process.teamSessionId ? (
            <TruncatedCell className="font-mono max-w-[120px] text-xs text-gray-500">
              {process.teamSessionId}
            </TruncatedCell>
          ) : (
            <span className="text-xs text-gray-300">-</span>
          )}
        </Td>
        {/* Priority */}
        <Td className="px-4 py-3 text-sm text-gray-600">{process.priority}</Td>
        {/* Tokens */}
        <Td className="px-4 py-3 text-xs text-gray-600">
          {formatTokens(process.tokensUsed, process.tokenBudget)}
        </Td>
        {/* Cost */}
        <Td className="px-4 py-3 text-xs text-gray-600">
          <span>{formatCost(process.costUsed)}</span>
          <span className="text-gray-400">
            {' '}
            / {formatCost(process.costBudget)}
          </span>
        </Td>
        {/* Created At */}
        <Td className="px-4 py-3 text-xs text-gray-500">
          <ClientDate date={process.createdAt} format="datetime" />
        </Td>
        {/* Actions */}
        <Td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <ActionButtons
            process={process}
            apiUrl={apiUrl}
            onUpdate={onUpdate}
          />
        </Td>
      </Tr>
      {expanded && (
        <Tr>
          <Td colSpan={10} className="border-t bg-gray-50 p-0">
            <ProcessDetailPanel process={process} apiUrl={apiUrl} />
          </Td>
        </Tr>
      )}
    </>
  );
}

// ============================
// Main Page
// ============================

export default function KernelProcessesPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [processes, setProcesses] = useState<ProcessSnapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<ProcessState | 'ALL'>('ALL');
  const apiUrl = config.apiUrl;

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (stateFilter !== 'ALL') {
        params.append('states', stateFilter);
      }

      const res = await fetch(
        `${apiUrl}/admin/kernel/processes?${params.toString()}`,
        { headers: getAuthHeader() }
      );

      if (!res.ok) throw new Error(`Fetch processes failed: ${res.status}`);
      const json = await res.json();
      const data = (json?.data ?? json) as ProcessListResponse;
      setProcesses(data.processes ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      logger.error('KernelProcesses', 'Failed to fetch processes', err);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, stateFilter]);

  // Initial fetch and filter-driven refetch
  useEffect(() => {
    void fetchProcesses();
  }, [fetchProcesses]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchProcesses();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchProcesses]);

  // Update a single process in-place after an action
  const handleProcessUpdate = useCallback((updated: ProcessSnapshot) => {
    setProcesses((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
  }, []);

  // Derived summary stats
  const stats = {
    total,
    running: processes.filter((p) => p.state === 'RUNNING').length,
    paused: processes.filter((p) => p.state === 'PAUSED').length,
    completed: processes.filter((p) => p.state === 'COMPLETED').length,
    failed: processes.filter((p) => p.state === 'FAILED').length,
  };

  const refreshButton = (
    <button
      onClick={() => void fetchProcesses()}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      Refresh
    </button>
  );

  const body = (
    <div className="space-y-4">
      {embedded && <div className="flex justify-end">{refreshButton}</div>}
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Total"
          value={stats.total}
          colorClass="text-gray-900"
        />
        <StatCard
          label="Running"
          value={stats.running}
          colorClass="text-green-600"
        />
        <StatCard
          label="Paused"
          value={stats.paused}
          colorClass="text-yellow-600"
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          colorClass="text-blue-600"
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          colorClass="text-red-600"
        />
      </div>

      {/* State Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Zap className="h-4 w-4 text-gray-400" />
        {STATE_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStateFilter(f)}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
              stateFilter === f
                ? 'bg-violet-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Process Table */}
      <div className="rounded-lg bg-white shadow">
        {loading && processes.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading processes...
          </div>
        ) : processes.length === 0 ? (
          <EmptyState
            icon={<Cpu className="h-12 w-12" />}
            title={`No processes found${stateFilter !== 'ALL' ? ` with state: ${stateFilter}` : ''}`}
            size="sm"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[4%]" />
                <col className="w-[9%]" />
                <col className="w-[12%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
                <col className="w-[7%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[6%]" />
              </colgroup>
              <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <Tr>
                  <Th className="w-8 px-4 py-3" />
                  <Th className="px-4 py-3">State</Th>
                  <Th className="px-4 py-3">Process ID</Th>
                  <Th className="px-4 py-3">Agent</Th>
                  <Th className="px-4 py-3">Team Session</Th>
                  <Th className="px-4 py-3">Priority</Th>
                  <Th className="px-4 py-3">Tokens</Th>
                  <Th className="px-4 py-3">Cost</Th>
                  <Th className="px-4 py-3">Created At</Th>
                  <Th className="px-4 py-3">Actions</Th>
                </Tr>
              </THead>
              <TBody className="divide-y">
                {processes.map((proc) => (
                  <ProcessRow
                    key={proc.id}
                    process={proc}
                    apiUrl={apiUrl}
                    onUpdate={handleProcessUpdate}
                  />
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>

      {/* Footer row count */}
      {processes.length > 0 && (
        <p className="text-right text-xs text-gray-400">
          Showing {processes.length} of {total} processes
          {stateFilter !== 'ALL' && ` (filter: ${stateFilter})`}
        </p>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <AdminPageLayout
      title="AI Kernel Processes"
      description="Monitor and control AI kernel process execution in real time"
      icon={Cpu}
      domain="ai"
      actions={refreshButton}
    >
      {body}
    </AdminPageLayout>
  );
}
