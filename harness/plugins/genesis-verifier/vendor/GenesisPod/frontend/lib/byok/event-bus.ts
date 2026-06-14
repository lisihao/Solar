import type { ByokErrorPayload } from './errors';
import { parseByokError } from './errors';

const EVENT_NAME = 'byok:error';

/**
 * 发布 BYOK 错误事件。apiClient 在 catch 里调用，
 * 全局 Modal 组件监听并展示引导卡片。
 *
 * 只有能解析为 ByokErrorPayload 的错误才会发布；其他错误交给调用方
 * 自己用 toast/UI 处理。
 */
export function publishByokError(error: unknown): ByokErrorPayload | null {
  if (typeof window === 'undefined') return null;
  const payload = parseByokError(error);
  if (!payload) return null;
  window.dispatchEvent(
    new CustomEvent<ByokErrorPayload>(EVENT_NAME, { detail: payload })
  );
  return payload;
}

export function subscribeByokError(
  handler: (payload: ByokErrorPayload) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const custom = event as CustomEvent<ByokErrorPayload>;
    if (custom.detail) handler(custom.detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
