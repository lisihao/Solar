'use client';

import React from 'react';
import { BookOpen } from 'lucide-react';
import type { PaperAISummary } from '@/lib/types/ai-office';
import ClientDate from '@/components/common/ClientDate';
import { SectionPanelCard } from '@/components/ui/cards';
import { MarkdownViewer } from '@/components/common/markdown-viewer';

/**
 * 学术论文专属结构化摘要组件
 * 针对论文资源优化，展示论文的核心贡献、方法和结果
 */
interface PaperAISummaryProps {
  summary: PaperAISummary;
  compact?: boolean;
  expandable?: boolean;
}

const DifficultyBadge: React.FC<{ difficulty: string }> = ({ difficulty }) => {
  const colors = {
    beginner: {
      bg: 'bg-green-50',
      text: 'text-green-700',
      border: 'border-green-200',
      emoji: '🌱',
    },
    intermediate: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      border: 'border-blue-200',
      emoji: '📚',
    },
    advanced: {
      bg: 'bg-orange-50',
      text: 'text-orange-700',
      border: 'border-orange-200',
      emoji: '🚀',
    },
    expert: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      border: 'border-red-200',
      emoji: '⚡',
    },
  };

  const style =
    colors[difficulty as keyof typeof colors] || colors.intermediate;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium ${style.bg} ${style.text} ${style.border}`}
    >
      <span>{style.emoji}</span>
      {difficulty}
    </span>
  );
};

export const PaperAISummaryComponent: React.FC<PaperAISummaryProps> = ({
  summary,
  compact = false,
  expandable = true,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(!compact);

  return (
    <SectionPanelCard
      title={summary.field}
      subtitle={summary.subfield}
      icon={<BookOpen className="h-4 w-4" />}
      accent="blue"
      actions={<DifficultyBadge difficulty={summary.difficulty} />}
    >
      {/* 子头部：概览 + 论文指标 */}
      <div className="border-b border-gray-100 px-4 py-3">
        {/* 核心概览 */}
        {compact && !isExpanded ? (
          <p className="text-sm font-medium leading-relaxed text-gray-700">
            {summary.overview.substring(0, 150)}...
          </p>
        ) : (
          <div className="prose prose-sm max-w-none text-gray-700">
            <MarkdownViewer content={summary.overview} />
          </div>
        )}

        {/* 论文指标 */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <span>📖 {summary.readingTime} min read</span>
          {summary.citationContext && (
            <>
              <span>📊 {summary.citationContext.citationCount} citations</span>
              {summary.citationContext.impactFactor && (
                <span>💫 IF: {summary.citationContext.impactFactor}</span>
              )}
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            <span className="text-yellow-500">⭐</span>
            <span>{(summary.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      {isExpanded && (
        <div className="space-y-4 p-4">
          {/* 主要贡献 */}
          {summary.contributions.length > 0 && (
            <div className="border-l-4 border-blue-500 pl-4">
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                💡 Main Contributions
              </h4>
              <ul className="space-y-1.5">
                {summary.contributions.map((contrib, idx) => (
                  <li key={idx} className="flex gap-2 text-sm text-gray-700">
                    <span className="flex-shrink-0 text-blue-500">✓</span>
                    <span>{contrib}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 研究方法 */}
          {summary.methodology && (
            <div className="border-l-4 border-purple-500 pl-4">
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🔬 Methodology
              </h4>
              <p className="text-sm leading-relaxed text-gray-700">
                {summary.methodology}
              </p>
            </div>
          )}

          {/* 主要结果 */}
          {summary.results && (
            <div className="border-l-4 border-green-500 pl-4">
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                📈 Results
              </h4>
              <p className="text-sm leading-relaxed text-gray-700">
                {summary.results}
              </p>
            </div>
          )}

          {/* 关键要点 */}
          {summary.keyPoints.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                📌 Key Takeaways
              </h4>
              <ul className="space-y-1.5">
                {summary.keyPoints.map((point, idx) => (
                  <li key={idx} className="flex gap-2 text-sm text-gray-700">
                    <span className="flex-shrink-0 text-green-500">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 局限性 */}
          {summary.limitations.length > 0 && (
            <div className="rounded border border-yellow-200 bg-yellow-50 p-3">
              <h4 className="mb-2 text-sm font-semibold text-yellow-900">
                ⚠️ Limitations
              </h4>
              <ul className="space-y-1">
                {summary.limitations.map((limit, idx) => (
                  <li key={idx} className="text-sm text-yellow-800">
                    • {limit}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 后续工作 */}
          {summary.futureWork.length > 0 && (
            <div className="rounded border border-blue-200 bg-blue-50 p-3">
              <h4 className="mb-2 text-sm font-semibold text-blue-900">
                🚀 Future Work
              </h4>
              <ul className="space-y-1">
                {summary.futureWork.map((work, idx) => (
                  <li key={idx} className="text-sm text-blue-800">
                    • {work}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 关键词 */}
          {summary.keywords.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🏷️ Keywords
              </h4>
              <div className="flex flex-wrap gap-2">
                {summary.keywords.map((keyword, idx) => (
                  <span
                    key={idx}
                    className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 相关主题 */}
          {summary.relatedTopics.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🔗 Related Topics
              </h4>
              <div className="flex flex-wrap gap-2">
                {summary.relatedTopics.map((topic, idx) => (
                  <span
                    key={idx}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 可视化建议 */}
          {summary.visualizations && summary.visualizations.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                📊 Visualization Ideas
              </h4>
              <div className="space-y-2">
                {summary.visualizations.map((viz, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 rounded border border-purple-200 bg-purple-50 p-2"
                  >
                    <span className="font-bold text-purple-600">▪</span>
                    <div>
                      <p className="text-xs font-medium text-purple-900">
                        {viz.type}
                      </p>
                      <p className="text-xs text-purple-700">
                        {viz.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 元信息 */}
          <div className="border-t border-gray-100 pt-2">
            <p className="text-xs text-gray-500">
              AI-generated on{' '}
              <ClientDate date={summary.generatedAt} format="date" /> using{' '}
              {summary.model}
            </p>
          </div>
        </div>
      )}

      {/* 展开/收起按钮 */}
      {expandable && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full py-1 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
          >
            {isExpanded ? '▼ Collapse' : '▶ Expand Full Analysis'}
          </button>
        </div>
      )}
    </SectionPanelCard>
  );
};
