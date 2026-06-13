'use client';

import { ReadStatus } from '@/hooks';
import { StatusBadge, type BadgeTone } from '@/components/ui/badges';

interface ReadStatusBadgeProps {
  status: ReadStatus;
  onChange?: (status: ReadStatus) => void;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

const STATUS_MAP: Record<ReadStatus, { tone: BadgeTone; label: string }> = {
  [ReadStatus.UNREAD]: { tone: 'neutral', label: 'Unread' },
  [ReadStatus.READING]: { tone: 'running', label: 'Reading' },
  [ReadStatus.COMPLETED]: { tone: 'success', label: 'Completed' },
  [ReadStatus.ARCHIVED]: { tone: 'warning', label: 'Archived' },
};

// 交互式下拉（onChange）保留自写；纯展示徽章走统一 StatusBadge。
const SELECT_STYLE: Record<ReadStatus, string> = {
  [ReadStatus.UNREAD]: 'border-gray-300 bg-gray-100 text-gray-600',
  [ReadStatus.READING]: 'border-blue-300 bg-blue-50 text-blue-700',
  [ReadStatus.COMPLETED]: 'border-green-300 bg-green-50 text-green-700',
  [ReadStatus.ARCHIVED]: 'border-amber-300 bg-amber-50 text-amber-700',
};

export default function ReadStatusBadge({
  status,
  onChange,
  showLabel = true,
  size = 'sm',
}: ReadStatusBadgeProps) {
  const cfg = STATUS_MAP[status] ?? STATUS_MAP[ReadStatus.UNREAD];

  if (onChange) {
    const sizeClasses =
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
    return (
      <div className="relative">
        <select
          value={status}
          onChange={(e) => onChange(e.target.value as ReadStatus)}
          className={`cursor-pointer appearance-none rounded-full border ${SELECT_STYLE[status]} ${sizeClasses} pr-6 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500`}
        >
          {Object.entries(STATUS_MAP).map(([key, c]) => (
            <option key={key} value={key}>
              {c.label}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    );
  }

  return (
    <StatusBadge
      tone={cfg.tone}
      dot
      label={showLabel ? cfg.label : ''}
      size={size}
    />
  );
}
