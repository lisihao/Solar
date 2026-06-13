'use client';

/**
 * ThinkingChainPanel - 思考链可视化面板
 *
 * 展示 Deep Research 过程中的：
 * 1. 思考步骤
 * 2. 研究计划
 * 3. 搜索进度
 * 4. 反思决策
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  Search,
  Lightbulb,
  FileText,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Target,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import {
  DeepResearchState,
  ThinkingStep,
  ResearchPlan,
  Reflection,
  ThinkingStepType,
} from '@/hooks';
import { useI18n } from '@/lib/i18n';

interface ThinkingChainPanelProps {
  state: DeepResearchState;
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

// 步骤类型图标映射
const stepIcons: Record<ThinkingStepType, React.ElementType> = {
  analyzing_query: Brain,
  planning_research: Target,
  executing_search: Search,
  evaluating_results: Lightbulb,
  reflecting: RefreshCw,
  synthesizing: FileText,
  formatting: Sparkles,
};

// stepLabels moved to component to use i18n

// 阶段颜色映射
const phaseColors: Record<string, string> = {
  idle: 'bg-gray-100 text-gray-600',
  planning: 'bg-blue-100 text-blue-700',
  searching: 'bg-amber-100 text-amber-700',
  reflecting: 'bg-purple-100 text-purple-700',
  synthesizing: 'bg-green-100 text-green-700',
  completed: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
};

export function ThinkingChainPanel({
  state,
  className,
  collapsed = false,
  onToggleCollapse,
}: ThinkingChainPanelProps) {
  const { t } = useI18n();
  const [showPlan, setShowPlan] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stepLabels: Record<ThinkingStepType, string> = {
    analyzing_query: t(
      'topicResearch.deepResearch.thinkingChain.steps.analyzingQuery'
    ),
    planning_research: t(
      'topicResearch.deepResearch.thinkingChain.steps.planningResearch'
    ),
    executing_search: t(
      'topicResearch.deepResearch.thinkingChain.steps.executingSearch'
    ),
    evaluating_results: t(
      'topicResearch.deepResearch.thinkingChain.steps.evaluatingResults'
    ),
    reflecting: t('topicResearch.deepResearch.thinkingChain.steps.reflecting'),
    synthesizing: t(
      'topicResearch.deepResearch.thinkingChain.steps.synthesizing'
    ),
    formatting: t('topicResearch.deepResearch.thinkingChain.steps.formatting'),
  };

  // 自动滚动到最新步骤
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.thinkingChain]);

  const isActive =
    state.phase !== 'idle' &&
    state.phase !== 'completed' &&
    state.phase !== 'error';

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border bg-white shadow-sm transition-all',
        collapsed ? 'h-14' : 'h-full',
        className
      )}
    >
      {/* 头部 */}
      <div
        className="flex cursor-pointer items-center justify-between border-b px-4 py-3"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-3">
          <div className={cn('rounded-full p-2', phaseColors[state.phase])}>
            {isActive ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : state.phase === 'completed' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : state.phase === 'error' ? (
              <AlertCircle className="h-4 w-4" />
            ) : (
              <Brain className="h-4 w-4" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              {t('topicResearch.deepResearch.thinkingChain.title')}
            </h3>
            <p className="text-xs text-gray-500">
              {state.phase === 'idle' &&
                t('topicResearch.deepResearch.thinkingChain.idle')}
              {state.phase === 'planning' &&
                t('topicResearch.deepResearch.thinkingChain.planning')}
              {state.phase === 'searching' &&
                t('topicResearch.deepResearch.thinkingChain.searching', {
                  current: state.searchProgress?.currentRound || 0,
                  total: state.searchProgress?.totalRounds || '?',
                })}
              {state.phase === 'reflecting' &&
                t('topicResearch.deepResearch.thinkingChain.reflecting')}
              {state.phase === 'synthesizing' &&
                t('topicResearch.deepResearch.thinkingChain.synthesizing')}
              {state.phase === 'completed' &&
                t('topicResearch.deepResearch.thinkingChain.completed')}
              {state.phase === 'error' &&
                t('topicResearch.deepResearch.thinkingChain.error')}
            </p>
          </div>
        </div>
        <button className="text-gray-400 hover:text-gray-600">
          {collapsed ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronUp className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* 内容区域 */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex flex-1 flex-col overflow-hidden"
          >
            {/* 研究计划 */}
            {state.plan && (
              <div className="border-b">
                <button
                  className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-gray-50"
                  onClick={() => setShowPlan(!showPlan)}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <Target className="h-4 w-4 text-blue-500" />
                    {t('topicResearch.deepResearch.thinkingChain.researchPlan')}
                  </span>
                  {showPlan ? (
                    <ChevronUp className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  )}
                </button>
                <AnimatePresence>
                  {showPlan && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <ResearchPlanView plan={state.plan} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* 搜索进度 */}
            {state.searchProgress && (
              <div className="border-b px-4 py-3">
                <SearchProgressView progress={state.searchProgress} />
              </div>
            )}

            {/* 思考链 */}
            <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3">
              <ThinkingStepsView steps={state.thinkingChain} />
            </div>

            {/* 反思记录 */}
            {state.reflections.length > 0 && (
              <div className="border-t px-4 py-3">
                <ReflectionsView reflections={state.reflections} />
              </div>
            )}

            {/* 错误提示 */}
            {state.error && (
              <div className="border-t bg-red-50 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-red-700">
                  <AlertCircle className="h-4 w-4" />
                  {typeof state.error === 'string' ? state.error : '发生错误'}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 研究计划视图
function ResearchPlanView({ plan }: { plan: ResearchPlan }) {
  return (
    <div className="space-y-2 px-4 pb-3">
      <p className="text-xs text-gray-600">{plan.objective}</p>
      <div className="space-y-1">
        {plan.steps.map((step, index) => (
          <div
            key={step.id}
            className="flex items-start gap-2 rounded bg-gray-50 px-2 py-1.5"
          >
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-600">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-gray-700">
                {step.query}
              </p>
              <p className="text-xs text-gray-500">{step.rationale}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 搜索进度视图
function SearchProgressView({
  progress,
}: {
  progress: {
    currentRound: number;
    totalRounds: number;
    query: string;
    resultsCount: number;
    message: string;
  };
}) {
  const { t } = useI18n();
  const percentage = (progress.currentRound / progress.totalRounds) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-600">
          {t('topicResearch.deepResearch.thinkingChain.searchProgress')}
        </span>
        <span className="font-medium text-gray-900">
          {progress.currentRound}/{progress.totalRounds}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
        <motion.div
          className="h-full rounded-full bg-amber-500"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      <p className="truncate text-xs text-gray-500">{progress.message}</p>
    </div>
  );
}

// 思考步骤视图
function ThinkingStepsView({ steps }: { steps: ThinkingStep[] }) {
  const { t } = useI18n();

  const stepLabels: Record<ThinkingStepType, string> = {
    analyzing_query: t(
      'topicResearch.deepResearch.thinkingChain.steps.analyzingQuery'
    ),
    planning_research: t(
      'topicResearch.deepResearch.thinkingChain.steps.planningResearch'
    ),
    executing_search: t(
      'topicResearch.deepResearch.thinkingChain.steps.executingSearch'
    ),
    evaluating_results: t(
      'topicResearch.deepResearch.thinkingChain.steps.evaluatingResults'
    ),
    reflecting: t('topicResearch.deepResearch.thinkingChain.steps.reflecting'),
    synthesizing: t(
      'topicResearch.deepResearch.thinkingChain.steps.synthesizing'
    ),
    formatting: t('topicResearch.deepResearch.thinkingChain.steps.formatting'),
  };

  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Brain className="mb-2 h-8 w-8" />
        <p className="text-sm">
          {t('topicResearch.deepResearch.thinkingChain.waitingToThink')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const Icon = stepIcons[step.step] || Brain;
        return (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-start gap-2"
          >
            <div className="mt-0.5 flex-shrink-0">
              <Icon className="h-4 w-4 text-gray-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-500">
                {stepLabels[step.step]}
              </p>
              <p className="text-sm text-gray-700">{step.content}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// 反思记录视图
function ReflectionsView({ reflections }: { reflections: Reflection[] }) {
  const { t } = useI18n();
  const latestReflection = reflections[reflections.length - 1];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 text-purple-500" />
        <span className="text-xs font-medium text-gray-700">
          {t('topicResearch.deepResearch.thinkingChain.latestReflection')}
        </span>
      </div>
      <div className="rounded bg-purple-50 p-2">
        <p className="text-xs text-purple-700">{latestReflection.assessment}</p>
        <div className="mt-1 flex items-center gap-1">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              latestReflection.decision === 'continue' &&
                'bg-blue-100 text-blue-700',
              latestReflection.decision === 'pivot' &&
                'bg-amber-100 text-amber-700',
              latestReflection.decision === 'complete' &&
                'bg-green-100 text-green-700'
            )}
          >
            {latestReflection.decision === 'continue' &&
              t('topicResearch.deepResearch.thinkingChain.decisions.continue')}
            {latestReflection.decision === 'pivot' &&
              t('topicResearch.deepResearch.thinkingChain.decisions.pivot')}
            {latestReflection.decision === 'complete' &&
              t('topicResearch.deepResearch.thinkingChain.decisions.complete')}
          </span>
        </div>
      </div>
    </div>
  );
}

export default ThinkingChainPanel;
