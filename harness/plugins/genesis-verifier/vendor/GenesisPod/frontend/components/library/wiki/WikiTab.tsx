'use client';

/**
 * Wiki Tab � v1.5.3 P3a/P3b core UI.
 *
 * Single-file composition of the core surface (kept together to minimize
 * cross-file orchestration during initial integration). Splits naturally
 * into one-component-per-file when iteration begins.
 *
 * Implements (per llm-wiki �7):
 *  �7.1 LibraryTabs first-tab + default-active (handled in page.tsx)
 *  �7.3 KB selector with 5-step resolution chain
 *      URL ?kb= ? localStorage:lastWikiKbId:<userHash> ? unique
 *      wikiEnabled ? most-recently-edited wikiEnabled ? guidance
 *  �7.5 three-state empty funnel (0 KB / 0 wikiEnabled / 0 page)
 *  �7.7 URL state machine with mutex for ?diff= modal vs ?lint=1/?log=1
 *      drawer (drawers can stack with ?page=, but ?diff= preempts both)
 *  �7.2 Wiki sub-header (KB selector + Toolbar)
 *
 * Defers (P3a follow-up sub-iteration):
 *  - Full split-diff renderer with three-color edges (uses textual
 *    side-by-side preview here)
 *  - Lint Drawer / Log Drawer / Query Panel as standalone components
 *    (compact stubs included so URL state machine is wired and exercised)
 *  - WikiPageEmbedding-driven Branch B query (backend already handles
 *    the fallback warning)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/stores';
import {
  AlertCircle,
  BookOpen,
  ChevronLeft,
  Download,
  FileSearch,
  GitMerge,
  Loader2,
  MessageCircle,
  Network,
  PencilLine,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import {
  wikiApi,
  type WikiDiff,
  type WikiIngestProgress,
  type WikiKbSummary,
  type WikiLintFinding,
  type WikiLintTypeStr,
  type WikiOp,
  type WikiOperationLogEntry,
  type WikiPage,
  type WikiPageCategory,
  type WikiPageWithLinks,
  type WikiQueryResponse,
} from '@/lib/api/wiki';
import { logger } from '@/lib/utils/logger';
import { useTranslation } from '@/lib/i18n';
import rehypeSanitize from 'rehype-sanitize';
import { MarkdownViewer } from '@/components/common/markdown-viewer';
import { katexAwareSchema } from '@/lib/markdown/katexAwareSchema';
import { preprocessWikiBody } from '@/lib/wiki/wikilink-preprocess';
import WikiGraphModal from './WikiGraphModal';
import WikiSettingsModal from './WikiSettingsModal';
import WikiCardGrid from './WikiCardGrid';
import WikiIngestWorkspaceModal from './WikiIngestModal';
import WikiChromeHeader from './WikiChromeHeader';
import WikiReaderPane from './WikiReaderPane';
import WikiQueryDrawer from './WikiQueryDrawer';
import WikiDiffModal from './WikiDiffModal';
import WikiLintPanel from './WikiLintPanel';
import WikiActivityDrawer from './WikiActivityDrawer';
import {
  useWikiIngestInflightProbe,
  useWikiIngestPolling,
} from './useWikiIngestPolling';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { Modal } from '@/components/ui/dialogs/Modal';
import { Tabs } from '@/components/ui/tabs';

// Extend the default sanitizer to allow our internal `wikilink:` scheme on
// anchor href attributes � without this, rehype-sanitize strips the href and
// our [[slug]] click handler never fires (silent break).
const WIKI_SANITIZE_SCHEMA = {
  ...katexAwareSchema,
  protocols: {
    ...(katexAwareSchema.protocols ?? {}),
    href: [...(katexAwareSchema.protocols?.href ?? []), 'wikilink'],
  },
};

// --- localStorage key helpers (per �7.1 �11 v1.5.x cross-user isolation) ---

function userKey(prefix: string, userHash: string): string {
  return `${prefix}:${userHash}`;
}

function writeLocalStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore (quota / private mode)
  }
}

// --- KB context resolver ---
//
// Landing UX: when no `?kb=` is in the URL we render a card grid so the
// user explicitly picks a KB. Once `?kb={id}` is set we render the detail
// view. The previous 5-step auto-pick (URL ? localStorage ? unique ?
// most-recent ? empty funnel) was bypassing the grid for returning users
// and is now reduced to "URL only".

interface ResolveResult {
  kbId: string | null;
  kbs: WikiKbSummary[];
  emptyKind: 'no-kb' | 'has-kb-no-wiki' | null;
  loading: boolean;
}

function useResolvedKb(
  userHash: string,
  urlKbId: string | null
): ResolveResult & { refresh: () => void } {
  const [kbs, setKbs] = useState<WikiKbSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    wikiApi
      .listKbs()
      .then((res) => {
        if (cancelled) return;
        setKbs(res.items);
      })
      .catch((err) => {
        logger?.error?.('[wiki] listKbs failed', err);
        if (!cancelled) setKbs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick, userHash]);

  const resolved = useMemo<{
    kbId: string | null;
    emptyKind: 'no-kb' | 'has-kb-no-wiki' | null;
  }>(() => {
    if (loading) return { kbId: null, emptyKind: null };

    // Only honor an explicit URL kbId that exists in the wikiEnabled set.
    if (urlKbId && kbs.some((kb) => kb.id === urlKbId)) {
      return { kbId: urlKbId, emptyKind: null };
    }

    // No URL kb ? caller decides between grid (kbs.length > 0) and the
    // empty funnel (kbs.length === 0). We surface emptyKind for the latter.
    if (kbs.length === 0) {
      return { kbId: null, emptyKind: 'has-kb-no-wiki' };
    }

    return { kbId: null, emptyKind: null };
  }, [kbs, loading, urlKbId]);

  return {
    ...resolved,
    kbs,
    loading,
    refresh: () => setRefreshTick((t) => t + 1),
  };
}

// --- URL state derivation (�7.7) ---

interface UrlState {
  kbId: string | null;
  pageSlug: string | null;
  diffId: string | null;
  lintOpen: boolean;
  logOpen: boolean;
  graphOpen: boolean;
}

function readUrlState(searchParams: URLSearchParams): UrlState {
  const diffId = searchParams.get('diff');
  return {
    kbId: searchParams.get('kb'),
    pageSlug: searchParams.get('page'),
    diffId,
    // Mutex: diff modal preempts drawers; among drawers, lint > log
    lintOpen: !diffId && searchParams.get('lint') === '1',
    logOpen:
      !diffId &&
      searchParams.get('log') === '1' &&
      searchParams.get('lint') !== '1',
    graphOpen: !diffId && searchParams.get('graph') === '1',
  };
}

// --- Public component ---

interface WikiTabProps {
  /**
   * Stable per-user hash for localStorage key isolation. The page.tsx host
   * passes a derivable hash (e.g. session userId hashed) so that a shared
   * browser doesn't leak the previous user's lastWikiKbId / toast sentinel.
   * For the integration MVP a stable session-scoped string is enough.
   */
  userHash: string;
}

