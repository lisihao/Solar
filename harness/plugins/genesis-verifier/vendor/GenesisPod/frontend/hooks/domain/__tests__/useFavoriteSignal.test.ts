import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiPost: vi.fn(),
}));

import { useApiPost } from '@/hooks/core';
import { useFavoriteSignal } from '../useFavoriteSignal';

const makePost = (overrides = {}) => ({
  data: undefined,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

describe('useFavoriteSignal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns isFavorited=false when signalId is null', () => {
    vi.mocked(useApiPost).mockReturnValue(makePost());
    const { result } = renderHook(() => useFavoriteSignal(null, 'topic-1'));
    expect(result.current.isFavorited).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('toggle is noop when signalId is null', async () => {
    const mockExecute = vi.fn();
    vi.mocked(useApiPost).mockReturnValue(makePost({ execute: mockExecute }));
    const { result } = renderHook(() => useFavoriteSignal(null, 'topic-1'));
    await act(async () => {
      await result.current.toggle();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('toggle is noop when topicId is null', async () => {
    const mockExecute = vi.fn();
    vi.mocked(useApiPost).mockReturnValue(makePost({ execute: mockExecute }));
    const { result } = renderHook(() => useFavoriteSignal('s-1', null));
    await act(async () => {
      await result.current.toggle();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('uses correct endpoint for favorites toggle', () => {
    vi.mocked(useApiPost).mockReturnValue(makePost());
    renderHook(() => useFavoriteSignal('s-1', 'topic-1'));
    expect(vi.mocked(useApiPost)).toHaveBeenCalledWith(
      '/radar/favorites/toggle'
    );
  });

  it('optimistically flips isFavorited on toggle', async () => {
    const mockExecute = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves (pending)
    vi.mocked(useApiPost).mockReturnValue(makePost({ execute: mockExecute }));
    const { result } = renderHook(() => useFavoriteSignal('s-1', 'topic-1'));

    expect(result.current.isFavorited).toBe(false);
    act(() => {
      void result.current.toggle();
    });
    expect(result.current.isFavorited).toBe(true);
  });

  it('syncs isFavorited with server response on success', async () => {
    // 后端返回字段是 `favorited`（与 backend favorite.service.ts toggle 返回类型对齐），不是 `isFavorited`
    const mockExecute = vi.fn().mockResolvedValue({ favorited: true });
    vi.mocked(useApiPost).mockReturnValue(makePost({ execute: mockExecute }));
    const { result } = renderHook(() => useFavoriteSignal('s-1', 'topic-1'));

    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.isFavorited).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith({
      signalId: 's-1',
      topicId: 'topic-1',
    });
  });

  it('rolls back isFavorited on request failure', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined); // undefined = failure
    vi.mocked(useApiPost).mockReturnValue(makePost({ execute: mockExecute }));
    const { result } = renderHook(() => useFavoriteSignal('s-1', 'topic-1'));

    await act(async () => {
      await result.current.toggle();
    });
    // Was false before, optimistically set to true, then rolled back to false
    expect(result.current.isFavorited).toBe(false);
  });

  it('reflects loading from useApiPost', () => {
    vi.mocked(useApiPost).mockReturnValue(makePost({ loading: true }));
    const { result } = renderHook(() => useFavoriteSignal('s-1', 'topic-1'));
    expect(result.current.loading).toBe(true);
  });

  it('reflects error from useApiPost', () => {
    const err = { message: 'Network error', status: 503 };
    vi.mocked(useApiPost).mockReturnValue(makePost({ error: err }));
    const { result } = renderHook(() => useFavoriteSignal('s-1', 'topic-1'));
    expect(result.current.error).toBe(err);
  });

  it('isFavorited returns false when signalId is null even with valid topicId', () => {
    vi.mocked(useApiPost).mockReturnValue(makePost());
    const { result } = renderHook(() => useFavoriteSignal(null, 'topic-1'));
    expect(result.current.isFavorited).toBe(false);
  });
});
