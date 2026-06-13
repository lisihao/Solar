'use client';

/**
 * SkillsModal - Shared modal wrapper for AppSkillsPanel
 */

import { Sparkles, X } from 'lucide-react';
import { AppSkillsPanel } from './AppSkillsPanel';

interface SkillsModalProps {
  open: boolean;
  onClose: () => void;
  domain: string;
  title: string;
  accentColor?: string;
}

export function SkillsModal({
  open,
  onClose,
  domain,
  title,
  accentColor = 'text-violet-500',
}: SkillsModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className={`h-5 w-5 ${accentColor}`} />
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          <AppSkillsPanel domain={domain} />
        </div>
      </div>
    </div>
  );
}
