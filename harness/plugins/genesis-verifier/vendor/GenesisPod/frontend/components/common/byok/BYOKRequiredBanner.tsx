/**
 * BYOKRequiredBanner
 *
 * 提示用户配置 BYOK API Key 的 banner。
 *
 * 用法：
 *   const { models } = useAIModels();
 *   const needBYOK = !userHasBYOK(models) && models.length > 0;
 *   return (
 *     <>
 *       {needBYOK && <BYOKRequiredBanner />}
 *       <AIModelDropdown ... />
 *     </>
 *   );
 *
 * 设计约束：
 *   - 严格 BYOK 模式下（commit 0635c70d9），没配 BYOK 的用户发消息必然报错
 *   - 项目核心团队主要用中文，文案中文写死；用 modelLabelSuffix 同款 t? 模式
 *     可后续逐步切到 i18n（key: common.byokRequired.{title,desc,cta}）
 *   - CTA deeplink 到 /me/api-keys（profile 已迁移到那里）
 */
'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

interface BYOKRequiredBannerProps {
  /** 自定义 className 覆盖外层样式 */
  className?: string;
  /** 自定义跳转目标，默认 /me/api-keys */
  configHref?: string;
  /** 紧凑模式（窄面板用，单行） */
  compact?: boolean;
}

export function BYOKRequiredBanner({
  className = '',
  configHref = '/me/api-keys',
  compact = false,
}: BYOKRequiredBannerProps) {
  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 ${className}`}
        role="alert"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span className="flex-1 truncate">
          您未配置 BYOK API Key，发送消息会失败
        </span>
        <Link
          href={configHref}
          className="shrink-0 rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-700"
        >
          去配置
        </Link>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50 p-3 ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-amber-900">
            请先配置 BYOK API Key
          </div>
          <p className="mt-1 text-xs text-amber-800">
            当前没有可用的 API Key。dropdown
            里的系统模型仅供展示，发送消息时会因 没有可用 Key
            失败。请前往设置配置至少一个 provider 的 Key。
          </p>
          <Link
            href={configHref}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-amber-700"
          >
            去配置 BYOK
          </Link>
        </div>
      </div>
    </div>
  );
}
