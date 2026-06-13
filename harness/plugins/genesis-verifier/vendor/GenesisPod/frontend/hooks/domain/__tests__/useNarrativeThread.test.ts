import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
}));

import { useApiGet } from '@/hooks/core';
import { useNarrativeThread } from '../useNarrativeThread';

const makeGet = (overrides = {}) => ({
  data: undefined,
  loading: false,
  error: null,
  execute: vi.fn(),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

describe('useNarrativeThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null data and loading=false when narrativeId is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet());
    const { result } = renderHook(() => useNarrativeThread('topic-1', null));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns null data and loading=false when topicId is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet());
    const { result } = renderHook(() => useNarrativeThread(null, 'narr-1'));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('passes empty path when either id is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet());
    renderHook(() => useNarrativeThread(null, 'narr-1'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ immediate: false })
    );
  });

  it('builds correct path when both ids provided', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet());
    renderHook(() => useNarrativeThread('topic-1', 'narr-1'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/radar/topics/topic-1/narratives/narr-1',
      expect.any(Object)
    );
  });

  it('returns narrative thread data from API', () => {
    const mockThread = {
      narrativeId: 'narr-1',
      label: 'AI Regulation',
      episodes: [
        {
          date: '2026-05-01',
          signalId: 's-1',
          title: 'Signal A',
          tier: 1 as const,
        },
        {
          date: '2026-05-10',
          signalId: 's-2',
          title: 'Signal B',
          tier: 2 as const,
        },
      ],
    };
    vi.mocked(useApiGet).mockReturnValue(makeGet({ data: mockThread }));
    const { result } = renderHook(() =>
      useNarrativeThread('topic-1', 'narr-1')
    );
    expect(result.current.data).toEqual(mockThread);
    expect(result.current.error).toBeNull();
  });

  it('treats 404 as data=null not an error', () => {
    const notFoundError = { message: 'Not found', status: 404 };
    vi.mocked(useApiGet).mockReturnValue(makeGet({ error: notFoundError }));
    const { result } = renderHook(() =>
      useNarrativeThread('topic-1', 'narr-1')
    );
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('exposes non-404 errors', () => {
    const serverError = { message: 'Internal error', status: 500 };
    vi.mocked(useApiGet).mockReturnValue(makeGet({ error: serverError }));
    const { result } = renderHook(() =>
      useNarrativeThread('topic-1', 'narr-1')
    );
    expect(result.current.error).toBe(serverError);
  });

  it('exposes loading from underlying hook', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet({ loading: true }));
    const { result } = renderHook(() =>
      useNarrativeThread('topic-1', 'narr-1')
    );
    expect(result.current.loading).toBe(true);
  });

  it('passes deps with topicId and narrativeId', () => {
    vi.mocked(useApiGet).mockReturnValue(makeGet());
    renderHook(() => useNarrativeThread('topic-1', 'narr-1'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ deps: ['topic-1', 'narr-1'] })
    );
  });
});
