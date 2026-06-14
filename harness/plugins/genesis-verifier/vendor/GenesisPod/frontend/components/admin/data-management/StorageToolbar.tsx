'use client';

import { Download, Play, RefreshCw } from 'lucide-react';

interface StorageToolbarProps {
  onRefresh: () => void;
  onExport: () => void;
  onRun: () => void;
  loading?: boolean;
  triggering?: boolean;
  canRun?: boolean;
  generatedAtRelative?: string;
}

export default function StorageToolbar({
  onRefresh,
  onExport,
  onRun,
  loading,
  triggering,
  canRun,
  generatedAtRelative,
}: StorageToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {generatedAtRelative && (
        <span className="text-xs text-gray-400">
          快照: {generatedAtRelative}
        </span>
      )}

      <div className="flex-1" />

      <button
        onClick={onExport}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <Download className="h-4 w-4" />
        导出快照
      </button>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        刷新
      </button>
      <button
        onClick={onRun}
        disabled={!canRun || triggering}
        className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Play className={`h-4 w-4 ${triggering ? 'animate-pulse' : ''}`} />
        {triggering ? '执行中' : '立即运行 Offload'}
      </button>
    </div>
  );
}
