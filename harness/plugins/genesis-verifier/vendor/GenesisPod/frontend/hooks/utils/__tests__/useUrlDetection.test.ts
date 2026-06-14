import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockDetectAndParseUrls = vi.fn();

vi.mock('@/services/ai-teams/api', () => ({
  detectAndParseUrls: (...args: unknown[]) => mockDetectAndParseUrls(...args),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { useUrlDetection } from '../useUrlDetection';
import type { ParsedUrl, DetectedUrl } from '@/services/ai-teams/api';

function makeParsedUrl(
  url: string,
  status: 'success' | 'failed' = 'success'
): ParsedUrl {
  return {
    type: 'WEBPAGE',
    originalText: url,
    url,
    preview: { title: `Preview of ${url}` },
    status,
  };
}

describe('useUrlDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectAndParseUrls.mockResolvedValue({
      detectedUrls: [],
      parsedUrls: [],
    });
  });

  // ==================== Initial State ====================

  it('should return initial state with empty arrays', () => {
    const { result } = renderHook(() => useUrlDetection(''));
    expect(result.current.detectedUrls).toEqual([]);
    expect(result.current.parsedUrls).toEqual([]);
    expect(result.current.isParsing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should expose all required functions', () => {
    const { result } = renderHook(() => useUrlDetection(''));
    expect(typeof result.current.parseUrls).toBe('function');
    expect(typeof result.current.removeUrl).toBe('function');
    expect(typeof result.current.clearAll).toBe('function');
  });

  // ==================== Local URL detection ====================
  // When autoParseUrls=false, local detection is triggered by calling parseUrls() manually.
  // detectAndParseUrls is mocked to return empty results so we only test local detection logic.

  it('should detect a simple https URL via parseUrls', async () => {
    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false })
    );

    await act(async () => {
      await result.current.parseUrls('Check this out: https://example.com');
    });

    expect(result.current.detectedUrls.length).toBeGreaterThan(0);
    expect(result.current.detectedUrls[0].url).toBe('https://example.com');
    expect(result.current.detectedUrls[0].type).toBe('WEBPAGE');
  });

  it('should detect YouTube URLs as VIDEO type via parseUrls', async () => {
    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false })
    );

    await act(async () => {
      await result.current.parseUrls(
        'Watch: https://www.youtube.com/watch?v=abc123'
      );
    });

    expect(result.current.detectedUrls.length).toBeGreaterThan(0);
    expect(result.current.detectedUrls[0].type).toBe('VIDEO');
    expect(result.current.detectedUrls[0].platform).toBe('youtube');
  });

  it('should detect GitHub URLs as CODE_REPO type via parseUrls', async () => {
    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false })
    );

    await act(async () => {
      await result.current.parseUrls('See: https://github.com/user/repo');
    });

    expect(result.current.detectedUrls.length).toBeGreaterThan(0);
    expect(result.current.detectedUrls[0].type).toBe('CODE_REPO');
    expect(result.current.detectedUrls[0].platform).toBe('github');
  });

  it('should detect Twitter/X URLs as SOCIAL type via parseUrls', async () => {
    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false })
    );

    await act(async () => {
      await result.current.parseUrls('https://twitter.com/user/status/123');
    });

    expect(result.current.detectedUrls[0].type).toBe('SOCIAL');
    expect(result.current.detectedUrls[0].platform).toBe('twitter');
  });

  it('should detect image URLs as IMAGE type via parseUrls', async () => {
    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false })
    );

    await act(async () => {
      await result.current.parseUrls(
        'Image: https://cdn.example.com/photo.jpg'
      );
    });

    expect(result.current.detectedUrls[0].type).toBe('IMAGE');
  });

  it('should detect multiple URLs in text via parseUrls', async () => {
    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false })
    );

    await act(async () => {
      await result.current.parseUrls(
        'https://example.com and also https://github.com/test/repo'
      );
    });

    expect(result.current.detectedUrls.length).toBe(2);
  });

  it('should return empty detectedUrls for text with no URLs', async () => {
    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false })
    );

    await act(async () => {
      await result.current.parseUrls('no urls in this text at all');
    });

    expect(result.current.detectedUrls).toEqual([]);
  });

  it('should respect maxUrls option via parseUrls', async () => {
    const urls = Array.from(
      { length: 10 },
      (_, i) => `https://example${i}.com`
    ).join(' ');
    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false, maxUrls: 3 })
    );

    await act(async () => {
      await result.current.parseUrls(urls);
    });

    expect(result.current.detectedUrls.length).toBeLessThanOrEqual(3);
  });

  // ==================== Auto-parse with debounce ====================

  it('calls detectAndParseUrls after debounce when autoParseUrls=true', async () => {
    vi.useFakeTimers();
    const parsedUrl = makeParsedUrl('https://example.com');
    mockDetectAndParseUrls.mockResolvedValue({
      detectedUrls: [
        {
          url: 'https://example.com',
          startIndex: 0,
          endIndex: 19,
          type: 'WEBPAGE',
        },
      ],
      parsedUrls: [parsedUrl],
    });

    const { result } = renderHook(() =>
      useUrlDetection('https://example.com', {
        autoParseUrls: true,
        debounceMs: 500,
      })
    );

    // Should not call API immediately
    expect(mockDetectAndParseUrls).not.toHaveBeenCalled();

    // Advance past debounce + flush async
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockDetectAndParseUrls).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not call detectAndParseUrls when autoParseUrls=false', () => {
    vi.useFakeTimers();
    renderHook(() =>
      useUrlDetection('https://example.com', {
        autoParseUrls: false,
        debounceMs: 500,
      })
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockDetectAndParseUrls).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('sets parsedUrls after successful API call', async () => {
    vi.useFakeTimers();
    const parsedUrl = makeParsedUrl('https://example.com');
    mockDetectAndParseUrls.mockResolvedValue({
      detectedUrls: [
        {
          url: 'https://example.com',
          startIndex: 0,
          endIndex: 19,
          type: 'WEBPAGE',
        },
      ],
      parsedUrls: [parsedUrl],
    });

    const { result } = renderHook(() =>
      useUrlDetection('https://example.com', {
        autoParseUrls: true,
        debounceMs: 500,
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.parsedUrls.length).toBeGreaterThan(0);
    expect(result.current.parsedUrls[0].url).toBe('https://example.com');
    expect(result.current.isParsing).toBe(false);
    vi.useRealTimers();
  });

  // ==================== Error handling ====================

  it('sets error state when API call fails', async () => {
    vi.useFakeTimers();
    mockDetectAndParseUrls.mockRejectedValue(new Error('API unavailable'));

    const { result } = renderHook(() =>
      useUrlDetection('https://example.com', {
        autoParseUrls: true,
        debounceMs: 500,
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.error).toBe('API unavailable');
    expect(result.current.isParsing).toBe(false);
    vi.useRealTimers();
  });

  it('marks pending URLs as failed when API call fails', async () => {
    vi.useFakeTimers();
    mockDetectAndParseUrls.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() =>
      useUrlDetection('https://example.com', {
        autoParseUrls: true,
        debounceMs: 500,
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    // All URLs should not be stuck in 'parsing' state
    result.current.parsedUrls.forEach((p: ParsedUrl) => {
      expect(p.status).not.toBe('parsing');
    });
    vi.useRealTimers();
  });

  // ==================== parseUrls (manual) ====================

  it('parseUrls: manually triggers URL parsing', async () => {
    const parsedUrl = makeParsedUrl('https://manual.com');
    mockDetectAndParseUrls.mockResolvedValue({
      detectedUrls: [
        {
          url: 'https://manual.com',
          startIndex: 0,
          endIndex: 18,
          type: 'WEBPAGE',
        },
      ],
      parsedUrls: [parsedUrl],
    });

    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false })
    );

    await act(async () => {
      await result.current.parseUrls('https://manual.com');
    });

    expect(mockDetectAndParseUrls).toHaveBeenCalledWith('https://manual.com');
  });

  it('parseUrls: clears parsedUrls when text has no URLs', async () => {
    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false })
    );

    await act(async () => {
      await result.current.parseUrls('no urls in this text');
    });

    expect(result.current.parsedUrls).toEqual([]);
    expect(result.current.detectedUrls).toEqual([]);
  });

  // ==================== removeUrl ====================

  it('removeUrl: removes specified URL from both lists', async () => {
    vi.useFakeTimers();
    mockDetectAndParseUrls.mockResolvedValue({
      detectedUrls: [
        {
          url: 'https://example.com',
          startIndex: 0,
          endIndex: 19,
          type: 'WEBPAGE' as const,
        },
        {
          url: 'https://other.com',
          startIndex: 25,
          endIndex: 43,
          type: 'WEBPAGE' as const,
        },
      ],
      parsedUrls: [
        makeParsedUrl('https://example.com'),
        makeParsedUrl('https://other.com'),
      ],
    });

    const { result } = renderHook(() =>
      useUrlDetection('https://example.com and https://other.com', {
        autoParseUrls: true,
        debounceMs: 200,
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      result.current.removeUrl('https://example.com');
    });

    expect(
      result.current.detectedUrls.find(
        (d: DetectedUrl) => d.url === 'https://example.com'
      )
    ).toBeUndefined();
    expect(
      result.current.parsedUrls.find(
        (p: ParsedUrl) => p.url === 'https://example.com'
      )
    ).toBeUndefined();
    expect(
      result.current.parsedUrls.find(
        (p: ParsedUrl) => p.url === 'https://other.com'
      )
    ).toBeDefined();
    vi.useRealTimers();
  });

  // ==================== clearAll ====================

  it('clearAll: empties all state and clears error', async () => {
    vi.useFakeTimers();
    mockDetectAndParseUrls.mockResolvedValue({
      detectedUrls: [
        {
          url: 'https://example.com',
          startIndex: 0,
          endIndex: 19,
          type: 'WEBPAGE' as const,
        },
      ],
      parsedUrls: [makeParsedUrl('https://example.com')],
    });

    const { result } = renderHook(() =>
      useUrlDetection('https://example.com', {
        autoParseUrls: true,
        debounceMs: 200,
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.detectedUrls).toEqual([]);
    expect(result.current.parsedUrls).toEqual([]);
    expect(result.current.error).toBeNull();
    vi.useRealTimers();
  });

  // ==================== Cleanup on unmount ====================

  it('cleans up timers on unmount without throwing', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() =>
      useUrlDetection('https://example.com', {
        autoParseUrls: true,
        debounceMs: 500,
      })
    );

    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockDetectAndParseUrls).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('clears detectedUrls when clearAll is called', async () => {
    const { result } = renderHook(() =>
      useUrlDetection('', { autoParseUrls: false })
    );

    // First detect some URLs via parseUrls
    await act(async () => {
      await result.current.parseUrls('https://example.com');
    });

    expect(result.current.detectedUrls.length).toBeGreaterThan(0);

    // Clear all
    act(() => {
      result.current.clearAll();
    });

    expect(result.current.detectedUrls).toEqual([]);
  });
});
