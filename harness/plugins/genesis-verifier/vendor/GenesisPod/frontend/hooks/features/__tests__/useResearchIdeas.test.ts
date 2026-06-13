import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/utils/config', () => ({
  config: {
    apiBaseUrl: 'http://test-api',
    apiUrl: 'http://test-api',
    streamApiUrl: 'http://test-stream',
  },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getAuthHeader } from '@/lib/utils/auth';
import { useResearchIdeas, ResearchIdea } from '../useResearchIdeas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIdea(overrides: Partial<ResearchIdea> = {}): ResearchIdea {
  return {
    id: 'idea-1',
    projectId: 'project-1',
    sessionId: null,
    title: 'Test Idea',
    description: 'Test description',
    type: 'INSIGHT',
    sourceInsightId: null,
    sourceMessageId: null,
    agentRole: null,
    agentName: null,
    status: 'DISCOVERED',
    tags: [],
    evidence: null,
    metadata: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function mockJsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(data),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useResearchIdeas', () => {
  const PROJECT_ID = 'project-123';
  const AUTH_HEADER = { Authorization: 'Bearer test-token' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthHeader).mockReturnValue(AUTH_HEADER);
    // Default: return empty ideas list on mount fetch
    mockFetch.mockResolvedValue(mockJsonResponse([]));
  });

  // -------------------------------------------------------------------------
  // Auto-fetch on mount
  // -------------------------------------------------------------------------

  describe('auto-fetch on mount', () => {
    it('auto-fetches ideas on mount when projectId is provided', async () => {
      const ideas = [makeIdea()];
      mockFetch.mockResolvedValueOnce(mockJsonResponse(ideas));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));

      await waitFor(() => {
        expect(result.current.ideas).toEqual(ideas);
      });

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('does not fetch when projectId is empty', () => {
      renderHook(() => useResearchIdeas(''));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sets isLoading true during fetch then false after', async () => {
      let resolveJson!: (v: unknown) => void;
      const jsonPromise = new Promise((res) => {
        resolveJson = res;
      });
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => jsonPromise });

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));

      // Should be loading right after mount
      expect(result.current.isLoading).toBe(true);

      act(() => {
        resolveJson([]);
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  // fetchIdeas
  // -------------------------------------------------------------------------

  describe('fetchIdeas', () => {
    it('makes GET request to correct URL with auth header', async () => {
      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce(mockJsonResponse([]));

      await act(async () => {
        await result.current.fetchIdeas();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/ideas`,
        expect.objectContaining({
          headers: expect.objectContaining(AUTH_HEADER),
        })
      );
    });

    it('appends type query param when type is provided', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse([]));

      const { result } = renderHook(() =>
        useResearchIdeas(PROJECT_ID, 'INSIGHT')
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/ideas?type=INSIGHT`,
        expect.anything()
      );
    });

    it('does not append type query param when type is undefined', async () => {
      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).not.toContain('?type=');
    });

    it('populates ideas from data wrapper in response', async () => {
      const ideas = [makeIdea({ id: 'idea-wrapped' })];
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ data: ideas }));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));

      await waitFor(() => {
        expect(result.current.ideas).toEqual(ideas);
      });
    });

    it('sets error state when fetch returns non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse(null, false));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to fetch ideas');
      });
    });

    it('sets error state when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));

      await waitFor(() => {
        expect(result.current.error).toBe('Network failure');
      });
    });

    it('ignores AbortError and does not set error state', async () => {
      const abortError = new DOMException('Aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // AbortController cleanup
  // -------------------------------------------------------------------------

  describe('AbortController cleanup', () => {
    it('aborts the in-flight request on unmount', () => {
      let capturedSignal: AbortSignal | undefined;
      mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
        capturedSignal = opts.signal as AbortSignal;
        // Never resolve to simulate in-flight request
        return new Promise(() => {});
      });

      const { unmount } = renderHook(() => useResearchIdeas(PROJECT_ID));

      // Signal should not be aborted yet
      expect(capturedSignal?.aborted).toBe(false);

      unmount();

      // After unmount the signal should be aborted
      expect(capturedSignal?.aborted).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // createIdea
  // -------------------------------------------------------------------------

  describe('createIdea', () => {
    it('makes POST request to correct URL', async () => {
      const newIdea = makeIdea({ id: 'idea-new' });
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([])) // initial fetch
        .mockResolvedValueOnce(mockJsonResponse(newIdea)); // create

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.createIdea({
          title: 'New Idea',
          description: 'Desc',
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/ideas`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('adds the new idea to the front of the local state', async () => {
      const existing = makeIdea({ id: 'idea-existing' });
      const newIdea = makeIdea({ id: 'idea-new', title: 'Brand New' });

      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([existing]))
        .mockResolvedValueOnce(mockJsonResponse(newIdea));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.ideas).toHaveLength(1));

      await act(async () => {
        await result.current.createIdea({
          title: 'Brand New',
          description: '',
        });
      });

      expect(result.current.ideas[0].id).toBe('idea-new');
      expect(result.current.ideas).toHaveLength(2);
    });

    it('returns the created idea on success', async () => {
      const newIdea = makeIdea({ id: 'idea-created' });
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([]))
        .mockResolvedValueOnce(mockJsonResponse(newIdea));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: ResearchIdea | null = null;
      await act(async () => {
        returned = await result.current.createIdea({
          title: 'New',
          description: '',
        });
      });

      expect(returned).toEqual(newIdea);
    });

    it('returns null when POST fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([]))
        .mockResolvedValueOnce(mockJsonResponse(null, false));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: ResearchIdea | null =
        undefined as unknown as ResearchIdea | null;
      await act(async () => {
        returned = await result.current.createIdea({
          title: 'New',
          description: '',
        });
      });

      expect(returned).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // updateIdea
  // -------------------------------------------------------------------------

  describe('updateIdea', () => {
    it('makes PATCH request to correct URL', async () => {
      const idea = makeIdea();
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([idea]))
        .mockResolvedValueOnce(mockJsonResponse({ ...idea, title: 'Updated' }));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.ideas).toHaveLength(1));

      await act(async () => {
        await result.current.updateIdea('idea-1', { title: 'Updated' });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/ideas/idea-1`,
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('updates the idea in local state', async () => {
      const idea = makeIdea();
      const updated = { ...idea, title: 'Updated Title' };

      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([idea]))
        .mockResolvedValueOnce(mockJsonResponse(updated));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.ideas).toHaveLength(1));

      await act(async () => {
        await result.current.updateIdea('idea-1', { title: 'Updated Title' });
      });

      expect(result.current.ideas[0].title).toBe('Updated Title');
    });

    it('returns null when PATCH fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([]))
        .mockResolvedValueOnce(mockJsonResponse(null, false));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: ResearchIdea | null =
        undefined as unknown as ResearchIdea | null;
      await act(async () => {
        returned = await result.current.updateIdea('idea-1', {
          title: 'X',
        });
      });

      expect(returned).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // deleteIdea
  // -------------------------------------------------------------------------

  describe('deleteIdea', () => {
    it('makes DELETE request to correct URL', async () => {
      const idea = makeIdea();
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([idea]))
        .mockResolvedValueOnce(mockJsonResponse(null));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.ideas).toHaveLength(1));

      await act(async () => {
        await result.current.deleteIdea('idea-1');
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/ideas/idea-1`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('removes the idea from local state on success', async () => {
      const idea = makeIdea();
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([idea]))
        .mockResolvedValueOnce(mockJsonResponse(null));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.ideas).toHaveLength(1));

      await act(async () => {
        await result.current.deleteIdea('idea-1');
      });

      expect(result.current.ideas).toHaveLength(0);
    });

    it('returns true on successful delete', async () => {
      const idea = makeIdea();
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([idea]))
        .mockResolvedValueOnce(mockJsonResponse(null));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.deleteIdea('idea-1');
      });

      expect(returned).toBe(true);
    });

    it('returns false when DELETE fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([]))
        .mockResolvedValueOnce(mockJsonResponse(null, false));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.deleteIdea('idea-1');
      });

      expect(returned).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // extractIdeas
  // -------------------------------------------------------------------------

  describe('extractIdeas', () => {
    it('makes POST to correct sessions/extract URL', async () => {
      const extracted = [makeIdea({ id: 'extracted-1' })];
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([]))
        .mockResolvedValueOnce(mockJsonResponse(extracted));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.extractIdeas('session-abc');
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/ideas/sessions/session-abc/extract`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('replaces the full ideas state with extracted ideas', async () => {
      const initial = [makeIdea({ id: 'old-idea' })];
      const extracted = [
        makeIdea({ id: 'extracted-1' }),
        makeIdea({ id: 'extracted-2' }),
      ];

      mockFetch
        .mockResolvedValueOnce(mockJsonResponse(initial)) // 1. useEffect fetchIdeas
        .mockResolvedValueOnce(mockJsonResponse(extracted)) // 2. extractIdeas POST
        .mockResolvedValueOnce(mockJsonResponse(extracted)); // 3. refetch fetchIdeas inside extractIdeas

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.ideas).toHaveLength(1));

      await act(async () => {
        await result.current.extractIdeas('session-abc');
      });

      expect(result.current.ideas).toHaveLength(2);
      expect(result.current.ideas[0].id).toBe('extracted-1');
    });

    it('returns empty array on failure', async () => {
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([]))
        .mockResolvedValueOnce(mockJsonResponse(null, false));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: ResearchIdea[] | undefined;
      await act(async () => {
        returned = await result.current.extractIdeas('session-abc');
      });

      expect(returned).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // extractCreativeIdeas
  // -------------------------------------------------------------------------

  describe('extractCreativeIdeas', () => {
    it('makes POST to extract-creative-ideas URL', async () => {
      const extracted = [makeIdea({ id: 'creative-1', type: 'CREATIVE_IDEA' })];
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([]))
        .mockResolvedValueOnce(mockJsonResponse(extracted));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.extractCreativeIdeas();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/ideas/extract-creative-ideas`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('replaces full ideas state with creative ideas', async () => {
      const initial = [makeIdea({ id: 'old-idea' })];
      const creative = [makeIdea({ id: 'creative-1', type: 'CREATIVE_IDEA' })];

      mockFetch
        .mockResolvedValueOnce(mockJsonResponse(initial)) // 1. useEffect fetchIdeas
        .mockResolvedValueOnce(mockJsonResponse(creative)) // 2. extractCreativeIdeas POST
        .mockResolvedValueOnce(mockJsonResponse(creative)); // 3. refetch fetchIdeas inside extractCreativeIdeas

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.ideas).toHaveLength(1));

      await act(async () => {
        await result.current.extractCreativeIdeas();
      });

      expect(result.current.ideas).toHaveLength(1);
      expect(result.current.ideas[0].id).toBe('creative-1');
    });

    it('returns empty array on failure', async () => {
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse([]))
        .mockResolvedValueOnce(mockJsonResponse(null, false));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: ResearchIdea[] | undefined;
      await act(async () => {
        returned = await result.current.extractCreativeIdeas();
      });

      expect(returned).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------------

  describe('return shape', () => {
    it('returns all expected fields', async () => {
      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current).toHaveProperty('ideas');
      expect(result.current).toHaveProperty('isLoading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('fetchIdeas');
      expect(result.current).toHaveProperty('createIdea');
      expect(result.current).toHaveProperty('updateIdea');
      expect(result.current).toHaveProperty('deleteIdea');
      expect(result.current).toHaveProperty('extractIdeas');
      expect(result.current).toHaveProperty('extractCreativeIdeas');
    });

    it('starts with empty ideas array', () => {
      // Don't resolve mockFetch so it stays in loading
      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));

      expect(result.current.ideas).toEqual([]);
    });

    it('starts with null error', () => {
      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useResearchIdeas(PROJECT_ID));

      expect(result.current.error).toBeNull();
    });
  });
});
