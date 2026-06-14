'use client';

/**
 * SharePermissionModal - 通用权限/可见性弹窗
 *
 * 设计目标：
 * - 抽出「可见性切换 + 链接复制 + 协作者插槽」的共用结构
 * - 可见性级别由调用方按 `levels` 配置（Writing/Research 用两态、Topic 用三态）
 * - 协作者管理逻辑差异大（PENDING/ACCEPTED/邀请等），通过 `collaboratorsSlot` 注入
 *
 * 不在平台层做的：
 * - 调后端 API（onVisibilityChange / onCopyLink 由调用方实现）
 * - 协作者邀请/审批的具体 UI（业务差异大，由 slot 接管）
 */

import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { cn } from '@/lib/utils/common';
import type { AssetVisibility } from '@/components/ui/cards/asset-card';

export interface SharePermissionLevel {
  value: AssetVisibility;
  label: string;
  description?: string;
  icon: ReactNode;
  /** 选中态颜色，如 "border-blue-500 bg-blue-50 text-blue-700" */
  activeClassName?: string;
}

export interface SharePermissionModalProps {
  open: boolean;
  onClose: () => void;
  /** 弹窗标题 */
  title: string;
  /** 弹窗副标题 */
  subtitle?: string;

  /** 当前可见性 */
  visibility: AssetVisibility;
  /** 可见性级别配置（顺序即展示顺序） */
  levels: SharePermissionLevel[];
  /** 切换可见性回调 */
  onVisibilityChange: (next: AssetVisibility) => Promise<void> | void;
  /** 是否禁用切换（如非所有者） */
  disabled?: boolean;

  /** 分享链接（不传则不渲染链接区） */
  shareUrl?: string;
  /** 复制链接回调，不传时使用 navigator.clipboard 默认实现 */
  onCopyLink?: (url: string) => Promise<void> | void;

  /** 协作者列表/邀请插槽（业务侧实现） */
  collaboratorsSlot?: ReactNode;

  /** i18n 文案 */
  labels?: {
    visibilitySection?: string;
    shareLinkSection?: string;
    collaboratorsSection?: string;
    copy?: string;
    copied?: string;
    close?: string;
  };
}

export function SharePermissionModal({
  open,
  onClose,
  title,
  subtitle,
  visibility,
  levels,
  onVisibilityChange,
  disabled = false,
  shareUrl,
  onCopyLink,
  collaboratorsSlot,
  labels,
}: SharePermissionModalProps) {
  const [copied, setCopied] = useState(false);
  const [pendingValue, setPendingValue] = useState<AssetVisibility | null>(
    null
  );

  const handleSelect = async (next: AssetVisibility) => {
    if (disabled || next === visibility || pendingValue) return;
    setPendingValue(next);
    try {
      await onVisibilityChange(next);
    } finally {
      setPendingValue(null);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      if (onCopyLink) {
        await onCopyLink(shareUrl);
      } else {
        await navigator.clipboard.writeText(shareUrl);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 复制失败时静默 —— 调用方可通过 onCopyLink 自定义错误处理
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="lg"
    >
      <div className="space-y-6">
        {/* Visibility Section */}
        <section>
          <h4 className="mb-3 text-sm font-semibold text-gray-700">
            {labels?.visibilitySection ?? 'Visibility'}
          </h4>
          <div className="space-y-2">
            {levels.map((level) => {
              const active = visibility === level.value;
              const isPending = pendingValue === level.value;
              return (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => {
                    void handleSelect(level.value);
                  }}
                  disabled={disabled || pendingValue !== null}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all',
                    active
                      ? (level.activeClassName ??
                          'border-violet-500 bg-violet-50')
                      : 'border-gray-200 bg-white hover:border-gray-300',
                    (disabled || (pendingValue && !isPending)) &&
                      'cursor-not-allowed opacity-60'
                  )}
                >
                  <span className="mt-0.5 flex-shrink-0">{level.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900">
                      {level.label}
                      {isPending && (
                        <span className="ml-2 text-xs text-gray-500">…</span>
                      )}
                    </span>
                    {level.description && (
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {level.description}
                      </span>
                    )}
                  </span>
                  {active && (
                    <Check className="h-5 w-5 flex-shrink-0 text-violet-600" />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Share Link Section */}
        {shareUrl && (
          <section>
            <h4 className="mb-3 text-sm font-semibold text-gray-700">
              {labels?.shareLinkSection ?? 'Share link'}
            </h4>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 bg-transparent px-2 text-sm text-gray-700 outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  void handleCopy();
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  copied
                    ? 'bg-green-100 text-green-700'
                    : 'bg-violet-600 text-white hover:bg-violet-700'
                )}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    {labels?.copied ?? 'Copied'}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    {labels?.copy ?? 'Copy'}
                  </>
                )}
              </button>
            </div>
          </section>
        )}

        {/* Collaborators Section */}
        {collaboratorsSlot && (
          <section>
            <h4 className="mb-3 text-sm font-semibold text-gray-700">
              {labels?.collaboratorsSection ?? 'Collaborators'}
            </h4>
            {collaboratorsSlot}
          </section>
        )}
      </div>
    </Modal>
  );
}
