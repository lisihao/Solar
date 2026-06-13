'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MessageSquareWarning } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import ClientDate from '@/components/common/ClientDate';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { Modal } from '@/components/ui/dialogs/Modal';
import { toast } from '@/stores';

interface Feedback {
  id: string;
  type: 'BUG' | 'FEATURE' | 'IMPROVEMENT' | 'OTHER' | 'ANNOTATION';
  status: 'PENDING' | 'REVIEWED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  user_email: string | null;
  user_agent: string | null;
  page_url: string | null;
  user_id: string | null;
  admin_notes: string | null;
  assigned_to: string | null;
  attachments: Array<{
    filename: string;
    url: string;
    mimeType: string;
    size: number;
  }>;
  created_at: string;
  updated_at: string;
}

interface FeedbackStats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byPriority?: Record<string, number>;
}

const TYPE_COLORS: Record<string, string> = {
  BUG: 'bg-red-100 text-red-800',
  FEATURE: 'bg-amber-100 text-amber-800',
  IMPROVEMENT: 'bg-blue-100 text-blue-800',
  OTHER: 'bg-gray-100 text-gray-800',
  ANNOTATION: 'bg-purple-100 text-purple-800',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  REVIEWED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-purple-100 text-purple-800',
  RESOLVED: 'bg-green-100 text-green-800',
  CLOSED: 'bg-gray-100 text-gray-800',
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-600 text-white',
  HIGH: 'bg-orange-100 text-orange-800',
  NORMAL: 'bg-gray-100 text-gray-700',
  LOW: 'bg-slate-100 text-slate-600',
};

// Removed formatRelativeTime function - using ClientDate component instead

