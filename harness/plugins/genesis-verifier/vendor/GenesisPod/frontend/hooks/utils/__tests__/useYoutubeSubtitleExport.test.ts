import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useYoutubeSubtitleExport } from '../useYoutubeSubtitleExport';
import type {
  BilingualSubtitles,
  SubtitleExportOptions,
} from '../useYoutubeSubtitleExport';

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeBilingualSubtitles = (): BilingualSubtitles => ({
  videoId: 'abc123',
  title: 'Test Video',
  url: 'https://youtube.com/watch?v=abc123',
  english: [
    { text: 'Hello world', start: 0, duration: 3 },
    { text: 'This is a test', start: 3, duration: 2 },
  ],
  chinese: [
    { text: '你好世界', start: 0, duration: 3 },
    { text: '这是一个测试', start: 3, duration: 2 },
  ],
});

const makeExportOptions = (): SubtitleExportOptions => ({
  format: 'bilingual-side',
  includeTimestamps: true,
  includeVideoUrl: true,
  includeMetadata: true,
});

const makeOkJsonResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue(data),
  blob: vi
    .fn()
    .mockResolvedValue(new Blob(['pdf content'], { type: 'application/pdf' })),
  text: vi.fn().mockResolvedValue(JSON.stringify(data)),
});

