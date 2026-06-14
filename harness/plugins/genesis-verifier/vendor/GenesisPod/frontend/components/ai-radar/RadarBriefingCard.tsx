'use client';

import {
  BookOpen,
  Building2,
  Compass,
  ExternalLink,
  Radio,
  Zap,
} from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { TierBadge } from '@/components/common/badges/TierBadge';
import { WhyItMattersCallout } from '@/components/common/callouts/WhyItMattersCallout';
import { ShareActions } from '@/components/common/actions/ShareActions';
import { NarrativeThread, type NarrativeEpisode } from './NarrativeThread';

export interface DailySignalView {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  oneLineTakeaway: string;
  whyItMatters: string;
  whatsNext: string;
  signalTags: string[];
  entities: string[];
  evidenceItemIds: string[];
  /** PR-DR2 收尾：原文来源（多源全量），卡片底部渲染为可点击链接 */
  evidenceSources?: EvidenceSource[];
  narrativeId?: string;
}

interface EvidenceSource {
  name: string;
  url?: string;
  publishedAt: string;
}

export interface RadarBriefingCardProps {
  signal: DailySignalView;
  index: number;
  topicId: string;
  topicName: string;
  detailUrl: string;
  isFavorited?: boolean;
  onFavorite?: () => Promise<void>;
  narrativeEpisodes?: NarrativeEpisode[];
  narrativeLabel?: string;
  evidenceSources?: EvidenceSource[];
}

export function RadarBriefingCard({
  signal,
  index,
  topicId,
  topicName,
  detailUrl,
  isFavorited,
  onFavorite,
  narrativeEpisodes,
  narrativeLabel,
  evidenceSources,
}: RadarBriefingCardProps) {
  const { t } = useTranslation();

  const visibleTags = signal.signalTags.slice(0, 3);
  const visibleEntities = signal.entities.slice(0, 5);
  const showNarrative =
    signal.narrativeId &&
    narrativeEpisodes &&
    narrativeEpisodes.length >= 2 &&
    narrativeLabel;

  return (
    <article
      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:p-6"
      aria-label={`Signal ${index}: ${signal.title}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-500">{index}.</span>
          <TierBadge tier={signal.tier} size="sm" />
          <h2 className="text-base font-semibold text-slate-800 md:text-lg">
            {signal.title}
          </h2>
        </div>
      </div>

      {/* One-line takeaway */}
      <p className="inline-flex items-start gap-1.5 text-sm font-medium text-slate-700">
        <Zap
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
          aria-hidden="true"
        />
        <span>{signal.oneLineTakeaway}</span>
      </p>

      {/* Why it matters */}
      <WhyItMattersCallout>
        <p className="text-sm text-slate-700">{signal.whyItMatters}</p>
      </WhyItMattersCallout>

      {/* What's next */}
      <p className="inline-flex items-start gap-1.5 text-sm text-slate-600">
        <Compass
          className="mt-0.5 h-4 w-4 shrink-0 text-violet-500"
          aria-hidden="true"
        />
        <span>
          <span className="mr-1 font-medium text-slate-700">
            {t('radar.detail.whatsNextLabel')}
          </span>
          {signal.whatsNext}
        </span>
      </p>

      {/* Signal tags */}
      {visibleTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Radio
            className="mr-0.5 h-3 w-3 text-slate-400"
            aria-hidden="true"
          />
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Entities */}
      {visibleEntities.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Building2
            className="mr-0.5 h-3 w-3 text-slate-400"
            aria-hidden="true"
          />
          {visibleEntities.map((entity) => (
            <span
              key={entity}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
            >
              {entity}
            </span>
          ))}
        </div>
      )}

      {/* Narrative thread */}
      {showNarrative && (
        <NarrativeThread
          topicId={topicId}
          narrativeId={signal.narrativeId!}
          label={narrativeLabel}
          episodes={narrativeEpisodes}
        />
      )}

      {/* Evidence sources —— 多源全量展示，逐条可点击追溯原始链接 */}
      {evidenceSources && evidenceSources.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
            <BookOpen className="h-3 w-3" aria-hidden="true" />
            {t('radar.detail.evidenceSources')}
            <span className="text-slate-400">· {evidenceSources.length}</span>
          </p>
          {evidenceSources.map((src, idx) => (
            <EvidenceRow
              key={src.url ?? src.name ?? `evidence-${idx}`}
              source={src}
            />
          ))}
        </div>
      )}

      {/* Share actions */}
      <div className="border-t border-gray-100 pt-3">
        <ShareActions
          title={`${signal.title} — ${topicName}`}
          summary={signal.oneLineTakeaway}
          detailUrl={detailUrl}
          onFavorite={onFavorite}
          isFavorited={isFavorited}
        />
      </div>
    </article>
  );
}

function EvidenceRow({ source }: { source: EvidenceSource }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-md bg-slate-50 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline"
          >
            {source.name}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-xs font-medium text-slate-700">
            {source.name}
          </span>
        )}
        <span className="text-xs text-slate-400">{source.publishedAt}</span>
      </div>
    </div>
  );
}
