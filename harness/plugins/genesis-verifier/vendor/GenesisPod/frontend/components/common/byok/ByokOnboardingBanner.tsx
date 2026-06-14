'use client';

/**
 * ByokOnboardingBanner — 首页顶部引导横幅
 *
 * 跟已有 ByokOnboardingGuard（强制跳 /me/api-keys）互补：
 * Guard 拦新用户（<7 天 + 未完成引导）；此 Banner 是"温和提示"：
 * 已老用户但没 key 的人 / dismiss 过 onboarding 的人 / 删过 key 又来的人。
 *
 * 行为：
 * - 未配置 API Key → 显示黄色横幅 + "去配置" 按钮
 * - 用户可关闭（localStorage 记 dismiss，30 天内不再弹）
 * - 配置了至少一个 provider 自动消失
 */

import { AlertCircle, ArrowRight, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useByokStatus } from '@/hooks/features';

export function ByokOnboardingBanner() {
  const router = useRouter();
  const { shouldShowBanner, status, dismissBanner } = useByokStatus();

  if (!shouldShowBanner || !status) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30 md:items-center">
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400 md:mt-0" />
      <div className="flex-1 text-sm text-amber-900 dark:text-amber-200">
        <span className="font-medium">尚未配置 AI API Key</span>
        <span className="ml-1 text-amber-700 dark:text-amber-300/80">
          — 所有 AI 功能（研究 / 写作 / 问答等）暂时无法使用。粘贴一次 Key
          即可解锁全部功能。
        </span>
      </div>
      <button
        onClick={() => router.push('/me/api-keys')}
        className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
      >
        去配置
        <ArrowRight className="h-3 w-3" />
      </button>
      <button
        onClick={dismissBanner}
        aria-label="关闭提示（30 天内不再显示）"
        className="flex-shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
