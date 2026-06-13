/**
 * AI Ask Room - Zustand store
 *
 * 维护：
 *   - 当前 room 的 messages 累积（按 sequenceNum 排序）
 *   - per-member 当前流式状态（thinking / partial / done）
 *   - 当前 turn id + status
 *
 * 设计：sequenceNum 排序而非 createdAt（评审 v3 §8.0 决策）
 */

import { create } from 'zustand';
import type {
  AskRoomMember,
  AskRoomMessage,
  AskRoomServerEvent,
  AskRoomTurn,
  AskTurnStatus,
} from '@/lib/types/ask-room';

interface PendingMessage {
  id: string;
  memberId: string;
  status: 'thinking' | 'streaming' | 'done';
  partialText: string;
  sequenceNum: number;
  // [2026-05-09] 加 turnId 让 turn 终态迁移能精确过滤当前 turn 的 pending，
  // 避免多 turn 并发场景下 turn A 取消会错清 turn B 的活 pending。
  turnId: string;
}

interface RoomState {
  sessionId: string | null;
  members: AskRoomMember[];
  messages: AskRoomMessage[];
  /** 流式中的 AI 消息（done 后由 messages 接管） */
  pending: Record<string, PendingMessage>;
  currentTurnId: string | null;
  currentTurnStatus: AskTurnStatus | null;
  /** turn 内最新的 sequenceNum（防乱序） */
  lastSeq: number;
  // 2026-05-08（screenshot 41）：用户在前一 turn 流式中再次发送时（如先 VOTE
  // 再切 DEBATE），两个 turn 的事件交错到达，单一 lastSeq 会丢弃后到 turn 的
  // 早期事件（因其 seq 小于前一 turn 的尾部 seq）。改为 per-turnId 追踪 seq，
  // 让每个 turn 独立单调而不互相阻塞。
  lastSeqByTurn: Record<string, number>;
}

interface RoomActions {
  setRoom: (input: {
    sessionId: string;
    members: AskRoomMember[];
    messages: AskRoomMessage[];
    recentTurns: AskRoomTurn[];
  }) => void;
  setMembers: (members: AskRoomMember[]) => void;
  appendUserMessage: (msg: AskRoomMessage) => void;
  applyEvent: (event: AskRoomServerEvent) => void;
  /**
   * 2026-05-21 代理环境兜底：socket 送不到时（代理常缓冲/掐断 socket.io 长连接），
   * RoomChatPage 轮询 getRoom 把已落库的消息对账进来。按 id 去重：socket 已加的
   * （participant.done，id=messageId）或上一轮轮询加过的不重复，socket 漏掉的补进来，
   * 并清掉对应的 stale pending。镜像单聊 ai-ask-stream.ts 的 reconcileAfterStreamCut。
   */
  reconcileMessages: (messages: AskRoomMessage[]) => void;
  reset: () => void;
}

const initial: RoomState = {
  sessionId: null,
  members: [],
  messages: [],
  pending: {},
  currentTurnId: null,
  currentTurnStatus: null,
  lastSeq: 0,
  lastSeqByTurn: {},
};

/**
 * [2026-05-09] turn 终态时把**该 turn 的** pending 残留迁移到 messages，
 * 留下其他 turn 的 pending 不动（多 turn 并发场景下不能误清）。
 *
 * 后端 runtime 在失败路径会先 emit turn.error 再 emit turn.complete FAILED，
 * 第一次迁移后该 turn 已无 pending 条目，第二次自动 no-op（幂等）。
 *
 * 返回 null 表示该 turn 没有需要迁移的 pending（caller 不需要 set state）。
 */
function migratePendingForTurn(
  s: RoomState,
  turnId: string,
  suffix: string
): {
  pending: Record<string, PendingMessage>;
  messages: AskRoomMessage[];
} | null {
  const targetIds: string[] = [];
  for (const [id, p] of Object.entries(s.pending)) {
    if (p.turnId === turnId) targetIds.push(id);
  }
  if (targetIds.length === 0) return null;

  const migrated = targetIds.map<AskRoomMessage>((id) => {
    const p = s.pending[id];
    return {
      id: p.id,
      sessionId: s.sessionId ?? '',
      role: 'assistant',
      content: p.partialText ? `${p.partialText}\n\n${suffix}` : suffix,
      modelId: null,
      modelName: null,
      tokens: 0,
      webSearch: false,
      senderType: 'AI' as const,
      senderMemberId: p.memberId,
      mentionedMemberIds: [],
      turnId,
      parentMessageId: null,
      sequenceNum: p.sequenceNum,
      createdAt: new Date().toISOString(),
    };
  });

  const remaining: Record<string, PendingMessage> = {};
  for (const [id, p] of Object.entries(s.pending)) {
    if (p.turnId !== turnId) remaining[id] = p;
  }

  return {
    pending: remaining,
    messages: [...s.messages, ...migrated],
  };
}

