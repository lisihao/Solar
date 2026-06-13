/**
 * AI Ask Room - WebSocket 事件契约（前后端共享）
 *
 * 设计：teams-mode.md §6.2
 * 评审收敛 W2 v3：
 *   - R2 重要: 改为真正的 discriminated union（kind 强制 narrow），
 *              避免 intersection 漏掉 sequenceNum / turnId 字段
 *   - R2 阻塞: 暂移除 resumeFromSeq，partial-log 端点延 W5（见 follow-up F6），
 *              避免协议-实现失配
 *
 * 前端通过 path alias 直接 import 这个文件，避免类型漂移。
 *
 * 协议要点：
 *   1. namespace 固定 "/ai-ask-room"，与 ai-teams.gateway 的 /ai-teams 隔离
 *   2. join 时校验 sessionId 归属当前 user
 *   3. 所有 server event 携带 turnId + sequenceNum（房间内单调递增）
 *   4. messageId 在 adapter 入口生成 uuid；从 participant.thinking 起携带，
 *      最终 participant.done 落库时使用同一 id
 */

import type { AskRoomMode } from "@prisma/client";

export const ASK_ROOM_NAMESPACE = "/ai-ask-room";
export const ASK_ROOM_EVENT_NAME = "ask-room.event";
export const ASK_ROOM_CLIENT_EVENT_NAME = "ask-room.client-event";
export const ASK_ROOM_JOIN_EVENT_NAME = "ask-room.join";

// ============ 共用 ============

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

// ============ Server -> Client 事件（discriminated union by kind） ============

interface BaseServerEvent {
  /** 触发本事件的 turn id */
  turnId: string;
  /** 房间内单调递增序号；前端按此排序，不用 createdAt */
  sequenceNum: number;
}

export type AskRoomServerEvent =
  | (BaseServerEvent & {
      kind: "turn.started";
      mode: AskRoomMode;
      participantIds: string[];
    })
  | (BaseServerEvent & {
      kind: "participant.thinking";
      memberId: string;
      messageId: string;
    })
  | (BaseServerEvent & {
      kind: "participant.partial";
      memberId: string;
      messageId: string;
      deltaText: string;
    })
  | (BaseServerEvent & {
      kind: "participant.done";
      memberId: string;
      messageId: string;
      tokensUsed: number;
      // 2026-05-08: adapter 用同步 chat() 不发 partial 时，最终内容直接随 done
      // 推送，前端 store 据此渲染气泡（否则 partialText="" 显示空白）。流式
      // adapter 可省略此字段，前端会回退到累积的 partialText。
      content?: string;
    })
  | (BaseServerEvent & { kind: "round.start"; round: number })
  | (BaseServerEvent & { kind: "round.end"; round: number })
  | (BaseServerEvent & {
      kind: "vote.open";
      voteId: string;
      options: VoteOption[];
    })
  | (BaseServerEvent & {
      kind: "vote.cast";
      voteId: string;
      voterMemberId: string;
      optionId: string;
    })
  | (BaseServerEvent & {
      kind: "vote.closed";
      voteId: string;
      result: VoteResult;
    })
  | (BaseServerEvent & { kind: "handoff.request"; from: string; to: string })
  | (BaseServerEvent & { kind: "handoff.accepted"; from: string; to: string })
  | (BaseServerEvent & { kind: "handoff.rejected"; from: string; to: string })
  | (BaseServerEvent & { kind: "leader.synthesis.started" })
  | (BaseServerEvent & { kind: "leader.synthesis.done"; messageId: string })
  // 2026-05-08：SYSTEM 类提示（边界场景 / 错误兜底 / 流程跳过等）。
  // 配合 adapter 同步 push 到 messages[] 让流式 UI + reload 后 DB 取回一致。
  // 之前各 adapter 边界场景直接 return 空 messages 让前端一片空白；或仅
  // push 不 emit 让当前 turn UI 看不到 → 用 system.notice 即时推流并保证持久化。
  | (BaseServerEvent & {
      kind: "system.notice";
      messageId: string;
      content: string;
    })
  | (BaseServerEvent & {
      kind: "turn.complete";
      status: "COMPLETED" | "FAILED" | "CANCELLED";
    })
  | (BaseServerEvent & { kind: "turn.error"; error: string });

// ============ Client -> Server 事件 ============

export type AskRoomClientEvent = { kind: "turn.cancel"; turnId: string };
// 注：turn.subscribe + resumeFromSeq 待 W5 实现 partial-log 端点后再开启

export interface AskRoomJoinPayload {
  sessionId: string;
}

export interface AskRoomJoinAck {
  ok: boolean;
  reason?: string;
}

// ============ 房间命名 ============

/** socket.io room name —— 仅 session owner 可 join */
export function askRoomKey(sessionId: string): string {
  return `ask-room:${sessionId}`;
}
