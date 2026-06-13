'use client';

/**
 * Application Button Component
 *
 * 用于在 TopicCard 上显示"申请加入"按钮
 * 根据用户的申请状态显示不同的 UI
 */

import { useState, useEffect, useCallback } from 'react';
import {
  applyToJoin,
  getMyApplicationStatus,
  type CollaboratorStatus,
} from '@/services/topic-insights/api';
import { useTranslation } from '@/lib/i18n';

interface ApplicationButtonProps {
  topicId: string;
  onApply?: () => void;
}

// Icons
const UserPlusIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
    />
  </svg>
);

const CheckCircleIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const ClockIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

export function ApplicationButton({
  topicId,
  onApply,
}: ApplicationButtonProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CollaboratorStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch current application status
  const fetchStatus = useCallback(async () => {
    try {
      const result = await getMyApplicationStatus(topicId);
      setStatus(result.status);
    } catch {
      // If error (e.g., not authenticated), just hide the button
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Handle apply
  const handleApply = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsApplying(true);
    setError(null);

    try {
      await applyToJoin(topicId);
      setStatus('PENDING');
      onApply?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('topicResearch.sharing.apply.failed')
      );
    } finally {
      setIsApplying(false);
    }
  };

  // Don't render anything while loading or if there's no clear state
  if (isLoading) {
    return null;
  }

  // Already a collaborator
  if (status === 'ACCEPTED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-600">
        <CheckCircleIcon className="h-3.5 w-3.5" />
        {t('topicResearch.sharing.apply.joined')}
      </span>
    );
  }

  // Application pending
  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-600">
        <ClockIcon className="h-3.5 w-3.5" />
        {t('topicResearch.sharing.apply.pending')}
      </span>
    );
  }

  // Can apply (status is null or REJECTED)
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleApply}
        disabled={isApplying}
        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50"
      >
        {isApplying ? (
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        ) : (
          <UserPlusIcon className="h-3.5 w-3.5" />
        )}
        {t('topicResearch.sharing.apply.button')}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
