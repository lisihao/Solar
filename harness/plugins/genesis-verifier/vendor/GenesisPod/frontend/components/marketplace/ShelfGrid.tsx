'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { EmptyState } from '@/components/ui/states/EmptyState';
import type { AnyListing } from './marketplace.types';
import { ListingCard } from './ListingCard';

interface ShelfGridProps {
  listings: AnyListing[];
  isAcquired: (id: string) => boolean;
  onOpen: (listing: AnyListing) => void;
  onAcquire: (listing: AnyListing) => void;
}

export function ShelfGrid({
  listings,
  isAcquired,
  onOpen,
  onAcquire,
}: ShelfGridProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('全部');

  const categories = useMemo(() => {
    const set = new Set<string>();
    listings.forEach((l) => set.add(l.category));
    return ['全部', ...Array.from(set).sort()];
  }, [listings]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return listings.filter((l) => {
      const inCat = category === '全部' || l.category === category;
      const inTerm =
        !term ||
        l.name.toLowerCase().includes(term) ||
        l.tagline.toLowerCase().includes(term) ||
        l.tags.some((t) => t.toLowerCase().includes(term));
      return inCat && inTerm;
    });
  }, [listings, search, category]);

  return (
    <div className="space-y-4">
      {/* 搜索 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索名称、卖点、标签…"
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* 分类 chips */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              c === category
                ? 'bg-primary text-primary-foreground'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 货架 */}
      {filtered.length === 0 ? (
        <EmptyState type="search" title="没有匹配的结果" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((l) => (
            <ListingCard
              key={l.id}
              listing={l}
              acquired={isAcquired(l.id)}
              onOpen={() => onOpen(l)}
              onAcquire={() => onAcquire(l)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
