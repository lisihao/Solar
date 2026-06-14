'use client';

/**
 * MissionDialogShell
 *
 * AI App 创建 Mission 对话框的统一外壳：modal 头部 / 必填区 / 可折叠 advanced /
 * 底部按钮。视觉对齐 Topic Insight CreateTopicDialog —— light-only、无渐变 hero、
 * 业务气质。各 App 只负责往 primary / advanced slot 里塞自己的字段。
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';

export interface MissionDialogShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** 必填字段区（话题、深度等核心选项） */
  primary: ReactNode;
  /** 可折叠的高级配置区（频率、时效、可见性等） */
  advanced?: ReactNode;
  advancedLabel?: string;
  /** 是否默认展开 advanced；通常在用户已自定义任意值时为 true */
  defaultAdvancedOpen?: boolean;
  /** 错误提示，红色条出现在 footer 上方 */
  error?: string | null;
  /** 左下角槽位（例如"返回上一步"或"恢复默认配置"） */
  footerLeftSlot?: ReactNode;
  cancelLabel?: string;
  submitLabel: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  onSubmit: () => void;
}

export function MissionDialogShell({
  isOpen,
  onClose,
  title,
  subtitle,
  primary,
  advanced,
  advancedLabel = '高级设置',
  defaultAdvancedOpen = false,
  error,
  footerLeftSlot,
  cancelLabel = '取消',
  submitLabel,
  submitting = false,
  submitDisabled = false,
  onSubmit,
}: MissionDialogShellProps) {
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen);

  useEffect(() => {
    if (isOpen) setAdvancedOpen(defaultAdvancedOpen);
  }, [isOpen, defaultAdvancedOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!submitting && !submitDisabled) onSubmit();
          }}
        >
          <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-4">
            {primary}

            {advanced && (
              <div className="border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex w-full items-center justify-between py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  <span>{advancedLabel}</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {advancedOpen && (
                  <div className="mt-3 space-y-3">{advanced}</div>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
            <div>{footerLeftSlot}</div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                {cancelLabel}
              </button>
              <button
                type="submit"
                disabled={submitDisabled || submitting}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
