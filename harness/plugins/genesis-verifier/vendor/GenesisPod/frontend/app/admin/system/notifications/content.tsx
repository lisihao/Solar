'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  Bell,
  Send,
  Loader2,
  Trash2,
  CheckCircle,
  CheckCheck,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import ClientDate from '@/components/common/ClientDate';
import { toast } from '@/stores';
import { TruncatedCell } from '@/components/common/tables';

interface NotificationStats {
  totalCount: number;
  todayCount: number;
  unreadRate: number;
  typeCount: number;
  byType: Record<string, number>;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  read: boolean;
  createdAt: string;
}

interface PaginatedResponse {
  items: NotificationItem[];
  total: number;
  page: number;
  totalPages: number;
}

const TYPE_COLORS: Record<string, string> = {
  SYSTEM: 'bg-blue-100 text-blue-800',
  UPDATE: 'bg-purple-100 text-purple-800',
  TIP: 'bg-green-100 text-green-800',
  CREDITS_LOW: 'bg-red-100 text-red-800',
  CREDITS_RECEIVED: 'bg-emerald-100 text-emerald-800',
  RESEARCH_COMPLETED: 'bg-indigo-100 text-indigo-800',
  TASK_ASSIGNED: 'bg-yellow-100 text-yellow-800',
  MENTION: 'bg-pink-100 text-pink-800',
};

const NOTIFICATION_TYPES = [
  'SYSTEM',
  'UPDATE',
  'TIP',
  'CREDITS_LOW',
  'CREDITS_RECEIVED',
  'RESEARCH_COMPLETED',
  'TASK_ASSIGNED',
  'MENTION',
];

