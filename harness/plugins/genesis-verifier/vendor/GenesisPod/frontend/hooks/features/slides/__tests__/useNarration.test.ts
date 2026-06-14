import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { NarrationResult } from '../useNarration';

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

const mockNarrationResult = {
  narrations: [
    {
      pageIndex: 0,
      script: 'Welcome to this presentation.',
      estimatedDuration: 5,
    },
    {
      pageIndex: 1,
      script: 'Our main topic today is AI.',
      estimatedDuration: 7,
    },
  ],
  totalDuration: 12,
  stats: { totalPages: 2, totalWords: 12, averageWordsPerPage: 6 },
};

describe('useNarration', () => {
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
  // generateNarrations
  // -----------------------------------------------------------------------

  it('generateNarrations sends POST to correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockNarrationResult }),
    });

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    await act(async () => {
      await result.current.generateNarrations('mission-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/narrations/mission-1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
        body: JSON.stringify({}),
      })
    );
  });

  it('generateNarrations returns NarrationResult on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockNarrationResult }),
    });

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    let narrationResult: NarrationResult | null = null;
    await act(async () => {
      narrationResult = await result.current.generateNarrations('mission-1');
    });

    expect(narrationResult).toEqual(mockNarrationResult);
  });

  it('generateNarrations sends options in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockNarrationResult }),
    });

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    const options = { style: 'formal' as const, language: 'zh' as const };
    await act(async () => {
      await result.current.generateNarrations('mission-1', options);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify(options) })
    );
  });

  it('generateNarrations returns null and sets error when user not logged in', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    let narrationResult: unknown;
    await act(async () => {
      narrationResult = await result.current.generateNarrations('mission-1');
    });

    expect(narrationResult).toBeNull();
    expect(result.current.error).toBe('User not authenticated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('generateNarrations returns null and sets error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Server error' }),
    });

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    let narrationResult: unknown;
    await act(async () => {
      narrationResult = await result.current.generateNarrations('mission-1');
    });

    expect(narrationResult).toBeNull();
    expect(result.current.error).toBe('Server error');
  });

  // -----------------------------------------------------------------------
  // getNarrations
  // -----------------------------------------------------------------------

  it('getNarrations sends GET to correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockNarrationResult }),
    });

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    await act(async () => {
      await result.current.getNarrations('mission-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/narrations/mission-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('getNarrations returns NarrationResult on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockNarrationResult }),
    });

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    let narrationResult: NarrationResult | null = null;
    await act(async () => {
      narrationResult = await result.current.getNarrations('mission-1');
    });

    expect(narrationResult).toEqual(mockNarrationResult);
  });

  it('getNarrations returns default empty result on 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    let narrationResult: unknown;
    await act(async () => {
      narrationResult = await result.current.getNarrations(
        'mission-no-narrations'
      );
    });

    expect(narrationResult).toEqual({ narrations: [], totalDuration: 0 });
    expect(result.current.error).toBeNull();
  });

  it('getNarrations returns null and sets error when user not logged in', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    let narrationResult: unknown;
    await act(async () => {
      narrationResult = await result.current.getNarrations('mission-1');
    });

    expect(narrationResult).toBeNull();
    expect(result.current.error).toBe('User not authenticated');
  });

  it('getNarrations returns null and sets error on non-404 API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    let narrationResult: unknown;
    await act(async () => {
      narrationResult = await result.current.getNarrations('mission-1');
    });

    expect(narrationResult).toBeNull();
    expect(result.current.error).toBe('Failed to get narrations');
  });

  it('sets loading=false after generateNarrations completes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockNarrationResult }),
    });

    const { useNarration } = await import('../useNarration');
    const { result } = renderHook(() => useNarration());

    await act(async () => {
      await result.current.generateNarrations('mission-1');
    });

    expect(result.current.loading).toBe(false);
  });
});
