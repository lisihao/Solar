'use client';

function SkeletonCard() {
  return (
    <div className="flex animate-pulse flex-col gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:p-6">
      {/* Header row: tier circle + title bar */}
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 rounded-full bg-gray-200" />
        <div className="h-4 w-3/4 rounded bg-gray-200" />
      </div>

      {/* One-line takeaway */}
      <div className="h-3 w-full rounded bg-gray-200" />

      {/* Callout block */}
      <div className="flex flex-col gap-2 rounded-md bg-gray-100 p-3">
        <div className="h-3 w-full rounded bg-gray-200" />
        <div className="h-3 w-5/6 rounded bg-gray-200" />
        <div className="h-3 w-4/6 rounded bg-gray-200" />
        <div className="h-3 w-3/6 rounded bg-gray-200" />
      </div>

      {/* Tags row */}
      <div className="flex gap-2">
        <div className="h-5 w-14 rounded-full bg-gray-200" />
        <div className="h-5 w-18 rounded-full bg-gray-200" />
        <div className="h-5 w-12 rounded-full bg-gray-200" />
      </div>
    </div>
  );
}

interface RadarBriefingSkeletonProps {
  count?: number;
}

export function RadarBriefingSkeleton({
  count = 3,
}: RadarBriefingSkeletonProps) {
  return (
    <div
      className="flex flex-col gap-6"
      aria-label="精选加载中"
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
