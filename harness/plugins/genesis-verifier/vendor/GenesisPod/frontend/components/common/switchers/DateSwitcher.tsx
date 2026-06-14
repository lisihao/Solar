'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface DateOption {
  date: string;
  label: string;
  subtitle?: string;
}

interface DateSwitcherProps {
  value: string;
  options: DateOption[];
  onChange: (date: string) => void;
  loading?: boolean;
}

export function DateSwitcher({
  value,
  options,
  onChange,
  loading = false,
}: DateSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (loading) {
    return (
      <div
        className="h-9 w-32 animate-pulse rounded-md bg-gray-200"
        aria-label="loading date"
      />
    );
  }

  if (options.length === 0) {
    return <span className="text-sm text-gray-400">无历史记录</span>;
  }

  const selected = options.find((o) => o.date === value);
  const selectedLabel = selected?.label ?? value;

  return (
    <div ref={ref} className="relative inline-block">
      {/* sm: native select for accessibility + simplicity */}
      <div className="block md:hidden">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
          aria-label="select date"
        >
          {options.map((opt) => (
            <option key={opt.date} value={opt.date}>
              {opt.label}
              {opt.subtitle ? ` — ${opt.subtitle}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* md+: custom popover dropdown */}
      <div className="hidden md:block">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{selectedLabel}</span>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </button>

        {open && (
          <div className="absolute left-0 z-20 mt-1 min-w-[180px] rounded-md border border-gray-200 bg-white py-1 shadow-lg">
            {options.map((opt) => (
              <button
                key={opt.date}
                onClick={() => {
                  onChange(opt.date);
                  setOpen(false);
                }}
                className={`flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                  opt.date === value
                    ? 'font-medium text-violet-600'
                    : 'text-gray-700'
                }`}
                role="option"
                aria-selected={opt.date === value}
              >
                <span>{opt.label}</span>
                {opt.subtitle && (
                  <span className="text-xs text-gray-400">{opt.subtitle}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
