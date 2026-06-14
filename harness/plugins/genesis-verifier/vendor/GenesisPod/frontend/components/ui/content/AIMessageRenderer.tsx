'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AIMessageRendererProps {
  content: string;
  className?: string;
  /** 是否为暗色背景（用户消息） */
  isDark?: boolean;
}

/**
 * AI消息渲染器
 *
 * 优化的Markdown渲染，提供更好的中文内容展示：
 * - 清晰的标题层级和视觉分隔
 * - 适当的段落间距
 * - 优化的列表展示
 * - 代码块高亮
 * - 引用块样式
 */
export default function AIMessageRenderer({
  content,
  className = '',
  isDark = false,
}: AIMessageRendererProps) {
  return (
    <div className={`ai-message-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 标题样式 - 添加视觉层级和间距
          h1: ({ children }) => (
            <h1
              className={`mb-3 mt-4 border-b pb-2 text-lg font-bold first:mt-0 ${
                isDark
                  ? 'border-white/20 text-white'
                  : 'border-gray-200 text-gray-900'
              }`}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className={`mb-2 mt-4 flex items-center gap-2 text-base font-bold first:mt-0 ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              <span
                className={`inline-block h-4 w-1 rounded-full ${
                  isDark ? 'bg-white/60' : 'bg-red-500'
                }`}
              />
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className={`mb-2 mt-3 flex items-center gap-1.5 text-sm font-bold first:mt-0 ${
                isDark ? 'text-white/90' : 'text-gray-900'
              }`}
            >
              <span
                className={`inline-block h-3 w-0.5 rounded-full ${
                  isDark ? 'bg-white/40' : 'bg-blue-500'
                }`}
              />
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4
              className={`mb-1.5 mt-2 text-sm font-medium first:mt-0 ${
                isDark ? 'text-white/80' : 'text-gray-700'
              }`}
            >
              {children}
            </h4>
          ),

          // 段落样式 - 适当的间距和行高
          p: ({ children }) => (
            <p
              className={`mb-3 text-sm leading-relaxed last:mb-0 ${
                isDark ? 'text-white/95' : 'text-gray-700'
              }`}
            >
              {children}
            </p>
          ),

          // 无序列表
          ul: ({ children }) => (
            <ul
              className={`mb-3 ml-1 space-y-1.5 last:mb-0 ${
                isDark ? 'text-white/90' : 'text-gray-700'
              }`}
            >
              {children}
            </ul>
          ),

          // 有序列表
          ol: ({ children }) => (
            <ol
              className={`mb-3 ml-1 list-inside list-decimal space-y-1.5 last:mb-0 ${
                isDark ? 'text-white/90' : 'text-gray-700'
              }`}
            >
              {children}
            </ol>
          ),

          // 列表项
          li: ({ children }) => (
            <li className="flex items-start gap-2 text-sm leading-relaxed">
              <span
                className={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                  isDark ? 'bg-white/60' : 'bg-red-400'
                }`}
              />
              <span className="flex-1">{children}</span>
            </li>
          ),

          // 粗体
          strong: ({ children }) => (
            <strong
              className={`font-semibold ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              {children}
            </strong>
          ),

          // 斜体
          em: ({ children }) => (
            <em className={isDark ? 'text-white/90' : 'text-gray-600'}>
              {children}
            </em>
          ),

          // 代码块
          // Note: react-markdown v9+ no longer passes 'inline' prop
          code: ({ className, children, ...props }) => {
            const codeString = String(children).replace(/\n$/, '');
            const hasLanguage = /language-(\w+)/.test(className || '');
            const hasNewlines = codeString.includes('\n');
            const isInline = !hasLanguage && !hasNewlines;

            if (isInline) {
              return (
                <code
                  className={`font-mono rounded px-1.5 py-0.5 text-xs ${
                    isDark
                      ? 'bg-white/20 text-white'
                      : 'bg-gray-100 text-red-600'
                  }`}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={`font-mono block overflow-x-auto rounded-lg p-3 text-xs ${
                  isDark
                    ? 'bg-black/30 text-white/90'
                    : 'bg-gray-900 text-gray-100'
                }`}
                {...props}
              >
                {children}
              </code>
            );
          },

          // 代码块容器
          pre: ({ children }) => (
            <pre className="mb-3 overflow-hidden rounded-lg last:mb-0">
              {children}
            </pre>
          ),

          // 引用块
          blockquote: ({ children }) => (
            <blockquote
              className={`mb-3 border-l-4 pl-4 italic last:mb-0 ${
                isDark
                  ? 'border-white/40 text-white/80'
                  : 'border-red-300 bg-red-50/50 py-2 text-gray-600'
              }`}
            >
              {children}
            </blockquote>
          ),

          // 链接
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline decoration-1 underline-offset-2 transition-colors ${
                isDark
                  ? 'text-blue-300 hover:text-blue-200'
                  : 'text-red-600 hover:text-red-700'
              }`}
            >
              {children}
            </a>
          ),

          // 水平分割线
          hr: () => (
            <hr
              className={`my-4 border-t ${
                isDark ? 'border-white/20' : 'border-gray-200'
              }`}
            />
          ),

          // 表格
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto last:mb-0">
              <table
                className={`min-w-full text-sm ${
                  isDark ? 'text-white/90' : 'text-gray-700'
                }`}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className={isDark ? 'bg-white/10' : 'bg-gray-50'}>
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th
              className={`px-3 py-2 text-left text-xs font-semibold ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className={`border-t px-3 py-2 ${
                isDark ? 'border-white/10' : 'border-gray-200'
              }`}
            >
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
