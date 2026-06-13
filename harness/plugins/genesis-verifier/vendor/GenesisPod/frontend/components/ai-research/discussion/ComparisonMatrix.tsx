'use client';

/**
 * ComparisonMatrix - 技术对比矩阵组件
 * 展示两个技术的对比分析
 */

import React from 'react';
import {
  Check,
  X,
  Minus,
  TrendingUp,
  TrendingDown,
  Award,
  AlertTriangle,
  ThumbsUp,
  Lightbulb,
  ArrowRight,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export interface TechScore {
  name: string;
  mentionCount: number;
  scores: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
}

export interface TechComparisonData {
  techA: TechScore;
  techB: TechScore;
  recommendation: string;
  useCases: {
    preferA: string[];
    preferB: string[];
    either: string[];
  };
}

interface ComparisonMatrixProps {
  comparison: TechComparisonData;
  onTechClick?: (techName: string) => void;
}

// Dimension labels are now handled via i18n in the component

const DIMENSION_ICONS: Record<string, React.ReactNode> = {
  performance: <TrendingUp className="h-4 w-4" />,
  scalability: <TrendingUp className="h-4 w-4" />,
  ease_of_use: <ThumbsUp className="h-4 w-4" />,
  community_support: <Award className="h-4 w-4" />,
  documentation: <Lightbulb className="h-4 w-4" />,
  maturity: <Award className="h-4 w-4" />,
  cost: <TrendingDown className="h-4 w-4" />,
  ecosystem: <Award className="h-4 w-4" />,
};

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
      />
    </div>
  );
}

