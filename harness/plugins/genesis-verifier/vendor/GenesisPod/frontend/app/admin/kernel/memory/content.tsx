'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  Database,
  Search,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { AdminPageLayout } from '@/components/admin/layout';
import { AdminDrawer } from '@/components/admin/shared';
import { TruncatedCell } from '@/components/common/tables';

// ============================
// Types
// ============================

type MemoryLayer = 'WORKING' | 'SESSION' | 'PERSISTENT';
type LayerFilter = MemoryLayer | 'ALL';

interface MemoryEntry {
  processId: string;
  layer: MemoryLayer;
  key: string;
  value: unknown;
  expiresAt?: string;
}

interface MemoryQueryResponse {
  entries: MemoryEntry[];
  total: number;
}

interface CleanExpiredResponse {
  success: boolean;
  deleted: number;
}

type ProcessState =
  | 'CREATED'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'WAITING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

interface ProcessSummary {
  id: string;
  state: ProcessState;
  agentId: string;
  createdAt: string;
}

interface ProcessListResponse {
  processes: ProcessSummary[];
  total: number;
}

// ============================
// Constants
// ============================

const LAYER_OPTIONS: LayerFilter[] = [
  'ALL',
  'WORKING',
  'SESSION',
  'PERSISTENT',
];

const LAYER_BADGE_CLASSES: Record<MemoryLayer, string> = {
  WORKING: 'bg-blue-100 text-blue-800',
  SESSION: 'bg-purple-100 text-purple-800',
  PERSISTENT: 'bg-green-100 text-green-800',
};

const STATE_BADGE_CLASSES: Record<ProcessState, string> = {
  RUNNING: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  WAITING: 'bg-blue-100 text-blue-700',
  READY: 'bg-cyan-100 text-cyan-700',
  CREATED: 'bg-gray-100 text-gray-600',
  COMPLETED: 'bg-gray-100 text-gray-500',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-400',
};

// ============================
// Helpers
// ============================

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function formatExpiresAt(expiresAt?: string): string {
  if (!expiresAt) return 'Never';
  const date = new Date(expiresAt);
  const now = Date.now();
  const diff = date.getTime() - now;
  if (diff < 0) return 'Expired';
  return date.toLocaleString();
}

// ============================
// LayerBadge
// ============================

function LayerBadge({ layer }: { layer: MemoryLayer }) {
  const classes = LAYER_BADGE_CLASSES[layer] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {layer}
    </span>
  );
}

// ============================
// MemoryEntryRow
// ============================

interface MemoryEntryRowProps {
  entry: MemoryEntry;
}

function MemoryEntryRow({ entry }: MemoryEntryRowProps) {
  const [expanded, setExpanded] = useState(false);
  const fullValue = formatValue(entry.value);
  const isLong = fullValue.length > 120;

  return (
    <>
      <Tr
        className={
          isLong ? 'cursor-pointer hover:bg-gray-50' : 'hover:bg-gray-50'
        }
        onClick={() => isLong && setExpanded((prev) => !prev)}
      >
        {/* Expand toggle */}
        <Td className="w-8 px-4 py-3">
          {isLong ? (
            expanded ? (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-400" />
            )
          ) : (
            <span className="inline-block h-4 w-4" />
          )}
        </Td>
        {/* Process ID */}
        <Td className="px-4 py-3">
          <TruncatedCell className="font-mono max-w-[180px] text-xs text-gray-700">
            {entry.processId}
          </TruncatedCell>
        </Td>
        {/* Layer */}
        <Td className="px-4 py-3">
          <LayerBadge layer={entry.layer} />
        </Td>
        {/* Key */}
        <Td className="px-4 py-3">
          <TruncatedCell className="font-mono max-w-[160px] text-xs font-medium text-gray-800">
            {entry.key}
          </TruncatedCell>
        </Td>
        {/* Value */}
        <Td className="px-4 py-3">
          {expanded ? (
            <span className="font-mono text-xs text-gray-600">{fullValue}</span>
          ) : (
            <TruncatedCell
              className="font-mono max-w-[240px] text-xs text-gray-600"
              tooltip={fullValue}
            >
              {fullValue}
            </TruncatedCell>
          )}
        </Td>
        {/* Expires At */}
        <Td className="px-4 py-3 text-xs text-gray-500">
          {formatExpiresAt(entry.expiresAt)}
        </Td>
      </Tr>
      {expanded && isLong && (
        <Tr>
          <Td colSpan={6} className="border-t bg-gray-50 px-4 py-3">
            <pre className="font-mono whitespace-pre-wrap break-all text-xs text-gray-700">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(fullValue), null, 2);
                } catch {
                  return fullValue;
                }
              })()}
            </pre>
          </Td>
        </Tr>
      )}
    </>
  );
}

