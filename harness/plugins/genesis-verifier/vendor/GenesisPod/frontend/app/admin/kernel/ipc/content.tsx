'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  GitBranch,
  RefreshCw,
  Loader2,
  Search,
  Radio,
  ListTodo,
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

interface IpcStats {
  activeSubscriptions: number;
  activeTaskCount: number;
}

interface IpcTask {
  id: string;
  type: string;
  name: string;
  status: string;
  progress: number;
  currentPhase?: string;
  metadata?: Record<string, unknown>;
}

interface IpcMessage {
  id: string;
  fromAgentId: string;
  toAgentId?: string;
  type: string;
  payload: unknown;
  timestamp: string;
}

interface IpcProgressResponse {
  tasks: IpcTask[];
  total: number;
}

interface IpcMessagesResponse {
  messages: IpcMessage[];
  total: number;
}

// ============================
// Constants
// ============================

const TASK_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-orange-100 text-orange-800',
};

// ============================
// Helpers
// ============================

function getStatusBadgeClass(status: string): string {
  return TASK_STATUS_BADGE[status.toLowerCase()] ?? 'bg-gray-100 text-gray-600';
}

// ============================
// StatCard
// ============================

interface StatCardProps {
  label: string;
  value: number;
  colorClass: string;
  icon: React.ElementType;
}

function StatCard({ label, value, colorClass, icon: Icon }: StatCardProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <div className="flex items-center justify-between">
        <div>
          <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
          <div className="text-sm text-gray-500">{label}</div>
        </div>
        <Icon className={`h-8 w-8 opacity-20 ${colorClass}`} />
      </div>
    </div>
  );
}

// ============================
// ProgressBar
// ============================

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const colorClass =
    pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-violet-500';

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500">{pct}%</span>
    </div>
  );
}

// ============================
// Main Page
// ============================

