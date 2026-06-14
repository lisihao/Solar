'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileSearch,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  wikiApi,
  type WikiIngestCandidate,
  type WikiIngestCandidateState,
} from '@/lib/api/wiki';
import { logger } from '@/lib/utils/logger';
import { useTranslation } from '@/lib/i18n';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { ErrorState } from '@/components/ui/states/ErrorState';
import { Modal } from '@/components/ui/dialogs/Modal';

type FilterKey = 'recommended' | 'ready' | 'covered' | 'blocked' | 'all';

const FILTER_TO_STATES: Record<FilterKey, WikiIngestCandidateState[] | null> = {
  recommended: ['READY_NEW', 'READY_STALE'],
  ready: ['READY_NEW', 'READY_STALE', 'READY_COVERED'],
  covered: ['READY_COVERED'],
  blocked: ['BLOCKED'],
  all: null,
};

const STATE_STYLES: Record<WikiIngestCandidateState, string> = {
  READY_NEW: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  READY_STALE: 'bg-amber-50 text-amber-700 ring-amber-200',
  READY_COVERED: 'bg-slate-100 text-slate-700 ring-slate-200',
  BLOCKED: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const DOC_STATUS_STYLES: Record<string, string> = {
  READY: 'bg-emerald-50 text-emerald-700',
  PROCESSING: 'bg-blue-50 text-blue-700',
  UPDATING: 'bg-blue-50 text-blue-700',
  PENDING: 'bg-slate-100 text-slate-700',
  ERROR: 'bg-rose-50 text-rose-700',
};

export default function WikiIngestModal({
  kbId,
  onClose,
  onIngested,
}: {
  kbId: string;
  onClose: () => void;
  onIngested: (diffId: string, isAsync?: boolean) => void;
}) {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<WikiIngestCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('recommended');
  // 用户主动切过 filter 后不再自动覆盖（避免 user click 后又被 effect 拉回）
  const [userPickedFilter, setUserPickedFilter] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    wikiApi
      .listIngestCandidates(kbId)
      .then((res) => {
        if (cancelled) return;
        const items = res.items ?? [];
        setDocs(items);
        setSelected(
          new Set(items.filter((d) => d.recommended).map((d) => d.id))
        );
      })
      .catch((err) => {
        logger?.error?.('[wiki] listIngestCandidates failed', err);
        if (!cancelled) setError(t('library.wiki.ingest.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kbId, t]);

  // 2026-05-14 智能 filter fallback:
  // 全部 doc 已 READY_COVERED 时 recommended filter 为 0,UI 一片空白 → 用户找不到按钮。
  // 默认值改成"看得见的 filter":有推荐用推荐,否则切 ready (含 covered),都没切 all.
  // 用户手动切过后就不再覆盖 (userPickedFilter 守门)。

  const counts = useMemo(
    () => ({
      recommended: docs.filter((d) => d.recommended).length,
      ready: docs.filter((d) => d.ingestState !== 'BLOCKED').length,
      covered: docs.filter((d) => d.ingestState === 'READY_COVERED').length,
      blocked: docs.filter((d) => d.ingestState === 'BLOCKED').length,
      stale: docs.filter((d) => d.ingestState === 'READY_STALE').length,
    }),
    [docs]
  );

  // 2026-05-14 智能 filter 初值: 文档已全部覆盖 (counts.recommended=0) 时
  // 默认 'recommended' tab 是空的 → 用户看到 "未匹配" 找不到 doc。
  // 自动切到最近的非空 tab 让用户看到 doc。用户主动点过 tab 后此 effect 不再覆盖。
  useEffect(() => {
    if (loading || userPickedFilter || docs.length === 0) return;
    if (filter === 'recommended' && counts.recommended === 0) {
      if (counts.ready > 0) setFilter('ready');
      else if (counts.covered > 0) setFilter('covered');
      else setFilter('all');
    }
  }, [loading, userPickedFilter, docs.length, counts, filter]);

  const visibleDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const states = FILTER_TO_STATES[filter];
    return docs
      .filter((doc) => (states ? states.includes(doc.ingestState) : true))
      .filter((doc) => {
        if (!q) return true;
        return (
          doc.title.toLowerCase().includes(q) ||
          doc.sourceType.toLowerCase().includes(q) ||
          doc.reason.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
  }, [docs, filter, query]);

  const readyVisibleIds = useMemo(
    () =>
      visibleDocs.filter((d) => d.ingestState !== 'BLOCKED').map((d) => d.id),
    [visibleDocs]
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectMany = (ids: string[]) => {
    setSelected(new Set(ids));
  };

  const submit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await wikiApi.ingest(kbId, Array.from(selected));
      // 2026-05-19 fire-and-forget：后端立即返回 async=true + diff.id='processing'。
      // 不要跳转去不存在的 diff 详情；让 onIngested(undefined) 让 WikiTab 自行决定
      // 是关 modal + 等用户回 wiki 主页面看新 PENDING diff。
      // 老 SINGLE 同步路径（如果以后改回）：result.async 为 undefined / false，
      // diff.id 是真 UUID，照常跳转。
      onIngested(result.diff.id, !!result.async);
    } catch (err) {
      logger?.error?.('[wiki] ingest failed', err);
      setError(humanizeIngestError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const modalTitle = (
    <div>
      <div className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">
        <Sparkles className="h-3.5 w-3.5" />
        {t('library.wiki.ingest.workspaceBadge')}
      </div>
      <div className="mt-2 text-xl font-semibold text-slate-900">
        {t('library.wiki.ingest.title')}
      </div>
    </div>
  );

  const modalSubtitle = t('library.wiki.ingest.subtitle');

  const modalFooter = (
    <div className="flex w-full items-center justify-between">
      <div className="text-sm text-slate-500">
        {t('library.wiki.ingest.selectedCount', {
          selected: selected.size,
          total: docs.length,
        })}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          {t('library.wiki.ingest.cancel')}
        </button>
        <button
          disabled={submitting || selected.size === 0}
          onClick={() => void submit()}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('library.wiki.ingest.runWithCount', { count: selected.size })}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={modalTitle}
      subtitle={modalSubtitle}
      size="xl"
      footer={modalFooter}
      footerClassName="justify-start"
      contentClassName="p-0"
    >
      {!loading && !error && docs.length > 0 && (
        <div className="grid grid-cols-2 gap-3 border-b border-slate-200 px-6 py-5 md:grid-cols-5">
          <SummaryCard
            icon={<Sparkles className="h-4 w-4" />}
            label={t('library.wiki.ingest.summary.recommended')}
            value={counts.recommended}
            tone="violet"
          />
          <SummaryCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label={t('library.wiki.ingest.summary.ready')}
            value={counts.ready}
            tone="emerald"
          />
          <SummaryCard
            icon={<RefreshCw className="h-4 w-4" />}
            label={t('library.wiki.ingest.summary.stale')}
            value={counts.stale}
            tone="amber"
          />
          <SummaryCard
            icon={<Layers3 className="h-4 w-4" />}
            label={t('library.wiki.ingest.summary.covered')}
            value={counts.covered}
            tone="slate"
          />
          <SummaryCard
            icon={<AlertCircle className="h-4 w-4" />}
            label={t('library.wiki.ingest.summary.blocked')}
            value={counts.blocked}
            tone="rose"
          />
        </div>
      )}

      <div className="border-b border-slate-200 px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('library.wiki.ingest.searchPlaceholder')}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-violet-300 focus:bg-white focus:ring-4 focus:ring-violet-100"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['recommended', counts.recommended],
                ['ready', counts.ready],
                ['covered', counts.covered],
                ['blocked', counts.blocked],
                ['all', docs.length],
              ] as Array<[FilterKey, number]>
            ).map(([key, count]) => (
              <button
                key={key}
                onClick={() => {
                  setFilter(key);
                  setUserPickedFilter(true);
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  filter === key
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t(`library.wiki.ingest.filters.${key}`)} · {count}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            onClick={() =>
              selectMany(docs.filter((d) => d.recommended).map((d) => d.id))
            }
            className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 font-medium text-violet-700 transition hover:bg-slate-100"
          >
            {t('library.wiki.ingest.actions.selectRecommended')}
          </button>
          <button
            onClick={() => selectMany(readyVisibleIds)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {t('library.wiki.ingest.actions.selectVisibleReady')}
          </button>
          {/* 2026-05-14: 当所有 doc 已覆盖时,推荐 / 可处理 都 0,用户找不到选项。
              此按钮无视 state 直接选所有非 BLOCKED doc,触发 LLM 重新生成整个 wiki。 */}
          <button
            onClick={() =>
              selectMany(
                docs.filter((d) => d.ingestState !== 'BLOCKED').map((d) => d.id)
              )
            }
            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700 transition hover:bg-emerald-100"
            title={t('library.wiki.ingest.actions.reingestAllTooltip')}
          >
            {t('library.wiki.ingest.actions.reingestAll')}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {t('library.wiki.ingest.actions.clearSelection')}
          </button>
          <span className="ml-auto text-slate-500">
            {t('library.wiki.ingest.selectionHint')}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50/70 px-6 py-5">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
          </div>
        ) : error ? (
          <ErrorState
            error={error}
            title={t('library.wiki.ingest.loadFailed')}
          />
        ) : docs.length === 0 ? (
          <EmptyState
            icon={<FileSearch className="h-8 w-8" />}
            title={t('library.wiki.ingest.noDocs')}
            size="sm"
          />
        ) : visibleDocs.length === 0 ? (
          <EmptyState
            type="search"
            icon={<Search className="h-8 w-8" />}
            title={t('library.wiki.ingest.noMatch')}
            size="sm"
          />
        ) : (
          <ul className="space-y-3">
            {visibleDocs.map((doc) => {
              const checked = selected.has(doc.id);
              const disabled = doc.ingestState === 'BLOCKED';
              return (
                <li
                  key={doc.id}
                  className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
                    checked
                      ? 'border-violet-300 ring-4 ring-violet-100'
                      : 'border-slate-200 hover:border-slate-300'
                  } ${disabled ? 'opacity-75' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(doc.id)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 disabled:cursor-not-allowed"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {doc.title || doc.id}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <StateBadge state={doc.ingestState} />
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                DOC_STATUS_STYLES[doc.status] ??
                                'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {doc.status}
                            </span>
                            <MetaPill label={doc.sourceType} />
                            {doc.mimeType && <MetaPill label={doc.mimeType} />}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 md:grid-cols-4">
                          <Metric
                            label={t('library.wiki.ingest.metric.references')}
                            value={String(doc.pageReferenceCount)}
                          />
                          <Metric
                            label={t('library.wiki.ingest.metric.chunks')}
                            value={String(doc.chunkCount)}
                          />
                          <Metric
                            label={t('library.wiki.ingest.metric.updated')}
                            value={formatRelativeTime(doc.updatedAt, t)}
                          />
                          <Metric
                            label={t('library.wiki.ingest.metric.lastCited')}
                            value={
                              doc.lastCitedAt
                                ? formatRelativeTime(doc.lastCitedAt, t)
                                : t('library.wiki.ingest.never')
                            }
                          />
                        </div>
                      </div>

                      <p className="mt-3 text-sm text-slate-600">
                        {doc.reason}
                      </p>
                      {doc.lastError && (
                        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          {doc.lastError}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: 'violet' | 'emerald' | 'amber' | 'slate' | 'rose';
}) {
  const toneClass = {
    violet: 'bg-violet-50 text-violet-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-700',
    rose: 'bg-rose-50 text-rose-700',
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className={`inline-flex rounded-lg p-2 ${toneClass}`}>{icon}</div>
      <div className="mt-3 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

function StateBadge({ state }: { state: WikiIngestCandidateState }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${STATE_STYLES[state]}`}
    >
      {state}
    </span>
  );
}

function MetaPill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2.5 py-2">
      <div className="truncate text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-slate-700">{value}</div>
    </div>
  );
}

/**
 * Wiki ingest 是单轮 LLM 调用，180s timeout 是合理上限；但 fetch AbortController
 * 触发的 DOMException 原文是 "signal is aborted without reason"，用户看不懂
 * → 显式判定 timeout / aborted 并给出可执行提示。
 */
function humanizeIngestError(
  err: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  if (err instanceof DOMException) {
    if (err.name === 'TimeoutError') {
      return t('library.wiki.ingest.timeoutFailed');
    }
    if (err.name === 'AbortError') {
      return t('library.wiki.ingest.abortedFailed');
    }
  }
  if (err instanceof Error) {
    const msg = err.message || '';
    // 兼容 apiClient 包装出来的错误（ApiError 对象走 instanceof Error 时 message 为空，
    // 但 DOMException timeout 走 Error 路径时 message 是 "Request timeout after Xms"）
    if (msg.toLowerCase().includes('timeout')) {
      return t('library.wiki.ingest.timeoutFailed');
    }
    if (msg.includes('aborted')) {
      return t('library.wiki.ingest.abortedFailed');
    }
    return msg;
  }
  // ApiError 是 plain object，不是 Error 子类
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return (
      String((err as { message?: unknown }).message ?? '') ||
      t('library.wiki.ingest.ingestFailed')
    );
  }
  return t('library.wiki.ingest.ingestFailed');
}

function formatRelativeTime(
  isoString: string,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return t('library.wiki.time.justNow');
  if (minutes < 60) return t('library.wiki.time.minutesAgo', { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('library.wiki.time.hoursAgo', { hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('library.wiki.time.daysAgo', { days });
  return date.toLocaleDateString();
}
