'use client';

import React from 'react';
import { Newspaper } from 'lucide-react';
import type { NewsAISummary } from '@/lib/types/ai-office';
import ClientDate from '@/components/common/ClientDate';
import { SectionPanelCard } from '@/components/ui/cards';
import { MarkdownViewer } from '@/components/common/markdown-viewer';

/**
 * 新闻文章专属结构化摘要组件
 * 针对新闻资源优化，突出核心事实、背景和影响
 */
interface NewsAISummaryProps {
  summary: NewsAISummary;
  compact?: boolean;
  expandable?: boolean;
}

const NewsFactorBadge: React.FC<{ newsFactor: string }> = ({ newsFactor }) => {
  const styles = {
    breaking: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      emoji: '🔴',
      label: 'Breaking',
    },
    developing: {
      bg: 'bg-orange-50',
      text: 'text-orange-700',
      emoji: '🟠',
      label: 'Developing',
    },
    analysis: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      emoji: '🔵',
      label: 'Analysis',
    },
    feature: {
      bg: 'bg-purple-50',
      text: 'text-purple-700',
      emoji: '🟣',
      label: 'Feature',
    },
  };

  const style = styles[newsFactor as keyof typeof styles] || styles.analysis;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${style.bg} ${style.text}`}
    >
      <span>{style.emoji}</span>
      {style.label}
    </span>
  );
};

const SentimentIndicator: React.FC<{ sentiment: string }> = ({ sentiment }) => {
  const sentiments = {
    positive: { emoji: '😊', color: 'text-green-600' },
    neutral: { emoji: '😐', color: 'text-gray-600' },
    negative: { emoji: '😟', color: 'text-red-600' },
  };

  const s =
    sentiments[sentiment as keyof typeof sentiments] || sentiments.neutral;
  return <span className={`text-lg ${s.color}`}>{s.emoji}</span>;
};

const UrgencyBadge: React.FC<{ urgency: string }> = ({ urgency }) => {
  const urgencies = {
    high: { bg: 'bg-red-100', text: 'text-red-700', icon: '⚡' },
    medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: '⏱️' },
    low: { bg: 'bg-gray-100', text: 'text-gray-700', icon: '📌' },
  };

  const u = urgencies[urgency as keyof typeof urgencies] || urgencies.medium;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${u.bg} ${u.text}`}
    >
      {u.icon}
      {urgency}
    </span>
  );
};

export const NewsAISummaryComponent: React.FC<NewsAISummaryProps> = ({
  summary,
  compact = false,
  expandable = true,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(!compact);

  return (
    <SectionPanelCard
      title={summary.headline}
      icon={<Newspaper className="h-4 w-4" />}
      accent="red"
      actions={<SentimentIndicator sentiment={summary.sentiment} />}
    >
      {/* 子头部：新闻类型/状态徽章 + 核心内容 + 元信息 */}
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <NewsFactorBadge newsFactor={summary.newsFactor} />
          <UrgencyBadge urgency={summary.urgency} />
        </div>

        {/* 核心新闻事实 */}
        {compact && !isExpanded ? (
          <p className="text-sm leading-relaxed text-gray-700">
            {summary.coreNews.substring(0, 150)}...
          </p>
        ) : (
          <div className="prose prose-sm max-w-none text-gray-700">
            <MarkdownViewer content={summary.coreNews} />
          </div>
        )}

        {/* 元信息 */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <span>📰 {summary.category}</span>
          <span>⏱️ {summary.readingTime} min read</span>
          <div className="ml-auto flex items-center gap-1">
            <span className="text-yellow-500">⭐</span>
            <span>{(summary.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      {isExpanded && (
        <div className="space-y-4 p-4">
          {/* 背景信息 */}
          {summary.background && (
            <div className="border-l-4 border-blue-500 pl-4">
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                📚 Background Context
              </h4>
              <p className="text-sm leading-relaxed text-gray-700">
                {summary.background}
              </p>
            </div>
          )}

          {/* 影响分析 */}
          {summary.impact && (
            <div className="border-l-4 border-purple-500 pl-4">
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🎯 Impact & Implications
              </h4>
              <p className="text-sm leading-relaxed text-gray-700">
                {summary.impact}
              </p>
            </div>
          )}

          {/* 直引 */}
          {summary.quotes && summary.quotes.length > 0 && (
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                💬 Key Quotes
              </h4>
              <div className="space-y-2">
                {summary.quotes.map((quote, idx) => (
                  <div key={idx} className="border-l-2 border-blue-400 pl-3">
                    <p className="text-sm italic text-gray-700">
                      "{quote.text}"
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      — {quote.source}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关键要点 */}
          {summary.keyPoints.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                📌 Key Points
              </h4>
              <ul className="space-y-1.5">
                {summary.keyPoints.map((point, idx) => (
                  <li key={idx} className="flex gap-2 text-sm text-gray-700">
                    <span className="flex-shrink-0 text-red-500">▸</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 相关实体 */}
          {summary.relatedEntities && summary.relatedEntities.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                👥 Related Entities
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {summary.relatedEntities.map((entity, idx) => (
                  <div
                    key={idx}
                    className="rounded border border-blue-200 bg-blue-50 p-2"
                  >
                    <p className="text-xs font-medium text-blue-900">
                      {entity.name}
                    </p>
                    <p className="mt-0.5 text-xs text-blue-700">
                      {entity.type}
                      {entity.relevance &&
                        ` • ${(entity.relevance * 100).toFixed(0)}%`}
                    </p>
                  </div>
                ))}
              </div>
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
                    className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 元信息 */}
          <div className="border-t border-gray-100 pt-2">
            <p className="text-xs text-gray-500">
              AI-analyzed on{' '}
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
            className="w-full py-1 text-sm font-medium text-red-600 transition-colors hover:text-red-700"
          >
            {isExpanded ? '▼ Collapse' : '▶ Read Full Analysis'}
          </button>
        </div>
      )}
    </SectionPanelCard>
  );
};
