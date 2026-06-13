'use client';

import { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { lockBodyScroll, unlockBodyScroll } from './bodyScrollLock';
import { useFocusTrap } from './useFocusTrap';

type DrawerSize = 'sm' | 'md' | 'lg';
type DrawerSide = 'right' | 'left';

interface AdminDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  side?: DrawerSide;
  size?: DrawerSize;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const SIZE_CLASSES: Record<DrawerSize, string> = {
  sm: 'w-full sm:w-96',
  md: 'w-full sm:w-[480px]',
  lg: 'w-full sm:w-[640px]',
};

const SIDE_CLASSES: Record<DrawerSide, string> = {
  right: 'right-0',
  left: 'left-0',
};

/**
 * AdminDrawer — Side-sliding drawer per standards/20-admin-ui-design.md.
 *
 * Used for row-level edit / detail panes (e.g. user profile / permissions / credits
 * triggered from a user table row). Body scroll locked; ESC closes.
 */
export default function AdminDrawer({
  open,
  onClose,
  title,
  description,
  side = 'right',
  size = 'md',
  footer,
  children,
  className,
}: AdminDrawerProps) {
  const titleId = useId();
  const dialogRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    // Use module-level counter so nested dialogs don't clobber each other's scroll lock
    lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', handleEsc);
      unlockBodyScroll();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        className={cn(
          'absolute top-0 flex h-full flex-col bg-white shadow-xl transition-transform duration-300 ease-out',
          SIDE_CLASSES[side],
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
