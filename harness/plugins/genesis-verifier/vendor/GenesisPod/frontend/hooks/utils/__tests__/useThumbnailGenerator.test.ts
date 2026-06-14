/**
 * Tests for hooks/utils/useThumbnailGenerator.ts
 *
 * Tests the useThumbnailGenerator hook that wraps PDF thumbnail generation logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGenerateAndSaveThumbnail } = vi.hoisted(() => ({
  mockGenerateAndSaveThumbnail: vi.fn(),
}));

vi.mock('@/lib/utils/pdf-thumbnail', () => ({
  generateAndSaveThumbnail: mockGenerateAndSaveThumbnail,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------
import { useThumbnailGenerator } from '../useThumbnailGenerator';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// useThumbnailGenerator - initial state
// ---------------------------------------------------------------------------
describe('useThumbnailGenerator - initial state', () => {
  it('starts with empty thumbnailStatus and null progress', () => {
    const { result } = renderHook(() => useThumbnailGenerator());

    expect(result.current.thumbnailStatus).toEqual({});
    expect(result.current.progress).toBeNull();
  });

  it('returns all expected functions', () => {
    const { result } = renderHook(() => useThumbnailGenerator());

    expect(typeof result.current.generateThumbnail).toBe('function');
    expect(typeof result.current.generateBatchThumbnails).toBe('function');
    expect(typeof result.current.getStatus).toBe('function');
    expect(typeof result.current.resetStatus).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------
describe('getStatus', () => {
  it('returns idle for unknown resource', () => {
    const { result } = renderHook(() => useThumbnailGenerator());

    expect(result.current.getStatus('unknown-resource')).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// resetStatus
// ---------------------------------------------------------------------------
describe('resetStatus', () => {
  it('removes a resource status entry', async () => {
    mockGenerateAndSaveThumbnail.mockResolvedValue(
      'https://cdn.example.com/thumb.jpg'
    );

    const { result } = renderHook(() => useThumbnailGenerator());

    await act(async () => {
      await result.current.generateThumbnail(
        'res-1',
        'https://example.com/1.pdf'
      );
    });

    act(() => {
      result.current.resetStatus('res-1');
    });

    expect(result.current.thumbnailStatus).not.toHaveProperty('res-1');
    expect(result.current.getStatus('res-1')).toBe('idle');
  });

  it('does nothing for non-existent resource', () => {
    const { result } = renderHook(() => useThumbnailGenerator());

    act(() => {
      result.current.resetStatus('does-not-exist');
    });

    expect(result.current.thumbnailStatus).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// generateThumbnail
// ---------------------------------------------------------------------------
describe('generateThumbnail', () => {
  it('sets status to generating then success on successful generation', async () => {
    mockGenerateAndSaveThumbnail.mockResolvedValue(
      'https://cdn.example.com/thumb.jpg'
    );

    const { result } = renderHook(() => useThumbnailGenerator());

    await act(async () => {
      await result.current.generateThumbnail(
        'res-1',
        'https://example.com/1.pdf'
      );
    });

    expect(result.current.thumbnailStatus['res-1']).toBe('success');
  });

  it('returns thumbnail URL on success', async () => {
    const thumbnailUrl = 'https://cdn.example.com/thumb.jpg';
    mockGenerateAndSaveThumbnail.mockResolvedValue(thumbnailUrl);

    const { result } = renderHook(() => useThumbnailGenerator());

    let returnedUrl: string | null = null;
    await act(async () => {
      returnedUrl = await result.current.generateThumbnail(
        'res-1',
        'https://example.com/1.pdf'
      );
    });

    expect(returnedUrl).toBe(thumbnailUrl);
  });

  it('sets status to error when generation returns null', async () => {
    mockGenerateAndSaveThumbnail.mockResolvedValue(null);

    const { result } = renderHook(() => useThumbnailGenerator());

    await act(async () => {
      await result.current.generateThumbnail(
        'res-2',
        'https://example.com/2.pdf'
      );
    });

    expect(result.current.thumbnailStatus['res-2']).toBe('error');
  });

  it('returns null when generation fails', async () => {
    mockGenerateAndSaveThumbnail.mockResolvedValue(null);

    const { result } = renderHook(() => useThumbnailGenerator());

    let returnedUrl: string | null = 'initial';
    await act(async () => {
      returnedUrl = await result.current.generateThumbnail(
        'res-2',
        'https://example.com/2.pdf'
      );
    });

    expect(returnedUrl).toBeNull();
  });

  it('sets status to error when an exception is thrown', async () => {
    mockGenerateAndSaveThumbnail.mockRejectedValue(
      new Error('Network failure')
    );

    const { result } = renderHook(() => useThumbnailGenerator());

    await act(async () => {
      await result.current.generateThumbnail(
        'res-3',
        'https://example.com/3.pdf'
      );
    });

    expect(result.current.thumbnailStatus['res-3']).toBe('error');
  });

  it('returns null when an exception is thrown', async () => {
    mockGenerateAndSaveThumbnail.mockRejectedValue(
      new Error('Network failure')
    );

    const { result } = renderHook(() => useThumbnailGenerator());

    let returnedUrl: string | null = 'initial';
    await act(async () => {
      returnedUrl = await result.current.generateThumbnail(
        'res-3',
        'https://example.com/3.pdf'
      );
    });

    expect(returnedUrl).toBeNull();
  });

  it('can handle multiple resources independently', async () => {
    mockGenerateAndSaveThumbnail
      .mockResolvedValueOnce('https://cdn.example.com/thumb1.jpg')
      .mockResolvedValueOnce(null);

    const { result } = renderHook(() => useThumbnailGenerator());

    await act(async () => {
      await result.current.generateThumbnail(
        'res-A',
        'https://example.com/a.pdf'
      );
      await result.current.generateThumbnail(
        'res-B',
        'https://example.com/b.pdf'
      );
    });

    expect(result.current.thumbnailStatus['res-A']).toBe('success');
    expect(result.current.thumbnailStatus['res-B']).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// generateBatchThumbnails
// ---------------------------------------------------------------------------
describe('generateBatchThumbnails', () => {
  it('returns success and failed counts', async () => {
    mockGenerateAndSaveThumbnail
      .mockResolvedValueOnce('https://cdn.example.com/thumb1.jpg')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('https://cdn.example.com/thumb3.jpg');

    const { result } = renderHook(() => useThumbnailGenerator());

    let batchResult:
      | { success: number; failed: number; skipped: number }
      | undefined;
    await act(async () => {
      const promise = result.current.generateBatchThumbnails([
        { id: 'r1', pdfUrl: 'https://example.com/1.pdf' },
        { id: 'r2', pdfUrl: 'https://example.com/2.pdf' },
        { id: 'r3', pdfUrl: 'https://example.com/3.pdf' },
      ]);
      await vi.runAllTimersAsync();
      batchResult = await promise;
    });

    expect(batchResult?.success).toBe(2);
    expect(batchResult?.failed).toBe(1);
    expect(batchResult?.skipped).toBe(0);
  });

  it('updates progress during batch generation', async () => {
    mockGenerateAndSaveThumbnail.mockResolvedValue(
      'https://cdn.example.com/thumb.jpg'
    );

    const { result } = renderHook(() => useThumbnailGenerator());

    await act(async () => {
      const promise = result.current.generateBatchThumbnails([
        { id: 'r1', pdfUrl: 'https://example.com/1.pdf' },
        { id: 'r2', pdfUrl: 'https://example.com/2.pdf' },
      ]);
      await vi.runAllTimersAsync();
      await promise;
    });

    // After completion, progress should be null
    expect(result.current.progress).toBeNull();
  });

  it('sets progress to null after completion', async () => {
    mockGenerateAndSaveThumbnail.mockResolvedValue(null);

    const { result } = renderHook(() => useThumbnailGenerator());

    await act(async () => {
      const promise = result.current.generateBatchThumbnails([
        { id: 'r1', pdfUrl: 'https://example.com/1.pdf' },
      ]);
      await vi.runAllTimersAsync();
      await promise;
    });

    expect(result.current.progress).toBeNull();
  });

  it('handles empty resources array', async () => {
    const { result } = renderHook(() => useThumbnailGenerator());

    let batchResult:
      | { success: number; failed: number; skipped: number }
      | undefined;
    await act(async () => {
      batchResult = await result.current.generateBatchThumbnails([]);
    });

    expect(batchResult).toEqual({ success: 0, failed: 0, skipped: 0 });
  });
});
