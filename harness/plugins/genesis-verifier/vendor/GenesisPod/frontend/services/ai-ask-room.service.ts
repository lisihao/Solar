/**
 * AI Ask Room - REST 客户端
 *
 * 后端路径前缀：/api/v1/ask/rooms
 * 持久化复用：会话列表 / 详情仍走 /api/v1/ask/sessions（设计文档 §8.0）
 */

import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import type {
  AskRoomMember,
  AskRoomMemberRole,
  AskRoomMemberType,
  AskRoomMessage,
  AskRoomMode,
  AskRoomSession,
  AskRoomTurn,
} from '@/lib/types/ask-room';

interface CreateRoomInput {
  title?: string;
  fromSessionId?: string;
  roomConfig?: {
    defaultMode?: AskRoomMode;
    leaderModelId?: string;
    maxParticipants?: number;
    debateRounds?: number;
  };
  initialMembers?: AddMemberInput[];
}

interface AddMemberInput {
  memberType: AskRoomMemberType;
  agentId?: string;
  modelId: string;
  displayName: string;
  role?: AskRoomMemberRole;
  systemPrompt?: string;
  persona?: Record<string, unknown>;
  order?: number;
  enabled?: boolean;
}

interface UpdateMemberInput {
  displayName?: string;
  role?: AskRoomMemberRole;
  systemPrompt?: string;
  persona?: Record<string, unknown>;
  order?: number;
  enabled?: boolean;
}

interface SendRoomMessageInput {
  content: string;
  mode?: AskRoomMode;
  mentionedMemberIds?: string[];
  knowledgeBaseIds?: string[];
  enableTools?: boolean;
  modeOptions?: Record<string, unknown>;
}

interface RoomDetail {
  session: AskRoomSession;
  members: AskRoomMember[];
  // 2026-05-09（screenshot 44）：getRoom 返回历史消息（最近 200 条），让用户
  // 进入房间能看到此前对话；新流式消息通过 socket.io 追加到末尾。
  messages: AskRoomMessage[];
  recentTurns: AskRoomTurn[];
}

/**
 * 评审 W6 综合 阻塞 #1：错误消息脱敏，与后端 sanitizeErrorMessage 对齐。
 */
const SAFE_ERROR_PATTERNS = [
  /rate limit/i,
  /timeout/i,
  /credits?/i,
  /quota/i,
  /unauthor/i,
  /forbid/i,
  /not found/i,
  /already.*room/i,
];

function sanitizeErrorMessage(status: number, raw: string): string {
  if (status === 401) return '请先登录';
  if (status === 403) return '没有权限';
  if (status === 404) return '资源不存在';
  if (status === 429) return '请求过于频繁，请稍后再试';
  if (SAFE_ERROR_PATTERNS.some((re) => re.test(raw))) {
    return raw.slice(0, 200);
  }
  return '请求失败，请稍后重试';
}

async function jsonRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = config.getApiPath(path);
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(sanitizeErrorMessage(res.status, text));
  }
  const parsed = await res.json();

  // 解包 ResponseTransformInterceptor 的 { success, data, metadata } envelope，
  // 与 apiClient(client.ts:341-359) 行为对齐。否则 createRoom 拿到 envelope，
  // created.id 直接 undefined → 跳到 /ai-ask/rooms/undefined。
  if (
    parsed &&
    typeof parsed === 'object' &&
    'success' in parsed &&
    'data' in parsed
  ) {
    const otherKeys = Object.keys(parsed).filter(
      (k) => !['success', 'data', 'metadata', 'message'].includes(k)
    );
    if (otherKeys.length === 0) {
      return (parsed as { data: T }).data;
    }
  }
  return parsed as T;
}

export const askRoomService = {
  createRoom(input: CreateRoomInput): Promise<AskRoomSession> {
    return jsonRequest<AskRoomSession>('/ask/rooms', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getRoom(id: string): Promise<RoomDetail> {
    return jsonRequest<RoomDetail>(`/ask/rooms/${id}`);
  },

  updateRoom(
    id: string,
    input: { roomConfig?: CreateRoomInput['roomConfig'] }
  ): Promise<AskRoomSession> {
    return jsonRequest<AskRoomSession>(`/ask/rooms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  addMember(roomId: string, input: AddMemberInput): Promise<AskRoomMember> {
    return jsonRequest<AskRoomMember>(`/ask/rooms/${roomId}/members`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateMember(
    roomId: string,
    memberId: string,
    input: UpdateMemberInput
  ): Promise<AskRoomMember> {
    return jsonRequest<AskRoomMember>(
      `/ask/rooms/${roomId}/members/${memberId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    );
  },

  removeMember(roomId: string, memberId: string): Promise<{ ok: boolean }> {
    return jsonRequest<{ ok: boolean }>(
      `/ask/rooms/${roomId}/members/${memberId}`,
      { method: 'DELETE' }
    );
  },

  sendMessage(
    roomId: string,
    input: SendRoomMessageInput
  ): Promise<{
    turnId: string;
    userMessageId: string;
    userMessageSeq: number | null;
  }> {
    return jsonRequest<{
      turnId: string;
      userMessageId: string;
      userMessageSeq: number | null;
    }>(`/ask/rooms/${roomId}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  cancelTurn(roomId: string, turnId: string): Promise<{ ok: boolean }> {
    return jsonRequest<{ ok: boolean }>(
      `/ask/rooms/${roomId}/turns/${turnId}/cancel`,
      { method: 'POST' }
    );
  },
};
