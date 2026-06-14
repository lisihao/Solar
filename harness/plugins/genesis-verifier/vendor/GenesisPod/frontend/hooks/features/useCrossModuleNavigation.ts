/**
 * Cross-module navigation hook
 *
 * Provides utilities for navigating between AI modules with context:
 * - AI Insights → AI Slides (generate PPT from topic report)
 * - AI Research → AI Slides (generate PPT from research output)
 * - AI Insights → AI Research (deep dive into topic)
 * - AI Research → AI Insights (sediment findings back to insights)
 */
'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

export interface NavigateToSlidesOptions {
  sourceType: 'research' | 'research-project';
  sourceId: string;
  outputId?: string; // For research-project: specific output to import
  title?: string;
  targetPages?: number;
  stylePreference?: 'dark' | 'light' | 'custom';
  themeId?: string;
}

export interface NavigateToResearchOptions {
  action: 'create';
  fromTopicId?: string;
  contextTitle?: string;
  contextSummary?: string;
}

export function useCrossModuleNavigation() {
  const router = useRouter();

  const navigateToSlides = useCallback(
    (options: NavigateToSlidesOptions) => {
      const params = new URLSearchParams();
      params.set('action', 'import');
      params.set('sourceType', options.sourceType);
      params.set('sourceId', options.sourceId);
      if (options.outputId) params.set('outputId', options.outputId);
      if (options.title) params.set('title', options.title);
      if (options.targetPages)
        params.set('targetPages', String(options.targetPages));
      if (options.stylePreference)
        params.set('stylePreference', options.stylePreference);
      if (options.themeId) params.set('themeId', options.themeId);
      router.push(`/ai-office/slides?${params.toString()}`);
    },
    [router]
  );

  const navigateToResearchCreate = useCallback(
    (options: NavigateToResearchOptions) => {
      const params = new URLSearchParams();
      params.set('action', options.action);
      if (options.fromTopicId) params.set('fromTopicId', options.fromTopicId);
      if (options.contextTitle)
        params.set('contextTitle', options.contextTitle);
      if (options.contextSummary)
        params.set('contextSummary', options.contextSummary);
      router.push(`/ai-research?${params.toString()}`);
    },
    [router]
  );

  return { navigateToSlides, navigateToResearchCreate };
}
