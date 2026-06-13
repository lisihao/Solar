'use client';

/**
 * ClientDate - Hydration-safe date display component
 *
 * 解决 React hydration 错误：
 * - toLocaleString() 在 SSR 和 CSR 可能产生不同结果
 * - 时区差异导致日期显示不一致
 *
 * 使用方法：
 * <ClientDate date={someDate} format="datetime" />
 * <ClientDate date="2024-01-01" format="date" />
 */

import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';

type DateFormat = 'date' | 'time' | 'datetime' | 'relative';

interface ClientDateProps {
  /** Date string, Date object, or timestamp */
  date: string | Date | number | null | undefined;
  /** Display format */
  format?: DateFormat;
  /** Locale for formatting (default: 'zh-CN') */
  locale?: string;
  /** Fallback text when date is invalid */
  fallback?: string;
  /** Additional className */
  className?: string;
  /** Custom date format options (for 'date' format only) */
  dateOptions?: Intl.DateTimeFormatOptions;
  /** Custom time format options (for 'time' format only) */
  timeOptions?: Intl.DateTimeFormatOptions;
}

/**
 * Format date based on format type
 */
function formatDate(
  date: Date,
  format: DateFormat,
  locale: string,
  options?: {
    dateOptions?: Intl.DateTimeFormatOptions;
    timeOptions?: Intl.DateTimeFormatOptions;
  }
): string {
  switch (format) {
    case 'date':
      return date.toLocaleDateString(locale, options?.dateOptions);
    case 'time':
      return date.toLocaleTimeString(
        locale,
        options?.timeOptions || {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }
      );
    case 'datetime':
      return date.toLocaleString(locale);
    case 'relative':
      return getRelativeTime(date, locale);
    default:
      return date.toLocaleString(locale);
  }
}

/**
 * Get relative time string (e.g., "3 minutes ago")
 */
function getRelativeTime(date: Date, locale: string = 'zh-CN'): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  // Chinese locale
  if (locale === 'zh-CN') {
    if (diffSec < 60) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    if (diffHour < 24) return `${diffHour} 小时前`;
    if (diffDay === 1) return '昨天';
    if (diffDay < 7) return `${diffDay} 天前`;
    if (diffDay < 30) return `${Math.floor(diffDay / 7)} 周前`;
    if (diffDay < 365) return `${Math.floor(diffDay / 30)} 个月前`;
    return date.toLocaleDateString('zh-CN');
  }

  // English locale
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  if (diffDay < 30)
    return `${Math.floor(diffDay / 7)} week${Math.floor(diffDay / 7) > 1 ? 's' : ''} ago`;
  if (diffDay < 365)
    return `${Math.floor(diffDay / 30)} month${Math.floor(diffDay / 30) > 1 ? 's' : ''} ago`;
  return `${Math.floor(diffDay / 365)} year${Math.floor(diffDay / 365) > 1 ? 's' : ''} ago`;
}

/**
 * Parse date from various formats
 */
function parseDate(
  date: string | Date | number | null | undefined
): Date | null {
  if (!date) return null;
  if (date instanceof Date) return date;
  if (typeof date === 'number') return new Date(date);
  if (typeof date === 'string') {
    const parsed = new Date(date);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function ClientDate({
  date,
  format = 'datetime',
  locale: localeProp,
  fallback = '-',
  className,
  dateOptions,
  timeOptions,
}: ClientDateProps) {
  const { locale: i18nLocale } = useI18n();
  const locale = localeProp || (i18nLocale === 'en' ? 'en-US' : 'zh-CN');

  const [mounted, setMounted] = useState(false);
  const [formattedDate, setFormattedDate] = useState<string>(fallback);

  useEffect(() => {
    setMounted(true);
    const parsedDate = parseDate(date);
    if (parsedDate) {
      setFormattedDate(
        formatDate(parsedDate, format, locale, { dateOptions, timeOptions })
      );
    }
  }, [date, format, locale, dateOptions, timeOptions]);

  // 在客户端挂载前显示占位符，避免 hydration 错误
  if (!mounted) {
    return <span className={className}>{fallback}</span>;
  }

  return <span className={className}>{formattedDate}</span>;
}

export default ClientDate;
