import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock stores first
vi.mock('@/stores', () => ({
  useCreditsStore: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Mock core hooks (useCredits imports from '@/hooks/core' which resolves to hooks/core)
vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiMutation: vi.fn(),
}));

// Mock auth utilities
vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
}));

import { useApiGet } from '@/hooks/core';
import { useCreditsStore } from '@/stores';
import {
  useCredits,
  useCreditsTransactions,
  useCreditsStats,
  useCreditRules,
  useCheckinHistory,
  useEstimateCredits,
  useCreditsCheck,
} from '../useCredits';

// Default store shape used in multiple tests
const makeDefaultStore = (overrides = {}) => ({
  account: null,
  isLoading: false,
  error: null,
  checkinStatus: null,
  isCheckingIn: false,
  insufficientModalOpen: false,
  insufficientData: null,
  checkinModalOpen: false,
  checkinResult: null,
  fetchAccount: vi.fn(),
  fetchBalance: vi.fn(),
  fetchCheckinStatus: vi.fn(),
  performCheckin: vi.fn(),
  showInsufficientModal: vi.fn(),
  hideInsufficientModal: vi.fn(),
  showCheckinModal: vi.fn(),
  hideCheckinModal: vi.fn(),
  updateBalance: vi.fn(),
  reset: vi.fn(),
  ...overrides,
});

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

describe('useCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns initial state when account is null', () => {
    vi.mocked(useCreditsStore).mockReturnValue(makeDefaultStore());
    const { result } = renderHook(() => useCredits());
    expect(result.current.account).toBeNull();
    expect(result.current.balance).toBe(0);
    expect(result.current.isLow).toBe(false);
    expect(result.current.isCritical).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns account data when account is populated', () => {
    const account = {
      balance: 1500,
      isLow: false,
      isCritical: false,
      totalEarned: 3000,
      totalSpent: 1500,
      giftBalance: 0,
      giftExpiresAt: null,
      isActive: true,
      isFrozen: false,
      todaySpent: 50,
    };
    vi.mocked(useCreditsStore).mockReturnValue(makeDefaultStore({ account }));
    const { result } = renderHook(() => useCredits());
    expect(result.current.account).toEqual(account);
    expect(result.current.balance).toBe(1500);
  });

  it('reflects isLow and isCritical flags from account', () => {
    const account = {
      balance: 80,
      isLow: true,
      isCritical: true,
      totalEarned: 1000,
      totalSpent: 920,
      giftBalance: 0,
      giftExpiresAt: null,
      isActive: true,
      isFrozen: false,
      todaySpent: 20,
    };
    vi.mocked(useCreditsStore).mockReturnValue(makeDefaultStore({ account }));
    const { result } = renderHook(() => useCredits());
    expect(result.current.isLow).toBe(true);
    expect(result.current.isCritical).toBe(true);
  });

  it('calls fetchAccount and fetchCheckinStatus on mount when account is null', async () => {
    const mockFetchAccount = vi.fn();
    const mockFetchCheckinStatus = vi.fn();
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({
        fetchAccount: mockFetchAccount,
        fetchCheckinStatus: mockFetchCheckinStatus,
      })
    );
    renderHook(() => useCredits());
    await waitFor(() => {
      expect(mockFetchAccount).toHaveBeenCalledTimes(1);
      expect(mockFetchCheckinStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call fetchAccount when account already loaded', async () => {
    const mockFetchAccount = vi.fn();
    const account = {
      balance: 100,
      isLow: false,
      isCritical: false,
      totalEarned: 100,
      totalSpent: 0,
      giftBalance: 0,
      giftExpiresAt: null,
      isActive: true,
      isFrozen: false,
      todaySpent: 0,
    };
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({ account, fetchAccount: mockFetchAccount })
    );
    renderHook(() => useCredits());
    await waitFor(() => {
      expect(mockFetchAccount).not.toHaveBeenCalled();
    });
  });

  it('refreshBalance calls store.fetchBalance', async () => {
    const mockFetchBalance = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({ fetchBalance: mockFetchBalance })
    );
    const { result } = renderHook(() => useCredits());
    await act(async () => {
      await result.current.refreshBalance();
    });
    expect(mockFetchBalance).toHaveBeenCalledTimes(1);
  });

  it('exposes modal control functions from store', () => {
    const mockShow = vi.fn();
    const mockHide = vi.fn();
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({
        showInsufficientModal: mockShow,
        hideInsufficientModal: mockHide,
      })
    );
    const { result } = renderHook(() => useCredits());
    expect(result.current.showInsufficientModal).toBe(mockShow);
    expect(result.current.hideInsufficientModal).toBe(mockHide);
  });

  it('exposes checkin modal state and controls', () => {
    const mockShowCheckin = vi.fn();
    const mockHideCheckin = vi.fn();
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({
        checkinModalOpen: true,
        showCheckinModal: mockShowCheckin,
        hideCheckinModal: mockHideCheckin,
      })
    );
    const { result } = renderHook(() => useCredits());
    expect(result.current.checkinModalOpen).toBe(true);
    expect(result.current.showCheckinModal).toBe(mockShowCheckin);
    expect(result.current.hideCheckinModal).toBe(mockHideCheckin);
  });

  it('exposes performCheckin from store', () => {
    const mockPerformCheckin = vi.fn();
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({ performCheckin: mockPerformCheckin })
    );
    const { result } = renderHook(() => useCredits());
    expect(result.current.performCheckin).toBe(mockPerformCheckin);
  });

  it('exposes isLoading state from store', () => {
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({ isLoading: true })
    );
    const { result } = renderHook(() => useCredits());
    expect(result.current.isLoading).toBe(true);
  });

  it('exposes error from store', () => {
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({ error: 'Network error' })
    );
    const { result } = renderHook(() => useCredits());
    expect(result.current.error).toBe('Network error');
  });
});

