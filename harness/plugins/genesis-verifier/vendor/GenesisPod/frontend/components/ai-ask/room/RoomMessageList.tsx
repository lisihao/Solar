'use client';

import { useMemo } from 'react';
import { Table, THead, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { Bot, Info, MessageCircle, Sparkles, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AskRoomMember, AskRoomMessage } from '@/lib/types/ask-room';
import { useAskRoomStore } from '@/stores/ask-room.store';
import { useTranslation } from '@/lib/i18n';

interface RoomMessageListProps {
  messages: AskRoomMessage[];
  members: AskRoomMember[];
}

export function RoomMessageList({ messages, members }: RoomMessageListProps) {
  const { t } = useTranslation();
  const pending = useAskRoomStore((s) => s.pending);
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  );

  const merged = useMemo(() => {
    const items: Array<{
      key: string;
      sequenceNum: number;
      kind: 'message' | 'pending';
      message?: AskRoomMessage;
      pending?: (typeof pending)[string];
    }> = [];
    const messageIds = new Set(messages.map((m) => m.id));
    for (const m of messages) {
      items.push({
        key: m.id,
        sequenceNum: m.sequenceNum ?? 0,
        kind: 'message',
        message: m,
      });
    }
    for (const p of Object.values(pending)) {
      if (messageIds.has(p.id)) continue;
      items.push({
        key: p.id,
        sequenceNum: p.sequenceNum,
        kind: 'pending',
        pending: p,
      });
    }
    return items.sort((a, b) => a.sequenceNum - b.sequenceNum);
  }, [messages, pending]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="flex w-full flex-col gap-5">
        {merged.length === 0 ? (
          <EmptyState
            icon={<MessageCircle className="h-12 w-12" />}
            title={t('askRoom.message.emptyTitle')}
            description={t('askRoom.message.emptyHint')}
          />
        ) : (
          merged.map((item) => {
            if (item.kind === 'message' && item.message) {
              return (
                <MessageBubble
                  key={item.key}
                  message={item.message}
                  member={
                    item.message.senderMemberId
                      ? memberById.get(item.message.senderMemberId)
                      : undefined
                  }
                />
              );
            }
            if (item.kind === 'pending' && item.pending) {
              return (
                <PendingBubble
                  key={item.key}
                  member={memberById.get(item.pending.memberId)}
                  status={item.pending.status}
                  partialText={item.pending.partialText}
                />
              );
            }
            return null;
          })
        )}
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: AskRoomMessage;
  member?: AskRoomMember;
}

function MessageBubble({ message, member }: MessageBubbleProps) {
  if (message.senderType === 'USER') {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-start gap-3 lg:max-w-[70%]">
          <div className="whitespace-pre-wrap rounded-2xl rounded-tr-md bg-gradient-to-br from-blue-600 to-indigo-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
            {message.content}
          </div>
          <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
            <User className="h-4 w-4" />
          </div>
        </div>
      </div>
    );
  }
  if (message.senderType === 'SYSTEM') {
    return (
      <div className="flex justify-center">
        <div className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 shadow-sm">
          <Info className="h-3 w-3" />
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] items-start gap-3 lg:max-w-[70%]">
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm">
          <Bot className="h-4 w-4" />
        </div>
        <div className="rounded-2xl rounded-tl-md border border-gray-100 bg-white px-4 py-2.5 shadow-sm">
          {member?.displayName && (
            <div className="mb-1 text-xs font-semibold text-emerald-700">
              {member.displayName}
            </div>
          )}
          <AssistantMarkdown content={message.content} />
        </div>
      </div>
    </div>
  );
}

/**
 * AI 气泡 markdown 渲染器（截图 38：之前 whitespace-pre-wrap 导致 **bold** /
 * 列表 / 链接 / 标题全显示为 raw markdown 字符）。
 *
 * 项目未装 @tailwindcss/typography（`prose` 不生效），所以用 component-level
 * className 显式控制每种节点。列表 / 链接 / 表格 / 删除线走 remark-gfm。
 */
function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed text-gray-800 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ ...p }) => (
            <h1 className="my-2 text-base font-semibold text-gray-900" {...p} />
          ),
          h2: ({ ...p }) => (
            <h2 className="my-2 text-base font-semibold text-gray-900" {...p} />
          ),
          h3: ({ ...p }) => (
            <h3 className="my-1.5 text-sm font-semibold text-gray-900" {...p} />
          ),
          h4: ({ ...p }) => (
            <h4 className="my-1.5 text-sm font-semibold text-gray-900" {...p} />
          ),
          p: ({ ...p }) => <p className="my-1.5 leading-relaxed" {...p} />,
          ul: ({ ...p }) => (
            <ul className="my-1.5 list-disc space-y-0.5 pl-5" {...p} />
          ),
          ol: ({ ...p }) => (
            <ol className="my-1.5 list-decimal space-y-0.5 pl-5" {...p} />
          ),
          li: ({ ...p }) => <li className="leading-relaxed" {...p} />,
          strong: ({ ...p }) => (
            <strong className="font-semibold text-gray-900" {...p} />
          ),
          em: ({ ...p }) => <em className="italic" {...p} />,
          code: ({ ...p }) => (
            <code
              className="font-mono rounded bg-gray-100 px-1 py-0.5 text-[12px] text-gray-800"
              {...p}
            />
          ),
          pre: ({ ...p }) => (
            <pre
              className="font-mono my-2 overflow-x-auto rounded-md bg-gray-900 p-3 text-xs text-gray-100"
              {...p}
            />
          ),
          a: ({ ...p }) => (
            <a
              {...p}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-700"
            />
          ),
          blockquote: ({ ...p }) => (
            <blockquote
              className="my-2 border-l-4 border-gray-200 pl-3 italic text-gray-600"
              {...p}
            />
          ),
          hr: () => <hr className="my-3 border-gray-200" />,
          table: ({ ...p }) => (
            <div className="my-2 overflow-x-auto">
              <Table className="min-w-full border-collapse text-xs" {...p} />
            </div>
          ),
          thead: ({ ...p }) => <THead className="bg-gray-50" {...p} />,
          th: ({ ...p }) => (
            <Th
              className="border border-gray-200 px-2 py-1 text-left font-semibold"
              {...p}
            />
          ),
          td: ({ ...p }) => (
            <Td className="border border-gray-200 px-2 py-1" {...p} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface PendingBubbleProps {
  member?: AskRoomMember;
  status: 'thinking' | 'streaming' | 'done';
  partialText: string;
}

function PendingBubble({ member, status, partialText }: PendingBubbleProps) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] items-start gap-3 lg:max-w-[70%]">
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm">
          <Sparkles className="h-4 w-4 animate-pulse" />
        </div>
        <div className="rounded-2xl rounded-tl-md border border-gray-100 bg-white/80 px-4 py-2.5 shadow-sm backdrop-blur-sm">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            {member?.displayName ?? 'AI'}
            <span className="text-[11px] font-normal text-gray-400">
              {status === 'thinking' && t('askRoom.message.thinking')}
              {status === 'streaming' && t('askRoom.message.streaming')}
            </span>
          </div>
          {partialText && <AssistantMarkdown content={partialText} />}
        </div>
      </div>
    </div>
  );
}
