'use client';

/**
 * ConnectionCardSkeleton - 连接卡片骨架屏
 * 用于 AI Social 平台连接加载时的占位符
 */
export function ConnectionCardSkeleton() {
  return (
    <div className="relative rounded-xl border border-gray-200 bg-white p-6">
      {/* Header - Platform Icon and Name */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Platform Icon */}
          <div className="h-12 w-12 animate-pulse rounded-xl bg-gray-200" />

          {/* Platform Name and Account */}
          <div className="space-y-2">
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
            <div className="h-3 w-32 animate-pulse rounded bg-gray-100" />
          </div>
        </div>

        {/* Status Icon */}
        <div className="h-4 w-4 animate-pulse rounded-full bg-gray-200" />
      </div>

      {/* Connection Status */}
      <div className="space-y-3">
        {/* Status Label */}
        <div className="flex items-center gap-2">
          <div className="h-3 w-12 animate-pulse rounded bg-gray-200" />
          <div className="h-3 w-20 animate-pulse rounded bg-gray-200" />
        </div>

        {/* Last Sync Time */}
        <div className="h-3 w-40 animate-pulse rounded bg-gray-100" />

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <div className="h-9 flex-1 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-9 w-12 animate-pulse rounded-lg bg-gray-100" />
        </div>
      </div>
    </div>
  );
}

/**
 * ConnectionCardSkeletonGrid - 连接卡片网格骨架屏
 * 显示多个连接卡片的加载状态
 */
export function ConnectionCardSkeletonGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <ConnectionCardSkeleton key={index} />
      ))}
    </div>
  );
}
