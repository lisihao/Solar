'use client';

import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

interface DeepDiveButtonProps {
  topicId: string;
  contextTitle: string;
  contextSummary?: string;
  dimensionId?: string;
  size?: 'sm' | 'xs';
  className?: string;
}

export function DeepDiveButton({
  topicId,
  contextTitle,
  contextSummary,
  dimensionId,
  size = 'sm',
  className,
}: DeepDiveButtonProps) {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const params = new URLSearchParams();
    params.set('action', 'create');
    params.set('fromModule', 'topic-insights');
    params.set('fromTopicId', topicId);
    if (dimensionId) params.set('fromDimensionId', dimensionId);
    params.set('contextTitle', contextTitle.slice(0, 200));
    if (contextSummary)
      params.set('contextSummary', contextSummary.slice(0, 500));
    router.push(`/ai-research?${params.toString()}`);
  };

  const sizeClasses =
    size === 'xs' ? 'gap-1 px-2 py-1 text-xs' : 'gap-1.5 px-2.5 py-1.5 text-xs';

  return (
    <button
      onClick={handleClick}
      className={`flex items-center rounded-lg border border-gray-200 bg-white font-medium text-gray-600 transition-colors hover:bg-gray-50 ${sizeClasses} ${className ?? ''}`}
      title="在 AI 研究中深入探索"
    >
      <Search className={size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      <span>深入研究</span>
    </button>
  );
}
