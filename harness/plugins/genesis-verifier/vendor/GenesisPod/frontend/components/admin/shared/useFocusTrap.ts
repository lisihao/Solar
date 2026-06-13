'use client';

import { useEffect, useRef } from 'react';

/**
 * Focus trap for modal-like containers.
 *
 * When `open` becomes true:
 *  - 记住当前 focused element (open 前的)
 *  - 把焦点移到容器内第一个可聚焦元素
 *  - 拦截 Tab/Shift+Tab，循环在第一/最后一个可聚焦元素之间
 *
 * When `open` becomes false:
 *  - 把焦点恢复到 open 前的元素
 *
 * Per standards/20-admin-ui-design.md a11y 要求，AdminModal/AdminDrawer 必须支持
 * focus trap，避免 Tab 键逃出 dialog。
 */
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  open: boolean
) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus first focusable element on open
    const initialFocusables =
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
    if (initialFocusables.length > 0) {
      // Defer focus to next tick so transition animations don't fight us
      requestAnimationFrame(() => {
        initialFocusables[0]?.focus?.();
      });
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables =
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // Restore focus on close — guard against null/disconnected nodes
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus?.();
      }
    };
  }, [open]);

  return containerRef;
}
