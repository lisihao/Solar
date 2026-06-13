import { forwardRef } from 'react';
import { cn } from '@/lib/utils/common';

/**
 * Input — 统一文本输入 primitive。取代散落的
 * `w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 ...`。
 * 透传所有原生 input 属性 + forwardRef（兼容表单库）。error 态加红边/红环。
 */
export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size'
> {
  error?: boolean;
  inputSize?: 'sm' | 'md';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error, inputSize = 'md', ...props },
  ref
) {
  const pad =
    inputSize === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-3 py-2 text-sm';
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-lg border bg-white text-gray-900 transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500',
        pad,
        error
          ? 'border-red-400 focus:ring-red-400'
          : 'border-gray-300 focus:border-primary focus:ring-primary',
        className
      )}
      {...props}
    />
  );
});
