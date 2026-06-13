/**
 * Mode Adapter 抽象接口
 *
 * 设计：teams-mode.md §5（mode → harness pattern 适配）
 *
 * 各 mode（FREECHAT / PARALLEL_MERGE / DEBATE / VOTE / REVIEW / HANDOFF）
 * 实现该接口，把 Ask 的 turn 翻译成对应 harness pattern 调用。
 */

import type {
  AskMessage,
  AskRoomMember,
  AskRoomMode,
  AskRoomTurn,
  AskSession,
} from "@prisma/client";
import { v4 as uuid } from "uuid";
import type { AskRoomServerEvent } from "../gateway/ask-room-events.types";

export interface ModeContext {
  session: AskSession;
  members: AskRoomMember[];
  /** runtime 已解析出的本轮实际参与成员（优先于全量 members） */
  participants?: AskRoomMember[];
  triggerMessage: AskMessage;
  history: AskMessage[];
  turn: AskRoomTurn;
  /** 用户在 send 时显式指定的 mode-specific options */
  modeOptions?: Record<string, unknown>;
  /** 用户 id（用于 billing referenceId） */
  userId: string;
  /** turn 维度的 sequenceNum 起点（gateway 从这里开始往上递增） */
  sequenceNumStart: number;
  signal: AbortSignal;
}

export interface PendingMessage {
  /** 在 adapter 入口生成的 messageId（亦贯穿 thinking / partial / done 事件） */
  id: string;
  senderType: "AI" | "SYSTEM";
  senderMemberId: string | null;
  content: string;
  modelId: string | null;
  modelName: string | null;
  tokens: number;
  parentMessageId?: string | null;
  /**
   * 该消息落库时使用的 sequenceNum（房间维度单调递增）。
   * 与 participant.done 事件的 sequenceNum 一致，不与 thinking 事件相同。
   * 评审 W2 v3 R2：明确语义，避免 W3 adapter（PARALLEL_MERGE / DEBATE）误用。
   */
  sequenceNum: number;
}

export interface ModeResult {
  messages: PendingMessage[];
  metadata: Record<string, unknown>;
}

export interface IModeAdapter {
  readonly mode: AskRoomMode;
  execute(
    ctx: ModeContext,
    onEvent: (e: AskRoomServerEvent) => void,
  ): Promise<ModeResult>;
}

/**
 * 2026-05-08：所有 adapter 共享的 SYSTEM 通知工具。
 *
 * 用途：边界场景（无成员 / 角色不足 / 失败兜底 / 流程跳过）即时推流并保证持久化。
 * 调用方：在拿到下一个 seq 后调用，把返回的 PendingMessage push 到 messages[]。
 *
 * 不变量：
 *   - emit system.notice 一定与一条 PendingMessage 一一对应（messageId/sequenceNum 同步）
 *   - 调用方负责保证 sequenceNum 已递增
 */
export function emitSystemNotice(
  onEvent: (e: AskRoomServerEvent) => void,
  turnId: string,
  sequenceNum: number,
  content: string,
): PendingMessage {
  const messageId = uuid();
  onEvent({
    kind: "system.notice",
    turnId,
    sequenceNum,
    messageId,
    content,
  });
  return {
    id: messageId,
    senderType: "SYSTEM",
    senderMemberId: null,
    content,
    modelId: null,
    modelName: null,
    tokens: 0,
    parentMessageId: null,
    sequenceNum,
  };
}

/**
 * 评审 2026-05-09 [BLOCKER B3]：流式 chunk.error / catch 抛错前必须脱敏。
 *
 * 背景：chatFacade.chatStream 把底层 provider 错误（含 stack / auth header / token）
 * 透传到 chunk.error 字段。adapter 直接 `throw new Error(chunk.error)` 会让原文
 * 顺着 runtime catch 进入 `turn.error.error` 字段直推前端。
 *
 * 白名单：用户可见的运维类错误（rate limit / timeout / credits / quota /
 * content moderation / context length）原文保留并截断 200 字。其余统一兜底。
 *
 * 与 parallel-merge.adapter.ts:sanitizeErrorMessage 等价（已收敛到此处共享）。
 */
const SAFE_ERROR_PATTERNS: RegExp[] = [
  /rate limit/i,
  /timeout/i,
  /credits?/i,
  /quota/i,
  /content.*moderat/i,
  /context length/i,
];

export function sanitizeStreamError(raw: string): string {
  if (SAFE_ERROR_PATTERNS.some((re) => re.test(raw))) {
    return `[error] ${raw.slice(0, 200)}`;
  }
  return "[error] AI 服务暂时不可用，请稍后重试";
}
