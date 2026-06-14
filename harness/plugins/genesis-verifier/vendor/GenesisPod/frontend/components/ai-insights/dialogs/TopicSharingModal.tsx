'use client';

/**
 * Topic Sharing Modal Component
 *
 * 用于管理专题的共享设置：
 * - 可见性设置（私有/共享/公开）
 * - 添加/移除协作者
 * - 管理协作者角色
 */

import { useState, useEffect, useCallback } from 'react';
import { getAuthTokens } from '@/lib/utils/auth';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Users as UsersLucide } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';
import { formatDateSafe } from '@/lib/utils/date';
import { useTopicInsightsStore } from '@/stores/topicInsightsStore';
import { Modal } from '@/components/ui/dialogs/Modal';
// Helper function to get headers with auth token
function getAuthHeaders(): HeadersInit {
  const tokens = getAuthTokens();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (tokens?.accessToken) {
    headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  }
  return headers;
}

// Types
export type TopicVisibility = 'PRIVATE' | 'SHARED' | 'PUBLIC';
export type CollaboratorRole = 'VIEWER' | 'EDITOR' | 'ADMIN';
export type CollaboratorStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

interface Collaborator {
  id: string;
  userId: string;
  email: string;
  username?: string;
  avatarUrl?: string;
  role: CollaboratorRole;
  status?: CollaboratorStatus;
  invitedAt: string;
  requestedAt?: string;
  isActive: boolean;
}

interface TopicSharingModalProps {
  topicId: string;
  topicName: string;
  isOpen: boolean;
  onClose: () => void;
}

// Icons
const CloseIcon = ({ className }: { className?: string }) => (
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
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);

const LockIcon = ({ className }: { className?: string }) => (
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
      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
    />
  </svg>
);

