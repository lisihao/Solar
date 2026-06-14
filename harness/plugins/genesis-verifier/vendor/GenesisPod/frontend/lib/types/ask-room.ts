/**
 * AI Ask Room - 前端类型契约
 *
 * 必须与 backend `backend/src/modules/ai-app/ask/gateway/ask-room-events.types.ts` 同步。
 * Backend 是事实源；本文件是前端镜像（NextJS 无法直接 import backend ts 文件）。
 *
 * 协议：
 *   - 全部 server event 携带 turnId + sequenceNum；前端按 sequenceNum 排序
 *   - messageId 在 adapter 入口生成；从 participant.thinking 起携带
 *   - socket.io namespace 固定 `/ai-ask-room`
 */

export const ASK_ROOM_NAMESPACE = '/ai-ask-room';
export const ASK_ROOM_EVENT_NAME = 'ask-room.event';
export const ASK_ROOM_CLIENT_EVENT_NAME = 'ask-room.client-event';
export const ASK_ROOM_JOIN_EVENT_NAME = 'ask-room.join';

// ============ 枚举（与 Prisma 同步） ============

export type AskRoomMode =
  | 'FREECHAT'
  | 'PARALLEL_MERGE'
  | 'DEBATE'
  | 'VOTE'
  | 'REVIEW'
  | 'HANDOFF';

export type AskTurnStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type AskSenderType = 'USER' | 'AI' | 'SYSTEM';

export type AskRoomMemberRole = 'LEADER' | 'MEMBER';
export type AskRoomMemberType = 'REGISTERED' | 'VIRTUAL';
export type AskSessionMode = 'SOLO' | 'ROOM';

// ============ Domain 模型 ============

export interface AskRoomMember {
  id: string;
  sessionId: string;
  memberType: AskRoomMemberType;
  agentId: string | null;
  modelId: string;
  displayName: string;
  role: AskRoomMemberRole;
  systemPrompt: string | null;
  persona: Record<string, unknown> | null;
  order: number;
  enabled: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AskRoomTurn {
  id: string;
  sessionId: string;
  triggerMessageId: string;
  mode: AskRoomMode;
  status: AskTurnStatus;
  participantIds: string[];
  metadata: Record<string, unknown> | null;
  startedAt: string;
  endedAt: string | null;
}

export interface AskRoomSession {
  id: string;
  userId: string;
  title: string;
  summary: string | null;
  modelId: string | null;
  isBookmarked: boolean;
  mode: AskSessionMode;
  roomConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AskRoomMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  modelId: string | null;
  modelName: string | null;
  tokens: number | null;
  webSearch: boolean;
  senderType: AskSenderType;
  senderMemberId: string | null;
  mentionedMemberIds: string[];
  turnId: string | null;
  parentMessageId: string | null;
  sequenceNum: number | null;
  createdAt: string;
}

// ============ WebSocket 事件 ============

export interface VoteOption {
  id: string;
  label: string;
}

export interface VoteResult {
  voteId: string;
  winner?: string;
  tally: Record<string, number>;
  consensus: boolean;
}

interface BaseServerEvent {
  turnId: string;
  sequenceNum: number;
}

export type AskRoomServerEvent =
  | (BaseServerEvent & {
      kind: 'turn.started';
      mode: AskRoomMode;
      participantIds: string[];
    })
  | (BaseServerEvent & {
      kind: 'participant.thinking';
      memberId: string;
      messageId: string;
    })
  | (BaseServerEvent & {
      kind: 'participant.partial';
      memberId: string;
      messageId: string;
      deltaText: string;
    })
  | (BaseServerEvent & {
      kind: 'participant.done';
      memberId: string;
      messageId: string;
      tokensUsed: number;
      // 2026-05-08: 同步 chat() adapter 把最终内容随 done 推送（无 partial 时
      // 前端用此渲染气泡）；流式 adapter 省略，store 用累积的 partialText
      content?: string;
    })
  | (BaseServerEvent & { kind: 'round.start'; round: number })
  | (BaseServerEvent & { kind: 'round.end'; round: number })
  | (BaseServerEvent & {
      kind: 'vote.open';
      voteId: string;
      options: VoteOption[];
    })
  | (BaseServerEvent & {
      kind: 'vote.cast';
      voteId: string;
      voterMemberId: string;
      optionId: string;
    })
  | (BaseServerEvent & {
      kind: 'vote.closed';
      voteId: string;
      result: VoteResult;
    })
  | (BaseServerEvent & { kind: 'handoff.request'; from: string; to: string })
  | (BaseServerEvent & { kind: 'handoff.accepted'; from: string; to: string })
  | (BaseServerEvent & { kind: 'handoff.rejected'; from: string; to: string })
  | (BaseServerEvent & { kind: 'leader.synthesis.started' })
  | (BaseServerEvent & { kind: 'leader.synthesis.done'; messageId: string })
  // 2026-05-08：SYSTEM 类提示（边界场景 / 错误兜底 / 流程跳过等）。
  | (BaseServerEvent & {
      kind: 'system.notice';
      messageId: string;
      content: string;
    })
  | (BaseServerEvent & {
      kind: 'turn.complete';
      status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
    })
  | (BaseServerEvent & { kind: 'turn.error'; error: string });

export type AskRoomClientEvent = { kind: 'turn.cancel'; turnId: string };

export interface AskRoomJoinPayload {
  sessionId: string;
}

export interface AskRoomJoinAck {
  ok: boolean;
  reason?: string;
}

export function askRoomKey(sessionId: string): string {
  return `ask-room:${sessionId}`;
}
