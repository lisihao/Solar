import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

import { useApiGet, useApiPost } from '@/hooks/core';
import {
  useSkillsStats,
  useSkillsTimeline,
  useSkillsSearch,
  usePopularSkills,
  useFeaturedSkills,
  useSkillCategories,
  useSkillsSync,
  useAISkills,
} from '../useSkillsMP';

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

const makeDefaultPost = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

describe('useSkillsStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
  });

  it('returns null stats when data is null', () => {
    const { result } = renderHook(() => useSkillsStats());
    expect(result.current.stats).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns stats when data is available', () => {
    const stats = {
      totalSkills: 500,
      lastUpdated: '2026-01-01T00:00:00Z',
      weeklyGrowth: 20,
      featuredCount: 15,
      categoryCount: 10,
    };
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: stats }));

    const { result } = renderHook(() => useSkillsStats());
    expect(result.current.stats?.totalSkills).toBe(500);
    expect(result.current.stats?.featuredCount).toBe(15);
  });

  it('calls the correct API endpoint', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useSkillsStats());
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toBe('/skills/stats');
  });

  it('exposes refresh function', () => {
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );
    const { result } = renderHook(() => useSkillsStats());
    expect(result.current.refresh).toBe(mockRefresh);
  });
});

describe('useSkillsTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
  });

  it('returns empty timeline when data is null', () => {
    const { result } = renderHook(() => useSkillsTimeline());
    expect(result.current.timeline).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns timeline data when available', () => {
    const timeline = [
      { date: '2026-01-01', count: 5, cumulative: 100 },
      { date: '2026-01-02', count: 8, cumulative: 108 },
    ];
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: timeline }));

    const { result } = renderHook(() => useSkillsTimeline());
    expect(result.current.timeline).toHaveLength(2);
    expect(result.current.timeline[0].count).toBe(5);
  });

  it('calls /skills/timeline endpoint', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useSkillsTimeline());
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toBe('/skills/timeline');
  });
});

describe('useSkillsSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
  });

  it('returns empty skills and zero total when data is null', () => {
    const { result } = renderHook(() => useSkillsSearch({}));
    expect(result.current.skills).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns skills and total when API responds', () => {
    const skills = [
      {
        id: 'skill-1',
        name: 'Test Skill',
        description: 'A test',
        category: 'AI',
        author: 'Author',
        stars: 100,
        downloads: '5k',
        tags: [],
        featured: false,
        url: '',
        lastUpdated: '2026-01-01',
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: { skills, total: 1 } })
    );

    const { result } = renderHook(() => useSkillsSearch({}));
    expect(result.current.skills).toHaveLength(1);
    expect(result.current.total).toBe(1);
  });

  it('builds query string with search params', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() =>
      useSkillsSearch({
        query: 'nlp',
        category: 'AI',
        sortBy: 'stars',
        limit: 10,
        offset: 0,
      })
    );
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('q=nlp');
    expect(callArg).toContain('category=AI');
    expect(callArg).toContain('sortBy=stars');
    expect(callArg).toContain('limit=10');
  });

  it('does not include category=all in query string', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useSkillsSearch({ category: 'all' }));
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).not.toContain('category=all');
  });

  it('exposes refresh function', () => {
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );
    const { result } = renderHook(() => useSkillsSearch({}));
    expect(result.current.refresh).toBe(mockRefresh);
  });
});

describe('usePopularSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
  });

  it('returns empty array when data is null', () => {
    const { result } = renderHook(() => usePopularSkills());
    expect(result.current.skills).toEqual([]);
  });

  it('uses default limit of 50 in URL', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => usePopularSkills());
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('/skills/popular?limit=50');
  });

  it('accepts custom limit parameter', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => usePopularSkills(20));
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('limit=20');
  });
});

describe('useFeaturedSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
  });

  it('returns empty array when data is null', () => {
    const { result } = renderHook(() => useFeaturedSkills());
    expect(result.current.skills).toEqual([]);
  });

  it('uses default limit of 20 in URL', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useFeaturedSkills());
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('/skills/featured?limit=20');
  });

  it('returns skills data when available', () => {
    const featuredSkills = [
      {
        id: 'featured-1',
        name: 'Featured Skill',
        description: 'A featured skill',
        category: 'NLP',
        author: 'Author',
        stars: 500,
        downloads: '10k',
        tags: ['featured'],
        featured: true,
        url: '',
        lastUpdated: '2026-01-01',
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: featuredSkills })
    );

    const { result } = renderHook(() => useFeaturedSkills());
    expect(result.current.skills).toHaveLength(1);
    expect(result.current.skills[0].featured).toBe(true);
  });
});

