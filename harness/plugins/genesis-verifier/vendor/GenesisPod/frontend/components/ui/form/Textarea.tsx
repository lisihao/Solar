import { forwardRef } from 'react';
import { cn } from '@/lib/utils/common';

/**
 * Textarea — 统一多行输入 primitive，与 Input 同视觉规范。
 */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, error, rows = 3, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500',
          error
            ? 'border-red-400 focus:ring-red-400'
            : 'border-gray-300 focus:border-primary focus:ring-primary',
          className
        )}
        {...props}
      />
    );
  }
);
