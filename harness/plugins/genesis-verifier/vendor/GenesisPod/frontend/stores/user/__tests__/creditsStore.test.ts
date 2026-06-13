import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useCreditsStore,
  useCreditsBalance,
  useCheckin,
  useInsufficientCreditsModal,
} from '../creditsStore';
import type {
  CreditAccountInfo,
  CheckinResult,
  InsufficientCreditsData,
} from '../creditsStore';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/utils/auth', () => ({
  getAuthTokens: vi.fn(() => ({ accessToken: 'test-token' })),
  getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAccount(
  overrides: Partial<CreditAccountInfo> = {}
): CreditAccountInfo {
  return {
    balance: 1000,
    totalEarned: 2000,
    totalSpent: 1000,
    giftBalance: 100,
    giftExpiresAt: null,
    isActive: true,
    isFrozen: false,
    todaySpent: 50,
    isLow: false,
    isCritical: false,
    ...overrides,
  };
}

function makeCheckinResult(
  overrides: Partial<CheckinResult> = {}
): CheckinResult {
  return {
    success: true,
    creditsEarned: 50,
    streakDays: 3,
    message: 'Check-in successful!',
    isStreakBonus: false,
    ...overrides,
  };
}

function makeInsufficientData(
  overrides: Partial<InsufficientCreditsData> = {}
): InsufficientCreditsData {
  return {
    required: 200,
    available: 100,
    deficit: 100,
    ...overrides,
  };
}

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetStore() {
  useCreditsStore.setState({
    account: null,
    isLoading: false,
    error: null,
    checkinStatus: null,
    isCheckingIn: false,
    insufficientModalOpen: false,
    insufficientData: null,
    checkinModalOpen: false,
    checkinResult: null,
  });
}

// Helper to create a mock fetch response
function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// useCreditsStore - initial state
// ═════════════════════════════════════════════════════════════════════════════

describe('useCreditsStore - initial state', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should have null account', () => {
    const { result } = renderHook(() => useCreditsStore());
    expect(result.current.account).toBeNull();
  });

  it('should have isLoading false', () => {
    const { result } = renderHook(() => useCreditsStore());
    expect(result.current.isLoading).toBe(false);
  });

  it('should have null error', () => {
    const { result } = renderHook(() => useCreditsStore());
    expect(result.current.error).toBeNull();
  });

  it('should have all modal states closed', () => {
    const { result } = renderHook(() => useCreditsStore());
    expect(result.current.insufficientModalOpen).toBe(false);
    expect(result.current.checkinModalOpen).toBe(false);
    expect(result.current.insufficientData).toBeNull();
    expect(result.current.checkinResult).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// fetchBalance
// ═════════════════════════════════════════════════════════════════════════════

describe('useCreditsStore - fetchBalance', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('should update account with balance data on success (no existing account)', async () => {
    globalThis.fetch = mockFetch({
      success: true,
      data: { balance: 800, isLow: false, isCritical: false, todaySpent: 20 },
    });

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.fetchBalance();
    });

    expect(result.current.account?.balance).toBe(800);
    expect(result.current.account?.isLow).toBe(false);
    expect(result.current.account?.isCritical).toBe(false);
    expect(result.current.account?.todaySpent).toBe(20);
    expect(result.current.error).toBeNull();
  });

  it('should merge balance into existing account without overwriting other fields', async () => {
    const existing = makeAccount({ totalEarned: 5000, giftBalance: 200 });
    useCreditsStore.setState({ account: existing });

    globalThis.fetch = mockFetch({
      success: true,
      data: { balance: 300, isLow: true, isCritical: false, todaySpent: 700 },
    });

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.fetchBalance();
    });

    expect(result.current.account?.balance).toBe(300);
    expect(result.current.account?.isLow).toBe(true);
    expect(result.current.account?.totalEarned).toBe(5000); // preserved
    expect(result.current.account?.giftBalance).toBe(200); // preserved
  });

  it('should silently ignore 401 (unauthenticated)', async () => {
    globalThis.fetch = mockFetch({}, 401);

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.fetchBalance();
    });

    expect(result.current.account).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should set error on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    });

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.fetchBalance();
    });

    expect(result.current.error).toBe('Failed to fetch balance');
  });

  it('should set error on fetch exception', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.fetchBalance();
    });

    expect(result.current.error).toBe('Network error');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// fetchAccount
// ═════════════════════════════════════════════════════════════════════════════

