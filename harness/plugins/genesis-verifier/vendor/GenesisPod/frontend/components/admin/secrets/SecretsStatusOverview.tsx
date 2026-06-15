'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  CircleHelp,
  CirclePause,
} from 'lucide-react';
import {
  useAdminSecrets,
  type SecretCategory,
} from '@/hooks/domain/useAdminSecrets';
import { TruncatedCell } from '@/components/common/tables';

/**
 * 状态总览 TAB（设计文档 §4.5.0/§4.5.0b/§4.5.0c）
 *
 * 极简：仅显示 NAME / CATEGORY / STATUS（聚合徽章），无操作引导杂物。
 * 操作（Add/Edit/Delete/Rotate）全部在 KEY 管理 TAB 内。
 *
 * NB: 当前 STATUS 来自 Secret.isActive（旧字段）。P3 业务侧切到 SecretKey 后，
 *     这里聚合 SecretKey.testStatus 形成更细粒度状态。
 */

const CATEGORY_LABEL: Record<SecretCategory, string> = {
  AI_MODEL: 'AI Model',
  SEARCH: 'Search',
  EXTRACTION: 'Content Extraction',
  YOUTUBE: 'YouTube',
  TTS: 'Text-to-Speech',
  SKILLSMP: 'SkillsMP',
  POLICY: 'Policy Research',
  FINANCE: 'Finance Data',
  ACADEMIC: 'Academic',
  WEATHER: 'Weather',
  IMAGE_SEARCH: 'Image Search',
  DEV_TOOLS: 'Dev Tools',
  MCP: 'MCP Server',
  OTHER: 'Other',
};

type StatusFilter = 'ALL' | 'ok' | 'failed' | 'unknown' | 'disabled';

const STATUS_CONFIG: Record<
  Exclude<StatusFilter, 'ALL'>,
  { label: string; cls: string; icon: typeof CheckCircle2 }
> = {
  ok: {
    label: 'OK',
    cls: 'bg-green-100 text-green-800',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Failed',
    cls: 'bg-red-100 text-red-800',
    icon: XCircle,
  },
  unknown: {
    label: 'Unknown',
    cls: 'bg-yellow-100 text-yellow-800',
    icon: CircleHelp,
  },
  disabled: {
    label: 'Disabled',
    cls: 'bg-gray-100 text-gray-600',
    icon: CirclePause,
  },
};

export function SecretsStatusOverview() {
  const {
    secrets,
    isRefreshing: listLoading,
    refreshSecrets,
  } = useAdminSecrets();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<SecretCategory | 'ALL'>(
    'ALL'
  );
  const [sortBy, setSortBy] = useState<'name' | 'status'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const rowStatus = (s: { aggregateStatus?: string; isActive: boolean }) =>
    (s.aggregateStatus as StatusFilter) ??
    (s.isActive ? 'unknown' : 'disabled');

  const rows = useMemo(() => {
    const filtered = (secrets ?? []).filter((s) => {
      const matchSearch =
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.displayName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCategory =
        categoryFilter === 'ALL' || s.category === categoryFilter;
      const matchStatus =
        statusFilter === 'ALL' || statusFilter === rowStatus(s);
      return matchSearch && matchCategory && matchStatus;
    });

    const statusOrder: Record<string, number> = {
      ok: 0,
      unknown: 1,
      failed: 2,
      disabled: 3,
    };
    const sorted = [...filtered].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'status') {
        const sa = statusOrder[rowStatus(a)] ?? 99;
        const sb = statusOrder[rowStatus(b)] ?? 99;
        if (sa !== sb) return (sa - sb) * dir;
      }
      return a.name.localeCompare(b.name) * dir;
    });
    return sorted;
  }, [secrets, searchTerm, statusFilter, categoryFilter, sortBy, sortDir]);

  const summary = useMemo(() => {
    const list = secrets ?? [];
    const counts = { ok: 0, failed: 0, unknown: 0, disabled: 0 };
    for (const s of list) {
      const st = rowStatus(s);
      if (st in counts) counts[st as keyof typeof counts]++;
    }
    return { total: list.length, ...counts };
  }, [secrets]);

  const toggleSort = (col: 'name' | 'status') => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const allSelected =
    rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name…"
            className="w-full rounded-md border py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(e.target.value as SecretCategory | 'ALL')
          }
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="ALL">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="ALL">All statuses</option>
          <option value="ok">OK</option>
          <option value="failed">Failed</option>
          <option value="unknown">Unknown</option>
          <option value="disabled">Disabled</option>
        </select>
        <button
          onClick={() => void refreshSecrets()}
          disabled={listLoading}
          className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${listLoading ? 'animate-spin' : ''}`}
          />
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  aria-label="select all"
                />
              </th>
              <th
                className="cursor-pointer px-3 py-2 text-left hover:text-gray-900"
                onClick={() => toggleSort('name')}
              >
                Name {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-3 py-2 text-left">Category</th>
              <th
                className="cursor-pointer px-3 py-2 text-left hover:text-gray-900"
                onClick={() => toggleSort('status')}
              >
                Status {sortBy === 'status' && (sortDir === 'asc' ? '↑' : '↓')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && !listLoading && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-400">
                  No secrets match the current filters.
                </td>
              </tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(s.id)}
                    onChange={() => toggleRow(s.id)}
                    aria-label={`select ${s.name}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <TruncatedCell
                    className="max-w-[240px] font-medium text-gray-900"
                    tooltip={`${s.displayName} · ${s.name}`}
                  >
                    {s.displayName}
                  </TruncatedCell>
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {CATEGORY_LABEL[s.category] ?? s.category}
                  {s.provider && (
                    <span className="text-gray-400"> · {s.provider}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {(() => {
                    const st = rowStatus(
                      s as { aggregateStatus?: string; isActive: boolean }
                    ) as keyof typeof STATUS_CONFIG;
                    const cfg = STATUS_CONFIG[st];
                    if (!cfg) return null;
                    const Icon = cfg.icon;
                    return (
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${cfg.cls}`}
                        title={
                          s.totalKeys
                            ? `${s.activeKeys}/${s.totalKeys} keys active`
                            : undefined
                        }
                      >
                        <Icon className="h-3 w-3" /> {cfg.label}
                        {s.totalKeys && s.totalKeys > 1 ? (
                          <span className="ml-0.5 text-[10px] opacity-75">
                            {s.activeKeys}/{s.totalKeys}
                          </span>
                        ) : null}
                      </span>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-gray-600">
        <div className="flex items-center gap-3">
          <span>{summary.total} total</span>
          <span className="text-green-700">· {summary.ok} ok</span>
          <span className="text-red-700">· {summary.failed} failed</span>
          <span className="text-yellow-700">· {summary.unknown} unknown</span>
          <span className="text-gray-500">· {summary.disabled} disabled</span>
        </div>
        <div>{selectedIds.size > 0 && `${selectedIds.size} selected`}</div>
      </div>
    </div>
  );
}
