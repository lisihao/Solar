'use client';

/**
 * 对话式整理（ADR-006 P2）。复用 canonical `LeaderChatDock`（与「与 Leader 对话」
 * 同款浮层对话框），消费 streamOrganizeMessage 的 SSE，逐事件把工具动作渲染为 chip。
 * P1 范围：书签（scope=BOOKMARKS）。
 */
import { useState, useCallback } from 'react';
import {
  FolderPlus,
  Tag,
  ArrowRight,
  CheckCircle2,
  Search,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  LeaderChatDock,
  type LeaderChatMessage,
} from '@/components/common/leader-chat';
import {
  streamOrganizeMessage,
  type OrganizeStreamEvent,
  type OrganizeStreamRequestBody,
  type OrganizeToolAction,
} from '@/lib/api/organize-chat-stream';

const TOOL_META: Record<string, { label: string; icon: typeof Tag }> = {
  'organize-create-collection': { label: '新建集合', icon: FolderPlus },
  'organize-tag-items': { label: '打标签', icon: Tag },
  'organize-move-items': { label: '移动', icon: ArrowRight },
  'organize-set-status': { label: '改状态', icon: CheckCircle2 },
  'organize-list-collections': { label: '读取集合', icon: Search },
  'organize-list-items': { label: '读取条目', icon: Search },
};

function ToolActionRow({ action }: { action: OrganizeToolAction }) {
  const meta = TOOL_META[action.tool] ?? { label: action.tool, icon: Sparkles };
  const Icon = meta.icon;
  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-violet-700">
      <Icon className="h-3.5 w-3.5 shrink-0 text-violet-500" />
      <span>{action.detail || meta.label}</span>
    </div>
  );
}

/** 数据源统一整理：精确源类型（与后端 OrganizeItemType 对齐）。 */
type OrganizeItemTypeUI =
  | 'BOOKMARK'
  | 'NOTE'
  | 'IMAGE'
  | 'FEISHU'
  | 'NOTION'
  | 'DRIVE';

const ITEM_TYPE_LABEL: Record<OrganizeItemTypeUI, string> = {
  BOOKMARK: '书签',
  NOTE: '笔记',
  IMAGE: '图片',
  FEISHU: '飞书',
  NOTION: 'Notion',
  DRIVE: 'Google Drive',
};

/** 精确类型 → 后端粗粒度 scope（仅作 session 标签；行为由 itemType 驱动）。 */
function itemTypeToScope(
  itemType: OrganizeItemTypeUI
): NonNullable<OrganizeStreamRequestBody['scope']> {
  if (itemType === 'NOTE') return 'NOTES';
  if (itemType === 'FEISHU' || itemType === 'NOTION') return 'EXTERNAL';
  return 'BOOKMARKS';
}

export function OrganizeChatMode({
  open,
  onClose,
  itemType = 'BOOKMARK',
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  itemType?: OrganizeItemTypeUI;
  onChanged?: () => void;
}) {
  const { user, accessToken: token } = useAuth();
  // 用户气泡署名用当前登录用户名（与 UserProfileButton 同源），而非通用 "User"
  const userName = user?.fullName || user?.username || 'User';
  const [messages, setMessages] = useState<LeaderChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>();

  const handleSend = useCallback(
    async (text: string) => {
      if (!token) return;
      setSending(true);
      setError(null);

      const userId = `u-${Date.now()}`;
      const asstId = `a-${Date.now()}`;
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', content: text, createdAt: now },
        {
          id: asstId,
          role: 'assistant',
          content: '__THINKING__',
          createdAt: now,
          meta: { tools: [] },
        },
      ]);

      const patch = (fn: (m: LeaderChatMessage) => LeaderChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === asstId ? fn(m) : m)));

      const onEvent = (e: OrganizeStreamEvent) => {
        // 只把"做了什么"的写动作（带 detail）进列表；读工具无 detail，跳过避免噪声。
        if (e.type === 'tool' && e.phase === 'result' && e.detail) {
          const action: OrganizeToolAction = { tool: e.tool, detail: e.detail };
          patch((m) => {
            const tools = (m.meta?.tools as OrganizeToolAction[]) ?? [];
            return {
              ...m,
              meta: { ...m.meta, tools: [...tools, action] },
            };
          });
        } else if (e.type === 'chunk') {
          patch((m) => ({
            ...m,
            content:
              (m.content === '__THINKING__' ? '' : m.content) + e.content,
          }));
        }
      };

      const result = await streamOrganizeMessage(
        token,
        {
          message: text,
          scope: itemTypeToScope(itemType),
          itemType,
          sessionId,
        },
        onEvent
      );
      setSending(false);

      if (result.ok) {
        setSessionId(result.sessionId);
        const hasActions =
          !!result.toolActions && result.toolActions.length > 0;
        patch((m) => ({
          ...m,
          // 如实兜底：无总结时按是否真有写动作显示，绝不在啥都没做时假装「已完成」
          content:
            result.summary ||
            (m.content !== '__THINKING__'
              ? m.content
              : hasActions
                ? '已完成整理'
                : '本次没有进行任何更改'),
          // 权威明细：done/对账带回的 toolActions 覆盖实时累积——代理掉了实时
          // tool 事件时，这是唯一能看到"做了什么"的来源。
          meta:
            result.toolActions && result.toolActions.length > 0
              ? { ...m.meta, tools: result.toolActions }
              : m.meta,
        }));
        onChanged?.();
      } else {
        setError(result.error);
        patch((m) => ({
          ...m,
          content: result.partialSummary || `整理未完成：${result.error}`,
        }));
      }
    },
    [token, itemType, sessionId, onChanged]
  );

  const renderTools = (msg: LeaderChatMessage) => {
    const tools = (msg.meta?.tools as OrganizeToolAction[]) ?? [];
    if (tools.length === 0) return null;
    return (
      <div className="mt-2 flex flex-col gap-1 border-l-2 border-violet-100 pl-2">
        {tools.map((t, i) => (
          <ToolActionRow key={`${msg.id}-${i}`} action={t} />
        ))}
      </div>
    );
  };

  return (
    <LeaderChatDock
      open={open}
      onClose={onClose}
      messages={messages}
      sending={sending}
      error={error}
      onSend={handleSend}
      title="AI 整理助手"
      subtitle={`对话整理 · ${ITEM_TYPE_LABEL[itemType]}`}
      accentColor="violet"
      assistantName="整理助手"
      userName={userName}
      labels={{
        emptyTitle: '用对话整理你的库',
        emptyHint:
          '例如：「把所有 AI 论文归到新集合『AI 论文』并打标 LLM，已读的别动」',
        placeholder: '下达整理指令…',
      }}
      renderAssistantBodyExtra={renderTools}
    />
  );
}
