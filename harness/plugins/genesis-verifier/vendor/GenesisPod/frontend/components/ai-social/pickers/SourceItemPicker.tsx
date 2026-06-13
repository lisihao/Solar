'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, Check } from 'lucide-react';
import * as Icons from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { useTranslation } from '@/lib/i18n';
import { useSourceItems } from '@/hooks/domain/useSourceItems';
import type {
  SocialDataSourceDescriptor,
  PickedSourceItem,
  SourceItem,
} from '@/services/ai-social/task-types';

export interface SourceItemPickerProps {
  source: SocialDataSourceDescriptor;
  alreadyPicked: PickedSourceItem[];
  onConfirm: (picked: PickedSourceItem[]) => void;
  onCancel: () => void;
  maxRemainingGlobal: number;
}

function formatMeta(item: SourceItem): string {
  const parts: string[] = [];
  if (item.createdAt) {
    parts.push(item.createdAt.slice(0, 10));
  }
  if (item.contentKind) {
    parts.push(item.contentKind);
  }
  if (item.wordCount) {
    parts.push(`${(item.wordCount / 1000).toFixed(1)}k 字`);
  } else if (item.durationSec) {
    const m = Math.floor(item.durationSec / 60);
    parts.push(`${m} 分钟`);
  }
  return parts.join(' · ');
}

// Simple debounce hook using refs to avoid stale closures
function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function SourceItemPicker({
  source,
  alreadyPicked,
  onConfirm,
  onCancel,
  maxRemainingGlobal,
}: SourceItemPickerProps) {
  const { t } = useTranslation();

  // Local search string (updated immediately on input)
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  // Cursor-based pagination state — list of pages
  const [cursors, setCursors] = useState<string[]>([]);
  const [allItems, setAllItems] = useState<SourceItem[]>([]);

  // The current cursor is the last element of the cursors stack (undefined = first page)
  const currentCursor = cursors[cursors.length - 1];

  const { items, nextCursor, isLoading } = useSourceItems(source.id, {
    search: debouncedSearch,
    cursor: currentCursor,
    limit: 30,
  });

  // When search changes, reset pagination and accumulated items
  useEffect(() => {
    setCursors([]);
    setAllItems([]);
  }, [debouncedSearch]);

  // Accumulate items as new pages arrive
  useEffect(() => {
    if (items.length === 0 && cursors.length === 0) return;
    if (cursors.length === 0) {
      // First page
      setAllItems(items);
    } else {
      // Subsequent pages — append only new items (avoid duplicates)
      setAllItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const newItems = items.filter((i) => !existingIds.has(i.id));
        return [...prev, ...newItems];
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Picked set: initialized from alreadyPicked
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(alreadyPicked.map((p) => p.id))
  );

  // Max allowed picks for this source
  const sourceMax = source.maxItemsPerTask ?? 10;
  // Total cap = source max, but also we can't exceed global remaining + already picked
  const effectiveMax = Math.min(
    sourceMax,
    maxRemainingGlobal + alreadyPicked.length
  );

  const toggleItem = useCallback(
    (itemId: string) => {
      setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) {
          next.delete(itemId);
        } else {
          if (next.size >= effectiveMax) return prev; // at cap
          next.add(itemId);
        }
        return next;
      });
    },
    [effectiveMax]
  );

  // IntersectionObserver for infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!nextCursor) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && nextCursor && !isLoading) {
          setCursors((prev) => [...prev, nextCursor]);
        }
      },
      { threshold: 0.1 }
    );
    observerRef.current.observe(sentinel);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [nextCursor, isLoading]);

  const handleConfirm = () => {
    // Build PickedSourceItem array from currently shown items + alreadyPicked
    // We need the full SourceItem objects — combine allItems + alreadyPicked base items
    const itemMap = new Map<string, SourceItem>();
    alreadyPicked.forEach((p) => itemMap.set(p.id, p));
    allItems.forEach((i) => itemMap.set(i.id, i));

    const result: PickedSourceItem[] = [];
    picked.forEach((id) => {
      const item = itemMap.get(id);
      if (item) result.push({ ...item, sourceType: source.id });
    });

    onConfirm(result);
    onCancel();
  };

  const SourceIcon =
    (
      Icons as unknown as Record<
        string,
        React.ComponentType<{ className?: string }>
      >
    )[source.icon] ?? Icons.Box;

  const displayName =
    source.displayName['zh-CN'] || source.displayName['en-US'];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
        style={{ maxHeight: '80vh' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100">
              <SourceIcon className="h-4 w-4 text-rose-600" />
            </div>
            <h3
              id="picker-title"
              className="text-base font-semibold text-gray-900"
            >
              {`从 ${displayName} 选择内容`}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-gray-100 px-5 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索内容…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            />
          </div>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {isLoading && allItems.length === 0 && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          )}

          {!isLoading && allItems.length === 0 && (
            <EmptyState size="sm" title="暂无内容" />
          )}

          <ul className="space-y-1">
            {allItems.map((item) => {
              const isChecked = picked.has(item.id);
              const isAtCap = picked.size >= effectiveMax && !isChecked;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => toggleItem(item.id)}
                    disabled={isAtCap}
                    title={isAtCap ? '已达上限' : undefined}
                    className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                      isChecked
                        ? 'bg-rose-50'
                        : isAtCap
                          ? 'cursor-not-allowed opacity-40'
                          : 'hover:bg-gray-50'
                    }`}
                  >
                    <div
                      className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                        isChecked
                          ? 'border-rose-500 bg-rose-500'
                          : 'border-gray-300 bg-white'
                      }`}
                    >
                      {isChecked && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {formatMeta(item)}
                      </p>
                      {item.preview && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">
                          {item.preview}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Sentinel for infinite scroll */}
          {nextCursor && (
            <div ref={sentinelRef} className="flex justify-center py-3">
              {isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-4">
          <p className="text-xs text-gray-400">
            {`${picked.size} / ${effectiveMax}`}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleConfirm}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50"
            >
              {`确认 (${picked.size} 项)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