const makeErrorResponse = (status: number, message: string) => ({
  ok: false,
  status,
  json: vi.fn().mockResolvedValue({ message }),
  text: vi.fn().mockResolvedValue(message),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useYoutubeSubtitleExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with isLoading=false and error=null', () => {
    const { result } = renderHook(() => useYoutubeSubtitleExport());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ============================================================
  // fetchSubtitles
  // ============================================================

  describe('fetchSubtitles', () => {
    it('sets isLoading during fetch and resets after', async () => {
      const subtitles = makeBilingualSubtitles();
      mockFetch.mockResolvedValue(makeOkJsonResponse(subtitles));

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      let returnValue: BilingualSubtitles | null = null;
      await act(async () => {
        returnValue = await result.current.fetchSubtitles('abc123');
      });

      expect(result.current.isLoading).toBe(false);
      expect(returnValue).toEqual(subtitles);
    });

    it('returns subtitles from direct response', async () => {
      const subtitles = makeBilingualSubtitles();
      mockFetch.mockResolvedValue(makeOkJsonResponse(subtitles));

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      let data: BilingualSubtitles | null = null;
      await act(async () => {
        data = await result.current.fetchSubtitles('abc123');
      });

      expect((data as BilingualSubtitles | null)?.videoId).toBe('abc123');
      expect((data as BilingualSubtitles | null)?.english).toHaveLength(2);
      expect((data as BilingualSubtitles | null)?.chinese).toHaveLength(2);
    });

    it('unwraps { success, data } response envelope', async () => {
      const subtitles = makeBilingualSubtitles();
      mockFetch.mockResolvedValue(
        makeOkJsonResponse({ success: true, data: subtitles })
      );

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      let data: BilingualSubtitles | null = null;
      await act(async () => {
        data = await result.current.fetchSubtitles('abc123');
      });

      expect((data as BilingualSubtitles | null)?.videoId).toBe('abc123');
    });

    it('calls fetch with correct URL and videoId in body', async () => {
      mockFetch.mockResolvedValue(makeOkJsonResponse(makeBilingualSubtitles()));

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      await act(async () => {
        await result.current.fetchSubtitles('xyz789');
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/youtube/subtitles'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ videoId: 'xyz789' }),
        })
      );
    });

    it('sets error state and returns null on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404, 'Video not found'));

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      let data: BilingualSubtitles | null = null;
      await act(async () => {
        data = await result.current.fetchSubtitles('bad-id');
      });

      expect(data).toBeNull();
      expect(result.current.error).toBe('Video not found');
      expect(result.current.isLoading).toBe(false);
    });

    it('sets error state on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      let data: BilingualSubtitles | null = null;
      await act(async () => {
        data = await result.current.fetchSubtitles('abc123');
      });

      expect(data).toBeNull();
      expect(result.current.error).toBe('Network failure');
    });

    it('handles JSON parse failure with fallback error message', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        // When JSON parse fails, the fallback message is used
        json: vi.fn().mockRejectedValue(new Error('parse error')),
        text: vi.fn().mockResolvedValue('Internal server error'),
      });

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      await act(async () => {
        await result.current.fetchSubtitles('abc123');
      });

      // Source code: .catch(() => ({ message: 'Failed to fetch subtitles' }))
      expect(result.current.error).toBe('Failed to fetch subtitles');
    });

    it('clears previous error on new fetch', async () => {
      mockFetch.mockRejectedValueOnce(new Error('First error'));
      mockFetch.mockResolvedValueOnce(
        makeOkJsonResponse(makeBilingualSubtitles())
      );

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      await act(async () => {
        await result.current.fetchSubtitles('abc');
      });
      expect(result.current.error).toBe('First error');

      await act(async () => {
        await result.current.fetchSubtitles('abc');
      });
      expect(result.current.error).toBeNull();
    });
  });

  // ============================================================
  // exportPdf
  // ============================================================

  describe('exportPdf', () => {
    it('initiates download on successful PDF export', async () => {
      const pdfBlob = new Blob(['%PDF content'], { type: 'application/pdf' });
      const blobUrl = 'blob:http://localhost/pdf-123';

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        blob: vi.fn().mockResolvedValue(pdfBlob),
      });

      const createObjectURLMock = vi.fn().mockReturnValue(blobUrl);
      const revokeObjectURLMock = vi.fn();
      window.URL.createObjectURL = createObjectURLMock;
      window.URL.revokeObjectURL = revokeObjectURLMock;

      const appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation((el) => el);
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation((el) => el);

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      await act(async () => {
        await result.current.exportPdf(
          'abc123',
          'Test Video',
          [{ text: 'Hello', start: 0, duration: 2 }],
          [{ text: '你好', start: 0, duration: 2 }],
          makeExportOptions()
        );
      });

      expect(createObjectURLMock).toHaveBeenCalledWith(pdfBlob);
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalledWith(blobUrl);
      expect(result.current.isLoading).toBe(false);
    });

    it('calls fetch with correct endpoint and payload', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        blob: vi.fn().mockResolvedValue(new Blob()),
      });

      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:url');
      window.URL.revokeObjectURL = vi.fn();
      vi.spyOn(document.body, 'appendChild').mockImplementation((el) => el);
      vi.spyOn(document.body, 'removeChild').mockImplementation((el) => el);

      const { result } = renderHook(() => useYoutubeSubtitleExport());
      const options = makeExportOptions();

      await act(async () => {
        await result.current.exportPdf(
          'vid-001',
          'My Video',
          [{ text: 'Line 1', start: 0, duration: 1 }],
          [{ text: '行1', start: 0, duration: 1 }],
          options
        );
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/youtube/export-pdf'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('vid-001'),
        })
      );
    });

    it('sets error and throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Export failed'));

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      let threw = false;
      await act(async () => {
        try {
          await result.current.exportPdf(
            'abc',
            'Title',
            [],
            [],
            makeExportOptions()
          );
        } catch {
          threw = true;
        }
      });

      expect(threw).toBe(true);
      await waitFor(() => {
        expect(result.current.error).toBe('Export failed');
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('sets error and throws on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const { result } = renderHook(() => useYoutubeSubtitleExport());

      let threw = false;
      await act(async () => {
        try {
          await result.current.exportPdf(
            'abc',
            'Title',
            [],
            [],
            makeExportOptions()
          );
        } catch {
          threw = true;
        }
      });

      expect(threw).toBe(true);
      await waitFor(() => {
        expect(result.current.error).toBe('Connection refused');
      });
    });
  });
});
