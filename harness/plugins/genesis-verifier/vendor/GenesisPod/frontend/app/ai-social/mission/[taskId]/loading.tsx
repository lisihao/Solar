export default function Loading() {
  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header skeleton */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-200" />
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-xl bg-gray-200" />
            <div className="space-y-1.5">
              <div className="h-5 w-48 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-32 animate-pulse rounded bg-gray-200" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-7 w-24 animate-pulse rounded-full bg-gray-200" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-gray-200" />
        </div>
      </div>
      {/* Body skeleton */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel skeleton */}
        <div className="w-[360px] border-r border-gray-200 bg-white p-4">
          <div className="space-y-3">
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
            <div className="h-48 w-full animate-pulse rounded-xl bg-gray-100" />
            <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
            <div className="h-24 w-full animate-pulse rounded-xl bg-gray-100" />
          </div>
        </div>
        {/* Right panel skeleton */}
        <div className="flex flex-1 flex-col p-4">
          <div className="mb-4 flex gap-2">
            {[80, 72, 80, 72, 80, 64].map((w, i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-lg bg-gray-200"
                style={{ width: `${w}px` }}
              />
            ))}
          </div>
          <div className="flex-1 space-y-3">
            <div className="h-24 w-full animate-pulse rounded-xl bg-gray-100" />
            <div className="h-24 w-full animate-pulse rounded-xl bg-gray-100" />
            <div className="h-24 w-full animate-pulse rounded-xl bg-gray-100" />
          </div>
        </div>
      </div>
    </div>
  );
}