describe('useCreditsStore - fetchAccount', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('should set isLoading to true during fetch and false after', async () => {
    let resolveJson!: (v: unknown) => void;
    const jsonPromise = new Promise((res) => {
      resolveJson = res;
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => jsonPromise,
    });

    const { result } = renderHook(() => useCreditsStore());

    let fetchPromise: Promise<void>;
    act(() => {
      fetchPromise = result.current.fetchAccount();
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveJson({ success: true, data: makeAccount() });
      await fetchPromise;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('should populate account on success', async () => {
    const account = makeAccount({ balance: 999 });
    globalThis.fetch = mockFetch({ success: true, data: account });

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.fetchAccount();
    });

    expect(result.current.account?.balance).toBe(999);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should silently ignore 401 and set isLoading to false', async () => {
    globalThis.fetch = mockFetch({}, 401);

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.fetchAccount();
    });

    expect(result.current.account).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should set error on failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    });

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.fetchAccount();
    });

    expect(result.current.error).toBe('Failed to fetch account');
    expect(result.current.isLoading).toBe(false);
  });

  it('should throw error message from response body if available', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi
        .fn()
        .mockResolvedValue({ success: false, message: 'Account suspended' }),
    });

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.fetchAccount();
    });

    expect(result.current.error).toBe('Account suspended');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// performCheckin
// ═════════════════════════════════════════════════════════════════════════════

