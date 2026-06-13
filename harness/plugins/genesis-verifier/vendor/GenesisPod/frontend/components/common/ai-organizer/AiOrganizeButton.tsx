'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

interface AiOrganizeButtonProps {
  selectedCount: number;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  variant?: 'default' | 'compact' | 'icon';
}

export function AiOrganizeButton({
  selectedCount,
  onClick,
  disabled = false,
  className = '',
  variant = 'default',
}: AiOrganizeButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const isDisabled = disabled || selectedCount === 0;

  if (variant === 'icon') {
    return (
      <button
        onClick={onClick}
        disabled={isDisabled}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`relative rounded-md p-2 transition-all ${
          isDisabled
            ? 'cursor-not-allowed text-gray-300'
            : 'text-purple-500 hover:bg-purple-50 hover:text-purple-600'
        } ${className}`}
        title={
          isDisabled
            ? 'Select files to organize'
            : `AI Organize ${selectedCount} file${selectedCount !== 1 ? 's' : ''}`
        }
      >
        <Sparkles
          className={`h-5 w-5 transition-transform ${isHovered && !isDisabled ? 'scale-110' : ''}`}
        />
        {selectedCount > 0 && !disabled && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-[10px] font-bold text-white">
            {selectedCount > 9 ? '9+' : selectedCount}
          </span>
        )}
      </button>
    );
  }

  if (variant === 'compact') {
    return (
      <button
        onClick={onClick}
        disabled={isDisabled}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-all ${
          isDisabled
            ? 'cursor-not-allowed bg-gray-100 text-gray-400'
            : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
        } ${className}`}
      >
        <Sparkles className="h-4 w-4" />
        AI Organize
        {selectedCount > 0 && (
          <span className="rounded-full bg-purple-500 px-1.5 py-0.5 text-xs text-white">
            {selectedCount}
          </span>
        )}
      </button>
    );
  }

  // Default variant
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
        isDisabled
          ? 'cursor-not-allowed bg-gray-100 text-gray-400'
          : 'bg-gradient-to-r from-purple-500 to-blue-500 text-white shadow-md hover:from-purple-600 hover:to-blue-600 hover:shadow-lg'
      } ${className}`}
    >
      <Sparkles
        className={`h-4 w-4 transition-transform ${isHovered && !isDisabled ? 'rotate-12 scale-110' : ''}`}
      />
      AI Organize
      {selectedCount > 0 && (
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            isDisabled ? 'bg-gray-200' : 'bg-white/20'
          }`}
        >
          {selectedCount} file{selectedCount !== 1 ? 's' : ''}
        </span>
      )}
    </button>
  );
}
