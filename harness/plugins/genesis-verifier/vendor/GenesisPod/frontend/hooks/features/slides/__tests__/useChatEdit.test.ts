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

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { useAuth } from '@/contexts/AuthContext';

const mockChatEditResult = {
  success: true,
  updatedHtml: '<div>Updated</div>',
  reply: 'I have updated the slide.',
};

describe('useChatEdit', () => {
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

  it('sends POST to correct relative URL with auth header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { data: mockChatEditResult } }),
    });

    const { useChatEdit } = await import('../useChatEdit');
    const { result } = renderHook(() => useChatEdit());

    await act(async () => {
      await result.current.chatEdit('session-1', 0, 'Make it red');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/sessions/session-1/chat-edit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ instruction: 'Make it red', pageIndex: 0 }),
      })
    );
  });

  it('unwraps double-wrapped response (result.data.data)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { data: mockChatEditResult } }),
    });

    const { useChatEdit } = await import('../useChatEdit');
    const { result } = renderHook(() => useChatEdit());

    let editResult: typeof mockChatEditResult | null = null;
    await act(async () => {
      editResult = await result.current.chatEdit('session-1', 0, 'test');
    });

    expect(editResult).toEqual(mockChatEditResult);
  });

  it('unwraps single-wrapped response (result.data) when data.data is absent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockChatEditResult }),
    });

    const { useChatEdit } = await import('../useChatEdit');
    const { result } = renderHook(() => useChatEdit());

    let editResult: typeof mockChatEditResult | null = null;
    await act(async () => {
      editResult = await result.current.chatEdit('session-1', 0, 'test');
    });

    expect(editResult).toEqual(mockChatEditResult);
  });

  it('returns null and sets error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve('Chat edit failed'),
    });

    const { useChatEdit } = await import('../useChatEdit');
    const { result } = renderHook(() => useChatEdit());

    let editResult: unknown;
    await act(async () => {
      editResult = await result.current.chatEdit('session-1', 0, 'test');
    });

    expect(editResult).toBeNull();
    expect(result.current.error).toBe('Chat edit failed');
  });

  it('returns null and sets error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { useChatEdit } = await import('../useChatEdit');
    const { result } = renderHook(() => useChatEdit());

    let editResult: unknown;
    await act(async () => {
      editResult = await result.current.chatEdit('session-1', 0, 'test');
    });

    expect(editResult).toBeNull();
    expect(result.current.error).toBe('Network error');
  });

  it('sets loading=true during request and false after', async () => {
    let resolveJson!: (v: unknown) => void;
    const jsonPromise = new Promise((r) => {
      resolveJson = r;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => jsonPromise,
    });

    const { useChatEdit } = await import('../useChatEdit');
    const { result } = renderHook(() => useChatEdit());

    expect(result.current.loading).toBe(false);

    act(() => {
      void result.current.chatEdit('session-1', 0, 'test');
    });

    expect(result.current.loading).toBe(true);

    resolveJson({ data: { data: mockChatEditResult } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.loading).toBe(false);
  });

  it('clears previous error on new request', async () => {
    // First call — fail
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve('First error'),
    });

    const { useChatEdit } = await import('../useChatEdit');
    const { result } = renderHook(() => useChatEdit());

    await act(async () => {
      await result.current.chatEdit('session-1', 0, 'first');
    });

    expect(result.current.error).toBe('First error');

    // Second call — succeed
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { data: mockChatEditResult } }),
    });

    await act(async () => {
      await result.current.chatEdit('session-1', 0, 'second');
    });

    expect(result.current.error).toBeNull();
  });

  it('includes auth token in Authorization header', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'special-token-xyz',
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockChatEditResult }),
    });

    const { useChatEdit } = await import('../useChatEdit');
    const { result } = renderHook(() => useChatEdit());

    await act(async () => {
      await result.current.chatEdit('session-1', 2, 'test');
    });

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['Authorization']).toBe('Bearer special-token-xyz');
  });
});