export default function KernelIpcPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [stats, setStats] = useState<IpcStats>({
    activeSubscriptions: 0,
    activeTaskCount: 0,
  });
  const [tasks, setTasks] = useState<IpcTask[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);

  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<IpcMessage[]>([]);
  const [messageTotal, setMessageTotal] = useState(0);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [loading, setLoading] = useState(true);

  const apiUrl = config.apiUrl;

  // Fetch stats and tasks together
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, progressRes] = await Promise.all([
        fetch(`${apiUrl}/admin/kernel/ipc/stats`, {
          headers: getAuthHeader(),
        }),
        fetch(`${apiUrl}/admin/kernel/ipc/progress`, {
          headers: getAuthHeader(),
        }),
      ]);

      if (statsRes.ok) {
        const json = await statsRes.json();
        const data = (json?.data ?? json) as IpcStats;
        setStats(data);
      }

      if (progressRes.ok) {
        const json = await progressRes.json();
        const data = (json?.data ?? json) as IpcProgressResponse;
        setTasks(data.tasks ?? []);
        setTaskTotal(data.total ?? 0);
      }
    } catch (err) {
      logger.error('KernelIpc', 'Failed to fetch IPC data', err);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  // Initial fetch
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchData();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Fetch messages for a given session
  const fetchMessages = useCallback(async () => {
    const trimmed = sessionId.trim();
    if (!trimmed) return;

    setMessagesLoading(true);
    try {
      const res = await fetch(
        `${apiUrl}/admin/kernel/ipc/messages/${encodeURIComponent(trimmed)}`,
        { headers: getAuthHeader() }
      );
      if (!res.ok) throw new Error(`Messages fetch failed: ${res.status}`);
      const json = await res.json();
      const data = (json?.data ?? json) as IpcMessagesResponse;
      setMessages(data.messages ?? []);
      setMessageTotal(data.total ?? 0);
    } catch (err) {
      logger.error('KernelIpc', 'Failed to fetch IPC messages', err);
    } finally {
      setMessagesLoading(false);
    }
  }, [apiUrl, sessionId]);

  const refreshAction = (
    <button
      onClick={() => void fetchData()}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      Refresh
    </button>
  );

  const body = (
    <div className="space-y-6">
      {embedded && <div className="mb-2 flex justify-end">{refreshAction}</div>}
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Active Subscriptions"
          value={stats.activeSubscriptions}
          colorClass="text-violet-600"
          icon={Radio}
        />
        <StatCard
          label="Active Tasks"
          value={stats.activeTaskCount}
          colorClass="text-blue-600"
          icon={ListTodo}
        />
      </div>

      {/* Active Tasks Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Active Tasks
          </h2>
          {taskTotal > 0 && (
            <span className="text-xs text-gray-400">
              {tasks.length} of {taskTotal}
            </span>
          )}
        </div>

        <div className="rounded-lg bg-white shadow">
          {loading && tasks.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading tasks...
            </div>
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={<ListTodo className="h-12 w-12" />}
              title="No active tasks found."
              size="sm"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[26%]" />
                  <col className="w-[12%]" />
                  <col className="w-[18%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <Tr>
                    <Th className="px-4 py-3">ID</Th>
                    <Th className="px-4 py-3">Type</Th>
                    <Th className="px-4 py-3">Name</Th>
                    <Th className="px-4 py-3">Status</Th>
                    <Th className="px-4 py-3">Progress</Th>
                    <Th className="px-4 py-3">Phase</Th>
                  </Tr>
                </THead>
                <TBody className="divide-y">
                  {tasks.map((task) => (
                    <Tr key={task.id} className="hover:bg-gray-50">
                      <Td className="px-4 py-3">
                        <TruncatedCell className="font-mono max-w-[120px] text-xs text-gray-700">
                          {task.id}
                        </TruncatedCell>
                      </Td>
                      <Td className="px-4 py-3">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          {task.type}
                        </span>
                      </Td>
                      <Td className="px-4 py-3">
                        <TruncatedCell className="max-w-[220px] text-sm text-gray-800">
                          {task.name}
                        </TruncatedCell>
                      </Td>
                      <Td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(task.status)}`}
                        >
                          {task.status}
                        </span>
                      </Td>
                      <Td className="px-4 py-3">
                        <ProgressBar value={task.progress} />
                      </Td>
                      <Td className="px-4 py-3">
                        {task.currentPhase ? (
                          <TruncatedCell className="max-w-[160px] text-xs text-gray-500">
                            {task.currentPhase}
                          </TruncatedCell>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      </section>

      {/* Message History Section */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">
          Message History
        </h2>

        {/* Session search */}
        <div className="flex items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fetchMessages();
              }}
              placeholder="Enter session ID..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-3 pr-10 text-sm text-gray-800 placeholder-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <button
            onClick={() => void fetchMessages()}
            disabled={messagesLoading || !sessionId.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {messagesLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </button>
        </div>

        <div className="rounded-lg bg-white shadow">
          {messagesLoading ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading messages...
            </div>
          ) : messages.length === 0 ? (
            <EmptyState
              icon={<Search className="h-12 w-12" />}
              title={
                sessionId.trim()
                  ? 'No messages found for this session.'
                  : 'Enter a session ID above to load message history.'
              }
              size="sm"
            />
          ) : (
            <>
              <div className="border-b px-4 py-2 text-xs text-gray-400">
                {messages.length} of {messageTotal} messages
              </div>
              <div className="overflow-x-auto">
                <Table className="w-full text-left text-sm">
                  <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                    <Tr>
                      <Th className="px-4 py-3">Time</Th>
                      <Th className="px-4 py-3">From</Th>
                      <Th className="px-4 py-3">To</Th>
                      <Th className="px-4 py-3">Type</Th>
                      <Th className="px-4 py-3">Payload</Th>
                    </Tr>
                  </THead>
                  <TBody className="divide-y">
                    {messages.map((msg) => (
                      <Tr key={msg.id} className="hover:bg-gray-50">
                        <Td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                          <ClientDate date={msg.timestamp} format="datetime" />
                        </Td>
                        <Td className="px-4 py-3">
                          <TruncatedCell className="font-mono max-w-[160px] text-xs text-gray-700">
                            {msg.fromAgentId}
                          </TruncatedCell>
                        </Td>
                        <Td className="px-4 py-3">
                          {msg.toAgentId ? (
                            <TruncatedCell className="font-mono max-w-[160px] text-xs text-gray-700">
                              {msg.toAgentId}
                            </TruncatedCell>
                          ) : (
                            <span className="text-xs text-gray-300">
                              broadcast
                            </span>
                          )}
                        </Td>
                        <Td className="px-4 py-3">
                          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                            {msg.type}
                          </span>
                        </Td>
                        <Td className="px-4 py-3">
                          <TruncatedCell
                            className="font-mono max-w-[280px] text-xs text-gray-500"
                            tooltip={JSON.stringify(msg.payload)}
                          >
                            {JSON.stringify(msg.payload)}
                          </TruncatedCell>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );

  if (embedded) return body;

  return (
    <AdminPageLayout
      title="IPC"
      description="Monitor inter-process communication channels, task progress, and message history"
      icon={GitBranch}
      domain="ai"
      actions={refreshAction}
    >
      {body}
    </AdminPageLayout>
  );
}
