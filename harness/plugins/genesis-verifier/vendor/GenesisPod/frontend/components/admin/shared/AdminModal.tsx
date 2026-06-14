'use client';

import { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { lockBodyScroll, unlockBodyScroll } from './bodyScrollLock';
import { useFocusTrap } from './useFocusTrap';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface AdminModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Set to false to disable click-on-backdrop close */
  closeOnBackdrop?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * AdminModal — Centered modal per standards/20-admin-ui-design.md.
 *
 * Uses `rounded-xl` (NOT `rounded-2xl` — see admin-config-layout.skill DEPRECATED notice).
 * Body scroll locked when open; ESC closes.
 */
export default function AdminModal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  children,
  closeOnBackdrop = true,
  className,
}: AdminModalProps) {
  const titleId = useId();
  const dialogRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    // Use module-level counter so nested modals don't clobber each other's scroll lock
    lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', handleEsc);
      unlockBodyScroll();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        if (closeOnBackdrop) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        className={cn(
          'flex max-h-[90vh] w-full flex-col rounded-xl bg-white shadow-xl',
          SIZE_CLASSES[size],
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-sm text-gray-500">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-3 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {footer && (
          <div className="flex justify-end gap-3 border-t border-gray-200 bg-gray-50/50 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
