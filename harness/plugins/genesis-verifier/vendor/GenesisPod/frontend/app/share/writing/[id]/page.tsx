'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { config } from '@/lib/utils/config';
import { LoadingState } from '@/components/ui/states/LoadingState';

interface Chapter {
  id: string;
  title: string;
  content: string;
  chapterNumber: number;
  wordCount: number;
}

interface Volume {
  id: string;
  title: string;
  volumeNumber: number;
  chapters: Chapter[];
}

interface PublicProject {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  currentWords: number;
  targetWords: number;
  volumes: Volume[];
  storyBible?: {
    premise?: string;
    theme?: string;
    tone?: string;
    worldType?: string;
  };
}

// 清理章节内容：移除占位符文本和章节标题行
const cleanChapterContent = (content: string): string => {
  if (!content) return '';
  return (
    content
      // 移除占位符文本
      .replace(/【修复后的内容】/g, '')
      .replace(/【正文开始】/g, '')
      .replace(/【正文结束】/g, '')
      .replace(/【待创作】/g, '')
      .replace(/【内容待补充】/g, '')
      // 移除 markdown 章节标题行 (### 第X章 标题)
      .replace(
        /^#{1,6}\s*第[一二三四五六七八九十百千零〇\d]+[章回节][：:\s]*[^\n]*\n*/gm,
        ''
      )
      // 移除纯文本章节标题行 (第X章 标题)
      .replace(
        /^第[一二三四五六七八九十百千零〇\d]+[章回节][：:\s]*[^\n]*\n*/gm,
        ''
      )
      // 移除可能带有空格前缀的 markdown 标题
      .replace(
        /^\s+#{1,6}\s*第[一二三四五六七八九十百千零〇\d]+[章回节][^\n]*\n*/gm,
        ''
      )
      .trim()
  );
};

