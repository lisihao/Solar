'use client';

/**
 * ResearchOptionsBar - Inline collapsible options for research configuration
 *
 * Replaces the modal dialog with an inline bar below the search input.
 * Shows: mode toggle (single/iterative), depth picker, advanced options.
 */

import { useState } from 'react';
import { Search, RefreshCw, Gauge, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import type { ResearchCreationOptions } from '../research-creation-dialog';

interface ResearchOptionsBarProps {
  options: ResearchCreationOptions;
  onOptionsChange: (options: ResearchCreationOptions) => void;
  visible: boolean;
}

const DEPTH_OPTIONS = [
  { value: 'quick' as const, label: '快速', desc: '1-2 轮' },
  { value: 'standard' as const, label: '标准', desc: '3-5 轮' },
  { value: 'thorough' as const, label: '深入', desc: '5-8 轮' },
];

export function ResearchOptionsBar({
  options,
  onOptionsChange,
  visible,
}: ResearchOptionsBarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!visible) return null;

  const update = (partial: Partial<ResearchCreationOptions>) =>
    onOptionsChange({ ...options, ...partial });

  return (
    <div className="border-b border-gray-100 bg-gray-50/50 px-6 py-3">
      <div className="mx-auto max-w-3xl space-y-3">
        {/* Row 1: Mode + Depth */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Mode Toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500">模式</span>
            <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
              <button
                onClick={() => update({ mode: 'single' })}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                  options.mode === 'single'
                    ? 'bg-purple-100 text-purple-700'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <Search className="h-3 w-3" />
                单次
              </button>
              <button
                onClick={() => update({ mode: 'iterative' })}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                  options.mode === 'iterative'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <RefreshCw className="h-3 w-3" />
                迭代
              </button>
            </div>
          </div>

          {/* Depth Picker */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500">深度</span>
            <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
              {DEPTH_OPTIONS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => update({ depth: d.value })}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                    options.depth === d.value
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-500 hover:text-gray-700'
                  )}
                  title={d.desc}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Academic Toggle */}
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={options.includeAcademic}
              onChange={(e) => update({ includeAcademic: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-xs text-gray-500">学术来源</span>
          </label>

          {/* Advanced Toggle (only for iterative) */}
          {options.mode === 'iterative' && (
            <button
              onClick={() => setShowAdvanced((p) => !p)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
            >
              <Gauge className="h-3 w-3" />
              迭代选项
              {showAdvanced ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          )}
        </div>

        {/* Row 2: Iterative Advanced Options */}
        {options.mode === 'iterative' && showAdvanced && (
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2">
            {/* Max Iterations */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">最大轮数</label>
              <input
                type="range"
                min={2}
                max={8}
                value={options.maxIterations}
                onChange={(e) =>
                  update({ maxIterations: Number(e.target.value) })
                }
                className="w-20 accent-blue-600"
              />
              <span className="text-xs font-bold text-blue-600">
                {options.maxIterations}
              </span>
            </div>

            {/* Quality Threshold */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">质量目标</label>
              <input
                type="range"
                min={50}
                max={95}
                step={5}
                value={options.qualityThreshold}
                onChange={(e) =>
                  update({ qualityThreshold: Number(e.target.value) })
                }
                className="w-20 accent-blue-600"
              />
              <span className="text-xs font-bold text-blue-600">
                {options.qualityThreshold}%
              </span>
            </div>

            {/* Auto Demo */}
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={options.autoGenerateDemo}
                onChange={(e) => update({ autoGenerateDemo: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-600">自动 Demo</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
