'use client';

import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n';
import { triggerCitationClick } from '@/components/common/citations/citationNavigation';

export interface CitationBadgeProps {
  index: number;
  evidence: {
    id: string;
    title?: string | null;
    url?: string | null;
    snippet?: string | null;
    domain?: string | null;
    /** Optional richer metadata (parity with TI tooltip footer) */
    sourceType?: string | null;
    credibilityScore?: number | null;
    publishedAt?: string | null;
    accessedAt?: string | null;
  };
}

/** Map sourceType enum to short Chinese label + tone */
function sourceTypeBadge(t?: string | null): {
  label: string;
  cls: string;
} | null {
  if (!t) return null;
  const map: Record<string, { label: string; cls: string }> = {
    gov: { label: '政府', cls: 'bg-blue-100 text-blue-700' },
    academic: { label: '学术', cls: 'bg-indigo-100 text-indigo-700' },
    industry: { label: '行业', cls: 'bg-emerald-100 text-emerald-700' },
    news: { label: '新闻', cls: 'bg-orange-100 text-orange-700' },
    blog: { label: '博客', cls: 'bg-amber-100 text-amber-700' },
    community: { label: '社区', cls: 'bg-pink-100 text-pink-700' },
    other: { label: '其他', cls: 'bg-gray-100 text-gray-600' },
  };
  return map[t] ?? { label: t, cls: 'bg-gray-100 text-gray-600' };
}

/**
 * Credibility colorization — backend 输出 0-100 整数 scale
 * (gov=95, arxiv/nature=92, reuters/wsj=85, github/wikipedia=80, default=65, blog=50)
 * 阈值与 TI ReferencePanel.getCredibilityDisplay 对齐：≥70 高 / ≥40 中 / <40 低
 */
function credibilityClass(score?: number | null): string {
  if (score == null) return 'bg-gray-100 text-gray-600';
  if (score >= 70) return 'bg-emerald-100 text-emerald-700';
  if (score >= 40) return 'bg-amber-100 text-amber-700';
  return 'bg-rose-100 text-rose-700';
}

/** Format ISO date to YYYY-MM-DD; tolerate invalid */
function shortDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function CitationBadge({ index, evidence }: CitationBadgeProps) {
  const { t } = useI18n();
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
    below?: boolean;
  } | null>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    cancelHideTimeout();
    setIsHovered(true);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceAbove = rect.top;
      const showBelow = spaceAbove < 200;
      setTooltipPos({
        top: showBelow ? rect.bottom + 8 : rect.top - 8,
        left: Math.min(
          Math.max(rect.left + rect.width / 2, 200),
          window.innerWidth - 200
        ),
        below: showBelow,
      });
    }
  }, [cancelHideTimeout]);

  const handleMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 150);
  }, []);

  // Scroll to in-page reference entry [N]
  // Uses querySelectorAll to find the closest match when multiple chapters
  // have the same ref-N id (chapter view renders refs per chapter).
  const scrollToRef = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsHovered(false);
    const candidates = document.querySelectorAll(`[id="ref-${index}"]`);
    if (candidates.length === 0) return;
    // Pick the one closest to the clicked badge
    const badge = triggerRef.current;
    let refEl: HTMLElement = candidates[0] as HTMLElement;
    if (badge && candidates.length > 1) {
      const badgeY = badge.getBoundingClientRect().top;
      let minDist = Infinity;
      for (const el of candidates) {
        const dist = Math.abs(
          (el as HTMLElement).getBoundingClientRect().top - badgeY
        );
        if (dist < minDist) {
          minDist = dist;
          refEl = el as HTMLElement;
        }
      }
    }
    let container: HTMLElement | null = refEl.parentElement;
    while (container) {
      const style = getComputedStyle(container);
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        container.scrollHeight > container.clientHeight
      ) {
        break;
      }
      container = container.parentElement;
    }
    if (container) {
      const cRect = container.getBoundingClientRect();
      const tRect = refEl.getBoundingClientRect();
      container.scrollTo({
        top: container.scrollTop + tRect.top - cRect.top,
        behavior: 'smooth',
      });
    } else {
      refEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    refEl.style.backgroundColor = '#fef3c7';
    setTimeout(() => {
      refEl.style.backgroundColor = '';
    }, 2000);
  };

  // Switch to references TAB
  const goToReferencesTab = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsHovered(false);
    if (evidence.id) {
      triggerCitationClick(evidence.id);
    }
  };

  // Default click: scroll to page ref, fallback to TAB
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const refEl = document.getElementById(`ref-${index}`);
    if (refEl) {
      scrollToRef(e);
    } else if (evidence.id) {
      triggerCitationClick(evidence.id);
    }
  };

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <sup
        ref={triggerRef}
        onClick={handleClick}
        className="cursor-pointer rounded bg-purple-100 px-1 py-0.5 text-[10px] font-medium text-purple-700 transition-colors hover:bg-purple-200"
        title={t('topicResearch.citation.jumpToReference')}
      >
        [{index}]
      </sup>

      {isHovered &&
        tooltipPos &&
        typeof window !== 'undefined' &&
        createPortal(
          <div
            className="fixed z-[9999] w-96 rounded-lg border border-gray-200 bg-white shadow-xl"
            style={{
              top: tooltipPos.top,
              left: tooltipPos.left,
              transform: tooltipPos.below
                ? 'translate(-50%, 0)'
                : 'translate(-50%, -100%)',
            }}
            onMouseEnter={() => {
              cancelHideTimeout();
              setIsHovered(true);
            }}
            onMouseLeave={handleMouseLeave}
          >
            <div className="flex items-start gap-2 border-b border-gray-100 p-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                {index}
              </span>
              <div className="min-w-0 flex-1">
                <h4 className="line-clamp-2 text-sm font-medium text-gray-900">
                  {evidence.title || t('topicResearch.citation.unknownSource')}
                </h4>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {evidence.domain && (
                    <span className="text-gray-400">{evidence.domain}</span>
                  )}
                  {(() => {
                    const b = sourceTypeBadge(evidence.sourceType);
                    return b ? (
                      <span
                        className={`rounded px-1.5 py-0.5 font-medium ${b.cls}`}
                      >
                        {b.label}
                      </span>
                    ) : null;
                  })()}
                  {evidence.credibilityScore != null && (
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${credibilityClass(evidence.credibilityScore)}`}
                      title="可信度评分"
                    >
                      可信 {Math.round(evidence.credibilityScore)}%
                    </span>
                  )}
                  {shortDate(evidence.publishedAt) && (
                    <span className="text-gray-500" title="发布时间">
                      {shortDate(evidence.publishedAt)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {evidence.snippet && (
              <div className="max-h-48 overflow-y-auto p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                  {evidence.snippet}
                </p>
              </div>
            )}

            <div className="flex items-center gap-3 border-t border-gray-100 bg-gray-50 px-3 py-2">
              <button
                onClick={scrollToRef}
                className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-800"
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                </svg>
                {t('topicResearch.citation.scrollToRef') || '跳转到页内'}
              </button>
              <button
                onClick={goToReferencesTab}
                className="flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-800"
              >
                {t('topicResearch.citation.viewFullSource')}
              </button>
              {evidence.url && (
                <a
                  href={evidence.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t('topicResearch.citation.openOriginal')}
                </a>
              )}
            </div>
          </div>,
          document.body
        )}
    </span>
  );
}
