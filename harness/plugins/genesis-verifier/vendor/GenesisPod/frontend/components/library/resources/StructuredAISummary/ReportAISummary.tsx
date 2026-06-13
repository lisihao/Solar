'use client';

import React from 'react';
import { FileText } from 'lucide-react';
import type { ReportAISummary } from '@/lib/types/ai-office';
import ClientDate from '@/components/common/ClientDate';
import { SectionPanelCard } from '@/components/ui/cards';

/**
 * 报告专属结构化摘要组件
 * 针对行业报告、研究报告、市场分析等资源优化
 * 突出关键发现、市场洞察、建议等核心信息
 */
interface ReportAISummaryProps {
  summary: ReportAISummary;
  compact?: boolean;
  expandable?: boolean;
}

const ReportTypeBadge: React.FC<{ reportType: string }> = ({ reportType }) => {
  const types = {
    research: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      emoji: '🔬',
      label: 'Research',
    },
    'market-analysis': {
      bg: 'bg-green-50',
      text: 'text-green-700',
      emoji: '📊',
      label: 'Market Analysis',
    },
    'threat-report': {
      bg: 'bg-red-50',
      text: 'text-red-700',
      emoji: '⚠️',
      label: 'Threat Report',
    },
    whitepaper: {
      bg: 'bg-purple-50',
      text: 'text-purple-700',
      emoji: '📄',
      label: 'Whitepaper',
    },
    'industry-insight': {
      bg: 'bg-orange-50',
      text: 'text-orange-700',
      emoji: '💡',
      label: 'Industry Insight',
    },
  };

  const type = types[reportType as keyof typeof types] || types.research;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${type.bg} ${type.text}`}
    >
      <span>{type.emoji}</span>
      {type.label}
    </span>
  );
};

const CredibilityScore: React.FC<{ score: number }> = ({ score }) => {
  const percentage = Math.round(score * 100);
  const color =
    score >= 0.8
      ? 'text-green-600'
      : score >= 0.6
        ? 'text-yellow-600'
        : 'text-red-600';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full ${score >= 0.8 ? 'bg-green-500' : score >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className={`text-sm font-medium ${color}`}>{percentage}%</span>
    </div>
  );
};

const SeverityBadge: React.FC<{ severity: string }> = ({ severity }) => {
  const severities = {
    high: { bg: 'bg-red-100', text: 'text-red-700', icon: '🔴' },
    medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: '🟡' },
    low: { bg: 'bg-gray-100', text: 'text-gray-700', icon: '⚪' },
  };

  const s =
    severities[severity as keyof typeof severities] || severities.medium;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${s.bg} ${s.text}`}
    >
      {s.icon}
      {severity}
    </span>
  );
};

