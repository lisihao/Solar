/**
 * Tests for hooks/utils/useThumbnailGeneratorClient.ts
 *
 * Tests useThumbnailGenerator hook (client-side version) and needsThumbnail utility.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils/config', () => ({
  config: {
    apiBaseUrl: 'https://api.example.com',
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock pdfjs-dist dynamic import
vi.mock('pdfjs-dist', () => ({
  default: {
    getDocument: vi.fn(),
    GlobalWorkerOptions: { workerSrc: '' },
    version: '4.0.0',
  },
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
  version: '4.0.0',
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------
import {
  useThumbnailGenerator,
  needsThumbnail,
} from '../useThumbnailGeneratorClient';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  global.fetch = vi.fn();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// needsThumbnail utility
// ---------------------------------------------------------------------------
describe('needsThumbnail', () => {
  it('returns true for PAPER type with pdfUrl and no thumbnailUrl', () => {
    expect(
      needsThumbnail({
        type: 'PAPER',
        pdfUrl: 'https://example.com/paper.pdf',
        thumbnailUrl: null,
      })
    ).toBe(true);
  });

  it('returns false for non-PAPER type', () => {
    expect(
      needsThumbnail({
        type: 'ARTICLE',
        pdfUrl: 'https://example.com/paper.pdf',
        thumbnailUrl: null,
      })
    ).toBe(false);
  });

  it('returns false when pdfUrl is null', () => {
    expect(
      needsThumbnail({
        type: 'PAPER',
        pdfUrl: null,
        thumbnailUrl: null,
      })
    ).toBe(false);
  });

  it('returns false when pdfUrl is undefined', () => {
    expect(
      needsThumbnail({
        type: 'PAPER',
        pdfUrl: undefined,
        thumbnailUrl: null,
      })
    ).toBe(false);
  });

  it('returns false when thumbnailUrl already exists', () => {
    expect(
      needsThumbnail({
        type: 'PAPER',
        pdfUrl: 'https://example.com/paper.pdf',
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
      })
    ).toBe(false);
  });

  it('returns false when pdfUrl is empty string', () => {
    expect(
      needsThumbnail({
        type: 'PAPER',
        pdfUrl: '',
        thumbnailUrl: null,
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useThumbnailGenerator - initial state
// ---------------------------------------------------------------------------
describe('useThumbnailGenerator (client) - initial state', () => {
  it('starts with isGenerating=false and error=null', () => {
    const { result } = renderHook(() => useThumbnailGenerator());

    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns all expected functions', () => {
    const { result } = renderHook(() => useThumbnailGenerator());

    expect(typeof result.current.generateThumbnail).toBe('function');
    expect(typeof result.current.generateAndUploadThumbnail).toBe('function');
    expect(typeof result.current.batchGenerateThumbnails).toBe('function');
  });

  it('accepts default options', () => {
    const { result } = renderHook(() => useThumbnailGenerator());
    expect(result.current.isGenerating).toBe(false);
  });

  it('accepts custom options', () => {
    const { result } = renderHook(() =>
      useThumbnailGenerator({
        scale: 2,
        quality: 0.9,
        maxWidth: 400,
        maxHeight: 600,
      })
    );
    expect(result.current.isGenerating).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateThumbnail
// ---------------------------------------------------------------------------
describe('generateThumbnail (client)', () => {
  it('returns null and sets error when pdfjs fails to load', async () => {
    // pdfjs import mock returns, but getDocument throws
    const pdfjsMock = await import('pdfjs-dist');
    vi.mocked(pdfjsMock.getDocument).mockImplementation(() => {
      throw new Error('Worker failed to load');
    });

    const { result } = renderHook(() => useThumbnailGenerator());

    let thumbnailResult: string | null = 'initial';
    await act(async () => {
      thumbnailResult = await result.current.generateThumbnail(
        'https://example.com/test.pdf'
      );
    });

    expect(thumbnailResult).toBeNull();
    expect(result.current.error).toBeTruthy();
    expect(result.current.isGenerating).toBe(false);
  });

  it('sets isGenerating to false after completion', async () => {
    const pdfjsMock = await import('pdfjs-dist');
    vi.mocked(pdfjsMock.getDocument).mockImplementation(() => {
      throw new Error('fail');
    });

    const { result } = renderHook(() => useThumbnailGenerator());

    await act(async () => {
      await result.current.generateThumbnail('https://example.com/test.pdf');
    });

    expect(result.current.isGenerating).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateAndUploadThumbnail
// ---------------------------------------------------------------------------
describe('generateAndUploadThumbnail (client)', () => {
  it('returns false when thumbnail generation fails', async () => {
    const pdfjsMock = await import('pdfjs-dist');
    vi.mocked(pdfjsMock.getDocument).mockImplementation(() => {
      throw new Error('PDF load failed');
    });

    const { result } = renderHook(() => useThumbnailGenerator());

    let uploadResult: boolean = true;
    await act(async () => {
      uploadResult = await result.current.generateAndUploadThumbnail(
        'res-1',
        'https://example.com/bad.pdf'
      );
    });

    expect(uploadResult).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// batchGenerateThumbnails (client)
// ---------------------------------------------------------------------------
describe('batchGenerateThumbnails (client)', () => {
  it('returns zero counts for empty resources', async () => {
    const { result } = renderHook(() => useThumbnailGenerator());

    let batchResult:
      | { success: number; failed: number; errors: string[] }
      | undefined;
    await act(async () => {
      const promise = result.current.batchGenerateThumbnails([]);
      await vi.runAllTimersAsync();
      batchResult = await promise;
    });

    expect(batchResult).toEqual({ success: 0, failed: 0, errors: [] });
  });

  it('sets isGenerating=false after batch completes', async () => {
    const pdfjsMock = await import('pdfjs-dist');
    vi.mocked(pdfjsMock.getDocument).mockImplementation(() => {
      throw new Error('fail');
    });

    const { result } = renderHook(() => useThumbnailGenerator());

    await act(async () => {
      const promise = result.current.batchGenerateThumbnails([
        { id: 'r1', pdfUrl: 'https://example.com/1.pdf' },
      ]);
      await vi.runAllTimersAsync();
      await promise;
    });

    expect(result.current.isGenerating).toBe(false);
  });

  it('accumulates failed resources with error messages', async () => {
    const pdfjsMock = await import('pdfjs-dist');
    vi.mocked(pdfjsMock.getDocument).mockImplementation(() => {
      throw new Error('fail');
    });

    const { result } = renderHook(() => useThumbnailGenerator());

    let batchResult:
      | { success: number; failed: number; errors: string[] }
      | undefined;
    await act(async () => {
      const promise = result.current.batchGenerateThumbnails([
        { id: 'r1', pdfUrl: 'https://example.com/1.pdf' },
        { id: 'r2', pdfUrl: 'https://example.com/2.pdf' },
      ]);
      await vi.runAllTimersAsync();
      batchResult = await promise;
    });

    expect(batchResult?.failed).toBe(2);
    expect(batchResult?.success).toBe(0);
    expect(batchResult?.errors.length).toBeGreaterThan(0);
  });

  it('counts failed resources when generateAndUploadThumbnail returns false', async () => {
    // generateAndUploadThumbnail returns false when generateThumbnail returns null
    const pdfjsMock = await import('pdfjs-dist');
    vi.mocked(pdfjsMock.getDocument).mockImplementation(() => {
      throw new Error('PDF load failed');
    });

    const { result } = renderHook(() => useThumbnailGenerator());

    let batchResult:
      | { success: number; failed: number; errors: string[] }
      | undefined;
    await act(async () => {
      const promise = result.current.batchGenerateThumbnails([
        { id: 'res-1', pdfUrl: 'https://example.com/a.pdf' },
      ]);
      await vi.runAllTimersAsync();
      batchResult = await promise;
    });

    expect(batchResult?.failed).toBe(1);
    expect(batchResult?.errors).toContain(
      'Failed to generate thumbnail for res-1'
    );
  });
});
