'use client';

/**
 * RadarBucketSwitcher —— 4 bucket 时段切换器（R14 2026-05-19）
 *
 * 替代之前的 DateSwitcher 按日选择 —— 实际数据是 RadarDailyBriefing 一天
 * 一行，每天 0-5 条信号。Cisco 类 RSS 一天通常 0-2 条 → 用户经常看到
 * 「今日 0 信号」。改成 4 时段后用户可放大窗口看「本周 / 本月 / 本年」
 * 累计信号。
 */

import { type BriefingBucket } from '@/hooks/domain/useDailyBriefingRange';

interface Props {
  value: BriefingBucket;
  onChange: (bucket: BriefingBucket) => void;
  loading?: boolean;
}

const BUCKETS: Array<{ key: BriefingBucket; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'year', label: '本年' },
];

export function RadarBucketSwitcher({
  value,
  onChange,
  loading = false,
}: Props) {
  if (loading) {
    return (
      <div
        className="h-9 w-48 animate-pulse rounded-md bg-gray-200"
        aria-label="loading bucket switcher"
      />
    );
  }

  return (
    <div
      className="inline-flex h-9 items-center rounded-md border border-gray-200 bg-white p-0.5 text-sm"
      role="tablist"
    >
      {BUCKETS.map((b) => {
        const active = value === b.key;
        return (
          <button
            key={b.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(b.key)}
            className={`rounded px-3 py-1 font-medium transition-colors ${
              active
                ? 'bg-violet-100 text-violet-700'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );
}
