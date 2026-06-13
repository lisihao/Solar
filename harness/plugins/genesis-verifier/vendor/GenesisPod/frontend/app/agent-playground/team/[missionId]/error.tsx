'use client';

/**
 * Mission Detail ErrorBoundary
 *
 * Next.js App Router 约定：error.tsx 自动成为 [missionId] 路由段的 ErrorBoundary。
 * 这一层独立于 app/global-error.tsx —— 全局只兜底 layout 级崩溃，这里专门抓
 * mission detail 渲染异常（最常见来自 canonical view shape mismatch / shim 转换错误），
 * 让用户看到具体错误而不是空白"出错了"。
 *
 * 同时把错误上报到 backend（POST /api/v1/playground/error-report），
 * 让我能从 Railway 日志里看到所有 mission 详情页崩溃，不再依赖用户截图。
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ChevronLeft, Bug } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

interface ErrorPayload {
  missionId: string;
  message: string;
  stack?: string;
  digest?: string;
  pathname: string;
  userAgent: string;
  timestamp: string;
}

async function reportError(payload: ErrorPayload): Promise<void> {
  try {
    const baseUrl = config.getBackendUrl();
    const auth = getAuthHeader();
    await fetch(`${baseUrl}/api/v1/playground/error-report`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(auth.Authorization ? { Authorization: auth.Authorization } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // 上报失败不能再让用户看到第二个错误，silent
    });
  } catch {
    // 同上
  }
}

export default function MissionDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams();
  const router = useRouter();
  const missionId = (params?.missionId as string) ?? 'unknown';
  const [reported, setReported] = useState(false);

  useEffect(() => {
    void reportError({
      missionId,
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      pathname:
        typeof window !== 'undefined' ? window.location.pathname : 'ssr',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'ssr',
      timestamp: new Date().toISOString(),
    }).then(() => setReported(true));
    // eslint-disable-next-line no-console
    console.error('[MissionDetail] render error:', error);
  }, [error, missionId]);

  const stackPreview = (error.stack ?? error.message ?? '')
    .split('\n')
    .slice(0, 5)
    .join('\n');

  return (
    <div className="flex h-full flex-col items-center justify-center bg-gray-50 p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-red-200 bg-white p-8 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-gray-900">
              该 Mission 解析异常
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Mission ID:{' '}
              <span className="font-mono text-xs text-gray-500">
                {missionId}
              </span>
            </p>

            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <div className="font-medium">{error.message || '未知错误'}</div>
              {error.digest && (
                <div className="font-mono mt-1 text-[10px] text-red-600">
                  digest: {error.digest}
                </div>
              )}
            </div>

            {stackPreview && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
                  错误堆栈（前 5 行）
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-700">
                  {stackPreview}
                </pre>
              </details>
            )}

            <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
              <Bug className="h-3 w-3" />
              <span>
                {reported
                  ? '已自动上报到后端，工程团队会跟进'
                  : '正在上报到后端…'}
              </span>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <RefreshCw className="h-4 w-4" />
                重试渲染
              </button>
              <button
                type="button"
                onClick={() => router.push('/agent-playground')}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <ChevronLeft className="h-4 w-4" />
                返回 Mission 列表
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
