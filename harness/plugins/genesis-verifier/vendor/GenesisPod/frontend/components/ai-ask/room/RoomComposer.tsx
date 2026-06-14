'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { AskRoomMember, AskRoomMode } from '@/lib/types/ask-room';

const MODE_VALUES: AskRoomMode[] = [
  'FREECHAT',
  'PARALLEL_MERGE',
  'DEBATE',
  'VOTE',
  'REVIEW',
  'HANDOFF',
];

interface RoomComposerProps {
  members: AskRoomMember[];
  defaultMode: AskRoomMode;
  disabled?: boolean;
  /** 用户切换协作模式时回调（让 header 显示当前模式，而非 roomConfig.defaultMode） */
  onModeChange?: (mode: AskRoomMode) => void;
  onSend: (input: {
    content: string;
    mode: AskRoomMode;
    mentionedMemberIds: string[];
  }) => void;
  onCancel?: () => void;
  isStreaming?: boolean;
}

interface MentionState {
  /** 触发 @ 的字符位置（指向 @ 本身） */
  start: number;
  /** @ 后用户已输入的过滤文本 */
  query: string;
  /** 高亮的候选索引 */
  active: number;
}

export function RoomComposer({
  members,
  defaultMode,
  disabled,
  onModeChange,
  onSend,
  onCancel,
  isStreaming,
}: RoomComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [mode, setModeState] = useState<AskRoomMode>(defaultMode);
  const setMode = (next: AskRoomMode) => {
    setModeState(next);
    onModeChange?.(next);
  };
  const [mentioned, setMentioned] = useState<Set<string>>(new Set());
  const [mentionState, setMentionState] = useState<MentionState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setModeState(defaultMode);
    onModeChange?.(defaultMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultMode]);

  const enabledMembers = useMemo(
    () => members.filter((m) => m.enabled && !m.deletedAt),
    [members]
  );

  // 候选 = enabledMembers 中按 query 模糊匹配的（前缀优先 + 字母序兜底）
  const candidates = useMemo(() => {
    if (!mentionState) return [] as AskRoomMember[];
    const q = mentionState.query.toLowerCase();
    const sortedAlpha = [...enabledMembers].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
    if (!q) return sortedAlpha.slice(0, 8);
    const starts: AskRoomMember[] = [];
    const contains: AskRoomMember[] = [];
    for (const m of sortedAlpha) {
      const name = m.displayName.toLowerCase();
      if (name.startsWith(q)) starts.push(m);
      else if (name.includes(q)) contains.push(m);
    }
    return [...starts, ...contains].slice(0, 8);
  }, [enabledMembers, mentionState]);

  // 每次文本变化检查光标前是否在 @ token 中
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    const caret = e.target.selectionStart ?? value.length;
    detectMention(value, caret);
  };

  const detectMention = (value: string, caret: number) => {
    // 从 caret 往前找最近的 @；@ 必须在行首或前一个字符是空白
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at < 0) {
      setMentionState(null);
      return;
    }
    const prev = at === 0 ? ' ' : upto[at - 1];
    if (!/\s/.test(prev)) {
      setMentionState(null);
      return;
    }
    const after = upto.slice(at + 1);
    // @ 后含空白说明 mention 已经断了
    if (/\s/.test(after)) {
      setMentionState(null);
      return;
    }
    setMentionState({ start: at, query: after, active: 0 });
  };

  const insertMention = (member: AskRoomMember) => {
    if (!mentionState) return;
    const before = text.slice(0, mentionState.start);
    const after = text.slice(
      mentionState.start + 1 + mentionState.query.length
    );
    const next = `${before}@${member.displayName} ${after}`;
    setText(next);
    setMentioned((prev) => new Set(prev).add(member.id));
    setMentionState(null);
    // 把光标放在插入文本之后
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const caret = before.length + 1 + member.displayName.length + 1;
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 联想下拉打开时拦截 ↑↓ Enter Esc
    if (mentionState && candidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionState({
          ...mentionState,
          active: (mentionState.active + 1) % candidates.length,
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionState({
          ...mentionState,
          active:
            (mentionState.active - 1 + candidates.length) % candidates.length,
        });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(candidates[mentionState.active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const content = text.trim();
    if (!content) return;
    // ★ Bug fix：之前用 RegExp + `\b` 边界。displayName 末尾若是 `)` / 中文等
    //   非 word char（实际就是这种情况："Grok (grok-3)"），`\b` 边界匹配
    //   失败 → 前端识别不出 mention → 后端按 leader 路由错路（screenshot 34）。
    //   改用 includes：只要文本含 "@<displayName>" 子串就算 mention，不依赖
    //   word boundary。两个 displayName 互为前缀的极端场景 user 自己看 dropdown
    //   联想能避开。
    const finalMentioned = new Set<string>();
    for (const m of enabledMembers) {
      if (content.includes(`@${m.displayName}`)) finalMentioned.add(m.id);
    }
    // 同时 union insertMention 时维护的 set（用户可能粘贴 / 手打省略 displayName）
    for (const id of mentioned) finalMentioned.add(id);
    onSend({
      content,
      mode,
      mentionedMemberIds: Array.from(finalMentioned),
    });
    setText('');
    setMentioned(new Set());
    setMentionState(null);
  };

  return (
    <div className="border-t border-gray-200/80 bg-white/90 px-6 py-4 backdrop-blur-sm">
      <div className="w-full">
        {/* 协作模式 chips */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {MODE_VALUES.map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                disabled={disabled}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                  active
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t(`askRoom.modes.${m}.label`)}
              </button>
            );
          })}
          <span className="ml-2 text-[11px] text-gray-400">
            · {t(`askRoom.modes.${mode}.hint`)}
          </span>
        </div>

        {/* 输入框 + 发送 + @ 联想下拉 */}
        <div className="relative">
          {/* @ 联想 dropdown，绝对定位在输入框上方 */}
          {mentionState && candidates.length > 0 && (
            <div className="absolute bottom-full left-0 mb-2 max-h-64 w-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
              {candidates.map((m, i) => {
                const active = i === mentionState.active;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onMouseDown={(e) => {
                      // mousedown 而非 click：避免 textarea 失焦把 mentionState 清掉
                      e.preventDefault();
                      insertMention(m);
                    }}
                    onMouseEnter={() =>
                      setMentionState((s) => (s ? { ...s, active: i } : s))
                    }
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      active ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-[11px] font-semibold text-white`}
                    >
                      {m.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-sm font-medium ${active ? 'text-blue-900' : 'text-gray-900'}`}
                      >
                        {m.displayName}
                      </div>
                      <div className="font-mono truncate text-[11px] text-gray-500">
                        {m.modelId}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-end gap-3 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm transition-all focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/15">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onBlur={() =>
                // 失焦延迟关闭 dropdown，让点击有机会触发
                setTimeout(() => setMentionState(null), 150)
              }
              placeholder={
                isStreaming
                  ? t('askRoom.composer.streamingPlaceholder')
                  : t('askRoom.composer.placeholder')
              }
              disabled={disabled || isStreaming}
              rows={2}
              className="flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-60"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={onCancel}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-red-500 px-4 text-sm font-medium text-white transition-colors hover:bg-red-600"
              >
                <X className="h-4 w-4" />
                {t('askRoom.composer.cancel')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={disabled || !text.trim()}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
                {t('askRoom.composer.send')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
