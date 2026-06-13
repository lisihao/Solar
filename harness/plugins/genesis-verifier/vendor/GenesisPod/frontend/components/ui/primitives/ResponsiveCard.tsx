import React from 'react';

interface ResponsiveCardProps {
  children: React.ReactNode;
  /**
   * Card variant - affects styling
   */
  variant?: 'default' | 'outlined' | 'elevated' | 'flat';
  /**
   * Padding size
   */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /**
   * Whether card is interactive (clickable)
   */
  interactive?: boolean;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Hover effect
   */
  hover?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

const variantClasses = {
  default: 'bg-white border border-gray-200 shadow-sm',
  outlined: 'bg-white border-2 border-gray-300',
  elevated: 'bg-white shadow-md hover:shadow-lg transition-shadow duration-200',
  flat: 'bg-gray-50',
};

const paddingClasses = {
  none: '',
  sm: 'p-3 sm:p-4',
  md: 'p-4 sm:p-5 lg:p-6',
  lg: 'p-6 sm:p-7 lg:p-8',
};

/**
 * ResponsiveCard - A flexible card component with responsive padding and variants
 *
 * Features:
 * - Multiple visual variants (default, outlined, elevated, flat)
 * - Responsive padding
 * - Interactive states (hover, focus)
 * - Keyboard accessible when clickable
 *
 * @example
 * ```tsx
 * <ResponsiveCard variant="elevated" padding="md" interactive onClick={handleClick}>
 *   <h3>Card Title</h3>
 *   <p>Card content</p>
 * </ResponsiveCard>
 * ```
 */
export default function ResponsiveCard({
  children,
  variant = 'default',
  padding = 'md',
  interactive = false,
  onClick,
  hover = true,
  className = '',
}: ResponsiveCardProps) {
  const Component = interactive || onClick ? 'button' : 'div';

  const classes = [
    'rounded-lg',
    'w-full',
    'transition-all duration-200',
    variantClasses[variant],
    paddingClasses[padding],
    interactive && 'cursor-pointer',
    interactive && hover && 'hover:scale-[1.02] active:scale-[0.98]',
    interactive &&
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const props =
    Component === 'button'
      ? {
          type: 'button' as const,
          onClick,
          className: classes,
        }
      : {
          className: classes,
        };

  return <Component {...props}>{children}</Component>;
}

/**
 * ResponsiveCardHeader - Card header section with responsive text sizing
 */
interface ResponsiveCardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function ResponsiveCardHeader({
  children,
  className = '',
}: ResponsiveCardHeaderProps) {
  return (
    <div
      className={`mb-3 border-b border-gray-200 pb-2 sm:mb-4 sm:pb-3 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * ResponsiveCardTitle - Card title with responsive font sizing
 */
interface ResponsiveCardTitleProps {
  children: React.ReactNode;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  className?: string;
}

export function ResponsiveCardTitle({
  children,
  as: Component = 'h3',
  className = '',
}: ResponsiveCardTitleProps) {
  return (
    <Component
      className={`text-base font-semibold text-gray-900 sm:text-lg lg:text-xl ${className}`}
    >
      {children}
    </Component>
  );
}

/**
 * ResponsiveCardContent - Card content area with responsive spacing
 */
interface ResponsiveCardContentProps {
  children: React.ReactNode;
  className?: string;
}

export function ResponsiveCardContent({
  children,
  className = '',
}: ResponsiveCardContentProps) {
  return (
    <div className={`text-sm text-gray-700 sm:text-base ${className}`}>
      {children}
    </div>
  );
}

/**
 * ResponsiveCardFooter - Card footer section with responsive spacing
 */
interface ResponsiveCardFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function ResponsiveCardFooter({
  children,
  className = '',
}: ResponsiveCardFooterProps) {
  return (
    <div
      className={`mt-3 border-t border-gray-200 pt-2 sm:mt-4 sm:pt-3 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * ResponsiveCardActions - Card actions area (typically contains buttons)
 */
interface ResponsiveCardActionsProps {
  children: React.ReactNode;
  /**
   * Layout direction
   */
  direction?: 'row' | 'column';
  /**
   * Alignment
   */
  align?: 'start' | 'center' | 'end' | 'stretch';
  className?: string;
}

export function ResponsiveCardActions({
  children,
  direction = 'row',
  align = 'end',
  className = '',
}: ResponsiveCardActionsProps) {
  const directionClass = direction === 'row' ? 'flex-row' : 'flex-col';
  const alignClass = {
    start: 'justify-start items-start',
    center: 'justify-center items-center',
    end: 'justify-end items-end',
    stretch: 'justify-stretch items-stretch',
  }[align];

  return (
    <div
      className={`flex gap-2 sm:gap-3 ${directionClass} ${alignClass} ${className}`}
    >
      {children}
    </div>
  );
}
