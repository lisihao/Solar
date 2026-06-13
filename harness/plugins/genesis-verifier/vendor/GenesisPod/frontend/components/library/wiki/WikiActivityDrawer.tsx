'use client';

import { useCallback, useEffect, useState } from 'react';
import { GitMerge, PencilLine, Plus, RefreshCw, Undo2, X } from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  wikiApi,
  type WikiOp,
  type WikiOperationLogEntry,
} from '@/lib/api/wiki';
import { useTranslation } from '@/lib/i18n';
import { logger } from '@/lib/utils/logger';

const OP_PALETTE: Record<
  WikiOp,
  { icon: typeof Plus; bg: string; fg: string }
> = {
  INGEST: { icon: Plus, bg: 'bg-violet-50', fg: 'text-violet-700' },
  LINT: { icon: GitMerge, bg: 'bg-amber-50', fg: 'text-amber-700' },
  EDIT: { icon: PencilLine, bg: 'bg-sky-50', fg: 'text-sky-700' },
  REVERT: { icon: Undo2, bg: 'bg-rose-50', fg: 'text-rose-700' },
};

export default function WikiActivityDrawer({
  kbId,
  onClose,
}: {
  kbId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<WikiOperationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    wikiApi
      .listOperations(kbId, 100)
      .then((res) => setItems(res.items))
      .catch((err) => {
        logger?.error?.('[wiki] listOperations failed', err);
        setError(t('library.wiki.log.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [kbId, t]);

  useEffect(refresh, [refresh]);

  return (
    <div className="fixed right-0 top-0 z-30 flex h-full w-[420px] flex-col border-l border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] shadow-2xl">
      <header className="border-b border-slate-100 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-500">
              Operations
            </div>
            <h3 className="text-sm font-semibold text-slate-900">
              {t('library.wiki.subheader.log')}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {loading
                ? t('library.wiki.log.loading')
                : t('library.wiki.log.totalOps', { count: items.length })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              disabled={loading}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              title={t('library.wiki.log.refresh')}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        ) : !loading && items.length === 0 ? (
          <EmptyState size="sm" title={t('library.wiki.log.empty')} />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <WikiLogCard key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function WikiLogCard({ item }: { item: WikiOperationLogEntry }) {
  const { t } = useTranslation();
  const palette = OP_PALETTE[item.op];
  const Icon = palette.icon;
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${palette.bg}`}
          aria-hidden
        >
          <Icon className={`h-4 w-4 ${palette.fg}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${palette.bg} ${palette.fg}`}
            >
              {item.op}
            </span>
            <span className="truncate text-sm font-medium text-slate-900">
              {item.title}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {item.actorName ?? t('library.wiki.log.system')} -{' '}
            {formatRelativeTime(item.createdAt, t)}
          </div>
          {item.affectedSlugs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.affectedSlugs.slice(0, 6).map((slug) => (
                <code
                  key={slug}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700"
                >
                  {slug}
                </code>
              ))}
              {item.affectedSlugs.length > 6 && (
                <span className="text-[10px] text-slate-500">
                  +{item.affectedSlugs.length - 6}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function formatRelativeTime(
  iso: string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return t('library.wiki.time.justNow');
  if (minutes < 60) return t('library.wiki.time.minutesAgo', { minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('library.wiki.time.hoursAgo', { hours });
  const days = Math.round(hours / 24);
  if (days < 30) return t('library.wiki.time.daysAgo', { days });
  return date.toLocaleDateString();
}
