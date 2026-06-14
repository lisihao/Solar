'use client';

import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { type StatusType, STATUS_COLORS } from '@/lib/features/admin/styles';

interface AdminToggleCardProps {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  icon?: LucideIcon;
  status?: StatusType;
  disabled?: boolean;
  loading?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export default function AdminToggleCard({
  title,
  description,
  enabled,
  onToggle,
  icon: Icon,
  status,
  disabled = false,
  loading = false,
  children,
  className,
}: AdminToggleCardProps) {
  const statusColors = status ? STATUS_COLORS[status] : null;

  const handleToggle = () => {
    if (!disabled && !loading) {
      onToggle(!enabled);
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border bg-white shadow-sm transition-all',
        enabled ? 'border-gray-200' : 'border-gray-100',
        className
      )}
    >
      <div className="flex items-start justify-between p-4">
        <div className="flex items-start gap-3">
          {Icon && (
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                enabled
                  ? 'bg-blue-100 text-blue-600'
                  : 'bg-gray-100 text-gray-400'
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3
                className={cn(
                  'text-sm font-medium transition-colors',
                  enabled ? 'text-gray-900' : 'text-gray-600'
                )}
              >
                {title}
              </h3>
              {status && statusColors && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                    statusColors.bg,
                    statusColors.text
                  )}
                >
                  <span
                    className={cn('h-1.5 w-1.5 rounded-full', statusColors.dot)}
                  />
                  {status === 'active'
                    ? 'Active'
                    : status === 'error'
                      ? 'Error'
                      : status === 'pending'
                        ? 'Pending'
                        : 'Inactive'}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-gray-500">{description}</p>
          </div>
        </div>

        {/* Toggle Switch */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={disabled || loading}
          onClick={handleToggle}
          className={cn(
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
            enabled ? 'bg-blue-600' : 'bg-gray-200',
            (disabled || loading) && 'cursor-not-allowed opacity-50'
          )}
        >
          <span className="sr-only">Toggle {title}</span>
          <span
            className={cn(
              'pointer-events-none relative inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              enabled ? 'translate-x-5' : 'translate-x-0'
            )}
          >
            {loading && (
              <span className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="h-3 w-3 animate-spin text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              </span>
            )}
          </span>
        </button>
      </div>

      {/* Expanded content when enabled */}
      {enabled && children && (
        <div className="border-t border-gray-100 px-4 py-4">{children}</div>
      )}
    </div>
  );
}

// Variant: Compact toggle for inline use
interface AdminToggleInlineProps {
  label: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export function AdminToggleInline({
  label,
  enabled,
  onToggle,
  disabled = false,
  loading = false,
  className,
}: AdminToggleInlineProps) {
  const handleToggle = () => {
    if (!disabled && !loading) {
      onToggle(!enabled);
    }
  };

  return (
    <div className={cn('flex items-center justify-between', className)}>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled || loading}
        onClick={handleToggle}
        className={cn(
          'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
          enabled ? 'bg-blue-600' : 'bg-gray-200',
          (disabled || loading) && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className="sr-only">Toggle {label}</span>
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
            enabled ? 'translate-x-4' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  );
}
