'use client';

/**
 * Admin tables —— shared primitives
 *
 * 全 admin 表格化页面共用（知识 / 工具 / 技能 ...）：
 *   - fmtTime / statusBadgeClass / fmtBytes — 格式化函数
 *   - <Th> <Section> <Row> <StatGrid> — 表格 / 抽屉 UI 原子
 *   - <DrawerShell> — 右侧抽屉壳（backdrop md:left-52，drawer md:max-w-720px + Esc 关闭）
 *   - <PaginationBar> — 上/下页控件
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';

// ──────────────── format helpers ────────────────

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'READY':
    case 'COMPLETED':
      return 'bg-green-100 text-green-700';
    case 'PROCESSING':
      return 'bg-blue-100 text-blue-700';
    case 'PENDING':
      return 'bg-amber-100 text-amber-700';
    case 'ERROR':
    case 'FAILED':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

// ──────────────── UI atoms ────────────────

export function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ${className}`}
    >
      {children}
    </th>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

export function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-24 flex-shrink-0 text-xs text-gray-500">{label}</span>
      <span className="min-w-0 flex-1 truncate text-gray-900">{value}</span>
    </div>
  );
}

export function StatGrid({
  items,
}: {
  items: Array<{ label: string; value: number | string }>;
}) {
  return (
    <div className={`grid gap-2 ${gridColsClass(items.length)}`}>
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
        >
          <div className="text-[10px] uppercase tracking-wider text-gray-500">
            {it.label}
          </div>
          <div className="mt-0.5 text-base font-semibold tabular-nums text-gray-900">
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function gridColsClass(n: number): string {
  if (n <= 2) return 'grid-cols-2';
  if (n === 3) return 'grid-cols-3';
  return 'grid-cols-4';
}

// ──────────────── drawer shell ────────────────

export function DrawerShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-y-0 left-0 right-0 z-40 bg-black/30 md:left-52"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl md:w-[calc(100vw-13rem-2rem)] md:max-w-[720px]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-gray-900">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </>
  );
}

// ──────────────── pagination control ────────────────

export function PaginationBar({
  page,
  totalPages,
  loading,
  onChange,
}: {
  page: number;
  totalPages: number;
  loading: boolean;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1 || loading}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-40"
      >
        上一页
      </button>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages || loading}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-40"
      >
        下一页
      </button>
    </div>
  );
}
