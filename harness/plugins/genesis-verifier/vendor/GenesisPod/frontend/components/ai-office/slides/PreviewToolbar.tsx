'use client';

/**
 * AI Slides V5.0 - Preview Toolbar
 *
 * Toolbar below the preview area with:
 * - Fact check button
 * - AI Edit dropdown
 * - Advanced button
 */

import React, { useState } from 'react';
import {
  CheckCircle,
  Sparkles,
  Settings2,
  ChevronDown,
  Wrench,
  Wand2,
  Pencil,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface PreviewToolbarProps {
  sessionId?: string;
  pageIndex?: number;
  onFactCheck?: () => Promise<void>;
  onAIEdit?: (
    action: 'fix-layout' | 'polish-content' | 'mark-edit'
  ) => Promise<void>;
  onAdvanced?: () => void;
  className?: string;
  disabled?: boolean;
}

export function PreviewToolbar({
  sessionId,
  pageIndex,
  onFactCheck,
  onAIEdit,
  onAdvanced,
  className,
  disabled = false,
}: PreviewToolbarProps) {
  const [showAIEditMenu, setShowAIEditMenu] = useState(false);
  const [factChecking, setFactChecking] = useState(false);
  const [aiEditing, setAiEditing] = useState<string | null>(null);

  const handleFactCheck = async () => {
    if (!onFactCheck || factChecking || disabled) return;
    setFactChecking(true);
    try {
      await onFactCheck();
    } finally {
      setFactChecking(false);
    }
  };

  const handleAIEdit = async (
    action: 'fix-layout' | 'polish-content' | 'mark-edit'
  ) => {
    if (!onAIEdit || aiEditing || disabled) return;
    setAiEditing(action);
    setShowAIEditMenu(false);
    try {
      await onAIEdit(action);
    } finally {
      setAiEditing(null);
    }
  };

  const AI_EDIT_OPTIONS = [
    {
      id: 'fix-layout' as const,
      icon: Wrench,
      label: 'Fix Layout',
      description: '修复布局问题',
    },
    {
      id: 'polish-content' as const,
      icon: Wand2,
      label: 'Polish Content',
      description: '润色内容风格',
    },
    {
      id: 'mark-edit' as const,
      icon: Pencil,
      label: 'Mark and Edit',
      description: '标记并编辑',
    },
  ];

  return (
    <div className={cn('flex items-center justify-center gap-4', className)}>
      {/* Fact Check */}
      <button
        onClick={handleFactCheck}
        disabled={disabled || factChecking}
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
          disabled
            ? 'cursor-not-allowed text-slate-400'
            : factChecking
              ? 'bg-green-50 text-green-600'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
        )}
      >
        {factChecking ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle className="h-4 w-4" />
        )}
        <span>Fact check</span>
      </button>

      {/* AI Edit Dropdown */}
      <div className="relative">
        <button
          onClick={() => !disabled && setShowAIEditMenu(!showAIEditMenu)}
          disabled={disabled || aiEditing !== null}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
            disabled
              ? 'cursor-not-allowed text-slate-400'
              : aiEditing
                ? 'bg-orange-50 text-orange-600'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
          )}
        >
          {aiEditing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 text-orange-500" />
          )}
          <span>AI Edit</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 transition-transform',
              showAIEditMenu && 'rotate-180'
            )}
          />
        </button>

        {showAIEditMenu && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setShowAIEditMenu(false)}
            />
            <div className="absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {AI_EDIT_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    onClick={() => handleAIEdit(option.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-orange-50"
                  >
                    <Icon className="h-4 w-4 text-slate-500" />
                    <div>
                      <div className="text-sm font-medium text-slate-800">
                        {option.label}
                      </div>
                      <div className="text-xs text-slate-500">
                        {option.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Advanced */}
      <button
        onClick={onAdvanced}
        disabled={disabled}
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
          disabled
            ? 'cursor-not-allowed text-slate-400'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
        )}
      >
        <Settings2 className="h-4 w-4" />
        <span>Advanced</span>
      </button>
    </div>
  );
}

export default PreviewToolbar;
