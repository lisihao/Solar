'use client';

/**
 * ResearchPlan - 研究计划可视化组件
 * 展示研究流程、进度和步骤状态
 */

import React, { useMemo } from 'react';
import {
  Search,
  FileText,
  Brain,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronRight,
  Clock,
  Zap,
  TrendingUp,
  BookOpen,
  Network,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'error';

export interface ResearchStep {
  id: string;
  title: string;
  description: string;
  status: StepStatus;
  progress?: number; // 0-100
  substeps?: {
    id: string;
    title: string;
    status: StepStatus;
  }[];
  result?: {
    count?: number;
    summary?: string;
  };
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ResearchPlanData {
  id: string;
  query: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  steps: ResearchStep[];
  createdAt: Date;
  estimatedTime?: number; // seconds
  elapsedTime?: number; // seconds
}

interface ResearchPlanProps {
  plan: ResearchPlanData;
  compact?: boolean;
  onStepClick?: (stepId: string) => void;
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  search: <Search className="h-4 w-4" />,
  collect: <FileText className="h-4 w-4" />,
  analyze: <Brain className="h-4 w-4" />,
  synthesize: <Zap className="h-4 w-4" />,
  trend: <TrendingUp className="h-4 w-4" />,
  report: <BookOpen className="h-4 w-4" />,
  graph: <Network className="h-4 w-4" />,
};

const STATUS_COLORS: Record<StepStatus, string> = {
  pending: 'text-gray-400',
  in_progress: 'text-blue-500',
  completed: 'text-green-500',
  error: 'text-red-500',
};

const STATUS_BG_COLORS: Record<StepStatus, string> = {
  pending: 'bg-gray-100',
  in_progress: 'bg-blue-50 border-blue-200',
  completed: 'bg-green-50 border-green-200',
  error: 'bg-red-50 border-red-200',
};

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'in_progress':
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    case 'error':
      return <AlertCircle className="h-5 w-5 text-red-500" />;
    default:
      return <Circle className="h-5 w-5 text-gray-300" />;
  }
}

// formatDuration moved to component to use i18n

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
      <div
        className="h-full rounded-full bg-blue-500 transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}