const PotentialBadge: React.FC<{ potential: string }> = ({ potential }) => {
  const potentials = {
    high: { bg: 'bg-green-100', text: 'text-green-700', icon: '🚀' },
    medium: { bg: 'bg-blue-100', text: 'text-blue-700', icon: '📈' },
    low: { bg: 'bg-gray-100', text: 'text-gray-700', icon: '📌' },
  };

  const p =
    potentials[potential as keyof typeof potentials] || potentials.medium;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${p.bg} ${p.text}`}
    >
      {p.icon}
      {potential}
    </span>
  );
};

export const ReportAISummaryComponent: React.FC<ReportAISummaryProps> = ({
  summary,
  compact = false,
  expandable = true,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(!compact);

  return (
    <SectionPanelCard
      title={summary.reportTitle}
      subtitle={summary.publisherName}
      icon={<FileText className="h-4 w-4" />}
      accent="violet"
      actions={<ReportTypeBadge reportType={summary.reportType} />}
    >
      {/* 子头部：发布商信息 + 执行摘要 */}
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="mb-2 flex items-start gap-3">
          {/* 发布商Logo */}
          {summary.publisherLogo && (
            <img
              src={summary.publisherLogo}
              alt={summary.publisherName}
              className="h-10 w-10 rounded-lg object-cover"
            />
          )}
          <p className="text-xs text-gray-500">
            <ClientDate date={summary.reportDate} format="date" />
          </p>
        </div>

        {/* 执行摘要 */}
        <p className="line-clamp-2 text-sm leading-relaxed text-gray-700">
          {summary.executiveSummary}
        </p>
      </div>

      {/* 主要内容 */}
      {isExpanded && (
        <div className="space-y-4 p-4">
          {/* 关键发现 */}
          <div>
            <h4 className="mb-2 text-sm font-semibold text-gray-900">
              🎯 Key Findings
            </h4>
            <ul className="space-y-2">
              {summary.keyFindings.map((finding, idx) => (
                <li key={idx} className="flex gap-2 text-sm text-gray-700">
                  <span className="font-bold text-indigo-600">•</span>
                  <span>{finding}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 关键指标 */}
          {summary.metrics && summary.metrics.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                📊 Key Metrics
              </h4>
              <div className="grid grid-cols-2 gap-3">
                {summary.metrics.map((metric, idx) => (
                  <div key={idx} className="rounded-lg bg-gray-50 p-3">
                    <p className="mb-1 text-xs text-gray-600">{metric.name}</p>
                    <p className="text-sm font-bold text-gray-900">
                      {metric.value}
                      {metric.unit && (
                        <span className="ml-1 text-xs">{metric.unit}</span>
                      )}
                    </p>
                    {metric.trend && (
                      <p
                        className={`mt-1 text-xs ${metric.trend === 'up' ? 'text-green-600' : metric.trend === 'down' ? 'text-red-600' : 'text-gray-600'}`}
                      >
                        {metric.trend === 'up'
                          ? '📈'
                          : metric.trend === 'down'
                            ? '📉'
                            : '➡️'}
                        {metric.yearOverYear &&
                          ` ${metric.yearOverYear > 0 ? '+' : ''}${metric.yearOverYear}% YoY`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 主要主题 */}
          {summary.mainThemes && summary.mainThemes.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🔗 Main Themes
              </h4>
              <div className="flex flex-wrap gap-2">
                {summary.mainThemes.map((theme, idx) => (
                  <span
                    key={idx}
                    className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 市场洞察 */}
          {summary.marketInsights && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                💼 Market Insights
              </h4>
              <div className="space-y-2 text-sm text-gray-700">
                {summary.marketInsights.marketSize && (
                  <p>
                    <span className="font-medium">Market Size:</span>{' '}
                    {summary.marketInsights.marketSize}
                  </p>
                )}
                {summary.marketInsights.growthRate && (
                  <p>
                    <span className="font-medium">Growth Rate:</span>{' '}
                    {summary.marketInsights.growthRate}%
                  </p>
                )}
                {summary.marketInsights.mainPlayers &&
                  summary.marketInsights.mainPlayers.length > 0 && (
                    <p>
                      <span className="font-medium">Main Players:</span>{' '}
                      {summary.marketInsights.mainPlayers.join(', ')}
                    </p>
                  )}
                {summary.marketInsights.trendingTopics &&
                  summary.marketInsights.trendingTopics.length > 0 && (
                    <div>
                      <span className="font-medium">Trending Topics:</span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {summary.marketInsights.trendingTopics.map(
                          (topic, idx) => (
                            <span
                              key={idx}
                              className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
                            >
                              {topic}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}

          {/* 风险因素 */}
          {summary.riskFactors && summary.riskFactors.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                ⚠️ Risk Factors
              </h4>
              <div className="space-y-2">
                {summary.riskFactors.map((risk, idx) => (
                  <div
                    key={idx}
                    className="rounded border border-red-100 bg-red-50 p-2"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {risk.title}
                      </p>
                      <SeverityBadge severity={risk.severity} />
                    </div>
                    <p className="text-xs text-gray-700">{risk.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 机遇 */}
          {summary.opportunities && summary.opportunities.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🌟 Opportunities
              </h4>
              <div className="space-y-2">
                {summary.opportunities.map((opp, idx) => (
                  <div
                    key={idx}
                    className="rounded border border-green-100 bg-green-50 p-2"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {opp.title}
                      </p>
                      <PotentialBadge potential={opp.potential} />
                    </div>
                    <p className="text-xs text-gray-700">{opp.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 未来展望 */}
          {summary.outlook && (
            <div className="rounded-lg border border-purple-100 bg-purple-50 p-3">
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🔮 Outlook
              </h4>
              <p className="line-clamp-3 text-sm text-gray-700">
                {summary.outlook}
              </p>
            </div>
          )}

          {/* 建议 */}
          {summary.recommendations && summary.recommendations.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                💡 Recommendations
              </h4>
              <div className="space-y-2">
                {summary.recommendations.map((rec, idx) => (
                  <div key={idx} className="rounded bg-blue-50 p-2">
                    <p className="mb-1 text-xs font-medium text-blue-900">
                      For: {rec.target}
                    </p>
                    <p className="text-sm text-gray-700">{rec.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关键词 */}
          {summary.keywords && summary.keywords.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🏷️ Keywords
              </h4>
              <div className="flex flex-wrap gap-2">
                {summary.keywords.map((keyword, idx) => (
                  <span
                    key={idx}
                    className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 信息来源 */}
          {summary.dataSource && summary.dataSource.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                📚 Data Sources
              </h4>
              <div className="space-y-1">
                {summary.dataSource.map((source, idx) => (
                  <div key={idx} className="text-xs text-gray-600">
                    • {source.name}
                    {source.url && (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 text-blue-600 hover:underline"
                      >
                        🔗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 底部：置信度和展开按钮 */}
      <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs text-gray-600">Credibility Score</span>
          </div>
          <CredibilityScore score={summary.credibilityScore} />
        </div>

        {expandable && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="ml-4 rounded px-3 py-2 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>
    </SectionPanelCard>
  );
};