// Priority Icon component - only render for CRITICAL and HIGH
function PriorityIcon({ priority }: { priority: string }) {
  if (priority === 'CRITICAL') {
    return (
      <svg
        className="h-4 w-4 text-red-600"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (priority === 'HIGH') {
    return (
      <svg
        className="h-4 w-4 text-orange-500"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M5.293 7.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L6.707 7.707a1 1 0 01-1.414 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return null;
}

export default function FeedbackPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const { t } = useTranslation();

  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(
    null
  );
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [newPriority, setNewPriority] = useState('');
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Wave 4 精化 (2026-05-11): 自实现 toast → 项目 toast store

  // Type and Status labels (using i18n)
  const getTypeLabel = useCallback(
    (type: string) => {
      const labels: Record<string, string> = {
        BUG: t('admin.feedback.types.bug'),
        FEATURE: t('admin.feedback.types.feature'),
        IMPROVEMENT: t('admin.feedback.types.improvement'),
        OTHER: t('admin.feedback.types.other'),
        ANNOTATION: t('admin.feedback.types.annotation'),
      };
      return labels[type] || type;
    },
    [t]
  );

  const getStatusLabel = useCallback(
    (status: string) => {
      const labels: Record<string, string> = {
        PENDING: t('admin.feedback.statuses.pending'),
        REVIEWED: t('admin.feedback.statuses.reviewed'),
        IN_PROGRESS: t('admin.feedback.statuses.inProgress'),
        RESOLVED: t('admin.feedback.statuses.resolved'),
        CLOSED: t('admin.feedback.statuses.closed'),
      };
      return labels[status] || status;
    },
    [t]
  );

  const getPriorityLabel = useCallback(
    (priority: string) => {
      const labels: Record<string, string> = {
        CRITICAL: t('admin.feedback.priorities.critical'),
        HIGH: t('admin.feedback.priorities.high'),
        NORMAL: t('admin.feedback.priorities.normal'),
        LOW: t('admin.feedback.priorities.low'),
      };
      return labels[priority] || priority;
    },
    [t]
  );

  const fetchFeedbacks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.append('status', filterStatus);
      if (filterType) params.append('type', filterType);
      if (filterPriority) params.append('priority', filterPriority);
      if (searchQuery) params.append('search', searchQuery);

      const response = await fetch(
        `${config.apiUrl}/feedback?${params.toString()}`,
        { headers: getAuthHeader() }
      );

      if (!response.ok) {
        throw new Error(t('admin.feedback.errors.fetchFailed'));
      }

      const result = await response.json();
      const data = result?.data ?? result;
      setFeedbacks(data.feedbacks || []);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('admin.feedback.errors.fetchFailed');
      setError(message);
      logger.error('Failed to fetch feedbacks:', err);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterType, filterPriority, searchQuery, t]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`${config.apiUrl}/feedback/stats`, {
        headers: getAuthHeader(),
      });

      if (!response.ok) {
        throw new Error(t('admin.feedback.errors.statsFailed'));
      }

      const result = await response.json();
      const data = result?.data ?? result;
      setStats(data);
    } catch (err) {
      logger.error('Failed to fetch stats:', err);
    }
  }, [t]);

  useEffect(() => {
    void fetchFeedbacks();
    void fetchStats();
  }, [fetchFeedbacks, fetchStats]);

  const handleUpdateFeedback = async () => {
    if (!selectedFeedback) return;

    setUpdating(true);
    setUpdateError(null);

    try {
      const updates: Promise<Response>[] = [];

      // Update status if changed
      if (newStatus && newStatus !== selectedFeedback.status) {
        updates.push(
          fetch(`${config.apiUrl}/feedback/${selectedFeedback.id}/status`, {
            method: 'PATCH',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              status: newStatus,
              adminNotes: adminNotes || undefined,
            }),
          })
        );
      }

      // Update priority if changed
      if (newPriority && newPriority !== selectedFeedback.priority) {
        updates.push(
          fetch(`${config.apiUrl}/feedback/${selectedFeedback.id}/priority`, {
            method: 'PATCH',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ priority: newPriority }),
          })
        );
      }

      if (updates.length === 0) {
        setSelectedFeedback(null);
        return;
      }

      const results = await Promise.all(updates);
      const failedResults = results.filter((r) => !r.ok);

      if (failedResults.length > 0) {
        // Try to get error message from first failed response
        const errorData = await failedResults[0].json().catch(() => ({}));
        throw new Error(
          errorData.message || t('admin.feedback.errors.updateFailed')
        );
      }

      await Promise.all([fetchFeedbacks(), fetchStats()]);
      setSelectedFeedback(null);
      setAdminNotes('');
      setNewStatus('');
      setNewPriority('');
      toast.success(t('admin.feedback.updateSuccess'));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('admin.feedback.errors.updateFailed');
      setUpdateError(message);
      logger.error('Failed to update feedback:', err);
    } finally {
      setUpdating(false);
    }
  };

  const openDetail = useCallback((feedback: Feedback) => {
    setSelectedFeedback(feedback);
    setNewStatus(feedback.status);
    setNewPriority(feedback.priority || 'NORMAL');
    setAdminNotes(feedback.admin_notes || '');
    setUpdateError(null);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchFeedbacks();
  };

  // Memoized computed values
  const urgentCount = useMemo(
    () =>
      feedbacks.filter(
        (f) => f.priority === 'CRITICAL' || f.priority === 'HIGH'
      ).length,
    [feedbacks]
  );

  const typeOptions = useMemo(
    () => [
      { key: 'BUG', label: t('admin.feedback.types.bug') },
      { key: 'FEATURE', label: t('admin.feedback.types.feature') },
      { key: 'IMPROVEMENT', label: t('admin.feedback.types.improvement') },
      { key: 'OTHER', label: t('admin.feedback.types.other') },
      { key: 'ANNOTATION', label: t('admin.feedback.types.annotation') },
    ],
    [t]
  );

  const statusOptions = useMemo(
    () => [
      { key: 'PENDING', label: t('admin.feedback.statuses.pending') },
      { key: 'REVIEWED', label: t('admin.feedback.statuses.reviewed') },
      { key: 'IN_PROGRESS', label: t('admin.feedback.statuses.inProgress') },
      { key: 'RESOLVED', label: t('admin.feedback.statuses.resolved') },
      { key: 'CLOSED', label: t('admin.feedback.statuses.closed') },
    ],
    [t]
  );

  const priorityOptions = useMemo(
    () => [
      { key: 'CRITICAL', label: t('admin.feedback.priorities.critical') },
      { key: 'HIGH', label: t('admin.feedback.priorities.high') },
      { key: 'NORMAL', label: t('admin.feedback.priorities.normal') },
      { key: 'LOW', label: t('admin.feedback.priorities.low') },
    ],
    [t]
  );

  const urgentBadge =
    urgentCount > 0 ? (
      <div className="flex items-center gap-2 rounded-lg bg-red-100 px-4 py-2 text-red-800">
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span className="font-medium">
          {t('admin.feedback.urgentCount').replace(
            '{count}',
            String(urgentCount)
          )}
        </span>
      </div>
    ) : null;

  const body = (
    <div>
      {embedded && urgentBadge && (
        <div className="mb-4 flex justify-end">{urgentBadge}</div>
      )}
      {/* Error State */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-4 text-red-800">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
          <div className="rounded-lg bg-white p-4 shadow">
            <div className="text-2xl font-bold text-gray-900">
              {stats.total}
            </div>
            <div className="text-sm text-gray-500">
              {t('admin.feedback.stats.total')}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <div className="text-2xl font-bold text-yellow-600">
              {stats.byStatus?.PENDING || 0}
            </div>
            <div className="text-sm text-gray-500">
              {t('admin.feedback.statuses.pending')}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <div className="text-2xl font-bold text-purple-600">
              {stats.byStatus?.IN_PROGRESS || 0}
            </div>
            <div className="text-sm text-gray-500">
              {t('admin.feedback.statuses.inProgress')}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <div className="text-2xl font-bold text-green-600">
              {stats.byStatus?.RESOLVED || 0}
            </div>
            <div className="text-sm text-gray-500">
              {t('admin.feedback.statuses.resolved')}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <div className="text-2xl font-bold text-red-600">
              {stats.byType?.BUG || 0}
            </div>
            <div className="text-sm text-gray-500">
              {t('admin.feedback.types.bug')}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <div className="text-2xl font-bold text-amber-600">
              {stats.byType?.FEATURE || 0}
            </div>
            <div className="text-sm text-gray-500">
              {t('admin.feedback.types.feature')}
            </div>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="mb-4 flex flex-wrap gap-4">
        <form onSubmit={handleSearch} className="flex-1">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('admin.feedback.searchPlaceholder')}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm"
            />
            <svg
              className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </form>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm"
        >
          <option value="">{t('admin.feedback.filters.allStatus')}</option>
          {statusOptions.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm"
        >
          <option value="">{t('admin.feedback.filters.allTypes')}</option>
          {typeOptions.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm"
        >
          <option value="">{t('admin.feedback.filters.allPriority')}</option>
          {priorityOptions.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Feedback List */}
      <div className="rounded-lg bg-white shadow">
        {loading ? (
          <div className="p-8 text-center text-gray-500">
            {t('common.loading')}
          </div>
        ) : feedbacks.length === 0 ? (
          <EmptyState size="sm" title={t('admin.feedback.noFeedback')} />
        ) : (
          <div className="divide-y divide-gray-200">
            {feedbacks.map((feedback) => (
              <div
                key={feedback.id}
                className="cursor-pointer p-4 transition-colors hover:bg-gray-50"
                onClick={() => openDetail(feedback)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      {/* Priority indicator - only show icon for CRITICAL/HIGH */}
                      <PriorityIcon priority={feedback.priority || 'NORMAL'} />
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[feedback.type]}`}
                      >
                        {getTypeLabel(feedback.type)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[feedback.status]}`}
                      >
                        {getStatusLabel(feedback.status)}
                      </span>
                      {feedback.priority && feedback.priority !== 'NORMAL' && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[feedback.priority]}`}
                        >
                          {getPriorityLabel(feedback.priority)}
                        </span>
                      )}
                      {feedback.attachments?.length > 0 && (
                        <span className="text-xs text-gray-500">
                          {t('admin.feedback.filesCount').replace(
                            '{count}',
                            String(feedback.attachments.length)
                          )}
                        </span>
                      )}
                    </div>
                    <h3 className="font-medium text-gray-900">
                      {feedback.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                      {feedback.description}
                    </p>
                    <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                      <span>
                        <ClientDate
                          date={feedback.created_at}
                          format="relative"
                        />
                      </span>
                      {feedback.user_email && (
                        <span>{feedback.user_email}</span>
                      )}
                      <span className="font-mono">
                        {feedback.id.slice(0, 8)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <Modal
        open={selectedFeedback !== null}
        onClose={() => setSelectedFeedback(null)}
        title={t('admin.feedback.detailTitle')}
        size="lg"
        footer={
          <button
            onClick={() => void handleUpdateFeedback()}
            disabled={updating}
            className="w-full rounded-lg bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {updating
              ? t('common.processing')
              : t('admin.feedback.saveChanges')}
          </button>
        }
      >
        {selectedFeedback && (
          <div>
            {/* Type, Status & Priority badges */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${TYPE_COLORS[selectedFeedback.type]}`}
              >
                {getTypeLabel(selectedFeedback.type)}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_COLORS[selectedFeedback.status]}`}
              >
                {getStatusLabel(selectedFeedback.status)}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${PRIORITY_COLORS[selectedFeedback.priority || 'NORMAL']}`}
              >
                {getPriorityLabel(selectedFeedback.priority || 'NORMAL')}
              </span>
            </div>

            {/* Title */}
            <h3 className="mb-2 text-xl font-semibold text-gray-900">
              {selectedFeedback.title}
            </h3>

            {/* Meta */}
            <div className="mb-4 text-sm text-gray-500">
              <div>
                ID: <span className="font-mono">{selectedFeedback.id}</span>
              </div>
              <div>
                {t('admin.feedback.submittedAt')}:{' '}
                <ClientDate
                  date={selectedFeedback.created_at}
                  format="datetime"
                />
              </div>
              {selectedFeedback.user_email && (
                <div>
                  {t('admin.feedback.email')}:{' '}
                  <a
                    href={`mailto:${selectedFeedback.user_email}`}
                    className="text-blue-600 hover:underline"
                  >
                    {selectedFeedback.user_email}
                  </a>
                </div>
              )}
              {selectedFeedback.page_url && (
                <div className="truncate">
                  URL:{' '}
                  <a
                    href={selectedFeedback.page_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {selectedFeedback.page_url}
                  </a>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="mb-4 rounded-lg bg-gray-50 p-4">
              <h4 className="mb-2 font-medium text-gray-700">
                {t('admin.feedback.descriptionLabel')}
              </h4>
              <p className="whitespace-pre-wrap text-gray-600">
                {selectedFeedback.description}
              </p>
            </div>

            {/* Attachments */}
            {selectedFeedback.attachments?.length > 0 && (
              <div className="mb-4">
                <h4 className="mb-2 font-medium text-gray-700">
                  {t('admin.feedback.attachments')} (
                  {selectedFeedback.attachments.length})
                </h4>
                <div className="space-y-2">
                  {selectedFeedback.attachments.map((att, idx) => (
                    <a
                      key={idx}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg border p-2 text-sm hover:bg-gray-50"
                    >
                      <svg
                        className="h-5 w-5 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                        />
                      </svg>
                      <span className="flex-1 truncate">{att.filename}</span>
                      <span className="text-gray-400">
                        {(att.size / 1024).toFixed(1)} KB
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Admin Notes (existing) */}
            {selectedFeedback.admin_notes && (
              <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <h4 className="mb-2 font-medium text-blue-800">
                  {t('admin.feedback.previousNotes')}
                </h4>
                <p className="whitespace-pre-wrap text-blue-700">
                  {selectedFeedback.admin_notes}
                </p>
              </div>
            )}

            {/* Update Section */}
            <div className="border-t pt-4">
              <h4 className="mb-3 font-medium text-gray-700">
                {t('admin.feedback.updateTitle')}
              </h4>

              {updateError && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  {updateError}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {t('admin.feedback.statusLabel')}
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2"
                  >
                    {statusOptions.map(({ key, label }) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {t('admin.feedback.priorityLabel')}
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2"
                  >
                    {priorityOptions.map(({ key, label }) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t('admin.feedback.adminNotesLabel')}
                </label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder={t('admin.feedback.adminNotesPlaceholder')}
                  className="h-24 w-full resize-none rounded-lg border border-gray-300 px-4 py-2"
                />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );

  // ★ 2026-05-12: 嵌入模式 (/admin/system?tab=messages 内) 跳过外层 AdminPageLayout.
  if (embedded) return body;

  return (
    <AdminPageLayout
      title={t('admin.feedback.title')}
      description={t('admin.feedback.description')}
      icon={MessageSquareWarning}
      domain="support"
      actions={urgentBadge ?? undefined}
    >
      {body}
    </AdminPageLayout>
  );
}
