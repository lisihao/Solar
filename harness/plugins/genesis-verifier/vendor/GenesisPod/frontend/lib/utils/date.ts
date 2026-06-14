/**
 * Date formatting utilities
 *
 * These functions provide consistent date formatting that avoids
 * hydration errors by using fixed formats instead of locale-dependent ones.
 */

export type DateFormat =
  | 'date' // YYYY-MM-DD
  | 'datetime' // YYYY-MM-DD HH:mm
  | 'datetime-short' // MM-DD HH:mm
  | 'time' // HH:mm
  | 'relative'; // X days ago (only safe on client)

/**
 * Format a date string safely to avoid hydration mismatches.
 * Uses consistent formatting that works the same on server and client.
 */
export function formatDateSafe(
  dateStr: string | Date | null | undefined,
  format: DateFormat = 'datetime'
): string {
  if (!dateStr) return '--';

  try {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    if (isNaN(date.getTime())) return '--';

    // ★ Hydration safety (2026-05-27 React #418 真根因): 用 UTC 方法而非 local
    //   方法。Node SSR 容器一般是 UTC, 浏览器是用户本地 (e.g. Asia/Shanghai +8),
    //   date.getDate/getHours/getMinutes 在两边输出不同字符串 → SSR 拼 "12:30"
    //   而 CSR 拼 "20:30" → React #418 hydration mismatch。改用 getUTCxxx 让两边
    //   完全一致, 代价是显示 UTC 时间不是 local; 需要 local 显示的位置改用
    //   <ClientDate> 组件 (useEffect 内 toLocaleString 安全)。
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');

    switch (format) {
      case 'date':
        return `${year}-${month}-${day}`;
      case 'datetime':
        return `${year}-${month}-${day} ${hours}:${minutes}`;
      case 'datetime-short':
        return `${month}-${day} ${hours}:${minutes}`;
      case 'time':
        return `${hours}:${minutes}`;
      case 'relative':
        // For relative dates, fall back to datetime to avoid hydration issues
        // Use ClientDate component for relative formatting
        return `${year}-${month}-${day} ${hours}:${minutes}`;
      default:
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }
  } catch {
    return '--';
  }
}

/**
 * Check if a date is today
 */
export function isToday(dateStr: string | Date | null | undefined): boolean {
  if (!dateStr) return false;
  try {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    const today = new Date();
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  } catch {
    return false;
  }
}
