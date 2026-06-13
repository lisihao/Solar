'use client';

/**
 * ModalShell — 居中 modal 外壳（playground 标杆样式）
 *
 * 视觉规范 mirror playground TeamMissionModal：
 *   backdrop: fixed inset-0 z-50 + bg-black/40 + backdrop-blur-sm + p-4 + flex items-center justify-center
 *   container: max-h-[90vh] max-w-5xl (default) + rounded-2xl + bg-white + border + shadow-2xl
 */

import { useEffect } from 'react';
import { cn } from '@/lib/utils/common';

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 容器最大宽度，默认 max-w-5xl（playground TeamMissionModal 规格） */
  maxWidth?: string;
  /** 容器额外类名 */
  className?: string;
  /** 点击 backdrop 是否关闭，默认 true */
  closeOnBackdrop?: boolean;
}

export function ModalShell({
  open,
  onClose,
  children,
  maxWidth = 'max-w-5xl',
  className,
  closeOnBackdrop = true,
}: ModalShellProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={closeOnBackdrop ? onClose : undefined}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={cn(
          'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl',
          maxWidth,
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
