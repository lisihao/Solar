'use client';

/**
 * AutoImportFlow - Handles cross-module import and auto-generation
 *
 * When navigated to slides page with action=import URL params,
 * this component automatically imports the source data and
 * triggers slide generation.
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/utils/logger';

interface AutoImportParams {
  sourceType: 'research' | 'research-project';
  sourceId: string;
  outputId?: string;
  title?: string;
  targetPages?: number;
  stylePreference?: 'dark' | 'light' | 'custom';
  themeId?: string;
  preset?: string;
}

interface GenerateOptions {
  title: string;
  sourceText: string;
  userRequirement?: string;
  stylePreference?: string;
  themeId?: string;
  crossModuleSource?: {
    type: 'topic-insights' | 'research-project';
    sourceId: string;
    sourceName?: string;
  };
  preset?: string;
}

interface AutoImportFlowProps {
  onGenerate: (options: GenerateOptions) => void;
}

export function AutoImportFlow({ onGenerate }: AutoImportFlowProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<'idle' | 'importing' | 'done' | 'error'>(
    'idle'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (!searchParams) return;

    const action = searchParams.get('action');
    if (action !== 'import' || hasTriggered.current) return;

    const sourceType = searchParams.get('sourceType') as
      | 'research'
      | 'research-project'
      | null;
    const sourceId = searchParams.get('sourceId');

    if (!sourceType || !sourceId) return;

    hasTriggered.current = true;

    const rawOutputId = searchParams.get('outputId');
    const rawTitle = searchParams.get('title');
    const rawTargetPages = searchParams.get('targetPages');
    const rawStylePreference = searchParams.get('stylePreference');
    const rawThemeId = searchParams.get('themeId');
    const rawPreset = searchParams.get('preset');

    const params: AutoImportParams = {
      sourceType,
      sourceId,
      outputId: rawOutputId ?? undefined,
      title: rawTitle ?? undefined,
      targetPages: rawTargetPages ? Number(rawTargetPages) : undefined,
      stylePreference:
        (rawStylePreference as AutoImportParams['stylePreference']) || 'dark',
      themeId: rawThemeId || 'genspark-dark',
      preset: rawPreset ?? undefined,
    };

    // Clear URL params immediately to prevent re-triggering
    router.replace(pathname ?? '/ai-office/slides', { scroll: false });

    // Perform the import
    const doImport = async () => {
      setStatus('importing');
      try {
        const url =
          params.sourceType === 'research-project'
            ? `/api/ai-office/slides/import/research-project/${params.sourceId}${params.outputId ? `?outputId=${params.outputId}` : ''}`
            : `/api/ai-office/slides/import/research/${params.sourceId}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        });

        if (!response.ok) {
          throw new Error(`Import failed: ${response.statusText}`);
        }

        const result = (await response.json()) as {
          data?: {
            data?: { sourceText?: string; metadata?: { title?: string } };
            sourceText?: string;
            metadata?: { title?: string };
          };
        };
        const data = result.data?.data || result.data;

        if (!data?.sourceText) {
          throw new Error('No source text returned from import');
        }

        setStatus('done');

        // Build crossModuleSource based on sourceType
        const crossModuleSource: GenerateOptions['crossModuleSource'] =
          params.sourceType === 'research'
            ? {
                type: 'topic-insights',
                sourceId: params.sourceId,
                sourceName: data.metadata?.title,
              }
            : params.sourceType === 'research-project'
              ? {
                  type: 'research-project',
                  sourceId: params.sourceId,
                  sourceName: params.title || data.metadata?.title,
                }
              : undefined;

        // Trigger generation with imported data
        onGenerate({
          title: params.title || data.metadata?.title || '演示文稿',
          sourceText: data.sourceText,
          userRequirement: '',
          stylePreference: params.stylePreference || 'dark',
          themeId: params.themeId || 'genspark-dark',
          ...(crossModuleSource && { crossModuleSource }),
          ...(params.preset && { preset: params.preset }),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Import failed';
        logger.error('[AutoImportFlow] Import error:', err);
        setStatus('error');
        setErrorMessage(msg);
      }
    };

    doImport();
  }, [searchParams, router, pathname, accessToken, onGenerate]);

  if (status === 'idle' || status === 'done') return null;

  if (status === 'error') {
    return (
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
        <span>导入失败：{errorMessage}</span>
      </div>
    );
  }

  // importing state
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-lg">
      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
      <span>正在导入内容...</span>
    </div>
  );
}
