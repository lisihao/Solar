/**
 * AI Ask SSE 流式客户端（2026-05-10 §4 god-class 拆分）
 *
 * 职责：消费 backend POST /ask/sessions/:id/messages/stream 的 SSE 帧，
 * 通过 onChunk 回调把累积内容回传调用方实现打字机效果，最终返回与旧
 * sendMessage JSON endpoint 兼容的 result shape（含 userMessage /
 * assistantMessage / ragSources）。
 *
 * 从 app/ai-ask/page.tsx 拆出，原文件已是 god-class（>2800 行），
 * pre-push 红线对单次净增 >50 行硬拒，故新增 SSE 逻辑必须独立放置。
 */

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

export interface AskRagSource {
  documentTitle: string;
  excerpt: string;
  score: number;
  /**
   * Backend `KbQueryService` tags wiki hits with metadata so the UI can
   * branch:
   *   - `source: 'wiki'` → render excerpt as markdown + show Wiki badge
   *     + deep-link to `/library?tab=wiki&kb={kbId}&page={slug}`
   *   - undefined / `source: 'chunk'` → original chunk-RAG behavior
   *     (plain-text excerpt, no link)
   */
  metadata?: {
    source?: 'wiki' | 'chunk';
    kbId?: string;
    slug?: string;
    oneLiner?: string;
    category?: string;
    [k: string]: unknown;
  };
}

export interface AskStreamRequestBody {
  content: string;
  modelId?: string;
  webSearch: boolean;
  knowledgeBaseIds?: string[];
}

export interface AskStreamSuccess {
  ok: true;
  userMessage: {
    id: string;
    content: string;
    createdAt: string;
    modelId?: string;
    modelName?: string;
  };
  assistantMessage: {
    id: string;
    content: string;
    createdAt: string;
    modelId?: string;
    modelName?: string;
    tokens: number;
  };
  ragSources?: AskRagSource[];
  /**
   * suggestedActions 链路 2026-04-30 后端已删（ai-ask.service.ts 注释明示），
   * 字段保留为 undefined 仅为兼容旧调用站签名。
   */
  suggestedActions?: Array<{ type: string; label: string; data?: unknown }>;
}

export interface AskStreamFailure {
  ok: false;
  /** 用户可读的错误（来自 SSE error event / HTTP 错误体 / 网络异常）。 */
  error: string;
  /** 失败前已经累积的部分内容（如果有），可作为 inline 错误气泡的 prefix。 */
  partialContent?: string;
  status?: number;
  byok?: boolean;
}

export type AskStreamResult = AskStreamSuccess | AskStreamFailure;

export type AskOnChunk = (
  accumulated: string,
  sources?: AskRagSource[]
) => void;
export type AskStreamStage = 'rag' | 'generating';
export type AskOnStatus = (stage: AskStreamStage) => void;

interface SseEventBase {
  type: string;
}

interface SourcesEvent extends SseEventBase {
  type: 'sources';
  sources: AskRagSource[];
}

interface ChunkEvent extends SseEventBase {
  type: 'chunk';
  content: string;
}

interface DoneEvent extends SseEventBase {
  type: 'done';
  userMessageId: string;
  assistantMessageId: string;
  tokensUsed: number;
  fullContent?: string;
  userMessage: {
    id: string;
    content: string;
    createdAt: string;
    modelId?: string;
    modelName?: string;
  };
  assistantMessage: {
    id: string;
    content: string;
    createdAt: string;
    modelId?: string;
    modelName?: string;
    tokens: number;
  };
}

interface StreamErrorEvent extends SseEventBase {
  type: 'error';
  message: string;
  code?: string;
  meta?: {
    status?: number;
    providerMessage?: string;
  };
}

type SseEvent =
  | { type: 'status'; stage: 'rag' | 'generating' }
  | SourcesEvent
  | ChunkEvent
  | DoneEvent
  | StreamErrorEvent;

const networkErrorMessage = (status: number, raw: unknown): string => {
  const data = (raw ?? {}) as Record<string, unknown>;
  const direct = typeof data.message === 'string' ? data.message : '';
  const nested =
    typeof (data.error as { message?: string } | undefined)?.message ===
    'string'
      ? (data.error as { message: string }).message
      : '';
  const human = direct || nested;
  if (human) return human;
  if (status === 401) return '登录状态已过期，请重新登录后再试。';
  if (status === 403)
    return '没有权限调用此模型，请检查 BYOK 配置或管理员授权。';
  if (status === 404) return '会话不存在或已被删除。';
  return `调用失败 (HTTP ${status})。请稍后重试或更换模型。`;
};

