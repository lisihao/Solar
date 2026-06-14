'use client';

import { useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { RadarRawItemsPanel } from '@/components/ai-radar/RadarRawItemsPanel';

export default function RadarRawItemsPage() {
  const params = useParams<{ topicId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const topicId = params?.topicId;
  const date = searchParams?.get('date') ?? undefined;

  const [count, setCount] = useState<number | null>(null);

  if (!topicId) return null;

  const dateLabel = date
    ? (() => {
        const d = new Date(date + 'T00:00:00');
        return `${d.getMonth() + 1}月${d.getDate()}日`;
      })()
    : '全部';

  const backUrl = date
    ? `/ai-radar/topic/${topicId}?date=${date}`
    : `/ai-radar/topic/${topicId}`;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      {/* Back link */}
      <button
        type="button"
        onClick={() => router.push(backUrl)}
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        返回精选
      </button>

      {/* Header */}
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900 md:text-2xl">
          {dateLabel} 全部原始信号
          {count !== null && (
            <span className="ml-2 text-base font-normal text-gray-500">
              ({count} 条)
            </span>
          )}
        </h1>
        {date && (
          <p className="mt-1 text-sm text-gray-500">
            仅显示发布日期为 {date} 的原始条目
          </p>
        )}
      </header>

      {/* Items */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <RadarRawItemsPanel
          topicId={topicId}
          date={date}
          onCountChange={setCount}
        />
      </div>
    </div>
  );
}
