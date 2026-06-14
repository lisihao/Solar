import { useApiGet } from '../core';
import { useCallback, useState, useEffect } from 'react';
import { getAuthHeader } from '@/lib/utils/auth';

export interface AdminUserStats {
  totalUsers: number;
  activeUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  adminCount: number;
}

export interface LoginHistoryItem {
  id: string;
  loginAt: string;
  ipAddress: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  location: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  username: string | null;
  avatar?: string;
  avatarUrl?: string;
  role: 'USER' | 'ADMIN' | 'user' | 'admin';
  status: 'active' | 'inactive' | 'banned';
  isActive?: boolean;
  isAdmin?: boolean;
  createdAt: string;
  lastLoginAt?: string;
  credits?: {
    balance: number;
    totalEarned: number;
    totalSpent: number;
    isFrozen: boolean;
  } | null;
}

export interface CreateUserData {
  email: string;
  username?: string;
  role?: 'USER' | 'ADMIN';
  password?: string;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function useAdminUsers(initialPage = 1, initialLimit = 20) {
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [page, setPage] = useState(initialPage);
  const [limit] = useState(initialLimit);

  const {
    data,
    loading: listLoading,
    error: listError,
    execute: refreshUsers,
  } = useApiGet<{ users: User[]; pagination: PaginationInfo }>(
    `/admin/users?page=${page}&limit=${limit}`,
    {
      immediate: true,
      deps: [page, limit],
    }
  );

  const [updateLoading, setUpdateLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const createUser = useCallback(
    async (data: CreateUserData) => {
      setCreateLoading(true);
      try {
        const response = await fetch('/api/v1/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(data),
        });
        const result = await response.json();
        if (result.success || result.id) {
          await refreshUsers();
        }
        return result;
      } finally {
        setCreateLoading(false);
      }
    },
    [refreshUsers]
  );

  const updateUser = useCallback(
    async (id: string, data: Partial<User>) => {
      setUpdateLoading(true);
      try {
        const response = await fetch(`/api/v1/admin/users/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(data),
        });
        const result = await response.json();
        if (result) await refreshUsers();
        return result;
      } finally {
        setUpdateLoading(false);
      }
    },
    [refreshUsers]
  );

  const deleteUser = useCallback(
    async (id: string) => {
      setDeleteLoading(true);
      try {
        await fetch(`/api/v1/admin/users/${id}`, {
          method: 'DELETE',
          headers: { ...getAuthHeader() },
        });
        await refreshUsers();
      } finally {
        setDeleteLoading(false);
      }
    },
    [refreshUsers]
  );

  const banUser = useCallback(
    (id: string) => updateUser(id, { status: 'banned' }),
    [updateUser]
  );

  const activateUser = useCallback(
    (id: string) => updateUser(id, { status: 'active' }),
    [updateUser]
  );

  // Credits management functions
  const grantCredits = useCallback(
    async (userId: string, amount: number, reason?: string) => {
      setCreditsLoading(true);
      try {
        const response = await fetch(
          `/api/v1/admin/users/${userId}/credits/grant`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ amount, reason }),
          }
        );
        const result = await response.json();
        if (result.success) {
          await refreshUsers();
        }
        return result;
      } finally {
        setCreditsLoading(false);
      }
    },
    [refreshUsers]
  );

  const toggleCreditFreeze = useCallback(
    async (userId: string, freeze: boolean, reason?: string) => {
      setCreditsLoading(true);
      try {
        const response = await fetch(
          `/api/v1/admin/users/${userId}/credits/freeze`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ freeze, reason }),
          }
        );
        const result = await response.json();
        if (result.success) {
          await refreshUsers();
        }
        return result;
      } finally {
        setCreditsLoading(false);
      }
    },
    [refreshUsers]
  );

  // Fetch user login history
  const fetchLoginHistory = useCallback(
    async (userId: string, limit = 10): Promise<LoginHistoryItem[]> => {
      try {
        const response = await fetch(
          `/api/v1/admin/users/${userId}/login-history?limit=${limit}`,
          {
            headers: { ...getAuthHeader() },
          }
        );
        const result = (await response.json()) as {
          history?: LoginHistoryItem[];
          data?: { history?: LoginHistoryItem[] };
        };
        // Global ResponseTransformInterceptor wraps payload in { success, data, metadata }
        const payload = result?.data ?? result;
        return payload?.history ?? [];
      } catch {
        return [];
      }
    },
    []
  );

  const pagination = data?.pagination ?? {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  };

  const goToPage = useCallback(
    (newPage: number) => {
      if (newPage >= 1 && newPage <= pagination.totalPages) {
        setPage(newPage);
      }
    },
    [pagination.totalPages]
  );

  const nextPage = useCallback(() => {
    if (page < pagination.totalPages) {
      setPage((p) => p + 1);
    }
  }, [page, pagination.totalPages]);

  const prevPage = useCallback(() => {
    if (page > 1) {
      setPage((p) => p - 1);
    }
  }, [page]);

  return {
    users: data?.users ?? [],
    total: pagination.total,
    pagination,
    page,
    loading:
      listLoading ||
      updateLoading ||
      deleteLoading ||
      creditsLoading ||
      createLoading,
    error: listError,
    refreshUsers,
    createUser,
    updateUser,
    deleteUser,
    banUser,
    activateUser,
    grantCredits,
    toggleCreditFreeze,
    fetchLoginHistory,
    goToPage,
    nextPage,
    prevPage,
    isCreating: createLoading,
    isUpdating: updateLoading,
    isDeleting: deleteLoading,
    isCreditsLoading: creditsLoading,
  };
}

// Separate hook for user statistics
export function useUserStats() {
  const {
    data,
    loading,
    error,
    execute: refreshStats,
  } = useApiGet<AdminUserStats>('/admin/users/stats', {
    immediate: true,
  });

  return {
    stats: data,
    loading,
    error,
    refreshStats,
  };
}
