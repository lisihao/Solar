'use client';

/**
 * RadarHistoricalItemsPanel —— 已收录信号面板（R13.5 2026-05-19 新增）
 *
 * 背景：daily briefing 只显示「当日 publishedAt 窗口内的高分 item」。Cisco
 * blogs 一天通常 0-2 篇，导致今日 briefing 经常 0 信号 —— 但 DB 里其实
 * 已经存了 N 条历史 item（accepted 或不 accepted）。
 *
 * 本面板直接读 GET /radar/topics/:id/feed?acceptedOnly=true，展示 DB 中
 * 所有已通过评分门槛的 item，让用户看到"系统确实在工作，只是今天没新的"。
 *
 * 设计：
 * - 默认仅显示 accepted=true（已通过 rel≥60+qual≥50 门槛）
 * - 切换 toggle 可看全部（含未通过）便于诊断
 * - 每条显示：title / source / publishedAt / rel/qual 分 / accepted badge
 * - 标题可点击跳原文
 */

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
} from 'lucide-react';

import { listFeed } from '@/services/ai-radar/api';
import { EmptyState } from '@/components/ui/states/EmptyState';
import type { RadarItem } from '@/services/ai-radar/types';

interface Props {
  topicId: string;
}

export function RadarHistoricalItemsPanel({ topicId }: Props) {
  const [items, setItems] = useState<RadarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [acceptedOnly, setAcceptedOnly] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listFeed(topicId, { acceptedOnly, limit: 30 })
      .then((resp) => {
        if (cancelled) return;
        setItems(resp.items);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [topicId, acceptedOnly]);

  const acceptedCount = items.filter((i) => i.accepted).length;

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-800">已收录信号</h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {items.length}
            {acceptedOnly && ` 已入选`}
          </span>
          {!acceptedOnly && acceptedCount > 0 && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              {acceptedCount} 已入选
            </span>
          )}
        </div>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-gray-100 p-4">
          {/* Filter toggle */}
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs leading-relaxed text-gray-500">
              DB
              中所有已采集并评分的内容。每日精选只展示当日发布的高分信号，本面板列出全部历史。
            </p>
            <div className="flex items-center gap-1 rounded-md border border-gray-200 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setAcceptedOnly(true)}
                className={`rounded px-2 py-0.5 font-medium ${
                  acceptedOnly
                    ? 'bg-violet-100 text-violet-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                仅已入选
              </button>
              <button
                type="button"
                onClick={() => setAcceptedOnly(false)}
                className={`rounded px-2 py-0.5 font-medium ${
                  !acceptedOnly
                    ? 'bg-violet-100 text-violet-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                全部
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-gray-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="mr-1 inline-block h-3 w-3" />
              加载失败：{error}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              size="sm"
              title="暂无信号"
              description={
                acceptedOnly
                  ? 'DB 中尚无已入选的信号 — 试试点上方的"重新精选"，等评分跑完后回来看'
                  : 'DB 中没有任何已采集的 item'
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <HistoricalItemRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function HistoricalItemRow({ item }: { item: RadarItem }) {
  const date = formatDate(item.publishedAt);
  const sourceLabel = item.source?.label ?? item.source?.identifier ?? '未知源';

  return (
    <li className="rounded-lg border border-gray-100 bg-gray-50/40 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-start gap-1 text-sm font-medium text-gray-900 hover:text-violet-700 hover:underline"
            >
              <span className="line-clamp-1">{item.title ?? '(无标题)'}</span>
              <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0 opacity-60" />
            </a>
          ) : (
            <span className="line-clamp-1 text-sm font-medium text-gray-900">
              {item.title ?? '(无标题)'}
            </span>
          )}
          {item.aiSummary && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-500">
              {item.aiSummary}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-gray-500">
            <span className="truncate">{sourceLabel}</span>
            <span>·</span>
            <span>{date}</span>
            <span>·</span>
            <span>
              相关性{' '}
              <span className="font-mono text-gray-700">
                {item.relevanceScore ?? '—'}
              </span>
            </span>
            {item.qualityScore != null && (
              <>
                <span>·</span>
                <span>
                  质量{' '}
                  <span className="font-mono text-gray-700">
                    {item.qualityScore}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
        <span
          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
            item.accepted
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : 'bg-gray-50 text-gray-500 ring-gray-200'
          }`}
        >
          {item.accepted ? '已入选' : '未入选'}
        </span>
      </div>
    </li>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // UTC 时区以避免 SSR/CSR hydration mismatch
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
