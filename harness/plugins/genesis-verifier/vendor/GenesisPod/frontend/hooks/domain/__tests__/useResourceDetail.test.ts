import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiPost: vi.fn(),
}));

import { useApiGet, useApiPut, useApiDelete, useApiPost } from '@/hooks/core';
import { useResourceDetail } from '../useResourceDetail';

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

describe('useResourceDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null resource and loading:false in initial state', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    expect(result.current.resource).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.isDeleting).toBe(false);
    expect(result.current.isSummarizing).toBe(false);
    expect(result.current.isTranslating).toBe(false);
  });

  it('returns resource data when API responds', () => {
    const mockResource = {
      id: 'r-1',
      title: 'Test Resource',
      type: 'article',
      status: 'completed' as const,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: mockResource })
    );
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    expect(result.current.resource).toEqual(mockResource);
  });

  it('calls the correct API endpoint with the given id', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResourceDetail({ id: 'r-42' }));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/api/resources/r-42',
      expect.objectContaining({ immediate: true })
    );
  });

  it('reflects loading state during fetch', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ loading: true }));
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    expect(result.current.loading).toBe(true);
  });

  it('reflects error state from useApiGet', () => {
    const mockError = new Error('Not found');
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ error: mockError as never })
    );
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    expect(result.current.error).toBe(mockError);
  });

  it('update calls updateApi and then refresh when result is returned', async () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    const mockUpdateExecute = vi
      .fn()
      .mockResolvedValue({ id: 'r-1', title: 'Updated' });

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockRefresh })
    );
    vi.mocked(useApiPut).mockReturnValue(
      makeDefaultMutation({ execute: mockUpdateExecute })
    );
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    await act(async () => {
      await result.current.update({ title: 'Updated' });
    });
    expect(mockUpdateExecute).toHaveBeenCalledWith({ title: 'Updated' });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('update does not call refresh when updateApi returns undefined', async () => {
    const mockRefresh = vi.fn();
    const mockUpdateExecute = vi.fn().mockResolvedValue(undefined);

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockRefresh })
    );
    vi.mocked(useApiPut).mockReturnValue(
      makeDefaultMutation({ execute: mockUpdateExecute })
    );
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    await act(async () => {
      await result.current.update({ title: 'Updated' });
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('remove calls deleteApi', async () => {
    const mockDeleteExecute = vi.fn().mockResolvedValue(undefined);

    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(
      makeDefaultMutation({ execute: mockDeleteExecute })
    );
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    await act(async () => {
      await result.current.remove();
    });
    expect(mockDeleteExecute).toHaveBeenCalledTimes(1);
  });

  it('summarize calls summarizeApi and refresh when result is returned', async () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    const mockSummarizeExecute = vi
      .fn()
      .mockResolvedValue({ summary: 'A brief summary.' });

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockRefresh })
    );
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultMutation({ execute: mockSummarizeExecute })
    );

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    let summaryResult: unknown;
    await act(async () => {
      summaryResult = await result.current.summarize();
    });
    expect(summaryResult).toEqual({ summary: 'A brief summary.' });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('translate calls translateApi with targetLang', async () => {
    const mockTranslateExecute = vi
      .fn()
      .mockResolvedValue({ content: 'Translated content' });

    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    // useApiPost is called twice: summarize + translate; return different mocks per call
    let postCallCount = 0;
    vi.mocked(useApiPost).mockImplementation(() => {
      postCallCount++;
      if (postCallCount === 2)
        return makeDefaultMutation({ execute: mockTranslateExecute });
      return makeDefaultMutation();
    });

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    let translateResult: unknown;
    await act(async () => {
      translateResult = await result.current.translate('zh');
    });
    expect(mockTranslateExecute).toHaveBeenCalledWith({ targetLang: 'zh' });
    expect(translateResult).toEqual({ content: 'Translated content' });
  });

  it('isUpdating reflects put loading state', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(
      makeDefaultMutation({ loading: true })
    );
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    expect(result.current.isUpdating).toBe(true);
  });

  it('isDeleting reflects delete loading state', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(
      makeDefaultMutation({ loading: true })
    );
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    expect(result.current.isDeleting).toBe(true);
  });

  it('uses immediate=false when immediate option is false', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResourceDetail({ id: 'r-1', immediate: false }));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/api/resources/r-1',
      expect.objectContaining({ immediate: false })
    );
  });

  it('exposes refresh function from useApiGet execute', () => {
    const mockExecute = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    expect(result.current.refresh).toBe(mockExecute);
  });

  it('uses put endpoint with the provided id', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResourceDetail({ id: 'r-99' }));
    expect(vi.mocked(useApiPut)).toHaveBeenCalledWith('/api/resources/r-99');
  });

  it('uses delete endpoint with the provided id', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResourceDetail({ id: 'r-55' }));
    expect(vi.mocked(useApiDelete)).toHaveBeenCalledWith('/api/resources/r-55');
  });

  it('isSummarizing reflects post loading state', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    // First post call is summarize, second is translate
    let postCount = 0;
    vi.mocked(useApiPost).mockImplementation(() => {
      postCount++;
      if (postCount === 1) return makeDefaultMutation({ loading: true });
      return makeDefaultMutation();
    });

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    expect(result.current.isSummarizing).toBe(true);
  });

  it('isTranslating reflects second post loading state', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    let postCount = 0;
    vi.mocked(useApiPost).mockImplementation(() => {
      postCount++;
      if (postCount === 2) return makeDefaultMutation({ loading: true });
      return makeDefaultMutation();
    });

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    expect(result.current.isTranslating).toBe(true);
  });

  it('summarize does not call refresh when summarizeApi returns undefined', async () => {
    const mockRefresh = vi.fn();
    const mockSummarizeExecute = vi.fn().mockResolvedValue(undefined);

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockRefresh })
    );
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultMutation({ execute: mockSummarizeExecute })
    );

    const { result } = renderHook(() => useResourceDetail({ id: 'r-1' }));
    await act(async () => {
      await result.current.summarize();
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('summarize endpoint uses resource id in path', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResourceDetail({ id: 'r-77' }));
    const postCalls = vi.mocked(useApiPost).mock.calls.map((c) => c[0]);
    expect(postCalls).toContain('/api/resources/r-77/summarize');
    expect(postCalls).toContain('/api/resources/r-77/translate');
  });
});
