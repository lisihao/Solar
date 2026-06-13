'use client';

/**
 * Global Error Page
 * 处理整个应用的未捕获错误（包括 root layout 错误）
 *
 * 注意：这必须是客户端组件，且必须定义自己的 html 和 body 标签
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
          <div className="text-center">
            <h1 className="text-6xl font-bold text-gray-900">500</h1>
            <p className="mt-4 text-xl text-gray-600">服务器错误</p>
            <p className="mt-2 text-gray-500">
              {error.message || '发生了意外错误'}
            </p>
            <button
              onClick={() => reset()}
              className="mt-8 inline-block rounded-lg bg-blue-600 px-6 py-3 text-white transition-colors hover:bg-blue-700"
            >
              重试
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
