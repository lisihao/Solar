import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn().mockReturnValue({ Authorization: 'Bearer test' }),
}));

import { useApiGet } from '@/hooks/core';
import { useAdminUsers, useUserStats } from '../useAdminUsers';
import type { User, PaginationInfo } from '../useAdminUsers';

const makeDefaultGet = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  username: 'testuser',
  role: 'USER',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makePagination = (
  overrides: Partial<PaginationInfo> = {}
): PaginationInfo => ({
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1,
  ...overrides,
});

describe('useAdminUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
  });

  it('returns empty users array when data is null', () => {
    const { result } = renderHook(() => useAdminUsers());
    expect(result.current.users).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns users list when data is available', () => {
    const users = [
      makeUser(),
      makeUser({ id: 'user-2', email: 'user2@example.com' }),
    ];
    const pagination = makePagination({ total: 2, totalPages: 1 });
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: { users, pagination } })
    );

    const { result } = renderHook(() => useAdminUsers());
    expect(result.current.users).toHaveLength(2);
    expect(result.current.users[0].email).toBe('test@example.com');
    expect(result.current.total).toBe(2);
  });

  it('exposes pagination info from API response', () => {
    const pagination = makePagination({
      page: 2,
      limit: 20,
      total: 50,
      totalPages: 3,
    });
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: { users: [], pagination } })
    );

    const { result } = renderHook(() => useAdminUsers());
    expect(result.current.pagination.totalPages).toBe(3);
    expect(result.current.pagination.total).toBe(50);
  });

  it('returns default pagination when data is null', () => {
    const { result } = renderHook(() => useAdminUsers());
    expect(result.current.pagination.page).toBe(1);
    expect(result.current.pagination.limit).toBe(20);
    expect(result.current.pagination.total).toBe(0);
    expect(result.current.pagination.totalPages).toBe(1);
  });

  it('starts at page 1 by default', () => {
    const { result } = renderHook(() => useAdminUsers());
    expect(result.current.page).toBe(1);
  });

  it('accepts custom initial page', () => {
    const { result } = renderHook(() => useAdminUsers(3));
    expect(result.current.page).toBe(3);
  });

  it('includes page and limit in the API URL', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useAdminUsers(2, 10));
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('page=2');
    expect(callArg).toContain('limit=10');
  });

  it('createUser calls fetch and refreshes list on success', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );

    const newUser = makeUser({ id: 'new-user' });
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, ...newUser }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useAdminUsers());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.createUser({ email: 'new@example.com' });
    });

    expect(returned).toBeDefined();
    expect(mockExecute).toHaveBeenCalled();
    expect(result.current.isCreating).toBe(false);
  });

  it('updateUser calls PUT endpoint and refreshes list', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ id: 'user-1', name: 'Updated User' }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useAdminUsers());
    await act(async () => {
      await result.current.updateUser('user-1', { name: 'Updated User' });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/admin/users/user-1',
      expect.objectContaining({ method: 'PUT' })
    );
    expect(mockExecute).toHaveBeenCalled();
    expect(result.current.isUpdating).toBe(false);
  });

  it('deleteUser calls DELETE endpoint and refreshes list', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({}),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useAdminUsers());
    await act(async () => {
      await result.current.deleteUser('user-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/admin/users/user-1',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(mockExecute).toHaveBeenCalled();
    expect(result.current.isDeleting).toBe(false);
  });

  it('banUser calls updateUser with status=banned', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ id: 'user-1', status: 'banned' }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useAdminUsers());
    await act(async () => {
      await result.current.banUser('user-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/admin/users/user-1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ status: 'banned' }),
      })
    );
  });

  it('activateUser calls updateUser with status=active', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ id: 'user-1', status: 'active' }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useAdminUsers());
    await act(async () => {
      await result.current.activateUser('user-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/admin/users/user-1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ status: 'active' }),
      })
    );
  });

  it('grantCredits calls credits/grant endpoint and refreshes on success', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, newBalance: 600 }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useAdminUsers());
    await act(async () => {
      await result.current.grantCredits('user-1', 100, 'bonus');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/admin/users/user-1/credits/grant',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockExecute).toHaveBeenCalled();
    expect(result.current.isCreditsLoading).toBe(false);
  });

  it('fetchLoginHistory returns history items from API', async () => {
    const historyItems = [
      {
        id: '1',
        loginAt: '2026-01-01T00:00:00Z',
        ipAddress: '127.0.0.1',
        device: 'Desktop',
        browser: 'Chrome',
        os: 'Windows',
        location: 'US',
      },
    ];
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ history: historyItems }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useAdminUsers());
    let history: unknown;
    await act(async () => {
      history = await result.current.fetchLoginHistory('user-1');
    });

    expect(history).toEqual(historyItems);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/admin/users/user-1/login-history'),
      expect.any(Object)
    );
  });

  it('fetchLoginHistory returns empty array on error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    global.fetch = mockFetch;

    const { result } = renderHook(() => useAdminUsers());
    let history: unknown;
    await act(async () => {
      history = await result.current.fetchLoginHistory('user-1');
    });

    expect(history).toEqual([]);
  });

  it('goToPage updates page when within valid range', () => {
    const pagination = makePagination({ total: 100, totalPages: 5 });
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: { users: [], pagination } })
    );

    const { result } = renderHook(() => useAdminUsers());
    act(() => {
      result.current.goToPage(3);
    });
    expect(result.current.page).toBe(3);
  });

  it('goToPage does not update when page is out of range', () => {
    const pagination = makePagination({ total: 20, totalPages: 1 });
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: { users: [], pagination } })
    );

    const { result } = renderHook(() => useAdminUsers());
    act(() => {
      result.current.goToPage(10);
    });
    expect(result.current.page).toBe(1);
  });

  it('nextPage increments page when not at last page', () => {
    const pagination = makePagination({ total: 40, totalPages: 2 });
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: { users: [], pagination } })
    );

    const { result } = renderHook(() => useAdminUsers());
    act(() => {
      result.current.nextPage();
    });
    expect(result.current.page).toBe(2);
  });

  it('prevPage decrements page when not on first page', () => {
    const pagination = makePagination({ total: 40, totalPages: 2 });
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: { users: [], pagination } })
    );

    const { result } = renderHook(() => useAdminUsers(2));
    act(() => {
      result.current.prevPage();
    });
    expect(result.current.page).toBe(1);
  });

  it('prevPage does not go below page 1', () => {
    const { result } = renderHook(() => useAdminUsers(1));
    act(() => {
      result.current.prevPage();
    });
    expect(result.current.page).toBe(1);
  });
});

describe('useUserStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
  });

  it('returns null stats when data is null', () => {
    const { result } = renderHook(() => useUserStats());
    expect(result.current.stats).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns stats data when API responds', () => {
    const stats = {
      totalUsers: 500,
      activeUsers: 400,
      weeklyActiveUsers: 200,
      monthlyActiveUsers: 350,
      newUsersToday: 5,
      newUsersThisWeek: 30,
      newUsersThisMonth: 120,
      adminCount: 3,
    };
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: stats }));

    const { result } = renderHook(() => useUserStats());
    expect(result.current.stats).toEqual(stats);
    expect(result.current.stats?.totalUsers).toBe(500);
  });

  it('calls the correct API endpoint', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useUserStats());
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toBe('/admin/users/stats');
  });

  it('exposes refreshStats function', () => {
    const mockExecute = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );
    const { result } = renderHook(() => useUserStats());
    expect(result.current.refreshStats).toBe(mockExecute);
  });
});
