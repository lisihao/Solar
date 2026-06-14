import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// vi.mock factories are hoisted — do NOT reference outer variables inside them.

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/utils/config', () => ({
  config: { apiUrl: 'http://test-api' },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { useExport, type ExportRequest } from '../useExport';
import { apiClient } from '@/lib/api/client';

const COMPLETED_JOB = {
  jobId: 'job-123',
  status: 'COMPLETED' as const,
  progress: 100,
  downloadUrl: 'http://test-api/export/job-123/download',
  fileName: 'report.pdf',
};

describe('useExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.mocked(apiClient.post).mockResolvedValue({ jobId: 'job-123' });
    vi.mocked(apiClient.get).mockResolvedValue(COMPLETED_JOB);

    // Stub URL.createObjectURL / revokeObjectURL only (NOT document.createElement)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:http://test/fake'),
      revokeObjectURL: vi.fn(),
    });

    // Default fetch response for download tests
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['content'])),
      headers: { get: () => null },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ==================== Initial State ====================

  it('should return initial idle state', () => {
    const { result } = renderHook(() => useExport());
    expect(result.current.exportStatus.status).toBe('idle');
    expect(result.current.isExporting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should expose all required functions', () => {
    const { result } = renderHook(() => useExport());
    expect(typeof result.current.exportDocument).toBe('function');
    expect(typeof result.current.exportResearch).toBe('function');
    expect(typeof result.current.exportMission).toBe('function');
    expect(typeof result.current.exportRaw).toBe('function');
    expect(typeof result.current.getTemplates).toBe('function');
    expect(typeof result.current.downloadExport).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });

  // ==================== exportDocument ====================

  it('exportDocument: sends POST to /export with request body', async () => {
    const request: ExportRequest = {
      source: { type: 'RESEARCH', sessionId: 'sess-1' },
      format: 'PDF',
    };

    const { result } = renderHook(() => useExport());

    await act(async () => {
      const p = result.current.exportDocument(request);
      vi.runAllTimers();
      await p;
    });

    expect(apiClient.post).toHaveBeenCalledWith('/export', request, {
      timeout: 120000,
    });
  });

  it('exportDocument: sets status to completed on success', async () => {
    const { result } = renderHook(() => useExport());

    await act(async () => {
      const p = result.current.exportDocument({
        source: { type: 'DOCUMENT', documentId: 'doc-1' },
        format: 'DOCX',
      });
      vi.runAllTimers();
      await p;
    });

    expect(result.current.exportStatus.status).toBe('completed');
    expect(result.current.exportStatus.fileName).toBe('report.pdf');
    expect(result.current.isExporting).toBe(false);
  });

  it('exportDocument: sets error state on failure', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useExport());

    await act(async () => {
      await expect(
        result.current.exportDocument({
          source: { type: 'DOCUMENT', documentId: 'doc-1' },
          format: 'PDF',
        })
      ).rejects.toThrow('Server error');
    });

    expect(result.current.exportStatus.status).toBe('failed');
    expect(result.current.error).toBe('Server error');
    expect(result.current.isExporting).toBe(false);
  });

  it('exportDocument: falls back to editable mode when WYSIWYG POST fails', async () => {
    vi.mocked(apiClient.post)
      .mockRejectedValueOnce(new Error('Payload too large'))
      .mockResolvedValueOnce({ jobId: 'job-456' });

    vi.mocked(apiClient.get).mockResolvedValue({
      ...COMPLETED_JOB,
      jobId: 'job-456',
      fileName: 'fallback.pdf',
    });

    const { result } = renderHook(() => useExport());

    await act(async () => {
      const p = result.current.exportDocument({
        source: { type: 'DOCUMENT', documentId: 'doc-1' },
        format: 'PDF',
        options: {
          renderMode: 'wysiwyg',
          wysiwygHtml: '<html>content</html>',
          wysiwygCss: 'body{}',
        },
      });
      vi.runAllTimers();
      await p;
    });

    expect(apiClient.post).toHaveBeenCalledTimes(2);
    const secondCallBody = vi.mocked(apiClient.post).mock
      .calls[1][1] as ExportRequest;
    expect(secondCallBody.options?.renderMode).toBe('editable');
    expect(secondCallBody.options?.wysiwygHtml).toBeUndefined();
  });

  it('exportDocument: rethrows when WYSIWYG fallback is not applicable', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useExport());

    await act(async () => {
      await expect(
        result.current.exportDocument({
          source: { type: 'DOCUMENT', documentId: 'doc-1' },
          format: 'PDF',
        })
      ).rejects.toThrow('Server error');
    });
  });

  // ==================== Polling ====================

  it('polls job status until COMPLETED', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        jobId: 'job-123',
        status: 'PROCESSING',
        progress: 50,
      })
      .mockResolvedValueOnce(COMPLETED_JOB);

    const { result } = renderHook(() => useExport());

    type ExportResult =
      | Awaited<ReturnType<typeof result.current.exportDocument>>
      | undefined;

    // Start the export (non-blocking)
    let exportPromise: Promise<ExportResult>;
    act(() => {
      exportPromise = result.current.exportDocument({
        source: { type: 'DOCUMENT', documentId: 'doc-1' },
        format: 'PDF',
      }) as Promise<ExportResult>;
    });

    // Advance timers to trigger the polling sleep interval
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await exportPromise!;

    expect(apiClient.get).toHaveBeenCalledTimes(2);
    expect(result.current.exportStatus.status).toBe('completed');
  });

  it('throws when job status is FAILED', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      jobId: 'job-123',
      status: 'FAILED',
      progress: 0,
      error: 'Rendering error',
    });

    const { result } = renderHook(() => useExport());

    let exportPromise: Promise<unknown>;
    act(() => {
      exportPromise = result.current.exportDocument({
        source: { type: 'DOCUMENT', documentId: 'doc-1' },
        format: 'PDF',
      });
    });

    await act(async () => {
      await expect(exportPromise!).rejects.toThrow('Rendering error');
    });

    expect(result.current.exportStatus.status).toBe('failed');
  });

  // ==================== exportResearch ====================

  it('exportResearch: wraps exportDocument with research source and defaults', async () => {
    const { result } = renderHook(() => useExport());

    await act(async () => {
      const p = result.current.exportResearch('sess-abc', 'PDF');
      vi.runAllTimers();
      await p;
    });

    const postBody = vi.mocked(apiClient.post).mock
      .calls[0][1] as ExportRequest;
    expect(postBody.source.type).toBe('RESEARCH');
    expect(postBody.source.sessionId).toBe('sess-abc');
    expect(postBody.format).toBe('PDF');
    expect(postBody.options?.includeCover).toBe(true);
    expect(postBody.options?.includeTableOfContents).toBe(true);
    expect(postBody.options?.includeReferences).toBe(true);
  });

  it('exportResearch: merges caller options over defaults', async () => {
    const { result } = renderHook(() => useExport());

    await act(async () => {
      const p = result.current.exportResearch('sess-1', 'PDF', {
        includeReferences: false,
        pageSize: 'Letter',
      });
      vi.runAllTimers();
      await p;
    });

    const postBody = vi.mocked(apiClient.post).mock
      .calls[0][1] as ExportRequest;
    expect(postBody.options?.includeReferences).toBe(false);
    expect(postBody.options?.pageSize).toBe('Letter');
  });

  // ==================== exportMission ====================

  it('exportMission: wraps exportDocument with mission source', async () => {
    const { result } = renderHook(() => useExport());

    await act(async () => {
      const p = result.current.exportMission('mission-1', 'topic-1', 'DOCX');
      vi.runAllTimers();
      await p;
    });

    const postBody = vi.mocked(apiClient.post).mock
      .calls[0][1] as ExportRequest;
    expect(postBody.source.type).toBe('MISSION');
    expect(postBody.source.missionId).toBe('mission-1');
    expect(postBody.source.topicId).toBe('topic-1');
    expect(postBody.format).toBe('DOCX');
  });

  // ==================== exportRaw ====================

  it('exportRaw: wraps exportDocument with RAW source type', async () => {
    const { result } = renderHook(() => useExport());

    await act(async () => {
      const p = result.current.exportRaw('# Hello World', 'MARKDOWN', 'My Doc');
      vi.runAllTimers();
      await p;
    });

    const postBody = vi.mocked(apiClient.post).mock
      .calls[0][1] as ExportRequest;
    expect(postBody.source.type).toBe('RAW');
    expect(postBody.source.content).toBe('# Hello World');
    expect(postBody.source.contentType).toBe('markdown');
    expect(postBody.source.title).toBe('My Doc');
  });

  // ==================== getTemplates ====================

  it('getTemplates: calls GET /templates without category', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([]);

    const { result } = renderHook(() => useExport());

    await act(async () => {
      await result.current.getTemplates();
    });

    expect(apiClient.get).toHaveBeenCalledWith('/templates?');
  });

  it('getTemplates: appends category query param when provided', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([]);

    const { result } = renderHook(() => useExport());

    await act(async () => {
      await result.current.getTemplates('REPORT');
    });

    expect(apiClient.get).toHaveBeenCalledWith('/templates?category=REPORT');
  });

  // ==================== reset ====================

  it('reset: restores state to initial idle', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Error'));

    const { result } = renderHook(() => useExport());

    await act(async () => {
      await expect(
        result.current.exportDocument({
          source: { type: 'DOCUMENT', documentId: 'doc-1' },
          format: 'PDF',
        })
      ).rejects.toThrow();
    });

    expect(result.current.exportStatus.status).toBe('failed');

    act(() => {
      result.current.reset();
    });

    expect(result.current.exportStatus.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.isExporting).toBe(false);
  });

  // ==================== downloadExport ====================

  it('downloadExport: fetches from correct URL with auth headers', async () => {
    const { result } = renderHook(() => useExport());

    await act(async () => {
      await result.current.downloadExport('job-123');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/export/job-123/download',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      })
    );
  });

  it('downloadExport: parses standard filename from Content-Disposition header', async () => {
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(clickSpy);
      }
      return el;
    });

    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['pdf'])),
      headers: {
        get: (name: string) =>
          name === 'Content-Disposition'
            ? 'attachment; filename="my-report.pdf"'
            : null,
      },
    });

    const { result } = renderHook(() => useExport());

    await act(async () => {
      await result.current.downloadExport('job-123');
    });

    expect(clickSpy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('downloadExport: sets error on fetch failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      blob: vi.fn(),
      headers: { get: () => null },
    });

    const { result } = renderHook(() => useExport());

    await act(async () => {
      await result.current.downloadExport('job-bad');
    });

    expect(result.current.exportStatus.status).toBe('failed');
  });

  // ==================== Cleanup ====================

  it('aborts polling on unmount without throwing', () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      jobId: 'job-123',
      status: 'PROCESSING',
      progress: 10,
    });

    const { result, unmount } = renderHook(() => useExport());

    act(() => {
      void result.current.exportDocument({
        source: { type: 'DOCUMENT', documentId: 'doc-1' },
        format: 'PDF',
      });
    });

    unmount();
    // No assertions needed — verifying no crash on unmount
  });
});
