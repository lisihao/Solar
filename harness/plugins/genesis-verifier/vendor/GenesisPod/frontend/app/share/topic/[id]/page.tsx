'use client';

/**
 * Shared Topic Page
 *
 * 公开分享的专题页面（无需登录）
 * 左侧章节导航 + 右侧章节内容（与章节视图渲染一致）
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { config } from '@/lib/utils/config';
import { useParams } from 'next/navigation';
import { LoadingState } from '@/components/ui/states/LoadingState';
import Link from 'next/link';
import {
  getSharedTopic,
  getSharedTopicLatestReport,
} from '@/services/topic-insights/api';
import type {
  ResearchTopic,
  TopicReport,
  ReportChart,
} from '@/lib/types/topic-insights';
import { ResearchTopicType } from '@/lib/types/topic-insights';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { injectChartPlaceholders } from '@/lib/markdown/injectChartPlaceholders';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { KATEX_OPTIONS } from '@/lib/markdown/katexOptions';
import { preprocessLatex } from '@/lib/markdown/preprocessLatex';
import { stripProseBullets } from '@/lib/markdown/stripProseBullets';
import {
  ReportChartRenderer,
  RiskMatrixRenderer,
} from '@/components/common/chart-viewer/ReportChartRenderer';
import ClientDate from '@/components/common/ClientDate';

// ============================================================================
// Types & Config
// ============================================================================

const topicTypeConfig: Record<
  ResearchTopicType,
  { gradient: string; label: string }
> = {
  [ResearchTopicType.MACRO]: {
    gradient: 'from-blue-500 to-cyan-600',
    label: '宏观洞察',
  },
  [ResearchTopicType.TECHNOLOGY]: {
    gradient: 'from-purple-500 to-pink-600',
    label: '技术趋势',
  },
  [ResearchTopicType.COMPANY]: {
    gradient: 'from-emerald-500 to-teal-600',
    label: '企业追踪',
  },
  [ResearchTopicType.EVENT]: {
    gradient: 'from-orange-500 to-red-500',
    label: '事件洞察',
  },
};

interface ChapterItem {
  id: string;
  title: string;
  chapterNumber: number;
  content: string;
  charts: ReportChart[];
}

// ============================================================================
// Content Processing (same pipeline as ChapterizedReportView)
// ============================================================================

/** Process dimension content with the same pipeline as chapter view */
function processContent(raw: string): string {
  // 1. preprocessLatex (normalize bullets, fix subscripts, wrap math, etc.)
  let content = preprocessLatex(raw);
  // 2. Convert **text** to <strong>text</strong> (bypass CommonMark CJK issues)
  content = content.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  // 3. Strip prose bullets
  content = stripProseBullets(content);
  // 4. Strip word count annotations
  content = content.replace(/[（(][^）)]*(?:约?\d+字|字数[：:]\d+)[）)]/g, '');
  return content;
}

/** Build chapter list from report data */
function buildChapters(report: TopicReport): ChapterItem[] {
  const chapters: ChapterItem[] = [];
  let num = 1;

  if (report.dimensionAnalyses && report.dimensionAnalyses.length > 0) {
    for (const analysis of report.dimensionAnalyses) {
      const dimName = analysis.dimension?.name || `维度 ${num}`;

      // Use detailedContent (same as chapter view), fallback to summary
      let raw = '';
      if (
        analysis.detailedContent &&
        analysis.detailedContent.trim().length > 100
      ) {
        raw = analysis.detailedContent;
      } else if (analysis.summary && analysis.summary.trim().length > 5) {
        raw = analysis.summary;
      }

      if (raw.trim().length < 20) {
        num++;
        continue;
      }

      // Get charts for this chapter
      const sectionNumber = String(num);
      const chapterCharts = (report.charts || []).filter(
        (c) => c.sectionId === sectionNumber || c.sectionId === `section-${num}`
      );

      chapters.push({
        id: analysis.dimension?.id || `dim-${num}`,
        title: dimName,
        chapterNumber: num,
        content: processContent(raw),
        charts: chapterCharts,
      });

      num++;
    }
  }

  return chapters;
}

