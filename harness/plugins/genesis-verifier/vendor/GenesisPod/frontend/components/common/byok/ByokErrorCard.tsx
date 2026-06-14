'use client';

import Link from 'next/link';
import { AlertTriangle, Key, RefreshCw, Send } from 'lucide-react';
import {
  type ByokErrorPayload,
  formatUsd,
  parseByokError,
} from '@/lib/byok/errors';

interface Props {
  error: unknown;
  className?: string;
}

/**
 * 把 BYOK 错误渲染为一个包含 CTA 的卡片。非 BYOK 错误返回 null（由上层处理）。
 *
 * 典型用法：
 * ```tsx
 * const { error } = useSomeAiCall();
 * return <ByokErrorCard error={error} /> ?? <DefaultError />;
 * ```
 */
export function ByokErrorCard({ error, className }: Props) {
  const byok = parseByokError(error);
  if (!byok) return null;
  return <Card payload={byok} className={className} />;
}

function Card({
  payload,
  className,
}: {
  payload: ByokErrorPayload;
  className?: string;
}) {
  const provider = payload.meta.provider ?? '';
  const content = (() => {
    switch (payload.code) {
      case 'NO_AVAILABLE_KEY':
        return {
          title: `${labelProvider(provider)} 需要配置 API Key`,
          description:
            '你还没有配置这个 Provider 的 Key，也没有被分配任何 Key。',
          actions: (
            <div className="flex gap-2">
              <Link
                href="/me/api-keys"
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Key className="h-3.5 w-3.5" /> 去配置 Key
              </Link>
              <Link
                href="/me/api-keys"
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                <Send className="h-3.5 w-3.5" /> 向管理员申请
              </Link>
            </div>
          ),
        };

      case 'NO_MODEL_CONFIGURED': {
        const modelType = payload.meta.modelType ?? '该类型';
        return {
          title: `缺少 ${modelType} 模型配置`,
          description:
            '你的账号还没有配置这个类型的模型。请前往「AI 配置」添加——或一键 AI 配置自动生成。',
          actions: (
            <div className="flex gap-2">
              <Link
                href="/me/models"
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Key className="h-3.5 w-3.5" /> 去配置模型
              </Link>
            </div>
          ),
        };
      }

      case 'QUOTA_EXCEEDED': {
        const isUserScope =
          payload.meta.source === 'PERSONAL' ||
          payload.meta.source === 'ASSIGNED';
        const source = payload.meta.source;
        const providerMsg = payload.meta.providerMessage;
        const hasQuotaNumbers =
          typeof payload.meta.usedCents === 'number' &&
          typeof payload.meta.limitCents === 'number';

        let description: string;
        if (source === 'ASSIGNED' && hasQuotaNumbers) {
          description = `已用 ${formatUsd(payload.meta.usedCents)} / ${formatUsd(
            payload.meta.limitCents
          )}。请申请扩额，或配置你自己的 Key 继续使用。`;
        } else if (source === 'PERSONAL' && providerMsg) {
          // 用户自己的 Provider 账号返回的 429：通常是账单/tier 问题，
          // 直接展示 provider 的原文，避免用户误以为是 Genesis 的 bug
          description = `${labelProvider(provider)} 返回：${providerMsg}`;
        } else if (providerMsg) {
          description = providerMsg;
        } else {
          description = '配额已耗尽。请申请扩额或更新 Key。';
        }

        return {
          title: `${labelProvider(provider)} 配额已用完`,
          description,
          actions: isUserScope ? (
            <div className="flex gap-2">
              {source === 'ASSIGNED' && (
                <Link
                  href="/me/api-keys"
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Send className="h-3.5 w-3.5" /> 申请扩额
                </Link>
              )}
              <Link
                href="/me/api-keys"
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                <Key className="h-3.5 w-3.5" /> 打开 Key 管理
              </Link>
            </div>
          ) : null,
        };
      }

      case 'INVALID_API_KEY':
        return {
          title: `${labelProvider(provider)} Key 被拒绝`,
          description: payload.meta.providerMessage
            ? `${labelProvider(provider)} 返回：${payload.meta.providerMessage}`
            : '这个 Key 可能已被撤销或过期。请更新后再试。',
          actions: (
            <Link
              href="/me/api-keys"
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 更新 Key
            </Link>
          ),
        };

      case 'KEY_EXPIRED':
        return {
          title: `${labelProvider(provider)} 分配已过期`,
          description:
            '你的 Key 分配已过期，请联系管理员续期或使用自己的 Key。',
          actions: (
            <Link
              href="/me/api-keys"
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Send className="h-3.5 w-3.5" /> 申请续期
            </Link>
          ),
        };

      case 'NO_SYSTEM_KEY':
        return {
          title: `${labelProvider(provider)} 系统 Key 缺失`,
          description: '管理员尚未在 Secret Manager 中配置该 Provider 的 Key。',
          actions: null,
        };

      default:
        return {
          title: payload.message,
          description: '',
          actions: null,
        };
    }
  })();

  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50/50 p-4 ${
        className ?? ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1 space-y-2">
          <div>
            <div className="text-sm font-medium text-gray-900">
              {content.title}
            </div>
            {content.description && (
              <div className="mt-0.5 text-xs text-gray-600">
                {content.description}
              </div>
            )}
          </div>
          {content.actions}
        </div>
      </div>
    </div>
  );
}

function labelProvider(p: string): string {
  const map: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Claude',
    google: 'Gemini',
    xai: 'Grok',
    deepseek: 'DeepSeek',
    qwen: 'Qwen',
  };
  if (!p) return '该 Provider';
  return map[p.toLowerCase()] ?? p;
}
