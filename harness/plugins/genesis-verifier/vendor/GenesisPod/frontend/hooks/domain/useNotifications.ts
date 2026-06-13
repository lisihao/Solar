import { useApiGet, useApiMutation } from '../core';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/client';
import {
  emitNotificationMutated,
  onNotificationMutated,
} from '@/lib/features/notifications/notification-events';

/**
 * 通知类型
 */
export type NotificationType =
  | 'SYSTEM'
  | 'UPDATE'
  | 'TIP'
  | 'JOIN_REQUEST'
  | 'JOIN_APPROVED'
  | 'JOIN_REJECTED'
  | 'INVITATION'
  | 'INVITATION_EXPIRED'
  | 'RESEARCH_COMPLETED'
  | 'TASK_ASSIGNED'
  | 'MENTION'
  | 'CREDITS_LOW'
  | 'CREDITS_RECEIVED'
  | 'FEEDBACK_REPLIED'
  | 'FEEDBACK_STATUS_CHANGED';

/**
 * 通知数据
 */
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  iconUrl?: string;
  actionUrl?: string;
  actionLabel?: string;
  relatedType?: string;
  relatedId?: string;
  read: boolean;
  readAt?: Date;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
  createdAt: Date;
}

/**
 * 通知偏好设置
 */
export type NotificationChannel = 'email' | 'site' | 'wechat' | 'webpush';

export interface NotificationPreferences {
  emailEnabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  typeSettings: Record<string, boolean>;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  // PR-DR1b 新增
  channelSubscriptions?: Record<
    string,
    Partial<Record<NotificationChannel, boolean>>
  >;
  instantPushForTier3?: boolean;
}

interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  page: number;
  limit: number;
}

interface UnreadCountResponse {
  count: number;
}

/**
 * 通知列表 Hook
 * 提供通知列表查询功能
 */
export function useNotifications(options?: {
  page?: number;
  limit?: number;
  type?: NotificationType;
  read?: boolean;
}) {
  const { page = 1, limit = 20, type, read } = options || {};

  // 构建查询参数
  const queryParams = new URLSearchParams();
  queryParams.set('page', String(page));
  queryParams.set('limit', String(limit));
  if (type) queryParams.set('type', type);
  if (read !== undefined) queryParams.set('read', String(read));

  const { data, loading, error, refresh } = useApiGet<NotificationsResponse>(
    `/notifications?${queryParams.toString()}`
  );

  useEffect(() => onNotificationMutated(() => void refresh()), [refresh]);

  return {
    notifications: data?.notifications || [],
    total: data?.total || 0,
    page: data?.page || 1,
    limit: data?.limit || 20,
    loading,
    error,
    refresh,
  };
}

/**
 * 未读通知数量 Hook
 */
export function useUnreadNotificationCount() {
  const { data, loading, error, refresh } = useApiGet<UnreadCountResponse>(
    '/notifications/unread-count'
  );

  useEffect(() => onNotificationMutated(() => void refresh()), [refresh]);

  return {
    count: data?.count || 0,
    loading,
    error,
    refresh,
  };
}

/**
 * 通知操作 Hook
 * 提供标记已读、删除等操作
 */
export function useNotificationActions() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const markAsRead = useCallback(async (notificationId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.patch<{ success: boolean }>(
        `/notifications/${notificationId}/read`,
        {}
      );
      emitNotificationMutated();
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.post<{ count: number }>(
        '/notifications/read-all',
        {}
      );
      emitNotificationMutated();
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteNotification = useCallback(async (notificationId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.delete<{ success: boolean }>(
        `/notifications/${notificationId}`
      );
      emitNotificationMutated();
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    markAsRead,
    markAllAsRead,
    deleteNotification,
    loading,
    error,
  };
}

/**
 * 通知偏好设置 Hook
 */
export function useNotificationPreferences() {
  const { data, loading, error, refresh } = useApiGet<NotificationPreferences>(
    '/notifications/preferences'
  );

  const { execute: updatePreferencesApi, loading: updating } = useApiMutation<
    NotificationPreferences,
    Partial<NotificationPreferences>
  >('patch', '/notifications/preferences');

  const updatePreferences = useCallback(
    async (updates: Partial<NotificationPreferences>) => {
      const result = await updatePreferencesApi(updates);
      refresh();
      return result;
    },
    [updatePreferencesApi, refresh]
  );

  return {
    preferences: data || {
      emailEnabled: true,
      pushEnabled: true,
      soundEnabled: true,
      typeSettings: {},
    },
    loading,
    updating,
    error,
    refresh,
    updatePreferences,
  };
}
