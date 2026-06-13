'use client';

/**
 * LeaderChatModal — Agent Playground 的 Leader 对话入口
 *
 * 自 2026-04-25 起改为基于平台 `LeaderChatDock` 实现，
 * 本文件只负责拉取历史 + 调用发送 API + 接到 dock。
 *
 * 自 2026-04-26 起支持结构化决策：
 *   - DIRECT_ANSWER  → 仅展示文本
 *   - CREATE_TODO    → 展示已追加的任务列表 + 提示"已加入 mission"
 *   - CLARIFY        → 展示选项按钮，用户点击直接发第二轮
 *   - ACKNOWLEDGE    → 仅展示文本
 *   - understanding chip → 我理解你想要 X
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, HelpCircle, Lightbulb, ListTodo } from 'lucide-react';
import {
  listLeaderChat,
  sendLeaderChat,
  type LeaderChatMessage as ApiLeaderChatMessage,
  type LeaderDecision,
} from '@/services/agent-playground/api';
import {
  LeaderChatDock,
  type LeaderChatMessage,
} from '@/components/common/leader-chat';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  missionId: string;
  topic?: string;
  open: boolean;
  onClose: () => void;
  /** chat 触发了 dimensions 追加（CREATE_TODO 成功）→ 父级刷新 mission detail */
  onDimensionsAppended?: (ids: string[]) => void;
}

function toMessage(msg: ApiLeaderChatMessage): LeaderChatMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    tokensUsed: msg.tokensUsed,
    createdAt: msg.createdAt,
    meta: msg.decision ? { decision: msg.decision } : undefined,
  };
}

function getDecision(msg: LeaderChatMessage): LeaderDecision | null {
  const meta = msg.meta as { decision?: LeaderDecision } | undefined;
  return meta?.decision ?? null;
}

export function LeaderChatModal({
  missionId,
  topic,
  open,
  onClose,
  onDimensionsAppended,
}: Props) {
  const { user } = useAuth();
  // 用户消息标签显示真实用户名（与侧边栏一致：fullName → username → 兜底 'User'）
  const userName = user?.fullName || user?.username || 'User';
  const [messages, setMessages] = useState<LeaderChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // 加载历史
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listLeaderChat(missionId)
      .then((msgs) => {
        if (!cancelled) {
          setMessages(msgs.map(toMessage));
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, missionId]);

  const handleSend = async (text: string) => {
    setSending(true);
    setError(null);

    // 乐观插入：用户消息 + thinking 占位
    const tempUserId = `tmp-user-${Date.now()}`;
    const tempThinkingId = `tmp-thinking-${Date.now()}`;
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      {
        id: tempUserId,
        role: 'user',
        content: text,
        tokensUsed: null,
        createdAt: now,
      },
      {
        id: tempThinkingId,
        role: 'assistant',
        content: '__THINKING__',
        tokensUsed: null,
        createdAt: now,
      },
    ]);

    try {
      const result = await sendLeaderChat(missionId, text);
      setMessages((prev) =>
        prev
          .filter((m) => m.id !== tempUserId && m.id !== tempThinkingId)
          .concat(toMessage(result.user), toMessage(result.assistant))
      );
      // CREATE_TODO 成功 → 通知父级刷新 mission detail
      if (
        result.appendedDimensionIds &&
        result.appendedDimensionIds.length > 0
      ) {
        onDimensionsAppended?.(result.appendedDimensionIds);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages((prev) => prev.filter((m) => m.id !== tempThinkingId));
    } finally {
      setSending(false);
    }
  };

  // —— 槽：assistant header 显示 decisionType chip + understanding ——
  // 必须用全字面量 className —— Tailwind JIT 不解析模板字符串插值
  const renderHeaderExtra = (msg: LeaderChatMessage) => {
    const d = getDecision(msg);
    if (!d) return null;
    const chipMap = {
      DIRECT_ANSWER: {
        cls: 'bg-sky-50 text-sky-700 ring-sky-200',
        label: '回答',
        Icon: CheckCircle2,
      },
      CREATE_TODO: {
        cls: 'bg-violet-50 text-violet-700 ring-violet-200',
        label: '追加任务',
        Icon: ListTodo,
      },
      CLARIFY: {
        cls: 'bg-amber-50 text-amber-700 ring-amber-200',
        label: '需要澄清',
        Icon: HelpCircle,
      },
      ACKNOWLEDGE: {
        cls: 'bg-gray-50 text-gray-700 ring-gray-200',
        label: '收到',
        Icon: CheckCircle2,
      },
    } as const;
    const cfg = chipMap[d.type];
    if (!cfg) return null;
    const Icon = cfg.Icon;
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${cfg.cls}`}
      >
        <Icon className="h-3 w-3" />
        {cfg.label}
      </span>
    );
  };

  // —— 槽：understanding chip 在正文上方 ——
  const renderBodyPrefix = (msg: LeaderChatMessage) => {
    const d = getDecision(msg);
    if (!d?.understanding) return null;
    return (
      <div className="mb-2 flex items-start gap-1.5 rounded-md bg-amber-50/60 px-2 py-1.5 ring-1 ring-amber-200">
        <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
        <p className="text-[11px] leading-snug text-amber-900">
          <span className="font-semibold">理解：</span>
          {d.understanding}
        </p>
      </div>
    );
  };

  // —— 槽：正文之后 — TODO 任务列表 / CLARIFY 选项按钮 ——
  const renderBodyExtra = (msg: LeaderChatMessage) => {
    const d = getDecision(msg);
    if (!d) return null;
    if (d.type === 'CREATE_TODO' && d.todo && d.todo.length > 0) {
      return (
        <div className="mt-2 rounded-md border border-violet-200 bg-violet-50/40 p-2">
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            <ListTodo className="h-3 w-3" />
            已追加到 Mission · {d.todo.length} 个任务
          </p>
          <ul className="space-y-1">
            {d.todo.map((t, i) => (
              <li
                key={i}
                className="rounded bg-white px-2 py-1 text-[11px] ring-1 ring-violet-100"
              >
                <p className="font-semibold text-gray-900">{t.name}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-gray-600">
                  {t.rationale}
                </p>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    if (
      d.type === 'CLARIFY' &&
      d.clarifyOptions &&
      d.clarifyOptions.length > 0
    ) {
      return (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {d.clarifyOptions.map((opt, i) => (
            <button
              key={i}
              type="button"
              disabled={sending}
              onClick={() => {
                void handleSend(opt);
              }}
              className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <LeaderChatDock
      open={open}
      onClose={onClose}
      messages={messages}
      loading={loading}
      error={error}
      sending={sending}
      onSend={handleSend}
      title="与 Leader 对话"
      subtitle={topic ?? 'Research mission'}
      accentColor="violet"
      userName={userName}
      renderAssistantHeaderExtra={renderHeaderExtra}
      renderAssistantBodyPrefix={renderBodyPrefix}
      renderAssistantBodyExtra={renderBodyExtra}
    />
  );
}
