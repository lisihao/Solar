'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  const router = useRouter();
  useEffect(() => {
    // Log to error tracking in production
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-red-50">
          <AlertTriangle className="h-7 w-7 text-red-500" />
        </div>
        <h1 className="mb-2 text-xl font-bold text-gray-900">加载任务详情失败</h1>
        <p className="mb-6 text-sm text-gray-500">
          {error.message ?? '发生了未知错误，请重试'}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push('/ai-social')}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" />
            返回列表
          </button>
          <button
            type="button"
            onClick={reset}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 px-4 py-2.5 text-sm font-medium text-white shadow-md hover:shadow-lg"
          >
            <RefreshCw className="h-4 w-4" />
            重试
          </button>
        </div>
      </div>
    </div>
  );
}
