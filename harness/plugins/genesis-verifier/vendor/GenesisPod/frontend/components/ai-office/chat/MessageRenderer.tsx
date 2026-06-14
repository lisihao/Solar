'use client';

/**
 * 富文本消息渲染器
 * 提供优雅的Markdown渲染，支持结构化内容（时间线、事件列表等）
 */

import React, { useMemo } from 'react';
import { Table, THead, Tr, Th, Td } from '@/components/ui/table';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CollapsibleBlockquote } from '@/components/ui/collapsible/CollapsibleBlockquote';

interface SourceReference {
  title: string;
  sourceUrl: string | null;
}

interface MessageRendererProps {
  content: string;
  role: 'user' | 'assistant';
  sources?: SourceReference[];
}

/**
 * 预处理内容，将结构化格式转换为更好的Markdown
 */
function preprocessContent(
  content: string,
  sources?: SourceReference[]
): string {
  let processed = content;

  // 处理带标签的列表项（如 "• 事：xxx" 或 "• 时间：xxx"）
  processed = processed.replace(
    /•\s*(事件?|时间|备注|说明|详情|原因|结果|影响)\s*[：:]\s*/g,
    '\n  - **$1**: '
  );

  // 将方括号引用 [标题] 转换成可点击链接
  if (sources && sources.length > 0) {
    // 创建源数据列表，用于模糊匹配
    const sourcesList = sources
      .filter((s) => s.sourceUrl)
      .map((s) => ({
        title: s.title,
        titleLower: s.title.toLowerCase(),
        url: s.sourceUrl!,
      }));

    // 匹配所有 [xxx] 格式的引用（包括带省略号的）
    processed = processed.replace(/\[([^\]]+)\]/g, (match, citationText) => {
      // 移除末尾省略号以便匹配
      const cleanCitation = citationText
        .replace(/\.{2,}$/, '')
        .replace(/…$/, '')
        .trim()
        .toLowerCase();

      // 如果引用文本太短（可能是 Markdown 链接语法），跳过
      if (cleanCitation.length < 5) {
        return match;
      }

      // 查找最佳匹配
      let bestMatch: { url: string; score: number } | null = null;

      for (const source of sourcesList) {
        let score = 0;

        // 精确匹配（最高分）
        if (source.titleLower === cleanCitation) {
          score = 100;
        }
        // 源标题包含引用文本
        else if (source.titleLower.includes(cleanCitation)) {
          score = 80;
        }
        // 引用文本包含源标题
        else if (cleanCitation.includes(source.titleLower)) {
          score = 70;
        }
        // 源标题以引用文本开头
        else if (source.titleLower.startsWith(cleanCitation.slice(0, 15))) {
          score = 60;
        }
        // 引用文本以源标题开头
        else if (cleanCitation.startsWith(source.titleLower.slice(0, 15))) {
          score = 50;
        }
        // 前10个字符匹配
        else if (
          source.titleLower.slice(0, 10) === cleanCitation.slice(0, 10)
        ) {
          score = 40;
        }

        if (score > 0 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { url: source.url, score };
        }
      }

      // 如果找到匹配且分数够高，转换成链接
      if (bestMatch && bestMatch.score >= 40) {
        return `[${citationText}](${bestMatch.url})`;
      }

      // 否则保持原样但加上样式标记，表明这是一个引用
      return `**[${citationText}]**`;
    });
  }

  // 清理多余空行
  processed = processed.replace(/\n{3,}/g, '\n\n');

  return processed;
}

