'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSearch, FolderTree, Languages, Loader2 } from 'lucide-react';
import rehypeSanitize from 'rehype-sanitize';
import { MarkdownViewer } from '@/components/common/markdown-viewer';
import {
  wikiApi,
  type WikiLocale,
  type WikiPage,
  type WikiPageCategory,
  type WikiPageWithLinks,
} from '@/lib/api/wiki';
import { useTranslation } from '@/lib/i18n';
import { logger } from '@/lib/utils/logger';
import { katexAwareSchema } from '@/lib/markdown/katexAwareSchema';
import { preprocessWikiBody } from '@/lib/wiki/wikilink-preprocess';

const WIKI_SANITIZE_SCHEMA = {
  ...katexAwareSchema,
  protocols: {
    ...(katexAwareSchema.protocols ?? {}),
    href: [...(katexAwareSchema.protocols?.href ?? []), 'wikilink'],
  },
};

const CATEGORY_ORDER: WikiPageCategory[] = [
  'SUMMARY',
  'ENTITY',
  'CONCEPT',
  'SOURCE',
];

interface WikiReaderPaneProps {
  kbId: string;
  activeSlug: string | null;
  refreshKey?: number;
  onSelectSlug: (slug: string) => void;
  onIngest?: () => void;
  onCreatePage?: () => void;
  /**
   * W3-P0 v2.0 rebuild gap #2 (2026-05-12): per-KB enabled locales from
   * the KB selector. When `length > 1` (bilingual KB) the reader renders
   * a small zh/en switcher above the sidebar and forwards the choice to
   * listPages / getPage. Default `['zh']` keeps legacy KBs unchanged.
   */
  enabledLocales?: WikiLocale[];
}

