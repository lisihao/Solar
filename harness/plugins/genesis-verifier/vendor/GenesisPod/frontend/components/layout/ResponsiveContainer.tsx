import React from 'react';

interface ResponsiveContainerProps {
  children: React.ReactNode;
  /**
   * Maximum width constraint
   * - 'sm': 640px
   * - 'md': 768px
   * - 'lg': 1024px
   * - 'xl': 1280px
   * - '2xl': 1440px
   * - 'full': 100%
   */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  /**
   * Padding configuration
   * - 'none': No padding
   * - 'sm': Small padding (1rem)
   * - 'md': Medium padding (responsive: 1rem → 2rem)
   * - 'lg': Large padding (responsive: 1.5rem → 3rem)
   */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /**
   * Whether to center the container
   */
  centered?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Container element type
   */
  as?: 'div' | 'main' | 'section' | 'article';
}

const maxWidthClasses = {
  sm: 'max-w-screen-sm',
  md: 'max-w-screen-md',
  lg: 'max-w-screen-lg',
  xl: 'max-w-screen-xl',
  '2xl': 'max-w-screen-2xl',
  full: 'max-w-full',
};

const paddingClasses = {
  none: '',
  sm: 'px-4',
  md: 'px-4 sm:px-6 lg:px-8',
  lg: 'px-6 sm:px-8 lg:px-12',
};

/**
 * ResponsiveContainer - A flexible container component for responsive layouts
 *
 * Features:
 * - Configurable max-width breakpoints
 * - Responsive padding with mobile-first approach
 * - Auto-centering option
 * - Semantic HTML element selection
 *
 * @example
 * ```tsx
 * <ResponsiveContainer maxWidth="xl" padding="md" centered>
 *   <h1>Content</h1>
 * </ResponsiveContainer>
 * ```
 */
export default function ResponsiveContainer({
  children,
  maxWidth = 'xl',
  padding = 'md',
  centered = true,
  className = '',
  as: Component = 'div',
}: ResponsiveContainerProps) {
  const classes = [
    'w-full',
    maxWidthClasses[maxWidth],
    paddingClasses[padding],
    centered && 'mx-auto',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <Component className={classes}>{children}</Component>;
}
