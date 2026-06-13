'use client';

import React, {
  Component,
  ErrorInfo,
  ReactNode,
  useEffect,
  useCallback,
} from 'react';
import { X } from 'lucide-react';

// Minimal inline ErrorBoundary — no new dependencies
interface EBState {
  hasError: boolean;
}
class DrawerErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): EBState {
    return { hasError: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // 静默吞错 — 让 fallback UI 接管；上层应用如需上报错误，
    // 在 children 内自行包 ErrorBoundary（避免 common 组件强耦合 logger）
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-sm text-red-600">
          内容加载出错，请关闭后重试。
        </div>
      );
    }
    return this.props.children;
  }
}

interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** default 400 */
  widthPx?: number;
}

export function SideDrawer({
  open,
  onClose,
  title,
  children,
  widthPx = 400,
}: SideDrawerProps) {
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, handleEsc]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="close drawer"
        data-testid="drawer-backdrop"
      />

      {/* Panel — full-screen on sm, fixed-width on md+ */}
      <div
        className="relative z-10 flex w-full flex-col bg-white shadow-xl sm:h-full sm:max-h-screen sm:overflow-y-auto md:w-auto"
        style={{ ['--drawer-w' as string]: `${widthPx}px` }}
      >
        {/* Use inline style for width on md+; on sm it's w-full above */}
        <div className="flex h-full w-full flex-col md:w-[var(--drawer-w)]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            {title ? (
              <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            ) : (
              <span />
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              aria-label="close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            <DrawerErrorBoundary>{children}</DrawerErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}
