'use client';

/**
 * TrendReport - 趋势报告组件
 * 展示科技趋势分析结果
 */

import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  Database,
  Target,
  ChevronDown,
  ChevronUp,
  Zap,
  Clock,
  ExternalLink,
  BarChart3,
} from 'lucide-react';
import ClientDate from '@/components/common/ClientDate';
import { StatCard } from '@/components/ui/cards';

export interface TechTrend {
  name: string;
  direction: 'rising' | 'stable' | 'declining';
  maturityStage: string;
  momentumScore: number;
  adoptionRate: number;
  relatedTechs: string[];
  keyPlayers: string[];
  summary: string;
}

export interface TrendReportData {
  title: string;
  generatedAt: string;
  timeRange: string;
  executiveSummary: string;
  topTrends: TechTrend[];
  emergingTechs: string[];
  decliningTechs: string[];
  dataSourcesCount: number;
  confidenceScore: number;
}

interface TrendReportProps {
  report: TrendReportData;
  onTechClick?: (techName: string) => void;
  onViewHypeCycle?: () => void;
}

const getDirectionConfig = (t: (key: string) => string) => ({
  rising: {
    icon: <TrendingUp className="h-4 w-4" />,
    color: 'text-green-600',
    bg: 'bg-green-50',
    label: t('topicResearch.deepResearch.trendReport.direction.rising'),
  },
  stable: {
    icon: <Minus className="h-4 w-4" />,
    color: 'text-yellow-600',
    bg: 'bg-yellow-50',
    label: t('topicResearch.deepResearch.trendReport.direction.stable'),
  },
  declining: {
    icon: <TrendingDown className="h-4 w-4" />,
    color: 'text-red-600',
    bg: 'bg-red-50',
    label: t('topicResearch.deepResearch.trendReport.direction.declining'),
  },
});

const getMaturityLabels = (
  t: (key: string) => string
): Record<string, string> => ({
  innovation_trigger: t(
    'topicResearch.deepResearch.trendReport.maturity.innovationTrigger'
  ),
  peak_of_expectations: t(
    'topicResearch.deepResearch.trendReport.maturity.peakOfExpectations'
  ),
  trough_of_disillusionment: t(
    'topicResearch.deepResearch.trendReport.maturity.troughOfDisillusionment'
  ),
  slope_of_enlightenment: t(
    'topicResearch.deepResearch.trendReport.maturity.slopeOfEnlightenment'
  ),
  plateau_of_productivity: t(
    'topicResearch.deepResearch.trendReport.maturity.plateauOfProductivity'
  ),
});

