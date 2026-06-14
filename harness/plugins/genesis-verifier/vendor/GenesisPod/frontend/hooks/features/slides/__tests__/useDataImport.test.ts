import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { SourceListItem, SlidesSourceData, Asset } from '../useDataImport';

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

const mockSourceItem = {
  id: 'source-1',
  title: 'Test Source',
  type: 'research' as const,
  createdAt: '2024-01-01T00:00:00Z',
};

const mockSourceData = {
  sourceText: 'This is the source content.',
  sourceType: 'research' as const,
  sourceId: 'source-1',
  sections: [],
};

const mockAsset = {
  id: 'asset-1',
  type: 'image' as const,
  url: 'https://example.com/image.png',
  title: 'Test Image',
};

describe('useDataImport', () => {
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
  // fetchSources
  // -----------------------------------------------------------------------

  it('fetchSources sends GET to correct URL with type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sources: [mockSourceItem] } }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    await act(async () => {
      await result.current.fetchSources('research');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/sources/research',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('fetchSources returns sources from data.sources', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { sources: [mockSourceItem] } }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let sources: SourceListItem[] = [];
    await act(async () => {
      sources = await result.current.fetchSources('research');
    });

    expect(sources).toEqual([mockSourceItem]);
  });

  it('fetchSources returns sources from top-level sources key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sources: [mockSourceItem] }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let sources: SourceListItem[] = [];
    await act(async () => {
      sources = await result.current.fetchSources('writing');
    });

    expect(sources).toEqual([mockSourceItem]);
  });

  it('fetchSources returns empty array when user not logged in', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let sources: unknown[] = [];
    await act(async () => {
      sources = await result.current.fetchSources('research');
    });

    expect(sources).toEqual([]);
    expect(result.current.error).toBe('User not authenticated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetchSources returns empty array and sets error on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let sources: unknown[] = [];
    await act(async () => {
      sources = await result.current.fetchSources('research');
    });

    expect(sources).toEqual([]);
    expect(result.current.error).toBe('Failed to fetch research sources');
  });

  // -----------------------------------------------------------------------
  // importFromResearch
  // -----------------------------------------------------------------------

  it('importFromResearch sends POST to correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { data: mockSourceData } }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    await act(async () => {
      await result.current.importFromResearch('topic-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/import/research/topic-1',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('importFromResearch returns data on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { data: mockSourceData } }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let importResult: SlidesSourceData | null = null;
    await act(async () => {
      importResult = await result.current.importFromResearch('topic-1');
    });

    expect(importResult).toEqual(mockSourceData);
  });

  it('importFromResearch returns null and sets error when user not logged in', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let importResult: unknown;
    await act(async () => {
      importResult = await result.current.importFromResearch('topic-1');
    });

    expect(importResult).toBeNull();
    expect(result.current.error).toBe('User not authenticated');
  });

  // -----------------------------------------------------------------------
  // importFromWriting
  // -----------------------------------------------------------------------

  it('importFromWriting sends POST to correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { data: mockSourceData } }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    await act(async () => {
      await result.current.importFromWriting('project-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/import/writing/project-1',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('importFromWriting returns null on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let importResult: unknown;
    await act(async () => {
      importResult = await result.current.importFromWriting('project-bad');
    });

    expect(importResult).toBeNull();
    expect(result.current.error).toBe('Failed to import from writing');
  });

  // -----------------------------------------------------------------------
  // importFromTeams
  // -----------------------------------------------------------------------

  it('importFromTeams sends POST to correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { data: mockSourceData } }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    await act(async () => {
      await result.current.importFromTeams('teams-topic-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/import/teams/teams-topic-1',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('importFromTeams returns null and sets error when user not logged in', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let importResult: unknown;
    await act(async () => {
      importResult = await result.current.importFromTeams('topic-1');
    });

    expect(importResult).toBeNull();
    expect(result.current.error).toBe('User not authenticated');
  });

  // -----------------------------------------------------------------------
  // importFromResearchProject
  // -----------------------------------------------------------------------

  it('importFromResearchProject sends POST to correct URL without outputId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { data: mockSourceData } }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    await act(async () => {
      await result.current.importFromResearchProject('project-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/import/research-project/project-1',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('importFromResearchProject includes outputId in query string when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { data: mockSourceData } }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    await act(async () => {
      await result.current.importFromResearchProject('project-1', 'output-42');
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('outputId=output-42');
  });

  // -----------------------------------------------------------------------
  // importFromLibrary
  // -----------------------------------------------------------------------

  it('importFromLibrary sends POST to correct URL with resourceIds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { assets: [mockAsset] } }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    await act(async () => {
      await result.current.importFromLibrary(['res-1', 'res-2']);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/import/library',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ resourceIds: ['res-1', 'res-2'] }),
      })
    );
  });

  it('importFromLibrary returns assets on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { assets: [mockAsset] } }),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let assets: Asset[] = [];
    await act(async () => {
      assets = await result.current.importFromLibrary(['res-1']);
    });

    expect(assets).toEqual([mockAsset]);
  });

  it('importFromLibrary returns empty array and sets error on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let assets: unknown[] = [];
    await act(async () => {
      assets = await result.current.importFromLibrary(['res-bad']);
    });

    expect(assets).toEqual([]);
    expect(result.current.error).toBe('Failed to import from library');
  });

  it('importFromLibrary returns empty array when user not logged in', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    const { useDataImport } = await import('../useDataImport');
    const { result } = renderHook(() => useDataImport());

    let assets: unknown[] = [];
    await act(async () => {
      assets = await result.current.importFromLibrary(['res-1']);
    });

    expect(assets).toEqual([]);
    expect(result.current.error).toBe('User not authenticated');
  });
});
