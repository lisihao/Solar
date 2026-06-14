'use client';

/**
 * ProgressTracker 组件
 * 透明推理进度展示，显示 Agent 的思考和工具调用过程
 *
 * 参考 Genspark 设计:
 * - 实时显示 Agent 正在做什么
 * - 展示工具调用过程
 * - 进度百分比
 * - 预计剩余时间
 */

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Search,
  Image as ImageIcon,
  FileText,
  Code,
  Database,
  Globe,
  Sparkles,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import {
  PlanStep,
  ProgressState,
  ToolType,
  AgentEvent,
} from '@/lib/features/ai-office/agents/types';

interface ProgressTrackerProps {
  progress: ProgressState;
  plan?: { steps: PlanStep[] };
  className?: string;
  showToolCalls?: boolean;
  compact?: boolean;
}

// 工具图标映射
const TOOL_ICONS: Record<ToolType, React.ReactNode> = {
  [ToolType.WEB_SEARCH]: <Search className="h-4 w-4" />,
  [ToolType.WEB_SCRAPER]: <Globe className="h-4 w-4" />,
  [ToolType.DATA_FETCH]: <Database className="h-4 w-4" />,
  [ToolType.TEXT_GENERATION]: <FileText className="h-4 w-4" />,
  [ToolType.IMAGE_GENERATION]: <ImageIcon className="h-4 w-4" />,
  [ToolType.CODE_GENERATION]: <Code className="h-4 w-4" />,
  [ToolType.DATA_ANALYSIS]: <Database className="h-4 w-4" />,
  [ToolType.FILE_CONVERSION]: <FileText className="h-4 w-4" />,
  [ToolType.EXPORT_PPTX]: <FileText className="h-4 w-4" />,
  [ToolType.EXPORT_DOCX]: <FileText className="h-4 w-4" />,
  [ToolType.EXPORT_PDF]: <FileText className="h-4 w-4" />,
  [ToolType.EXPORT_IMAGE]: <ImageIcon className="h-4 w-4" />,
};

// 工具名称映射
const TOOL_NAMES: Record<ToolType, string> = {
  [ToolType.WEB_SEARCH]: '网络搜索',
  [ToolType.WEB_SCRAPER]: '网页抓取',
  [ToolType.DATA_FETCH]: '数据获取',
  [ToolType.TEXT_GENERATION]: '文本生成',
  [ToolType.IMAGE_GENERATION]: '图像生成',
  [ToolType.CODE_GENERATION]: '代码生成',
  [ToolType.DATA_ANALYSIS]: '数据分析',
  [ToolType.FILE_CONVERSION]: '文件转换',
  [ToolType.EXPORT_PPTX]: '导出 PPTX',
  [ToolType.EXPORT_DOCX]: '导出 DOCX',
  [ToolType.EXPORT_PDF]: '导出 PDF',
  [ToolType.EXPORT_IMAGE]: '导出图片',
};

export function ProgressTracker({
  progress,
  plan,
  className,
  showToolCalls = true,
  compact = false,
}: ProgressTrackerProps) {
  // 计算步骤状态
  const stepStatuses = useMemo(() => {
    if (!plan?.steps) return [];

    return plan.steps.map((step) => {
      if (progress.completedSteps.includes(step.id)) {
        return 'completed';
      }
      // currentStep 可能是 string 或 PlanStep
      const currentStepId =
        typeof progress.currentStep === 'string'
          ? progress.currentStep
          : progress.currentStep?.id;
      if (currentStepId === step.id) {
        return 'active';
      }
      return 'pending';
    });
  }, [plan?.steps, progress.completedSteps, progress.currentStep]);

  // 阶段颜色
  const phaseColor = useMemo(() => {
    switch (progress.phase) {
      case 'planning':
        return 'text-blue-500';
      case 'executing':
        return 'text-amber-500';
      case 'completed':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  }, [progress.phase]);

  if (progress.phase === 'idle') {
    return null;
  }

  return (
    <div className={cn('w-full', className)}>
      {/* 进度条 */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {progress.phase === 'executing' && (
              <Loader2 className={cn('h-4 w-4 animate-spin', phaseColor)} />
            )}
            {progress.phase === 'completed' && (
              <CheckCircle2 className={cn('h-4 w-4', phaseColor)} />
            )}
            {progress.phase === 'error' && (
              <AlertCircle className={cn('h-4 w-4', phaseColor)} />
            )}
            <span className={cn('text-sm font-medium', phaseColor)}>
              {progress.message}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">
            {Math.round(progress.percentage)}%
          </span>
        </div>

        {/* 进度条 */}
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <motion.div
            className={cn(
              'h-full rounded-full',
              progress.phase === 'error' ? 'bg-red-500' : 'bg-primary'
            )}
            initial={{ width: 0 }}
            animate={{ width: `${progress.percentage}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* 步骤列表 */}
      {!compact && plan?.steps && plan.steps.length > 0 && (
        <div className="mb-4 space-y-2">
          {plan.steps.map((step, index) => {
            const status = stepStatuses[index];
            return (
              <div
                key={step.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg p-2 transition-colors',
                  status === 'active' && 'bg-primary/5',
                  status === 'completed' && 'opacity-60'
                )}
              >
                {/* 状态图标 */}
                <div className="flex-shrink-0">
                  {status === 'completed' && (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  )}
                  {status === 'active' && (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  )}
                  {status === 'pending' && (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>

                {/* 步骤信息 */}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      status === 'active'
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    )}
                  >
                    {step.name}
                  </p>
                  {status === 'active' && step.description && (
                    <p className="truncate text-xs text-muted-foreground">
                      {step.description}
                    </p>
                  )}
                </div>

                {/* 工具图标 */}
                {step.tool && (
                  <div className="flex-shrink-0 text-muted-foreground">
                    {TOOL_ICONS[step.tool]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 工具调用记录 */}
      {showToolCalls && progress.toolCalls.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            工具调用
          </p>
          <div className="space-y-1.5">
            <AnimatePresence>
              {progress.toolCalls.slice(-5).map((call, index) => {
                // 工具可能是 ToolType 枚举或字符串
                const toolKey = call.tool as ToolType;
                const toolIcon = TOOL_ICONS[toolKey] || (
                  <Sparkles className="h-4 w-4" />
                );
                const toolName = TOOL_NAMES[toolKey] || String(call.tool);
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 text-xs"
                  >
                    <div className="flex-shrink-0 text-muted-foreground">
                      {toolIcon}
                    </div>
                    <span className="text-muted-foreground">{toolName}</span>
                    {call.duration && (
                      <span className="flex items-center gap-0.5 text-muted-foreground/60">
                        <Clock className="h-3 w-3" />
                        {(call.duration / 1000).toFixed(1)}s
                      </span>
                    )}
                    {call.output !== undefined && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ProgressOverlay 组件
 * 全屏进度遮罩
 */
interface ProgressOverlayProps {
  progress: ProgressState;
  plan?: { steps: PlanStep[] };
  onCancel?: () => void;
}

export function ProgressOverlay({
  progress,
  plan,
  onCancel,
}: ProgressOverlayProps) {
  if (progress.phase === 'idle' || progress.phase === 'completed') {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl">
        <ProgressTracker progress={progress} plan={plan} />

        {onCancel && progress.phase !== 'error' && (
          <button
            onClick={onCancel}
            className="mt-4 w-full py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            取消
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default ProgressTracker;
