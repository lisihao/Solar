'use client';

import { useState } from 'react';
import { CitationBadge } from './CitationBadge';

interface CitationGroupProps {
  citations: Array<{
    index: number;
    evidence: {
      id: string;
      title?: string | null;
      url?: string | null;
      snippet?: string | null;
      domain?: string | null;
    };
    key: string;
  }>;
}

export function CitationGroup({ citations }: CitationGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (citations.length <= 2) {
    // No folding needed for 2 or fewer
    return (
      <>
        {citations.map((c) => (
          <CitationBadge key={c.key} index={c.index} evidence={c.evidence} />
        ))}
      </>
    );
  }

  if (isExpanded) {
    return (
      <span className="inline">
        {citations.map((c) => (
          <CitationBadge key={c.key} index={c.index} evidence={c.evidence} />
        ))}
        <sup
          onClick={() => setIsExpanded(false)}
          className="ml-0.5 cursor-pointer rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-500 hover:bg-gray-200"
          title="折叠引注"
        >
          &#x25C0;
        </sup>
      </span>
    );
  }

  // Collapsed state: show first citation number + count badge
  const first = citations[0];
  return (
    <span
      onClick={() => setIsExpanded(true)}
      className="cursor-pointer"
      title={`展开 ${citations.length} 条引注`}
    >
      <sup className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-200">
        [{first.index} 等{citations.length}项]
      </sup>
    </span>
  );
}