// ============================
// Main Page
// ============================

export default function KernelMemoryPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [processId, setProcessId] = useState('');
  const [layer, setLayer] = useState<LayerFilter>('ALL');
  const [limit, setLimit] = useState('50');

  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const [processes, setProcesses] = useState<ProcessSummary[]>([]);
  const [processesLoading, setProcessesLoading] = useState(false);
  const initialFetchDone = useRef(false);

  const [cleaningProcessId, setCleaningProcessId] = useState<string | null>(
    null
  );
  const [cleanResult, setCleanResult] = useState<{
    processId: string;
    deleted: number;
  } | null>(null);

  // 点击 Recent Processes 行 → 打开详情抽屉（用户反馈：行无反应，应该展开抽屉看详情）
  const [drawerProcess, setDrawerProcess] = useState<ProcessSummary | null>(
    null
  );

  const apiUrl = config.apiUrl;

  const fetchMemory = useCallback(
    async (targetProcessId?: string) => {
      const pid = targetProcessId ?? processId;
      if (!pid.trim()) return;

      setLoading(true);
      setCleanResult(null);
      try {
        const params = new URLSearchParams({ processId: pid.trim() });
        if (layer !== 'ALL') params.append('layer', layer);
        const parsedLimit = parseInt(limit, 10);
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          params.append('limit', String(parsedLimit));
        }

        const res = await fetch(
          `${apiUrl}/admin/kernel/memory?${params.toString()}`,
          {
            headers: getAuthHeader(),
          }
        );
        if (!res.ok) throw new Error(`Memory query failed: ${res.status}`);
        const json = await res.json();
        const data = (json?.data ?? json) as MemoryQueryResponse;
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
        setSearched(true);
      } catch (err) {
        logger.error('KernelMemory', 'Failed to query memory', err);
        setEntries([]);
        setTotal(0);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [apiUrl, processId, layer, limit]
  );

  // Fetch process list on mount
  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;

    const fetchProcesses = async () => {
      setProcessesLoading(true);
      try {
        const res = await fetch(`${apiUrl}/admin/kernel/processes?limit=50`, {
          headers: getAuthHeader(),
        });
        if (!res.ok) return;
        const json = await res.json();
        const data = (json?.data ?? json) as ProcessListResponse;
        const list = data.processes ?? [];
        setProcesses(list);

        // Auto-select first RUNNING process, or first process with memory
        const running = list.find((p) => p.state === 'RUNNING');
        const first = running ?? list[0];
        if (first) {
          setProcessId(first.id);
        }
      } catch (err) {
        logger.error('KernelMemory', 'Failed to fetch processes', err);
      } finally {
        setProcessesLoading(false);
      }
    };
    void fetchProcesses();
  }, [apiUrl]);

  const handleSearch = () => {
    void fetchMemory();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void fetchMemory();
    }
  };

  const handleProcessSelect = (pid: string) => {
    setProcessId(pid);
    setSearched(false);
    void fetchMemory(pid);
  };

  const handleProcessRowClick = (p: ProcessSummary) => {
    setDrawerProcess(p);
    setProcessId(p.id);
    setSearched(false);
    void fetchMemory(p.id);
  };

  const handleCleanExpired = useCallback(
    async (targetProcessId: string) => {
      setCleaningProcessId(targetProcessId);
      setCleanResult(null);
      try {
        const res = await fetch(
          `${apiUrl}/admin/kernel/memory/${encodeURIComponent(targetProcessId)}/expired`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          }
        );
        if (!res.ok) throw new Error(`Clean expired failed: ${res.status}`);
        const json = await res.json();
        const data = (json?.data ?? json) as CleanExpiredResponse;
        setCleanResult({ processId: targetProcessId, deleted: data.deleted });
        // Re-fetch to reflect cleaned entries
        void fetchMemory();
      } catch (err) {
        logger.error('KernelMemory', 'Failed to clean expired entries', err);
      } finally {
        setCleaningProcessId(null);
      }
    },
    [apiUrl, fetchMemory]
  );

  // Unique process IDs in current result set (for "Clean Expired" buttons)
  const uniqueProcessIds = Array.from(new Set(entries.map((e) => e.processId)));

  const body = (
    <div className="space-y-4">
      {/* Recent Processes Table */}
      {processes.length > 0 && (
        <div className="rounded-lg bg-white shadow">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">
              Recent Processes
            </h3>
            <span className="text-xs text-gray-400">
              {processes.length} processes
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table className="w-full text-left text-sm">
              <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <Tr>
                  <Th className="px-4 py-2.5">State</Th>
                  <Th className="px-4 py-2.5">Process ID</Th>
                  <Th className="px-4 py-2.5">Agent</Th>
                  <Th className="px-4 py-2.5">Created</Th>
                </Tr>
              </THead>
              <TBody className="divide-y">
                {processes.map((p) => (
                  <Tr
                    key={p.id}
                    onClick={() => handleProcessRowClick(p)}
                    className={`cursor-pointer transition-colors ${
                      processId === p.id ? 'bg-violet-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <Td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATE_BADGE_CLASSES[p.state]}`}
                      >
                        {p.state}
                      </span>
                    </Td>
                    <Td className="px-4 py-2.5">
                      <TruncatedCell className="font-mono max-w-[200px] text-xs text-gray-700">
                        {p.id}
                      </TruncatedCell>
                    </Td>
                    <Td className="px-4 py-2.5">
                      <TruncatedCell className="max-w-[160px] text-xs text-gray-600">
                        {p.agentId || '-'}
                      </TruncatedCell>
                    </Td>
                    <Td className="px-4 py-2.5 text-xs text-gray-500">
                      {new Date(p.createdAt).toLocaleString()}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </div>
      )}
      {processesLoading && (
        <div className="flex items-center gap-2 rounded-lg bg-white p-4 text-xs text-gray-500 shadow">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading processes...
        </div>
      )}

      {/* Search Form */}
      <div className="rounded-lg bg-white p-4 shadow">
        <div className="flex flex-wrap items-end gap-3">
          {/* Process ID */}
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Process ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={processId}
              onChange={(e) => setProcessId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter process ID or select from above"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          {/* Layer Filter */}
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Layer
            </label>
            <select
              value={layer}
              onChange={(e) => setLayer(e.target.value as LayerFilter)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              {LAYER_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {/* Limit */}
          <div className="w-24">
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Limit
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          {/* Search Button */}
          <button
            onClick={handleSearch}
            disabled={!processId.trim() || loading}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </button>
        </div>
      </div>

      {/* Clean Expired + Result Banner */}
      {searched && entries.length > 0 && uniqueProcessIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {uniqueProcessIds.map((pid) => (
            <button
              key={pid}
              onClick={() => void handleCleanExpired(pid)}
              disabled={cleaningProcessId === pid}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {cleaningProcessId === pid ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Clean Expired
              {uniqueProcessIds.length > 1 && (
                <span className="font-mono ml-1 text-red-400">
                  ({pid.slice(0, 8)}…)
                </span>
              )}
            </button>
          ))}
          {cleanResult && (
            <span className="text-xs text-green-700">
              Deleted {cleanResult.deleted} expired{' '}
              {cleanResult.deleted === 1 ? 'entry' : 'entries'}.
            </span>
          )}
        </div>
      )}

      {/* Results */}
      <div className="rounded-lg bg-white shadow">
        {!searched ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-gray-400">
            <Database className="h-8 w-8 opacity-40" />
            <p className="text-sm">
              {processes.length > 0
                ? 'Select a process above or enter a Process ID to query memory entries'
                : 'Enter a Process ID to query memory entries'}
            </p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading memory entries...
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Database className="h-12 w-12" />}
            title={`No memory entries found for this process${layer !== 'ALL' ? ` in layer: ${layer}` : ''}`}
            size="sm"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[5%]" />
                <col className="w-[22%]" />
                <col className="w-[10%]" />
                <col className="w-[18%]" />
                <col className="w-[29%]" />
                <col className="w-[16%]" />
              </colgroup>
              <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <Tr>
                  <Th className="w-8 px-4 py-3" />
                  <Th className="px-4 py-3">Process ID</Th>
                  <Th className="px-4 py-3">Layer</Th>
                  <Th className="px-4 py-3">Key</Th>
                  <Th className="px-4 py-3">Value</Th>
                  <Th className="px-4 py-3">Expires At</Th>
                </Tr>
              </THead>
              <TBody className="divide-y">
                {entries.map((entry, idx) => (
                  <MemoryEntryRow
                    key={`${entry.processId}-${entry.layer}-${entry.key}-${idx}`}
                    entry={entry}
                  />
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>

      {/* Footer count */}
      {searched && entries.length > 0 && (
        <p className="text-right text-xs text-gray-400">
          Showing {entries.length} of {total} entries
          {layer !== 'ALL' ? ` (layer: ${layer})` : ''}
        </p>
      )}

      {/* Process Detail Drawer (Recent Processes 行点击 → 详情抽屉) */}
      <AdminDrawer
        open={!!drawerProcess}
        onClose={() => setDrawerProcess(null)}
        title="Process Detail"
        description={drawerProcess?.id ?? ''}
        size="lg"
      >
        {drawerProcess && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500">
                  State
                </p>
                <span
                  className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE_CLASSES[drawerProcess.state]}`}
                >
                  {drawerProcess.state}
                </span>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500">
                  Agent
                </p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {drawerProcess.agentId || '-'}
                </p>
              </div>
              <div className="col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500">
                  Created
                </p>
                <p className="mt-1 text-sm text-gray-900">
                  {new Date(drawerProcess.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500">
                  Process ID
                </p>
                <p className="font-mono mt-1 break-all text-xs text-gray-700">
                  {drawerProcess.id}
                </p>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-900">
                  Memory Entries
                </h4>
                <span className="text-xs text-gray-400">
                  {searched
                    ? `${entries.length} / ${total} entries`
                    : 'Loading…'}
                </span>
              </div>
              {loading ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading memory entries...
                </div>
              ) : entries.length === 0 ? (
                <EmptyState
                  icon={<Database className="h-8 w-8" />}
                  title="No memory entries for this process."
                  size="sm"
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <Table className="w-full text-left text-xs">
                    <THead className="border-b bg-gray-50 text-[10px] uppercase text-gray-500">
                      <Tr>
                        <Th className="px-3 py-2">Layer</Th>
                        <Th className="px-3 py-2">Key</Th>
                        <Th className="px-3 py-2">Value</Th>
                        <Th className="px-3 py-2">Expires</Th>
                      </Tr>
                    </THead>
                    <TBody className="divide-y">
                      {entries.map((e, idx) => (
                        <Tr
                          key={`${e.processId}-${e.layer}-${e.key}-${idx}`}
                          className="hover:bg-gray-50"
                        >
                          <Td className="px-3 py-2">
                            <LayerBadge layer={e.layer} />
                          </Td>
                          <Td className="px-3 py-2">
                            <TruncatedCell className="font-mono max-w-[140px] text-[11px] text-gray-700">
                              {e.key}
                            </TruncatedCell>
                          </Td>
                          <Td className="px-3 py-2">
                            <TruncatedCell
                              className="font-mono max-w-[220px] text-[11px] text-gray-500"
                              tooltip={formatValue(e.value)}
                            >
                              {formatValue(e.value)}
                            </TruncatedCell>
                          </Td>
                          <Td className="px-3 py-2 text-[10px] text-gray-400">
                            {formatExpiresAt(e.expiresAt)}
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </AdminDrawer>
    </div>
  );

  // ★ embedded 模式: 跳过外层 AdminPageLayout (供 /admin/ai/harness?tab=memory 内嵌).
  if (embedded) return body;

  return (
    <AdminPageLayout
      title="Process Memory"
      description="Query and manage AI kernel process memory entries by layer"
      icon={Database}
      domain="ai"
    >
      {body}
    </AdminPageLayout>
  );
}
