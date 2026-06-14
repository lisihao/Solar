import { cn } from '@/lib/utils/common';

/**
 * ProgressBar — 通用进度条 primitive（track + fill）。
 *
 * 取代散落各处的内联 `rounded-full bg-gray-200` + `style={{width:'X%'}}` 进度条。
 * 纯展示、tone 驱动配色。slides 域的 KPI 进度（slide-tokens 渐变）与各 feature
 * 的复合进度面板保留各自实现，可按需在内部改用本 primitive。
 */
export type ProgressTone =
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral';

const FILL: Record<ProgressTone, string> = {
  primary: 'bg-primary',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  neutral: 'bg-gray-500',
};

export interface ProgressBarProps {
  /** 当前值 */
  value: number;
  /** 最大值，默认 100 */
  max?: number;
  /** 左侧标签 */
  label?: React.ReactNode;
  /** 右侧显示百分比 */
  showPercentage?: boolean;
  tone?: ProgressTone;
  size?: 'sm' | 'md';
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showPercentage = false,
  tone = 'primary',
  size = 'md',
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  const trackH = size === 'sm' ? 'h-1.5' : 'h-2';

  return (
    <div className={cn('w-full', className)}>
      {(label || showPercentage) && (
        <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
          {label ? <span>{label}</span> : <span />}
          {showPercentage && (
            <span className="font-medium tabular-nums">{Math.round(pct)}%</span>
          )}
        </div>
      )}
      <div
        className={cn(
          'w-full overflow-hidden rounded-full bg-gray-200',
          trackH
        )}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full transition-all', FILL[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
