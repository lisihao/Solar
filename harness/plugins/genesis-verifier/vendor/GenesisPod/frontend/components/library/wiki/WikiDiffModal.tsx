'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { wikiApi, type WikiDiff } from '@/lib/api/wiki';
import { useTranslation } from '@/lib/i18n';
import { logger } from '@/lib/utils/logger';
import { Modal } from '@/components/ui/dialogs/Modal';
import { ConfirmDialog } from '@/components/ui/dialogs/ConfirmDialog';

export default function WikiDiffModal({
  kbId,
  diffId,
  onClose,
  onApplied,
}: {
  kbId: string;
  diffId: string;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<WikiDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  // 2026-05-12 Screenshot_63 fix：用项目内 dialog/banner 替代 alert/confirm
  const [applyError, setApplyError] = useState<string | null>(null);
  const [conflictPrompt, setConflictPrompt] = useState<{
    otherId: string;
    affectedKeys: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    wikiApi
      .getDiff(kbId, diffId)
      .then((data) => {
        if (cancelled) return;
        setDiff(data);
        setSelected(
          new Set<string>([
            ...data.items.creates.map((item) => item.slug),
            ...data.items.updates.map((item) => item.slug),
            ...data.items.deletes,
          ])
        );
      })
      .catch((err) => logger?.error?.('[wiki] getDiff failed', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kbId, diffId]);

  const conflicted = diff?.status === 'CONFLICTED';
  const counts = diff
    ? {
        creates: diff.items.creates.length,
        updates: diff.items.updates.length,
        deletes: diff.items.deletes.length,
      }
    : { creates: 0, updates: 0, deletes: 0 };

  return (
    <>
      <Modal
        open={true}
        onClose={onClose}
        title={
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-500">
              Diff Review
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {t('library.wiki.diff.title')}
            </div>
            {diff && (
              <p className="text-xs text-slate-500">
                {t('library.wiki.diff.totalItems', {
                  count: diff.affectedKeys.length,
                  status: diff.status,
                })}
              </p>
            )}
          </div>
        }
        size="2xl"
        headerClassName="border-b border-slate-200 px-6 py-4"
        contentClassName="p-0 flex flex-col overflow-hidden bg-slate-50/70"
        footer={
          <>
            <button
              disabled={applying}
              onClick={async () => {
                if (!diff) return;
                try {
                  await wikiApi.patchDiff(kbId, diff.id, 'dismiss');
                  onClose();
                } catch (err) {
                  logger?.error?.('[wiki] dismiss diff failed', err);
                }
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {t('library.wiki.diff.dismissAll')}
            </button>
            <button
              disabled={applying || conflicted || selected.size === 0}
              onClick={async () => {
                if (!diff) return;
                setApplying(true);
                setApplyError(null);
                try {
                  await wikiApi.patchDiff(
                    kbId,
                    diff.id,
                    'apply',
                    Array.from(selected),
                    undefined
                  );
                  onApplied?.();
                  onClose();
                } catch (err) {
                  logger?.error?.('[wiki] apply diff failed', err);
                  const raw =
                    (
                      err as {
                        response?: { data?: { message?: string } };
                        message?: string;
                      }
                    ).response?.data?.message ??
                    (err as Error).message ??
                    '';
                  // 2026-05-12 (P3 BLOCKER C2)：backend 引入 locale 维度后 message
                  // 实际格式是 "on (slug:locale): k1, k2"。原 regex 匹配旧
                  // "on slug(s):"，永远 null 走 alert(raw) 弹英文报错。
                  // 新 regex 兼容两种格式，并把 alert/confirm 改为项目内 UI。
                  const conflictMatch =
                    /conflicts with PENDING diff ([\w-]+) on (?:\(slug:locale\)|slug\(s\)): (.+)/.exec(
                      raw
                    );
                  if (conflictMatch) {
                    const [, otherId, affectedKeys] = conflictMatch;
                    setConflictPrompt({ otherId, affectedKeys });
                  } else {
                    setApplyError(raw || t('library.wiki.diff.applyFailed'));
                  }
                } finally {
                  setApplying(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
            >
              {applying && <Loader2 className="h-4 w-4 animate-spin" />}
              {selected.size > 0
                ? t('library.wiki.diff.applyWithCount', {
                    count: selected.size,
                  })
                : t('library.wiki.diff.apply')}
            </button>
          </>
        }
        footerClassName="border-t border-slate-200 px-6 py-3"
      >
        {conflicted && (
          <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800">
            {t('library.wiki.diff.baselineMismatch')}
          </div>
        )}
        {/* 2026-05-12 Screenshot_63: alert() → inline banner */}
        {applyError && (
          <div className="flex items-start justify-between gap-3 border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-800">
            <span className="break-words">{applyError}</span>
            <button
              onClick={() => setApplyError(null)}
              className="shrink-0 text-rose-500 hover:text-rose-700"
              aria-label="dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading || !diff ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <DiffStatCard
                  label="Create"
                  value={counts.creates}
                  tone="blue"
                />
                <DiffStatCard
                  label="Update"
                  value={counts.updates}
                  tone="amber"
                />
                <DiffStatCard
                  label="Delete"
                  value={counts.deletes}
                  tone="rose"
                />
              </div>
              <DiffSection title="Creates" count={counts.creates}>
                {diff.items.creates.map((item) => (
                  <DiffItemCard
                    key={`c-${item.slug}`}
                    kind="CREATE"
                    slug={item.slug}
                    selected={selected.has(item.slug)}
                    onToggle={() => toggle(selected, setSelected, item.slug)}
                    preview={item.body.slice(0, 600)}
                    meta={`${item.category} - ${item.title}`}
                  />
                ))}
              </DiffSection>
              <DiffSection title="Updates" count={counts.updates}>
                {diff.items.updates.map((item) => (
                  <DiffItemCard
                    key={`u-${item.slug}`}
                    kind="UPDATE"
                    slug={item.slug}
                    selected={selected.has(item.slug)}
                    onToggle={() => toggle(selected, setSelected, item.slug)}
                    preview={item.newBody.slice(0, 600)}
                    meta={item.newOneLiner ?? ''}
                  />
                ))}
              </DiffSection>
              <DiffSection title="Deletes" count={counts.deletes}>
                {diff.items.deletes.map((slug) => (
                  <DiffItemCard
                    key={`d-${slug}`}
                    kind="DELETE"
                    slug={slug}
                    selected={selected.has(slug)}
                    onToggle={() => toggle(selected, setSelected, slug)}
                    preview={t('library.wiki.diff.deletedPreview')}
                    meta=""
                  />
                ))}
              </DiffSection>
            </div>
          )}
        </div>
      </Modal>
      {/* 2026-05-12 Screenshot_63: confirm() → ConfirmDialog */}
      {conflictPrompt && diff && (
        <ConfirmDialog
          open={!!conflictPrompt}
          onClose={() => setConflictPrompt(null)}
          onConfirm={async () => {
            setApplying(true);
            try {
              await wikiApi.patchDiff(
                kbId,
                diff.id,
                'apply',
                Array.from(selected),
                { supersedeConflictingDiffs: true }
              );
              setConflictPrompt(null);
              onApplied?.();
              onClose();
            } catch (e2) {
              logger?.error?.('[wiki] supersede apply failed', e2);
              const msg =
                (
                  e2 as {
                    response?: { data?: { message?: string } };
                    message?: string;
                  }
                ).response?.data?.message ??
                (e2 as Error).message ??
                t('library.wiki.diff.applyFailed');
              setConflictPrompt(null);
              setApplyError(msg);
            } finally {
              setApplying(false);
            }
          }}
          title={t('library.wiki.diff.conflict.title')}
          description={t('library.wiki.diff.conflict.message', {
            otherId: conflictPrompt.otherId.slice(0, 8),
            keys: conflictPrompt.affectedKeys,
          })}
          type="warning"
          confirmText={t('library.wiki.diff.conflict.confirm')}
          cancelText={t('library.wiki.diff.conflict.cancel')}
          loading={applying}
        />
      )}
    </>
  );
}

function DiffSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-500 shadow-sm ring-1 ring-slate-200">
          {count}
        </span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function DiffStatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'blue' | 'amber' | 'rose';
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
  }[tone];
  return (
    <div className={`rounded-2xl px-4 py-3 ring-1 ${toneClass}`}>
      <div className="text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function DiffItemCard({
  kind,
  slug,
  selected,
  onToggle,
  preview,
  meta,
}: {
  kind: 'CREATE' | 'UPDATE' | 'DELETE';
  slug: string;
  selected: boolean;
  onToggle: () => void;
  preview: string;
  meta: string;
}) {
  const edge = {
    CREATE: 'border-l-blue-500',
    UPDATE: 'border-l-amber-500',
    DELETE: 'border-l-red-500',
  }[kind];
  const tag = {
    CREATE: 'bg-blue-100 text-blue-800',
    UPDATE: 'bg-amber-100 text-amber-800',
    DELETE: 'bg-red-100 text-red-800',
  }[kind];

  return (
    <div className={`rounded-2xl border border-l-4 ${edge} bg-white shadow-sm`}>
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 rounded border-gray-300 text-violet-600"
        />
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tag}`}>
          {kind}
        </span>
        <code className="text-sm font-medium text-slate-900">{slug}</code>
        {meta && <span className="text-xs text-slate-500">- {meta}</span>}
      </div>
      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 text-xs leading-5 text-slate-700">
        {preview}
      </pre>
    </div>
  );
}

function toggle(
  current: Set<string>,
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  key: string
): void {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  setter(next);
}
