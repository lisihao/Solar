import { useState } from 'react';
import { CheckCircle2, Lightbulb } from 'lucide-react';
import type { UIMessage } from '../shared/types';
import { safeString } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n';
import { MessageCardShell } from '@/components/ui/cards';

interface ResearchCompleteCardProps {
  msg: UIMessage;
}

export function ResearchCompleteCard({ msg }: ResearchCompleteCardProps) {
  const { t } = useI18n();
  const [showMore, setShowMore] = useState(false);
  const dimData =
    msg.detail?.type === 'dimension_content'
      ? (msg.detail.data as {
          summary?: string;
          keyFindings?: string[];
          dimensionName?: string;
        })
      : null;

  const keyFindings = dimData?.keyFindings || [];
  const summary = dimData?.summary || '';
  const dimName =
    (msg.agent || '').replace('研究员', '').replace('Researcher', '').trim() ||
    dimData?.dimensionName ||
    '';

  return (
    <MessageCardShell tone="green">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span className="font-medium text-green-800">
            {dimName
              ? t('topicResearch.messageCards.complete.dimensionCompleted', {
                  dimension: dimName,
                })
              : t('topicResearch.messageCards.complete.completed')}
          </span>
        </div>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-600">
          100%
        </span>
      </div>

      {keyFindings.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-1.5">
            <Lightbulb className="h-4 w-4 text-gray-400" />
            <span className="text-xs font-medium text-gray-600">
              {t('topicResearch.messageCards.complete.keyFindings')}
            </span>
          </div>
          <ul className="space-y-1.5">
            {keyFindings
              .slice(0, showMore ? keyFindings.length : 3)
              .map((finding, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 text-sm text-gray-700"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
                  <span>
                    {typeof finding === 'string'
                      ? finding
                      : safeString(finding)}
                  </span>
                </li>
              ))}
          </ul>
          {keyFindings.length > 3 && (
            <button
              onClick={() => setShowMore(!showMore)}
              className="mt-2 text-xs text-green-600 hover:text-green-700"
            >
              {showMore
                ? t('topicResearch.messageCards.complete.collapse')
                : t('topicResearch.messageCards.complete.expandAll', {
                    count: keyFindings.length,
                  })}
            </button>
          )}
        </div>
      )}

      {!keyFindings.length && summary && (
        <p className="mt-2 line-clamp-3 text-sm text-gray-600">{summary}</p>
      )}
    </MessageCardShell>
  );
}