describe('useCreditsStore - performCheckin', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('should return checkin result and update account balance on success', async () => {
    const account = makeAccount({ balance: 1000, totalEarned: 5000 });
    useCreditsStore.setState({ account });

    const checkinResult = makeCheckinResult({
      creditsEarned: 50,
      streakDays: 5,
    });
    globalThis.fetch = mockFetch({ success: true, data: checkinResult });

    const { result } = renderHook(() => useCreditsStore());

    let returnedResult: CheckinResult | null = null;
    await act(async () => {
      returnedResult = await result.current.performCheckin();
    });

    expect(returnedResult).toEqual(checkinResult);
    expect(result.current.account?.balance).toBe(1050); // 1000 + 50
    expect(result.current.account?.totalEarned).toBe(5050); // 5000 + 50
    expect(result.current.isCheckingIn).toBe(false);
  });

  it('should update checkinStatus after successful check-in', async () => {
    useCreditsStore.setState({ account: makeAccount() });
    const checkinResult = makeCheckinResult({ streakDays: 7 });
    globalThis.fetch = mockFetch({ success: true, data: checkinResult });

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.performCheckin();
    });

    expect(result.current.checkinStatus?.canCheckin).toBe(false);
    expect(result.current.checkinStatus?.hasCheckedInToday).toBe(true);
    expect(result.current.checkinStatus?.streakDays).toBe(7);
    expect(result.current.checkinResult).toEqual(checkinResult);
  });

  it('should set isCheckingIn true during the operation', async () => {
    useCreditsStore.setState({ account: makeAccount() });

    let resolveJson!: (v: unknown) => void;
    const jsonPromise = new Promise((res) => {
      resolveJson = res;
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => jsonPromise,
    });

    const { result } = renderHook(() => useCreditsStore());

    let fetchPromise: Promise<CheckinResult | null>;
    act(() => {
      fetchPromise = result.current.performCheckin();
    });

    expect(result.current.isCheckingIn).toBe(true);

    await act(async () => {
      resolveJson({ success: true, data: makeCheckinResult() });
      await fetchPromise;
    });

    expect(result.current.isCheckingIn).toBe(false);
  });

  it('should return null and set isCheckingIn false on fetch exception', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useCreditsStore());

    let returnedResult: CheckinResult | null = null;
    await act(async () => {
      returnedResult = await result.current.performCheckin();
    });

    expect(returnedResult).toBeNull();
    expect(result.current.isCheckingIn).toBe(false);
  });

  it('should not update account balance if account is null', async () => {
    const checkinResult = makeCheckinResult({ creditsEarned: 50 });
    globalThis.fetch = mockFetch({ success: true, data: checkinResult });

    const { result } = renderHook(() => useCreditsStore());

    await act(async () => {
      await result.current.performCheckin();
    });

    expect(result.current.account).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// updateBalance
// ═════════════════════════════════════════════════════════════════════════════

describe('useCreditsStore - updateBalance', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should update balance and compute isLow/isCritical flags', () => {
    useCreditsStore.setState({
      account: makeAccount({ balance: 1000, isLow: false, isCritical: false }),
    });
    const { result } = renderHook(() => useCreditsStore());

    act(() => {
      result.current.updateBalance(400);
    }); // <= 500 = isLow
    expect(result.current.account?.balance).toBe(400);
    expect(result.current.account?.isLow).toBe(true);
    expect(result.current.account?.isCritical).toBe(false);
  });

  it('should set isCritical true when balance <= 100', () => {
    useCreditsStore.setState({ account: makeAccount({ balance: 1000 }) });
    const { result } = renderHook(() => useCreditsStore());

    act(() => {
      result.current.updateBalance(50);
    });

    expect(result.current.account?.isCritical).toBe(true);
    expect(result.current.account?.isLow).toBe(true);
  });

  it('should add spent amount to todaySpent and totalSpent', () => {
    useCreditsStore.setState({
      account: makeAccount({ balance: 1000, todaySpent: 100, totalSpent: 500 }),
    });
    const { result } = renderHook(() => useCreditsStore());

    act(() => {
      result.current.updateBalance(750, 250);
    });

    expect(result.current.account?.todaySpent).toBe(350); // 100 + 250
    expect(result.current.account?.totalSpent).toBe(750); // 500 + 250
  });

  it('should not modify todaySpent/totalSpent when spent is not provided', () => {
    useCreditsStore.setState({
      account: makeAccount({ balance: 1000, todaySpent: 100, totalSpent: 500 }),
    });
    const { result } = renderHook(() => useCreditsStore());

    act(() => {
      result.current.updateBalance(800);
    });

    expect(result.current.account?.todaySpent).toBe(100);
    expect(result.current.account?.totalSpent).toBe(500);
  });

  it('should be a no-op when account is null', () => {
    const { result } = renderHook(() => useCreditsStore());

    act(() => {
      result.current.updateBalance(500);
    });

    expect(result.current.account).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Modal controls
// ═════════════════════════════════════════════════════════════════════════════

describe('useCreditsStore - modal controls', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('showInsufficientModal / hideInsufficientModal', () => {
    it('should open the insufficient modal with data', () => {
      const { result } = renderHook(() => useCreditsStore());
      const data = makeInsufficientData();

      act(() => {
        result.current.showInsufficientModal(data);
      });

      expect(result.current.insufficientModalOpen).toBe(true);
      expect(result.current.insufficientData).toEqual(data);
    });

    it('should close the insufficient modal and clear data', () => {
      const { result } = renderHook(() => useCreditsStore());
      act(() => {
        result.current.showInsufficientModal(makeInsufficientData());
      });

      act(() => {
        result.current.hideInsufficientModal();
      });

      expect(result.current.insufficientModalOpen).toBe(false);
      expect(result.current.insufficientData).toBeNull();
    });
  });

  describe('showCheckinModal / hideCheckinModal', () => {
    it('should open the checkin modal', () => {
      const { result } = renderHook(() => useCreditsStore());

      act(() => {
        result.current.showCheckinModal();
      });

      expect(result.current.checkinModalOpen).toBe(true);
    });

    it('should close the checkin modal and clear checkin result', () => {
      const { result } = renderHook(() => useCreditsStore());
      useCreditsStore.setState({
        checkinModalOpen: true,
        checkinResult: makeCheckinResult(),
      });

      act(() => {
        result.current.hideCheckinModal();
      });

      expect(result.current.checkinModalOpen).toBe(false);
      expect(result.current.checkinResult).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// reset
// ═════════════════════════════════════════════════════════════════════════════

describe('useCreditsStore - reset', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should clear all state back to initial values', () => {
    useCreditsStore.setState({
      account: makeAccount(),
      isLoading: true,
      error: 'some error',
      checkinStatus: {
        canCheckin: false,
        hasCheckedInToday: true,
        streakDays: 5,
        lastCheckinDate: '2026-01-01',
        nextReward: 50,
      },
      isCheckingIn: true,
      insufficientModalOpen: true,
      insufficientData: makeInsufficientData(),
      checkinModalOpen: true,
      checkinResult: makeCheckinResult(),
    });

    const { result } = renderHook(() => useCreditsStore());

    act(() => {
      result.current.reset();
    });

    expect(result.current.account).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.checkinStatus).toBeNull();
    expect(result.current.isCheckingIn).toBe(false);
    expect(result.current.insufficientModalOpen).toBe(false);
    expect(result.current.insufficientData).toBeNull();
    expect(result.current.checkinModalOpen).toBe(false);
    expect(result.current.checkinResult).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Convenience hooks
// ═════════════════════════════════════════════════════════════════════════════

describe('useCreditsBalance', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should return 0 balance when account is null', () => {
    const { result } = renderHook(() => useCreditsBalance());
    expect(result.current.balance).toBe(0);
    expect(result.current.isLow).toBe(false);
    expect(result.current.isCritical).toBe(false);
  });

  it('should return account balance values when account is set', () => {
    useCreditsStore.setState({
      account: makeAccount({ balance: 750, isLow: false, isCritical: false }),
    });

    const { result } = renderHook(() => useCreditsBalance());

    expect(result.current.balance).toBe(750);
    expect(result.current.isLow).toBe(false);
    expect(result.current.isCritical).toBe(false);
  });
});

describe('useCheckin', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should expose all checkin-related state', () => {
    const { result } = renderHook(() => useCheckin());

    expect(result.current.status).toBeNull();
    expect(result.current.isCheckingIn).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.isModalOpen).toBe(false);
    expect(typeof result.current.performCheckin).toBe('function');
    expect(typeof result.current.fetchStatus).toBe('function');
    expect(typeof result.current.showModal).toBe('function');
    expect(typeof result.current.hideModal).toBe('function');
  });
});

describe('useInsufficientCreditsModal', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should expose modal state and actions', () => {
    const { result } = renderHook(() => useInsufficientCreditsModal());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.data).toBeNull();
    expect(typeof result.current.show).toBe('function');
    expect(typeof result.current.hide).toBe('function');
  });

  it('should reflect store changes', () => {
    const { result } = renderHook(() => useInsufficientCreditsModal());
    const data = makeInsufficientData();

    act(() => {
      useCreditsStore.getState().showInsufficientModal(data);
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.data).toEqual(data);
  });
});