describe('useCreditsTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty transactions when data is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useCreditsTransactions());
    expect(result.current.transactions).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('returns transactions data when API responds', () => {
    const mockTransactions = [
      {
        id: '1',
        type: 'SPEND',
        amount: -50,
        balanceAfter: 950,
        description: 'AI task',
        createdAt: '2026-01-01',
      },
      {
        id: '2',
        type: 'EARN',
        amount: 100,
        balanceAfter: 1050,
        description: 'Checkin',
        createdAt: '2026-01-02',
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({
        data: {
          data: mockTransactions,
          total: 2,
          limit: 20,
          offset: 0,
          hasMore: false,
        },
      })
    );
    const { result } = renderHook(() => useCreditsTransactions());
    expect(result.current.transactions).toEqual(mockTransactions);
    expect(result.current.total).toBe(2);
    expect(result.current.hasMore).toBe(false);
  });

  it('exposes hasMore=true when there are more pages', () => {
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({
        data: { data: [], total: 100, limit: 20, offset: 0, hasMore: true },
      })
    );
    const { result } = renderHook(() => useCreditsTransactions());
    expect(result.current.hasMore).toBe(true);
    expect(result.current.total).toBe(100);
  });

  it('passes filter options to API URL', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() =>
      useCreditsTransactions({
        type: 'SPEND',
        moduleType: 'research',
        limit: 10,
      })
    );
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('type=SPEND');
    expect(callArg).toContain('moduleType=research');
    expect(callArg).toContain('limit=10');
  });

  it('exposes refresh function from useApiGet execute', () => {
    const mockExecute = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );
    const { result } = renderHook(() => useCreditsTransactions());
    expect(result.current.refresh).toBe(mockExecute);
  });

  it('exposes loadMore function that calls fetch', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ json: vi.fn().mockResolvedValue({ data: [] }) });
    global.fetch = mockFetch;
    const { result } = renderHook(() => useCreditsTransactions({ limit: 5 }));
    await act(async () => {
      await result.current.loadMore(20);
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('offset=20'),
      expect.any(Object)
    );
  });
});

describe('useCreditsStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null stats when data is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useCreditsStats());
    expect(result.current.stats).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns stats data when API responds', () => {
    const mockStats = {
      totalEarned: 5000,
      totalSpent: 2000,
      currentBalance: 3000,
      todaySpent: 100,
      weekSpent: 500,
      monthSpent: 2000,
      topModules: [{ module: 'research', spent: 1500 }],
    };
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: mockStats }));
    const { result } = renderHook(() => useCreditsStats());
    expect(result.current.stats).toEqual(mockStats);
  });

  it('calls the correct API endpoint', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useCreditsStats());
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/credits/stats',
      expect.objectContaining({ immediate: true })
    );
  });

  it('exposes refresh function', () => {
    const mockExecute = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );
    const { result } = renderHook(() => useCreditsStats());
    expect(result.current.refresh).toBe(mockExecute);
  });
});

