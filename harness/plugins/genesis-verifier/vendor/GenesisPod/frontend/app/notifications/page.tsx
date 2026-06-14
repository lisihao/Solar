'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui/states/LoadingState';
import ClientDate from '@/components/common/ClientDate';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BellOff,
  Trash2,
  Check,
  CheckCheck,
  Info,
  Sparkles,
  RefreshCw,
  Zap,
  Mail,
  Users,
  AlertTriangle,
  Coins,
  MessageSquare,
} from 'lucide-react';
import {
  useNotifications,
  useNotificationActions,
  type Notification,
  type NotificationType,
} from '@/hooks/domain/useNotifications';
import { useNotificationSocket } from '@/hooks/domain/useNotificationSocket';

const TYPE_META: Record<
  NotificationType,
  {
    label: string;
    bgColor: string;
    textColor: string;
    iconBg: string;
    iconColor: string;
    icon: typeof Info;
  }
> = {
  SYSTEM: {
    label: 'System',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    icon: Info,
  },
  UPDATE: {
    label: 'Update',
    bgColor: 'bg-green-100',
    textColor: 'text-green-700',
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
    icon: RefreshCw,
  },
  TIP: {
    label: 'Tip',
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-700',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    icon: Zap,
  },
  JOIN_REQUEST: {
    label: 'Team',
    bgColor: 'bg-violet-100',
    textColor: 'text-violet-700',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
    icon: Users,
  },
  JOIN_APPROVED: {
    label: 'Team',
    bgColor: 'bg-emerald-100',
    textColor: 'text-emerald-700',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    icon: Users,
  },
  JOIN_REJECTED: {
    label: 'Team',
    bgColor: 'bg-red-100',
    textColor: 'text-red-700',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    icon: Users,
  },
  INVITATION: {
    label: 'Invite',
    bgColor: 'bg-violet-100',
    textColor: 'text-violet-700',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
    icon: Mail,
  },
  INVITATION_EXPIRED: {
    label: 'Invite',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-700',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-600',
    icon: Mail,
  },
  RESEARCH_COMPLETED: {
    label: 'Task Done',
    bgColor: 'bg-indigo-100',
    textColor: 'text-indigo-700',
    iconBg: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
    icon: Sparkles,
  },
  TASK_ASSIGNED: {
    label: 'Task',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-700',
    iconBg: 'bg-yellow-100',
    iconColor: 'text-yellow-600',
    icon: Sparkles,
  },
  MENTION: {
    label: 'Mention',
    bgColor: 'bg-pink-100',
    textColor: 'text-pink-700',
    iconBg: 'bg-pink-100',
    iconColor: 'text-pink-600',
    icon: MessageSquare,
  },
  CREDITS_LOW: {
    label: 'Credits',
    bgColor: 'bg-red-100',
    textColor: 'text-red-700',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    icon: AlertTriangle,
  },
  CREDITS_RECEIVED: {
    label: 'Credits',
    bgColor: 'bg-emerald-100',
    textColor: 'text-emerald-700',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    icon: Coins,
  },
  FEEDBACK_REPLIED: {
    label: 'Feedback',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    icon: MessageSquare,
  },
  FEEDBACK_STATUS_CHANGED: {
    label: 'Feedback',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    icon: MessageSquare,
  },
};

const DEFAULT_META = TYPE_META.SYSTEM;

function getMeta(type: string) {
  return TYPE_META[type as NotificationType] ?? DEFAULT_META;
}

