'use client';

/**
 * Research Page渲染器
 * 专门用于显示结构化研究文档
 *
 * SECURITY: All HTML content is sanitized using DOMPurify to prevent XSS attacks
 */

import React, { useState } from 'react';
import {
  FileText,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Search,
  Download,
} from 'lucide-react';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { formatDateSafe } from '@/lib/utils/date';
import type { ResearchPageTemplate } from '@/lib/templates/research-page-templates';
import { config } from '@/lib/utils/config';

interface ResearchPageRendererProps {
  content: string;
  template?: ResearchPageTemplate;
  onEdit?: () => void;
}

export default function ResearchPageRenderer({
  content,
  template,
  onEdit,
}: ResearchPageRendererProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  );
  const [showOutline, setShowOutline] = useState(true);

  // 解析Markdown内容为章节
  const parseContentSections = (
    markdown: string
  ): Array<{ id: string; title: string; content: string; level: number }> => {
    const sections: Array<{
      id: string;
      title: string;
      content: string;
      level: number;
    }> = [];
    const lines = markdown.split('\n');
    let currentSection: {
      id: string;
      title: string;
      content: string[];
      level: number;
    } | null = null;

    for (const line of lines) {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        if (currentSection) {
          sections.push({
            ...currentSection,
            content: currentSection.content.join('\n'),
          });
        }
        const level = heading[1].length;
        const title = heading[2];
        currentSection = {
          id: title.toLowerCase().replace(/\s+/g, '-'),
          title,
          level,
          content: [],
        };
      } else if (currentSection) {
        currentSection.content.push(line);
      }
    }

    if (currentSection) {
      sections.push({
        ...currentSection,
        content: currentSection.content.join('\n'),
      });
    }

    return sections;
  };

  const sections = parseContentSections(content);

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  // 渲染Markdown内容（简化版）
  // SECURITY: Output is sanitized to prevent XSS attacks
  const renderMarkdown = (text: string) => {
    let html = text;

    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 斜体
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // 代码
    html = html.replace(
      /`(.+?)`/g,
      '<code class="bg-gray-100 px-1 py-0.5 rounded text-sm">$1</code>'
    );
    // 列表
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(
      /(<li>.*<\/li>\n?)+/g,
      '<ul class="list-disc ml-6 my-2 space-y-1">$&</ul>'
    );

    // Sanitize the output to prevent XSS
    return sanitizeHtml(html);
  };

  return (
    <div className="flex h-full">
      {/* 左侧大纲导航 */}
      {showOutline && (
        <div className="w-64 flex-shrink-0 border-r border-gray-200 bg-gray-50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center text-sm font-semibold text-gray-700">
              <BookOpen className="mr-2 h-4 w-4" />
              文档大纲
            </h3>
            <button
              onClick={() => setShowOutline(false)}
              className="text-gray-400 hover:text-gray-600"
              title="隐藏大纲"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-1">
            {sections
              .filter((s) => s.level <= 2) // 只显示h1和h2
              .map((section) => (
                <button
                  key={section.id}
                  onClick={() => {
                    const element = document.getElementById(
                      `section-${section.id}`
                    );
                    element?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    });
                  }}
                  className={`w-full rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-gray-200 ${
                    section.level === 1
                      ? 'font-semibold text-gray-900'
                      : 'ml-4 text-gray-600'
                  }`}
                >
                  {section.title}
                </button>
              ))}
          </div>
          {/* 模板信息 */}
          {template && (
            <div className="mt-6 rounded-lg border border-gray-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold uppercase text-gray-500">
                模板信息
              </div>
              <div className="space-y-1 text-xs text-gray-600">
                <div>{template.nameCn}</div>
                <div className="text-gray-400">{template.category}</div>
                <div className="text-gray-400">
                  引用格式: {template.style.citationStyle.toUpperCase()}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 右侧主内容区 */}
      <div className="flex-1 overflow-y-auto bg-white">
        {/* 顶部操作栏 */}
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {!showOutline && (
                <button
                  onClick={() => setShowOutline(true)}
                  className="rounded p-1.5 text-gray-600 hover:bg-gray-100"
                  title="显示大纲"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
              <FileText className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                Research Page
              </h2>
            </div>

            <div className="flex items-center space-x-2">
              {onEdit && (
                <button
                  onClick={onEdit}
                  className="rounded bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
                >
                  编辑文档
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 文档内容 */}
        <div className="mx-auto max-w-4xl px-8 py-8">
          {sections.map((section) => (
            <div
              key={section.id}
              id={`section-${section.id}`}
              className="mb-8 scroll-mt-20"
            >
              {/* 章节标题 */}
              <div
                className={`mb-4 flex items-center ${
                  section.level === 1 ? 'border-b-2 border-gray-200 pb-2' : ''
                }`}
              >
                {section.level === 1 ? (
                  <h1 className="flex-1 text-3xl font-bold text-gray-900">
                    {section.title}
                  </h1>
                ) : section.level === 2 ? (
                  <h2 className="flex-1 text-2xl font-semibold text-gray-800">
                    {section.title}
                  </h2>
                ) : (
                  <h3 className="flex-1 text-xl font-semibold text-gray-700">
                    {section.title}
                  </h3>
                )}

                {section.level === 2 && (
                  <button
                    onClick={() => toggleSection(section.id)}
                    className="ml-2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title={expandedSections.has(section.id) ? '收起' : '展开'}
                  >
                    {expandedSections.has(section.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>

              {/* 章节内容 */}
              {(section.level === 1 || !expandedSections.has(section.id)) && (
                <div
                  className="prose prose-slate max-w-none leading-relaxed text-gray-700"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(section.content),
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* 页脚 */}
        <div className="border-t border-gray-200 bg-gray-50 px-8 py-4 text-center">
          <div className="text-xs text-gray-500">
            Generated by AI Office · {config.brand.fullName} ·{' '}
            {formatDateSafe(new Date(), 'date')}
          </div>
        </div>
      </div>
    </div>
  );
}
