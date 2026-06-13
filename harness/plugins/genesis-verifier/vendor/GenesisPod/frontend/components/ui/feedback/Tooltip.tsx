'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

interface TooltipProps {
  children: React.ReactElement;
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delayDuration?: number;
  sideOffset?: number;
  disabled?: boolean;
}

/**
 * Tooltip Component
 *
 * A customizable tooltip wrapper using Radix UI.
 *
 * @example
 * ```tsx
 * <Tooltip content="刷新列表">
 *   <button>
 *     <RefreshCw className="h-4 w-4" />
 *   </button>
 * </Tooltip>
 * ```
 *
 * @param children - The element to attach the tooltip to (must accept ref)
 * @param content - The tooltip content (string or React node)
 * @param side - Preferred side to display tooltip (default: 'top')
 * @param align - Alignment of tooltip (default: 'center')
 * @param delayDuration - Delay before showing tooltip in ms (default: 300)
 * @param sideOffset - Distance from trigger in pixels (default: 4)
 * @param disabled - Disable tooltip (default: false)
 */
export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  delayDuration = 300,
  sideOffset = 4,
  disabled = false,
}: TooltipProps) {
  if (disabled || !content) {
    return children;
  }

  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            className="animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 overflow-hidden rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white shadow-lg"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-gray-900" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
