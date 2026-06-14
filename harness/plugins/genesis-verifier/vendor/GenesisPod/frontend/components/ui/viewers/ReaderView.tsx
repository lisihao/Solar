'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { config } from '@/lib/utils/config';
import TableOfContents from '../content/TableOfContents';
import { sanitizeHtml } from '@/lib/utils/sanitize';

import { logger } from '@/lib/utils/logger';
interface ReaderViewProps {
  url: string;
  title?: string;
  className?: string;
  category?: string; // 资源类别，用于选择合适的API端点
  isImportedResource?: boolean; // 是否为已导入的资源（来自数据库），如果是则不限制域名
  fallbackContent?: string; // 当代理加载失败时显示的预存内容
  onArticleLoaded?: (article: Article) => void;
}

interface Article {
  success: boolean;
  title: string;
  content: string;
  textContent: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
  length?: number;
  sourceUrl: string;
}

// 主题配置 - 参考 Medium/Substack 的配色方案
type ThemeType = 'light' | 'sepia' | 'dark';
type FontSizeType = 'small' | 'medium' | 'large';

const themes: Record<
  ThemeType,
  {
    bg: string;
    text: string;
    secondary: string;
    border: string;
    heading: string;
  }
> = {
  light: {
    bg: 'bg-white',
    text: 'text-gray-700',
    secondary: 'text-gray-500',
    border: 'border-gray-200',
    heading: 'text-gray-900',
  },
  sepia: {
    bg: 'bg-[#FBF7F0]',
    text: 'text-[#5C4B37]',
    secondary: 'text-[#8B7355]',
    border: 'border-[#E8DFD0]',
    heading: 'text-[#3D2E1C]',
  },
  dark: {
    bg: 'bg-[#1A1A1A]',
    text: 'text-gray-300',
    secondary: 'text-gray-500',
    border: 'border-gray-700',
    heading: 'text-gray-100',
  },
};

const fontSizes: Record<
  FontSizeType,
  { body: string; heading: string; meta: string }
> = {
  small: { body: 'text-[15px]', heading: 'text-2xl', meta: 'text-xs' },
  medium: { body: 'text-[18px]', heading: 'text-3xl', meta: 'text-sm' },
  large: { body: 'text-[21px]', heading: 'text-4xl', meta: 'text-base' },
};

// 处理 HTML 内容 - 清理多余空白和优化结构
function processHtmlContent(
  html: string,
  _currentTheme: typeof themes.light,
  _theme: ThemeType
): string {
  // 移除多余的空段落和换行
  let processed = html
    // 移除空的 p 标签
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '')
    // 移除多余的 br 标签
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
    // 移除段落开头的 br
    .replace(/<p>\s*<br\s*\/?>/gi, '<p>')
    // 移除段落结尾的 br
    .replace(/<br\s*\/?>\s*<\/p>/gi, '</p>')
    // 清理连续空白
    .replace(/\s{3,}/g, ' ')
    // 移除只包含空白的 div
    .replace(/<div>\s*<\/div>/gi, '');

  // 识别并标记元信息（日期、来源等短文本）
  processed = processed.replace(
    /<p>([A-Za-z]+ \d{1,2}, \d{4})<\/p>/gi,
    '<p class="meta-info">$1</p>'
  );

  return processed;
}

