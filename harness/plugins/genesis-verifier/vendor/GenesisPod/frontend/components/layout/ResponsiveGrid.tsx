import React from 'react';

interface ResponsiveGridProps {
  children: React.ReactNode;
  /**
   * Grid column configuration at different breakpoints
   * Format: { mobile, tablet, desktop, wide }
   */
  cols?: {
    xs?: number; // < 640px
    sm?: number; // >= 640px
    md?: number; // >= 768px
    lg?: number; // >= 1024px
    xl?: number; // >= 1280px
    '2xl'?: number; // >= 1440px
  };
  /**
   * Gap between grid items
   */
  gap?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Minimum column width (for auto-fit grids)
   * When specified, overrides cols and creates auto-responsive grid
   */
  minColWidth?: string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

const gapClasses = {
  none: 'gap-0',
  xs: 'gap-2',
  sm: 'gap-4',
  md: 'gap-6',
  lg: 'gap-8',
  xl: 'gap-10',
};

/**
 * ResponsiveGrid - A flexible grid component for responsive layouts
 *
 * Two modes:
 * 1. Breakpoint-based: Specify columns at each breakpoint
 * 2. Auto-fit: Specify minimum column width for automatic wrapping
 *
 * @example
 * // Breakpoint-based grid
 * ```tsx
 * <ResponsiveGrid cols={{ xs: 1, sm: 2, lg: 3, xl: 4 }} gap="md">
 *   {items.map(item => <Card key={item.id} {...item} />)}
 * </ResponsiveGrid>
 * ```
 *
 * @example
 * // Auto-fit grid
 * ```tsx
 * <ResponsiveGrid minColWidth="300px" gap="md">
 *   {items.map(item => <Card key={item.id} {...item} />)}
 * </ResponsiveGrid>
 * ```
 */
export default function ResponsiveGrid({
  children,
  cols = { xs: 1, sm: 2, lg: 3, xl: 4 },
  gap = 'md',
  minColWidth,
  className = '',
}: ResponsiveGridProps) {
  // Auto-fit mode using CSS Grid
  if (minColWidth) {
    const style = {
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${minColWidth}, 1fr))`,
    };

    return (
      <div style={style} className={`${gapClasses[gap]} ${className}`}>
        {children}
      </div>
    );
  }

  // Breakpoint-based mode using Tailwind classes
  const colClasses = [
    cols.xs && `grid-cols-${cols.xs}`,
    cols.sm && `sm:grid-cols-${cols.sm}`,
    cols.md && `md:grid-cols-${cols.md}`,
    cols.lg && `lg:grid-cols-${cols.lg}`,
    cols.xl && `xl:grid-cols-${cols.xl}`,
    cols['2xl'] && `2xl:grid-cols-${cols['2xl']}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`grid ${colClasses} ${gapClasses[gap]} ${className}`}>
      {children}
    </div>
  );
}

/**
 * ResponsiveGridItem - Optional wrapper for grid items with specific span control
 */
interface ResponsiveGridItemProps {
  children: React.ReactNode;
  /**
   * Column span at different breakpoints
   */
  colSpan?: {
    xs?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    '2xl'?: number;
  };
  /**
   * Row span at different breakpoints
   */
  rowSpan?: {
    xs?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    '2xl'?: number;
  };
  className?: string;
}

export function ResponsiveGridItem({
  children,
  colSpan,
  rowSpan,
  className = '',
}: ResponsiveGridItemProps) {
  const spanClasses = [
    colSpan?.xs && `col-span-${colSpan.xs}`,
    colSpan?.sm && `sm:col-span-${colSpan.sm}`,
    colSpan?.md && `md:col-span-${colSpan.md}`,
    colSpan?.lg && `lg:col-span-${colSpan.lg}`,
    colSpan?.xl && `xl:col-span-${colSpan.xl}`,
    colSpan?.['2xl'] && `2xl:col-span-${colSpan['2xl']}`,
    rowSpan?.xs && `row-span-${rowSpan.xs}`,
    rowSpan?.sm && `sm:row-span-${rowSpan.sm}`,
    rowSpan?.md && `md:row-span-${rowSpan.md}`,
    rowSpan?.lg && `lg:row-span-${rowSpan.lg}`,
    rowSpan?.xl && `xl:row-span-${rowSpan.xl}`,
    rowSpan?.['2xl'] && `2xl:row-span-${rowSpan['2xl']}`,
  ]
    .filter(Boolean)
    .join(' ');

  return <div className={`${spanClasses} ${className}`}>{children}</div>;
}
