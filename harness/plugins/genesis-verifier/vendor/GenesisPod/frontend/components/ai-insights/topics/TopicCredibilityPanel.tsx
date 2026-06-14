'use client';

/**
 * Topic Credibility Panel - 可信度分析面板
 *
 * 展示研究报告的可信度评估
 */

import { Shield } from 'lucide-react';
import { CredibilityPanel } from '../panels/CredibilityPanel';
import { useTopicContent } from './TopicContentContext';
import { useI18n } from '@/lib/i18n';

export function TopicCredibilityPanel() {
  const { t } = useI18n();
  const { topicId, report } = useTopicContent();

  if (!report) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center px-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
          <Shield className="h-10 w-10 text-gray-400" />
        </div>
        <h3 className="mt-4 text-lg font-medium text-gray-900">
          {t('topicResearch.topics.credibilityPanel.noReport')}
        </h3>
        <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
          {t('topicResearch.topics.credibilityPanel.noReportHint')}
        </p>
      </div>
    );
  }

  return <CredibilityPanel topicId={topicId} reportId={report.id} />;
}
