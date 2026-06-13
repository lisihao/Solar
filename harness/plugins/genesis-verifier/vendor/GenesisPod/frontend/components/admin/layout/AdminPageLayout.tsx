'use client';

import { type LucideIcon, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils/common';
import { type AdminDomain, ADMIN_COLORS } from '@/lib/features/admin/styles';

interface AdminPageLayoutProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  domain?: AdminDomain;
  actions?: React.ReactNode;
  searchBar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl' | '7xl' | 'full';
  showBackButton?: boolean;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
  full: 'max-w-full',
};

export default function AdminPageLayout({
  title,
  description,
  icon: Icon,
  domain,
  actions,
  searchBar,
  children,
  className,
  maxWidth = '7xl',
  showBackButton = true,
}: AdminPageLayoutProps) {
  const colors = domain ? ADMIN_COLORS[domain] : null;

  return (
    <div className="flex h-full flex-col bg-gray-50/50">
      {/* Sticky Header - AI Writing Style */}
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className={cn('mx-auto px-6 py-5', maxWidthClasses[maxWidth])}>
          <div className="flex items-center justify-between">
            {/* Left: Back + Icon + Title */}
            <div className="flex items-center gap-4">
              {/* Back Button */}
              {showBackButton && (
                <Link
                  href="/admin/overview"
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              )}
              {/* Icon */}
              {Icon && (
                <div
                  className={cn(
                    'flex h-14 w-14 items-center justify-center rounded-xl shadow-lg',
                    colors
                      ? `bg-gradient-to-br ${colors.gradient} shadow-${colors.primary}-500/25`
                      : 'bg-gradient-to-br from-gray-500 to-gray-600 shadow-gray-500/25'
                  )}
                >
                  <Icon className="h-7 w-7 text-white" />
                </div>
              )}
              {/* Title */}
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                {description && (
                  <p className="mt-0.5 text-sm text-gray-500">{description}</p>
                )}
              </div>
            </div>

            {/* Right: Actions */}
            {actions && (
              <div className="flex items-center gap-2">{actions}</div>
            )}
          </div>

          {/* Search Bar (optional) */}
          {searchBar && <div className="mt-4">{searchBar}</div>}
        </div>
      </header>

      {/* Content */}
      <main className={cn('flex-1 overflow-auto', className)}>
        <div className={cn('mx-auto px-6 py-6', maxWidthClasses[maxWidth])}>
          {children}
        </div>
      </main>
    </div>
  );
}

// Sub-components for consistent structure
interface AdminPageSectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function AdminPageSection({
  title,
  description,
  children,
  className,
}: AdminPageSectionProps) {
  return (
    <section className={cn('space-y-4', className)}>
      {(title || description) && (
        <div>
          {title && (
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          )}
          {description && (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

interface AdminPageGridProps {
  children: React.ReactNode;
  cols?: 1 | 2 | 3 | 4;
  className?: string;
}

export function AdminPageGrid({
  children,
  cols = 2,
  className,
}: AdminPageGridProps) {
  const colClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <div className={cn('grid gap-4', colClasses[cols], className)}>
      {children}
    </div>
  );
}
