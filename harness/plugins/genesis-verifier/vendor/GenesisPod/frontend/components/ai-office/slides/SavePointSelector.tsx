'use client';

/**
 * AI Slides V5.0 - Save Point Selector
 *
 * Dropdown menu for version/checkpoint management:
 * - List all save points
 * - Restore to previous version
 * - Create new save point
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  History,
  ChevronDown,
  Plus,
  Clock,
  Check,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useCheckpoints } from '@/hooks/features/slides';

interface SavePoint {
  id: string;
  name: string;
  createdAt: Date;
  pageCount?: number;
}

interface SavePointSelectorProps {
  sessionId?: string;
  onRestore?: (checkpointId: string) => Promise<void>;
  onCreateNew?: () => void;
  className?: string;
}

export function SavePointSelector({
  sessionId,
  onRestore,
  onCreateNew,
  className,
}: SavePointSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { checkpoints, createCheckpoint } = useCheckpoints();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleRestore = async (checkpointId: string) => {
    if (!onRestore || restoring) return;

    setRestoring(checkpointId);
    try {
      await onRestore(checkpointId);
      setIsOpen(false);
    } finally {
      setRestoring(null);
    }
  };

  const handleCreateNew = () => {
    if (onCreateNew) {
      onCreateNew();
    } else {
      createCheckpoint('手动保存点');
    }
    setIsOpen(false);
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    return `${days}天前`;
  };

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
          isOpen
            ? 'border-orange-300 bg-orange-50 text-orange-700'
            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
        )}
      >
        <History className="h-4 w-4" />
        <span>Save Point</span>
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {/* Create new */}
          <button
            onClick={handleCreateNew}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-4 w-4 text-orange-500" />
            创建保存点
          </button>

          {checkpoints.length > 0 && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <div className="max-h-64 overflow-y-auto">
                {checkpoints.slice(0, 10).map((cp) => (
                  <button
                    key={cp.id}
                    onClick={() => handleRestore(cp.id)}
                    disabled={restoring !== null}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                      restoring === cp.id
                        ? 'bg-orange-50 text-orange-700'
                        : 'text-slate-700 hover:bg-slate-50'
                    )}
                  >
                    {restoring === cp.id ? (
                      <RotateCcw className="h-4 w-4 animate-spin text-orange-500" />
                    ) : (
                      <Clock className="h-4 w-4 text-slate-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{cp.name}</div>
                      <div className="text-xs text-slate-500">
                        {formatTime(cp.timestamp)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {checkpoints.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-slate-500">
              暂无保存点
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SavePointSelector;