const inferByokCode = (
  code: string | undefined,
  message: string | null
): string | null => {
  if (
    code &&
    [
      'NO_AVAILABLE_KEY',
      'NO_SYSTEM_KEY',
      'QUOTA_EXCEEDED',
      'INVALID_API_KEY',
      'KEY_EXPIRED',
    ].includes(code)
  ) {
    return code;
  }
  const text = (message ?? '').toLowerCase();
  if (
    /status code 402|payment required|insufficient quota|insufficient credit|out of credits|billing/.test(
      text
    )
  ) {
    return 'QUOTA_EXCEEDED';
  }
  if (/invalid api key|incorrect api key|api key.*expired|key expired/.test(text)) {
    return 'INVALID_API_KEY';
  }
  return null;
};

interface PersistedAskMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  modelId?: string | null;
  modelName?: string | null;
  tokens?: number | null;
}

/**
 * 流被中途掐断（无 done）后的对账兜底。
 *
 * 背景：经**代理上网**的客户端，代理常对 `text/event-stream` 长连接做缓冲 / idle-timeout，
 * 转发部分 chunk 后把连接掐断 → 前端永远等不到 `done`（后端 X-Accel-Buffering 等头管不到
 * 客户端侧代理）。但**后端生成器在客户端断开后仍跑完并已持久化** user/assistant 消息。
 * 故这里用一次普通短 GET 回捞最新消息，若捞到「本轮」assistant 回复即视为成功
 * （无打字机、稍有延迟，但内容完整），让代理用户也能正常用。
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function tryReconcileOnce(
  sessionId: string,
  token: string,
  sentContent: string
): Promise<AskStreamSuccess | null> {
  try {
    const res = await fetch(
      `${config.apiUrl}/ask/sessions/${sessionId}/messages?limit=6`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      messages?: PersistedAskMessage[];
      data?: { messages?: PersistedAskMessage[] };
    } | null;
    const list: PersistedAskMessage[] = Array.isArray(json?.messages)
      ? json.messages
      : Array.isArray(json?.data?.messages)
        ? json.data.messages
        : [];
    if (list.length < 2) return null;

    // list 为时间正序。从尾部找最近一条 assistant，及其紧邻的前一条 user。
    let assistantIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'assistant') {
        assistantIdx = i;
        break;
      }
    }
    if (assistantIdx <= 0) return null;
    const assistant = list[assistantIdx];
    let user: PersistedAskMessage | undefined;
    for (let i = assistantIdx - 1; i >= 0; i--) {
      if (list[i].role === 'user') {
        user = list[i];
        break;
      }
    }
    if (!user) return null;

    // 必须是「我们刚发的这一轮」，且 assistant 不是后端持久化的错误占位（"Error: ..."）。
    if (user.content.trim() !== sentContent.trim()) return null;
    if (!assistant.content || assistant.content.startsWith('Error:'))
      return null;

    return {
      ok: true,
      userMessage: {
        id: user.id,
        content: user.content,
        createdAt: user.createdAt,
        modelId: user.modelId ?? undefined,
        modelName: user.modelName ?? undefined,
      },
      assistantMessage: {
        id: assistant.id,
        content: assistant.content,
        createdAt: assistant.createdAt,
        modelId: assistant.modelId ?? undefined,
        modelName: assistant.modelName ?? undefined,
        tokens: assistant.tokens ?? 0,
      },
      ragSources: undefined,
      suggestedActions: undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 轮询对账：代理可能在「生成中途」就掐断，那一刻后端还没把回复写库，
 * 立刻去捞会捞空。后端在客户端断开后仍继续生成，回复要等生成完成才入库
 * （可能 10–40s），故需重试拉取——捞到即返回；超时仍无则放弃（交调用方报失败）。
 * 前几次间隔短（断在末尾的情况能秒回），之后每 3s 一次，总上限约 40s。
 */
/** 对账轮询参数（生产用默认；测试可注入小值避免真实等待）。 */
export interface ReconcileOptions {
  maxAttempts?: number;
  delayMs?: number;
}

async function reconcileAfterStreamCut(
  sessionId: string,
  token: string,
  sentContent: string,
  opts?: ReconcileOptions
): Promise<AskStreamSuccess | null> {
  const maxAttempts = opts?.maxAttempts ?? 15;
  const baseDelay = opts?.delayMs ?? 3000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const found = await tryReconcileOnce(sessionId, token, sentContent);
    if (found) return found;
    if (attempt < maxAttempts - 1) {
      await sleep(attempt < 3 ? Math.min(baseDelay, 1500) : baseDelay);
    }
  }
  return null;
}

