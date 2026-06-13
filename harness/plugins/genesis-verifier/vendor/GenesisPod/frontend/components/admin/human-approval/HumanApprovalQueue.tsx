'use client';

/**
 * HumanApprovalQueue
 *
 * 展示所有等待人类审批的请求，5 秒自动刷新。
 * 无需 props — 自主轮询 /api/v1/admin/approvals/pending。
 */

import { RefreshCw, CheckCheck, AlertCircle, Loader } from 'lucide-react';
import { useApprovalQueue } from './useApprovalQueue';
import { ApprovalCard } from './ApprovalCard';

export function HumanApprovalQueue() {
  const { approvals, loading, error, responding, respond, refresh } =
    useApprovalQueue();

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          {loading && <Loader className="h-3.5 w-3.5 animate-spin" />}
          <span>
            {approvals.length > 0
              ? `${approvals.length} 条待审批`
              : '暂无待审批请求'}
          </span>
          <span className="text-[11px] text-gray-600">· 每 5 秒自动刷新</span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
          />
          刷新
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && approvals.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 py-16">
          <CheckCheck className="h-10 w-10 text-green-500/40" />
          <p className="text-sm text-gray-500">所有审批已处理完毕</p>
        </div>
      )}

      {/* Approval cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {approvals.map((a) => (
          <ApprovalCard
            key={a.requestId}
            approval={a}
            isBusy={responding.has(a.requestId)}
            onRespond={(payload) => respond(a.requestId, payload)}
          />
        ))}
      </div>
    </div>
  );
}
