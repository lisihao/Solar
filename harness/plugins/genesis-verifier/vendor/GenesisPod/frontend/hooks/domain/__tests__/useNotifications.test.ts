import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiMutation: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { useApiGet, useApiMutation } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import {
  useNotifications,
  useUnreadNotificationCount,
  useNotificationActions,
  useNotificationPreferences,
} from '../useNotifications';

const makeDefaultGet = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn(),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

const makeDefaultMutation = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn(),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty notifications and defaults in initial state', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notifications).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.page).toBe(1);
    expect(result.current.limit).toBe(20);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns notifications when API responds', () => {
    const mockNotifications = [
      {
        id: 'n-1',
        type: 'SYSTEM' as const,
        title: 'Welcome',
        message: 'Hello!',
        read: false,
        userId: 'u-1',
        createdAt: new Date(),
      },
      {
        id: 'n-2',
        type: 'UPDATE' as const,
        title: 'Update',
        message: 'New feature',
        read: true,
        userId: 'u-1',
        createdAt: new Date(),
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({
        data: {
          notifications: mockNotifications,
          total: 2,
          page: 1,
          limit: 20,
        },
      })
    );
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notifications).toEqual(mockNotifications);
    expect(result.current.total).toBe(2);
  });

  it('builds API URL with default pagination params', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useNotifications());
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('page=1');
    expect(callArg).toContain('limit=20');
  });

  it('builds API URL with custom pagination and type filter', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useNotifications({ page: 2, limit: 10, type: 'SYSTEM' }));
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('page=2');
    expect(callArg).toContain('limit=10');
    expect(callArg).toContain('type=SYSTEM');
  });

  it('includes read filter when provided', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useNotifications({ read: false }));
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('read=false');
  });

  it('reflects loading state', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ loading: true }));
    const { result } = renderHook(() => useNotifications());
    expect(result.current.loading).toBe(true);
  });

  it('reflects error state', () => {
    const mockError = new Error('Fetch failed');
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ error: mockError as never })
    );
    const { result } = renderHook(() => useNotifications());
    expect(result.current.error).toBe(mockError);
  });

  it('exposes refresh function', () => {
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );
    const { result } = renderHook(() => useNotifications());
    expect(result.current.refresh).toBe(mockRefresh);
  });
});

describe('useUnreadNotificationCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns count 0 when data is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useUnreadNotificationCount());
    expect(result.current.count).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it('returns unread count from API response', () => {
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: { count: 5 } })
    );
    const { result } = renderHook(() => useUnreadNotificationCount());
    expect(result.current.count).toBe(5);
  });

  it('calls the correct API endpoint', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useUnreadNotificationCount());
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/notifications/unread-count'
    );
  });

  it('exposes refresh function', () => {
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );
    const { result } = renderHook(() => useUnreadNotificationCount());
    expect(result.current.refresh).toBe(mockRefresh);
  });
});

describe('useNotificationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with loading:false and no error', () => {
    const { result } = renderHook(() => useNotificationActions());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('markAsRead calls apiClient.patch with correct endpoint', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ success: true });
    const { result } = renderHook(() => useNotificationActions());
    await act(async () => {
      await result.current.markAsRead('n-1');
    });
    expect(apiClient.patch).toHaveBeenCalledWith('/notifications/n-1/read', {});
  });

  it('markAsRead sets loading=true while in progress and false after', async () => {
    let resolve: (v: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    vi.mocked(apiClient.patch).mockReturnValue(promise);

    const { result } = renderHook(() => useNotificationActions());
    act(() => {
      void result.current.markAsRead('n-1');
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      resolve!({ success: true });
      await promise;
    });
    expect(result.current.loading).toBe(false);
  });

  it('markAsRead sets error on failure', async () => {
    const mockError = new Error('Mark read failed');
    vi.mocked(apiClient.patch).mockRejectedValue(mockError);

    const { result } = renderHook(() => useNotificationActions());
    await act(async () => {
      try {
        await result.current.markAsRead('n-1');
      } catch {
        // expected
      }
    });
    expect(result.current.error).toBe(mockError);
  });

  it('markAllAsRead calls apiClient.post with correct endpoint', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ count: 5 });
    const { result } = renderHook(() => useNotificationActions());
    await act(async () => {
      await result.current.markAllAsRead();
    });
    expect(apiClient.post).toHaveBeenCalledWith('/notifications/read-all', {});
  });

  it('markAllAsRead sets error on failure', async () => {
    const mockError = new Error('Mark all read failed');
    vi.mocked(apiClient.post).mockRejectedValue(mockError);

    const { result } = renderHook(() => useNotificationActions());
    await act(async () => {
      try {
        await result.current.markAllAsRead();
      } catch {
        // expected
      }
    });
    expect(result.current.error).toBe(mockError);
  });

  it('deleteNotification calls apiClient.delete with correct endpoint', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ success: true });
    const { result } = renderHook(() => useNotificationActions());
    await act(async () => {
      await result.current.deleteNotification('n-1');
    });
    expect(apiClient.delete).toHaveBeenCalledWith('/notifications/n-1');
  });

  it('deleteNotification sets error on failure', async () => {
    const mockError = new Error('Delete failed');
    vi.mocked(apiClient.delete).mockRejectedValue(mockError);

    const { result } = renderHook(() => useNotificationActions());
    await act(async () => {
      try {
        await result.current.deleteNotification('n-1');
      } catch {
        // expected
      }
    });
    expect(result.current.error).toBe(mockError);
    expect(result.current.loading).toBe(false);
  });
});

describe('useNotificationPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default preferences when data is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());
    const { result } = renderHook(() => useNotificationPreferences());
    expect(result.current.preferences).toEqual({
      emailEnabled: true,
      pushEnabled: true,
      soundEnabled: true,
      typeSettings: {},
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.updating).toBe(false);
  });

  it('returns actual preferences from API when loaded', () => {
    const mockPrefs = {
      emailEnabled: false,
      pushEnabled: true,
      soundEnabled: false,
      typeSettings: { SYSTEM: true },
    };
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: mockPrefs }));
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());
    const { result } = renderHook(() => useNotificationPreferences());
    expect(result.current.preferences).toEqual(mockPrefs);
  });

  it('calls the correct API endpoint for preferences', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());
    renderHook(() => useNotificationPreferences());
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/notifications/preferences'
    );
  });

  it('updatePreferences calls mutation execute and then refresh', async () => {
    const mockRefresh = vi.fn();
    const mockMutationExecute = vi.fn().mockResolvedValue({
      emailEnabled: false,
      pushEnabled: true,
      soundEnabled: true,
      typeSettings: {},
    });

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );
    vi.mocked(useApiMutation).mockReturnValue(
      makeDefaultMutation({ execute: mockMutationExecute })
    );

    const { result } = renderHook(() => useNotificationPreferences());
    await act(async () => {
      await result.current.updatePreferences({ emailEnabled: false });
    });
    expect(mockMutationExecute).toHaveBeenCalledWith({ emailEnabled: false });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('reflects updating state from mutation loading', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiMutation).mockReturnValue(
      makeDefaultMutation({ loading: true })
    );
    const { result } = renderHook(() => useNotificationPreferences());
    expect(result.current.updating).toBe(true);
  });

  it('calls useApiMutation with patch method and correct path', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());
    renderHook(() => useNotificationPreferences());
    expect(vi.mocked(useApiMutation)).toHaveBeenCalledWith(
      'patch',
      '/notifications/preferences'
    );
  });
});
