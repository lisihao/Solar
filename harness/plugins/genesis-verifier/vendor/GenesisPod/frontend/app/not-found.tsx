/**
 * 404 Not Found Page
 * App Router 默认 404 页面
 */

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900">404</h1>
        <p className="mt-4 text-xl text-gray-600">页面未找到</p>
        <p className="mt-2 text-gray-500">您访问的页面不存在或已被移除</p>
        <Link
          href="/"
          className="mt-8 inline-block rounded-lg bg-blue-600 px-6 py-3 text-white transition-colors hover:bg-blue-700"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
