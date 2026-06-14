'use client';

/**
 * AI Slides V5.0 - AI Edit Dropdown
 *
 * Dropdown menu for AI-powered editing capabilities:
 * - Fix Layout: Auto-fix layout issues
 * - Polish Content: Refine content style
 * - Fact Check: Verify factual accuracy
 */

import React, { useState } from 'react';
import {
  Wrench,
  Sparkles,
  CheckCircle,
  ChevronDown,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import {
  useAIEdit,
  type AIEditAction,
  type FixLayoutResult,
  type PolishContentResult,
  type FactCheckResult,
} from '@/hooks/features/slides/useAIEdit';

// ============================================
// Types
// ============================================

interface AIEditDropdownProps {
  /** Session ID (will be resolved to mission ID on backend) */
  sessionId: string;
  pageIndex?: number;
  onEditComplete?: (action: AIEditAction, result: unknown) => void;
  className?: string;
}

interface EditOption {
  id: AIEditAction;
  label: string;
  description: string;
  icon: React.ElementType;
  requiresPageIndex?: boolean;
}

// ============================================
// Constants
// ============================================

const AI_EDIT_OPTIONS: EditOption[] = [
  {
    id: 'fix-layout',
    label: 'Fix Layout',
    description: '自动修复布局问题（重叠、溢出、对齐）',
    icon: Wrench,
    requiresPageIndex: true,
  },
  {
    id: 'polish-content',
    label: 'Polish Content',
    description: '润色内容以匹配整体风格',
    icon: Sparkles,
  },
  {
    id: 'fact-check',
    label: 'Fact Check',
    description: '核查内容事实准确性',
    icon: CheckCircle,
  },
];

// ============================================
// Component
// ============================================

export function AIEditDropdown({
  sessionId,
  pageIndex,
  onEditComplete,
  className,
}: AIEditDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<AIEditAction | null>(null);
  const { loading, error, executeAction } = useAIEdit();

  const handleAction = async (option: EditOption) => {
    if (option.requiresPageIndex && pageIndex === undefined) {
      return;
    }

    setActiveAction(option.id);

    try {
      // Pass sessionId - backend will resolve to missionId
      const result = await executeAction(option.id, sessionId, pageIndex);

      if (result && onEditComplete) {
        onEditComplete(option.id, result);
      }
    } finally {
      setActiveAction(null);
      setIsOpen(false);
    }
  };

  const isProcessing = loading || activeAction !== null;

  return (
    <div className={cn('relative inline-block', className)}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isProcessing}
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
          isProcessing
            ? 'cursor-not-allowed bg-gray-100 text-gray-400'
            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
        )}
      >
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 text-orange-500" />
        )}
        <span>AI Edit</span>
        <ChevronDown
          className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && !isProcessing && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu */}
          <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="p-1">
              {AI_EDIT_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isDisabled =
                  option.requiresPageIndex && pageIndex === undefined;

                return (
                  <button
                    key={option.id}
                    onClick={() => handleAction(option)}
                    disabled={isDisabled}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                      isDisabled
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:bg-orange-50'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                        isDisabled ? 'bg-gray-100' : 'bg-orange-100'
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4',
                          isDisabled ? 'text-gray-400' : 'text-orange-600'
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          'text-sm font-medium',
                          isDisabled ? 'text-gray-400' : 'text-gray-900'
                        )}
                      >
                        {option.label}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {option.description}
                        {isDisabled && ' (需要选择页面)'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="border-t border-gray-100 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="h-3 w-3" />
                  <span>{error}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================
// Result Display Components
// ============================================

interface FixLayoutResultDisplayProps {
  result: FixLayoutResult;
}

export function FixLayoutResultDisplay({
  result,
}: FixLayoutResultDisplayProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <Wrench className="h-4 w-4 text-orange-500" />
        布局修复结果
      </div>
      <div className="mt-3 grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-gray-900">
            {result.issuesFound}
          </div>
          <div className="text-xs text-gray-500">发现问题</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-green-600">
            {result.issuesFixed}
          </div>
          <div className="text-xs text-gray-500">已修复</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-red-600">
            {result.criticalIssues}
          </div>
          <div className="text-xs text-gray-500">严重问题</div>
        </div>
      </div>
    </div>
  );
}

interface PolishContentResultDisplayProps {
  result: PolishContentResult;
}

export function PolishContentResultDisplay({
  result,
}: PolishContentResultDisplayProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <Sparkles className="h-4 w-4 text-orange-500" />
        内容润色结果
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-gray-900">
            {result.pagesPolished}
          </div>
          <div className="text-xs text-gray-500">页面已润色</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-orange-600">
            {result.totalChanges}
          </div>
          <div className="text-xs text-gray-500">总修改数</div>
        </div>
      </div>
    </div>
  );
}

interface FactCheckResultDisplayProps {
  result: FactCheckResult;
}

export function FactCheckResultDisplay({
  result,
}: FactCheckResultDisplayProps) {
  const getCredibilityColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <CheckCircle className="h-4 w-4 text-orange-500" />
        事实核查结果
      </div>
      <div className="mt-3">
        <div className="text-center">
          <div
            className={cn(
              'text-3xl font-bold',
              getCredibilityColor(result.overallCredibility)
            )}
          >
            {result.overallCredibility}%
          </div>
          <div className="text-xs text-gray-500">整体可信度</div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-green-50 p-2">
            <div className="font-bold text-green-700">
              {result.verifiedCount}
            </div>
            <div className="text-green-600">已验证</div>
          </div>
          <div className="rounded-lg bg-yellow-50 p-2">
            <div className="font-bold text-yellow-700">
              {result.disputedCount}
            </div>
            <div className="text-yellow-600">存疑</div>
          </div>
          <div className="rounded-lg bg-gray-50 p-2">
            <div className="font-bold text-gray-700">
              {result.needsCitationCount}
            </div>
            <div className="text-gray-600">需引用</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AIEditDropdown;