function formatTimestamp(dateInput: Date | string): string | null {
  const now = new Date();
  const d = new Date(dateInput);
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return null;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [mounted, setMounted] = useState(false);

  const readFlag = filter === 'unread' ? false : undefined;
  const { notifications, total, loading, refresh } = useNotifications({
    page: 1,
    limit: 50,
    read: readFlag,
  });
  const {
    markAsRead,
    markAllAsRead,
    deleteNotification,
    loading: actionLoading,
  } = useNotificationActions();

  // Realtime: any new notification or admin broadcast → refresh
  const onSocketEvent = useCallback(() => {
    void refresh();
  }, [refresh]);
  useNotificationSocket({
    onNewNotification: onSocketEvent,
    onBroadcast: onSocketEvent,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      await markAsRead(id);
      void refresh();
    },
    [markAsRead, refresh]
  );

  const handleMarkAllAsRead = useCallback(async () => {
    await markAllAsRead();
    void refresh();
  }, [markAllAsRead, refresh]);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteNotification(id);
      void refresh();
    },
    [deleteNotification, refresh]
  );

  if (!mounted) {
    return (
      <AppShell>
        <LoadingState size="md" />
      </AppShell>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;
  const subtitle = loading
    ? 'Loading...'
    : unreadCount > 0
      ? `${unreadCount} unread / ${total} total`
      : total > 0
        ? `${total} notifications · all caught up`
        : 'No notifications yet';

  return (
    <AppShell>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
          <div className="flex items-center gap-3">
            <Bell className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
              <p className="text-sm text-gray-500">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-gray-200 p-1">
              <button
                onClick={() => setFilter('all')}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-violet-100 text-violet-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  filter === 'unread'
                    ? 'bg-violet-100 text-violet-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Unread
                {unreadCount > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-600 px-1.5 text-xs text-white">
                    {unreadCount}
                  </span>
                )}
              </button>
            </div>

            {unreadCount > 0 && (
              <button
                onClick={() => void handleMarkAllAsRead()}
                disabled={actionLoading}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </button>
            )}
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {loading && notifications.length === 0 ? (
            <LoadingState size="md" />
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={<BellOff className="h-12 w-12" />}
              title={
                filter === 'unread'
                  ? 'No unread notifications'
                  : 'No notifications'
              }
              description={
                filter === 'unread'
                  ? "You've read all your notifications. Check back later for updates!"
                  : "You don't have any notifications yet. We'll notify you about important updates and tips."
              }
            />
          ) : (
            <div className="mx-auto max-w-3xl space-y-3">
              {notifications.map((n: Notification) => {
                const meta = getMeta(n.type);
                const Icon = meta.icon;
                const ts = formatTimestamp(n.createdAt);
                return (
                  <div
                    key={n.id}
                    className={`group rounded-lg border bg-white p-4 transition-all hover:shadow-md ${
                      n.actionUrl ? 'cursor-pointer' : ''
                    } ${
                      !n.read
                        ? 'border-violet-200 bg-violet-50/30'
                        : 'border-gray-200'
                    }`}
                    onClick={() => {
                      if (n.actionUrl) {
                        void handleMarkAsRead(n.id);
                        router.push(n.actionUrl);
                      }
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.iconBg}`}
                      >
                        <Icon className={`h-5 w-5 ${meta.iconColor}`} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900">
                              {n.title}
                            </h3>
                            {!n.read && (
                              <span className="h-2 w-2 rounded-full bg-violet-600" />
                            )}
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.bgColor} ${meta.textColor}`}
                            >
                              {meta.label}
                            </span>
                          </div>
                          <span className="whitespace-nowrap text-xs text-gray-500">
                            {ts ?? (
                              <ClientDate date={n.createdAt} format="date" />
                            )}
                          </span>
                        </div>
                        <p className="mb-3 text-sm text-gray-600">
                          {n.message}
                        </p>

                        <div className="flex items-center gap-3">
                          {n.actionUrl && (
                            <Link
                              href={n.actionUrl}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleMarkAsRead(n.id);
                              }}
                              className="text-sm font-medium text-violet-600 hover:text-violet-700"
                            >
                              {n.actionLabel || 'View'}
                            </Link>
                          )}
                          {!n.read && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleMarkAsRead(n.id);
                              }}
                              className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Mark as read
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDelete(n.id);
                            }}
                            className="flex items-center gap-1 text-sm font-medium text-gray-400 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
