'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { ScrollText, RefreshCw, Loader2, Search } from 'lucide-react';
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

interface JournalEntry {
  id: string;
  processId: string;
  sequence: number;
  type: string;
  payload: unknown;
  timestamp: string;
}

interface JournalResponse {
  entries: JournalEntry[];
  total: number;
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
// Main Page
// ============================

export default function KernelJournalPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [processIdFilter, setProcessIdFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const apiUrl = config.apiUrl;

  const fetchJournal = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (processIdFilter.trim()) {
        params.append('processId', processIdFilter.trim());
      }
      if (typeFilter.trim()) {
        params.append('type', typeFilter.trim());
      }

      const res = await fetch(
        `${apiUrl}/admin/kernel/journal?${params.toString()}`,
        { headers: getAuthHeader() }
      );
      if (!res.ok) throw new Error(`Fetch journal failed: ${res.status}`);
      const json = await res.json();
      const data = (json?.data ?? json) as JournalResponse;
      setEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      logger.error('KernelJournal', 'Failed to fetch journal entries', err);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, processIdFilter, typeFilter]);

  // Initial fetch and filter-driven refetch
  useEffect(() => {
    void fetchJournal();
  }, [fetchJournal]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void fetchJournal();
    }
  };

  const refreshButton = (
    <button
      onClick={() => void fetchJournal()}
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
      {/* Summary Stat */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total Events"
          value={total}
          colorClass="text-gray-900"
        />
        <StatCard
          label="Shown"
          value={entries.length}
          colorClass="text-violet-600"
        />
        <StatCard label="Limit" value={100} colorClass="text-gray-400" />
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-2">
        <Search className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <input
          type="text"
          placeholder="Filter by Process ID"
          value={processIdFilter}
          onChange={(e) => setProcessIdFilter(e.target.value)}
          onKeyDown={handleKeyDown}
          className="rounded-lg border px-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        <input
          type="text"
          placeholder="Filter by Event Type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          onKeyDown={handleKeyDown}
          className="rounded-lg border px-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        <button
          onClick={() => void fetchJournal()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" />
          Search
        </button>
        {(processIdFilter || typeFilter) && (
          <button
            onClick={() => {
              setProcessIdFilter('');
              setTypeFilter('');
            }}
            className="rounded-lg border px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </div>

      {/* Event Table */}
      <div className="rounded-lg bg-white shadow">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading journal entries...
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-12 w-12" />}
            title={`No journal entries found${processIdFilter || typeFilter ? ' for the current filters' : ''}`}
            size="sm"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full text-left text-sm">
              <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <Tr>
                  <Th className="px-4 py-3">Time</Th>
                  <Th className="px-4 py-3">Process ID</Th>
                  <Th className="px-4 py-3">Sequence</Th>
                  <Th className="px-4 py-3">Type</Th>
                  <Th className="px-4 py-3">Payload</Th>
                </Tr>
              </THead>
              <TBody className="divide-y">
                {entries.map((entry) => (
                  <Tr key={entry.id} className="hover:bg-gray-50">
                    {/* Time */}
                    <Td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      <ClientDate date={entry.timestamp} format="datetime" />
                    </Td>
                    {/* Process ID */}
                    <Td className="px-4 py-3">
                      <TruncatedCell className="font-mono max-w-[160px] text-xs text-gray-700">
                        {entry.processId}
                      </TruncatedCell>
                    </Td>
                    {/* Sequence */}
                    <Td className="px-4 py-3 text-xs text-gray-600">
                      #{entry.sequence}
                    </Td>
                    {/* Type */}
                    <Td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
                        {entry.type}
                      </span>
                    </Td>
                    {/* Payload */}
                    <Td className="px-4 py-3">
                      <TruncatedCell
                        className="font-mono max-w-[280px] text-xs text-gray-500"
                        tooltip={
                          entry.payload !== null && entry.payload !== undefined
                            ? JSON.stringify(entry.payload)
                            : '-'
                        }
                      >
                        {entry.payload !== null && entry.payload !== undefined
                          ? JSON.stringify(entry.payload)
                          : '-'}
                      </TruncatedCell>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>

      {/* Footer row count */}
      {entries.length > 0 && (
        <p className="text-right text-xs text-gray-400">
          Showing {entries.length} of {total} entries
          {(processIdFilter || typeFilter) && ' (filtered)'}
        </p>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <AdminPageLayout
      title="Event Journal"
      description="Browse and filter kernel process event journal entries"
      icon={ScrollText}
      domain="ai"
      actions={refreshButton}
    >
      {body}
    </AdminPageLayout>
  );
}