describe('useCreditRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty rules array when data is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useCreditRules());
    expect(result.current.rules).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('returns rules when API responds', () => {
    const mockRules = [
      {
        moduleType: 'research',
        operationType: 'search',
        baseCredits: 10,
        name: 'Research Search',
        isActive: true,
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: mockRules }));
    const { result } = renderHook(() => useCreditRules());
    expect(result.current.rules).toEqual(mockRules);
  });

  it('calls the correct API endpoint with immediate:true', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useCreditRules());
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/credits/rules',
      expect.objectContaining({ immediate: true })
    );
  });
});

describe('useCheckinHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty history when data is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useCheckinHistory());
    expect(result.current.history).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('returns history data when API responds', () => {
    const mockHistory = [
      { date: '2026-01-01', credits: 50, streakDays: 1 },
      { date: '2026-01-02', credits: 55, streakDays: 2 },
    ];
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: mockHistory }));
    const { result } = renderHook(() => useCheckinHistory());
    expect(result.current.history).toEqual(mockHistory);
  });

  it('uses default limit of 30', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useCheckinHistory());
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('limit=30');
  });

  it('accepts custom limit parameter', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useCheckinHistory(7));
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('limit=7');
  });
});

describe('useEstimateCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns loading state and estimate function', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useEstimateCredits());
    expect(result.current.loading).toBe(false);
    expect(typeof result.current.estimate).toBe('function');
  });

  it('calls fetch with correct params and returns estimatedCredits on success', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi
        .fn()
        .mockResolvedValue({ success: true, data: { estimatedCredits: 25 } }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useEstimateCredits());
    let credits: number;
    await act(async () => {
      credits = await result.current.estimate(
        'research',
        'search',
        1000,
        'gpt-4o'
      );
    });
    expect(credits!).toBe(25);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('moduleType=research'),
      expect.any(Object)
    );
  });

  it('returns 0 when estimate API reports failure', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: false }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useEstimateCredits());
    let credits: number;
    await act(async () => {
      credits = await result.current.estimate('research', 'search');
    });
    expect(credits!).toBe(0);
  });

  it('uses immediate:false so no auto-fetch on mount', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useEstimateCredits());
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/credits/estimate',
      expect.objectContaining({ immediate: false })
    );
  });
});

describe('useCreditsCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when balance is sufficient', () => {
    const mockShow = vi.fn();
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({
        account: {
          balance: 500,
          isLow: false,
          isCritical: false,
          totalEarned: 500,
          totalSpent: 0,
          giftBalance: 0,
          giftExpiresAt: null,
          isActive: true,
          isFrozen: false,
          todaySpent: 0,
        },
        showInsufficientModal: mockShow,
      })
    );
    const { result } = renderHook(() => useCreditsCheck());
    expect(result.current.checkBalance(100)).toBe(true);
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('returns false and shows modal when balance is insufficient', () => {
    const mockShow = vi.fn();
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({
        account: {
          balance: 50,
          isLow: true,
          isCritical: true,
          totalEarned: 50,
          totalSpent: 0,
          giftBalance: 0,
          giftExpiresAt: null,
          isActive: true,
          isFrozen: false,
          todaySpent: 0,
        },
        showInsufficientModal: mockShow,
      })
    );
    const { result } = renderHook(() => useCreditsCheck());
    const ok = result.current.checkBalance(100);
    expect(ok).toBe(false);
    expect(mockShow).toHaveBeenCalledWith({
      required: 100,
      available: 50,
      deficit: 50,
    });
  });

  it('returns true when balance exactly equals required', () => {
    const mockShow = vi.fn();
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({
        account: {
          balance: 100,
          isLow: false,
          isCritical: false,
          totalEarned: 100,
          totalSpent: 0,
          giftBalance: 0,
          giftExpiresAt: null,
          isActive: true,
          isFrozen: false,
          todaySpent: 0,
        },
        showInsufficientModal: mockShow,
      })
    );
    const { result } = renderHook(() => useCreditsCheck());
    expect(result.current.checkBalance(100)).toBe(true);
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('exposes current balance', () => {
    vi.mocked(useCreditsStore).mockReturnValue(
      makeDefaultStore({
        account: {
          balance: 250,
          isLow: false,
          isCritical: false,
          totalEarned: 250,
          totalSpent: 0,
          giftBalance: 0,
          giftExpiresAt: null,
          isActive: true,
          isFrozen: false,
          todaySpent: 0,
        },
      })
    );
    const { result } = renderHook(() => useCreditsCheck());
    expect(result.current.balance).toBe(250);
  });
});
