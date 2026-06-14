'use client';

/**
 * /unsubscribed — 邮件退订成功落地页（FC-7）
 *
 * 设计：
 *   - 邮件 footer 链接指向本页 + ?token=xxx
 *   - 本页加载时调后端 GET /api/v1/notifications/unsubscribe?token=xxx
 *   - 根据 response.scope 渲染对应中文成功消息
 *   - **不需要登录**（token-only auth），匿名访问
 *   - 失败时显示 retry 或回主页
 *
 * 不复用 AppShell（未登录场景，无侧栏 / 用户菜单）
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface UnsubResponse {
  success: true;
  scope: string;
  message: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'success'; data: UnsubResponse }
  | { kind: 'consumed' } // F3 修复：token 已消费过（多 scope 邮件其他链接已点过）
  | { kind: 'error'; message: string };

function scopeTitle(scope: string): string {
  switch (scope) {
    case 'global':
      return '已退订全部通知';
    case 'radar_all':
      return '已退订所有 AI 雷达通知';
    case 'weekly':
      return '已退订 AI 雷达周报';
    case 'topic':
      return '已退订该雷达主题';
    default:
      return '退订成功';
  }
}

export default function UnsubscribedPage() {
  const search = useSearchParams();
  const token = search?.get('token') ?? '';
  const scope = search?.get('scope') ?? ''; // FU2-A multi-scope token
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: '缺少 token 参数，无法退订' });
      return;
    }
    const ctrl = new AbortController();
    void (async () => {
      try {
        const qs = new URLSearchParams({ token });
        if (scope) qs.set('scope', scope);
        const resp = await fetch(
          `/api/v1/notifications/unsubscribe?${qs.toString()}`,
          { signal: ctrl.signal, credentials: 'omit' }
        );
        if (!resp.ok) {
          // F3 修复：401 = token 已消费过（多 scope 邮件其他链接已点过）。
          // 这是 success 终态，不是错误——用户的退订意图已落地，再点其他链接
          // 只是想"补充退订"，但 token 一次性，引导前往设置页手动调整即可。
          if (resp.status === 401) {
            setState({ kind: 'consumed' });
            return;
          }
          const body = await resp.text();
          setState({
            kind: 'error',
            message: `退订失败（${resp.status}）：${body.slice(0, 200)}`,
          });
          return;
        }
        const data = (await resp.json()) as UnsubResponse;
        setState({ kind: 'success', data });
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setState({
          kind: 'error',
          message: `网络错误：${(err as Error).message}`,
        });
      }
    })();
    return () => ctrl.abort();
  }, [token, scope]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {state.kind === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-violet-600" />
            <p className="text-sm text-slate-600">处理退订请求…</p>
          </div>
        )}

        {state.kind === 'success' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <h1 className="text-xl font-semibold text-slate-800">
              {scopeTitle(state.data.scope)}
            </h1>
            <p className="text-sm text-slate-600">{state.data.message}</p>
            <Link
              href="/me/notifications"
              className="mt-4 inline-flex items-center gap-1 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              管理通知偏好
            </Link>
            <Link
              href="/"
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              返回首页
            </Link>
          </div>
        )}

        {state.kind === 'consumed' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <h1 className="text-xl font-semibold text-slate-800">
              这次退订请求已生效
            </h1>
            <p className="text-sm text-slate-600">
              如果你想调整不同范围的退订（例如同时退订所有通知），请前往设置页手动配置。
            </p>
            <Link
              href="/me/notifications"
              className="mt-4 inline-flex items-center gap-1 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              管理通知偏好
            </Link>
            <Link
              href="/"
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              返回首页
            </Link>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <h1 className="text-xl font-semibold text-slate-800">退订失败</h1>
            <p className="text-sm text-slate-600">{state.message}</p>
            <Link
              href="/me/notifications"
              className="mt-4 inline-flex items-center gap-1 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              前往设置手动退订
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
