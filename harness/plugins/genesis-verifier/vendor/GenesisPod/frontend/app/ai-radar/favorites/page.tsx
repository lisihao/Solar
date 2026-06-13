'use client';

/**
 * AI Radar Favorites list — FC-6
 *
 * /ai-radar/favorites
 * 用户已收藏的 signal 跨主题汇总，按收藏时间倒序
 */

import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import { useFavoritesList } from '@/hooks/domain/useFavoritesList';
import { useTranslation } from '@/lib/i18n';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { TierBadge } from '@/components/common/badges/TierBadge';
import { WhyItMattersCallout } from '@/components/common/callouts/WhyItMattersCallout';
import { PageHeaderHero } from '@/components/ui/page-header-hero/PageHeaderHero';

export default function RadarFavoritesPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useFavoritesList(100);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <button
        type="button"
        onClick={() => router.push('/ai-radar')}
        className="mb-3 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-3 w-3" />
        {t('radar.favorites.back')}
      </button>

      <PageHeaderHero
        className="mb-6 !px-0 !py-0"
        title={t('radar.favorites.title')}
        subtitle={t('radar.favorites.countSuffix', { count: data.length })}
        icon={<Bookmark className="h-7 w-7 text-white" aria-hidden="true" />}
      />

      {/* UX #3 hint：收藏自动同步到知识库（用户反馈 2026-05-18） */}
      <div className="mb-4 flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700">
        <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
        <span>
          你的收藏已自动同步到{' '}
          <button
            type="button"
            onClick={() => router.push('/library')}
            className="font-medium underline hover:text-violet-900"
          >
            我的知识库 · AI 雷达收藏
          </button>{' '}
          作为数据源
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('radar.favorites.loading')}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>
            {t('radar.favorites.loadFailedPrefix')}
            {error.message ?? t('radar.favorites.unknownError')}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            <RefreshCw className="h-3 w-3" />
            {t('radar.favorites.retry')}
          </button>
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <EmptyState
          title={t('radar.favorites.emptyTitle')}
          description={t('radar.favorites.emptyHint')}
        />
      )}

      {!loading && !error && data.length > 0 && (
        <div className="space-y-4">
          {data.map((f) => (
            <FavoriteCard key={f.signalId} fav={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FavoriteCard({
  fav,
}: {
  fav: ReturnType<typeof useFavoritesList>['data'][number];
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const expired = fav.signal === null;

  return (
    <article
      className={`rounded-xl border bg-white p-5 shadow-sm ${
        expired ? 'border-gray-100 opacity-70' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {fav.signal && <TierBadge tier={fav.signal.tier} size="sm" />}
          <h2 className="text-base font-semibold text-slate-800">
            {fav.signal?.title ?? t('radar.favorites.expiredTitle')}
          </h2>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-xs text-slate-400">
          <span>
            {t('radar.favorites.fromTopic', { topic: fav.topicName })}
          </span>
          {fav.briefingDate && <span>{fav.briefingDate}</span>}
        </div>
      </div>

      {fav.signal && (
        <>
          <p className="mt-3 text-sm font-medium text-slate-700">
            {fav.signal.oneLineTakeaway}
          </p>
          {fav.signal.whyItMatters && (
            <div className="mt-2">
              <WhyItMattersCallout>
                <p className="text-sm text-slate-700">
                  {fav.signal.whyItMatters}
                </p>
              </WhyItMattersCallout>
            </div>
          )}
          {fav.signal.whatsNext && (
            <p className="mt-2 text-sm text-slate-600">
              <span className="mr-1 font-medium text-slate-700">
                {t('radar.favorites.whatsNext')}
              </span>
              {fav.signal.whatsNext}
            </p>
          )}
        </>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-400">
        <span>
          {t('radar.favorites.favoritedAt', {
            date: formatDate(fav.favoritedAt),
          })}
        </span>
        <button
          type="button"
          onClick={() =>
            router.push(
              `/ai-radar/topic/${fav.topicId}${fav.briefingDate ? `?date=${fav.briefingDate}` : ''}`
            )
          }
          className="inline-flex items-center gap-1 text-violet-600 hover:underline"
        >
          {t('radar.favorites.viewTopic')}
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </article>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
