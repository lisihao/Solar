'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import {
  type StatusType,
  getStatusBadgeClasses,
} from '@/lib/features/admin/styles';

interface AdminConfigCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  status?: StatusType;
  statusLabel?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
}

export default function AdminConfigCard({
  title,
  description,
  icon: Icon,
  status,
  statusLabel,
  collapsible = false,
  defaultExpanded = true,
  actions,
  children,
  className,
  headerClassName,
  contentClassName,
}: AdminConfigCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handleToggle = () => {
    if (collapsible) {
      setExpanded((prev) => !prev);
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-gray-100 bg-white shadow-sm',
        className
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between px-5 py-4',
          expanded && 'border-b border-gray-100',
          collapsible && 'cursor-pointer',
          headerClassName
        )}
        onClick={handleToggle}
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleToggle();
                }
              }
            : undefined
        }
      >
        <div className="flex items-center gap-3">
          {collapsible && (
            <span className="text-gray-400">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
          )}
          {Icon && (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
              <Icon className="h-5 w-5 text-gray-600" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">{title}</h3>
              {status && statusLabel && (
                <span className={getStatusBadgeClasses(status)}>
                  {statusLabel}
                </span>
              )}
            </div>
            {description && (
              <p className="mt-0.5 text-sm text-gray-500">{description}</p>
            )}
          </div>
        </div>
        {actions && (
          <div
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>

      {/* Content */}
      {expanded && (
        <div className={cn('px-5 py-4', contentClassName)}>{children}</div>
      )}
    </div>
  );
}

// Sub-component for form fields within config card
interface AdminConfigFieldProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
  error?: string;
}

export function AdminConfigField({
  label,
  description,
  children,
  className,
  required,
  error,
}: AdminConfigFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {description && !error && (
        <p className="text-sm text-gray-500">{description}</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// Sub-component for action buttons row
interface AdminConfigActionsProps {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'between';
}

export function AdminConfigActions({
  children,
  className,
  align = 'right',
}: AdminConfigActionsProps) {
  const alignClasses = {
    left: 'justify-start',
    right: 'justify-end',
    between: 'justify-between',
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-t border-gray-100 bg-gray-50/50 px-5 py-3',
        alignClasses[align],
        className
      )}
    >
      {children}
    </div>
  );
}