const UsersIcon = ({ className }: { className?: string }) => (
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
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

const GlobeIcon = ({ className }: { className?: string }) => (
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
      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const PlusIcon = ({ className }: { className?: string }) => (
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
      d="M12 4v16m8-8H4"
    />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
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
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
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
      d="M5 13l4 4L19 7"
    />
  </svg>
);

const XMarkIcon = ({ className }: { className?: string }) => (
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
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);

// Visibility option keys for i18n
const visibilityKeys: {
  value: TopicVisibility;
  labelKey: string;
  descKey: string;
  icon: React.ReactNode;
}[] = [
  {
    value: 'PRIVATE',
    labelKey: 'topicResearch.sharing.visibility.private',
    descKey: 'topicResearch.sharing.visibility.privateDesc',
    icon: <LockIcon className="h-5 w-5" />,
  },
  {
    value: 'SHARED',
    labelKey: 'topicResearch.sharing.visibility.shared',
    descKey: 'topicResearch.sharing.visibility.sharedDesc',
    icon: <UsersIcon className="h-5 w-5" />,
  },
  {
    value: 'PUBLIC',
    labelKey: 'topicResearch.sharing.visibility.public',
    descKey: 'topicResearch.sharing.visibility.publicDesc',
    icon: <GlobeIcon className="h-5 w-5" />,
  },
];

// Role option keys for i18n
const roleKeys: {
  value: CollaboratorRole;
  labelKey: string;
}[] = [
  { value: 'VIEWER', labelKey: 'topicResearch.sharing.roles.viewer' },
  { value: 'EDITOR', labelKey: 'topicResearch.sharing.roles.editor' },
  { value: 'ADMIN', labelKey: 'topicResearch.sharing.roles.admin' },
];

export function TopicSharingModal({
  topicId,
  topicName,
  isOpen,
  onClose,
}: TopicSharingModalProps) {
  const { t } = useTranslation();
  const patchTopic = useTopicInsightsStore((s) => s.patchTopic);
  const [visibility, setVisibility] = useState<TopicVisibility>('PRIVATE');
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [pendingApplications, setPendingApplications] = useState<
    Collaborator[]
  >([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<CollaboratorRole>('VIEWER');
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isReviewing, setIsReviewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch sharing settings
  const fetchSettings = useCallback(async () => {
    if (!isOpen) return;

    setIsLoading(true);
    setError(null);

    try {
      const [sharingRes, collaboratorsRes, applicationsRes] = await Promise.all(
        [
          fetch(`${config.apiUrl}/topic-insights/topics/${topicId}/sharing`, {
            headers: getAuthHeaders(),
          }),
          fetch(
            `${config.apiUrl}/topic-insights/topics/${topicId}/collaborators`,
            {
              headers: getAuthHeaders(),
            }
          ),
          fetch(
            `${config.apiUrl}/topic-insights/topics/${topicId}/applications`,
            {
              headers: getAuthHeaders(),
            }
          ),
        ]
      );

      if (sharingRes.ok) {
        const result = await sharingRes.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setVisibility(data.visibility || 'PRIVATE');
      }

      if (collaboratorsRes.ok) {
        const result = await collaboratorsRes.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setCollaborators(data.collaborators || []);
      }

      if (applicationsRes.ok) {
        const result = await applicationsRes.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setPendingApplications(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      logger.error('Failed to fetch sharing settings:', err);
      setError(t('topicResearch.sharing.fetchFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [topicId, isOpen]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Update visibility
  const handleVisibilityChange = async (newVisibility: TopicVisibility) => {
    setVisibility(newVisibility);

    try {
      const res = await fetch(
        `/api/v1/insight/topics/${topicId}/visibility`,
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ visibility: newVisibility }),
        }
      );

      if (!res.ok) {
        throw new Error('Failed to update visibility');
      }

      // ★ 同步 store，使 TopicCard 等组件无需整体刷新即可显示新可见性
      patchTopic(topicId, { visibility: newVisibility });
    } catch (err) {
      logger.error('Failed to update visibility:', err);
      setError(t('topicResearch.sharing.updateVisibilityFailed'));
      // Revert on error
      fetchSettings();
    }
  };

  // Add collaborator
  const handleAddCollaborator = async () => {
    if (!newEmail.trim()) return;

    setIsAdding(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/v1/insight/topics/${topicId}/collaborators`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ email: newEmail, role: newRole }),
        }
      );

      if (!res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        throw new Error(data.message || 'Failed to add collaborator');
      }

      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const newCollaborator = result?.data ?? result;
      setCollaborators((prev) => [...prev, newCollaborator]);
      setNewEmail('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('topicResearch.sharing.collaborators.addFailed')
      );
    } finally {
      setIsAdding(false);
    }
  };

  // Update collaborator role
  const handleRoleChange = async (
    collaboratorId: string,
    role: CollaboratorRole
  ) => {
    try {
      const res = await fetch(
        `/api/v1/insight/topics/${topicId}/collaborators/${collaboratorId}`,
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ role }),
        }
      );

      if (!res.ok) {
        throw new Error('Failed to update role');
      }

      setCollaborators((prev) =>
        prev.map((c) => (c.id === collaboratorId ? { ...c, role } : c))
      );
    } catch (err) {
      logger.error('Failed to update role:', err);
      setError(t('topicResearch.sharing.collaborators.updateFailed'));
    }
  };

  // Remove collaborator
  const handleRemoveCollaborator = async (collaboratorId: string) => {
    try {
      const res = await fetch(
        `/api/v1/insight/topics/${topicId}/collaborators/${collaboratorId}`,
        { method: 'DELETE', headers: getAuthHeaders() }
      );

      if (!res.ok) {
        throw new Error('Failed to remove collaborator');
      }

      setCollaborators((prev) => prev.filter((c) => c.id !== collaboratorId));
    } catch (err) {
      logger.error('Failed to remove collaborator:', err);
      setError(t('topicResearch.sharing.collaborators.removeFailed'));
    }
  };

  // Review application (approve/reject)
  const handleReviewApplication = async (
    applicationId: string,
    decision: 'ACCEPTED' | 'REJECTED'
  ) => {
    setIsReviewing(applicationId);
    setError(null);

    try {
      const res = await fetch(
        `/api/v1/insight/topics/${topicId}/applications/${applicationId}/review`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ decision }),
        }
      );

      if (!res.ok) {
        const result = await res.json();
        const data = result?.data ?? result;
        throw new Error(data.message || 'Failed to review application');
      }

      const result = await res.json();
      const reviewedApp = result?.data ?? result;

      // Remove from pending applications
      setPendingApplications((prev) =>
        prev.filter((a) => a.id !== applicationId)
      );

      // If accepted, add to collaborators
      if (decision === 'ACCEPTED' && reviewedApp) {
        setCollaborators((prev) => [...prev, reviewedApp]);
      }
    } catch (err) {
      logger.error('Failed to review application:', err);
      setError(
        err instanceof Error
          ? err.message
          : t('topicResearch.sharing.applications.reviewFailed')
      );
    } finally {
      setIsReviewing(null);
    }
  };

  // Format date for display - uses formatDateSafe to avoid hydration errors
  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '';
    return formatDateSafe(dateStr, 'datetime-short');
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={t('topicResearch.sharing.title')}
      subtitle={topicName}
      size="md"
      footer={
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            {t('topicResearch.sharing.done')}
          </button>
        </div>
      }
    >
      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          {/* Error */}
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
              {typeof error === 'string'
                ? error
                : t('topicResearch.sharing.operationFailed')}
            </div>
          )}

          {/* Visibility */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-gray-700">
              {t('topicResearch.sharing.visibility.title')}
            </h3>
            <div className="space-y-2">
              {visibilityKeys.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    visibility === option.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={option.value}
                    checked={visibility === option.value}
                    onChange={() => handleVisibilityChange(option.value)}
                    className="sr-only"
                  />
                  <span
                    className={`${
                      visibility === option.value
                        ? 'text-blue-600'
                        : 'text-gray-400'
                    }`}
                  >
                    {option.icon}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {t(option.labelKey)}
                    </p>
                    <p className="text-xs text-gray-500">{t(option.descKey)}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Pending Applications (only show when shared and there are applications) */}
          {visibility === 'SHARED' && pendingApplications.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-medium text-gray-700">
                {t('topicResearch.sharing.applications.count', {
                  count: pendingApplications.length,
                })}
              </h3>
              <div className="space-y-2">
                {pendingApplications.map((app) => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-200 text-sm font-medium text-amber-700">
                        {app.username?.[0] || app.email[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {app.username || app.email}
                        </p>
                        <p className="text-xs text-gray-500">
                          {t('topicResearch.sharing.applications.appliedAt', {
                            time: formatDate(app.requestedAt),
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          handleReviewApplication(app.id, 'ACCEPTED')
                        }
                        disabled={isReviewing === app.id}
                        className="flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
                      >
                        {isReviewing === app.id ? (
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        ) : (
                          <CheckIcon className="h-3.5 w-3.5" />
                        )}
                        {t('topicResearch.sharing.applications.approve')}
                      </button>
                      <button
                        onClick={() =>
                          handleReviewApplication(app.id, 'REJECTED')
                        }
                        disabled={isReviewing === app.id}
                        className="flex items-center gap-1 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                        {t('topicResearch.sharing.applications.reject')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Collaborators (only show when shared) */}
          {visibility === 'SHARED' && (
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-700">
                {t('topicResearch.sharing.collaborators.count', {
                  count: collaborators.length,
                })}
              </h3>

              {/* Add collaborator */}
              <div className="mb-4 flex gap-2">
                <input
                  type="email"
                  placeholder={t(
                    'topicResearch.sharing.collaborators.emailPlaceholder'
                  )}
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500"
                />
                <select
                  value={newRole}
                  onChange={(e) =>
                    setNewRole(e.target.value as CollaboratorRole)
                  }
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
                >
                  {roleKeys.map((role) => (
                    <option key={role.value} value={role.value}>
                      {t(role.labelKey)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddCollaborator}
                  disabled={isAdding || !newEmail.trim()}
                  className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isAdding ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <PlusIcon className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Collaborator list */}
              <div className="space-y-2">
                {collaborators.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon={<UsersLucide className="h-8 w-8" />}
                    title={t(
                      'topicResearch.sharing.collaborators.noCollaborators'
                    )}
                  />
                ) : (
                  collaborators.map((collaborator) => (
                    <div
                      key={collaborator.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600">
                          {collaborator.username?.[0] ||
                            collaborator.email[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {collaborator.username || collaborator.email}
                          </p>
                          {collaborator.username && (
                            <p className="text-xs text-gray-500">
                              {collaborator.email}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={collaborator.role}
                          onChange={(e) =>
                            handleRoleChange(
                              collaborator.id,
                              e.target.value as CollaboratorRole
                            )
                          }
                          className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-blue-500"
                        >
                          {roleKeys.map((role) => (
                            <option key={role.value} value={role.value}>
                              {t(role.labelKey)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() =>
                            handleRemoveCollaborator(collaborator.id)
                          }
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