describe('useSkillCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
  });

  it('returns empty array when data is null', () => {
    const { result } = renderHook(() => useSkillCategories());
    expect(result.current.categories).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns categories when data is available', () => {
    const categories = [
      { id: 'cat-1', name: 'NLP', count: 50 },
      { id: 'cat-2', name: 'Vision', count: 30 },
    ];
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: categories }));

    const { result } = renderHook(() => useSkillCategories());
    expect(result.current.categories).toHaveLength(2);
    expect(result.current.categories[0].name).toBe('NLP');
  });

  it('calls /skills/categories endpoint', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useSkillCategories());
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toBe('/skills/categories');
  });
});

describe('useSkillsSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());
  });

  it('starts with isSyncing=false and no syncResult', () => {
    const { result } = renderHook(() => useSkillsSync());
    expect(result.current.isSyncing).toBe(false);
    expect(result.current.syncResult).toBeNull();
  });

  it('sets syncResult on successful sync', async () => {
    const syncResponse = {
      success: true,
      message: 'Synced 100 skills',
      skillsCount: 100,
    };
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultPost({ execute: vi.fn().mockResolvedValue(syncResponse) })
    );

    const { result } = renderHook(() => useSkillsSync());
    await act(async () => {
      await result.current.sync();
    });

    expect(result.current.syncResult).toEqual(syncResponse);
    expect(result.current.isSyncing).toBe(false);
  });

  it('sets error syncResult when execute throws', async () => {
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultPost({
        execute: vi.fn().mockRejectedValue(new Error('Sync failed')),
      })
    );

    const { result } = renderHook(() => useSkillsSync());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.sync();
    });

    expect(result.current.syncResult?.success).toBe(false);
    expect((returned as { message: string }).message).toContain('Sync failed');
    expect(result.current.isSyncing).toBe(false);
  });

  it('returns null when execute returns undefined', async () => {
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultPost({ execute: vi.fn().mockResolvedValue(undefined) })
    );

    const { result } = renderHook(() => useSkillsSync());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.sync();
    });

    expect(returned).toBeUndefined();
    expect(result.current.syncResult).toBeNull();
  });
});

describe('useAISkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());
  });

  it('returns null stats when no data', () => {
    const { result } = renderHook(() => useAISkills());
    expect(result.current.stats).toBeNull();
    expect(result.current.skills).toEqual([]);
    expect(result.current.featuredSkills).toEqual([]);
    expect(result.current.timeline).toEqual([]);
  });

  it('isLoading is true when any sub-hook is loading', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ loading: true }));
    const { result } = renderHook(() => useAISkills());
    expect(result.current.isLoading).toBe(true);
  });

  it('sync calls sync function and refreshAll on success', async () => {
    const syncResponse = { success: true, message: 'Synced', skillsCount: 50 };
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultPost({ execute: vi.fn().mockResolvedValue(syncResponse) })
    );
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );

    const { result } = renderHook(() => useAISkills());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.sync();
    });

    expect(returned).toEqual(syncResponse);
    expect(result.current.syncResult).toEqual(syncResponse);
    // refreshAll calls refresh on all sub-hooks
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('sync does not call refreshAll when sync fails', async () => {
    const syncResponse = { success: false, message: 'Failed' };
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultPost({ execute: vi.fn().mockResolvedValue(syncResponse) })
    );
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ refresh: mockRefresh })
    );

    const { result } = renderHook(() => useAISkills());
    await act(async () => {
      await result.current.sync();
    });

    // refresh should NOT have been called on failure
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('passes search params through to useSkillsSearch', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() =>
      useAISkills({ query: 'text-classification', sortBy: 'stars' })
    );
    // One of the useApiGet calls should include search query params
    const calls = vi.mocked(useApiGet).mock.calls.map((c) => c[0]);
    const searchCall = calls.find((url) =>
      url.includes('q=text-classification')
    );
    expect(searchCall).toBeDefined();
  });
});
