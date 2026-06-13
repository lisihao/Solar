'use client';

import { useState } from 'react';

interface InsightCardProps {
  title: string;
  icon: string;
  children: React.ReactNode;
}

export function InsightCard({ title, icon, children }: InsightCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-100"
      >
        <svg
          className="h-4 w-4 flex-shrink-0 text-purple-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d={icon}
          />
        </svg>
        <span className="flex-1 text-xs font-medium text-gray-700">
          {title}
        </span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
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
      </button>
      {isExpanded && <div className="bg-white px-3 pb-3">{children}</div>}
    </div>
  );
}
