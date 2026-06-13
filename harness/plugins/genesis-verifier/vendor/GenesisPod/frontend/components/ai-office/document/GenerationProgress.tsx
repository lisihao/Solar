'use client';

/**
 * 文档生成进度组件
 * 显示生成过程中的实时进度信息
 */

import React, { useEffect, useState } from 'react';
import {
  Loader2,
  StopCircle,
  FileText,
  Search,
  Brain,
  CheckCircle2,
} from 'lucide-react';

export interface GenerationStep {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message?: string;
}

export interface GenerationProgressProps {
  isVisible: boolean;
  currentStep: string;
  steps: GenerationStep[];
  resourcesFound?: number;
  estimatedTime?: number; // 秒
  onCancel: () => void;
}

export default function GenerationProgress({
  isVisible,
  currentStep,
  steps,
  resourcesFound = 0,
  estimatedTime,
  onCancel,
}: GenerationProgressProps) {
  const [elapsedTime, setElapsedTime] = useState(0);

  // 计时器
  useEffect(() => {
    if (!isVisible) {
      setElapsedTime(0);
      return;
    }

    const timer = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isVisible]);

  if (!isVisible) return null;

  // 计算完成百分比
  const completedSteps = steps.filter((s) => s.status === 'completed').length;
  const progress = steps.length > 0 ? (completedSteps / steps.length) * 100 : 0;

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 获取步骤图标
  const getStepIcon = (step: GenerationStep) => {
    switch (step.status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 animate-spin text-blue-600" />;
      case 'error':
        return <div className="h-5 w-5 rounded-full bg-red-600" />;
      default:
        return <div className="h-5 w-5 rounded-full bg-gray-300" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* 头部 */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Brain className="h-6 w-6 animate-pulse" />
              <div>
                <h3 className="text-lg font-semibold">AI 正在生成文档</h3>
                <p className="mt-0.5 text-sm text-blue-100">
                  请稍候，智能分析中...
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="flex items-center space-x-2 rounded-lg bg-white/20 px-4 py-2 transition-colors hover:bg-white/30"
            >
              <StopCircle className="h-4 w-4" />
              <span className="text-sm font-medium">停止生成</span>
            </button>
          </div>
        </div>

        {/* 进度条 */}
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">整体进度</span>
            <span className="text-gray-600">{Math.round(progress)}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-2.5 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* 步骤列表 */}
        <div className="max-h-80 overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={`flex items-start space-x-3 rounded-lg p-3 transition-colors ${
                  step.status === 'processing'
                    ? 'border border-blue-200 bg-blue-50'
                    : step.status === 'completed'
                      ? 'border border-green-200 bg-green-50'
                      : step.status === 'error'
                        ? 'border border-red-200 bg-red-50'
                        : 'border border-gray-200 bg-gray-50'
                }`}
              >
                <div className="mt-0.5 flex-shrink-0">{getStepIcon(step)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <h4
                      className={`text-sm font-medium ${
                        step.status === 'processing'
                          ? 'text-blue-900'
                          : step.status === 'completed'
                            ? 'text-green-900'
                            : step.status === 'error'
                              ? 'text-red-900'
                              : 'text-gray-600'
                      }`}
                    >
                      {step.name}
                    </h4>
                    <span className="text-xs text-gray-500">
                      步骤 {index + 1}
                    </span>
                  </div>
                  {step.message && (
                    <p className="mt-1 text-xs text-gray-600">{step.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 底部信息栏 */}
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            {/* 已用时间 */}
            <div>
              <div className="mb-1 text-xs text-gray-500">已用时间</div>
              <div className="text-lg font-semibold text-gray-900">
                {formatTime(elapsedTime)}
              </div>
            </div>

            {/* 扩展资源 */}
            <div>
              <div className="mb-1 text-xs text-gray-500">扩展资源</div>
              <div className="flex items-center justify-center space-x-1 text-lg font-semibold text-blue-600">
                <Search className="h-4 w-4" />
                <span>{resourcesFound}</span>
              </div>
            </div>

            {/* 预计剩余时间 */}
            <div>
              <div className="mb-1 text-xs text-gray-500">预计剩余</div>
              <div className="text-lg font-semibold text-purple-600">
                {estimatedTime ? formatTime(estimatedTime) : '--:--'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