export default function PublicReadPage() {
  const params = useParams();
  const projectId = params?.id as string;

  const [project, setProject] = useState<PublicProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [showToc, setShowToc] = useState(true);
  const [showFloatingMenu, setShowFloatingMenu] = useState(false);
  const [readProgress, setReadProgress] = useState(0);

  // Track scroll position for floating menu and reading progress
  const handleScroll = useCallback(() => {
    const scrollTop = window.scrollY;
    const docHeight =
      document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    setReadProgress(Math.min(100, Math.round(progress)));

    // Show floating menu after scrolling down 200px
    setShowFloatingMenu(scrollTop > 200);
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/v1/ai-writing/public/${projectId}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError('作品不存在或未公开分享');
          } else {
            setError('加载失败，请稍后重试');
          }
          return;
        }
        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data = result?.data ?? result;
        setProject(data);

        // 默认选中第一章
        const allChapters = data?.volumes
          ?.flatMap((v: Volume) => v.chapters || [])
          .sort((a: Chapter, b: Chapter) => a.chapterNumber - b.chapterNumber);
        if (allChapters?.length > 0) {
          setSelectedChapter(allChapters[0]);
        }
      } catch {
        setError('网络错误，请检查连接');
      } finally {
        setLoading(false);
      }
    };

    if (projectId) {
      void fetchProject();
    }
  }, [projectId]);

  const allChapters =
    project?.volumes
      ?.flatMap((v) => v.chapters || [])
      .sort((a, b) => a.chapterNumber - b.chapterNumber) || [];

  const currentIndex = selectedChapter
    ? allChapters.findIndex((c) => c.id === selectedChapter.id)
    : -1;
  const prevChapter = currentIndex > 0 ? allChapters[currentIndex - 1] : null;
  const nextChapter =
    currentIndex < allChapters.length - 1
      ? allChapters[currentIndex + 1]
      : null;

  if (loading) {
    return <LoadingState fullScreen text="加载中..." size="lg" />;
  }

  if (error || !project) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
        <span className="mb-4 text-6xl">📖</span>
        <h1 className="mb-2 text-xl font-semibold text-gray-800">
          {error || '作品不存在'}
        </h1>
        <p className="mb-6 text-gray-500">该作品可能未公开或已被删除</p>
        <Link
          href="/"
          className="rounded-lg bg-amber-500 px-6 py-2 text-white hover:bg-amber-600"
        >
          返回首页
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white">
      {/* Header - offset by sidebar width on desktop */}
      <header className="sticky top-0 z-10 border-b border-amber-100 bg-white/80 backdrop-blur-sm md:ml-72">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowToc(!showToc)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 md:hidden"
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
            <div>
              <h1 className="text-lg font-bold text-gray-900">
                {project.name || '未命名作品'}
              </h1>
              <p className="text-xs text-gray-500">
                {(project.currentWords ?? 0).toLocaleString()} 字 ·{' '}
                {allChapters.length} 章
              </p>
            </div>
          </div>
          <Link
            href="/ai-writing"
            className="flex items-center gap-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            <span>✨</span>
            开始创作
          </Link>
        </div>
      </header>

      {/* Sidebar - Table of Contents (fixed on desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-20 w-72 transform border-r border-gray-100 bg-white pt-16 shadow-lg transition-transform ${
          showToc ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="h-full overflow-y-auto p-4">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">目录</h2>
          <nav className="space-y-1">
            {allChapters.map((chapter) => (
              <button
                key={chapter.id}
                onClick={() => {
                  setSelectedChapter(chapter);
                  setShowToc(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  selectedChapter?.id === chapter.id
                    ? 'bg-amber-100 font-medium text-amber-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="text-gray-400">
                  第{chapter.chapterNumber}章
                </span>{' '}
                {(chapter.title || '').replace(
                  /^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i,
                  ''
                )}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {showToc && (
        <div
          className="fixed inset-0 z-10 bg-black/30 md:hidden"
          onClick={() => setShowToc(false)}
        />
      )}

      {/* Main Content - offset by sidebar width on desktop */}
      <main className="min-h-screen px-4 py-8 md:ml-72 md:px-8">
        {selectedChapter ? (
          <article className="mx-auto max-w-2xl">
            {/* Chapter Title */}
            <header className="mb-8 border-b border-gray-100 pb-6">
              <p className="mb-1 text-sm text-amber-600">
                第 {selectedChapter.chapterNumber} 章
              </p>
              <h2 className="text-2xl font-bold text-gray-900">
                {(selectedChapter.title || '').replace(
                  /^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i,
                  ''
                )}
              </h2>
              <p className="mt-2 text-sm text-gray-400">
                {selectedChapter.wordCount?.toLocaleString() || 0} 字
              </p>
            </header>

            {/* Chapter Content */}
            <div className="prose prose-gray prose-p:text-justify prose-p:leading-8 prose-p:text-gray-700 prose-p:indent-8 prose-headings:hidden max-w-none">
              {selectedChapter.content ? (
                <ReactMarkdown
                  components={{
                    // 隐藏章节标题（因为已经在 header 显示了）
                    h1: () => null,
                    h2: () => null,
                    h3: () => null,
                    // 段落样式
                    p: ({ children }) => (
                      <p
                        className="mb-4 text-justify leading-8 text-gray-700"
                        style={{ textIndent: '2em' }}
                      >
                        {children}
                      </p>
                    ),
                  }}
                >
                  {cleanChapterContent(selectedChapter.content)}
                </ReactMarkdown>
              ) : (
                <p className="text-center text-gray-400">暂无内容</p>
              )}
            </div>

            {/* Navigation */}
            <nav className="mt-12 flex items-center justify-between border-t border-gray-100 pt-6">
              {prevChapter ? (
                <button
                  onClick={() => {
                    setSelectedChapter(prevChapter);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-100"
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
              ) : (
                <div />
              )}
              {nextChapter ? (
                <button
                  onClick={() => {
                    setSelectedChapter(nextChapter);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-white hover:bg-amber-600"
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
              ) : (
                <div className="rounded-lg bg-green-100 px-4 py-2 text-sm text-green-700">
                  已读完全部章节
                </div>
              )}
            </nav>
          </article>
        ) : (
          <div className="flex flex-col items-center justify-center py-20">
            <span className="mb-4 text-5xl">📖</span>
            <p className="text-gray-500">请从左侧目录选择章节开始阅读</p>
          </div>
        )}
      </main>

      {/* Floating Menu */}
      <div
        className={`fixed bottom-6 left-1/2 z-30 -translate-x-1/2 transform transition-all duration-300 ${
          showFloatingMenu
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-10 opacity-0'
        }`}
      >
        <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur-sm">
          {/* Toggle TOC */}
          <button
            onClick={() => setShowToc(!showToc)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
            title="目录"
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
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            </svg>
          </button>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-200" />

          {/* Previous Chapter */}
          <button
            onClick={() => {
              if (prevChapter) {
                setSelectedChapter(prevChapter);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            disabled={!prevChapter}
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
            title="上一章"
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          {/* Progress Indicator */}
          <div className="flex min-w-[100px] flex-col items-center px-2">
            <span className="text-xs font-medium text-gray-700">
              {selectedChapter
                ? `第${selectedChapter.chapterNumber}章`
                : '选择章节'}
            </span>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-300"
                style={{ width: `${readProgress}%` }}
              />
            </div>
            <span className="mt-0.5 text-[10px] text-gray-400">
              {currentIndex + 1}/{allChapters.length} · {readProgress}%
            </span>
          </div>

          {/* Next Chapter */}
          <button
            onClick={() => {
              if (nextChapter) {
                setSelectedChapter(nextChapter);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            disabled={!nextChapter}
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
            title="下一章"
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
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-200" />

          {/* Scroll to Top */}
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
            title="回到顶部"
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
                d="M5 10l7-7m0 0l7 7m-7-7v18"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white py-6">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-gray-400">
          <p>
            由{' '}
            <Link href="/" className="text-amber-600 hover:underline">
              {config.brand.name} AI Writing
            </Link>{' '}
            生成
          </p>
        </div>
      </footer>
    </div>
  );
}
