import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: 'http://test-api',
    apiBaseUrl: 'http://test-api',
    streamApiUrl: 'http://test-stream',
  },
}));
vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockSetCheckpoints = vi.fn();
const mockSetCurrentCheckpointId = vi.fn();
const mockSetCheckpointsLoading = vi.fn();
const mockRestoreFromCheckpointState = vi.fn();
const mockSetError = vi.fn();
const mockSetSession = vi.fn();

vi.mock('@/stores', () => ({
  useSlidesStore: Object.assign(
    vi.fn(() => ({
      checkpoints: [],
      currentCheckpointId: null,
      session: { id: 'session-1' },
      setCheckpoints: mockSetCheckpoints,
      setCurrentCheckpointId: mockSetCurrentCheckpointId,
      setCheckpointsLoading: mockSetCheckpointsLoading,
      restoreFromCheckpointState: mockRestoreFromCheckpointState,
      setError: mockSetError,
      setSession: mockSetSession,
    })),
    {
      getState: vi.fn(() => ({
        session: { id: 'session-1' },
        setCheckpoints: mockSetCheckpoints,
        setCurrentCheckpointId: mockSetCurrentCheckpointId,
        setCheckpointsLoading: mockSetCheckpointsLoading,
        restoreFromCheckpointState: mockRestoreFromCheckpointState,
        setError: mockSetError,
        setSession: mockSetSession,
      })),
    }
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { useAuth } from '@/contexts/AuthContext';

const mockCheckpointState = {
  pages: [
    {
      pageNumber: 1,
      outline: {
        pageNumber: 1,
        title: 'Cover',
        templateType: 'cover',
        purpose: 'cover',
        keyPoints: [],
      },
      html: '<div>test</div>',
      status: 'completed',
    },
  ],
  conversation: [],
};

const mockCheckpoint = {
  id: 'cp-1',
  sessionId: 'session-1',
  name: 'Checkpoint 1',
  type: 'auto_save',
  version: '1',
  timestamp: new Date('2024-01-01'),
  state: mockCheckpointState,
  metadata: { trigger: 'auto' },
};

describe('useCheckpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'test-token',
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);
  });

  // -----------------------------------------------------------------------
  // fetchCheckpoints
  // -----------------------------------------------------------------------

  it('fetchCheckpoints fetches from correct URL using session.id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { checkpoints: [mockCheckpoint] } }),
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    await act(async () => {
      await result.current.fetchCheckpoints();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/ai-office/slides/sessions/session-1/checkpoints',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
    expect(mockSetCheckpoints).toHaveBeenCalledWith([mockCheckpoint]);
  });

  it('fetchCheckpoints uses provided sessionId over store session.id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { checkpoints: [] } }),
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    await act(async () => {
      await result.current.fetchCheckpoints('override-session');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/sessions/override-session/checkpoints'),
      expect.any(Object)
    );
  });

  it('fetchCheckpoints sets loading states (start and end)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { checkpoints: [] } }),
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    await act(async () => {
      await result.current.fetchCheckpoints();
    });

    // setCheckpointsLoading called with true then false
    expect(mockSetCheckpointsLoading).toHaveBeenCalledWith(true);
    expect(mockSetCheckpointsLoading).toHaveBeenCalledWith(false);
  });

  it('fetchCheckpoints calls setError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    await act(async () => {
      await result.current.fetchCheckpoints();
    });

    expect(mockSetError).toHaveBeenCalledWith('Failed to fetch checkpoints');
  });

  it('fetchCheckpoints does nothing when no session id', async () => {
    const { useSlidesStore } = await import('@/stores');
    vi.mocked(useSlidesStore).mockImplementationOnce(
      Object.assign(
        () => ({
          checkpoints: [],
          currentCheckpointId: null,
          session: null,
          setCheckpoints: mockSetCheckpoints,
          setCurrentCheckpointId: mockSetCurrentCheckpointId,
          setCheckpointsLoading: mockSetCheckpointsLoading,
          restoreFromCheckpointState: mockRestoreFromCheckpointState,
          setError: mockSetError,
          setSession: mockSetSession,
        }),
        {
          getState: vi.fn(() => ({
            session: null,
            setSession: mockSetSession,
          })),
        }
      )
    );

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    await act(async () => {
      await result.current.fetchCheckpoints();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // restoreCheckpoint
  // -----------------------------------------------------------------------

  it('restoreCheckpoint fetches checkpoint detail then calls restore API', async () => {
    // 1. GET checkpoint detail
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { state: mockCheckpointState, sessionId: 'session-1' },
        }),
    });
    // 2. POST restore
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { sessionId: 'session-1', sessionTitle: 'Restored' },
        }),
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    await act(async () => {
      await result.current.restoreCheckpoint('cp-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/ai-office/slides/checkpoints/cp-1',
      expect.any(Object)
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/ai-office/slides/restore/cp-1',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockRestoreFromCheckpointState).toHaveBeenCalledWith(
      mockCheckpointState
    );
    expect(mockSetCurrentCheckpointId).toHaveBeenCalledWith('cp-1');
  });

  it('restoreCheckpoint calls onRestoreSuccess callback on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { state: mockCheckpointState } }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessionId: 'session-1' } }),
    });

    const onRestoreSuccess = vi.fn();
    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints({ onRestoreSuccess }));

    await act(async () => {
      await result.current.restoreCheckpoint('cp-1');
    });

    expect(onRestoreSuccess).toHaveBeenCalledWith('cp-1');
  });

  it('restoreCheckpoint calls onRestoreError and rethrows on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const onRestoreError = vi.fn();
    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints({ onRestoreError }));

    await expect(
      act(async () => {
        await result.current.restoreCheckpoint('cp-bad');
      })
    ).rejects.toThrow();

    expect(onRestoreError).toHaveBeenCalledWith(
      'Failed to fetch checkpoint details'
    );
  });

  it('restoreCheckpoint sets restoring=true during operation', async () => {
    let resolveDetail!: (v: unknown) => void;
    const detailPromise = new Promise((r) => {
      resolveDetail = r;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => detailPromise,
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    act(() => {
      void result.current.restoreCheckpoint('cp-1').catch(() => {});
    });

    // restoring should be true while fetch is pending
    expect(result.current.restoring).toBe(true);

    // Resolve to avoid leaks (simulate failure so no second fetch needed)
    resolveDetail({ data: { state: null } });
  });

  // -----------------------------------------------------------------------
  // pruneCheckpoints
  // -----------------------------------------------------------------------

  it('pruneCheckpoints sends POST to correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { prunedCount: 3 } }),
    });
    // fetchCheckpoints is called inside pruneCheckpoints
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { checkpoints: [] } }),
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    let pruned: number | undefined;
    await act(async () => {
      pruned = await result.current.pruneCheckpoints(5);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/ai-office/slides/sessions/session-1/prune?keepCount=5',
      expect.objectContaining({ method: 'POST' })
    );
    expect(pruned).toBe(3);
  });

  it('pruneCheckpoints returns 0 on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('prune failed'));

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    let pruned: number | undefined;
    await act(async () => {
      pruned = await result.current.pruneCheckpoints();
    });

    expect(pruned).toBe(0);
    expect(mockSetError).toHaveBeenCalledWith('prune failed');
  });

  // -----------------------------------------------------------------------
  // createCheckpoint
  // -----------------------------------------------------------------------

  it('createCheckpoint sends POST with correct body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { id: 'new-cp' } }),
    });
    // fetchCheckpoints called after create
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { checkpoints: [] } }),
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    await act(async () => {
      await result.current.createCheckpoint('My Checkpoint');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/ai-office/slides/sessions/session-1/checkpoints',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'My Checkpoint', type: 'user_modified' }),
      })
    );
  });

  it('createCheckpoint calls setError on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    await act(async () => {
      await result.current.createCheckpoint('Fail Checkpoint');
    });

    expect(mockSetError).toHaveBeenCalledWith('Failed to create checkpoint');
  });

  // -----------------------------------------------------------------------
  // getCheckpointPreview / getCheckpointsByType
  // -----------------------------------------------------------------------

  it('getCheckpointPreview returns null when checkpoint not found', async () => {
    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    const preview = result.current.getCheckpointPreview('nonexistent');
    expect(preview).toBeNull();
  });

  it('getCheckpointsByType returns empty array for unknown type', async () => {
    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    const filtered = result.current.getCheckpointsByType('auto_save');
    expect(filtered).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // restoreCheckpoint - second fetch fails (restore API non-ok)
  // -----------------------------------------------------------------------

  it('restoreCheckpoint throws when restore API returns non-ok', async () => {
    // 1. GET checkpoint detail - succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { state: mockCheckpointState } }),
    });
    // 2. POST restore - fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    let didThrow = false;
    await act(async () => {
      try {
        await result.current.restoreCheckpoint('cp-1');
      } catch {
        didThrow = true;
      }
    });

    expect(didThrow).toBe(true);
    expect(mockSetError).toHaveBeenCalledWith('Failed to restore checkpoint');
  });

  // -----------------------------------------------------------------------
  // pruneCheckpoints - non-ok response (different from exception path)
  // -----------------------------------------------------------------------

  it('pruneCheckpoints calls setError when response is non-ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    let pruned: number | undefined;
    await act(async () => {
      pruned = await result.current.pruneCheckpoints();
    });

    expect(pruned).toBe(0);
    expect(mockSetError).toHaveBeenCalledWith('Failed to prune checkpoints');
  });

  // -----------------------------------------------------------------------
  // createCheckpoint - no session (early return path)
  // -----------------------------------------------------------------------

  it('createCheckpoint does nothing when no session id', async () => {
    const { useSlidesStore } = await import('@/stores');
    vi.mocked(useSlidesStore).mockImplementationOnce(
      Object.assign(
        () => ({
          checkpoints: [],
          currentCheckpointId: null,
          session: null,
          setCheckpoints: mockSetCheckpoints,
          setCurrentCheckpointId: mockSetCurrentCheckpointId,
          setCheckpointsLoading: mockSetCheckpointsLoading,
          restoreFromCheckpointState: mockRestoreFromCheckpointState,
          setError: mockSetError,
          setSession: mockSetSession,
        }),
        {
          getState: vi.fn(() => ({
            session: null,
            setSession: mockSetSession,
          })),
        }
      )
    );

    const { useCheckpoints } = await import('../useCheckpoints');
    const { result } = renderHook(() => useCheckpoints());

    await act(async () => {
      await result.current.createCheckpoint('Should not create');
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
