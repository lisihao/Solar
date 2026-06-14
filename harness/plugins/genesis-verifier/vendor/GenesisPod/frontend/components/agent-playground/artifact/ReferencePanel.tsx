'use client';

import { ExternalLink } from 'lucide-react';
import type { ArtifactCitation } from '@/lib/features/agent-playground/report-artifact.types';

interface Props {
  citations: ArtifactCitation[];
  highlightedIndex?: number | null;
  onClickReverseHighlight?: (citation: ArtifactCitation) => void;
}

const SOURCE_TYPE_COLOR: Record<ArtifactCitation['sourceType'], string> = {
  gov: 'bg-blue-100 text-blue-700',
  academic: 'bg-purple-100 text-purple-700',
  industry: 'bg-emerald-100 text-emerald-700',
  news: 'bg-amber-100 text-amber-700',
  blog: 'bg-gray-100 text-gray-700',
  community: 'bg-pink-100 text-pink-700',
  other: 'bg-gray-100 text-gray-500',
};
const SOURCE_TYPE_LABEL: Record<ArtifactCitation['sourceType'], string> = {
  gov: '政府',
  academic: '学术',
  industry: '行业',
  news: '新闻',
  blog: '博客',
  community: '社区',
  other: '其他',
};

/**
 * ReferencePanel —— 引用列表，支持反向溯源（baseline §8.3 [4]）。
 *
 * - hover/scroll 来源：从角标点击触发 scroll-into-view + 高亮 highlightedIndex
 * - click：触发 onClickReverseHighlight，调用方用 occurrences[] 高亮文中所有出现位置
 */
export function ReferencePanel({
  citations,
  highlightedIndex,
  onClickReverseHighlight,
}: Props) {
  if (citations.length === 0) return null;
  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-gray-900">
        参考文献（{citations.length}）
      </h3>
      <ol className="space-y-2">
        {citations.map((c) => (
          <li
            id={`ref-${c.index}`}
            key={c.index}
            className={`scroll-mt-4 rounded-md border p-2.5 transition-colors ${
              highlightedIndex === c.index
                ? 'border-violet-300 bg-violet-50'
                : 'border-gray-100 bg-gray-50/50'
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                className="cursor-pointer rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-200"
                onClick={() => onClickReverseHighlight?.(c)}
                title={`点击高亮文中 ${c.occurrences.length} 处出现`}
              >
                [{c.index}]
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1.5">
                  <span
                    className={`rounded px-1 py-0 text-[9px] font-medium ${SOURCE_TYPE_COLOR[c.sourceType]}`}
                  >
                    {SOURCE_TYPE_LABEL[c.sourceType]}
                  </span>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-clamp-2 flex-1 text-xs font-medium text-violet-700 hover:underline"
                  >
                    {c.title}
                    <ExternalLink className="ml-1 inline h-2.5 w-2.5" />
                  </a>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                  <span>{c.domain}</span>
                  {c.publishedAt && <span>· {c.publishedAt.slice(0, 10)}</span>}
                  {c.occurrences.length > 0 && (
                    <span className="rounded bg-gray-100 px-1 py-0 text-[10px] text-gray-600">
                      {c.occurrences.length} 处
                    </span>
                  )}
                  {c.occurrences.length > 0 && (
                    <span className="text-[10px] text-gray-400">
                      章:{' '}
                      {Array.from(
                        new Set(c.occurrences.map((o) => o.sectionId))
                      )
                        .slice(0, 3)
                        .join(', ')}
                    </span>
                  )}
                  <span
                    className={`ml-auto ${
                      c.credibilityScore >= 80
                        ? 'text-emerald-600'
                        : c.credibilityScore >= 60
                          ? 'text-amber-600'
                          : 'text-gray-400'
                    }`}
                  >
                    可信度 {c.credibilityScore}
                  </span>
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
