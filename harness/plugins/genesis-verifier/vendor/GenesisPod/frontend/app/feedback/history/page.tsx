'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { config } from '@/lib/utils/config';
import { getAuthHeader, isAuthenticated } from '@/lib/utils/auth';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import { useTranslation } from '@/lib/i18n';
import ClientDate from '@/components/common/ClientDate';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui/states/LoadingState';
import {
  FileText,
  Plus,
  ChevronRight,
  Paperclip,
  MessageSquare,
} from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { logger } from '@/lib/utils/logger';

interface Feedback {
  id: string;
  type: 'BUG' | 'FEATURE' | 'IMPROVEMENT' | 'OTHER';
  status: 'PENDING' | 'REVIEWED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  title: string;
  description: string;
  admin_notes: string | null;
  attachments: Array<{
    filename: string;
    url: string;
  }>;
  created_at: string;
  updated_at: string;
}

const TYPE_COLORS: Record<string, string> = {
  BUG: 'bg-red-100 text-red-800',
  FEATURE: 'bg-amber-100 text-amber-800',
  IMPROVEMENT: 'bg-blue-100 text-blue-800',
  OTHER: 'bg-gray-100 text-gray-800',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  REVIEWED: 'bg-blue-100 text-blue-800 border-blue-200',
  IN_PROGRESS: 'bg-purple-100 text-purple-800 border-purple-200',
  RESOLVED: 'bg-green-100 text-green-800 border-green-200',
  CLOSED: 'bg-gray-100 text-gray-800 border-gray-200',
};