export default function WikiReaderPane({
  kbId,
  activeSlug,
  refreshKey = 0,
  onSelectSlug,
  onIngest,
  onCreatePage,
  enabledLocales = ['zh'],
}: WikiReaderPaneProps) {
  const { t } = useTranslation();
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<WikiPageWithLinks | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  // Active locale state — initialised to enabledLocales[0]. Switching here
  // re-fetches listPages + getPage with the new locale param.
  const [locale, setLocale] = useState<WikiLocale>(enabledLocales[0] ?? 'zh');
  const showLocaleSwitcher = enabledLocales.length > 1;
  // If the KB enabledLocales prop changes (different KB selected), realign
  // the active locale so we don't keep a stale `en` for a `zh`-only KB.
  useEffect(() => {
    if (!enabledLocales.includes(locale)) {
      setLocale(enabledLocales[0] ?? 'zh');
    }
  }, [enabledLocales, locale]);
  const autoPickedKbRef = useRef<string | null>(null);
  const onSelectSlugRef = useRef(onSelectSlug);
  onSelectSlugRef.current = onSelectSlug;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Pass locale only for bilingual KBs; for single-locale we keep the
    // legacy "list all locales" path which returns the single locale anyway.
    wikiApi
      .listPages(kbId, undefined, 200, showLocaleSwitcher ? locale : undefined)
      .then((res) => {
        if (!cancelled) setPages(res.items);
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
  }, [kbId, refreshKey, locale, showLocaleSwitcher]);

  useEffect(() => {
    if (autoPickedKbRef.current !== kbId) {
      autoPickedKbRef.current = null;
    }
  }, [kbId]);

  useEffect(() => {
    if (loading || activeSlug || autoPickedKbRef.current === kbId) return;
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
      .getPage(kbId, activeSlug, showLocaleSwitcher ? locale : undefined)
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
  }, [kbId, activeSlug, refreshKey, locale, showLocaleSwitcher]);

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (pages.length === 0) {
    return <ZeroPageGuide onIngest={onIngest} onCreatePage={onCreatePage} />;
  }

  const grouped: Record<WikiPageCategory, WikiPage[]> = {
    SUMMARY: [],
    ENTITY: [],
    CONCEPT: [],
    SOURCE: [],
  };
  for (const page of pages) grouped[page.category].push(page);
  // 2026-05-14: sidebar 显示时, 同一 KB 内 title 重复 (ingest LLM 没保证 title 唯一) →
  // 在 title 后追加 (slug) 后缀做视觉区分,避免用户看到两条一模一样的行。
  const duplicateTitles = new Set<string>();
  const titleCount = new Map<string, number>();
  for (const p of pages)
    titleCount.set(p.title, (titleCount.get(p.title) ?? 0) + 1);
  for (const [t, c] of titleCount) if (c > 1) duplicateTitles.add(t);

  const effectiveActiveSlug = activeSlug ?? pickFirstSlug(pages);

  return (
    <div className="flex h-full min-h-0 bg-gray-50/50 px-6 py-6">
      <div className="grid min-h-0 w-full gap-6 md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <FolderTree className="h-4 w-4 text-gray-500" />
              Browse pages
            </div>
            {showLocaleSwitcher && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                <Languages className="ml-2 h-3.5 w-3.5 text-slate-400" />
                {enabledLocales.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLocale(l)}
                    className={
                      'rounded px-2 py-0.5 text-[11px] font-medium uppercase transition ' +
                      (locale === l
                        ? 'bg-white text-violet-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700')
                    }
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {CATEGORY_ORDER.map((category) =>
              grouped[category].length > 0 ? (
                <section key={category} className="mb-5 last:mb-0">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-gray-600">
                    <span>{category}</span>
                    <span>{grouped[category].length}</span>
                  </div>
                  <ul className="space-y-1">
                    {grouped[category].map((page) => (
                      <li key={page.id}>
                        <button
                          onClick={() => onSelectSlug(page.slug)}
                          className={`block w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                            effectiveActiveSlug === page.slug
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                              : 'border-transparent bg-white text-gray-700 hover:border-gray-200 hover:bg-gray-50'
                          }`}
                          title={page.oneLiner}
                        >
                          <div className="truncate text-sm font-medium">
                            {page.title}
                            {duplicateTitles.has(page.title) && (
                              <span className="ml-1 text-[10px] font-normal text-gray-400">
                                ({page.slug})
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null
            )}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 overflow-y-auto pr-1">
          {activeLoading ? (
            <div className="flex h-72 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            </div>
          ) : active ? (
            <WikiMarkdownView
              pageWithLinks={active}
              onSelectSlug={onSelectSlug}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-sm text-gray-500 shadow-sm">
              {t('library.wiki.reader.selectFromLeft')}
            </div>
          )}
        </main>
      </div>
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
  // 不再是裸 slug。knownSlugs 仍用 Set<slug> 给 markdown wikilink 渲染时判断存在性。
  const knownSlugs = useMemo(
    () => new Set(outboundLinks.filter((l) => l.exists).map((l) => l.slug)),
    [outboundLinks]
  );
  // markdown body 内嵌 [[slug]] 渲染时也要查 title，避免 anchor 文本是拼音。
  const titleBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of outboundLinks) m.set(l.slug, l.title);
    return m;
  }, [outboundLinks]);

  // 2026-05-14 prod 观察: LLM 经常错用 `slug` inline code 而非 [[slug]],
  // preprocess 在 helper 里同时处理两种形态 + 守门避免破坏真代码块。
  const preprocessed = useMemo(
    () => preprocessWikiBody(page.body, titleBySlug),
    [page.body, titleBySlug]
  );

  return (
    <article className="space-y-6">
      <header className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {page.category}
            </span>
            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              <code className="font-mono">{page.slug}</code>
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-gray-900">
            {page.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            {page.oneLiner}
          </p>
          <p className="mt-3 text-xs text-gray-500">
            {t('library.wiki.reader.lastEditedBy', {
              by: (page.lastEditedBy ?? '').toLowerCase() || '-',
              time: formatRelativeTime(page.updatedAt, t),
            })}
          </p>
        </div>

        {outboundLinks.length > 0 && (
          <div className="px-6 py-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
              {t('library.wiki.reader.referenced', {
                count: outboundLinks.length,
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {outboundLinks.slice(0, 10).map((link) => (
                <button
                  key={`${link.slug}::${link.locale}`}
                  type="button"
                  onClick={() => onSelectSlug(link.slug)}
                  title={
                    link.exists
                      ? link.slug
                      : t('library.wiki.reader.linkMissing', {
                          slug: link.slug,
                        })
                  }
                  className={
                    link.exists
                      ? 'rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-emerald-50 hover:text-emerald-700'
                      : 'rounded-full border border-dashed border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50'
                  }
                >
                  {link.title}
                </button>
              ))}
              {outboundLinks.length > 10 && (
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                  +{outboundLinks.length - 10}
                </span>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="rounded-xl border border-gray-200 bg-white px-6 py-6 shadow-sm">
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
                          ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 no-underline hover:bg-emerald-100'
                          : 'rounded border border-dashed border-red-300 px-1.5 py-0.5 text-red-600 no-underline hover:bg-red-50'
                      }
                      title={
                        exists ? `Open ${slug}` : `Create ${slug} (missing)`
                      }
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
            urlTransform={(url) => {
              if (typeof url !== 'string') return '';
              if (url.startsWith('wikilink:')) return url;
              if (/^(https?|mailto|tel):/i.test(url)) return url;
              if (url.startsWith('/') || url.startsWith('#')) return url;
              return '';
            }}
          />
        </div>
      </div>

      {backlinks.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-600">
            {t('library.wiki.reader.backlinks', { count: backlinks.length })}
          </div>
          <div className="flex flex-wrap gap-2">
            {backlinks.map((link) => (
              <button
                key={`${link.slug}::${link.locale}`}
                onClick={() => onSelectSlug(link.slug)}
                title={link.slug}
                className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-emerald-50 hover:text-emerald-700"
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

function ZeroPageGuide({
  onIngest,
  onCreatePage,
}: {
  onIngest?: () => void;
  onCreatePage?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-6 py-6">
      <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
          <FileSearch className="h-7 w-7" />
        </div>
        <h2 className="mt-6 text-xl font-semibold text-gray-900">
          {t('library.wiki.empty.noPagesTitle')}
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-gray-600">
          {t('library.wiki.empty.noPagesDesc')}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onIngest}
            disabled={!onIngest}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            {t('library.wiki.empty.runIngest')}
          </button>
          <button
            onClick={onCreatePage}
            disabled={!onCreatePage}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('library.wiki.empty.manualCreate')}
          </button>
        </div>
      </div>
    </div>
  );
}

function pickFirstSlug(pages: WikiPage[]): string | null {
  if (pages.length === 0) return null;
  const grouped: Record<WikiPageCategory, WikiPage[]> = {
    SUMMARY: [],
    ENTITY: [],
    CONCEPT: [],
    SOURCE: [],
  };
  for (const page of pages) grouped[page.category].push(page);
  return (
    grouped.SUMMARY[0]?.slug ??
    grouped.ENTITY[0]?.slug ??
    grouped.CONCEPT[0]?.slug ??
    pages[0]?.slug ??
    null
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
