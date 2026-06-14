'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { useI18n } from '@/lib/i18n/i18n-context';

interface RagSource {
  documentTitle: string;
  excerpt: string;
  score: number;
  /**
   * Backend `KbQueryService` tags wiki hits so the UI can branch:
   *   - `metadata.source === 'wiki'` → render markdown + show Wiki badge +
   *     deep-link to `/library?tab=wiki&kb={kbId}&page={slug}`
   *   - undefined / `'chunk'` → original chunk-RAG behavior (plain-text
   *     excerpt, no link)
   */
  metadata?: {
    source?: 'wiki' | 'chunk';
    kbId?: string;
    slug?: string;
    oneLiner?: string;
    category?: string;
    [k: string]: unknown;
  };
}

interface CollapsibleRagSourcesProps {
  sources: RagSource[];
  maxSources?: number;
  defaultExpanded?: boolean;
}

function isWikiSource(s: RagSource): boolean {
  return s.metadata?.source === 'wiki';
}

function wikiHref(s: RagSource): string | null {
  const kbId = s.metadata?.kbId;
  const slug = s.metadata?.slug;
  if (!kbId || !slug) return null;
  return `/library?tab=wiki&kb=${encodeURIComponent(kbId)}&page=${encodeURIComponent(slug)}`;
}

/**
 * 可折叠的 RAG 知识库来源组件
 *
 * 功能：
 * - 默认折叠，点击展开查看详情
 * - 显示 TOP N 个来源（默认 5 个）
 * - 来源类型分支：
 *   - **wiki** → markdown 渲染（标题/列表/粗体保留排版）+ Wiki 徽章 +
 *     "在 Wiki 中查看" 链接（指向 /library?tab=wiki&kb=…&page=…）
 *   - **chunk RAG** → 原 plain-text 行为（whitespace-pre-wrap）
 * - 相关度分数可视化
 * - 双语支持
 */
export function CollapsibleRagSources({
  sources,
  maxSources = 5,
  defaultExpanded = false,
}: CollapsibleRagSourcesProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!sources || sources.length === 0) {
    return null;
  }

  const displaySources = sources.slice(0, maxSources);
  const hasMore = sources.length > maxSources;
  const topCount = Math.min(sources.length, maxSources);

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[hsl(var(--primary)/0.2)] bg-[hsl(var(--primary)/0.05)]">
      {/* Header - 点击切换展开/折叠 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-3 py-2.5 transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
      >
        <div className="flex items-center gap-2 text-xs font-medium text-primary">
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          <span>
            {t('aiAsk.ragSources.title')}{' '}
            {t('aiAsk.ragSources.topN', { count: topCount })}
          </span>
          <span className="rounded-full bg-[hsl(var(--primary)/0.18)] px-1.5 py-0.5 text-[10px]">
            {t('aiAsk.ragSources.total', { count: sources.length })}
          </span>
        </div>
        <svg
          className={`h-4 w-4 text-primary transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* 折叠内容 — 外壳保持 max-h 动画做开合过渡，内层加自身 max-h + overflow-y-auto
         让来源很多 / wiki 摘录很长时不会被裁切而无法滚动（Screenshot_5 反馈）。 */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          isExpanded ? 'max-h-[80vh] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="max-h-[70vh] space-y-2 overflow-y-auto px-3 pb-3">
          {displaySources.map((source, idx) => {
            const isWiki = isWikiSource(source);
            const href = isWiki ? wikiHref(source) : null;
            return (
              <div
                key={idx}
                className="group rounded-lg border border-[hsl(var(--primary)/0.15)] bg-white p-3 shadow-sm transition-colors hover:border-[hsl(var(--primary)/0.3)]"
              >
                {/* 头部：排名、标题、徽章、分数 */}
                <div className="mb-2 flex items-start gap-2">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--primary)/0.85)] text-[11px] font-bold text-white shadow-sm">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="flex items-center gap-1.5 text-sm font-medium leading-tight text-gray-800">
                      <span className="truncate">{source.documentTitle}</span>
                      {isWiki && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[hsl(var(--primary)/0.12)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                          <Sparkles className="h-2.5 w-2.5" />
                          Wiki
                        </span>
                      )}
                      {!isWiki && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                          <FileText className="h-2.5 w-2.5" />
                          RAG
                        </span>
                      )}
                    </h4>
                    {isWiki && source.metadata?.oneLiner && (
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {source.metadata.oneLiner}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--primary)/0.7)] to-[hsl(var(--primary))]"
                        style={{
                          width: `${Math.min(source.score * 100, 100)}%`,
                        }}
                      />
                    </div>
                    <span className="min-w-[32px] text-right text-[10px] font-medium text-primary">
                      {(source.score * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {/* 摘录内容 */}
                <div className="pl-8">
                  {isWiki ? (
                    <div className="prose prose-sm max-w-none text-xs leading-relaxed text-gray-700">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeSanitize]}
                      >
                        {source.excerpt}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
                      {source.excerpt}
                    </p>
                  )}

                  {/* Wiki 跳转链接 */}
                  {isWiki && href && (
                    <Link
                      href={href}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline hover:opacity-80"
                    >
                      {t('aiAsk.ragSources.openInWiki') ?? 'Open in Wiki'}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}

          {/* 显示更多提示 */}
          {hasMore && (
            <div className="py-1 text-center">
              <span className="text-[10px] text-primary">
                {t('aiAsk.ragSources.moreNotShown', {
                  count: sources.length - maxSources,
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 折叠状态的预览 */}
      {!isExpanded && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-1.5 text-[10px] text-primary">
            {displaySources.slice(0, 3).map((source, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 rounded border border-[hsl(var(--primary)/0.2)] bg-white/80 px-1.5 py-0.5"
              >
                <span className="font-medium">{idx + 1}.</span>
                <span className="max-w-[100px] truncate">
                  {source.documentTitle}
                </span>
                {isWikiSource(source) && (
                  <Sparkles className="h-2.5 w-2.5 text-primary" />
                )}
              </span>
            ))}
            {displaySources.length > 3 && (
              <span className="text-primary">+{displaySources.length - 3}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CollapsibleRagSources;
