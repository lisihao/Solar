import type { UIMessage } from '../shared/types';
import { safeString } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n';
import { MessageCardShell } from '@/components/ui/cards';

interface LeaderPlanCardProps {
  msg: UIMessage;
}

export function LeaderPlanCard({ msg }: LeaderPlanCardProps) {
  const { t } = useI18n();
  const planData =
    msg.detail?.type === 'leader_plan'
      ? (msg.detail.data as Record<string, unknown>)
      : null;
  const dimensions =
    (planData?.dimensions as Array<{ name: string; description?: string }>) ||
    [];

  return (
    <MessageCardShell tone="purple">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">📋</span>
        <span className="font-medium text-purple-800">
          {t('topicResearch.messageCards.leaderPlan.completed')}
        </span>
      </div>

      {msg.content && !safeString(msg.content).includes('规划完成') && (
        <p className="mb-3 text-sm text-purple-700">
          {safeString(msg.content)}
        </p>
      )}

      {dimensions.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-purple-600">
            {t('topicResearch.messageCards.leaderPlan.dimensions')}
          </span>
          <div className="flex flex-wrap gap-2">
            {dimensions.slice(0, 6).map((dim, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs shadow-sm"
              >
                <span className="text-blue-500">🔍</span>
                <span className="text-gray-700">{dim.name}</span>
              </span>
            ))}
            {dimensions.length > 6 && (
              <span className="text-xs text-purple-500">
                {t('topicResearch.messageCards.leaderPlan.more', {
                  count: dimensions.length - 6,
                })}
              </span>
            )}
          </div>
        </div>
      )}
    </MessageCardShell>
  );
}
