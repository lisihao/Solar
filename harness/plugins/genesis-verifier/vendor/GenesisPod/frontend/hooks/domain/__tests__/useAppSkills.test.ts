import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    patch: vi.fn(),
  },
}));

vi.mock('@/stores', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// DomainSkillsResponse type mock — hook imports this from component types
vi.mock('@/components/common/skills/types', () => ({}));

import { useApiGet } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import { toast } from '@/stores';
import { useAppSkills } from '../useAppSkills';

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

describe('useAppSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty skills and default stats in initial state', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useAppSkills('research'));
    expect(result.current.skills).toEqual([]);
    expect(result.current.stats).toEqual({ total: 0, enabled: 0, byLayer: {} });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.toggling).toBe(false);
  });

  it('returns skills and stats when API responds', () => {
    const mockData = {
      skills: [
        { id: 'skill-1', name: 'Web Search', enabled: true, layer: 'search' },
        {
          id: 'skill-2',
          name: 'Code Runner',
          enabled: false,
          layer: 'execution',
        },
      ],
      stats: { total: 2, enabled: 1, byLayer: { search: 1, execution: 1 } },
    };
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: mockData }));
    const { result } = renderHook(() => useAppSkills('research'));
    expect(result.current.skills).toEqual(mockData.skills);
    expect(result.current.stats).toEqual(mockData.stats);
  });

  it('calls the correct API endpoint for the domain', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useAppSkills('coding'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/skills/by-domain/coding'
    );
  });

  it('calls the correct API endpoint for different domains', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useAppSkills('writing'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/skills/by-domain/writing'
    );
  });

  it('reflects loading state from useApiGet', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ loading: true }));
    const { result } = renderHook(() => useAppSkills('research'));
    expect(result.current.loading).toBe(true);
  });

  it('reflects error state from useApiGet', () => {
    const mockError = new Error('Skills fetch failed');
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ error: mockError as never })
    );
    const { result } = renderHook(() => useAppSkills('research'));
    expect(result.current.error).toBe(mockError);
  });

  it('exposes refresh function from useApiGet', () => {
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );
    const { result } = renderHook(() => useAppSkills('research'));
    expect(result.current.refresh).toBe(mockRefresh);
  });

  it('toggleSkill calls apiClient.patch with correct endpoint and payload', async () => {
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );
    vi.mocked(apiClient.patch).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAppSkills('research'));
    await act(async () => {
      await result.current.toggleSkill('skill-1', true);
    });
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/skills/skill-1/domains/research',
      { enabled: true }
    );
  });

  it('toggleSkill calls refresh after successful patch', async () => {
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );
    vi.mocked(apiClient.patch).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAppSkills('research'));
    await act(async () => {
      await result.current.toggleSkill('skill-1', false);
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('toggleSkill sets toggling=true during operation', async () => {
    let resolveToggle: (v: unknown) => void;
    const togglePromise = new Promise((res) => {
      resolveToggle = res;
    });
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ refresh: vi.fn() }));
    vi.mocked(apiClient.patch).mockReturnValue(togglePromise);

    const { result } = renderHook(() => useAppSkills('research'));
    act(() => {
      void result.current.toggleSkill('skill-1', true);
    });
    expect(result.current.toggling).toBe(true);

    await act(async () => {
      resolveToggle!({ success: true });
      await togglePromise;
    });
    expect(result.current.toggling).toBe(false);
  });

  it('toggleSkill shows toast.error when patch fails', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ refresh: vi.fn() }));
    vi.mocked(apiClient.patch).mockRejectedValue(new Error('Patch failed'));

    const { result } = renderHook(() => useAppSkills('research'));
    await act(async () => {
      await result.current.toggleSkill('skill-1', true);
    });
    expect(toast.error).toHaveBeenCalledWith(
      'Operation failed',
      'Patch failed'
    );
  });

  it('toggleSkill resets toggling to false after error', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ refresh: vi.fn() }));
    vi.mocked(apiClient.patch).mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useAppSkills('research'));
    await act(async () => {
      await result.current.toggleSkill('skill-2', false);
    });
    expect(result.current.toggling).toBe(false);
  });

  it('toggleSkill uses generic error message when error is not an Error instance', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ refresh: vi.fn() }));
    vi.mocked(apiClient.patch).mockRejectedValue('string error');

    const { result } = renderHook(() => useAppSkills('research'));
    await act(async () => {
      await result.current.toggleSkill('skill-1', true);
    });
    expect(toast.error).toHaveBeenCalledWith(
      'Operation failed',
      'Failed to toggle skill'
    );
  });

  it('toggleSkill uses the domain from hook parameter in the API path', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ refresh: vi.fn() }));
    vi.mocked(apiClient.patch).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAppSkills('social'));
    await act(async () => {
      await result.current.toggleSkill('skill-3', true);
    });
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/skills/skill-3/domains/social',
      { enabled: true }
    );
  });

  it('defaults stats to zeros when data.stats is null', () => {
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: { skills: null, stats: null } })
    );
    const { result } = renderHook(() => useAppSkills('research'));
    expect(result.current.skills).toEqual([]);
    expect(result.current.stats).toEqual({ total: 0, enabled: 0, byLayer: {} });
  });

  it('toggling remains false when patch succeeds synchronously', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ refresh: vi.fn() }));
    vi.mocked(apiClient.patch).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAppSkills('research'));
    await act(async () => {
      await result.current.toggleSkill('skill-1', true);
    });
    // After completion toggling should be false
    expect(result.current.toggling).toBe(false);
  });

  it('does not call refresh when patch fails', async () => {
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );
    vi.mocked(apiClient.patch).mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => useAppSkills('research'));
    await act(async () => {
      await result.current.toggleSkill('skill-1', true);
    });
    // refresh should NOT be called when the patch fails
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('returns loaded skills list correctly', () => {
    const mockData = {
      skills: [
        {
          id: 'skill-1',
          name: 'Code Execution',
          enabled: true,
          layer: 'runtime',
        },
        { id: 'skill-2', name: 'Browser', enabled: false, layer: 'tools' },
        { id: 'skill-3', name: 'Memory', enabled: true, layer: 'memory' },
      ],
      stats: {
        total: 3,
        enabled: 2,
        byLayer: { runtime: 1, tools: 1, memory: 1 },
      },
    };
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: mockData }));
    const { result } = renderHook(() => useAppSkills('coding'));
    expect(result.current.skills).toHaveLength(3);
    expect(result.current.stats.total).toBe(3);
    expect(result.current.stats.enabled).toBe(2);
  });

  it('hook can be called with writing domain', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useAppSkills('writing'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/skills/by-domain/writing'
    );
  });
});
