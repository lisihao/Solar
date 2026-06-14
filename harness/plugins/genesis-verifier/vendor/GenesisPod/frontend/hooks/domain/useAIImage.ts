import { useApiPost, useApiGet } from '../core';
import { useCallback, useState } from 'react';

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  style?: string;
  createdAt: string;
}

export interface ImageGenerationParams {
  prompt: string;
  style?: string;
  size?: '512x512' | '1024x1024' | '1792x1024';
  count?: number;
}

export function useAIImage() {
  const [images, setImages] = useState<GeneratedImage[]>([]);

  // Generate image
  const { loading: generateLoading, execute: generateApi } = useApiPost<
    GeneratedImage[],
    ImageGenerationParams
  >('/api/ai-image/generate');

  // Enhance prompt
  const { loading: enhanceLoading, execute: enhancePromptApi } = useApiPost<
    { enhanced: string },
    { prompt: string }
  >('/api/ai-image/enhance-prompt');

  // Get history
  const {
    data: history,
    loading: historyLoading,
    execute: refreshHistory,
  } = useApiGet<GeneratedImage[]>('/api/ai-image/history', {
    immediate: false,
  });

  const generate = useCallback(
    async (params: ImageGenerationParams) => {
      const result = await generateApi(params);
      if (result) {
        setImages((prev) => [...result, ...prev]);
      }
      return result;
    },
    [generateApi]
  );

  const enhancePrompt = useCallback(
    async (prompt: string) => {
      const result = await enhancePromptApi({ prompt });
      return result?.enhanced;
    },
    [enhancePromptApi]
  );

  const clearImages = useCallback(() => {
    setImages([]);
  }, []);

  return {
    images,
    isGenerating: generateLoading,
    generate,
    clearImages,

    enhancePrompt,
    isEnhancing: enhanceLoading,

    history: history ?? [],
    historyLoading,
    refreshHistory,
  };
}
