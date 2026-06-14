'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number;
  onChange: (v: number) => Promise<void> | void;
  readonly?: boolean;
  size?: 'sm' | 'md';
}

const ICON_SIZE = { sm: 'h-4 w-4', md: 'h-5 w-5' } as const;

export function StarRating({
  value,
  onChange,
  readonly = false,
  size = 'md',
}: StarRatingProps) {
  const [optimistic, setOptimistic] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const displayed = hovered ?? optimistic ?? value;
  const iconCls = ICON_SIZE[size];

  const handleClick = async (star: number) => {
    if (readonly) return;
    const prev = optimistic ?? value;
    setOptimistic(star);
    try {
      await onChange(star);
    } catch (err) {
      console.warn('[StarRating] onChange failed, rolling back', err);
      setOptimistic(prev);
    }
  };

  return (
    <div
      className="inline-flex items-center gap-0.5"
      role="group"
      aria-label="star rating"
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= displayed;
        return (
          <button
            key={star}
            type="button"
            onClick={() => void handleClick(star)}
            onMouseEnter={() => !readonly && setHovered(star)}
            onMouseLeave={() => !readonly && setHovered(null)}
            disabled={readonly}
            aria-label={`${star} star`}
            className={`transition-colors ${readonly ? 'cursor-default' : 'cursor-pointer'}`}
          >
            <Star
              className={`${iconCls} ${
                filled
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-transparent text-gray-300'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
