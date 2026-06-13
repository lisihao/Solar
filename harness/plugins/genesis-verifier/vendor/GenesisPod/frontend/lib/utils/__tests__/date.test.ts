import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDateSafe, isToday } from '../date';

describe('formatDateSafe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- null / undefined / empty inputs ---

  it('should return "--" for null', () => {
    expect(formatDateSafe(null)).toBe('--');
  });

  it('should return "--" for undefined', () => {
    expect(formatDateSafe(undefined)).toBe('--');
  });

  it('should return "--" for empty string', () => {
    expect(formatDateSafe('')).toBe('--');
  });

  it('should return "--" for an invalid date string', () => {
    expect(formatDateSafe('not-a-date')).toBe('--');
  });

  // --- format: 'date' ---
  // ★ 2026-05-27 hydration fix: 函数改用 UTC 方法 (避免 SSR/CSR 时区不一致),
  //   测试改用 Date.UTC(...) 显式构造 UTC 时间以保证断言与实现对齐。

  it('should format a date string in YYYY-MM-DD for format "date"', () => {
    const date = new Date(Date.UTC(2024, 5, 15, 10, 30)); // June 15 2024 10:30 UTC
    const result = formatDateSafe(date, 'date');
    expect(result).toBe('2024-06-15');
  });

  it('should zero-pad month and day for format "date"', () => {
    const date = new Date(Date.UTC(2023, 0, 5, 8, 5)); // Jan 5 2023 UTC
    expect(formatDateSafe(date, 'date')).toBe('2023-01-05');
  });

  // --- format: 'datetime' (default) ---

  it('should format with default "datetime" format', () => {
    const date = new Date(Date.UTC(2024, 2, 20, 14, 7)); // March 20 2024 14:07 UTC
    expect(formatDateSafe(date)).toBe('2024-03-20 14:07');
  });

  it('should accept a date string as input', () => {
    const date = new Date(Date.UTC(2024, 11, 1, 9, 5)); // Dec 1 2024 09:05 UTC
    const result = formatDateSafe(date.toISOString(), 'datetime');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('should accept a Date object directly', () => {
    const date = new Date(Date.UTC(2025, 0, 1, 0, 0)); // Jan 1 2025 00:00 UTC
    const result = formatDateSafe(date, 'datetime');
    expect(result).toBe('2025-01-01 00:00');
  });

  // --- format: 'datetime-short' ---

  it('should format "datetime-short" as MM-DD HH:mm', () => {
    const date = new Date(Date.UTC(2024, 6, 4, 9, 3)); // July 4 2024 09:03 UTC
    expect(formatDateSafe(date, 'datetime-short')).toBe('07-04 09:03');
  });

  it('should zero-pad all fields for "datetime-short"', () => {
    const date = new Date(Date.UTC(2024, 0, 2, 1, 8)); // Jan 2 01:08 UTC
    expect(formatDateSafe(date, 'datetime-short')).toBe('01-02 01:08');
  });

  // --- format: 'time' ---

  it('should format "time" as HH:mm', () => {
    const date = new Date(Date.UTC(2024, 0, 1, 23, 59));
    expect(formatDateSafe(date, 'time')).toBe('23:59');
  });

  it('should zero-pad hours for "time" format', () => {
    const date = new Date(Date.UTC(2024, 0, 1, 5, 0));
    expect(formatDateSafe(date, 'time')).toBe('05:00');
  });

  // --- format: 'relative' ---

  it('should return datetime-style string for "relative" format (avoids hydration issues)', () => {
    const date = new Date(Date.UTC(2024, 3, 10, 8, 30)); // April 10 2024 UTC
    const result = formatDateSafe(date, 'relative');
    expect(result).toBe('2024-04-10 08:30');
  });

  // --- edge cases ---

  it('should handle leap-year date Feb 29', () => {
    const date = new Date(Date.UTC(2024, 1, 29, 12, 0)); // Feb 29 2024 UTC
    expect(formatDateSafe(date, 'date')).toBe('2024-02-29');
  });

  it('should return "--" for Invalid Date object', () => {
    const badDate = new Date('INVALID');
    expect(formatDateSafe(badDate)).toBe('--');
  });
});

describe('isToday', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return false for null', () => {
    expect(isToday(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isToday(undefined)).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isToday('')).toBe(false);
  });

  it('should return true for a Date object that is today', () => {
    const now = new Date();
    expect(isToday(now)).toBe(true);
  });

  it('should return true for an ISO string representing today', () => {
    const now = new Date();
    // Build a new Date at midnight today to avoid time-zone edge cases
    const todayMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0
    );
    expect(isToday(todayMidnight.toISOString())).toBe(true);
  });

  it('should return false for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isToday(yesterday)).toBe(false);
  });

  it('should return false for tomorrow', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isToday(tomorrow)).toBe(false);
  });

  it('should return false for an invalid date string', () => {
    expect(isToday('not-a-date')).toBe(false);
  });

  it('should return false for a date in the past year', () => {
    const pastDate = new Date(2020, 0, 1);
    expect(isToday(pastDate)).toBe(false);
  });
});