// ============================================================================
// Main Component
// ============================================================================

export default function SharedTopicPage() {
  const params = useParams();
  const topicId = params?.id as string;

  const [topic, setTopic] = useState<ResearchTopic | null>(null);
  const [report, setReport] = useState<TopicReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    null
  );
  const [showSidebar, setShowSidebar] = useState(true);

  // Build chapters
  const chapters = useMemo(() => {
    if (!report) return [];
    return buildChapters(report);
  }, [report]);

  const selectedChapter = chapters.find((c) => c.id === selectedChapterId);

  // Load data
  useEffect(() => {
    if (!topicId) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [topicData, reportData] = await Promise.all([
          getSharedTopic(topicId),
          getSharedTopicLatestReport(topicId).catch(() => null),
        ]);

        setTopic(topicData);
        setReport(reportData);

        // Select first chapter by default
        if (reportData) {
          const chs = buildChapters(reportData);
          if (chs.length > 0) {
            setSelectedChapterId(chs[0].id);
          }
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : '无法加载专题，请检查链接是否正确'
        );
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [topicId]);

  // Loading state
  if (loading) {
    return <LoadingState fullScreen text="加载中..." size="lg" />;
  }

  // Error state
  if (error || !topic) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="mx-4 max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">
            无法访问此专题
          </h1>
          <p className="mb-6 text-gray-600">
            {error || '该专题不存在或未设置为公开'}
          </p>
          <a
            href="/"
            className="inline-block rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
          >
            返回首页
          </a>
        </div>
      </div>
    );
  }

  const typeConfig = topicTypeConfig[topic.type] || topicTypeConfig.MACRO;

  return (
    <div className="flex min-h-screen bg-white">
      {/* Left Sidebar - Chapter Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-20 w-64 transform border-r border-gray-100 bg-gray-50/80 transition-transform lg:translate-x-0 ${
          showSidebar ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Topic Info */}
          <div className="border-b border-gray-100 p-4">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full bg-gradient-to-r ${typeConfig.gradient} px-2 py-0.5 text-xs font-medium text-white`}
              >
                {typeConfig.label}
              </span>
            </div>
            <h2 className="mt-2 line-clamp-2 text-sm font-bold text-gray-900">
              {topic.name}
            </h2>
            {report && (
              <p className="mt-1 text-xs text-gray-400">
                v{report.version || 1} ·{' '}
                {report.generatedAt ? (
                  <ClientDate date={report.generatedAt} format="date" />
                ) : (
                  ''
                )}
              </p>
            )}
          </div>

          {/* Chapter List */}
          <nav className="flex-1 overflow-y-auto p-3">
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              章节
            </p>
            <div className="space-y-0.5">
              {chapters.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => {
                    setSelectedChapterId(ch.id);
                    setShowSidebar(false);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    selectedChapterId === ch.id
                      ? 'bg-blue-100 font-medium text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className="mr-1.5 text-xs text-gray-400">
                    {ch.chapterNumber}.
                  </span>
                  {ch.title}
                </button>
              ))}
            </div>
          </nav>

          {/* Footer */}
          <div className="border-t border-gray-100 p-3">
            <Link
              href="/ai-insights"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              开始洞察
            </Link>
            <p className="mt-2 text-center text-[10px] text-gray-400">
              由 {config.brand.fullName} 生成
            </p>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {showSidebar && (
        <div
          className="fixed inset-0 z-10 bg-black/30 lg:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Main Content */}
      <main className="min-h-screen flex-1 lg:ml-64">
        {/* Mobile header */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur-sm lg:hidden">
          <button
            onClick={() => setShowSidebar(true)}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <h1 className="truncate text-sm font-bold text-gray-900">
            {topic.name}
          </h1>
        </div>

        {report && selectedChapter ? (
          <div className="mx-auto max-w-5xl px-6 py-8 lg:px-10">
            {/* Chapter Header */}
            <header className="mb-6 border-b border-gray-100 pb-4">
              <p className="mb-1 text-sm font-medium text-blue-600">
                章 {selectedChapter.chapterNumber}
              </p>
              <h1 className="text-2xl font-bold text-gray-900">
                {selectedChapter.title}
              </h1>
            </header>

            {/* Chapter Content with inline charts (same as ChapterizedReportView) */}
            <article className="prose prose-gray prose-headings:font-bold prose-h3:text-lg prose-h4:text-base prose-p:text-gray-700 prose-a:text-blue-600 prose-strong:text-gray-900 prose-li:text-gray-700 max-w-none leading-relaxed">
              {(() => {
                const rawContent = selectedChapter.content;
                const charts = selectedChapter.charts;
                const chartMap = new Map(charts.map((c) => [c.id, c]));

                // ★ 自救：未 embed 占位符时按 chart.position / 等距策略注入，
                //   与 ChapterizedReportView / ReportEditor 共用同一份平台逻辑。
                //   避免老报告或 mission 失败态 fullReport 把图全堆在末尾。
                const enriched =
                  !rawContent.includes('<!-- chart:') && charts.length > 0
                    ? injectChartPlaceholders(rawContent, charts)
                    : rawContent;

                // 仍无占位符（charts 为空）→ 单块渲染
                if (!enriched.includes('<!-- chart:')) {
                  return (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeRaw, [rehypeKatex, KATEX_OPTIONS]]}
                    >
                      {enriched}
                    </ReactMarkdown>
                  );
                }

                // Split at chart placeholders: <!-- chart:chartId -->
                const segments = enriched.split(/<!--\s*chart:([^\s]+?)\s*-->/);
                const elements: React.ReactNode[] = [];

                for (let si = 0; si < segments.length; si++) {
                  if (si % 2 === 0) {
                    // Text segment
                    const text = segments[si].trim();
                    if (text) {
                      elements.push(
                        <ReactMarkdown
                          key={`md-${si}`}
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[
                            rehypeRaw,
                            [rehypeKatex, KATEX_OPTIONS],
                          ]}
                        >
                          {text}
                        </ReactMarkdown>
                      );
                    }
                  } else {
                    // Chart ID segment
                    const chart = chartMap.get(segments[si]);
                    if (chart) {
                      elements.push(
                        <div key={`chart-${segments[si]}`} className="my-6">
                          <ReportChartRenderer chart={chart} />
                        </div>
                      );
                    }
                  }
                }

                return elements;
              })()}
            </article>

            {/* Chapter Navigation */}
            <nav className="mt-12 flex items-center justify-between border-t border-gray-100 pt-6">
              {(() => {
                const idx = chapters.findIndex(
                  (c) => c.id === selectedChapterId
                );
                const prev = idx > 0 ? chapters[idx - 1] : null;
                const next =
                  idx < chapters.length - 1 ? chapters[idx + 1] : null;
                return (
                  <>
                    {prev ? (
                      <button
                        onClick={() => {
                          setSelectedChapterId(prev.id);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
                      >
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
                            d="M15 19l-7-7 7-7"
                          />
                        </svg>
                        {prev.title}
                      </button>
                    ) : (
                      <div />
                    )}
                    {next ? (
                      <button
                        onClick={() => {
                          setSelectedChapterId(next.id);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                      >
                        {next.title}
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
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    ) : (
                      <span className="rounded-lg bg-green-100 px-4 py-2 text-sm text-green-700">
                        已读完全部内容
                      </span>
                    )}
                  </>
                );
              })()}
            </nav>
          </div>
        ) : !report ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-gray-500">该专题暂无研究报告</p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
