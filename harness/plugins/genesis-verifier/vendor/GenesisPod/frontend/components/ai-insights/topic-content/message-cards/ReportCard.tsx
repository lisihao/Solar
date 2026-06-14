import type { UIMessage } from '../shared/types';
import { useI18n } from '@/lib/i18n';
import { MessageCardShell } from '@/components/ui/cards';

interface ReportCardProps {
  msg: UIMessage;
}

export function ReportCard({ msg }: ReportCardProps) {
  const { t } = useI18n();
  const reportData =
    msg.detail?.type === 'report_preview'
      ? (msg.detail.data as { title?: string; summary?: string })
      : null;

  return (
    <MessageCardShell tone="orange">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">📊</span>
        <span className="font-medium text-orange-800">
          {t('topicResearch.messageCards.report.completed')}
        </span>
      </div>
      {reportData?.title && (
        <p className="text-sm font-medium text-gray-800">{reportData.title}</p>
      )}
      {reportData?.summary && (
        <p className="mt-2 line-clamp-2 text-sm text-gray-600">
          {reportData.summary}
        </p>
      )}
      <button className="mt-3 text-xs text-orange-600 hover:text-orange-700">
        {t('topicResearch.messageCards.report.viewFull')}
      </button>
    </MessageCardShell>
  );
}