export default function NotificationsPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [notifData, setNotifData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Filters
  const [filterType, setFilterType] = useState('');
  const [filterReadStatus, setFilterReadStatus] = useState('');

  // Broadcast form
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastType, setBroadcastType] = useState('SYSTEM');
  const [sending, setSending] = useState(false);
  // Wave 4 精化 (2026-05-11): 自实现 toast → 项目 toast store

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiUrl}/admin/notifications/stats`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(t('admin.notifications.errors.fetchFailed'));
      const json = await res.json();
      setStats(json?.data ?? json);
    } catch (err) {
      logger.error('Failed to fetch notification stats:', err);
    }
  }, [t]);

  const fetchRecent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (filterType) params.append('type', filterType);
      if (filterReadStatus) params.append('readStatus', filterReadStatus);
      const res = await fetch(
        `${config.apiUrl}/admin/notifications/recent?${params}`,
        { headers: getAuthHeader() }
      );
      if (!res.ok) throw new Error(t('admin.notifications.errors.fetchFailed'));
      const json = await res.json();
      setNotifData(json?.data ?? json);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('admin.notifications.errors.fetchFailed');
      setError(message);
      logger.error('Failed to fetch recent notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterReadStatus, t]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    void fetchRecent();
  }, [fetchRecent]);

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) return;
    setSending(true);
    try {
      const res = await fetch(
        `${config.apiUrl}/admin/notifications/broadcast`,
        {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: broadcastTitle,
            message: broadcastMessage,
            type: broadcastType,
          }),
        }
      );
      if (!res.ok)
        throw new Error(t('admin.notifications.errors.broadcastFailed'));
      const json = await res.json();
      const result = json?.data ?? json;
      toast.success(
        t('admin.notifications.broadcastSuccess').replace(
          '{count}',
          String(result.sent)
        )
      );
      setBroadcastTitle('');
      setBroadcastMessage('');
      void fetchStats();
      void fetchRecent();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('admin.notifications.errors.broadcastFailed');
      toast.error(message);
      logger.error('Failed to broadcast notification:', err);
    } finally {
      setSending(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      const res = await fetch(
        `${config.apiUrl}/admin/notifications/${id}/read`,
        {
          method: 'PATCH',
          headers: getAuthHeader(),
        }
      );
      if (!res.ok) throw new Error('Failed to mark as read');
      void fetchRecent();
      void fetchStats();
    } catch (err) {
      logger.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await fetch(
        `${config.apiUrl}/admin/notifications/mark-all-read`,
        {
          method: 'POST',
          headers: getAuthHeader(),
        }
      );
      if (!res.ok) throw new Error('Failed to mark all as read');
      void fetchRecent();
      void fetchStats();
    } catch (err) {
      logger.error('Failed to mark all as read:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${config.apiUrl}/admin/notifications/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error('Failed to delete notification');
      void fetchRecent();
      void fetchStats();
    } catch (err) {
      logger.error('Failed to delete notification:', err);
    }
  };

  const statCards = stats
    ? [
        {
          label: t('admin.notifications.stats.totalCount'),
          value: stats.totalCount,
        },
        {
          label: t('admin.notifications.stats.todayCount'),
          value: stats.todayCount,
        },
        {
          label: t('admin.notifications.stats.unreadRate'),
          value: `${stats.unreadRate}%`,
        },
        {
          label: t('admin.notifications.stats.typeCount'),
          value: stats.typeCount,
        },
      ]
    : [];

  const body = (
    <>
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {/* Stats Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border bg-white p-4 shadow-sm"
          >
            <div className="text-sm text-gray-500">{stat.label}</div>
            <div className="mt-1 text-2xl font-semibold">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Broadcast Form */}
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h3 className="font-medium">
              {t('admin.notifications.broadcast')}
            </h3>
          </div>
          <form onSubmit={handleBroadcast} className="space-y-3 p-4">
            <input
              type="text"
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder={t('admin.notifications.titlePlaceholder')}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            <textarea
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder={t('admin.notifications.messagePlaceholder')}
              rows={4}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            <select
              value={broadcastType}
              onChange={(e) => setBroadcastType(e.target.value)}
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
            >
              {NOTIFICATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={
                sending || !broadcastTitle.trim() || !broadcastMessage.trim()
              }
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {t('admin.notifications.sendButton')}
            </button>
          </form>
        </div>

        {/* Recent Notifications */}
        <div className="rounded-xl border bg-white shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="font-medium">
              {t('admin.notifications.recentTitle')}
            </h3>
            <button
              onClick={() => void handleMarkAllRead()}
              className="flex items-center gap-1 rounded-lg border border-green-200 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t('admin.notifications.markAllRead')}
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border bg-white px-2 py-1 text-xs focus:border-blue-300 focus:outline-none"
            >
              <option value="">{t('admin.notifications.allTypes')}</option>
              {NOTIFICATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select
              value={filterReadStatus}
              onChange={(e) => {
                setFilterReadStatus(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border bg-white px-2 py-1 text-xs focus:border-blue-300 focus:outline-none"
            >
              <option value="">{t('admin.notifications.allStatus')}</option>
              <option value="read">{t('admin.notifications.read')}</option>
              <option value="unread">{t('admin.notifications.unread')}</option>
            </select>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center text-gray-400">
              {t('admin.notifications.loading')}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-[14%]" />
                    <col className="w-[26%]" />
                    <col className="w-[22%]" />
                    <col className="w-[16%]" />
                    <col className="w-[8%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <THead>
                    <Tr className="border-b bg-gray-50 text-left text-gray-500">
                      <Th className="px-4 py-2">
                        {t('admin.notifications.columns.type')}
                      </Th>
                      <Th className="px-4 py-2">
                        {t('admin.notifications.columns.title')}
                      </Th>
                      <Th className="px-4 py-2">
                        {t('admin.notifications.columns.user')}
                      </Th>
                      <Th className="px-4 py-2">
                        {t('admin.notifications.columns.time')}
                      </Th>
                      <Th className="px-4 py-2">
                        {t('admin.notifications.columns.status')}
                      </Th>
                      <Th className="px-4 py-2 text-right">
                        {t('admin.notifications.columns.actions')}
                      </Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {notifData?.items.map((item) => (
                      <Tr
                        key={item.id}
                        className="border-b last:border-0 hover:bg-gray-50"
                      >
                        <Td className="px-4 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[item.type] ?? 'bg-gray-100 text-gray-800'}`}
                          >
                            {item.type}
                          </span>
                        </Td>
                        <Td className="px-4 py-2 font-medium">
                          <TruncatedCell className="max-w-[200px] font-medium">
                            {item.title}
                          </TruncatedCell>
                        </Td>
                        <Td className="px-4 py-2 text-gray-500">
                          <TruncatedCell className="max-w-[180px] text-gray-500">
                            {item.userEmail}
                          </TruncatedCell>
                        </Td>
                        <Td className="px-4 py-2 text-gray-500">
                          <ClientDate date={item.createdAt} />
                        </Td>
                        <Td className="px-4 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${item.read ? 'bg-gray-100 text-gray-500' : 'bg-yellow-100 text-yellow-700'}`}
                          >
                            {item.read
                              ? t('admin.notifications.read')
                              : t('admin.notifications.unread')}
                          </span>
                        </Td>
                        <Td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!item.read && (
                              <button
                                onClick={() => void handleMarkRead(item.id)}
                                className="rounded p-1 text-green-600 hover:bg-green-50"
                                title={t('admin.notifications.markRead')}
                              >
                                <CheckCircle className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => void handleDelete(item.id)}
                              className="rounded p-1 text-red-500 hover:bg-red-50"
                              title={t('admin.notifications.delete')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </Td>
                      </Tr>
                    ))}
                    {(!notifData?.items || notifData.items.length === 0) && (
                      <Tr>
                        <Td
                          colSpan={6}
                          className="px-4 py-8 text-center text-gray-400"
                        >
                          {t('admin.notifications.noNotifications')}
                        </Td>
                      </Tr>
                    )}
                  </TBody>
                </Table>
              </div>
              {notifData && notifData.totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
                  >
                    {t('admin.notifications.previous')}
                  </button>
                  <span className="text-sm text-gray-500">
                    {page} / {notifData.totalPages}
                  </span>
                  <button
                    onClick={() =>
                      setPage(Math.min(notifData.totalPages, page + 1))
                    }
                    disabled={page >= notifData.totalPages}
                    className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
                  >
                    {t('admin.notifications.next')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );

  // ★ 2026-05-12: 嵌入模式 (/admin/system?tab=messages 内) 跳过外层 AdminPageLayout.
  if (embedded) return body;

  return (
    <AdminPageLayout
      title={t('admin.notifications.title')}
      description={t('admin.notifications.description')}
      icon={Bell}
      domain="system"
      maxWidth="7xl"
    >
      {body}
    </AdminPageLayout>
  );
}