export default function FeedbackHistoryPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(
    null
  );

  const getTypeLabel = useCallback(
    (type: string) => {
      const labels: Record<string, string> = {
        BUG: t('feedback.feedbackType.bug'),
        FEATURE: t('feedback.feedbackType.feature'),
        IMPROVEMENT: t('feedback.feedbackType.improvement'),
        OTHER: t('feedback.feedbackType.other'),
      };
      return labels[type] || type;
    },
    [t]
  );

  const getStatusLabel = useCallback(
    (status: string) => {
      const labels: Record<string, string> = {
        PENDING: t('feedback.status.pending'),
        REVIEWED: t('feedback.status.reviewed'),
        IN_PROGRESS: t('feedback.status.inProgress'),
        RESOLVED: t('feedback.status.resolved'),
        CLOSED: t('feedback.status.closed'),
      };
      return labels[status] || status;
    },
    [t]
  );

  const getStatusDescription = useCallback(
    (status: string) => {
      const descriptions: Record<string, string> = {
        PENDING: t('feedback.statusDesc.pending'),
        REVIEWED: t('feedback.statusDesc.reviewed'),
        IN_PROGRESS: t('feedback.statusDesc.inProgress'),
        RESOLVED: t('feedback.statusDesc.resolved'),
        CLOSED: t('feedback.statusDesc.closed'),
      };
      return descriptions[status] || '';
    },
    [t]
  );

  const fetchFeedbacks = useCallback(async () => {
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${config.apiUrl}/feedback/my`, {
        headers: getAuthHeader(),
      });
      if (response.ok) {
        const result = await response.json();
        const data = result?.data ?? result;
        setFeedbacks(data?.feedbacks || []);
      }
    } catch (error) {
      logger.error('Failed to fetch feedbacks:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeedbacks();
  }, [fetchFeedbacks]);

  return (
    <AppShell>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {t('feedback.myFeedbackTitle')}
              </h1>
              <p className="text-sm text-gray-500">
                {t('feedback.trackStatus')}
              </p>
            </div>
          </div>
          <Link
            href="/feedback"
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            {t('feedback.submitNew')}
          </Link>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
          <div className="mx-auto max-w-4xl">
            {loading ? (
              <LoadingState size="md" text={t('common.loading')} />
            ) : feedbacks.length === 0 ? (
              <EmptyState
                icon={<MessageSquare className="h-12 w-12" />}
                title={t('feedback.noFeedback')}
                description={t('feedback.noFeedbackDesc')}
                action={{
                  label: t('feedback.submitFeedback'),
                  onClick: () => router.push('/feedback'),
                }}
              />
            ) : (
              <div className="space-y-4">
                {feedbacks.map((feedback) => (
                  <div
                    key={feedback.id}
                    className="cursor-pointer rounded-lg bg-white p-6 shadow transition-shadow hover:shadow-md"
                    onClick={() => setSelectedFeedback(feedback)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-medium ${TYPE_COLORS[feedback.type]}`}
                          >
                            {getTypeLabel(feedback.type)}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-medium ${STATUS_COLORS[feedback.status]}`}
                          >
                            {getStatusLabel(feedback.status)}
                          </span>
                          {feedback.attachments?.length > 0 && (
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <Paperclip className="h-3 w-3" />
                              {feedback.attachments.length}
                            </span>
                          )}
                        </div>
                        <h3 className="mb-1 font-medium text-gray-900">
                          {feedback.title}
                        </h3>
                        <p className="line-clamp-2 text-sm text-gray-600">
                          {feedback.description}
                        </p>
                        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                          <span>
                            {t('feedback.submitted')}:{' '}
                            <ClientDate
                              date={feedback.created_at}
                              format="datetime"
                              locale="zh-CN"
                              dateOptions={{
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              }}
                            />
                          </span>
                          {feedback.updated_at !== feedback.created_at && (
                            <span>
                              {t('feedback.updated')}:{' '}
                              <ClientDate
                                date={feedback.updated_at}
                                format="datetime"
                                locale="zh-CN"
                                dateOptions={{
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                }}
                              />
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 flex-shrink-0 text-gray-400" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>

        {/* Detail Modal */}
        <Modal
          open={!!selectedFeedback}
          onClose={() => setSelectedFeedback(null)}
          title={t('feedback.details')}
          size="lg"
        >
          {selectedFeedback && (
            <>
              {/* Status Banner */}
              <div
                className={`mb-6 rounded-lg border p-4 ${STATUS_COLORS[selectedFeedback.status]}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">
                    {getStatusLabel(selectedFeedback.status)}
                  </span>
                </div>
                <p className="mt-1 text-sm opacity-80">
                  {getStatusDescription(selectedFeedback.status)}
                </p>
              </div>

              {/* Type & Title */}
              <div className="mb-4">
                <span
                  className={`mb-2 inline-block rounded-full px-3 py-1 text-sm font-medium ${TYPE_COLORS[selectedFeedback.type]}`}
                >
                  {getTypeLabel(selectedFeedback.type)}
                </span>
                <h3 className="text-xl font-semibold text-gray-900">
                  {selectedFeedback.title}
                </h3>
              </div>

              {/* Meta */}
              <div className="mb-4 text-sm text-gray-500">
                <div>
                  ID: <span className="font-mono">{selectedFeedback.id}</span>
                </div>
                <div>
                  {t('feedback.submitted')}:{' '}
                  <ClientDate
                    date={selectedFeedback.created_at}
                    format="datetime"
                    locale="zh-CN"
                    dateOptions={{
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }}
                  />
                </div>
                {selectedFeedback.updated_at !==
                  selectedFeedback.created_at && (
                  <div>
                    {t('feedback.lastUpdated')}:{' '}
                    <ClientDate
                      date={selectedFeedback.updated_at}
                      format="datetime"
                      locale="zh-CN"
                      dateOptions={{
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Description */}
              <div className="mb-6 rounded-lg bg-gray-50 p-4">
                <h4 className="mb-2 font-medium text-gray-700">
                  {t('feedback.yourFeedback')}
                </h4>
                <p className="whitespace-pre-wrap text-gray-600">
                  {selectedFeedback.description}
                </p>
              </div>

              {/* Admin Response */}
              {selectedFeedback.admin_notes && (
                <div className="mb-6 rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4">
                  <h4 className="mb-2 font-medium text-blue-900">
                    {t('feedback.teamResponse')}
                  </h4>
                  <p className="whitespace-pre-wrap text-blue-800">
                    {selectedFeedback.admin_notes}
                  </p>
                </div>
              )}

              {/* Attachments */}
              {selectedFeedback.attachments?.length > 0 && (
                <div>
                  <h4 className="mb-2 font-medium text-gray-700">
                    {t('feedback.attachments')} (
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
                        <Paperclip className="h-5 w-5 text-gray-400" />
                        <span className="flex-1 truncate">{att.filename}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </Modal>
      </div>
    </AppShell>
  );
}
