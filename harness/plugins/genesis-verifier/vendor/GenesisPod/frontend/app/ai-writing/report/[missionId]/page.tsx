'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ClientDate from '@/components/common/ClientDate';
import { LoadingState } from '@/components/ui';
import { XCircle } from 'lucide-react';

interface PublicReport {
  id: string;
  title: string;
  description: string;
  status: string;
  leader: string;
  createdAt: string;
  completedAt: string | null;
  fullContent: string;
  taskCount: number;
  totalWords: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Fix markdown table formatting
function fixMarkdownTables(content: string): string {
  return content.replace(
    /\|([^|\n]+)\|([^|\n]+)\|/g,
    (match, col1, col2) => `| ${col1.trim()} | ${col2.trim()} |`
  );
}

export default function PublicReportPage() {
  const params = useParams();
  const missionId = params?.missionId as string;

  const [report, setReport] = useState<PublicReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(-1); // -1 = View All
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!missionId) return;

    const fetchReport = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${API_BASE}/api/v1/public/reports/${missionId}`
        );
        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data = result?.data ?? result;
        if (data?.success && data?.report) {
          setReport(data.report);
        } else {
          setError(data?.message || '无法加载报告');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [missionId]);

  // Extract display title from content (e.g., 《人间长歌》)
  const displayTitle = useMemo(() => {
    if (!report?.fullContent) return report?.title || '报告';

    // Look for 《XXX》 pattern in the content (usually from chapter titles)
    const bookTitleMatch = report.fullContent.match(/《([^》]+)》/);
    if (bookTitleMatch) {
      return `《${bookTitleMatch[1]}》`;
    }

    // Fallback: if title is too long, truncate it
    if (report.title && report.title.length > 30) {
      return report.title.substring(0, 30) + '...';
    }

    return report?.title || '报告';
  }, [report?.fullContent, report?.title]);

  // Split content into chapters
  const chapters = useMemo(() => {
    if (!report?.fullContent) return [];

    const chapterPattern =
      /卷[一二三四五六七八九十百\d]+|第[一二三四五六七八九十百千\d]+[章节回]|Chapter\s*\d+/i;
    const chapterRegex =
      /(?=^##\s+(?:卷[一二三四五六七八九十百\d]+|第[一二三四五六七八九十百千\d]+[章节回]|Chapter\s*\d+))/gim;
    const parts = report.fullContent.split(chapterRegex).filter(Boolean);

    const chapterParts = parts.filter((part) => {
      const firstLine = part
        .split('\n')[0]
        .replace(/^#+\s*/, '')
        .trim();
      return chapterPattern.test(firstLine);
    });

    if (chapterParts.length === 0) {
      return [{ title: '完整报告', content: report.fullContent }];
    }

    return chapterParts.map((content, idx) => {
      const firstLine = content
        .split('\n')[0]
        .replace(/^#+\s*/, '')
        .trim();
      return {
        title: firstLine || `第 ${idx + 1} 章`,
        content: content.trim(),
      };
    });
  }, [report?.fullContent]);

  // Extract short chapter name (e.g., "夜雨破庙" from "卷一 第1章《夜雨破庙》")
  const getShortChapterName = (title: string, idx: number): string => {
    const match = title.match(/《([^》]+)》/);
    if (match) return match[1];
    // Try to get the last part after 章
    const afterChapter = title.match(/[章节回]\s*[《]?([^》《]+)[》]?$/);
    if (afterChapter) return afterChapter[1].trim();
    return `第${idx + 1}章`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <LoadingState size="lg" text="正在加载报告..." />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <XCircle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-gray-800">
            无法加载报告
          </h2>
          <p className="mt-2 text-gray-500">
            {error || '报告不存在或已被删除'}
          </p>
          <a
            href="/"
            className="mt-6 inline-block rounded-lg bg-green-500 px-6 py-2 text-white transition-colors hover:bg-green-600"
          >
            返回首页
          </a>
        </div>
      </div>
    );
  }

  const displayContent =
    currentPage === -1
      ? report.fullContent
      : chapters[currentPage]?.content || report.fullContent;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Sidebar Toggle */}
              {chapters.length > 1 && (
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100"
                  title={sidebarOpen ? '收起目录' : '展开目录'}
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
              )}
              <div>
                <h1 className="text-xl font-bold text-gray-800">
                  {displayTitle}
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                  {report.taskCount} 章节 | {report.totalWords.toLocaleString()}{' '}
                  字 | 负责人: {report.leader}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                已完成
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Floating Sidebar - Chapter Navigation */}
      {chapters.length > 1 && sidebarOpen && (
        <aside className="fixed left-4 top-24 z-40 max-h-[calc(100vh-120px)] w-56 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          <nav className="p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              目录
            </h2>
            <ul className="space-y-0.5">
              <li>
                <button
                  onClick={() => setCurrentPage(-1)}
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                    currentPage === -1
                      ? 'bg-green-100 font-medium text-green-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  全部内容
                </button>
              </li>
              <li className="my-1.5 border-t border-gray-100" />
              {chapters.map((chapter, idx) => (
                <li key={idx}>
                  <button
                    onClick={() => setCurrentPage(idx)}
                    title={chapter.title}
                    className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                      currentPage === idx
                        ? 'bg-green-100 font-medium text-green-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <span className="mr-1.5 flex-shrink-0 text-gray-400">
                      {idx + 1}.
                    </span>
                    <span className="truncate">
                      {getShortChapterName(chapter.title, idx)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      )}

      {/* Main Content */}
      <main
        className={`px-4 py-8 lg:px-8 ${sidebarOpen && chapters.length > 1 ? 'ml-60' : ''}`}
      >
        <div className="mx-auto max-w-4xl">
          <article className="rounded-xl bg-white p-8 shadow-sm">
            <div className="prose prose-lg prose-headings:text-gray-800 prose-p:text-gray-600 prose-li:text-gray-600 prose-strong:text-gray-800 prose-table:w-full prose-th:bg-gray-100 prose-th:px-4 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-gray-700 prose-td:px-4 prose-td:py-2 prose-td:text-gray-600 prose-tr:border-b prose-tr:border-gray-200 max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {fixMarkdownTables(displayContent)}
              </ReactMarkdown>
            </div>
          </article>

          {/* Pagination */}
          {chapters.length > 1 && currentPage !== -1 && (
            <div className="mt-6 flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
              <button
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
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
                上一章
              </button>
              <span className="text-sm text-gray-500">
                {currentPage + 1} / {chapters.length}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(chapters.length - 1, p + 1))
                }
                disabled={currentPage === chapters.length - 1}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一章
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
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white py-6">
        <div className="mx-auto max-w-5xl px-4 text-center text-sm text-gray-500">
          <p>
            报告完成于{' '}
            {report.completedAt ? (
              <ClientDate
                date={report.completedAt}
                format="datetime"
                locale="zh-CN"
              />
            ) : (
              '未知时间'
            )}
          </p>
          <p className="mt-1">Powered by AI Teams</p>
        </div>
      </footer>
    </div>
  );
}
