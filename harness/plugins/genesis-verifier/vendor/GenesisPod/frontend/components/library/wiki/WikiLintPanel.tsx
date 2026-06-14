'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { Tabs } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  wikiApi,
  type WikiLintFinding,
  type WikiLintTypeStr,
} from '@/lib/api/wiki';
import { useTranslation } from '@/lib/i18n';
import { logger } from '@/lib/utils/logger';
import { confirm } from '@/stores';

const LINT_TABS: WikiLintTypeStr[] = [
  'CONTRADICTION',
  'STALE',
  'ORPHAN',
  'MISSING_XREF',
  'DATA_GAP',
];

export default function WikiLintPanel({
  kbId,
  onClose,
}: {
  kbId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<WikiLintTypeStr>('CONTRADICTION');
  const [findings, setFindings] = useState<WikiLintFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState<null | 'resolve' | 'dismiss'>(
    null
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setSelected(new Set());
    wikiApi
      .listLintFindings(kbId, { type: tab, resolved: false })
      .then((res) => setFindings(res.items))
      .catch((err) => logger?.error?.('[wiki] listLintFindings failed', err))
      .finally(() => setLoading(false));
  }, [kbId, tab]);

  useEffect(refresh, [refresh]);

  const allChecked = useMemo(
    () => findings.length > 0 && selected.size === findings.length,
    [findings.length, selected.size]
  );
  const someChecked = selected.size > 0 && !allChecked;

  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(findings.map((f) => f.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBatch = async (
    action: 'resolve' | 'dismiss',
    mode: 'selected' | 'all-in-tab'
  ) => {
    setBatchBusy(action);
    try {
      await wikiApi.batchPatchLintFindings(kbId, {
        action,
        ...(mode === 'selected'
          ? { ids: Array.from(selected) }
          : { filterAll: true, type: tab }),
      });
      refresh();
    } catch (err) {
      logger?.error?.('[wiki] batch lint failed', err);
    } finally {
      setBatchBusy(null);
    }
  };

  return (
    <div className="fixed right-0 top-0 z-30 flex h-full w-[420px] flex-col border-l border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] shadow-2xl">
      <header className="border-b border-slate-100 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-500">
              Integrity Review
            </div>
            <h3 className="text-sm font-semibold text-slate-900">
              {t('library.wiki.subheader.lint')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="border-b border-slate-100 px-4 py-3">
        <Tabs
          variant="pill"
          size="sm"
          value={tab}
          onChange={(k) => setTab(k as WikiLintTypeStr)}
          items={LINT_TABS.map((tabKey) => ({ key: tabKey, label: tabKey }))}
        />
      </div>

      {findings.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = someChecked;
              }}
              checked={allChecked}
              onChange={toggleAll}
              className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
            />
            <span>
              {selected.size > 0
                ? `已选 ${selected.size} / ${findings.length}`
                : `当前 ${findings.length} 条`}
            </span>
          </label>
          <div className="flex items-center gap-1.5">
            {selected.size > 0 ? (
              <>
                <button
                  type="button"
                  disabled={batchBusy !== null}
                  onClick={() => void runBatch('resolve', 'selected')}
                  className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {batchBusy === 'resolve' && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  解决所选
                </button>
                <button
                  type="button"
                  disabled={batchBusy !== null}
                  onClick={() => void runBatch('dismiss', 'selected')}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {batchBusy === 'dismiss' && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  忽略所选
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={batchBusy !== null}
                  onClick={() => {
                    void (async () => {
                      if (
                        await confirm({
                          title: `确认把当前 ${tab} 下全部 ${findings.length} 条都标记为已解决？`,
                          type: 'warning',
                        })
                      )
                        void runBatch('resolve', 'all-in-tab');
                    })();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {batchBusy === 'resolve' && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  全部解决
                </button>
                <button
                  type="button"
                  disabled={batchBusy !== null}
                  onClick={() => {
                    void (async () => {
                      if (
                        await confirm({
                          title: `确认把当前 ${tab} 下全部 ${findings.length} 条都忽略？`,
                          type: 'warning',
                        })
                      )
                        void runBatch('dismiss', 'all-in-tab');
                    })();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {batchBusy === 'dismiss' && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  全部忽略
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
          </div>
        ) : findings.length === 0 ? (
          <EmptyState
            size="sm"
            title={t('library.wiki.lint.emptyForCategory')}
          />
        ) : (
          <ul className="space-y-3">
            {findings.map((finding) => {
              const checked = selected.has(finding.id);
              return (
                <li
                  key={finding.id}
                  className={`rounded-2xl border bg-white p-4 shadow-sm ${
                    checked
                      ? 'border-violet-300 ring-1 ring-violet-200'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(finding.id)}
                      className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                    <span className="mt-0.5 rounded-xl bg-amber-50 p-2 text-amber-600">
                      <AlertCircle className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {finding.type}
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
                        {JSON.stringify(finding.detail, null, 2)}
                      </pre>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() =>
                            void wikiApi
                              .patchLintFinding(kbId, finding.id, 'resolve')
                              .then(refresh)
                          }
                          className="rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
                        >
                          {t('library.wiki.lint.resolve')}
                        </button>
                        <button
                          onClick={() =>
                            void wikiApi
                              .patchLintFinding(kbId, finding.id, 'dismiss')
                              .then(refresh)
                          }
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {t('library.wiki.lint.dismiss')}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="border-t border-slate-100 px-4 py-4">
        <button
          disabled={running}
          onClick={async () => {
            if (running) return;
            setRunning(true);
            try {
              await wikiApi.runLint(kbId);
              refresh();
            } catch (err) {
              logger?.error?.('[wiki] runLint failed', err);
            } finally {
              setRunning(false);
            }
          }}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {running && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('library.wiki.lint.runFullLint')}
        </button>
      </div>
    </div>
  );
}
