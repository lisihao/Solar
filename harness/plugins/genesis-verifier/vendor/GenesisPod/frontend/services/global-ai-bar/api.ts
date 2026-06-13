/**
 * Global AI Bar — Quick Ask API helper
 *
 * 为 AI Bar 的内联问答模式提供简化的会话创建 + 消息发送封装。
 * 不支持 SSE，使用普通 JSON 响应（sendMessage 本身非流式）。
 */

import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

export interface QuickAskResult {
  /** AI 回答内容 */
  answer: string;
  /** 创建的会话 ID（用于"继续对话"跳转） */
  sessionId: string;
}

/**
 * 在 AI Bar 中执行单次快速问答
 * 内部流程：create session → send message → return assistant content
 */
export async function sendQuickAsk(query: string): Promise<QuickAskResult> {
  const headers: Record<string, string> = {
    ...getAuthHeader(),
    'Content-Type': 'application/json',
  };
  const apiUrl = config.apiUrl;

  // 1. Create a session
  const sessionRes = await fetch(`${apiUrl}/ask/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: query.slice(0, 80) }),
  });
  if (!sessionRes.ok) {
    throw new Error(`Session creation failed (${sessionRes.status})`);
  }
  const sessionJson = await sessionRes.json();
  const sessionId = (sessionJson?.data?.id ?? sessionJson?.id) as
    | string
    | undefined;
  if (!sessionId) throw new Error('No session ID in response');

  // 2. Send the user message
  const msgRes = await fetch(`${apiUrl}/ask/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: query }),
  });
  if (!msgRes.ok) {
    // Best-effort cleanup of the orphaned session
    fetch(`${apiUrl}/ask/sessions/${sessionId}`, {
      method: 'DELETE',
      headers,
    }).catch(() => {});
    throw new Error(`Message send failed (${msgRes.status})`);
  }
  const msgJson = await msgRes.json();

  // Extract assistant content from the response shape:
  // { userMessage, assistantMessage: { content, ... }, ... }
  const data = (msgJson?.data ?? msgJson) as Record<string, unknown>;
  const assistantMsg = data?.assistantMessage as
    | { content?: string }
    | undefined;
  const answer = assistantMsg?.content ?? '';

  return { answer, sessionId };
}