// 处理纯文本内容 - 智能识别结构
function processPlainTextContent(
  content: string,
  currentTheme: typeof themes.light,
  currentFontSize: typeof fontSizes.medium,
  _theme: ThemeType
): React.ReactNode[] {
  // 按段落分割，过滤空行
  const paragraphs = content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return paragraphs.map((paragraph, index) => {
    const trimmed = paragraph.trim();

    // 检测是否为元信息（日期、短标签等）
    const isMetaInfo =
      /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}$/i.test(
        trimmed
      ) ||
      /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(trimmed) ||
      (trimmed.length < 30 &&
        /^(In The News|Read Article|Share|Tags?:|Source:|By\s|Published|Updated)/.test(
          trimmed
        ));

    if (isMetaInfo) {
      return (
        <p key={index} className={`text-sm ${currentTheme.secondary} mb-2`}>
          {trimmed}
        </p>
      );
    }

    // 检测标题模式
    const isNumberedHeading =
      /^(\d+\.|\w+\s+\d+[:.])/.test(trimmed) && trimmed.length < 100;
    const isSectionHeading =
      /^(Section|Chapter|Part|Sec\.|Summary|Introduction|Conclusion|Background|Overview|Key\s|Main\s)/i.test(
        trimmed
      ) && trimmed.length < 120;
    const isAllCaps =
      trimmed === trimmed.toUpperCase() &&
      trimmed.length < 60 &&
      /^[A-Z\s]+$/.test(trimmed);
    const isShortTitle =
      trimmed.length < 60 &&
      !trimmed.includes('.') &&
      /^[A-Z]/.test(trimmed) &&
      !trimmed.includes(',');

    if (isAllCaps || isNumberedHeading || isSectionHeading) {
      return (
        <h2
          key={index}
          className={`mb-3 mt-6 text-xl font-bold ${currentTheme.heading}`}
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          {trimmed}
        </h2>
      );
    }

    if (isShortTitle && index > 0 && index < paragraphs.length - 1) {
      return (
        <h3
          key={index}
          className={`mb-2 mt-5 text-lg font-semibold ${currentTheme.heading}`}
        >
          {trimmed}
        </h3>
      );
    }

    // 检测列表
    const lines = trimmed.split('\n');
    const listLines = lines.filter((line) =>
      /^(\s*[-•*]\s+|\s*\d+[.)]\s+|\s*\([a-z]\)\s+|\s*\([ivx]+\)\s+)/i.test(
        line
      )
    );
    const isListBlock =
      listLines.length > 1 && listLines.length === lines.length;

    if (isListBlock) {
      return (
        <ul key={index} className="my-4 list-disc space-y-1 pl-5">
          {lines.map((item, i) => {
            const cleanItem = item
              .replace(
                /^(\s*[-•*]\s+|\s*\d+[.)]\s+|\s*\([a-z]\)\s+|\s*\([ivx]+\)\s+)/i,
                ''
              )
              .trim();
            return cleanItem ? (
              <li key={i} className={`leading-relaxed ${currentTheme.text}`}>
                {cleanItem}
              </li>
            ) : null;
          })}
        </ul>
      );
    }

    // 普通段落
    return (
      <p
        key={index}
        className={`mb-4 leading-relaxed ${currentFontSize.body} ${currentTheme.text}`}
      >
        {paragraph.split('\n').map((line, lineIndex) => (
          <span key={lineIndex}>
            {line}
            {lineIndex < paragraph.split('\n').length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  });
}

/**
 * Reader View组件 - 使用Mozilla Readability提取清洁内容
 *
 * 功能特性:
 * - 完美规避X-Frame-Options、CSP等安全限制
 * - 提取网页主要内容，去除广告和干扰元素
 * - 统一的阅读样式，优秀的阅读体验
 * - 支持AI完整分析内容
 * - 快速加载，节省流量
 */
export default function ReaderView({
  url,
  title: propTitle,
  className = '',
  category,
  isImportedResource = false,
  fallbackContent,
  onArticleLoaded,
}: ReaderViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // 阅读体验设置
  const [theme, setTheme] = useState<ThemeType>('light');
  const [fontSize, setFontSize] = useState<FontSizeType>('medium');
  const [readingProgress, setReadingProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 计算阅读进度
  const handleScroll = useCallback(() => {
    if (!contentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    const progress = Math.min(
      100,
      Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)
    );
    setReadingProgress(isNaN(progress) ? 0 : progress);
  }, []);

  // 加载文章内容
  useEffect(() => {
    const loadArticle = async () => {
      setLoading(true);
      setError(null);

      try {
        // 根据资源类别选择合适的API端点
        // News类型使用html-reader-news（无域名限制），其他类型使用html-reader（有域名白名单）
        logger.debug('[ReaderView]', { category, url });

        // 决定使用哪个端点：
        // 1. 已导入的资源（来自数据库）：使用无域名限制的 html-reader-news 端点
        // 2. 新闻类别或新闻域名：使用无域名限制的 html-reader-news 端点
        // 3. 其他情况：使用有白名单限制的 html-reader 端点
        const newsDomains = [
          'reuters.com',
          'bbc.com',
          'theguardian.com',
          'nytimes.com',
          'wsj.com',
          'ft.com',
          'bloomberg.com',
          'apnews.com',
          'cnn.com',
          'foxnews.com',
          'nbcnews.com',
          'abcnews.go.com',
          'cbsnews.com',
        ];
        const urlDomain = new URL(url).hostname.replace('www.', '');
        const isNewsByDomain = newsDomains.some((domain) =>
          urlDomain.includes(domain)
        );
        const isNewsByCategory = category?.toLowerCase() === 'news';
        const isNews = isNewsByCategory || isNewsByDomain;

        // 关键逻辑：已导入资源使用无限制端点，确保用户可以打开所有已收录的内容
        const useUnrestrictedEndpoint = isImportedResource || isNews;
        const endpoint = useUnrestrictedEndpoint
          ? 'html-reader-news'
          : 'html-reader';
        const readerUrl = `${config.apiUrl}/proxy/${endpoint}?url=${encodeURIComponent(url)}`;
        logger.debug(
          `[ReaderView] Using endpoint: ${endpoint} (imported: ${isImportedResource}, category: ${isNewsByCategory}, domain: ${isNewsByDomain})`
        );
        logger.debug(`[ReaderView] Fetching: ${readerUrl}`);

        const response = await fetch(readerUrl);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message ||
              `HTTP ${response.status}: ${response.statusText}`
          );
        }

        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data: Article = result?.data ?? result;

        // Check wrapper success (result.success) and article content (data.content)
        if (result.success === false || !data.content) {
          throw new Error('Failed to extract readable content from this page');
        }

        logger.debug(
          `Article loaded successfully: "${data.title}" (${data.length} characters)`
        );
        setArticle(data);
        onArticleLoaded?.(data);
        setLoading(false);
        setError(null);
      } catch (err) {
        logger.error(`Failed to load article from ${url}:`, err);
        setLoading(false);
        setError(
          err instanceof Error
            ? `无法提取内容: ${err.message}`
            : '无法提取可读内容。该网页可能不支持阅读模式。'
        );
      }
    };

    loadArticle();
  }, [url, retryCount]);

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
  };

  const handleOpenInNewTab = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const currentTheme = themes[theme];
  const currentFontSize = fontSizes[fontSize];

  return (
    <div className={`relative flex h-full flex-col ${className}`}>
      {/* 阅读进度条 */}
      {article && !loading && (
        <div className="absolute left-0 right-0 top-0 z-20 h-1 bg-gray-200">
          <div
            className="h-full bg-gradient-to-r from-[hsl(var(--primary)/0.8)] to-[hsl(var(--primary))] transition-all duration-150 ease-out"
            style={{ width: `${readingProgress}%` }}
          />
        </div>
      )}

      {/* 控制栏 */}
      <div
        className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${currentTheme.bg} ${currentTheme.border}`}
      >
        {/* 阅读模式标识 + 进度 */}
        <div
          className={`flex items-center gap-2 text-sm font-medium ${currentTheme.text}`}
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
          </svg>
          <span>阅读模式</span>
          {article && (
            <span className={`ml-1 ${currentTheme.secondary}`}>
              · {readingProgress}%
            </span>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1">
          {/* 阅读设置按钮 */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`rounded-lg p-1.5 transition-colors ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
              title="阅读设置"
            >
              <svg
                className={`h-4 w-4 ${currentTheme.text}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                />
              </svg>
            </button>

            {/* 设置面板 */}
            {showSettings && (
              <div
                className={`absolute right-0 top-full z-30 mt-2 w-48 rounded-lg border p-3 shadow-lg ${currentTheme.bg} ${currentTheme.border}`}
              >
                {/* 主题选择 */}
                <div className="mb-3">
                  <div
                    className={`mb-2 text-xs font-medium ${currentTheme.secondary}`}
                  >
                    主题
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setTheme('light')}
                      className={`flex-1 rounded px-2 py-1 text-xs ${theme === 'light' ? 'bg-primary text-primary-foreground' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      浅色
                    </button>
                    <button
                      onClick={() => setTheme('sepia')}
                      className={`flex-1 rounded px-2 py-1 text-xs ${theme === 'sepia' ? 'bg-primary text-primary-foreground' : 'bg-[#F5EFE6] text-[#5C4B37] hover:bg-[#E8DFD0]'}`}
                    >
                      护眼
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={`flex-1 rounded px-2 py-1 text-xs ${theme === 'dark' ? 'bg-primary text-primary-foreground' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
                    >
                      深色
                    </button>
                  </div>
                </div>

                {/* 字号选择 */}
                <div>
                  <div
                    className={`mb-2 text-xs font-medium ${currentTheme.secondary}`}
                  >
                    字号
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setFontSize('small')}
                      className={`flex-1 rounded px-2 py-1 text-xs ${fontSize === 'small' ? 'bg-primary text-primary-foreground' : theme === 'dark' ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      小
                    </button>
                    <button
                      onClick={() => setFontSize('medium')}
                      className={`flex-1 rounded px-2 py-1 text-xs ${fontSize === 'medium' ? 'bg-primary text-primary-foreground' : theme === 'dark' ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      中
                    </button>
                    <button
                      onClick={() => setFontSize('large')}
                      className={`flex-1 rounded px-2 py-1 text-xs ${fontSize === 'large' ? 'bg-primary text-primary-foreground' : theme === 'dark' ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      大
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleRetry}
            className={`rounded-lg p-1.5 transition-colors ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
            title="刷新"
          >
            <svg
              className={`h-4 w-4 ${currentTheme.text}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>

          <button
            onClick={handleOpenInNewTab}
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            title="在新标签页打开原始页面"
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
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            打开原始
          </button>
        </div>
      </div>

      {/* 文章内容区域 */}
      <div
        ref={contentRef}
        onScroll={handleScroll}
        className={`relative flex-1 overflow-y-auto ${currentTheme.bg}`}
      >
        {/* Loading State */}
        {loading && (
          <div
            className={`absolute inset-0 z-10 flex items-center justify-center ${currentTheme.bg}`}
          >
            <div className="text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-primary"></div>
              <p className="mt-4 text-sm text-gray-600">正在提取内容...</p>
              <p className="mt-2 text-xs text-gray-500">
                使用 Reader Mode 解析网页
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50">
            <div className="max-w-md px-4 text-center">
              <svg
                className="mx-auto h-16 w-16 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                预览不可用
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                该网站限制了内容代理访问，请点击下方按钮在浏览器中直接打开。
              </p>
              {fallbackContent && (
                <div className="mt-4 max-h-40 overflow-y-auto rounded-lg bg-white p-4 text-left text-sm text-gray-700 shadow-inner">
                  {fallbackContent.substring(0, 500)}
                  {fallbackContent.length > 500 && '...'}
                </div>
              )}
              <div className="mt-6 flex justify-center gap-3">
                <button
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
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
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  重试{retryCount > 0 && ` (${retryCount})`}
                </button>
                <button
                  onClick={handleOpenInNewTab}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                  打开原始页面
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 文章内容 - 优化的阅读样式 */}
        {article && !loading && !error && (
          <div className="relative mx-auto w-full max-w-[900px] 2xl:max-w-[1100px]">
            {/* 悬浮目录导航 - 放在文章左侧 */}
            <TableOfContents
              content={article.content}
              containerRef={contentRef}
              theme={theme}
              className="hidden xl:block"
              defaultCollapsed={true}
            />

            {/* 文章内容区域 */}
            <article className="mx-auto max-w-[720px] px-4 py-8 sm:px-6 md:px-8 lg:px-12 2xl:max-w-[860px]">
              {/* 文章元信息 - 紧凑的头部设计 */}
              <header className={`mb-6 ${currentTheme.border}`}>
                <h1
                  className={`font-serif mb-3 font-bold leading-snug tracking-tight ${currentFontSize.heading} ${currentTheme.heading}`}
                  style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                >
                  {article.title || propTitle || '无标题'}
                </h1>

                {/* 元信息行 - 单行紧凑显示 */}
                <div
                  className={`flex flex-wrap items-center gap-2 text-sm ${currentTheme.secondary}`}
                >
                  {article.siteName && (
                    <span className="font-medium">{article.siteName}</span>
                  )}
                  {article.siteName && article.byline && <span>·</span>}
                  {article.byline && <span>{article.byline}</span>}
                  {(article.siteName || article.byline) && article.length && (
                    <span>·</span>
                  )}
                  {article.length && (
                    <span>{Math.ceil(article.length / 1000)} min read</span>
                  )}
                </div>

                {/* 摘要 - 突出显示 */}
                {article.excerpt && (
                  <p
                    className={`mt-4 border-l-4 border-[hsl(var(--primary))] pl-4 text-base italic leading-relaxed ${currentTheme.secondary}`}
                  >
                    {article.excerpt}
                  </p>
                )}

                {/* 分隔线 */}
                <div className={`mt-6 border-b ${currentTheme.border}`} />
              </header>

              {/* 文章正文 - 优化排版 */}
              <div
                className={`article-content
                ${currentFontSize.body} leading-relaxed
                ${currentTheme.text}`}
                style={{
                  fontFamily:
                    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                }}
              >
                {/* 智能处理 HTML 内容 - sanitized to prevent XSS */}
                {article.content.includes('<p>') ||
                article.content.includes('<div>') ||
                article.content.includes('<h') ? (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(
                        processHtmlContent(article.content, currentTheme, theme)
                      ),
                    }}
                    className="processed-html"
                  />
                ) : (
                  // 纯文本内容：智能识别格式并转换
                  <div className="plain-text-content">
                    {processPlainTextContent(
                      article.content,
                      currentTheme,
                      currentFontSize,
                      theme
                    )}
                  </div>
                )}
              </div>

              {/* 文章底部样式 */}
              <style jsx global>{`
                .article-content h1,
                .article-content h2 {
                  font-family: Georgia, 'Times New Roman', serif;
                  font-weight: 700;
                  margin-top: 2rem;
                  margin-bottom: 0.75rem;
                  line-height: 1.3;
                }
                .article-content h1 {
                  font-size: 1.5rem;
                }
                .article-content h2 {
                  font-size: 1.25rem;
                }
                .article-content h3 {
                  font-size: 1.125rem;
                  font-weight: 600;
                  margin-top: 1.5rem;
                  margin-bottom: 0.5rem;
                }

                .article-content p {
                  margin-bottom: 1.25rem;
                  line-height: 1.75;
                }

                .article-content p:empty,
                .article-content br + br {
                  display: none;
                }

                .article-content a {
                  color: #2563eb;
                  text-decoration: none;
                  font-weight: 500;
                }
                .article-content a:hover {
                  text-decoration: underline;
                }

                .article-content strong,
                .article-content b {
                  font-weight: 600;
                  color: ${theme === 'dark'
                    ? '#f3f4f6'
                    : theme === 'sepia'
                      ? '#3D2E1C'
                      : '#111827'};
                }

                .article-content blockquote {
                  border-left: 4px solid #3b82f6;
                  padding-left: 1rem;
                  margin: 1.5rem 0;
                  font-style: italic;
                  color: ${theme === 'dark'
                    ? '#9ca3af'
                    : theme === 'sepia'
                      ? '#8B7355'
                      : '#6b7280'};
                }

                .article-content ul,
                .article-content ol {
                  margin: 1rem 0;
                  padding-left: 1.5rem;
                }
                .article-content li {
                  margin-bottom: 0.5rem;
                  line-height: 1.7;
                }

                .article-content img {
                  max-width: 100%;
                  height: auto;
                  border-radius: 0.5rem;
                  margin: 1.5rem auto;
                  display: block;
                }

                .article-content hr {
                  border: none;
                  border-top: 1px solid
                    ${theme === 'dark'
                      ? '#374151'
                      : theme === 'sepia'
                        ? '#E8DFD0'
                        : '#e5e7eb'};
                  margin: 2rem 0;
                }

                .article-content pre,
                .article-content code {
                  font-family:
                    ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
                    monospace;
                  font-size: 0.875rem;
                }
                .article-content code {
                  background: ${theme === 'dark'
                    ? '#374151'
                    : theme === 'sepia'
                      ? '#EDE5D8'
                      : '#f3f4f6'};
                  padding: 0.125rem 0.375rem;
                  border-radius: 0.25rem;
                }
                .article-content pre {
                  background: ${theme === 'dark' ? '#111827' : '#1f2937'};
                  color: #f3f4f6;
                  padding: 1rem;
                  border-radius: 0.5rem;
                  overflow-x: auto;
                  margin: 1.5rem 0;
                }
                .article-content pre code {
                  background: none;
                  padding: 0;
                }

                .article-content table {
                  width: 100%;
                  border-collapse: collapse;
                  margin: 1.5rem 0;
                }
                .article-content th,
                .article-content td {
                  border: 1px solid
                    ${theme === 'dark'
                      ? '#374151'
                      : theme === 'sepia'
                        ? '#E8DFD0'
                        : '#e5e7eb'};
                  padding: 0.75rem;
                  text-align: left;
                }
                .article-content th {
                  background: ${theme === 'dark'
                    ? '#1f2937'
                    : theme === 'sepia'
                      ? '#EDE5D8'
                      : '#f9fafb'};
                  font-weight: 600;
                }

                /* 清理多余空白 */
                .processed-html > div > *:first-child {
                  margin-top: 0;
                }
                .processed-html > div > *:last-child {
                  margin-bottom: 0;
                }

                /* 元信息样式（如日期、来源等短文本）*/
                .article-content .meta-info {
                  font-size: 0.875rem;
                  color: ${theme === 'dark'
                    ? '#9ca3af'
                    : theme === 'sepia'
                      ? '#8B7355'
                      : '#6b7280'};
                  margin-bottom: 0.5rem;
                }
              `}</style>
            </article>
          </div>
        )}
      </div>
    </div>
  );
}