function TrendCard({
  trend,
  index,
  onClick,
}: {
  trend: TechTrend;
  index: number;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const directionConfig = getDirectionConfig(t);
  const maturityLabels = getMaturityLabels(t);
  const dirConfig = directionConfig[trend.direction];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white transition-shadow hover:shadow-md">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between p-4"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600">
            {index + 1}
          </span>
          <div>
            <h3
              className="cursor-pointer font-semibold text-gray-900 hover:text-blue-600"
              onClick={(e) => {
                e.stopPropagation();
                onClick?.();
              }}
            >
              {trend.name}
            </h3>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${dirConfig.bg} ${dirConfig.color}`}
              >
                {dirConfig.icon}
                {dirConfig.label}
              </span>
              <span className="text-xs text-gray-500">
                {maturityLabels[trend.maturityStage] || trend.maturityStage}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Momentum Score */}
          <div className="text-right">
            <div className="text-sm font-medium text-gray-900">
              {Math.round(trend.momentumScore)}
            </div>
            <div className="text-xs text-gray-500">
              {t('topicResearch.deepResearch.trendReport.momentum')}
            </div>
          </div>

          {/* Adoption Rate */}
          <div className="text-right">
            <div className="text-sm font-medium text-gray-900">
              {Math.round(trend.adoptionRate)}%
            </div>
            <div className="text-xs text-gray-500">
              {t('topicResearch.deepResearch.trendReport.adoptionRate')}
            </div>
          </div>

          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4">
          <p className="mb-3 text-sm text-gray-600">{trend.summary}</p>

          {/* Related Technologies */}
          {trend.relatedTechs.length > 0 && (
            <div className="mb-3">
              <h4 className="mb-1 text-xs font-medium uppercase text-gray-500">
                {t('topicResearch.deepResearch.trendReport.relatedTech')}
              </h4>
              <div className="flex flex-wrap gap-1">
                {trend.relatedTechs.map((tech) => (
                  <span
                    key={tech}
                    className="cursor-pointer rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-200"
                    onClick={() => onClick?.()}
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Key Players */}
          {trend.keyPlayers.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase text-gray-500">
                {t('topicResearch.deepResearch.trendReport.keyPlayers')}
              </h4>
              <div className="flex flex-wrap gap-1">
                {trend.keyPlayers.map((player) => (
                  <span
                    key={player}
                    className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700"
                  >
                    {player}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TrendReport({
  report,
  onTechClick,
  onViewHypeCycle,
}: TrendReportProps) {
  const { t } = useI18n();
  const confidencePercent = Math.round(report.confidenceScore * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{report.title}</h2>
            <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <ClientDate date={report.generatedAt} format="date" />
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {report.timeRange}
              </span>
              <span className="flex items-center gap-1">
                <Database className="h-4 w-4" />
                {t('topicResearch.deepResearch.trendReport.dataSources', {
                  count: report.dataSourcesCount,
                })}
              </span>
            </div>
          </div>

          {/* Confidence Badge */}
          <div className="text-right">
            <div
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                confidencePercent >= 70
                  ? 'bg-green-100 text-green-700'
                  : confidencePercent >= 40
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-red-100 text-red-700'
              }`}
            >
              {t('topicResearch.deepResearch.trendReport.confidence', {
                percent: confidencePercent,
              })}
            </div>
          </div>
        </div>

        {/* Executive Summary */}
        <div className="rounded-lg bg-blue-50 p-4">
          <h3 className="mb-2 flex items-center gap-2 font-medium text-blue-900">
            <Target className="h-4 w-4" />
            {t('topicResearch.deepResearch.trendReport.executiveSummary')}
          </h3>
          <p className="text-sm leading-relaxed text-blue-800">
            {report.executiveSummary}
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label={t('topicResearch.deepResearch.trendReport.emergingTech')}
          value={report.emergingTechs.length}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="emerald"
          hint={
            report.emergingTechs.length > 0 ? (
              <span className="flex flex-wrap gap-1 pt-1">
                {report.emergingTechs.slice(0, 3).map((tech) => (
                  <span
                    key={tech}
                    className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700"
                  >
                    {tech}
                  </span>
                ))}
              </span>
            ) : undefined
          }
        />

        <StatCard
          label={t('topicResearch.deepResearch.trendReport.hotTrends')}
          value={report.topTrends.length}
          icon={<Zap className="h-5 w-5" />}
          tone="blue"
          hint={
            report.topTrends.length > 0 ? (
              <span className="flex flex-wrap gap-1 pt-1">
                {report.topTrends.slice(0, 3).map((trend) => (
                  <span
                    key={trend.name}
                    className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700"
                  >
                    {trend.name}
                  </span>
                ))}
              </span>
            ) : undefined
          }
        />

        <StatCard
          label={t('topicResearch.deepResearch.trendReport.decliningTrends')}
          value={report.decliningTechs.length}
          icon={<TrendingDown className="h-5 w-5" />}
          tone="red"
          hint={
            report.decliningTechs.length > 0 ? (
              <span className="flex flex-wrap gap-1 pt-1">
                {report.decliningTechs.slice(0, 3).map((tech) => (
                  <span
                    key={tech}
                    className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700"
                  >
                    {tech}
                  </span>
                ))}
              </span>
            ) : undefined
          }
        />
      </div>

      {/* Hype Cycle Button */}
      {onViewHypeCycle && (
        <button
          onClick={onViewHypeCycle}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white p-4 text-gray-700 transition-colors hover:bg-gray-50"
        >
          <BarChart3 className="h-5 w-5" />
          <span className="font-medium">
            {t('topicResearch.deepResearch.trendReport.viewHypeCycle')}
          </span>
          <ExternalLink className="h-4 w-4" />
        </button>
      )}

      {/* Top Trends */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {t('topicResearch.deepResearch.trendReport.hotTrends')}
        </h3>
        <div className="space-y-3">
          {report.topTrends.map((trend, index) => (
            <TrendCard
              key={trend.name}
              trend={trend}
              index={index}
              onClick={() => onTechClick?.(trend.name)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
