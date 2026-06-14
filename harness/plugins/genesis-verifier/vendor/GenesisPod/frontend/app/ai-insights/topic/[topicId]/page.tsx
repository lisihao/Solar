'use client';

/**
 * AI Insights - Topic Detail Page
 * 专题洞察详情页面 (moved from /ai-research/topic/[topicId])
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getAuthTokens } from '@/lib/utils/auth';
import { TopicDetail } from '@/components/ai-insights';
import type { ResearchTopic } from '@/lib/types/topic-insights';
import * as api from '@/services/topic-insights/api';
import { logger } from '@/lib/utils/logger';
import { useI18n } from '@/lib/i18n/i18n-context';
import SignInPrompt from '@/components/common/SignInPrompt';
import { LoadingState } from '@/components/ui/states';

export default function TopicDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const topicId = params?.topicId as string;

  const viewParam = searchParams?.get('view');

  const [topic, setTopic] = useState<ResearchTopic | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tokens = getAuthTokens();
  const isAuthenticated = !!tokens?.accessToken;

  const loadTopic = useCallback(async () => {
    if (!topicId) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await api.getTopic(topicId);
      setTopic(data);
    } catch (err) {
      logger.error('Failed to load topic:', err);
      setError(err instanceof Error ? err.message : t('common.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    loadTopic();
  }, [loadTopic]);

  const handleBack = useCallback(() => {
    router.push('/ai-insights');
  }, [router]);

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 p-8">
        <SignInPrompt />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <LoadingState text={t('common.loading')} size="lg" />
      </div>
    );
  }

  if (error || !topic) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-50">
        <div className="rounded-xl bg-white p-8 text-center shadow-lg">
          <h2 className="mb-2 text-lg font-semibold text-gray-900">
            {error || t('common.notFound')}
          </h2>
          <p className="mb-6 text-sm text-gray-500">
            {t('common.noAccessHint')}
          </p>
          <button
            onClick={handleBack}
            className="rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden">
      <TopicDetail topic={topic} onBack={handleBack} initialView={viewParam} />
    </div>
  );
}
