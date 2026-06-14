'use client';

import { useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  Download,
  GitMerge,
  Loader2,
  MessageCircle,
  Network,
  Plus,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { WikiKbSummary } from '@/lib/api/wiki';
import { EmptyState } from '@/components/ui/states/EmptyState';

interface WikiChromeHeaderProps {
  kbs: WikiKbSummary[];
  currentKbId: string;
  onBackToGrid: () => void;
  onSelectKb: (id: string) => void;
  onEnableOther: () => void;
  onIngest: () => void;
  onLint: () => void;
  onQuery: () => void;
  onLog: () => void;
  onGraph: () => void;
  onExport: () => void;
  exporting?: boolean;
  onSettings: () => void;
}

export default function WikiChromeHeader({
  kbs,
  currentKbId,
  onBackToGrid,
  onSelectKb,
  onEnableOther,
  onIngest,
  onLint,
  onQuery,
  onLog,
  onGraph,
  onExport,
  exporting,
  onSettings,
}: WikiChromeHeaderProps) {
  const { t } = useTranslation();
  const current = kbs.find((kb) => kb.id === currentKbId);
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-20 border-b border-gray-200 bg-white">
      <div className="space-y-4 px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="relative min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <button
                onClick={onBackToGrid}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                title={t('library.wiki.kbSelector.backToGrid')}
              >
                <ChevronLeft className="h-4 w-4" />
                {t('library.wiki.kbSelector.backToGrid')}
              </button>
              <div className="rounded-lg bg-emerald-100 p-2.5 text-emerald-600">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setOpen((value) => !value)}
                    className="inline-flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-gray-50"
                  >
                    <span className="truncate text-lg font-semibold text-gray-900">
                      {current?.name ?? t('library.wiki.kbSelector.selectKb')}
                    </span>
                    <span className="text-xs text-gray-400">v</span>
                  </button>
                  {current && (
                    <>
                      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {pluralizePages(t, current.pageCount)}
                      </span>
                      {current.lastIngestAt && (
                        <span className="text-sm text-gray-500">
                          {t('library.wiki.kbSelector.lastIngest', {
                            time: formatRelativeTime(current.lastIngestAt, t),
                          })}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            {open && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setOpen(false)}
                  aria-hidden
                />
                <div className="absolute left-0 top-full z-30 mt-2 w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-lg">
                  <div className="border-b border-gray-100 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">
                    {t('library.wiki.kbSelector.switchTo')}
                  </div>
                  <div className="max-h-80 overflow-y-auto p-2">
                    {kbs.length === 0 ? (
                      <EmptyState
                        title={t('library.wiki.kbSelector.noWikiKb')}
                        size="sm"
                      />
                    ) : (
                      kbs.map((kb) => (
                        <button
                          key={kb.id}
                          onClick={() => {
                            onSelectKb(kb.id);
                            setOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${
                            kb.id === currentKbId
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'text-gray-900'
                          }`}
                        >
                          <span className="truncate font-medium">
                            {kb.name}
                          </span>
                          <span className="ml-3 shrink-0 text-xs text-gray-500">
                            {pluralizePages(t, kb.pageCount)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="border-t border-gray-100 p-2">
                    <button
                      onClick={() => {
                        onEnableOther();
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      <Plus className="h-4 w-4" />
                      {t('library.wiki.kbSelector.enableOther')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <HeaderButton
            icon={<Plus className="h-4 w-4" />}
            onClick={onIngest}
            variant="primary"
          >
            {t('library.wiki.subheader.ingest')}
          </HeaderButton>
          <HeaderButton
            icon={<MessageCircle className="h-4 w-4" />}
            onClick={onQuery}
            variant="soft"
          >
            {t('library.wiki.subheader.query')}
          </HeaderButton>
          <HeaderButton
            icon={<GitMerge className="h-4 w-4" />}
            onClick={onLint}
          >
            {t('library.wiki.subheader.lint')}
          </HeaderButton>
          <HeaderButton
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={onLog}
          >
            {t('library.wiki.subheader.log')}
          </HeaderButton>
          <HeaderButton
            icon={<Network className="h-4 w-4" />}
            onClick={onGraph}
          >
            {t('library.wiki.subheader.graph')}
          </HeaderButton>
          <div className="flex-1" />
          <HeaderButton
            icon={
              exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )
            }
            onClick={onExport}
          >
            {t('library.wiki.subheader.export')}
          </HeaderButton>
          <button
            onClick={onSettings}
            className="rounded-lg border border-gray-300 bg-white p-2 text-gray-600 hover:bg-gray-50"
            title={t('library.wiki.subheader.settings')}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function HeaderButton({
  icon,
  onClick,
  children,
  variant = 'default',
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'soft';
}) {
  const className = {
    default: 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
    primary:
      'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    soft: 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100',
  }[variant];

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

function pluralizePages(
  t: (key: string, params?: Record<string, string | number>) => string,
  count: number
): string {
  const key =
    count === 1
      ? 'library.wiki.kbSelector.pageCountOne'
      : 'library.wiki.kbSelector.pageCountOther';
  return t(key, { count });
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
