import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { UIMessage } from '../shared/types';
import { safeString } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n';
import { MessageCardShell } from '@/components/ui/cards';

interface ReviewCardProps {
  msg: UIMessage;
}

export function ReviewCard({ msg }: ReviewCardProps) {
  const { t } = useI18n();
  const safeContent = safeString(msg.content);
  const isPassed =
    safeContent.includes('通过') || safeContent.includes('passed');

  return (
    <MessageCardShell tone={isPassed ? 'green' : 'yellow'}>
      <div className="flex items-center gap-2">
        {isPassed ? (
          <CheckCircle2 className="h-5 w-5 text-green-600" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
        )}
        <span
          className={`font-medium ${isPassed ? 'text-green-800' : 'text-yellow-800'}`}
        >
          {t('topicResearch.messageCards.review.qualityReview')}
          {isPassed
            ? t('topicResearch.messageCards.review.passed')
            : t('topicResearch.messageCards.review.needsRevision')}
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-600">{safeContent}</p>
    </MessageCardShell>
  );
}
