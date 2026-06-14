import type { UIMessage } from '../shared/types';
import { safeString } from '@/lib/utils/common';
import { MessageCardShell } from '@/components/ui/cards';

interface GenericMessageCardProps {
  msg: UIMessage;
}

export function GenericMessageCard({ msg }: GenericMessageCardProps) {
  return (
    <MessageCardShell tone="gray" padding="sm">
      <div className="flex items-start gap-2">
        {msg.agentIcon && <span className="text-lg">{msg.agentIcon}</span>}
        <div className="flex-1">
          {msg.agent && (
            <div className="mb-1 text-sm font-medium text-gray-700">
              {msg.agent}
            </div>
          )}
          <p className="text-sm text-gray-600">{safeString(msg.content)}</p>
        </div>
      </div>
    </MessageCardShell>
  );
}
