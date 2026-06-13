import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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

describe('useThemes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns loading=true initially', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => new Promise(() => {}), // never resolves
    });

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());
    expect(result.current.loading).toBe(true);
  });

  it('fetches themes from correct URL', async () => {
    const mockThemes = [
      {
        id: 'theme-1',
        name: 'Test Theme',
        description: 'A test theme',
        preview: 'linear-gradient(135deg, #000 0%, #fff 100%)',
        colors: { primary: '#000', accent: '#fff', text: '#aaa' },
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { themes: mockThemes } }),
    });

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/ai-office/slides/themes/list'
    );
    expect(result.current.themes).toEqual(mockThemes);
  });

  it('handles top-level themes property (data.themes)', async () => {
    const mockThemes = [
      {
        id: 'theme-top',
        name: 'Top Theme',
        description: 'Top level',
        preview: 'linear-gradient(135deg, #111 0%, #222 100%)',
        colors: { primary: '#111', accent: '#222', text: '#333' },
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ themes: mockThemes }),
    });

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.themes).toEqual(mockThemes);
  });

  it('falls back to FALLBACK_THEMES on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.themes).toHaveLength(5);
    expect(result.current.themes[0].id).toBe('genspark-dark');
  });

  it('falls back to FALLBACK_THEMES when API returns empty themes array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { themes: [] } }),
    });

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.themes).toHaveLength(5);
    expect(result.current.themes[0].id).toBe('genspark-dark');
  });

  it('falls back to FALLBACK_THEMES when API returns null data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(null),
    });

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.themes).toHaveLength(5);
  });

  it('falls back to FALLBACK_THEMES when response has no themes key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    });

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.themes).toHaveLength(5);
  });

  it('sets loading=false after successful fetch', async () => {
    const mockThemes = [
      {
        id: 'theme-1',
        name: 'T1',
        description: 'D1',
        preview: 'linear-gradient(135deg, #000 0%, #111 100%)',
        colors: { primary: '#000', accent: '#111', text: '#222' },
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { themes: mockThemes } }),
    });

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.themes).toEqual(mockThemes);
  });

  it('sets loading=false after failed fetch', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'));

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('FALLBACK_THEMES contains the expected theme IDs', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const ids = result.current.themes.map((t) => t.id);
    expect(ids).toContain('genspark-dark');
    expect(ids).toContain('tech-purple');
    expect(ids).toContain('executive-white');
    expect(ids).toContain('nature-green');
    expect(ids).toContain('warm-sunset');
  });

  it('uses API themes when list is non-empty', async () => {
    const apiThemes = [
      {
        id: 'api-theme',
        name: 'API Theme',
        description: 'From API',
        preview: 'linear-gradient(135deg, #abc 0%, #def 100%)',
        colors: { primary: '#abc', accent: '#def', text: '#fed' },
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { themes: apiThemes } }),
    });

    const { useThemes } = await import('../useThemes');
    const { result } = renderHook(() => useThemes());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should use API themes, not fallback
    expect(result.current.themes).toEqual(apiThemes);
    expect(result.current.themes[0].id).toBe('api-theme');
  });
});