/**
 * 发起 SSE 流式发送消息。
 *
 * 返回 discriminated union：
 * - { ok: true, ... }：流式成功（含 done event）
 * - { ok: false, error, partialContent? }：流式失败，caller 可把错误作为 inline
 *   bubble 渲染到聊天区，避免"thinking 几秒后消失 → 用户以为被登出"的 UX 黑洞。
 */
export async function streamAskMessage(
  sessionId: string,
  token: string,
  body: AskStreamRequestBody,
  onChunk?: AskOnChunk,
  onStatusOrReconcile?: AskOnStatus | ReconcileOptions,
  reconcileOptions?: ReconcileOptions
): Promise<AskStreamResult> {
  const onStatus =
    typeof onStatusOrReconcile === 'function' ? onStatusOrReconcile : undefined;
  const effectiveReconcileOptions =
    typeof onStatusOrReconcile === 'function'
      ? reconcileOptions
      : onStatusOrReconcile;
  try {
    const response = await fetch(
      `${config.apiUrl}/ask/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok || !response.body) {
      const errorData = await response.json().catch(() => ({}));
      logger.error('[AiAsk] Failed to start stream:', {
        status: response.status,
        error: errorData,
      });
      return {
        ok: false,
        status: response.status,
        error: networkErrorMessage(response.status, errorData),
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = '';
    let ragSources: AskRagSource[] | undefined;
    let donePayload: DoneEvent | null = null;
    let errorEvent: StreamErrorEvent | null = null;
    let sawDone = false;

    const handleEvent = (event: SseEvent): void => {
      if (event.type === 'status') {
        onStatus?.(event.stage);
      } else if (event.type === 'sources') {
        ragSources = event.sources;
      } else if (event.type === 'chunk') {
        accumulatedContent += event.content;
        onChunk?.(accumulatedContent, ragSources);
      } else if (event.type === 'done') {
        sawDone = true;
        donePayload = event;
        if (event.fullContent) accumulatedContent = event.fullContent;
      } else if (event.type === 'error') {
        errorEvent = event;
      }
    };

    const consumeBufferedEvents = (chunks: readonly string[]): void => {
      for (const raw of chunks) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          handleEvent(JSON.parse(payload) as SseEvent);
        } catch (parseErr) {
          logger.warn('[AiAsk] Failed to parse SSE event:', parseErr);
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          consumeBufferedEvents([buffer]);
          buffer = '';
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      consumeBufferedEvents(events);
    }

    const streamError = errorEvent as StreamErrorEvent | null;
    if (streamError && (!sawDone || !donePayload)) {
      const byokCode = inferByokCode(streamError.code, streamError.message);
      if (byokCode) {
        const { publishByokError } = await import('@/lib/byok/event-bus');
        publishByokError({
          code: byokCode,
          message: streamError.message,
          details: {
            meta: streamError.meta ?? {},
          },
        });
      }
      logger.error('[AiAsk] Stream error:', streamError.message);
      return {
        ok: false,
        error: streamError.message,
        partialContent: accumulatedContent || undefined,
        status: streamError.meta?.status,
        byok: Boolean(byokCode),
      };
    }

    if (!sawDone || !donePayload) {
      // 流被中途掐断（最常见：客户端经代理上网，代理缓冲/超时掐断 SSE 长连接）。
      // 后端生成器仍已跑完并持久化 → 回捞最新消息对账，捞到本轮回复即按成功返回。
      const reconciled = await reconcileAfterStreamCut(
        sessionId,
        token,
        body.content,
        effectiveReconcileOptions
      );
      if (reconciled) return reconciled;
      return {
        ok: false,
        error: '流式响应意外中断，未收到完成事件。',
        partialContent: accumulatedContent || undefined,
      };
    }
    const finalDone = donePayload as DoneEvent;

    return {
      ok: true,
      userMessage: finalDone.userMessage,
      assistantMessage: {
        ...finalDone.assistantMessage,
        content: finalDone.assistantMessage.content ?? accumulatedContent,
        tokens: finalDone.tokensUsed,
      },
      ragSources,
      suggestedActions: undefined,
    };
  } catch (error) {
    logger.error('[AiAsk] streamAskMessage failed:', error);
    const msg = error instanceof Error ? error.message : '网络异常';
    return { ok: false, error: `网络中断：${msg}` };
  }
}
