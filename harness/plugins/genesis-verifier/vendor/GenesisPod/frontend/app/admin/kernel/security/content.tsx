'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Search,
  Loader2,
  Wrench,
  Sparkles,
  Database as DataIcon,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { AdminPageLayout } from '@/components/admin/layout';
import { EmptyState } from '@/components/ui/states/EmptyState';

// ============================
// Types
// ============================

interface DataScope {
  allowedTypes: string[];
  deniedResources: string[];
}

interface CapabilityGuard {
  grantedTools: string[];
  grantedSkills: string[];
  dataScope: DataScope;
  meta: Record<string, unknown>;
}

interface KernelProcess {
  id: string;
  userId: string;
  type: string;
  state: string;
  createdAt: string;
}

// ============================
// Helpers
// ============================

function EmptyList({ label }: { label: string }) {
  return <span className="text-sm italic text-gray-400">{label}</span>;
}

// ============================
// CapabilitySection
// ============================

interface CapabilitySectionProps {
  title: string;
  icon: React.ReactNode;
  items: string[];
  emptyLabel: string;
  badgeClass: string;
}

function CapabilitySection({
  title,
  icon,
  items,
  emptyLabel,
  badgeClass,
}: CapabilitySectionProps) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        {items.length > 0 && (
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {items.length}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyList label={emptyLabel} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item}
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================
// DataScopeSection
// ============================

interface DataScopeSectionProps {
  dataScope: DataScope;
}

function DataScopeSection({ dataScope }: DataScopeSectionProps) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <DataIcon className="h-4 w-4 text-orange-500" />
        <h3 className="text-sm font-semibold text-gray-800">Data Scope</h3>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {/* Allowed Types */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Allowed Types
          </p>
          {dataScope.allowedTypes.length === 0 ? (
            <EmptyList label="No allowed types" />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {dataScope.allowedTypes.map((type) => (
                <span
                  key={type}
                  className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800"
                >
                  {type}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Denied Resources */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Denied Resources
          </p>
          {dataScope.deniedResources.length === 0 ? (
            <EmptyList label="No denied resources" />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {dataScope.deniedResources.map((resource) => (
                <span
                  key={resource}
                  className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800"
                >
                  {resource}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================
// MetaSection
// ============================

interface MetaSectionProps {
  meta: Record<string, unknown>;
}

function MetaSection({ meta }: MetaSectionProps) {
  const entries = Object.entries(meta);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
        Metadata
      </p>
      <dl className="space-y-1.5 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <dt className="w-36 flex-shrink-0 font-medium text-gray-500">
              {k}
            </dt>
            <dd className="font-mono break-all text-gray-700">
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ============================
// Main Page
// ============================

const STATE_COLORS: Record<string, string> = {
  RUNNING: 'bg-green-100 text-green-800',
  PAUSED: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-gray-100 text-gray-600',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

export default function KernelSecurityPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [processId, setProcessId] = useState('');
  const [capabilities, setCapabilities] = useState<CapabilityGuard | null>(
    null
  );
  const [queried, setQueried] = useState(false);
  const [loading, setLoading] = useState(false);
  const [queriedId, setQueriedId] = useState('');

  // Process listing state
  const [processes, setProcesses] = useState<KernelProcess[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(true);

  const apiUrl = config.apiUrl;

  const fetchProcesses = useCallback(async () => {
    setLoadingProcesses(true);
    try {
      const res = await fetch(`${apiUrl}/admin/kernel/processes?limit=50`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(`Process list fetch failed: ${res.status}`);
      const json = await res.json();
      const data = json?.data ?? json;
      const list = data?.processes ?? (Array.isArray(data) ? data : []);
      setProcesses(list);
    } catch (err) {
      logger.error('KernelSecurity', 'Failed to fetch processes', err);
      setProcesses([]);
    } finally {
      setLoadingProcesses(false);
    }
  }, [apiUrl]);

  // Load processes on mount
  useEffect(() => {
    void fetchProcesses();
  }, [fetchProcesses]);

  const fetchCapabilities = useCallback(
    async (targetId?: string) => {
      const trimmed = (targetId ?? processId).trim();
      if (!trimmed) return;

      setLoading(true);
      setCapabilities(null);
      try {
        const res = await fetch(
          `${apiUrl}/admin/kernel/security/capabilities/${encodeURIComponent(trimmed)}`,
          { headers: getAuthHeader() }
        );
        if (!res.ok)
          throw new Error(`Capabilities query failed: ${res.status}`);
        const json = await res.json();
        const data = (json?.data ?? json) as CapabilityGuard;
        setCapabilities(data);
        setQueriedId(trimmed);
        setQueried(true);
      } catch (err) {
        logger.error('KernelSecurity', 'Failed to fetch capabilities', err);
        setCapabilities(null);
        setQueriedId(trimmed);
        setQueried(true);
      } finally {
        setLoading(false);
      }
    },
    [apiUrl, processId]
  );

  const handleQuery = () => {
    void fetchCapabilities();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void fetchCapabilities();
    }
  };

  const handleSelectProcess = (pid: string) => {
    setProcessId(pid);
    void fetchCapabilities(pid);
  };

  const refreshAction = (
    <button
      onClick={() => void fetchProcesses()}
      disabled={loadingProcesses}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
    >
      <RefreshCw
        className={`h-3.5 w-3.5 ${loadingProcesses ? 'animate-spin' : ''}`}
      />
      Refresh
    </button>
  );

  const body = (
    <div className="space-y-4">
      {embedded && <div className="mb-2 flex justify-end">{refreshAction}</div>}
      {/* Process List */}
      <div className="rounded-lg bg-white shadow">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-800">
            Active Processes
            {processes.length > 0 && (
              <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                {processes.length}
              </span>
            )}
          </h3>
        </div>
        {loadingProcesses ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading processes...
          </div>
        ) : processes.length === 0 ? (
          <EmptyState title="No active processes found" size="sm" />
        ) : (
          <div className="divide-y">
            {processes.map((proc) => (
              <button
                key={proc.id}
                onClick={() => handleSelectProcess(proc.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                  queriedId === proc.id ? 'bg-violet-50' : ''
                }`}
              >
                <Shield className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono truncate text-xs font-medium text-gray-800">
                      {proc.id}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        STATE_COLORS[proc.state] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {proc.state}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {proc.type}
                    {proc.userId && (
                      <span className="ml-2 text-gray-400">
                        user: {proc.userId.slice(0, 8)}...
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Query Input */}
      <div className="rounded-lg bg-white p-4 shadow">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Process ID
            </label>
            <input
              type="text"
              value={processId}
              onChange={(e) => setProcessId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter process ID or select from list above"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <button
            onClick={handleQuery}
            disabled={!processId.trim() || loading}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Query
          </button>
        </div>
      </div>

      {/* Capability Results */}
      {!queried ? null : loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg bg-white p-12 text-sm text-gray-500 shadow">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading capabilities...
        </div>
      ) : !capabilities ? (
        <div className="rounded-lg bg-white p-12 text-center text-sm text-gray-500 shadow">
          No capability data found for process{' '}
          <span className="font-mono text-gray-700">{queriedId}</span>.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Process ID header */}
          <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2.5">
            <Shield className="h-4 w-4 text-violet-500" />
            <span className="text-xs text-gray-500">Process:</span>
            <span className="font-mono text-sm font-medium text-gray-800">
              {queriedId}
            </span>
          </div>

          {/* Granted Tools */}
          <CapabilitySection
            title="Granted Tools"
            icon={<Wrench className="h-4 w-4 text-blue-500" />}
            items={capabilities.grantedTools ?? []}
            emptyLabel="None"
            badgeClass="bg-blue-100 text-blue-800"
          />

          {/* Granted Skills */}
          <CapabilitySection
            title="Granted Skills"
            icon={<Sparkles className="h-4 w-4 text-violet-500" />}
            items={capabilities.grantedSkills ?? []}
            emptyLabel="None"
            badgeClass="bg-violet-100 text-violet-800"
          />

          {/* Data Scope */}
          <DataScopeSection
            dataScope={
              capabilities.dataScope ?? {
                allowedTypes: [],
                deniedResources: [],
              }
            }
          />

          {/* Metadata */}
          <MetaSection meta={capabilities.meta ?? {}} />
        </div>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <AdminPageLayout
      title="Capability Guard"
      description="Inspect the granted tools, skills, and data scope for an AI kernel process"
      icon={Shield}
      domain="ai"
      actions={refreshAction}
    >
      {body}
    </AdminPageLayout>
  );
}
