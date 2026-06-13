import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

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

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { useAuth } from '@/contexts/AuthContext';

const mockSession = {
  id: 'session-1',
  userId: 'user-1',
  title: 'Test Session',
  status: 'active' as const,
  currentCheckpointId: 'cp-1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  latestCheckpoint: null,
};

describe('useSessions', () => {
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

  it('auto-loads sessions on mount when autoLoad=true (default)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [mockSession] } }),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/ai-office/slides/sessions'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
    expect(result.current.sessions).toHaveLength(1);
  });

  it('does not auto-load when autoLoad=false', async () => {
    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions({ autoLoad: false }));

    // Small wait to ensure no fetch was triggered
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.sessions).toHaveLength(0);
  });

  it('does not load when user is not logged in', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions());

    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.sessions).toHaveLength(0);
  });

  it('loadSessions sends correct request URL with default limit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [] } }),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions({ autoLoad: false }));

    await act(async () => {
      await result.current.loadSessions();
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/ai-office/slides/sessions');
    expect(calledUrl).toContain('limit=50');
  });

  it('loadSessions sends status param when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [] } }),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() =>
      useSessions({ autoLoad: false, status: 'active' })
    );

    await act(async () => {
      await result.current.loadSessions();
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('status=active');
  });

  it('loadSessions converts date strings to Date objects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [mockSession] } }),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions({ autoLoad: false }));

    await act(async () => {
      await result.current.loadSessions();
    });

    expect(result.current.sessions[0].createdAt).toBeInstanceOf(Date);
    expect(result.current.sessions[0].updatedAt).toBeInstanceOf(Date);
  });

  it('loadSessions handles wrapped response (result.data.sessions)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [mockSession] } }),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions({ autoLoad: false }));

    await act(async () => {
      await result.current.loadSessions();
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).toBe('session-1');
  });

  it('loadSessions sets error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions({ autoLoad: false }));

    await act(async () => {
      await result.current.loadSessions();
    });

    expect(result.current.error).toBe('Failed to load sessions');
  });

  it('loadSessions sets error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions({ autoLoad: false }));

    await act(async () => {
      await result.current.loadSessions();
    });

    expect(result.current.error).toBe('Network error');
  });

  it('updateSession sends PATCH to correct URL with title', async () => {
    // First call for auto-load
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [mockSession] } }),
    });
    // Second call for update
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.loading).toBe(false));

    let updateResult: boolean;
    await act(async () => {
      updateResult = await result.current.updateSession(
        'session-1',
        'New Title'
      );
    });

    expect(updateResult!).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/ai-office/slides/sessions/session-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'New Title' }),
      })
    );
  });

  it('updateSession updates local state on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [mockSession] } }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateSession('session-1', 'Updated Title');
    });

    expect(result.current.sessions[0].title).toBe('Updated Title');
  });

  it('updateSession returns false on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [] } }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.loading).toBe(false));

    let updateResult: boolean;
    await act(async () => {
      updateResult = await result.current.updateSession('session-x', 'Fail');
    });

    expect(updateResult!).toBe(false);
    expect(result.current.error).toBe('Failed to update session');
  });

  it('deleteSession sends DELETE to correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [mockSession] } }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.loading).toBe(false));

    let deleteResult: boolean;
    await act(async () => {
      deleteResult = await result.current.deleteSession('session-1');
    });

    expect(deleteResult!).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/ai-office/slides/sessions/session-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('deleteSession removes session from local state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [mockSession] } }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      await result.current.deleteSession('session-1');
    });

    expect(result.current.sessions).toHaveLength(0);
  });

  it('deleteSession returns false on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sessions: [] } }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.loading).toBe(false));

    let deleteResult: boolean;
    await act(async () => {
      deleteResult = await result.current.deleteSession('session-x');
    });

    expect(deleteResult!).toBe(false);
    expect(result.current.error).toBe('Failed to delete session');
  });

  it('sets loading state during loadSessions', async () => {
    let resolveJson!: (v: unknown) => void;
    const jsonPromise = new Promise((resolve) => {
      resolveJson = resolve;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => jsonPromise,
    });

    const { useSessions } = await import('../useSessions');
    const { result } = renderHook(() => useSessions({ autoLoad: false }));

    expect(result.current.loading).toBe(false);

    act(() => {
      void result.current.loadSessions();
    });

    await waitFor(() => expect(result.current.loading).toBe(true));

    resolveJson({ data: { sessions: [] } });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