function ComparisonRow({
  dimension,
  dimensionLabel,
  scoreA,
  scoreB,
}: {
  dimension: string;
  dimensionLabel: string;
  scoreA: number;
  scoreB: number;
}) {
  const winner = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'tie';
  const diff = Math.abs(scoreA - scoreB);

  return (
    <div className="grid grid-cols-[1fr,100px,1fr] items-center gap-4 py-3">
      {/* Tech A Score */}
      <div className="flex items-center gap-3">
        <div className="w-full">
          <ScoreBar
            score={scoreA}
            color={winner === 'A' ? 'bg-blue-500' : 'bg-gray-400'}
          />
        </div>
        <span
          className={`w-12 text-right text-sm font-medium ${
            winner === 'A' ? 'text-blue-600' : 'text-gray-600'
          }`}
        >
          {scoreA}
        </span>
      </div>

      {/* Dimension Label */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-1 text-gray-500">
          {DIMENSION_ICONS[dimension]}
        </div>
        <span className="text-xs font-medium text-gray-700">
          {dimensionLabel}
        </span>
        {winner !== 'tie' && diff >= 10 && (
          <span
            className={`mt-1 text-xs ${
              winner === 'A' ? 'text-blue-500' : 'text-green-500'
            }`}
          >
            +{diff}
          </span>
        )}
      </div>

      {/* Tech B Score */}
      <div className="flex items-center gap-3">
        <span
          className={`w-12 text-left text-sm font-medium ${
            winner === 'B' ? 'text-green-600' : 'text-gray-600'
          }`}
        >
          {scoreB}
        </span>
        <div className="w-full">
          <ScoreBar
            score={scoreB}
            color={winner === 'B' ? 'bg-green-500' : 'bg-gray-400'}
          />
        </div>
      </div>
    </div>
  );
}

function StrengthsList({
  items,
  type,
}: {
  items: string[];
  type: 'strength' | 'weakness';
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      {items.map((item, index) => (
        <div
          key={index}
          className={`flex items-start gap-2 rounded-lg p-2 text-sm ${
            type === 'strength'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {type === 'strength' ? (
            <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
          ) : (
            <X className="mt-0.5 h-4 w-4 flex-shrink-0" />
          )}
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function UseCaseTag({
  text,
  variant,
}: {
  text: string;
  variant: 'A' | 'B' | 'either';
}) {
  const colors = {
    A: 'bg-blue-100 text-blue-700 border-blue-200',
    B: 'bg-green-100 text-green-700 border-green-200',
    either: 'bg-gray-100 text-gray-700 border-gray-200',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm ${colors[variant]}`}
    >
      {text}
    </span>
  );
}

export default function ComparisonMatrix({
  comparison,
  onTechClick,
}: ComparisonMatrixProps) {
  const { t } = useI18n();
  const { techA, techB, recommendation, useCases } = comparison;

  // Calculate overall winner
  const totalA = Object.values(techA.scores).reduce((a, b) => a + b, 0);
  const totalB = Object.values(techB.scores).reduce((a, b) => a + b, 0);
  const overallWinner = totalA > totalB ? 'A' : totalB > totalA ? 'B' : 'tie';

  // Get dimension labels from i18n
  const getDimensionLabel = (dimension: string): string => {
    const key =
      `topicResearch.deepResearch.comparison.dimensions.${dimension}` as const;
    // Try to get translation, fallback to dimension key if not found
    try {
      return t(key);
    } catch {
      return dimension;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-4">
        {/* Tech A */}
        <div
          className={`cursor-pointer rounded-xl border-2 p-4 transition-colors ${
            overallWinner === 'A'
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
          onClick={() => onTechClick?.(techA.name)}
        >
          <h3 className="text-lg font-bold text-gray-900">{techA.name}</h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-2xl font-bold text-blue-600">{totalA}</span>
            <span className="text-sm text-gray-500">
              {t('topicResearch.deepResearch.comparison.totalScore')}
            </span>
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {t('topicResearch.deepResearch.comparison.mentions', {
              count: techA.mentionCount,
            })}
          </div>
        </div>

        {/* VS */}
        <div className="flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-900 text-white">
            <span className="text-sm font-bold">VS</span>
          </div>
        </div>

        {/* Tech B */}
        <div
          className={`cursor-pointer rounded-xl border-2 p-4 transition-colors ${
            overallWinner === 'B'
              ? 'border-green-500 bg-green-50'
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
          onClick={() => onTechClick?.(techB.name)}
        >
          <h3 className="text-lg font-bold text-gray-900">{techB.name}</h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-2xl font-bold text-green-600">{totalB}</span>
            <span className="text-sm text-gray-500">
              {t('topicResearch.deepResearch.comparison.totalScore')}
            </span>
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {t('topicResearch.deepResearch.comparison.mentions', {
              count: techB.mentionCount,
            })}
          </div>
        </div>
      </div>

      {/* Comparison Matrix */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h4 className="mb-4 text-center text-sm font-medium uppercase text-gray-500">
          {t('topicResearch.deepResearch.comparison.dimensionComparison')}
        </h4>
        <div className="divide-y divide-gray-100">
          {Object.keys(techA.scores).map((dimension) => (
            <ComparisonRow
              key={dimension}
              dimension={dimension}
              dimensionLabel={getDimensionLabel(dimension)}
              scoreA={techA.scores[dimension] || 50}
              scoreB={techB.scores[dimension] || 50}
            />
          ))}
        </div>
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-2 gap-4">
        {/* Tech A */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="mb-3 font-medium text-blue-600">{techA.name}</h4>
          {techA.strengths.length > 0 && (
            <div className="mb-3">
              <h5 className="mb-2 text-xs font-medium uppercase text-gray-500">
                {t('topicResearch.deepResearch.comparison.strengths')}
              </h5>
              <StrengthsList items={techA.strengths} type="strength" />
            </div>
          )}
          {techA.weaknesses.length > 0 && (
            <div>
              <h5 className="mb-2 text-xs font-medium uppercase text-gray-500">
                {t('topicResearch.deepResearch.comparison.weaknesses')}
              </h5>
              <StrengthsList items={techA.weaknesses} type="weakness" />
            </div>
          )}
        </div>

        {/* Tech B */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="mb-3 font-medium text-green-600">{techB.name}</h4>
          {techB.strengths.length > 0 && (
            <div className="mb-3">
              <h5 className="mb-2 text-xs font-medium uppercase text-gray-500">
                {t('topicResearch.deepResearch.comparison.strengths')}
              </h5>
              <StrengthsList items={techB.strengths} type="strength" />
            </div>
          )}
          {techB.weaknesses.length > 0 && (
            <div>
              <h5 className="mb-2 text-xs font-medium uppercase text-gray-500">
                {t('topicResearch.deepResearch.comparison.weaknesses')}
              </h5>
              <StrengthsList items={techB.weaknesses} type="weakness" />
            </div>
          )}
        </div>
      </div>

      {/* Use Cases */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h4 className="mb-4 font-medium text-gray-900">
          {t('topicResearch.deepResearch.comparison.useCases')}
        </h4>

        <div className="space-y-4">
          {useCases.preferA.length > 0 && (
            <div>
              <h5 className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-600">
                <ArrowRight className="h-4 w-4" />
                {t('topicResearch.deepResearch.comparison.recommend', {
                  tech: techA.name,
                })}
              </h5>
              <div className="flex flex-wrap gap-2">
                {useCases.preferA.map((useCase) => (
                  <UseCaseTag key={useCase} text={useCase} variant="A" />
                ))}
              </div>
            </div>
          )}

          {useCases.preferB.length > 0 && (
            <div>
              <h5 className="mb-2 flex items-center gap-2 text-sm font-medium text-green-600">
                <ArrowRight className="h-4 w-4" />
                {t('topicResearch.deepResearch.comparison.recommend', {
                  tech: techB.name,
                })}
              </h5>
              <div className="flex flex-wrap gap-2">
                {useCases.preferB.map((useCase) => (
                  <UseCaseTag key={useCase} text={useCase} variant="B" />
                ))}
              </div>
            </div>
          )}

          {useCases.either.length > 0 && (
            <div>
              <h5 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-600">
                <Minus className="h-4 w-4" />
                {t('topicResearch.deepResearch.comparison.eitherWorks')}
              </h5>
              <div className="flex flex-wrap gap-2">
                {useCases.either.map((useCase) => (
                  <UseCaseTag key={useCase} text={useCase} variant="either" />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recommendation */}
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-600" />
          <div>
            <h4 className="font-medium text-yellow-800">
              {t('topicResearch.deepResearch.comparison.recommendation')}
            </h4>
            <p className="mt-1 text-sm text-yellow-700">{recommendation}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
