/**
 * 对话式整理 SSE 客户端（ADR-006 P2）
 *
 * 消费 backend POST /library/organize-chat/stream 的 SSE 帧，逐条回调给 UI
 * 渲染工具动作卡 + 总结。复用 ai-ask-stream 的代理掐断对账范式：流被代理/网络
 * 中途掐断（未收到 done）时，轮询 GET 最近消息回捞已持久化的助手回复。
 */
import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

/** 一条工具动作的可读明细（与后端 OrganizeToolAction 同形）*/
export interface OrganizeToolAction {
  tool: string;
  detail: string;
}

export type OrganizeStreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'status'; stage: 'planning' }
  | {
      type: 'tool';
      phase: 'call' | 'result';
      tool: string;
      data?: unknown;
      /** result 阶段带可读明细，前端直接渲染 */
      detail?: string;
    }
  | { type: 'chunk'; content: string }
  | {
      type: 'done';
      sessionId: string;
      assistantMessageId: string;
      tokensUsed: number;
      summary: string;
      /** 本轮全部写动作明细（权威列表；代理掉事件时以此为准）*/
      toolActions?: OrganizeToolAction[];
    }
  | { type: 'error'; message: string };

export interface OrganizeStreamRequestBody {
  message: string;
  scope?: 'BOOKMARKS' | 'NOTES' | 'EXTERNAL';
  /** 精确数据源类型（数据源统一整理）：驱动后端跨源整理工具流 */
  itemType?: 'BOOKMARK' | 'NOTE' | 'IMAGE' | 'FEISHU' | 'NOTION' | 'DRIVE';
  sessionId?: string;
  collectionId?: string;
  modelId?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export type OrganizeStreamResult =
  | {
      ok: true;
      sessionId: string;
      summary: string;
      tokensUsed: number;
      /** 本轮写动作明细；代理掐断后由对账从持久化消息回捞 */
      toolActions?: OrganizeToolAction[];
    }
  | { ok: false; error: string; partialSummary?: string };

export interface OrganizeReconcileOptions {
  maxAttempts?: number;
  delayMs?: number;
}

type OrganizeOnEvent = (event: OrganizeStreamEvent) => void;

interface OrganizeMessageRow {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  toolActions?: OrganizeToolAction[] | null;
}

/** 安全解析持久化的 toolActions JSON（只保留形状对的项）*/
function parseToolActions(raw: unknown): OrganizeToolAction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const actions = raw.filter(
    (a): a is OrganizeToolAction =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as OrganizeToolAction).tool === 'string' &&
      typeof (a as OrganizeToolAction).detail === 'string'
  );
  return actions.length > 0 ? actions : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tryReconcileOnce(
  sessionId: string,
  token: string,
  sinceMs: number
): Promise<OrganizeStreamResult | null> {
  try {
    const res = await fetch(
      `${config.apiUrl}/library/organize-chat/sessions/${sessionId}/messages?limit=6`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as OrganizeMessageRow[];
    // rows 按 createdAt desc；找本轮（sinceMs 之后）最新的助手消息
    const skew = 5000;
    const reply = rows.find(
      (m) =>
        m.role === 'assistant' &&
        m.content &&
        new Date(m.createdAt).getTime() >= sinceMs - skew
    );
    if (!reply) return null;
    return {
      ok: true,
      sessionId,
      summary: reply.content,
      tokensUsed: 0,
      toolActions: parseToolActions(reply.toolActions),
    };
  } catch {
    return null;
  }
}

async function reconcileAfterStreamCut(
  sessionId: string,
  token: string,
  sinceMs: number,
  opts?: OrganizeReconcileOptions
): Promise<OrganizeStreamResult | null> {
  const maxAttempts = opts?.maxAttempts ?? 15;
  const baseDelay = opts?.delayMs ?? 3000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const found = await tryReconcileOnce(sessionId, token, sinceMs);
    if (found) return found;
    if (attempt < maxAttempts - 1) {
      await sleep(attempt < 3 ? Math.min(baseDelay, 1500) : baseDelay);
    }
  }
  return null;
}

/**
 * 发起对话整理 SSE。每个 SSE 事件经 onEvent 回调（UI 渲染工具动作卡）；
 * 返回成功/失败的 discriminated union（失败带 partialSummary 供 inline 渲染）。
 */
export async function streamOrganizeMessage(
  token: string,
  body: OrganizeStreamRequestBody,
  onEvent?: OrganizeOnEvent,
  reconcileOptions?: OrganizeReconcileOptions
): Promise<OrganizeStreamResult> {
  const sinceMs = Date.now();
  let sessionId = body.sessionId ?? '';
  let summary = '';
  let sawDone = false;
  let doneResult: OrganizeStreamResult | null = null;
  let errorMsg: string | null = null;

  try {
    const response = await fetch(
      `${config.apiUrl}/library/organize-chat/stream`,
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
      logger.error('[Organize] failed to start stream:', {
        status: response.status,
        error: errorData,
      });
      return { ok: false, error: `请求失败（${response.status}）` };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleEvent = (event: OrganizeStreamEvent): void => {
      if (event.type === 'session') sessionId = event.sessionId;
      else if (event.type === 'chunk') summary += event.content;
      else if (event.type === 'done') {
        sawDone = true;
        summary = event.summary || summary;
        doneResult = {
          ok: true,
          sessionId: event.sessionId,
          summary,
          tokensUsed: event.tokensUsed,
          toolActions: event.toolActions,
        };
      } else if (event.type === 'error') {
        errorMsg = event.message;
      }
      onEvent?.(event);
    };

    const consume = (chunks: readonly string[]): void => {
      for (const raw of chunks) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          handleEvent(JSON.parse(payload) as OrganizeStreamEvent);
        } catch (parseErr) {
          logger.warn('[Organize] failed to parse SSE event:', parseErr);
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) consume([buffer]);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      consume(events);
    }

    if (errorMsg && !sawDone) {
      return {
        ok: false,
        error: errorMsg,
        partialSummary: summary || undefined,
      };
    }

    if (sawDone && doneResult) return doneResult;

    // 未收到 done：代理掐断 → 回捞对账
    if (sessionId) {
      const reconciled = await reconcileAfterStreamCut(
        sessionId,
        token,
        sinceMs,
        reconcileOptions
      );
      if (reconciled) return reconciled;
    }
    return {
      ok: false,
      error: '整理流意外中断，未收到完成事件。',
      partialSummary: summary || undefined,
    };
  } catch (error) {
    logger.error('[Organize] streamOrganizeMessage failed:', error);
    const msg = error instanceof Error ? error.message : '网络异常';
    return { ok: false, error: `网络中断：${msg}` };
  }
}