export default function MessageRenderer({
  content,
  role,
  sources,
}: MessageRendererProps) {
  // 预处理内容
  const processedContent = useMemo(
    () => preprocessContent(content, sources),
    [content, sources]
  );

  return (
    <div
      className={`message-renderer prose prose-slate max-w-none ${role === 'assistant' ? 'ai-message' : 'user-message'}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 标题渲染 - Genspark风格
          h1: ({ node, ...props }) => (
            <h1
              className="mb-4 mt-6 border-b-2 border-blue-500 pb-2 text-2xl font-bold text-gray-900"
              {...props}
            />
          ),
          h2: ({ node, ...props }) => (
            <h2
              className="mb-3 mt-5 flex items-center gap-2 text-xl font-bold text-gray-800 before:h-6 before:w-1 before:rounded-full before:bg-blue-500 before:content-['']"
              {...props}
            />
          ),
          h3: ({ node, ...props }) => (
            <h3
              className="mb-2 mt-4 text-lg font-semibold text-gray-700"
              {...props}
            />
          ),
          h4: ({ node, ...props }) => (
            <h4
              className="mb-2 mt-3 text-base font-semibold text-gray-700"
              {...props}
            />
          ),

          // 段落 - 增加行高和间距
          p: ({ node, ...props }) => (
            <p className="my-3 leading-relaxed text-gray-700" {...props} />
          ),

          // 列表 - 清晰的列表样式
          ul: ({ node, ...props }) => (
            <ul className="my-3 space-y-2 pl-0" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="my-3 list-decimal space-y-2 pl-5" {...props} />
          ),
          li: ({
            children,
            ...props
          }: React.LiHTMLAttributes<HTMLLIElement> & {
            children?: React.ReactNode;
          }) => {
            const isOrdered = false;
            // 检查是否是包含标签的结构化内容（如 "事件："、"时间："）
            const childText = String(children || '');
            const hasLabel =
              /^[•●]\s*(事|时间|备注|件|项)/.test(childText) ||
              /^(事件?|时间|备注|说明|详情)\s*[：:]/i.test(childText);

            return (
              <li
                className={`
                  ${isOrdered ? 'ml-4 list-decimal' : 'list-none'}
                  ${!isOrdered && !hasLabel ? 'relative pl-5 before:absolute before:left-0 before:top-2.5 before:h-1.5 before:w-1.5 before:rounded-full before:bg-blue-500' : ''}
                  ${hasLabel ? 'flex flex-col gap-1 pl-0' : ''}
                  leading-relaxed text-gray-700
                `}
                {...props}
              >
                {children}
              </li>
            );
          },

          // 引用块 - 使用可折叠组件
          blockquote: ({ node, ...props }) => (
            <CollapsibleBlockquote {...props} />
          ),

          // 代码块 - 语法高亮
          // Note: react-markdown v9+ no longer passes 'inline' prop
          code: ({
            node,
            className,
            children,
            ...props
          }: React.HTMLAttributes<HTMLElement> & {
            node?: unknown;
            className?: string;
          }) => {
            const codeString = String(children).replace(/\n$/, '');
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const hasNewlines = codeString.includes('\n');
            const isInline = !match && !hasNewlines;

            return !isInline ? (
              <div className="my-4 overflow-hidden rounded-lg shadow-md">
                <div className="font-mono flex items-center justify-between bg-gray-800 px-4 py-2 text-xs text-gray-300">
                  <span>{language || 'code'}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(codeString);
                    }}
                    className="text-gray-400 transition-colors hover:text-white"
                  >
                    复制
                  </button>
                </div>
                <SyntaxHighlighter
                  style={vscDarkPlus}
                  language={language || 'text'}
                  PreTag="div"
                  className="!mb-0 !mt-0"
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            ) : (
              <code
                className="font-mono rounded bg-gray-100 px-1.5 py-0.5 text-sm text-red-600"
                {...props}
              >
                {children}
              </code>
            );
          },

          // 表格 - 优雅样式
          table: ({ node, ...props }) => (
            <div className="my-4 overflow-x-auto">
              <Table
                className="min-w-full border-collapse overflow-hidden rounded-lg bg-white shadow-sm"
                {...props}
              />
            </div>
          ),
          thead: ({ node, ...props }) => (
            <THead
              className="bg-gradient-to-r from-blue-500 to-blue-600 text-white"
              {...props}
            />
          ),
          th: ({ node, ...props }) => (
            <Th
              className="px-4 py-3 text-left text-sm font-semibold"
              {...props}
            />
          ),
          td: ({ node, ...props }) => (
            <Td
              className="border-t border-gray-200 px-4 py-3 text-sm text-gray-700"
              {...props}
            />
          ),
          tr: ({ node, ...props }) => (
            <Tr className="transition-colors hover:bg-blue-50" {...props} />
          ),

          // 链接 - 带下划线和悬停效果
          a: ({ node, ...props }) => (
            <a
              className="text-blue-600 underline decoration-blue-300 transition-colors hover:text-blue-800 hover:decoration-blue-600"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),

          // 强调文本
          strong: ({ node, ...props }) => (
            <strong className="font-bold text-gray-900" {...props} />
          ),
          em: ({ node, ...props }) => (
            <em className="italic text-gray-800" {...props} />
          ),

          // 分隔线
          hr: ({ node, ...props }) => (
            <hr className="my-6 border-t-2 border-gray-200" {...props} />
          ),
        }}
      >
        {processedContent}
      </ReactMarkdown>

      <style jsx global>{`
        .message-renderer.ai-message {
          @apply rounded-lg bg-gradient-to-br from-white to-blue-50/30 p-4 shadow-sm;
        }

        .message-renderer.user-message {
          @apply rounded-lg bg-white p-4;
        }

        /* 优化prose样式 */
        .prose {
          @apply text-base;
        }

        .prose h1,
        .prose h2,
        .prose h3,
        .prose h4 {
          @apply font-sans;
        }

        /* 列表嵌套样式 */
        .prose ul ul,
        .prose ol ul,
        .prose ul ol,
        .prose ol ol {
          @apply my-1 ml-4;
        }

        /* 结构化内容样式（事件、时间、备注等） */
        .prose li strong {
          @apply font-semibold text-blue-700;
        }

        /* 改善列表项间距 */
        .prose ul > li {
          @apply my-1;
        }

        .prose ul > li > ul {
          @apply mb-2 mt-1 border-l-2 border-blue-100 pl-3;
        }

        /* 代码块滚动条样式 */
        .prose pre::-webkit-scrollbar {
          height: 8px;
        }

        .prose pre::-webkit-scrollbar-track {
          background: #1e293b;
          border-radius: 4px;
        }

        .prose pre::-webkit-scrollbar-thumb {
          background: #475569;
          border-radius: 4px;
        }

        .prose pre::-webkit-scrollbar-thumb:hover {
          background: #64748b;
        }
      `}</style>
    </div>
  );
}
