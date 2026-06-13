import type { UIMessage } from '../shared/types';
import { safeString } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n';
import { MessageCardShell } from '@/components/ui/cards';

interface ResearchProgressCardProps {
  msg: UIMessage;
}

export function ResearchProgressCard({ msg }: ResearchProgressCardProps) {
  const { t } = useI18n();
  const progress = msg.progress || 0;
  const dimName = (msg.agent || '')
    .replace('研究员', '')
    .replace('Researcher', '')
    .trim();

  const getProgressText = () => {
    if (dimName) {
      return `${dimName} ${t('topicResearch.messageCards.progress.researching')}`;
    }
    return safeString(msg.content);
  };

  return (
    <MessageCardShell tone="blue" padding="sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          <span className="text-sm text-blue-700">{getProgressText()}</span>
        </div>
        {progress > 0 && (
          <span className="text-xs text-blue-600">{progress}%</span>
        )}
      </div>
      {progress > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-200">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </MessageCardShell>
  );
}