export default function ResearchPlan({
  plan,
  compact = false,
  onStepClick,
}: ResearchPlanProps) {
  const { t } = useI18n();

  const formatDuration = (seconds: number): string => {
    if (seconds < 60)
      return t('topicResearch.deepResearch.researchPlan.seconds', {
        count: Math.round(seconds),
      });
    if (seconds < 3600)
      return t('topicResearch.deepResearch.researchPlan.minutes', {
        count: Math.round(seconds / 60),
      });
    const hours = Math.round(seconds / 3600);
    const min = Math.round((seconds % 3600) / 60);
    return t('topicResearch.deepResearch.researchPlan.hours', {
      count: hours,
      min,
    });
  };

  const overallProgress = useMemo(() => {
    const completed = plan.steps.filter((s) => s.status === 'completed').length;
    return (completed / plan.steps.length) * 100;
  }, [plan.steps]);

  const currentStep = useMemo(() => {
    return plan.steps.find((s) => s.status === 'in_progress');
  }, [plan.steps]);

  if (compact) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        {/* Compact Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-blue-500" />
            <span className="font-medium text-gray-900">
              {t('topicResearch.deepResearch.researchPlan.progress')}
            </span>
          </div>
          <span className="text-sm text-gray-500">
            {Math.round(overallProgress)}%
          </span>
        </div>

        {/* Progress Bar */}
        <ProgressBar progress={overallProgress} />

        {/* Current Step */}
        {currentStep && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <span className="text-gray-600">{currentStep.title}</span>
          </div>
        )}

        {/* Step Dots */}
        <div className="mt-3 flex justify-between">
          {plan.steps.map((step, index) => (
            <div
              key={step.id}
              className={`h-2 w-2 rounded-full ${
                step.status === 'completed'
                  ? 'bg-green-500'
                  : step.status === 'in_progress'
                    ? 'bg-blue-500'
                    : step.status === 'error'
                      ? 'bg-red-500'
                      : 'bg-gray-300'
              }`}
              title={step.title}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {t('topicResearch.deepResearch.researchPlan.title')}
            </h3>
            <p className="mt-1 text-sm text-gray-500">{plan.query}</p>
          </div>
          <div className="flex items-center gap-3">
            {plan.estimatedTime && (
              <div className="flex items-center gap-1 text-sm text-gray-500">
                <Clock className="h-4 w-4" />
                <span>
                  {t('topicResearch.deepResearch.researchPlan.estimated')}{' '}
                  {formatDuration(plan.estimatedTime)}
                </span>
              </div>
            )}
            <div
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                plan.status === 'running'
                  ? 'bg-blue-100 text-blue-700'
                  : plan.status === 'completed'
                    ? 'bg-green-100 text-green-700'
                    : plan.status === 'error'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-700'
              }`}
            >
              {plan.status === 'running'
                ? t('topicResearch.deepResearch.researchPlan.status.running')
                : plan.status === 'completed'
                  ? t(
                      'topicResearch.deepResearch.researchPlan.status.completed'
                    )
                  : plan.status === 'error'
                    ? t('topicResearch.deepResearch.researchPlan.status.error')
                    : t(
                        'topicResearch.deepResearch.researchPlan.status.waiting'
                      )}
            </div>
          </div>
        </div>

        {/* Overall Progress */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-gray-600">
              {t('topicResearch.deepResearch.researchPlan.overallProgress')}
            </span>
            <span className="font-medium text-gray-900">
              {Math.round(overallProgress)}%
            </span>
          </div>
          <ProgressBar progress={overallProgress} />
        </div>
      </div>

      {/* Steps Timeline */}
      <div className="p-6">
        <div className="relative">
          {/* Vertical Line */}
          <div className="absolute left-[11px] top-0 h-full w-0.5 bg-gray-200" />

          {/* Steps */}
          <div className="space-y-4">
            {plan.steps.map((step, index) => (
              <div
                key={step.id}
                className={`relative flex gap-4 ${
                  onStepClick ? 'cursor-pointer' : ''
                }`}
                onClick={() => onStepClick?.(step.id)}
              >
                {/* Status Icon */}
                <div className="relative z-10 flex-shrink-0">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full bg-white ring-2 ${
                      step.status === 'completed'
                        ? 'ring-green-500'
                        : step.status === 'in_progress'
                          ? 'ring-blue-500'
                          : step.status === 'error'
                            ? 'ring-red-500'
                            : 'ring-gray-300'
                    }`}
                  >
                    <StatusIcon status={step.status} />
                  </div>
                </div>

                {/* Content */}
                <div
                  className={`flex-1 rounded-lg border p-4 transition-colors ${
                    STATUS_BG_COLORS[step.status]
                  } ${onStepClick ? 'hover:shadow-md' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={STATUS_COLORS[step.status]}>
                          {STEP_ICONS[step.id] || STEP_ICONS.analyze}
                        </span>
                        <h4 className="font-medium text-gray-900">
                          {step.title}
                        </h4>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {step.description}
                      </p>
                    </div>
                    {onStepClick && (
                      <ChevronRight className="h-5 w-5 text-gray-400" />
                    )}
                  </div>

                  {/* Step Progress */}
                  {step.status === 'in_progress' &&
                    step.progress !== undefined && (
                      <div className="mt-3">
                        <div className="mb-1 flex justify-between text-xs text-gray-500">
                          <span>
                            {t(
                              'topicResearch.deepResearch.researchPlan.progress_label'
                            )}
                          </span>
                          <span>
                            {t(
                              'topicResearch.deepResearch.researchPlan.percent',
                              { progress: step.progress }
                            )}
                          </span>
                        </div>
                        <ProgressBar progress={step.progress} />
                      </div>
                    )}

                  {/* Substeps */}
                  {step.substeps && step.substeps.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {step.substeps.map((substep) => (
                        <div
                          key={substep.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          {substep.status === 'completed' ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          ) : substep.status === 'in_progress' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                          ) : (
                            <Circle className="h-3.5 w-3.5 text-gray-300" />
                          )}
                          <span
                            className={
                              substep.status === 'completed'
                                ? 'text-gray-600'
                                : 'text-gray-500'
                            }
                          >
                            {substep.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Result */}
                  {step.status === 'completed' && step.result && (
                    <div className="mt-3 rounded-md bg-white/80 p-2 text-sm">
                      {step.result.count !== undefined && (
                        <span className="font-medium text-green-700">
                          {t(
                            'topicResearch.deepResearch.researchPlan.foundResults',
                            { count: step.result.count }
                          )}
                        </span>
                      )}
                      {step.result.summary && (
                        <p className="mt-1 text-gray-600">
                          {step.result.summary}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Error */}
                  {step.status === 'error' && step.error && (
                    <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">
                      {typeof step.error === 'string'
                        ? step.error
                        : t(
                            'topicResearch.deepResearch.researchPlan.executionFailed'
                          )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Default research plan template
// Note: This function cannot use i18n directly as it's a pure function.
// Titles/descriptions should be provided from the calling component using t()
export function createDefaultResearchPlan(
  query: string,
  t?: (key: string) => string
): ResearchPlanData {
  const translate = t || ((key: string) => key);

  return {
    id: `plan-${Date.now()}`,
    query,
    status: 'idle',
    createdAt: new Date(),
    estimatedTime: 120, // 2 minutes
    steps: [
      {
        id: 'search',
        title: translate(
          'topicResearch.deepResearch.researchPlan.steps.search'
        ),
        description: translate(
          'topicResearch.deepResearch.researchPlan.steps.searchDesc'
        ),
        status: 'pending',
        substeps: [
          {
            id: 'arxiv',
            title: translate(
              'topicResearch.deepResearch.researchPlan.steps.substeps.arxiv'
            ),
            status: 'pending',
          },
          {
            id: 'github',
            title: translate(
              'topicResearch.deepResearch.researchPlan.steps.substeps.github'
            ),
            status: 'pending',
          },
          {
            id: 'news',
            title: translate(
              'topicResearch.deepResearch.researchPlan.steps.substeps.news'
            ),
            status: 'pending',
          },
        ],
      },
      {
        id: 'collect',
        title: translate(
          'topicResearch.deepResearch.researchPlan.steps.collect'
        ),
        description: translate(
          'topicResearch.deepResearch.researchPlan.steps.collectDesc'
        ),
        status: 'pending',
      },
      {
        id: 'analyze',
        title: translate(
          'topicResearch.deepResearch.researchPlan.steps.analyze'
        ),
        description: translate(
          'topicResearch.deepResearch.researchPlan.steps.analyzeDesc'
        ),
        status: 'pending',
        substeps: [
          {
            id: 'entities',
            title: translate(
              'topicResearch.deepResearch.researchPlan.steps.substeps.entities'
            ),
            status: 'pending',
          },
          {
            id: 'relations',
            title: translate(
              'topicResearch.deepResearch.researchPlan.steps.substeps.relations'
            ),
            status: 'pending',
          },
          {
            id: 'sentiment',
            title: translate(
              'topicResearch.deepResearch.researchPlan.steps.substeps.sentiment'
            ),
            status: 'pending',
          },
        ],
      },
      {
        id: 'trend',
        title: translate('topicResearch.deepResearch.researchPlan.steps.trend'),
        description: translate(
          'topicResearch.deepResearch.researchPlan.steps.trendDesc'
        ),
        status: 'pending',
      },
      {
        id: 'synthesize',
        title: translate(
          'topicResearch.deepResearch.researchPlan.steps.synthesize'
        ),
        description: translate(
          'topicResearch.deepResearch.researchPlan.steps.synthesizeDesc'
        ),
        status: 'pending',
      },
      {
        id: 'report',
        title: translate(
          'topicResearch.deepResearch.researchPlan.steps.report'
        ),
        description: translate(
          'topicResearch.deepResearch.researchPlan.steps.reportDesc'
        ),
        status: 'pending',
      },
    ],
  };
}
