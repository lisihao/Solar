'use client';

import Link from 'next/link';
import { Newspaper } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';

export interface NarrativeEpisode {
  date: string; // YYYY-MM-DD
  signalId: string;
  title: string;
  tier: 1 | 2 | 3;
}

interface NarrativeThreadProps {
  topicId: string;
  narrativeId: string;
  label: string;
  /** Episodes already fetched by the parent */
  episodes: NarrativeEpisode[];
  /** Highlight the episode matching this date */
  currentSignalDate?: string;
}

export function NarrativeThread({
  topicId,
  narrativeId,
  label,
  episodes,
  currentSignalDate,
}: NarrativeThreadProps) {
  const { t } = useTranslation();
  // Render nothing when fewer than 2 episodes
  if (episodes.length < 2) return null;

  const episodeNumber = episodes.length;

  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      {/* Header: label + episode count + prev link */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
          <Newspaper className="h-4 w-4" aria-hidden="true" />
          {t('radar.detail.narrativeLabel', {
            label,
            episode: episodeNumber,
          })}
        </span>
        <Link
          href={`/ai-radar/topic/${topicId}/narrative/${narrativeId}`}
          className="text-xs text-violet-600 hover:underline"
        >
          {t('radar.detail.narrativePrev')}
        </Link>
      </div>

      {/* Mini timeline: circles connected by lines */}
      <div className="flex flex-wrap items-center gap-0">
        {episodes.map((ep, idx) => {
          const isCurrent =
            currentSignalDate !== undefined && ep.date === currentSignalDate;
          const isLast = idx === episodes.length - 1;

          return (
            <span key={ep.signalId} className="flex items-center">
              {/* Circle node */}
              <span
                title={ep.date}
                className={`inline-block h-2.5 w-2.5 rounded-full border-2 ${
                  isCurrent
                    ? 'border-violet-600 bg-violet-600'
                    : 'border-slate-400 bg-white'
                }`}
              />
              {/* Connecting line (not after last node) */}
              {!isLast && (
                <span className="inline-block h-0.5 w-4 bg-slate-300" />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
