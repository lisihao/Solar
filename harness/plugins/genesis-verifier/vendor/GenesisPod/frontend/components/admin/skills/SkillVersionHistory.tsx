'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import {
  X,
  History,
  Eye,
  RotateCcw,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { SkillVersion } from './types';

interface SkillVersionHistoryProps {
  versions: SkillVersion[];
  currentContent: string | null;
  onRestore: (versionId: string) => Promise<void>;
  onClose: () => void;
  restoring: boolean;
}

// Purple circle colors cycling through shades for visual variety
const VERSION_CIRCLE_COLORS = [
  'bg-purple-600',
  'bg-purple-500',
  'bg-purple-400',
  'bg-violet-500',
  'bg-violet-400',
  'bg-indigo-500',
];

/**
 * Formats a date string as relative time (e.g. "2 hours ago") when recent,
 * falling back to a locale date string for older dates.
 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  }
  if (diffSec < 86400 * 7) {
    const d = Math.floor(diffSec / 86400);
    return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Produces a simple line-level diff between two text strings.
 * Each entry carries its type ('unchanged' | 'added' | 'removed') and the line text.
 */
interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  text: string;
  lineNo: number;
}

function computeLineDiff(
  oldText: string,
  newText: string
): { oldLines: DiffLine[]; newLines: DiffLine[] } {
  const oldArr = oldText.split('\n');
  const newArr = newText.split('\n');

  const oldSet = new Set(oldArr);
  const newSet = new Set(newArr);

  const oldLines: DiffLine[] = oldArr.map((text, i) => ({
    type: newSet.has(text) ? 'unchanged' : 'removed',
    text,
    lineNo: i + 1,
  }));

  const newLines: DiffLine[] = newArr.map((text, i) => ({
    type: oldSet.has(text) ? 'unchanged' : 'added',
    text,
    lineNo: i + 1,
  }));

  return { oldLines, newLines };
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const bgClass =
    line.type === 'added'
      ? 'bg-green-50 text-green-800'
      : line.type === 'removed'
        ? 'bg-red-50 text-red-800'
        : 'text-gray-700';

  const prefix =
    line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

  return (
    <div className={`font-mono flex gap-2 px-3 py-0.5 text-xs ${bgClass}`}>
      <span className="w-8 select-none text-right text-gray-400">
        {line.lineNo}
      </span>
      <span className="w-3 select-none font-bold">{prefix}</span>
      <span className="flex-1 whitespace-pre-wrap break-all">{line.text}</span>
    </div>
  );
}

interface DiffViewProps {
  versionContent: string;
  currentContent: string | null;
}

function DiffView({ versionContent, currentContent }: DiffViewProps) {
  if (!currentContent) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
        No current content to compare against.
      </div>
    );
  }

  const { oldLines, newLines } = computeLineDiff(
    versionContent,
    currentContent
  );

  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
      <div className="grid grid-cols-2 divide-x divide-gray-200">
        {/* Left: this version */}
        <div>
          <div className="border-b border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600">
            This version
          </div>
          <div className="max-h-64 overflow-y-auto">
            {oldLines.map((line) => (
              <DiffLineRow key={`old-${line.lineNo}`} line={line} />
            ))}
          </div>
        </div>
        {/* Right: current */}
        <div>
          <div className="border-b border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600">
            Current
          </div>
          <div className="max-h-64 overflow-y-auto">
            {newLines.map((line) => (
              <DiffLineRow key={`new-${line.lineNo}`} line={line} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface VersionItemProps {
  version: SkillVersion;
  circleColor: string;
  isLast: boolean;
  currentContent: string | null;
  onRestore: (versionId: string) => Promise<void>;
  restoring: boolean;
  restoringId: string | null;
}

function VersionItem({
  version,
  circleColor,
  isLast,
  currentContent,
  onRestore,
  restoring,
  restoringId,
}: VersionItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const isRestoringThis = restoring && restoringId === version.id;
  const isAnyRestoring = restoring;

  return (
    <div className="relative flex gap-4">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div
          className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full ring-2 ring-white ${circleColor}`}
        />
        {!isLast && <div className="mt-1 w-px flex-1 bg-gray-200" />}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-6">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
              {version.version}
            </span>
            <span className="text-xs text-gray-400">
              {formatRelativeTime(version.createdAt)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setExpanded((v) => !v);
                if (showDiff) setShowDiff(false);
              }}
              className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
              disabled={isAnyRestoring}
            >
              <Eye className="h-3.5 w-3.5" />
              View
              {expanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void onRestore(version.id)}
              disabled={isAnyRestoring}
              className="flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRestoringThis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {isRestoringThis ? 'Restoring...' : 'Restore'}
            </button>
          </div>
        </div>

        {/* Metadata */}
        {(version.changeNote || version.changedBy) && (
          <div className="mt-1.5 space-y-0.5">
            {version.changeNote && (
              <p className="text-xs text-gray-600">{version.changeNote}</p>
            )}
            {version.changedBy && (
              <p className="text-xs text-gray-400">
                By{' '}
                <span className="font-medium text-gray-500">
                  {version.changedBy}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Expanded content */}
        {expanded && (
          <div className="mt-3 space-y-3">
            {/* Prompt content viewer */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">
                  Prompt Content
                </span>
                {currentContent && (
                  <button
                    type="button"
                    onClick={() => setShowDiff((v) => !v)}
                    className="text-xs text-purple-600 hover:text-purple-700"
                  >
                    {showDiff ? 'Hide diff' : 'Compare with current'}
                  </button>
                )}
              </div>
              <textarea
                readOnly
                value={version.promptContent}
                rows={8}
                className="font-mono w-full resize-none rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 focus:outline-none"
              />
            </div>

            {/* Diff view */}
            {showDiff && (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-500">
                  Diff (this version vs current)
                </p>
                <DiffView
                  versionContent={version.promptContent}
                  currentContent={currentContent}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SkillVersionHistory({
  versions,
  currentContent,
  onRestore,
  onClose,
  restoring,
}: SkillVersionHistoryProps) {
  const { t } = useTranslation();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const handleRestore = async (versionId: string) => {
    setRestoringId(versionId);
    try {
      await onRestore(versionId);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-history-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-[600px] flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100">
              <History className="h-5 w-5 text-purple-700" />
            </div>
            <div>
              <h2
                id="version-history-title"
                className="text-base font-semibold text-gray-900"
              >
                Version History
              </h2>
              <p className="text-xs text-gray-400">
                {versions.length}{' '}
                {versions.length === 1 ? 'version' : 'versions'} recorded
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <History className="h-6 w-6 text-gray-400" />
              </div>
              <p className="font-medium text-gray-600">No versions yet</p>
              <p className="mt-1 text-sm text-gray-400">
                Version history will appear here after the skill is saved.
              </p>
            </div>
          ) : (
            <div>
              {versions.map((version, index) => (
                <VersionItem
                  key={version.id}
                  version={version}
                  circleColor={
                    VERSION_CIRCLE_COLORS[index % VERSION_CIRCLE_COLORS.length]
                  }
                  isLast={index === versions.length - 1}
                  currentContent={currentContent}
                  onRestore={handleRestore}
                  restoring={restoring}
                  restoringId={restoringId}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-gray-200 px-6 py-3">
          <p className="text-xs text-gray-400">
            Restoring a version replaces the current prompt content.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
