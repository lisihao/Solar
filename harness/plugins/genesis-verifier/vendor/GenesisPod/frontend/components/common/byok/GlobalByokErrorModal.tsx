'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { ByokErrorCard } from './ByokErrorCard';
import { subscribeByokError } from '@/lib/byok/event-bus';
import type { ByokErrorPayload } from '@/lib/byok/errors';

/**
 * 全局 BYOK 错误 Modal：监听 apiClient 发出的 'byok:error' 事件，
 * 弹出引导页面（配置 Key / 申请 Key / 续期等）。
 *
 * 放在 Providers 内部一次即可，整个应用共享。避免每个页面重复写
 * 「AI 调用失败 → 显示 ByokErrorCard」的样板。
 */
export function GlobalByokErrorModal() {
  const [payload, setPayload] = useState<ByokErrorPayload | null>(null);

  useEffect(() => {
    return subscribeByokError((p) => {
      setPayload(p);
    });
  }, []);

  if (!payload) return null;

  return (
    <Modal
      open
      onClose={() => setPayload(null)}
      size="md"
      title="AI 调用被拦截"
      subtitle="请按提示操作后重试"
    >
      <ByokErrorCard error={toApiErrorShape(payload)} />
    </Modal>
  );
}

/**
 * 把事件总线上的 payload 反包成 ApiError shape 让 ByokErrorCard 可解析。
 * parseByokError 会认 `{ code, message, details.meta }` 结构。
 */
function toApiErrorShape(payload: ByokErrorPayload) {
  return {
    code: payload.code,
    message: payload.message,
    details: { meta: payload.meta },
  };
}
