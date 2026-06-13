'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/common';

/**
 * Modal 组件变体配置
 */
const modalVariants = cva(
  // 圆角对齐 design token 上限（radius.lg = rounded-xl=12px）；token 无 2xl，
  // 之前的 rounded-2xl(16px) 超档导致弹层比卡片更圆、不匹配整体风格。
  'flex max-h-[90vh] flex-col rounded-xl bg-white shadow-2xl',
  {
    variants: {
      size: {
        sm: 'w-full max-w-md',
        md: 'w-full max-w-lg',
        lg: 'w-full max-w-2xl',
        xl: 'w-full max-w-3xl',
        '2xl': 'w-full max-w-4xl',
        full: 'w-full max-w-[90vw]',
      },
    },
    defaultVariants: {
      size: 'lg',
    },
  }
);

/**
 * Modal 组件属性
 */
export interface ModalProps extends VariantProps<typeof modalVariants> {
  /** 是否显示模态框 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 标题 */
  title: React.ReactNode;
  /** 副标题（可选） */
  subtitle?: React.ReactNode;
  /** 模态框内容 */
  children: React.ReactNode;
  /** 底部按钮区域（可选） */
  footer?: React.ReactNode;
  /** 是否显示关闭按钮，默认 true */
  showCloseButton?: boolean;
  /** 关闭按钮是否禁用 */
  closeButtonDisabled?: boolean;
  /** 点击遮罩是否关闭，默认 true */
  closeOnOverlayClick?: boolean;
  /** 按 ESC 是否关闭，默认 true */
  closeOnEscape?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 内容区域自定义类名 */
  contentClassName?: string;
  /** 头部自定义类名 */
  headerClassName?: string;
  /** 底部自定义类名 */
  footerClassName?: string;
}

/**
 * 通用模态框组件
 *
 * 特性：
 * - 固定头部和底部，内容区域可滚动
 * - 最大高度 90vh，自动适应内容
 * - 支持多种预设尺寸
 * - 支持点击遮罩关闭
 * - 支持 ESC 键关闭
 * - 支持自定义头部、内容、底部
 * - 动画过渡效果
 *
 * @example
 * ```tsx
 * <Modal
 *   open={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   title="Modal Title"
 *   subtitle="Optional subtitle"
 *   size="lg"
 *   footer={
 *     <>
 *       <Button variant="outline" onClick={handleCancel}>Cancel</Button>
 *       <Button onClick={handleSubmit}>Submit</Button>
 *     </>
 *   }
 * >
 *   <p>Modal content goes here</p>
 * </Modal>
 * ```
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size,
  showCloseButton = true,
  closeButtonDisabled = false,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className,
  contentClassName,
  headerClassName,
  footerClassName,
}: ModalProps) {
  // ESC 键关闭
  React.useEffect(() => {
    if (!open || !closeOnEscape) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeButtonDisabled) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, closeOnEscape, closeButtonDisabled, onClose]);

  // 阻止背景滚动
  React.useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  // 处理遮罩点击
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (
      e.target === e.currentTarget &&
      closeOnOverlayClick &&
      !closeButtonDisabled
    ) {
      onClose();
    }
  };

  // SSR 安全：首次 render 时 document 不存在；用 mounted 标志把 portal 推到 client 侧
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  // Portal 到 document.body —— 避开任何带 transform / backdrop-filter 的祖先
  // （例如 AdminPageLayout 的 sticky header 用了 backdrop-blur-sm，会把 fixed 后代困在其内部）
  return createPortal(
    <div
      className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 duration-200"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className={cn(
          modalVariants({ size }),
          'animate-in fade-in zoom-in-95 duration-200',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            'flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4',
            headerClassName
          )}
        >
          <div className="min-w-0 flex-1">
            <h3
              id="modal-title"
              className="truncate text-lg font-semibold text-gray-900"
            >
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 truncate text-sm text-gray-500">
                {subtitle}
              </p>
            )}
          </div>
          {showCloseButton && (
            <button
              onClick={onClose}
              disabled={closeButtonDisabled}
              className="ml-4 flex-shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className={cn('flex-1 overflow-y-auto p-6', contentClassName)}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            className={cn(
              'flex flex-shrink-0 items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4',
              footerClassName
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/**
 * Modal.Header - 用于自定义头部内容（替代 title/subtitle）
 */
Modal.Header = function ModalHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4',
        className
      )}
    >
      {children}
    </div>
  );
};

/**
 * Modal.Content - 用于自定义内容区域
 */
Modal.Content = function ModalContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex-1 overflow-y-auto p-6', className)}>
      {children}
    </div>
  );
};

/**
 * Modal.Footer - 用于自定义底部区域
 */
Modal.Footer = function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-shrink-0 items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4',
        className
      )}
    >
      {children}
    </div>
  );
};

export default Modal;
