import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
}));

import { useApiGet } from '@/hooks/core';
import { useDailyBriefing } from '../useDailyBriefing';

const makeGet = (overrides = {}) => ({
  data: undefined,
  loading: false,
  error: null,
  execute: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

describe('useDailyBriefing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null data and loading=false when topicId is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet());
    const { result } = renderHook(() => useDailyBriefing(null));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('passes immediate=false when topicId is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet());
    renderHook(() => useDailyBriefing(null));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ immediate: false })
    );
  });

  it('builds correct path without date', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet());
    renderHook(() => useDailyBriefing('topic-1'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/radar/topics/topic-1/daily-briefing',
      expect.any(Object)
    );
  });

  it('appends date query param when provided', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet());
    renderHook(() => useDailyBriefing('topic-1', '2026-05-18'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/radar/topics/topic-1/daily-briefing?date=2026-05-18',
      expect.any(Object)
    );
  });

  it('returns data from API response', () => {
    const mockBriefing = {
      id: 'b-1',
      topicId: 'topic-1',
      briefingDate: '2026-05-18',
      status: 'completed' as const,
      signals: [],
    };
    vi.mocked(useApiGet).mockReturnValue(makeGet({ data: mockBriefing }));
    const { result } = renderHook(() => useDailyBriefing('topic-1'));
    expect(result.current.data).toEqual(mockBriefing);
  });

  it('exposes loading state from underlying hook', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet({ loading: true }));
    const { result } = renderHook(() => useDailyBriefing('topic-1'));
    expect(result.current.loading).toBe(true);
  });

  it('exposes error state from underlying hook', () => {
    const err = { message: 'Server error', status: 500 };
    vi.mocked(useApiGet).mockReturnValue(makeGet({ error: err }));
    const { result } = renderHook(() => useDailyBriefing('topic-1'));
    expect(result.current.error).toBe(err);
  });

  it('refresh calls apiRefresh when topicId is provided', async () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(makeGet({ refresh: mockRefresh }));
    const { result } = renderHook(() => useDailyBriefing('topic-1'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('refresh is noop when topicId is null', async () => {
    const mockRefresh = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(makeGet({ refresh: mockRefresh }));
    const { result } = renderHook(() => useDailyBriefing(null));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('passes deps containing topicId and date', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet());
    renderHook(() => useDailyBriefing('topic-1', '2026-05-18'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ deps: ['topic-1', '2026-05-18'] })
    );
  });
});