export default function WikiTab({ userHash }: WikiTabProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlState = readUrlState(
    new URLSearchParams(searchParams?.toString() ?? '')
  );

  const { kbId, kbs, loading, emptyKind, refresh } = useResolvedKb(
    userHash,
    urlState.kbId
  );

  const [ingestOpen, setIngestOpen] = useState(false);
  const [enableOpen, setEnableOpen] = useState(false);
  const [queryOpen, setQueryOpen] = useState(false);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  // 2026-05-19 fire-and-forget 进度感知（基于后端真实 in-memory 进度）：
  //   - 每 3s 轮询 GET /library/wiki/:kbId/ingest-progress
  //   - 真实 stage / pagesDone / pagesTotal 替代之前的瞎猜 setTimeout
  //   - 完成时 banner 显示完成 + diffId 链接
  //   - 失败时显示具体 errorMessage
  //   - 后端 5min cleanup 后 progress=null → banner 消失停止轮询
  const [ingestProgress, setIngestProgress] =
    useState<WikiIngestProgress | null>(null);
  const [ingestActive, setIngestActive] = useState(false);

  // 2026-05-13: 轮询 + in-flight 探测逻辑见 useWikiIngestPolling.ts
  // 修过 Screenshot_77 的"首次进度条不显示，须刷新浏览器才出现" race。
  useWikiIngestPolling({
    ingestActive,
    kbId: urlState.kbId,
    setIngestProgress,
    setIngestActive,
  });
  useWikiIngestInflightProbe(urlState.kbId, setIngestProgress, setIngestActive);

  const startIngestPending = useCallback(() => {
    setIngestActive(true);
    setIngestProgress({
      status: 'running',
      stage: 'starting',
      startedAt: new Date().toISOString(),
      passMode: 'SINGLE', // 占位；首次 poll 后被真实 passMode 替换
    });
  }, []);

  const dismissIngestPending = useCallback(() => {
    setIngestActive(false);
    setIngestProgress(null);
  }, []);
  // Grid-view (no kbId selected) per-card edit / disable. We track which kb
  // the user invoked the action on so the modal / confirm targets that row.
  const [gridEditKbId, setGridEditKbId] = useState<string | null>(null);
  const [gridDisableKbId, setGridDisableKbId] = useState<string | null>(null);
  const [gridDisableBusy, setGridDisableBusy] = useState(false);
  // Bumped after diff apply / page create so the reader re-fetches its list
  // and active body without requiring a manual browser refresh.
  const [readerRefreshTick, setReaderRefreshTick] = useState(0);

  // Persist active kbId to localStorage so other surfaces (e.g. ingest
  // shortcut from elsewhere) still know the user's last picked KB. We
  // intentionally no longer auto-resolve from it � see useResolvedKb.
  useEffect(() => {
    if (!kbId) return;
    writeLocalStorage(userKey('lastWikiKbId', userHash), kbId);
  }, [kbId, userHash]);

  const goToGrid = useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', 'wiki');
    params.delete('kb');
    params.delete('page');
    params.delete('diff');
    params.delete('lint');
    params.delete('log');
    params.delete('graph');
    router.replace(`/library?${params.toString()}`);
  }, [router, searchParams]);

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
      </div>
    );
  }

  if (!kbId) {
    // 0 wiki-enabled KBs ? empty funnel; otherwise ? card grid landing
    if (kbs.length === 0) {
      return (
        <>
          <WikiEmptyState
            kind={emptyKind ?? 'has-kb-no-wiki'}
            onRefresh={refresh}
            onEnable={() => setEnableOpen(true)}
          />
          {enableOpen && (
            <WikiEnableToggleModal
              onClose={() => setEnableOpen(false)}
              onEnabled={(newKbId) => {
                setEnableOpen(false);
                const params = new URLSearchParams(
                  searchParams?.toString() ?? ''
                );
                params.set('tab', 'wiki');
                params.set('kb', newKbId);
                router.replace(`/library?${params.toString()}`);
                refresh();
              }}
            />
          )}
        </>
      );
    }

    return (
      <>
        <WikiCardGrid
          kbs={kbs}
          onOpen={(id) => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.set('tab', 'wiki');
            params.set('kb', id);
            params.delete('page');
            router.replace(`/library?${params.toString()}`);
          }}
          onEnableMore={() => setEnableOpen(true)}
          onEdit={(id) => setGridEditKbId(id)}
          onDisable={(id) => setGridDisableKbId(id)}
        />
        {enableOpen && (
          <WikiEnableToggleModal
            onClose={() => setEnableOpen(false)}
            onEnabled={(newKbId) => {
              setEnableOpen(false);
              const params = new URLSearchParams(
                searchParams?.toString() ?? ''
              );
              params.set('tab', 'wiki');
              params.set('kb', newKbId);
              router.replace(`/library?${params.toString()}`);
              refresh();
            }}
          />
        )}
        {gridEditKbId && (
          <WikiSettingsModal
            kbId={gridEditKbId}
            onClose={() => setGridEditKbId(null)}
          />
        )}
        {gridDisableKbId && (
          <WikiDisableConfirmDialog
            kbName={
              kbs.find((kb) => kb.id === gridDisableKbId)?.name ??
              gridDisableKbId
            }
            busy={gridDisableBusy}
            onCancel={() => {
              if (!gridDisableBusy) setGridDisableKbId(null);
            }}
            onConfirm={(alsoDestroyData) => {
              if (gridDisableBusy) return;
              setGridDisableBusy(true);
              void (async () => {
                try {
                  if (alsoDestroyData) {
                    // W5: destructive hard delete also flips wikiEnabled=false
                    // in the same tx, so we don't need to call toggle separately.
                    await wikiApi.destroyWikiData(gridDisableKbId);
                  } else {
                    await wikiApi.toggleWikiEnabled(gridDisableKbId, false);
                  }
                  setGridDisableKbId(null);
                  refresh();
                } catch (err) {
                  logger?.error?.('[wiki] disable failed', err);
                } finally {
                  setGridDisableBusy(false);
                }
              })();
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <WikiChromeHeader
        kbs={kbs}
        currentKbId={kbId}
        onBackToGrid={goToGrid}
        onSelectKb={(id) => {
          const params = new URLSearchParams(searchParams?.toString() ?? '');
          params.set('tab', 'wiki');
          params.set('kb', id);
          params.delete('page');
          router.replace(`/library?${params.toString()}`);
        }}
        onEnableOther={() => setEnableOpen(true)}
        onIngest={() => setIngestOpen(true)}
        onLint={() => {
          const params = new URLSearchParams(searchParams?.toString() ?? '');
          params.set('lint', '1');
          params.delete('log');
          params.delete('diff');
          router.replace(`/library?${params.toString()}`);
        }}
        onQuery={() => setQueryOpen(true)}
        onLog={() => {
          const params = new URLSearchParams(searchParams?.toString() ?? '');
          params.set('log', '1');
          params.delete('lint');
          params.delete('diff');
          params.delete('graph');
          router.replace(`/library?${params.toString()}`);
        }}
        onGraph={() => {
          const params = new URLSearchParams(searchParams?.toString() ?? '');
          params.set('graph', '1');
          params.delete('lint');
          params.delete('log');
          params.delete('diff');
          router.replace(`/library?${params.toString()}`);
        }}
        onExport={() => {
          if (exporting) return;
          setExporting(true);
          void exportWikiAsMarkdown(
            kbId,
            kbs.find((kb) => kb.id === kbId)?.name ?? 'wiki',
            t
          ).finally(() => setExporting(false));
        }}
        exporting={exporting}
        onSettings={() => setSettingsOpen(true)}
      />

      {ingestProgress != null && (
        <IngestPendingBanner
          progress={ingestProgress}
          onDismiss={dismissIngestPending}
          onOpenDiff={(diffId) => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.set('diff', diffId);
            router.replace(`/library?${params.toString()}`);
            dismissIngestPending();
          }}
        />
      )}

      <div className="flex-1 overflow-hidden">
        <WikiReaderPane
          kbId={kbId}
          activeSlug={urlState.pageSlug}
          refreshKey={readerRefreshTick}
          // W3-P0 gap #2: thread KB.enabledLocales so the pane can render
          // the zh/en switcher on bilingual KBs and scope page fetches.
          enabledLocales={kbs.find((kb) => kb.id === kbId)?.enabledLocales}
          onSelectSlug={(slug) => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.set('page', slug);
            router.replace(`/library?${params.toString()}`);
          }}
          onIngest={() => setIngestOpen(true)}
          onCreatePage={() => setCreatePageOpen(true)}
        />
      </div>

      {urlState.diffId && (
        <WikiDiffModal
          kbId={kbId}
          diffId={urlState.diffId}
          onApplied={() => setReaderRefreshTick((n) => n + 1)}
          onClose={() => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.delete('diff');
            router.replace(`/library?${params.toString()}`);
          }}
        />
      )}

      {urlState.lintOpen && (
        <WikiLintPanel
          kbId={kbId}
          onClose={() => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.delete('lint');
            router.replace(`/library?${params.toString()}`);
          }}
        />
      )}

      {urlState.logOpen && (
        <WikiActivityDrawer
          kbId={kbId}
          onClose={() => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.delete('log');
            router.replace(`/library?${params.toString()}`);
          }}
        />
      )}

      {urlState.graphOpen && (
        <WikiGraphModal
          kbId={kbId}
          onClose={() => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.delete('graph');
            router.replace(`/library?${params.toString()}`);
          }}
          onSelectSlug={(slug) => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.delete('graph');
            params.set('page', slug);
            router.replace(`/library?${params.toString()}`);
          }}
        />
      )}

      {ingestOpen && (
        <IngestPickerModal
          kbId={kbId}
          onClose={() => setIngestOpen(false)}
          onIngested={(diffId, isAsync) => {
            setIngestOpen(false);
            // 2026-05-19 fire-and-forget：异步路径不跳 diff 详情（id 是
            // 'processing' 不存在），改成在 wiki 顶部展示常驻 banner，用户
            // 能看到「正在运行」+ 计时；10 分钟自动消失或手动 dismiss。
            if (isAsync) {
              startIngestPending();
              return;
            }
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.set('diff', diffId);
            router.replace(`/library?${params.toString()}`);
          }}
        />
      )}

      {queryOpen && (
        <WikiQueryDrawer
          kbId={kbId}
          onClose={() => setQueryOpen(false)}
          onSelectSlug={(slug) => {
            setQueryOpen(false);
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.set('page', slug);
            router.replace(`/library?${params.toString()}`);
          }}
        />
      )}

      {createPageOpen && (
        <CreateWikiPageModal
          kbId={kbId}
          onClose={() => setCreatePageOpen(false)}
          onCreated={(slug) => {
            setCreatePageOpen(false);
            setReaderRefreshTick((n) => n + 1);
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.set('page', slug);
            router.replace(`/library?${params.toString()}`);
          }}
        />
      )}

      {settingsOpen && (
        <WikiSettingsModal kbId={kbId} onClose={() => setSettingsOpen(false)} />
      )}

      {enableOpen && (
        <WikiEnableToggleModal
          onClose={() => setEnableOpen(false)}
          onEnabled={(newKbId) => {
            setEnableOpen(false);
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.set('tab', 'wiki');
            params.set('kb', newKbId);
            params.delete('page');
            router.replace(`/library?${params.toString()}`);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// --- Sub-components ---

interface WikiSubHeaderProps {
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

function WikiSubHeader({
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
}: WikiSubHeaderProps) {
  const { t } = useTranslation();
  const current = kbs.find((kb) => kb.id === currentKbId);
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white px-8 py-3">
      <div className="relative flex items-center gap-3 text-sm">
        <button
          onClick={onBackToGrid}
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-violet-700"
          title={t('library.wiki.kbSelector.backToGrid')}
        >
          <ChevronLeft className="h-4 w-4" />
          {t('library.wiki.kbSelector.backToGrid')}
        </button>
        <BookOpen className="h-5 w-5 text-violet-500" />
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-gray-100"
        >
          <span className="font-medium text-gray-900">
            {current?.name ?? t('library.wiki.kbSelector.selectKb')}
          </span>
          <span className="text-xs text-gray-500">?</span>
        </button>
        {current && (
          <span className="text-xs text-gray-500">
            � {pluralizePages(t, current.pageCount)}
            {current.lastIngestAt
              ? ` � ${t('library.wiki.kbSelector.lastIngest', { time: formatRelativeTime(current.lastIngestAt, t) })}`
              : ''}
          </span>
        )}
        {open && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
              <div className="border-b border-gray-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                {t('library.wiki.kbSelector.switchTo')}
              </div>
              <div className="max-h-80 overflow-y-auto py-1">
                {kbs.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-gray-500">
                    {t('library.wiki.kbSelector.noWikiKb')}
                  </div>
                ) : (
                  kbs.map((kb) => (
                    <button
                      key={kb.id}
                      onClick={() => {
                        onSelectKb(kb.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                        kb.id === currentKbId
                          ? 'bg-violet-50 text-violet-700'
                          : 'text-gray-900'
                      }`}
                    >
                      <span className="truncate">{kb.name}</span>
                      <span className="ml-3 shrink-0 text-xs text-gray-500">
                        {pluralizePages(t, kb.pageCount)}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className="border-t border-gray-100 py-1">
                <button
                  onClick={() => {
                    onEnableOther();
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-violet-700 hover:bg-violet-50"
                >
                  <Plus className="h-4 w-4" />
                  {t('library.wiki.kbSelector.enableOther')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ToolButton icon={<Plus className="h-4 w-4" />} onClick={onIngest}>
          {t('library.wiki.subheader.ingest')}
        </ToolButton>
        <ToolButton icon={<GitMerge className="h-4 w-4" />} onClick={onLint}>
          {t('library.wiki.subheader.lint')}
        </ToolButton>
        <ToolButton
          icon={<MessageCircle className="h-4 w-4" />}
          onClick={onQuery}
        >
          {t('library.wiki.subheader.query')}
        </ToolButton>
        <ToolButton icon={<RefreshCw className="h-4 w-4" />} onClick={onLog}>
          {t('library.wiki.subheader.log')}
        </ToolButton>
        <ToolButton icon={<Network className="h-4 w-4" />} onClick={onGraph}>
          {t('library.wiki.subheader.graph')}
        </ToolButton>
        <ToolButton
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
        </ToolButton>
        <button
          onClick={onSettings}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          title={t('library.wiki.subheader.settings')}
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ToolButton({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
    >
      {icon}
      {children}
    </button>
  );
}

// --- Page reader (left list + center markdown) ---

interface WikiPageReaderProps {
  kbId: string;
  activeSlug: string | null;
  refreshKey?: number;
  onSelectSlug: (slug: string) => void;
  onIngest?: () => void;
  onCreatePage?: () => void;
}

function pickFirstSlug(pages: WikiPage[]): string | null {
  if (pages.length === 0) return null;
  const grouped: Record<string, WikiPage[]> = {
    SUMMARY: [],
    ENTITY: [],
    CONCEPT: [],
    SOURCE: [],
  };
  for (const p of pages) grouped[p.category].push(p);
  return (
    grouped.SUMMARY[0]?.slug ??
    grouped.ENTITY[0]?.slug ??
    grouped.CONCEPT[0]?.slug ??
    pages[0]?.slug ??
    null
  );
}

function WikiPageReader({
  kbId,
  activeSlug,
  refreshKey = 0,
  onSelectSlug,
  onIngest,
  onCreatePage,
}: WikiPageReaderProps) {
  const { t } = useTranslation();
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<WikiPageWithLinks | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  // Per-KB latch so the auto-redirect to the first page only fires once
  // when the user enters the KB without a `?page=` selection.
  const autoPickedKbRef = useRef<string | null>(null);
  // Hold the latest onSelectSlug without making it a deps-trigger; the
  // parent recreates it on every render so adding it to deps would loop.
  const onSelectSlugRef = useRef(onSelectSlug);
  onSelectSlugRef.current = onSelectSlug;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    wikiApi
      .listPages(kbId)
      .then((res) => {
        if (cancelled) return;
        setPages(res.items);
      })
      .catch((err) => {
        logger?.error?.('[wiki] listPages failed', err);
        if (!cancelled) setPages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kbId, refreshKey]);

  // Reset the auto-pick latch when switching KBs so each KB can auto-pick
  // its first page exactly once.
  useEffect(() => {
    if (autoPickedKbRef.current !== kbId) {
      autoPickedKbRef.current = null;
    }
  }, [kbId]);

  // No `?page=` in URL but pages are loaded ? align URL to the first slug
  // so the right pane fetches and renders instead of showing the
  // "select from left" hint.
  useEffect(() => {
    if (loading) return;
    if (activeSlug) return;
    if (autoPickedKbRef.current === kbId) return;
    const first = pickFirstSlug(pages);
    if (!first) return;
    autoPickedKbRef.current = kbId;
    onSelectSlugRef.current(first);
  }, [loading, activeSlug, pages, kbId]);

  useEffect(() => {
    if (!activeSlug) {
      setActive(null);
      return;
    }
    let cancelled = false;
    setActiveLoading(true);
    wikiApi
      .getPage(kbId, activeSlug)
      .then((res) => {
        if (!cancelled) setActive(res);
      })
      .catch((err) => {
        logger?.error?.('[wiki] getPage failed', err);
        if (!cancelled) setActive(null);
      })
      .finally(() => {
        if (!cancelled) setActiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kbId, activeSlug, refreshKey]);

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <ZeroPageGuide
        kbId={kbId}
        onIngest={onIngest}
        onCreatePage={onCreatePage}
      />
    );
  }

  // Group pages by category
  const grouped: Record<string, WikiPage[]> = {
    SUMMARY: [],
    ENTITY: [],
    CONCEPT: [],
    SOURCE: [],
  };
  for (const p of pages) grouped[p.category].push(p);

  // Highlight the first available page until the URL redirect lands.
  const effectiveActiveSlug = activeSlug ?? pickFirstSlug(pages);

  return (
    <div className="flex h-full">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 px-4 py-4">
        {(['SUMMARY', 'ENTITY', 'CONCEPT', 'SOURCE'] as const).map((cat) =>
          grouped[cat].length > 0 ? (
            <div key={cat} className="mb-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {cat}
              </div>
              <ul className="space-y-0.5">
                {grouped[cat].map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => onSelectSlug(p.slug)}
                      className={`block w-full truncate rounded px-2 py-1 text-left text-sm ${
                        effectiveActiveSlug === p.slug
                          ? 'bg-violet-100 text-violet-900'
                          : 'text-gray-700 hover:bg-gray-200'
                      }`}
                      title={p.oneLiner}
                    >
                      {p.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        )}
      </aside>

      <main className="flex-1 overflow-y-auto px-10 py-8">
        {activeLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
        ) : active ? (
          <WikiMarkdownView
            pageWithLinks={active}
            onSelectSlug={onSelectSlug}
          />
        ) : (
          <div className="text-sm text-gray-500">
            {t('library.wiki.reader.selectFromLeft')}
          </div>
        )}
      </main>
    </div>
  );
}

function WikiMarkdownView({
  pageWithLinks,
  onSelectSlug,
}: {
  pageWithLinks: WikiPageWithLinks;
  onSelectSlug: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const { page, outboundLinks, backlinks } = pageWithLinks;
  // 2026-05-14 multi-locale title rebuild: outbound 现在是 {slug, title, exists, locale}
  const knownSlugs = useMemo(
    () => new Set(outboundLinks.filter((l) => l.exists).map((l) => l.slug)),
    [outboundLinks]
  );
  const titleBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of outboundLinks) m.set(l.slug, l.title);
    return m;
  }, [outboundLinks]);

  // 2026-05-14: 复用 preprocessWikiBody helper（同时处理 [[slug]] 和兜底
  // inline code `slug` 形态，避免 LLM ingest 错用语法导致前端看到拼音）。
  const preprocessed = useMemo(
    () => preprocessWikiBody(page.body, titleBySlug),
    [page.body, titleBySlug]
  );

  return (
    <article className="mx-auto max-w-3xl">
      <header className="mb-6">
        <div className="mb-2 inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
          {page.category}
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">{page.title}</h1>
        <p className="mt-2 text-sm text-gray-600">{page.oneLiner}</p>
        <p className="mt-1 text-xs text-gray-400">
          {t('library.wiki.reader.lastEditedBy', {
            by: (page.lastEditedBy ?? '').toLowerCase() || '�',
            time: formatRelativeTime(page.updatedAt, t),
          })}
        </p>
      </header>
      <div className="prose prose-sm max-w-none text-gray-800">
        <MarkdownViewer
          content={preprocessed}
          enableBulletStrip={false}
          components={{
            a({ href, children, ...rest }) {
              if (typeof href === 'string' && href.startsWith('wikilink:')) {
                const slug = href.slice('wikilink:'.length);
                const exists = knownSlugs.has(slug);
                return (
                  <button
                    type="button"
                    onClick={() => onSelectSlug(slug)}
                    className={
                      exists
                        ? 'rounded bg-violet-50 px-1.5 py-0.5 text-violet-700 no-underline hover:bg-violet-100'
                        : 'rounded border border-dashed border-red-300 px-1.5 py-0.5 text-red-600 no-underline hover:bg-red-50'
                    }
                    title={exists ? `Open ${slug}` : `Create ${slug} (missing)`}
                  >
                    {children}
                  </button>
                );
              }
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...rest}
                >
                  {children}
                </a>
              );
            },
          }}
          rehypePluginsExtra={[[rehypeSanitize, WIKI_SANITIZE_SCHEMA]]}
          // Allowlist: pass wikilink:slug (own scheme), http(s)/mailto/tel,
          // and relative/anchor URLs through; everything else (incl.
          // javascript:, data:) returns '' so the anchor renders without
          // href. rehype-sanitize is also applied as defense in depth.
          urlTransform={(url) => {
            if (typeof url !== 'string') return '';
            if (url.startsWith('wikilink:')) return url;
            if (/^(https?|mailto|tel):/i.test(url)) return url;
            if (url.startsWith('/') || url.startsWith('#')) return url;
            return '';
          }}
        />
      </div>
      {backlinks.length > 0 && (
        <section className="mt-8 border-t border-gray-200 pt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t('library.wiki.reader.backlinks', { count: backlinks.length })}
          </div>
          <div className="flex flex-wrap gap-2">
            {backlinks.map((link) => (
              <button
                key={`${link.slug}::${link.locale}`}
                onClick={() => onSelectSlug(link.slug)}
                title={link.slug}
                className="rounded bg-gray-100 px-2 py-0.5 text-xs text-violet-700 hover:bg-violet-50"
              >
                {link.title}
              </button>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

// --- Empty state (�7.5 three-state funnel) ---

function WikiEmptyState({
  kind,
  onRefresh,
  onEnable,
}: {
  kind: 'no-kb' | 'has-kb-no-wiki';
  onRefresh: () => void;
  onEnable: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 text-white">
        <BookOpen className="h-8 w-8" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold text-gray-900">
        {kind === 'no-kb'
          ? t('library.wiki.empty.welcome')
          : t('library.wiki.empty.notEnabled')}
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-gray-600">
        {t('library.wiki.empty.intro')}
      </p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          onClick={onEnable}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700"
        >
          {t('library.wiki.empty.enableForKb')}
        </button>
        <button
          onClick={onRefresh}
          className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('library.wiki.empty.refreshList')}
        </button>
      </div>
      <p className="mt-6 text-xs text-gray-500">
        {t('library.wiki.empty.roleHint')}
      </p>
    </div>
  );
}

function ZeroPageGuide({
  kbId: _kbId,
  onIngest,
  onCreatePage,
}: {
  kbId: string;
  onIngest?: () => void;
  onCreatePage?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 text-white">
        <Sparkles className="h-7 w-7" />
      </div>
      <h2 className="mt-6 text-xl font-semibold text-gray-900">
        {t('library.wiki.empty.noPagesTitle')}
      </h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-gray-600">
        {t('library.wiki.empty.noPagesDesc')}
      </p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          onClick={onIngest}
          disabled={!onIngest}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
        >
          {t('library.wiki.empty.runIngest')}
        </button>
        <button
          onClick={onCreatePage}
          disabled={!onCreatePage}
          className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {t('library.wiki.empty.manualCreate')}
        </button>
      </div>
    </div>
  );
}

// --- Query ????(?? wiki,? wikiApi.query)---

interface QueryMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{ slug: string }>;
}

function WikiQueryPanel({
  kbId,
  onClose,
}: {
  kbId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<QueryMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    const nextHistory: QueryMessage[] = [
      ...history,
      { role: 'user', content: q },
    ];
    setHistory(nextHistory);
    setQuestion('');
    try {
      const result = await wikiApi.query(kbId, {
        question: q,
        history: history.map((m) => ({ role: m.role, content: m.content })),
      });
      setHistory((h) => [
        ...h,
        {
          role: 'assistant',
          content: result.answer,
          citations: result.citations,
        },
      ]);
    } catch (err) {
      logger?.error?.('[wiki] query failed', err);
      setHistory((h) => [
        ...h,
        {
          role: 'assistant',
          content: t('library.wiki.query.queryFailed', {
            message:
              err instanceof Error
                ? err.message
                : t('library.wiki.query.unknownError'),
          }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col border-l border-gray-200 bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {t('library.wiki.query.title')}
          </h3>
          <p className="text-xs text-gray-500">
            {t('library.wiki.query.subtitle')}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label={t('library.wiki.query.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {history.length === 0 && (
          <p className="mt-12 text-center text-sm text-gray-500">
            {t('library.wiki.query.askAnything')}
          </p>
        )}
        {history.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user' ? 'flex justify-end' : 'flex justify-start'
            }
          >
            <div
              className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
              {m.citations && m.citations.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.citations.map((c) => (
                    <span
                      key={c.slug}
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${
                        m.role === 'user'
                          ? 'bg-white/20 text-white'
                          : 'bg-violet-100 text-violet-700'
                      }`}
                    >
                      [[{c.slug}]]
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="inline-block rounded-lg bg-gray-100 px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
            </div>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-gray-100 p-3">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
          placeholder={t('library.wiki.query.placeholder')}
          disabled={loading}
          className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-500"
        />
        <button
          onClick={() => void ask()}
          disabled={loading || !question.trim()}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
        >
          {t('library.wiki.query.ask')}
        </button>
      </footer>
    </div>
  );
}

// --- ??? Markdown ??(????? P3a tarball stub)---

async function exportWikiAsMarkdown(
  kbId: string,
  kbName: string,
  t: (key: string, params?: Record<string, string | number>) => string
): Promise<void> {
  try {
    const list = await wikiApi.listPages(kbId, undefined, 1000);
    const pages = list.items;
    if (pages.length === 0) {
      toast.warning(t('library.wiki.export.noPagesToExport'));
      return;
    }
    // ? category ??(SUMMARY ? ENTITY ? CONCEPT ? SOURCE)
    const order: WikiPageCategory[] = [
      'SUMMARY',
      'ENTITY',
      'CONCEPT',
      'SOURCE',
    ];
    const sorted = [...pages].sort((a, b) => {
      const ca = order.indexOf(a.category);
      const cb = order.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      return a.title.localeCompare(b.title);
    });
    // ??? body(getPage ?? page+links;???? page.body)
    const parts: string[] = [
      `# ${kbName} � Wiki Export`,
      `_Exported at ${new Date().toISOString()}_`,
      `_Total pages: ${sorted.length}_`,
      '',
      '---',
      '',
    ];
    for (const p of sorted) {
      const detail = await wikiApi.getPage(kbId, p.slug);
      parts.push(
        `## ${detail.page.title}`,
        `*${detail.page.category}* � slug: \`${detail.page.slug}\``,
        '',
        `> ${detail.page.oneLiner}`,
        '',
        detail.page.body,
        '',
        '---',
        ''
      );
    }
    const markdown = parts.join('\n');
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const safeName = kbName.replace(/[^a-zA-Z0-9_\-?-?]+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}-wiki.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    logger?.error?.('[wiki] export failed', err);
    toast.error(
      t('library.wiki.export.exportFailed', {
        message:
          err instanceof Error
            ? err.message
            : t('library.wiki.query.unknownError'),
      })
    );
  }
}

// --- ???? modal ---

function CreateWikiPageModal({
  kbId,
  onClose,
  onCreated,
}: {
  kbId: string;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<WikiPageCategory>('CONCEPT');
  const [oneLiner, setOneLiner] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    /^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/.test(slug) &&
    title.trim().length > 0 &&
    title.length <= 500 &&
    oneLiner.trim().length > 0 &&
    oneLiner.length <= 280 &&
    body.trim().length > 0;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await wikiApi.createPage(kbId, {
        slug,
        title: title.trim(),
        category,
        body,
        oneLiner: oneLiner.trim(),
      });
      onCreated(result.page.slug);
    } catch (err) {
      logger?.error?.('[wiki] createPage failed', err);
      setError(
        err instanceof Error
          ? err.message
          : t('library.wiki.create.createFailed')
      );
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('library.wiki.create.title')}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('library.wiki.create.cancel')}
          </button>
          <button
            onClick={() => void submit()}
            disabled={!valid || submitting}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('library.wiki.create.create')}
          </button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <Field label={t('library.wiki.create.slugLabel')}>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="my-page-slug"
            className="font-mono w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
        </Field>
        <Field label={t('library.wiki.create.titleLabel')}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
        </Field>
        <Field label={t('library.wiki.create.categoryLabel')}>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as WikiPageCategory)}
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500"
          >
            <option value="ENTITY">
              {t('library.wiki.create.category.entity')}
            </option>
            <option value="CONCEPT">
              {t('library.wiki.create.category.concept')}
            </option>
            <option value="SUMMARY">
              {t('library.wiki.create.category.summary')}
            </option>
            <option value="SOURCE">
              {t('library.wiki.create.category.source')}
            </option>
          </select>
        </Field>
        <Field label={t('library.wiki.create.oneLinerLabel')}>
          <input
            type="text"
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
            maxLength={280}
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
        </Field>
        <Field label={t('library.wiki.create.bodyLabel')}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="font-mono w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
        </Field>
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </label>
      {children}
    </div>
  );
}

// --- Diff review modal (split view, three-color edges) ---

function WikiDiffReviewModal({
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

  useEffect(() => {
    let cancelled = false;
    wikiApi
      .getDiff(kbId, diffId)
      .then((d) => {
        if (cancelled) return;
        setDiff(d);
        // default-select all items
        const all = new Set<string>([
          ...d.items.creates.map((c) => c.slug),
          ...d.items.updates.map((u) => u.slug),
          ...d.items.deletes,
        ]);
        setSelected(all);
      })
      .catch((err) => {
        logger?.error?.('[wiki] getDiff failed', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kbId, diffId]);

  const conflicted = diff?.status === 'CONFLICTED';

  return (
    <Modal
      open
      onClose={onClose}
      title={t('library.wiki.diff.title')}
      subtitle={
        diff
          ? t('library.wiki.diff.totalItems', {
              // P3 BLOCKER C2 (2026-05-12): renamed affectedSlugs →
              // affectedKeys; entries are `slug:locale` composites.
              count: diff.affectedKeys.length,
              status: diff.status,
            })
          : undefined
      }
      size="2xl"
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
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {t('library.wiki.diff.dismissAll')}
          </button>
          <button
            disabled={applying || conflicted || selected.size === 0}
            onClick={async () => {
              if (!diff) return;
              setApplying(true);
              try {
                await wikiApi.patchDiff(
                  kbId,
                  diff.id,
                  'apply',
                  Array.from(selected)
                );
                onApplied?.();
                onClose();
              } catch (err) {
                logger?.error?.('[wiki] apply diff failed', err);
                toast.error(t('library.wiki.diff.applyFailed'));
              } finally {
                setApplying(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
          >
            {applying && <Loader2 className="h-4 w-4 animate-spin" />}
            {selected.size > 0
              ? t('library.wiki.diff.applyWithCount', { count: selected.size })
              : t('library.wiki.diff.apply')}
          </button>
        </>
      }
    >
      <div className="px-6 py-4">
        {conflicted && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {t('library.wiki.diff.baselineMismatch')}
          </div>
        )}
        {loading || !diff ? (
          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
        ) : (
          <div className="space-y-4">
            {diff.items.creates.map((c) => (
              <DiffItemCard
                key={`c-${c.slug}`}
                kind="CREATE"
                slug={c.slug}
                selected={selected.has(c.slug)}
                onToggle={() => toggle(selected, setSelected, c.slug)}
                preview={c.body.slice(0, 600)}
                meta={`${c.category} � ${c.title}`}
              />
            ))}
            {diff.items.updates.map((u) => (
              <DiffItemCard
                key={`u-${u.slug}`}
                kind="UPDATE"
                slug={u.slug}
                selected={selected.has(u.slug)}
                onToggle={() => toggle(selected, setSelected, u.slug)}
                preview={u.newBody.slice(0, 600)}
                meta={u.newOneLiner ?? ''}
              />
            ))}
            {diff.items.deletes.map((s) => (
              <DiffItemCard
                key={`d-${s}`}
                kind="DELETE"
                slug={s}
                selected={selected.has(s)}
                onToggle={() => toggle(selected, setSelected, s)}
                preview={t('library.wiki.diff.deletedPreview')}
                meta=""
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
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
    <div className={`rounded-lg border border-l-4 ${edge} bg-white shadow-sm`}>
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 rounded border-gray-300 text-violet-600"
        />
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tag}`}>
          {kind}
        </span>
        <code className="text-sm font-medium text-gray-900">{slug}</code>
        {meta && <span className="text-xs text-gray-500">� {meta}</span>}
      </div>
      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 text-xs leading-5 text-gray-700">
        {preview}
      </pre>
    </div>
  );
}

function toggle(
  set: Set<string>,
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  key: string
): void {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  setter(next);
}

// --- Lint Drawer ---

function WikiLintDrawer({
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

  const refresh = useCallback(() => {
    setLoading(true);
    wikiApi
      .listLintFindings(kbId, { type: tab, resolved: false })
      .then((res) => setFindings(res.items))
      .catch((err) => logger?.error?.('[wiki] listLintFindings failed', err))
      .finally(() => setLoading(false));
  }, [kbId, tab]);

  useEffect(refresh, [refresh]);

  return (
    <DrawerShell title={t('library.wiki.subheader.lint')} onClose={onClose}>
      <div className="border-b border-gray-200 px-4 py-2">
        <Tabs
          variant="pill"
          size="sm"
          value={tab}
          onChange={(v) => setTab(v as WikiLintTypeStr)}
          items={(
            [
              'CONTRADICTION',
              'STALE',
              'ORPHAN',
              'MISSING_XREF',
              'DATA_GAP',
            ] as const
          ).map((tabKey) => ({ key: tabKey, label: tabKey }))}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
        ) : findings.length === 0 ? (
          <EmptyState
            title={t('library.wiki.lint.emptyForCategory')}
            size="sm"
          />
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li
                key={f.id}
                className="rounded border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div className="flex-1">
                    <pre className="whitespace-pre-wrap break-words text-xs text-gray-700">
                      {JSON.stringify(f.detail, null, 2)}
                    </pre>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() =>
                          void wikiApi
                            .patchLintFinding(kbId, f.id, 'resolve')
                            .then(refresh)
                        }
                        className="rounded bg-violet-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-violet-700"
                      >
                        {t('library.wiki.lint.resolve')}
                      </button>
                      <button
                        onClick={() =>
                          void wikiApi
                            .patchLintFinding(kbId, f.id, 'dismiss')
                            .then(refresh)
                        }
                        className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {t('library.wiki.lint.dismiss')}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-gray-200 px-4 py-2">
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
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {running && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('library.wiki.lint.runFullLint')}
        </button>
      </div>
    </DrawerShell>
  );
}

function WikiLogDrawer({
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
    <DrawerShell title={t('library.wiki.subheader.log')} onClose={onClose}>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 text-xs text-gray-500">
        <span>
          {loading
            ? t('library.wiki.log.loading')
            : t('library.wiki.log.totalOps', { count: items.length })}
        </span>
        <button
          onClick={refresh}
          disabled={loading}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
          title={t('library.wiki.log.refresh')}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error ? (
          <div className="py-8 text-center text-sm text-red-600">{error}</div>
        ) : !loading && items.length === 0 ? (
          <EmptyState title={t('library.wiki.log.empty')} size="sm" />
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <WikiLogCard key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </DrawerShell>
  );
}

function WikiLogCard({ item }: { item: WikiOperationLogEntry }) {
  const { t } = useTranslation();
  const palette = OP_PALETTE[item.op];
  const Icon = palette.icon;
  return (
    <li className="rounded border border-gray-200 bg-white px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded ${palette.bg}`}
          aria-hidden
        >
          <Icon className={`h-3.5 w-3.5 ${palette.fg}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${palette.bg} ${palette.fg}`}
            >
              {item.op}
            </span>
            <span className="truncate text-sm font-medium text-gray-900">
              {item.title}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            {item.actorName ?? t('library.wiki.log.system')} �{' '}
            {formatRelativeTime(item.createdAt, t)}
          </div>
          {item.affectedSlugs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {item.affectedSlugs.slice(0, 6).map((slug) => (
                <code
                  key={slug}
                  className="font-mono rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-700"
                >
                  {slug}
                </code>
              ))}
              {item.affectedSlugs.length > 6 && (
                <span className="text-[10px] text-gray-500">
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

const OP_PALETTE: Record<
  WikiOp,
  {
    icon: typeof Plus;
    bg: string;
    fg: string;
  }
> = {
  INGEST: {
    icon: Plus,
    bg: 'bg-violet-50',
    fg: 'text-violet-700',
  },
  LINT: {
    icon: GitMerge,
    bg: 'bg-amber-50',
    fg: 'text-amber-700',
  },
  EDIT: {
    icon: PencilLine,
    bg: 'bg-sky-50',
    fg: 'text-sky-700',
  },
  REVERT: {
    icon: Undo2,
    bg: 'bg-rose-50',
    fg: 'text-rose-700',
  },
};

function DrawerShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed right-0 top-0 z-30 flex h-full w-96 flex-col border-l border-gray-200 bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

// --- Helpers ---

// English-style plural for page-count strings: dispatches to the
// `_one` / `_other` keys based on count. (Project's i18n core has no
// built-in count branching, so call sites pick the key explicitly.)
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

// --- Ingest pending banner (fire-and-forget, real backend progress) ---

function IngestPendingBanner({
  progress,
  onDismiss,
  onOpenDiff,
}: {
  progress: WikiIngestProgress;
  onDismiss: () => void;
  onOpenDiff: (diffId: string) => void;
}) {
  const isCompleted = progress.status === 'completed';
  const isFailed = progress.status === 'failed';
  const isRunning = progress.status === 'running';
  // ★ 2026-05-13 P-#14: partial-success — completed 但 section-fill 有页失败。
  //   走 amber 调色板（warn 非 error），banner 显示 "X 页失败" + slug 缩略。
  const hasPartialFailure =
    isCompleted &&
    Array.isArray(progress.failedSlugs) &&
    progress.failedSlugs.length > 0;

  const elapsedMs = (() => {
    const start = new Date(progress.startedAt).getTime();
    const end = progress.finishedAt
      ? new Date(progress.finishedAt).getTime()
      : Date.now();
    return Math.max(0, end - start);
  })();
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const mm = Math.floor(elapsedSec / 60);
  const ss = elapsedSec % 60;
  const elapsed = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;

  const stageOrder = [
    'starting',
    'load-docs',
    'outline',
    'section-fill',
    'cross-link',
    'persist',
    'completed',
  ];
  const stageIdx = Math.max(0, stageOrder.indexOf(progress.stage));
  let pct = Math.round((stageIdx / (stageOrder.length - 1)) * 100);
  if (
    progress.stage === 'section-fill' &&
    progress.pagesTotal &&
    progress.pagesTotal > 0
  ) {
    // section-fill 占总进度 [40%, 80%]，pagesDone/Total 线性插值
    const sf = Math.min(1, (progress.pagesDone ?? 0) / progress.pagesTotal);
    pct = Math.round(40 + sf * 40);
  }
  if (isCompleted) pct = 100;
  if (isFailed) pct = 100;

  const stageLabelMap: Record<string, string> = {
    starting: '准备中…',
    'load-docs': '加载文档…',
    outline: 'Outline 大纲规划中…',
    'section-fill':
      progress.pagesTotal && progress.pagesDone != null
        ? `Section-fill 撰写中 · ${progress.pagesDone}/${progress.pagesTotal} 页`
        : 'Section-fill 撰写中…',
    'cross-link': 'Cross-link 建立页面引用…',
    persist: '持久化 diff…',
    completed: '✓ 完成',
    failed: '✗ 失败',
  };
  const label = stageLabelMap[progress.stage] ?? progress.stage;

  const palette = hasPartialFailure
    ? {
        border: 'border-amber-200',
        bg: 'bg-amber-50',
        text: 'text-amber-900',
        sub: 'text-amber-700',
        bar: 'bg-amber-600',
        spinner: 'text-amber-600',
        barBg: 'bg-amber-200',
        btnBorder: 'border-amber-300',
        btnText: 'text-amber-700',
        btnHoverBg: 'hover:bg-amber-50',
      }
    : isCompleted
      ? {
          border: 'border-emerald-200',
          bg: 'bg-emerald-50',
          text: 'text-emerald-900',
          sub: 'text-emerald-700',
          bar: 'bg-emerald-600',
          spinner: 'text-emerald-600',
          barBg: 'bg-emerald-200',
          btnBorder: 'border-emerald-300',
          btnText: 'text-emerald-700',
          btnHoverBg: 'hover:bg-emerald-50',
        }
      : isFailed
        ? {
            border: 'border-red-200',
            bg: 'bg-red-50',
            text: 'text-red-900',
            sub: 'text-red-700',
            bar: 'bg-red-600',
            spinner: 'text-red-600',
            barBg: 'bg-red-200',
            btnBorder: 'border-red-300',
            btnText: 'text-red-700',
            btnHoverBg: 'hover:bg-red-50',
          }
        : {
            border: 'border-violet-200',
            bg: 'bg-violet-50',
            text: 'text-violet-900',
            sub: 'text-violet-700',
            bar: 'bg-violet-600',
            spinner: 'text-violet-600',
            barBg: 'bg-violet-200',
            btnBorder: 'border-violet-300',
            btnText: 'text-violet-700',
            btnHoverBg: 'hover:bg-violet-50',
          };

  return (
    <div className={`border-b ${palette.border} ${palette.bg} px-8 py-3`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {isRunning ? (
            <Loader2
              className={`h-4 w-4 shrink-0 animate-spin ${palette.spinner}`}
            />
          ) : (
            <div className={`h-4 w-4 shrink-0 rounded-full ${palette.bar}`} />
          )}
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-medium ${palette.text}`}>
              Wiki Ingest · {progress.passMode} · {label} · 用时 {elapsed}
            </div>
            <div
              className={`mt-1 h-1.5 w-full overflow-hidden rounded-full ${palette.barBg}`}
            >
              <div
                className={`h-full ${palette.bar} transition-[width] duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className={`mt-1 text-xs ${palette.sub}`}>
              {isCompleted &&
                !hasPartialFailure &&
                '新的 PENDING diff 已生成，可点右侧按钮查看。'}
              {hasPartialFailure && (
                <>
                  diff 已生成（部分页失败 {progress.failedSlugs!.length}/
                  {progress.pagesTotal ?? progress.failedSlugs!.length} 页）：
                  {progress.failedSlugs!.slice(0, 5).join('、')}
                  {progress.failedSlugs!.length > 5
                    ? `…等 ${progress.failedSlugs!.length} 个`
                    : ''}
                  。可对失败 slug 单独重试。
                </>
              )}
              {isFailed &&
                (progress.errorMessage ||
                  '后台运行失败，请检查 Railway log 详情。')}
              {isRunning &&
                'MULTI pass 大文档典型 5-12 分钟。可关闭浏览器，任务在后台继续；下次回到本页面会自动恢复进度。'}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isCompleted && progress.diffId && (
            <button
              type="button"
              onClick={() => onOpenDiff(progress.diffId!)}
              className={`rounded-md border ${palette.btnBorder} bg-white px-3 py-1.5 text-xs font-medium ${palette.btnText} ${palette.btnHoverBg}`}
            >
              查看 Diff
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            title={isRunning ? '隐藏提示（不影响后台运行）' : '关闭提示'}
            className={`rounded-md p-1.5 ${palette.btnText} hover:bg-white/50`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Ingest picker modal ---

function IngestPickerModal({
  kbId,
  onClose,
  onIngested,
}: {
  kbId: string;
  onClose: () => void;
  onIngested: (diffId: string, isAsync?: boolean) => void;
}) {
  return (
    <WikiIngestWorkspaceModal
      kbId={kbId}
      onClose={onClose}
      onIngested={onIngested}
    />
  );
}
// --- Wiki enable toggle modal ---

interface KbWithOwnership {
  id: string;
  name: string;
  type: string;
  wikiEnabled?: boolean;
}

function WikiEnableToggleModal({
  onClose,
  onEnabled,
}: {
  onClose: () => void;
  onEnabled: (kbId: string) => void;
}) {
  const { t } = useTranslation();
  const [kbs, setKbs] = useState<KbWithOwnership[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKbId, setBusyKbId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Reuse the existing /rag/knowledge-bases endpoint via apiClient (auto base
    // URL + auth + 401 refresh handling, same plumbing as the rest of wikiApi).
    wikiApi
      .listAllKbs()
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data)
          ? (data as KbWithOwnership[])
          : ((data as { items?: KbWithOwnership[] }).items ?? []);
        setKbs(items);
      })
      .catch((err) => {
        logger?.error?.('[wiki] list KBs for toggle failed', err);
        if (!cancelled) setError('Failed to load knowledge bases');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async (kbId: string) => {
    setBusyKbId(kbId);
    setError(null);
    try {
      const result = await wikiApi.toggleWikiEnabled(kbId, true);
      onEnabled(result.kbId);
    } catch (err) {
      logger?.error?.('[wiki] toggleWikiEnabled failed', err);
      setError(
        err instanceof Error ? err.message : t('library.wiki.enable.failed')
      );
    } finally {
      setBusyKbId(null);
    }
  };

  const eligible = kbs.filter((kb) => !kb.wikiEnabled);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('library.wiki.enable.title')}
      subtitle={t('library.wiki.enable.subtitle')}
      size="lg"
      footer={
        <span className="text-xs text-gray-500">
          {t('library.wiki.enable.footnote')}
        </span>
      }
    >
      <div className="px-6 py-4">
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : eligible.length === 0 ? (
          <EmptyState
            title={
              kbs.length === 0
                ? t('library.wiki.enable.noKbsForUser')
                : t('library.wiki.enable.allEnabled')
            }
            size="sm"
          />
        ) : (
          <ul className="space-y-2">
            {eligible.map((kb) => (
              <li
                key={kb.id}
                className="flex items-center justify-between rounded border border-gray-200 px-4 py-3 hover:border-violet-300"
              >
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {kb.name}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {kb.type === 'TEAM'
                      ? t('library.wiki.enable.kbTypeTeam')
                      : t('library.wiki.enable.kbTypePersonal')}
                  </div>
                </div>
                <button
                  disabled={busyKbId === kb.id}
                  onClick={() => enable(kb.id)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
                >
                  {busyKbId === kb.id && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {t('library.wiki.enable.enableButton')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function getAuthHeaderSafe(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem('auth_tokens');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { accessToken?: string };
    return parsed.accessToken
      ? { Authorization: `Bearer ${parsed.accessToken}` }
      : {};
  } catch {
    return {};
  }
}

// re-export FileSearch import to avoid unused-import lint warning when
// downstream sub-iterations begin using a query panel
export const _wikiTabIcons = { FileSearch, Sparkles };

// --- Wiki disable confirm dialog (grid card delete action) ---
//
// "Delete" on a grid card means "disable Wiki on this KB" (the underlying KB
// itself lives in the Knowledge Base tab and is not removed). We call
// toggleWikiEnabled(kbId, false) — backend already enforces ADMIN/OWNER and
// preserves WikiPage rows so re-enabling restores the existing content.

function WikiDisableConfirmDialog({
  kbName,
  busy,
  onCancel,
  onConfirm,
}: {
  kbName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (alsoDestroyData: boolean) => void;
}) {
  const { t } = useTranslation();
  // W5 v2.0 rebuild: opt-in destructive wipe. Off by default so the dialog
  // keeps its original "soft disable / data preserved" semantics; checking
  // the box calls DELETE /destroy which clears all wiki tables for this KB.
  const [alsoDestroy, setAlsoDestroy] = useState(false);
  return (
    <Modal
      open
      onClose={onCancel}
      title={t('library.wiki.grid.disable.title')}
      size="sm"
      footer={
        <>
          <button
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('library.wiki.grid.disable.cancel')}
          </button>
          <button
            disabled={busy}
            onClick={() => onConfirm(alsoDestroy)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {alsoDestroy
              ? t('library.wiki.grid.disable.confirmDestroy')
              : t('library.wiki.grid.disable.confirm')}
          </button>
        </>
      }
    >
      <div className="px-6 py-4">
        <p className="text-sm text-gray-600">
          {t('library.wiki.grid.disable.message', { kbName })}
        </p>
        <label className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
          <input
            type="checkbox"
            checked={alsoDestroy}
            disabled={busy}
            onChange={(e) => setAlsoDestroy(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-red-600 disabled:opacity-50"
          />
          <div>
            <div className="font-medium text-red-700">
              {t('library.wiki.grid.disable.alsoDestroy.title')}
            </div>
            <div className="mt-0.5 text-xs text-red-600/80">
              {t('library.wiki.grid.disable.alsoDestroy.description')}
            </div>
          </div>
        </label>
      </div>
    </Modal>
  );
}
