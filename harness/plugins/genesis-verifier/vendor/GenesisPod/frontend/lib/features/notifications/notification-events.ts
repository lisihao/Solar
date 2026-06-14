/**
 * Notification mutation event bus
 *
 * 跨组件协调：用户在 /notifications 页面 markRead/markAllRead/delete 后，
 * Sidebar bell badge 必须立即刷新 unread count，但二者在不同组件树，
 * useApiGet 的本地 cache 不会自动失效。
 *
 * Why EventTarget 而非 Zustand/Redux：
 *   - 单一信号语义，无需共享状态
 *   - 模块级 lazy singleton，SSR 安全
 *   - 0 依赖
 */

let target: EventTarget | null = null;

function getTarget(): EventTarget | null {
  if (typeof window === 'undefined') return null;
  if (!target) target = new EventTarget();
  return target;
}

const NOTIFICATION_MUTATED = 'notification:mutated';

export function emitNotificationMutated(): void {
  getTarget()?.dispatchEvent(new Event(NOTIFICATION_MUTATED));
}

export function onNotificationMutated(listener: () => void): () => void {
  const t = getTarget();
  if (!t) return () => {};
  t.addEventListener(NOTIFICATION_MUTATED, listener);
  return () => t.removeEventListener(NOTIFICATION_MUTATED, listener);
}
