/**
 * Pagination Constants
 *
 * Default and maximum page sizes for database queries.
 * Used to prevent unbounded queries that could cause performance issues.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * Clamp a requested page size to safe limits.
 *
 * @param requested - The requested page size (optional)
 * @returns A safe page size between DEFAULT_PAGE_SIZE and MAX_PAGE_SIZE
 */
export function clampPageSize(requested?: number): number {
  if (!requested || requested <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}