export const useAskRoomStore = create<RoomState & RoomActions>((set) => ({
  ...initial,

  setRoom({ sessionId, members, messages, recentTurns }) {
    const lastTurn = recentTurns[0];
    set({
      sessionId,
      members,
      messages,
      pending: {},
      currentTurnId: lastTurn?.status === 'RUNNING' ? lastTurn.id : null,
      currentTurnStatus: lastTurn?.status ?? null,
      lastSeq:
        messages.reduce(
          (max, m) =>
            m.sequenceNum && m.sequenceNum > max ? m.sequenceNum : max,
          0
        ) ?? 0,
      lastSeqByTurn: {},
    });
  },

  setMembers(members) {
    set({ members });
  },

  appendUserMessage(msg) {
    set((s) => ({
      messages: [...s.messages, msg],
      lastSeq: msg.sequenceNum ?? s.lastSeq,
    }));
  },

  applyEvent(event) {
    set((s) => {
      // 评审 W6 重要 #4：所有事件严格单调；stale 直接丢弃。
      // 2026-05-08（screenshot 41）：改为 per-turnId 单调，避免并发 turn 互相
      // 屏蔽。两个 turn 同时 streaming 时，turn B 的早期事件 seq 可能小于
      // turn A 的尾部事件 seq，单 lastSeq 会错误丢弃 turn B。
      // 2026-05-09（screenshot 42 / "停止按钮无效"）：turn.complete / turn.error
      // 是 turn 生命周期的终态事件，必须始终被应用。adapter 计算 finalSeq 时
      // 用的是 lastMessage.sequenceNum + 1，但中间还有 round.end / vote.closed /
      // handoff.* / leader.synthesis.* 等无消息事件已把 turn 内 seq 推得更高，
      // 导致 turn.complete 的 seq 反而小于 turnLastSeq → 被 filter 丢弃 →
      // currentTurnStatus 永远停在 RUNNING → 停止按钮一直显示。
      const isTerminal =
        event.kind === 'turn.complete' || event.kind === 'turn.error';
      const turnLastSeq = s.lastSeqByTurn[event.turnId] ?? 0;
      if (!isTerminal && event.sequenceNum <= turnLastSeq) {
        return s;
      }

      const next: Partial<RoomState> = {
        lastSeq: Math.max(s.lastSeq, event.sequenceNum),
        lastSeqByTurn: {
          ...s.lastSeqByTurn,
          [event.turnId]: Math.max(turnLastSeq, event.sequenceNum),
        },
      };

      switch (event.kind) {
        case 'turn.started':
          next.currentTurnId = event.turnId;
          next.currentTurnStatus = 'RUNNING';
          next.pending = {};
          break;

        case 'participant.thinking':
          next.pending = {
            ...s.pending,
            [event.messageId]: {
              id: event.messageId,
              memberId: event.memberId,
              status: 'thinking',
              partialText: '',
              sequenceNum: event.sequenceNum,
              turnId: event.turnId,
            },
          };
          break;

        case 'participant.partial': {
          const existing = s.pending[event.messageId] ?? {
            id: event.messageId,
            memberId: event.memberId,
            status: 'streaming' as const,
            partialText: '',
            sequenceNum: event.sequenceNum,
            turnId: event.turnId,
          };
          next.pending = {
            ...s.pending,
            [event.messageId]: {
              ...existing,
              status: 'streaming',
              partialText: existing.partialText + event.deltaText,
            },
          };
          break;
        }

        case 'participant.done': {
          // done 时 pending → final message。content 优先用 event.content（同步
          // adapter 直接推送的完整内容），否则回退到累积的 partialText（流式 adapter）。
          // 2026-05-08：之前永远用空 partialText 导致同步 adapter 气泡空白。
          const existing = s.pending[event.messageId];
          if (existing) {
            const { [event.messageId]: _drop, ...rest } = s.pending;
            void _drop;
            next.pending = rest;
            const finalMsg = {
              id: event.messageId,
              sessionId: s.sessionId ?? '',
              role: 'assistant',
              content: event.content ?? existing.partialText,
              modelId: null,
              modelName: null,
              tokens: event.tokensUsed,
              webSearch: false,
              senderType: 'AI' as const,
              senderMemberId: existing.memberId,
              mentionedMemberIds: [],
              turnId: event.turnId,
              parentMessageId: null,
              sequenceNum: event.sequenceNum,
              createdAt: new Date().toISOString(),
            };
            next.messages = [...s.messages, finalMsg];
          }
          break;
        }

        case 'leader.synthesis.started':
        case 'leader.synthesis.done':
        case 'round.start':
        case 'round.end':
        case 'vote.open':
        case 'vote.cast':
        case 'vote.closed':
        case 'handoff.request':
        case 'handoff.accepted':
        case 'handoff.rejected':
          // 当前 store 不专门追踪这些事件；UI 可订阅 onEvent 自行展示
          break;

        case 'system.notice': {
          // 2026-05-08：SYSTEM 提示（边界场景 / 错误兜底）。adapter 已同步
          // push 到 messages[] 持久化；这里作为 SYSTEM 消息进 store 即时显示。
          const finalMsg = {
            id: event.messageId,
            sessionId: s.sessionId ?? '',
            role: 'system',
            content: event.content,
            modelId: null,
            modelName: null,
            tokens: 0,
            webSearch: false,
            senderType: 'SYSTEM' as const,
            senderMemberId: null,
            mentionedMemberIds: [],
            turnId: event.turnId,
            parentMessageId: null,
            sequenceNum: event.sequenceNum,
            createdAt: new Date().toISOString(),
          };
          next.messages = [...s.messages, finalMsg];
          break;
        }

        case 'turn.complete':
          next.currentTurnStatus = event.status;
          // 2026-05-09：清除 currentTurnId 让前端不会对已结束 turn 发 cancel
          // 请求（之前 currentTurnId 残留 → 用户多点几次 停止 → 后端 4×400）。
          if (s.currentTurnId === event.turnId) {
            next.currentTurnId = null;
          }
          // [2026-05-09] turn 终态时把**该 turn 的** pending 残留迁移到 messages。
          // 关键：用 turnId 过滤，多 turn 并发时不会误清其他 turn 的活 pending。
          // 后端 runtime 在失败路径会先 emit turn.error 再 emit turn.complete FAILED，
          // 第一次迁移后 pending 已无该 turn 条目，第二次自动 no-op（幂等）。
          if (event.status === 'CANCELLED' || event.status === 'FAILED') {
            const suffix = event.status === 'CANCELLED' ? '[已取消]' : '[出错]';
            const result = migratePendingForTurn(s, event.turnId, suffix);
            if (result) {
              next.pending = result.pending;
              next.messages = result.messages;
            }
          }
          break;

        case 'turn.error': {
          next.currentTurnStatus = 'FAILED';
          if (s.currentTurnId === event.turnId) {
            next.currentTurnId = null;
          }
          // 同 turn.complete CANCELLED：迁移**该 turn** pending 到 messages 标 [出错]
          const result = migratePendingForTurn(s, event.turnId, '[出错]');
          if (result) {
            next.pending = result.pending;
            next.messages = result.messages;
          }
          break;
        }

        default: {
          const _exhaustive: never = event;
          return _exhaustive;
        }
      }
      return next;
    });
  },

  reconcileMessages(incoming) {
    set((s) => {
      if (!incoming || incoming.length === 0) return s;
      const existingIds = new Set(s.messages.map((m) => m.id));
      const toAdd = incoming.filter((m) => !existingIds.has(m.id));
      const incomingIds = new Set(incoming.map((m) => m.id));
      // socket 漏掉 participant.done 时，pending 会卡在 thinking/streaming；
      // 一旦该消息已落库（同 id），清掉 stale pending，由 messages 接管。
      const stalePendingIds = Object.keys(s.pending).filter((id) =>
        incomingIds.has(id)
      );
      if (toAdd.length === 0 && stalePendingIds.length === 0) return s;

      let pending = s.pending;
      if (stalePendingIds.length > 0) {
        pending = { ...s.pending };
        for (const id of stalePendingIds) delete pending[id];
      }

      const merged =
        toAdd.length > 0
          ? [...s.messages, ...toAdd].sort(
              (a, b) => (a.sequenceNum ?? 0) - (b.sequenceNum ?? 0)
            )
          : s.messages;
      const lastSeq = merged.reduce(
        (max, m) =>
          m.sequenceNum && m.sequenceNum > max ? m.sequenceNum : max,
        s.lastSeq
      );
      return { messages: merged, pending, lastSeq };
    });
  },

  reset() {
    set(initial);
  },
}));
