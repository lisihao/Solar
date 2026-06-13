'use client';

/**
 * RadarEventLog —— 雷达 mission 实时事件时间线（对齐 playground RawEventLog）
 *
 * 把 useRadarStream 累积的事件流渲成一条条可读时间线：采集源逐个点亮
 * （"Cisco Blogs RSS → 12 条 1.2s" / "某源 → 超时"）、阶段开始/完成、洞察生成…
 * 直接解决"采集 25 秒里 Drawer 看不到任何动作和记录"。
 */

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Database,
  Layers,
  Radar,
  Rss,
  Sparkles,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states';
import { ClientDate } from '@/components/common/ClientDate';
import type { RadarStreamEvent } from '@/services/ai-radar/api';

type Tone = 'gray' | 'violet' | 'sky' | 'amber' | 'emerald' | 'red';

const TONE_BG: Record<Tone, string> = {
  gray: 'bg-gray-50',
  violet: 'bg-violet-50/50',
  sky: 'bg-sky-50/50',
  amber: 'bg-amber-50/50',
  emerald: 'bg-emerald-50/50',
  red: 'bg-red-50/50',
};
const TONE_TEXT: Record<Tone, string> = {
  gray: 'text-gray-400',
  violet: 'text-violet-500',
  sky: 'text-sky-500',
  amber: 'text-amber-500',
  emerald: 'text-emerald-500',
  red: 'text-red-500',
};

interface ParsedEvent {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  subtitle?: string;
}

function rec(payload: unknown): Record<string, unknown> {
  return (payload ?? {}) as Record<string, unknown>;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function parseRadarEvent(ev: RadarStreamEvent): ParsedEvent {
  const t = ev.type.replace('ai-radar.', '');
  const p = rec(ev.payload);

  switch (t) {
    case 'run.started':
      return { icon: Sparkles, tone: 'violet', title: 'Mission 启动' };
    case 'run.stage': {
      const stage = (p.stage as string) ?? '?';
      const status = (p.status as string) ?? '';
      if (status === 'failed')
        return {
          icon: XCircle,
          tone: 'red',
          title: `阶段失败 · ${stage}`,
          subtitle: (p.message as string) ?? undefined,
        };
      if (status === 'completed')
        return {
          icon: CheckCircle2,
          tone: 'emerald',
          title: `阶段完成 · ${stage}`,
        };
      return { icon: Layers, tone: 'sky', title: `阶段开始 · ${stage}` };
    }
    case 'run.source-progress': {
      const label = (p.sourceLabel as string) ?? (p.sourceId as string) ?? '源';
      const items = (p.items as number) ?? 0;
      const durationMs = (p.durationMs as number) ?? 0;
      const err = p.error as string | null | undefined;
      if (err) {
        return {
          icon: AlertCircle,
          tone: 'amber',
          title: `${label} → 失败`,
          subtitle: `${err} · ${fmtMs(durationMs)}`,
        };
      }
      return {
        icon: Rss,
        tone: items > 0 ? 'emerald' : 'gray',
        title: `${label} → ${items} 条`,
        subtitle: fmtMs(durationMs),
      };
    }
    case 'run.completed':
      return {
        icon: CheckCircle2,
        tone: 'emerald',
        title: 'Mission 完成',
        subtitle:
          typeof p.durationMs === 'number'
            ? `耗时 ${fmtMs(p.durationMs)}`
            : undefined,
      };
    case 'run.failed':
      return {
        icon: XCircle,
        tone: 'red',
        title: 'Mission 失败',
        subtitle: (p.error as string) ?? undefined,
      };
    case 'run.cancelled':
      return {
        icon: XCircle,
        tone: 'amber',
        title: 'Mission 取消',
        subtitle: (p.reason as string) ?? undefined,
      };
    case 'insight.created':
      return {
        icon: Sparkles,
        tone: 'violet',
        title: '洞察生成',
        subtitle:
          typeof p.signalCount === 'number'
            ? `${p.signalCount} 信号 · ${(p.entityCount as number) ?? 0} 实体`
            : undefined,
      };
    case 'source.health-changed':
      return {
        icon: Database,
        tone: 'amber',
        title: `源健康 · ${(p.health as string) ?? '?'}`,
        subtitle: `连续失败 ${(p.consecutiveFailures as number) ?? 0} 次`,
      };
    default:
      return { icon: Activity, tone: 'gray', title: t };
  }
}

function EventRow({ ev }: { ev: RadarStreamEvent }) {
  const parsed = parseRadarEvent(ev);
  const Icon = parsed.icon;
  return (
    <div
      className={`flex items-start gap-3 rounded-lg px-3 py-2 ${TONE_BG[parsed.tone]}`}
    >
      <Icon
        className={`mt-0.5 h-4 w-4 flex-shrink-0 ${TONE_TEXT[parsed.tone]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-[12px] font-semibold text-gray-900">
            {parsed.title}
          </p>
          {parsed.subtitle && (
            <p className="line-clamp-1 flex-1 text-[11px] text-gray-600">
              {parsed.subtitle}
            </p>
          )}
        </div>
      </div>
      <span className="font-mono flex-shrink-0 text-[10px] text-gray-400">
        <ClientDate date={ev.timestamp} format="time" />
      </span>
    </div>
  );
}

interface Props {
  events: RadarStreamEvent[];
  /** 标题，默认"事件时间线" */
  title?: string;
  /** 空态提示 */
  emptyHint?: string;
  /** 列表最大高度 class，默认 max-h-[480px] */
  maxHeightClass?: string;
}

export function RadarEventLog({
  events,
  title = '事件时间线',
  emptyHint = '暂无事件 · 等待 Mission 启动',
  maxHeightClass = 'max-h-[480px]',
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events.length, autoScroll]);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <span className="text-xs text-gray-500">· 共 {events.length} 条</span>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3 w-3 cursor-pointer rounded border-gray-300 text-violet-600 focus:ring-violet-500"
          />
          <ChevronDown className="h-3 w-3" />
          自动滚动
        </label>
      </div>
      <div className={`${maxHeightClass} overflow-y-auto p-3`}>
        {events.length === 0 ? (
          <EmptyState size="sm" title={emptyHint} />
        ) : (
          <div className="space-y-1">
            {events.map((ev, i) => (
              <EventRow key={`${ev.timestamp}-${ev.type}-${i}`} ev={ev} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
