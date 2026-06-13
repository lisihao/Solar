'use client';

import { useState, useCallback } from 'react';
import { Calendar, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

export interface DateRange {
  from: string | null;
  to: string | null;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

type PresetType = 'today' | 'week' | 'month' | 'last30' | 'custom';

export function DateRangePicker({
  value,
  onChange,
  className = '',
}: DateRangePickerProps) {
  const { t } = useTranslation();
  const [activePreset, setActivePreset] = useState<PresetType>('custom');

  const getPresetRange = useCallback((preset: PresetType): DateRange => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (preset) {
      case 'today':
        return {
          from: today.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0],
        };
      case 'week': {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        return {
          from: weekStart.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0],
        };
      }
      case 'month': {
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        return {
          from: monthStart.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0],
        };
      }
      case 'last30': {
        const last30 = new Date(today);
        last30.setDate(today.getDate() - 30);
        return {
          from: last30.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0],
        };
      }
      default:
        return { from: null, to: null };
    }
  }, []);

  const handlePresetClick = useCallback(
    (preset: PresetType) => {
      setActivePreset(preset);
      onChange(getPresetRange(preset));
    },
    [onChange, getPresetRange]
  );

  const handleFromChange = useCallback(
    (date: string) => {
      setActivePreset('custom');
      onChange({ ...value, from: date || null });
    },
    [value, onChange]
  );

  const handleToChange = useCallback(
    (date: string) => {
      setActivePreset('custom');
      onChange({ ...value, to: date || null });
    },
    [value, onChange]
  );

  const handleClear = useCallback(() => {
    setActivePreset('custom');
    onChange({ from: null, to: null });
  }, [onChange]);

  const hasValue = value.from || value.to;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Preset Buttons */}
      <div className="flex flex-wrap gap-2">
        {(['today', 'week', 'month', 'last30'] as PresetType[]).map(
          (preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handlePresetClick(preset)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                activePreset === preset
                  ? 'border-rose-500 bg-rose-50 text-rose-700'
                  : 'border-gray-200 text-gray-700 hover:border-rose-300 hover:bg-rose-50'
              }`}
            >
              {t(`aiSocial.filters.datePresets.${preset}`)}
            </button>
          )
        )}
      </div>

      {/* Custom Date Range */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label
            htmlFor="date-from"
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            {t('aiSocial.filters.dateFrom')}
          </label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="date-from"
              type="date"
              value={value.from || ''}
              onChange={(e) => handleFromChange(e.target.value)}
              max={value.to || undefined}
              className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-3 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            />
          </div>
        </div>

        <div className="flex-1">
          <label
            htmlFor="date-to"
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            {t('aiSocial.filters.dateTo')}
          </label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="date-to"
              type="date"
              value={value.to || ''}
              onChange={(e) => handleToChange(e.target.value)}
              min={value.from || undefined}
              className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-3 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            />
          </div>
        </div>

        {hasValue && (
          <button
            type="button"
            onClick={handleClear}
            className="mt-5 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            title={t('aiSocial.filters.clearDates')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
