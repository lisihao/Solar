'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { ScrollText } from 'lucide-react';
import { Tabs } from '@/components/ui/tabs';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import ClientDate from '@/components/common/ClientDate';
import { TruncatedCell } from '@/components/common/tables';

interface LogsStats {
  totalLogins: number;
  todayLogins: number;
  totalTasks: number;
  failedTasks: number;
}

interface LoginRecord {
  id: string;
  userEmail: string;
  userName: string | null;
  loginAt: string;
  ipAddress: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  location: string | null;
}

interface TaskRecord {
  id: string;
  name: string;
  sourceName: string;
  sourceType: string;
  status: string;
  totalItems: number;
  successItems: number;
  failedItems: number;
  duplicateItems: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const TASK_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  RUNNING: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
  PAUSED: 'bg-purple-100 text-purple-800',
};

export default function LogsPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'login' | 'task'>('login');
  const [stats, setStats] = useState<LogsStats | null>(null);
  const [loginData, setLoginData] =
    useState<PaginatedResponse<LoginRecord> | null>(null);
  const [taskData, setTaskData] =
    useState<PaginatedResponse<TaskRecord> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loginPage, setLoginPage] = useState(1);
  const [taskPage, setTaskPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState('');

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiUrl}/admin/logs/stats`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(t('admin.logs.errors.fetchFailed'));
      const data = await res.json();
      setStats(data?.data ?? data);
    } catch (err) {
      logger.error('Failed to fetch logs stats:', err);
    }
  }, [t]);

  const fetchLoginHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(loginPage),
        limit: '20',
      });
      if (searchQuery) params.append('search', searchQuery);

      const res = await fetch(
        `${config.apiUrl}/admin/logs/login-history?${params}`,
        {
          headers: getAuthHeader(),
        }
      );
      if (!res.ok) throw new Error(t('admin.logs.errors.fetchFailed'));
      const data = await res.json();
      setLoginData(data?.data ?? data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('admin.logs.errors.fetchFailed');
      setError(message);
      logger.error('Failed to fetch login history:', err);
    } finally {
      setLoading(false);
    }
  }, [loginPage, searchQuery, t]);

  const fetchTaskHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(taskPage),
        limit: '20',
      });
      if (taskStatusFilter) params.append('status', taskStatusFilter);

      const res = await fetch(
        `${config.apiUrl}/admin/logs/task-history?${params}`,
        {
          headers: getAuthHeader(),
        }
      );
      if (!res.ok) throw new Error(t('admin.logs.errors.fetchFailed'));
      const data = await res.json();
      setTaskData(data?.data ?? data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('admin.logs.errors.fetchFailed');
      setError(message);
      logger.error('Failed to fetch task history:', err);
    } finally {
      setLoading(false);
    }
  }, [taskPage, taskStatusFilter, t]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (activeTab === 'login') {
      void fetchLoginHistory();
    } else {
      void fetchTaskHistory();
    }
  }, [activeTab, fetchLoginHistory, fetchTaskHistory]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginPage(1);
    void fetchLoginHistory();
  };

  const renderPagination = (
    currentPage: number,
    totalPages: number,
    setPage: (p: number) => void
  ) => {
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-between border-t px-4 py-3">
        <button
          onClick={() => setPage(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
        >
          {t('common.previous')}
        </button>
        <span className="text-sm text-gray-500">
          {currentPage} / {totalPages}
        </span>
        <button
          onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
        >
          {t('common.next')}
        </button>
      </div>
    );
  };

  const body = (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-lg bg-white p-4 shadow">
            <div className="text-2xl font-bold text-gray-900">
              {stats.totalLogins}
            </div>
            <div className="text-sm text-gray-500">
              {t('admin.logs.stats.totalLogins')}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <div className="text-2xl font-bold text-blue-600">
              {stats.todayLogins}
            </div>
            <div className="text-sm text-gray-500">
              {t('admin.logs.stats.todayLogins')}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <div className="text-2xl font-bold text-green-600">
              {stats.totalTasks}
            </div>
            <div className="text-sm text-gray-500">
              {t('admin.logs.stats.totalTasks')}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <div className="text-2xl font-bold text-red-600">
              {stats.failedTasks}
            </div>
            <div className="text-sm text-gray-500">
              {t('admin.logs.stats.failedTasks')}
            </div>
          </div>
        </div>
      )}

      {/* Tab Switcher */}
      <Tabs
        variant="pill"
        className="mb-4"
        items={[
          { key: 'login', label: t('admin.logs.loginTab') },
          { key: 'task', label: t('admin.logs.taskTab') },
        ]}
        value={activeTab}
        onChange={(k) => setActiveTab(k as 'login' | 'task')}
      />

      {/* Login History Tab */}
      {activeTab === 'login' && (
        <>
          <form onSubmit={handleSearch} className="mb-4">
            <div className="relative max-w-md">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('admin.logs.searchPlaceholder')}
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm"
              />
              <svg
                className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </form>

          <div className="rounded-lg bg-white shadow">
            {loading ? (
              <div className="p-8 text-center text-gray-500">
                {t('common.loading')}
              </div>
            ) : !loginData?.items.length ? (
              <div className="p-8 text-center text-gray-500">
                {t('admin.logs.noLoginRecords')}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table className="w-full table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[24%]" />
                      <col className="w-[18%]" />
                      <col className="w-[14%]" />
                      <col className="w-[16%]" />
                      <col className="w-[16%]" />
                      <col className="w-[12%]" />
                    </colgroup>
                    <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                      <Tr>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.email')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.loginTime')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.ip')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.device')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.browser')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.location')}
                        </Th>
                      </Tr>
                    </THead>
                    <TBody className="divide-y">
                      {loginData.items.map((record) => (
                        <Tr key={record.id} className="hover:bg-gray-50">
                          <Td className="px-4 py-3 font-medium text-gray-900">
                            <TruncatedCell className="max-w-[200px] font-medium text-gray-900">
                              {record.userEmail}
                            </TruncatedCell>
                          </Td>
                          <Td className="px-4 py-3 text-gray-600">
                            <ClientDate
                              date={record.loginAt}
                              format="datetime"
                            />
                          </Td>
                          <Td className="font-mono px-4 py-3 text-xs text-gray-500">
                            {record.ipAddress || '-'}
                          </Td>
                          <Td className="px-4 py-3 text-gray-600">
                            <TruncatedCell className="max-w-[160px] text-gray-600">
                              {record.device || '-'}
                            </TruncatedCell>
                          </Td>
                          <Td className="px-4 py-3 text-gray-600">
                            <TruncatedCell className="max-w-[160px] text-gray-600">
                              {record.browser || '-'}
                            </TruncatedCell>
                          </Td>
                          <Td className="px-4 py-3 text-gray-600">
                            <TruncatedCell className="max-w-[160px] text-gray-600">
                              {record.location || '-'}
                            </TruncatedCell>
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </div>
                {renderPagination(
                  loginData.page,
                  loginData.totalPages,
                  setLoginPage
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Task History Tab */}
      {activeTab === 'task' && (
        <>
          <div className="mb-4">
            <select
              value={taskStatusFilter}
              onChange={(e) => {
                setTaskStatusFilter(e.target.value);
                setTaskPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm"
            >
              <option value="">{t('admin.logs.allStatuses')}</option>
              {[
                'PENDING',
                'RUNNING',
                'COMPLETED',
                'FAILED',
                'CANCELLED',
                'PAUSED',
              ].map((status) => (
                <option key={status} value={status}>
                  {t(`admin.logs.taskStatuses.${status.toLowerCase()}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg bg-white shadow">
            {loading ? (
              <div className="p-8 text-center text-gray-500">
                {t('common.loading')}
              </div>
            ) : !taskData?.items.length ? (
              <div className="p-8 text-center text-gray-500">
                {t('admin.logs.noTaskRecords')}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table className="w-full text-left text-sm">
                    <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                      <Tr>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.taskName')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.source')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.status')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.items')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.logs.columns.createdAt')}
                        </Th>
                      </Tr>
                    </THead>
                    <TBody className="divide-y">
                      {taskData.items.map((task) => (
                        <Tr key={task.id} className="hover:bg-gray-50">
                          <Td className="px-4 py-3 font-medium text-gray-900">
                            <TruncatedCell className="max-w-[220px] font-medium text-gray-900">
                              {task.name}
                            </TruncatedCell>
                          </Td>
                          <Td className="px-4 py-3 text-gray-600">
                            <TruncatedCell className="max-w-[180px] text-gray-600">
                              {task.sourceName}
                            </TruncatedCell>
                          </Td>
                          <Td className="px-4 py-3">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                TASK_STATUS_COLORS[task.status] ||
                                'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {t(
                                `admin.logs.taskStatuses.${task.status.toLowerCase()}`
                              )}
                            </span>
                          </Td>
                          <Td className="px-4 py-3 text-gray-600">
                            <span className="text-green-600">
                              {task.successItems}
                            </span>
                            {task.failedItems > 0 && (
                              <span className="ml-1 text-red-600">
                                / {task.failedItems} err
                              </span>
                            )}
                            {task.duplicateItems > 0 && (
                              <span className="ml-1 text-amber-600">
                                / {task.duplicateItems} dup
                              </span>
                            )}
                          </Td>
                          <Td className="px-4 py-3 text-gray-500">
                            <ClientDate
                              date={task.createdAt}
                              format="datetime"
                            />
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </div>
                {renderPagination(
                  taskData.page,
                  taskData.totalPages,
                  setTaskPage
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );

  // ★ 2026-05-12: 嵌入模式 (/admin/system?tab=ops 内) 跳过 AdminPageLayout.
  if (embedded) return body;

  return (
    <AdminPageLayout
      title={t('admin.logs.title')}
      description={t('admin.logs.description')}
      icon={ScrollText}
      domain="system"
    >
      {body}
    </AdminPageLayout>
  );
}
