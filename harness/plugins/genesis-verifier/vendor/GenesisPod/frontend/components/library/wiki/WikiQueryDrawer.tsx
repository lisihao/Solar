'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import rehypeSanitize from 'rehype-sanitize';
import { MarkdownViewer } from '@/components/common/markdown-viewer';
import { wikiApi } from '@/lib/api/wiki';
import { useTranslation } from '@/lib/i18n';
import { katexAwareSchema } from '@/lib/markdown/katexAwareSchema';
import { logger } from '@/lib/utils/logger';

interface QueryMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{ slug: string }>;
}

export default function WikiQueryDrawer({
  kbId,
  onClose,
  onSelectSlug,
}: {
  kbId: string;
  onClose: () => void;
  onSelectSlug?: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<QueryMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const starters = [
    'Summarize the key entities and concepts in this wiki.',
    'What pages should be updated based on recent document changes?',
    'List contradictions or missing cross-links I should fix next.',
  ];

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
        history: history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
      setHistory((existing) => [
        ...existing,
        {
          role: 'assistant',
          content: result.answer,
          citations: result.citations,
        },
      ]);
    } catch (err) {
      logger?.error?.('[wiki] query failed', err);
      setHistory((existing) => [
        ...existing,
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
    <div className="fixed inset-y-0 right-0 z-50 flex w-[460px] flex-col border-l border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] shadow-2xl">
      <header className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-500">
              Knowledge QA
            </div>
            <h3 className="text-base font-semibold text-slate-900">
              {t('library.wiki.query.title')}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {t('library.wiki.query.subtitle')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={t('library.wiki.query.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="rounded-3xl bg-[linear-gradient(135deg,#ede9fe,#f8fafc_62%)] p-4">
          <div className="text-sm font-medium text-slate-900">
            Ask for grounded answers, page-level synthesis, and editorial
            follow-up.
          </div>
          {history.length === 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => setQuestion(starter)}
                  className="rounded-full bg-white/90 px-3 py-1.5 text-left text-xs text-slate-600 shadow-sm hover:bg-white"
                >
                  {starter}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {history.length === 0 && (
          <p className="mt-12 text-center text-sm text-slate-500">
            {t('library.wiki.query.askAnything')}
          </p>
        )}
        {history.map((message, index) => (
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'flex justify-end'
                : 'flex justify-start'
            }
          >
            <div
              className={`inline-block max-w-[88%] rounded-2xl px-3.5 py-3 text-sm shadow-sm ${
                message.role === 'user'
                  ? 'bg-violet-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-900'
              }`}
            >
              {message.role === 'user' ? (
                <div className="whitespace-pre-wrap break-words">
                  {message.content}
                </div>
              ) : (
                <div className="prose prose-sm prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 max-w-none break-words text-slate-800">
                  <MarkdownViewer
                    content={preprocessWikiLinks(message.content)}
                    enableBulletStrip={false}
                    components={{
                      a({ href, children, ...rest }) {
                        if (
                          typeof href === 'string' &&
                          href.startsWith('wikilink:')
                        ) {
                          const slug = href.slice('wikilink:'.length);
                          return (
                            <button
                              type="button"
                              onClick={() => onSelectSlug?.(slug)}
                              className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700 no-underline hover:bg-violet-100"
                              title={`Open ${slug}`}
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
                    rehypePluginsExtra={[
                      [rehypeSanitize, WIKI_SANITIZE_SCHEMA],
                    ]}
                    urlTransform={(url) => {
                      if (typeof url !== 'string') return '';
                      if (url.startsWith('wikilink:')) return url;
                      if (/^(https?|mailto|tel):/i.test(url)) return url;
                      if (url.startsWith('/') || url.startsWith('#'))
                        return url;
                      return '';
                    }}
                  />
                </div>
              )}
              {message.citations && message.citations.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {message.citations.map((citation) => (
                    <span
                      key={citation.slug}
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] ${
                        message.role === 'user'
                          ? 'bg-white/20 text-white'
                          : 'bg-violet-100 text-violet-700'
                      }`}
                    >
                      [[{citation.slug}]]
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="inline-block rounded-2xl border border-slate-200 bg-white px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
            </div>
          </div>
        )}
      </div>

      <footer className="border-t border-slate-100 p-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <textarea
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
            rows={3}
            className="w-full resize-none bg-transparent px-1 py-1 text-sm text-slate-700 outline-none placeholder:text-slate-400"
          />
          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-slate-400">
              Enter to send, Shift+Enter for a new line
            </div>
            <button
              onClick={() => void ask()}
              disabled={loading || !question.trim()}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
            >
              {t('library.wiki.query.ask')}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

const WIKI_SANITIZE_SCHEMA = {
  ...katexAwareSchema,
  protocols: {
    ...(katexAwareSchema.protocols ?? {}),
    href: [...(katexAwareSchema.protocols?.href ?? []), 'wikilink'],
  },
};

function preprocessWikiLinks(content: string): string {
  return content.replace(
    /\[\[([a-z0-9][a-z0-9-]*[a-z0-9])\]\]/gi,
    (_match, slug) => `[${slug}](wikilink:${String(slug).toLowerCase()})`
  );
}
