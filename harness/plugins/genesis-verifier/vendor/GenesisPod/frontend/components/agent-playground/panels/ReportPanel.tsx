'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText,
  ChevronDown,
  ExternalLink,
  Sparkles,
  History,
} from 'lucide-react';
import type { ReportDraft } from '@/lib/features/agent-playground/mission-presentation.types';
import { scoreColor } from '@/lib/features/agent-playground/formatters';
import { Card } from '@/components/agent-playground/ui';

const MD_COMPONENTS = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const safe = href && /^https?:\/\//i.test(href) ? href : undefined;
    return safe ? (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="break-words text-violet-600 underline decoration-violet-300 underline-offset-2 hover:text-violet-700"
      >
        {children}
      </a>
    ) : (
      <span className="text-gray-500">{children}</span>
    );
  },
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-3 leading-7 text-gray-700">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-3 ml-5 list-disc space-y-1 text-gray-700">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-3 ml-5 list-decimal space-y-1 text-gray-700">
      {children}
    </ol>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-gray-900">
      {children}
    </h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="mb-2 mt-3 text-sm font-semibold text-gray-900">
      {children}
    </h4>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h5 className="mb-1 mt-3 text-sm font-medium text-gray-900">{children}</h5>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-gray-900">{children}</strong>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-3 my-3 border-violet-200 bg-violet-50/30 px-3 py-1 text-gray-700">
      {children}
    </blockquote>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="font-mono rounded bg-gray-100 px-1 py-0.5 text-[12px] text-gray-800">
      {children}
    </code>
  ),
};

function Markdown({ content }: { content: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface Props {
  finalReport: ReportDraft['report'] | null;
  reports: ReportDraft[];
  finalScore?: number;
}

/**
 * Sanitize a URL string before rendering as <a href>.
 * 后端 ResearcherAgent 输出 schema 放宽到 z.string()，LLM 可能产生
 * `javascript:`/`data:` 等危险协议，必须 allowlist 校验。
 */
function safeHref(src: string | undefined): string | null {
  if (!src || typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export function ReportPanel({ finalReport, reports, finalScore }: Props) {
  // 默认全展开 —— accordion 让人误以为"没内容"
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const toggleSection = (i: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  if (!finalReport) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
        <FileText className="mx-auto mb-3 h-7 w-7 text-gray-300" />
        <p className="text-sm font-medium text-gray-700">
          输出报告将在这里呈现
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Writer 起草 → Reviewer 共识评分 → 不达 70 分自动 Reflexion 重写（最多
          2 轮）
        </p>
      </div>
    );
  }

  const sections = finalReport.sections ?? [];
  const wordCount = (() => {
    const all = [
      finalReport.summary ?? '',
      ...sections.map((s) => s.body ?? ''),
      finalReport.conclusion ?? '',
    ].join('\n');
    // 中英混合粗略统计：中文字符 ≈ 1 字，英文 word 按空格切
    const cn = (all.match(/[一-龥]/g) ?? []).length;
    const en = all
      .replace(/[一-龥]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    return cn + en;
  })();

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden" bordered>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md shadow-violet-500/20">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {finalReport.title || '研究报告'}
              </h2>
              <p className="text-xs text-gray-500">
                {sections.length} 章节 · {finalReport.citations?.length ?? 0}{' '}
                条引用 ·{' '}
                {wordCount >= 1000
                  ? `${(wordCount / 1000).toFixed(1)}k`
                  : wordCount}{' '}
                字
              </p>
            </div>
          </div>
          {finalScore != null && (
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-gray-500">
                CONSENSUS
              </p>
              <p className={`text-2xl font-bold ${scoreColor(finalScore)}`}>
                {finalScore}
              </p>
            </div>
          )}
        </div>

        {finalReport.summary && (
          <div className="border-b border-violet-100 bg-gradient-to-br from-violet-50/60 to-purple-50/40 px-5 py-4">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
              <Sparkles className="h-3 w-3" />
              执行摘要
            </p>
            <Markdown content={finalReport.summary} />
          </div>
        )}

        <div className="divide-y divide-gray-100">
          {sections.map((s, i) => {
            const open = !collapsed.has(i);
            return (
              <div key={`${s.heading}-${i}`} className="px-5 py-4">
                <button
                  type="button"
                  onClick={() => toggleSection(i)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                      {i + 1}
                    </span>
                    {s.heading}
                  </h3>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </button>
                {open && (
                  <div className="mt-3 pl-8">
                    <Markdown content={s.body || '(empty)'} />
                    {s.sources && s.sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {s.sources.map((src, j) => {
                          const href = safeHref(src);
                          if (!href) {
                            return (
                              <span
                                key={`${src}-${j}`}
                                title="non-http(s) source filtered"
                                className="inline-flex max-w-full items-center gap-1 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-400"
                              >
                                <span className="truncate">{src}</span>
                              </span>
                            );
                          }
                          return (
                            <a
                              key={`${href}-${j}`}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-full items-center gap-1 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-600 transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                            >
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{href}</span>
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {finalReport.conclusion && (
          <div className="border-t border-gray-100 bg-gradient-to-br from-violet-50/40 to-purple-50/40 px-5 py-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-violet-700">
              结论与建议
            </p>
            <Markdown content={finalReport.conclusion} />
          </div>
        )}
      </Card>

      {reports.length > 1 && (
        <Card className="p-4" bordered>
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <History className="h-4 w-4 text-gray-500" />
              Writer Reflexion 历史 · 共 {reports.length} 轮
            </span>
            <ChevronDown
              className={`h-4 w-4 text-gray-400 transition-transform ${showHistory ? 'rotate-180' : ''}`}
            />
          </button>
          {showHistory && (
            <ol className="mt-3 space-y-2">
              {reports.map((r) => (
                <li
                  key={r.attempt}
                  className="rounded-lg border border-gray-100 bg-gray-50/40 p-2"
                >
                  <p className="text-xs font-medium text-gray-700">
                    第 {r.attempt} 轮 · {r.report?.title ?? '（无标题）'}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">
                    {r.report?.summary}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}
