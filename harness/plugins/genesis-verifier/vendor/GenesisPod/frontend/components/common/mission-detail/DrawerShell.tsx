'use client';

/**
 * DrawerShell — 右侧 slide-over drawer 外壳（playground 标杆样式）
 *
 * 视觉规范 mirror playground TodoDetailDrawer：
 *   backdrop: fixed inset-0 z-40 + bg-black/30 + backdrop-blur-[2px] + flex justify-end
 *   container: h-full max-w-2xl (default) + bg-gray-50 + border-l + shadow-2xl
 *
 * Domain 用法（playground / radar）：
 *   <DrawerShell open={!!todo} onClose={() => setTodo(null)}>
 *     {/* drawer 内容由 domain 自己渲染 *\/}
 *   </DrawerShell>
 *
 * 不在 Shell 内做的：
 *   - 关闭按钮（X 图标）由 children 自己渲染 — 因为位置与内容耦合（playground
 *     是 header 右侧、radar 是右上角），强行抽出会变难用
 *   - ESC 键关闭由 children 决定（playground 各自实现）
 */

import { useEffect } from 'react';
import { cn } from '@/lib/utils/common';

export interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 容器最大宽度，默认 max-w-2xl（playground TodoDetailDrawer 规格） */
  maxWidth?: string;
  /** 容器额外类名 */
  className?: string;
  /** 点击 backdrop 是否关闭，默认 true */
  closeOnBackdrop?: boolean;
}

export function DrawerShell({
  open,
  onClose,
  children,
  maxWidth = 'max-w-2xl',
  className,
  closeOnBackdrop = true,
}: DrawerShellProps) {
  // ESC 关闭
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
      className="fixed inset-0 z-40 flex justify-end bg-black/30 backdrop-blur-[2px]"
      onClick={closeOnBackdrop ? onClose : undefined}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={cn(
          'flex h-full w-full flex-col overflow-hidden border-l border-gray-200 bg-gray-50 shadow-2xl',
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
