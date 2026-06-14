'use client';

import { useState } from 'react';
import { AlertTriangle, Check, X, FileText, Cloud, Laptop } from 'lucide-react';
import { formatDateSafe } from '@/lib/utils/date';

export interface SyncConflict {
  id: string;
  fileName: string;
  localModifiedAt: Date | string;
  remoteModifiedAt: Date | string;
}

interface ConflictResolverProps {
  conflicts: SyncConflict[];
  onResolve: (
    conflictId: string,
    resolution: 'keep_local' | 'keep_remote'
  ) => Promise<void>;
  onDismiss?: () => void;
  className?: string;
}

export function ConflictResolver({
  conflicts,
  onResolve,
  onDismiss,
  className = '',
}: ConflictResolverProps) {
  const [resolving, setResolving] = useState<string | null>(null);

  if (conflicts.length === 0) return null;

  const formatDate = (date: Date | string): string => {
    return formatDateSafe(date, 'datetime');
  };

  const handleResolve = async (
    conflictId: string,
    resolution: 'keep_local' | 'keep_remote'
  ) => {
    setResolving(conflictId);
    try {
      await onResolve(conflictId, resolution);
    } finally {
      setResolving(null);
    }
  };

  return (
    <div
      className={`rounded-lg border border-orange-200 bg-orange-50 p-4 ${className}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-600" />
          <h3 className="font-medium text-orange-900">
            {conflicts.length} Sync Conflict{conflicts.length > 1 ? 's' : ''}
          </h3>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="rounded-full p-1 hover:bg-orange-100"
          >
            <X className="h-4 w-4 text-orange-600" />
          </button>
        )}
      </div>

      <p className="mb-4 text-sm text-orange-700">
        These files were modified both locally and remotely. Choose which
        version to keep.
      </p>

      <div className="space-y-3">
        {conflicts.map((conflict) => (
          <div
            key={conflict.id}
            className="rounded-lg border border-orange-200 bg-white p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-500" />
              <span className="font-medium text-gray-900">
                {conflict.fileName}
              </span>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-4 text-xs">
              <div className="flex items-center gap-1.5 text-gray-600">
                <Laptop className="h-3.5 w-3.5" />
                <span>Local: {formatDate(conflict.localModifiedAt)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-600">
                <Cloud className="h-3.5 w-3.5" />
                <span>Remote: {formatDate(conflict.remoteModifiedAt)}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleResolve(conflict.id, 'keep_local')}
                disabled={resolving === conflict.id}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Laptop className="h-4 w-4" />
                Keep Local
              </button>
              <button
                onClick={() => handleResolve(conflict.id, 'keep_remote')}
                disabled={resolving === conflict.id}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Cloud className="h-4 w-4" />
                Keep Remote
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
