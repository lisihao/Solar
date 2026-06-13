import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: 'http://test-api',
    apiBaseUrl: 'http://test-api',
    streamApiUrl: 'http://test-stream',
  },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn().mockReturnValue({ Authorization: 'Bearer test' }),
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

import { useResearchDemos } from '../useResearchDemos';
import type { ResearchDemo } from '../useResearchDemos';

const PROJECT_ID = 'proj-123';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDemo(overrides: Partial<ResearchDemo> = {}): ResearchDemo {
  return {
    id: `demo-${Math.random().toString(36).slice(2)}`,
    ideaId: 'idea-1',
    projectId: PROJECT_ID,
    title: 'Test Demo',
    htmlContent: '<html><body>Demo content</body></html>',
    status: 'COMPLETED',
    error: null,
    metadata: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function mockFetchOk(data: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(data),
  };
}

function mockFetchError(status = 500) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ error: 'Server error' }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useResearchDemos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default, the initial fetch (useEffect) returns empty array
    mockFetch.mockResolvedValue(mockFetchOk({ data: [] }));
  });

  describe('initial state', () => {
    it('starts with empty demos array', async () => {
      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      // Wait for the initial fetch effect
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.demos).toEqual([]);
    });

    it('starts with null error', async () => {
      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchDemos', () => {
    it('fetches demos from the correct API URL', async () => {
      const demos = [makeDemo()];
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: demos }));

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/demos`,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test' }),
        })
      );
    });

    it('populates demos from API response', async () => {
      const demos = [makeDemo({ id: 'demo-1', title: 'Demo One' })];
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: demos }));

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => {
        expect(result.current.demos).toHaveLength(1);
      });
      expect(result.current.demos[0].title).toBe('Demo One');
    });

    it('handles plain array response (no data wrapper)', async () => {
      const demos = [makeDemo({ id: 'demo-plain' })];
      mockFetch.mockResolvedValueOnce(mockFetchOk(demos));

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => {
        expect(result.current.demos).toHaveLength(1);
      });
      expect(result.current.demos[0].id).toBe('demo-plain');
    });

    it('sets error when fetch response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchError(500));

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });
    });

    it('silent mode does not set loading state', async () => {
      mockFetch.mockResolvedValue(mockFetchOk({ data: [] }));

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      // Wait for initial load
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Call fetchDemos in silent mode
      let loadingDuringSilentFetch = false;
      const originalSetState = result.current.isLoading;
      await act(async () => {
        const fetchPromise = result.current.fetchDemos(undefined, {
          silent: true,
        });
        // isLoading should not change during silent fetch
        loadingDuringSilentFetch = result.current.isLoading;
        await fetchPromise;
      });
      expect(loadingDuringSilentFetch).toBe(false);
      void originalSetState; // avoid unused warning
    });

    it('ignores AbortError without setting error state', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: [] })); // initial load
      const abortError = new DOMException('Aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.fetchDemos();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('generateDemo', () => {
    it('calls the correct POST endpoint and adds demo to list', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: [] })); // initial load
      const newDemo = makeDemo({
        id: 'demo-new',
        ideaId: 'idea-42',
        status: 'PENDING',
      });
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: newDemo }));

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let generated: ResearchDemo | null = null;
      await act(async () => {
        generated = await result.current.generateDemo(
          'idea-42',
          'New Demo Title'
        );
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/ideas/idea-42/generate-demo`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'New Demo Title' }),
        })
      );
      expect(generated).not.toBeNull();
      expect(result.current.demos).toHaveLength(1);
      expect(result.current.demos[0].id).toBe('demo-new');
    });

    it('returns null and does not crash when generate fails', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: [] }));
      mockFetch.mockRejectedValueOnce(new Error('Generate failed'));

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let generated: ResearchDemo | null = makeDemo(); // set non-null to verify it changes
      await act(async () => {
        generated = await result.current.generateDemo('idea-42');
      });

      expect(generated).toBeNull();
    });
  });

  describe('getDemo', () => {
    it('fetches a single demo by ID', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: [] }));
      const demo = makeDemo({ id: 'demo-single' });
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: demo }));

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let fetched: ResearchDemo | null = null;
      await act(async () => {
        fetched = await result.current.getDemo('demo-single');
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/demos/demo-single`,
        expect.any(Object)
      );
      expect((fetched as ResearchDemo | null)?.id).toBe('demo-single');
    });

    it('returns null when getDemo fetch fails', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: [] }));
      mockFetch.mockRejectedValueOnce(new Error('Not found'));

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let fetched: ResearchDemo | null = makeDemo();
      await act(async () => {
        fetched = await result.current.getDemo('demo-missing');
      });

      expect(fetched).toBeNull();
    });
  });

  describe('deleteDemo', () => {
    it('calls DELETE endpoint and removes demo from list', async () => {
      const existingDemo = makeDemo({ id: 'demo-to-delete' });
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: [existingDemo] }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => {
        expect(result.current.demos).toHaveLength(1);
      });

      let success = false;
      await act(async () => {
        success = await result.current.deleteDemo('demo-to-delete');
      });

      expect(success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-api/api/v1/ai-studio/projects/${PROJECT_ID}/demos/demo-to-delete`,
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(result.current.demos).toHaveLength(0);
    });

    it('returns false when delete fails', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchOk({ data: [] }));
      mockFetch.mockRejectedValueOnce(new Error('Delete failed'));

      const { result } = renderHook(() => useResearchDemos(PROJECT_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.deleteDemo('demo-nonexistent');
      });

      expect(success).toBe(false);
    });
  });

  describe('cleanup on unmount', () => {
    it('aborts in-flight fetch when unmounted', () => {
      let capturedSignal: AbortSignal | undefined;
      mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
        capturedSignal = opts?.signal as AbortSignal;
        return new Promise(() => {});
      });

      const { unmount } = renderHook(() => useResearchDemos(PROJECT_ID));

      expect(capturedSignal?.aborted).toBe(false);
      unmount();
      expect(capturedSignal?.aborted).toBe(true);
    });
  });
});

// Suppress unused variable warning from the 'silent mode' test
declare const _: unknown;
