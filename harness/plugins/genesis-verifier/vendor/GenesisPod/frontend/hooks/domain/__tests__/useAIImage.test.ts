import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

import { useApiGet, useApiPost } from '@/hooks/core';
import { useAIImage } from '../useAIImage';
import type { GeneratedImage } from '../useAIImage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeDefaultHook = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(null),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

const makeImage = (
  overrides: Partial<GeneratedImage> = {}
): GeneratedImage => ({
  id: `img-${Math.random().toString(36).slice(2)}`,
  url: 'https://example.com/image.png',
  prompt: 'A beautiful landscape',
  style: 'realistic',
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAIImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultHook());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultHook());
  });

  describe('initial state', () => {
    it('starts with empty images array', () => {
      const { result } = renderHook(() => useAIImage());
      expect(result.current.images).toEqual([]);
    });

    it('starts with isGenerating false', () => {
      const { result } = renderHook(() => useAIImage());
      expect(result.current.isGenerating).toBe(false);
    });

    it('starts with empty history array when data is null', () => {
      const { result } = renderHook(() => useAIImage());
      expect(result.current.history).toEqual([]);
    });
  });

  describe('generate', () => {
    it('calls generateApi with correct params and updates images on success', async () => {
      const generatedImages = [makeImage({ prompt: 'A mountain view' })];
      const mockGenerateApi = vi.fn().mockResolvedValue(generatedImages);

      vi.mocked(useApiPost)
        .mockReturnValueOnce(makeDefaultHook({ execute: mockGenerateApi })) // generateApi
        .mockReturnValueOnce(makeDefaultHook()); // enhancePromptApi

      const { result } = renderHook(() => useAIImage());
      let returned: GeneratedImage[] | null | undefined;
      await act(async () => {
        returned = await result.current.generate({
          prompt: 'A mountain view',
          size: '1024x1024',
        });
      });

      expect(mockGenerateApi).toHaveBeenCalledWith({
        prompt: 'A mountain view',
        size: '1024x1024',
      });
      expect(returned).toEqual(generatedImages);
      expect(result.current.images).toHaveLength(1);
      expect(result.current.images[0].prompt).toBe('A mountain view');
    });

    it('prepends new images to the front of the images list', async () => {
      const firstBatch = [makeImage({ id: 'img-old', prompt: 'old' })];
      const secondBatch = [makeImage({ id: 'img-new', prompt: 'new' })];

      // Use a stable mock that returns different values on successive calls.
      // useApiPost is invoked twice per render (generate + enhance), so we
      // alternate: odd calls → generateApi, even calls → enhancePromptApi.
      let callCount = 0;
      const mockGenerateApi = vi
        .fn()
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce(secondBatch);

      vi.mocked(useApiPost).mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          // generateApi slot
          return makeDefaultHook({ execute: mockGenerateApi });
        }
        // enhancePromptApi slot
        return makeDefaultHook();
      });

      const { result } = renderHook(() => useAIImage());

      await act(async () => {
        await result.current.generate({ prompt: 'old' });
      });
      await act(async () => {
        await result.current.generate({ prompt: 'new' });
      });

      expect(result.current.images[0].id).toBe('img-new');
      expect(result.current.images[1].id).toBe('img-old');
    });

    it('does not add images when generateApi returns null', async () => {
      const mockGenerateApi = vi.fn().mockResolvedValue(null);
      vi.mocked(useApiPost)
        .mockReturnValueOnce(makeDefaultHook({ execute: mockGenerateApi }))
        .mockReturnValueOnce(makeDefaultHook());

      const { result } = renderHook(() => useAIImage());
      await act(async () => {
        await result.current.generate({ prompt: 'test' });
      });

      expect(result.current.images).toEqual([]);
    });
  });

  describe('clearImages', () => {
    it('clears all images from the list', async () => {
      const generatedImages = [makeImage()];
      const mockGenerateApi = vi.fn().mockResolvedValue(generatedImages);

      vi.mocked(useApiPost)
        .mockReturnValueOnce(makeDefaultHook({ execute: mockGenerateApi }))
        .mockReturnValueOnce(makeDefaultHook());

      const { result } = renderHook(() => useAIImage());
      await act(async () => {
        await result.current.generate({ prompt: 'test' });
      });

      expect(result.current.images).toHaveLength(1);

      act(() => {
        result.current.clearImages();
      });

      expect(result.current.images).toEqual([]);
    });
  });

  describe('enhancePrompt', () => {
    it('calls enhancePromptApi and returns enhanced text', async () => {
      const mockEnhanceApi = vi
        .fn()
        .mockResolvedValue({ enhanced: 'A beautiful mountain view at sunset' });

      vi.mocked(useApiPost)
        .mockReturnValueOnce(makeDefaultHook()) // generateApi
        .mockReturnValueOnce(makeDefaultHook({ execute: mockEnhanceApi })); // enhancePromptApi

      const { result } = renderHook(() => useAIImage());
      let enhanced: string | undefined;
      await act(async () => {
        enhanced = await result.current.enhancePrompt('mountain');
      });

      expect(mockEnhanceApi).toHaveBeenCalledWith({ prompt: 'mountain' });
      expect(enhanced).toBe('A beautiful mountain view at sunset');
    });

    it('returns undefined when enhancePromptApi returns null', async () => {
      const mockEnhanceApi = vi.fn().mockResolvedValue(null);

      vi.mocked(useApiPost)
        .mockReturnValueOnce(makeDefaultHook())
        .mockReturnValueOnce(makeDefaultHook({ execute: mockEnhanceApi }));

      const { result } = renderHook(() => useAIImage());
      let enhanced: string | undefined;
      await act(async () => {
        enhanced = await result.current.enhancePrompt('test');
      });

      expect(enhanced).toBeUndefined();
    });
  });

  describe('history', () => {
    it('returns history items from API data', () => {
      const historyItems = [
        makeImage({ id: 'hist-1' }),
        makeImage({ id: 'hist-2' }),
      ];
      vi.mocked(useApiGet).mockReturnValue(
        makeDefaultHook({ data: historyItems })
      );
      vi.mocked(useApiPost).mockReturnValue(makeDefaultHook());

      const { result } = renderHook(() => useAIImage());
      expect(result.current.history).toHaveLength(2);
      expect(result.current.history[0].id).toBe('hist-1');
    });

    it('exposes refreshHistory function', () => {
      const mockRefresh = vi.fn();
      vi.mocked(useApiGet).mockReturnValue(
        makeDefaultHook({ execute: mockRefresh })
      );
      vi.mocked(useApiPost).mockReturnValue(makeDefaultHook());

      const { result } = renderHook(() => useAIImage());
      expect(result.current.refreshHistory).toBe(mockRefresh);
    });
  });
});
