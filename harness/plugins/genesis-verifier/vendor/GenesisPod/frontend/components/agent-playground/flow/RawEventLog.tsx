'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Brain,
  Search,
  GitBranch,
  PenLine,
  Gavel,
  Lightbulb,
  Wrench,
  Eye,
  Repeat,
  Coins,
  Database,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Layers,
  Code2,
} from 'lucide-react';
import type { PlaygroundEvent } from '@/hooks/features/useAgentPlaygroundStream';
import { ClientDate } from '@/components/common/ClientDate';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { Card, ExpandableText } from '@/components/agent-playground/ui';

const ROLE_ICON: Record<string, typeof Brain> = {
  leader: Brain,
  researcher: Search,
  analyst: GitBranch,
  writer: PenLine,
  reviewer: Gavel,
};

interface ParsedEvent {
  icon: typeof Activity;
  iconColor: string;
  title: string;
  subtitle?: string;
  body?: React.ReactNode;
  tone:
    | 'gray'
    | 'violet'
    | 'sky'
    | 'amber'
    | 'emerald'
    | 'red'
    | 'rose'
    | 'purple';
}

const TONE_BG: Record<ParsedEvent['tone'], string> = {
  gray: 'bg-gray-50',
  violet: 'bg-violet-50/40',
  sky: 'bg-sky-50/40',
  amber: 'bg-amber-50/40',
  emerald: 'bg-emerald-50/40',
  red: 'bg-red-50/40',
  rose: 'bg-rose-50/40',
  purple: 'bg-purple-50/40',
};

function previewObject(o: unknown, maxLen = 120): string {
  if (o == null) return '';
  if (typeof o === 'string')
    return o.length > maxLen ? o.slice(0, maxLen) + '…' : o;
  if (Array.isArray(o)) {
    if (o.length === 0) return '(empty)';
    const t = o
      .slice(0, 3)
      .map((it) => {
        if (it && typeof it === 'object') {
          const r = it as Record<string, unknown>;
          return (r.title || r.name || r.url || JSON.stringify(it)) as string;
        }
        return String(it);
      })
      .map((s) => (typeof s === 'string' ? s.slice(0, 60) : String(s)))
      .join(' / ');
    return `${o.length} items · ${t}`;
  }
  if (typeof o === 'object') {
    const e = Object.entries(o as Record<string, unknown>).slice(0, 3);
    return e.map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' · ');
  }
  return String(o);
}

function parseEvent(ev: PlaygroundEvent): ParsedEvent {
  const t = ev.type.replace('playground.', '');
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  const role = (p.role as string) ?? '';
  const RoleIcon = role && ROLE_ICON[role] ? ROLE_ICON[role] : null;

  switch (t) {
    case 'mission:started': {
      const input = (p.input ?? {}) as {
        topic?: string;
        depth?: string;
        language?: string;
      };
      return {
        icon: Sparkles,
        iconColor: 'text-violet-500',
        tone: 'violet',
        title: 'Mission started',
        subtitle: input.topic ?? '(no topic)',
        body: (
          <p className="text-[11px] text-gray-500">
            {input.depth ?? '?'} · {input.language ?? '?'}
          </p>
        ),
      };
    }
    case 'mission:completed': {
      const score = (p.reviewScore as number | undefined) ?? '?';
      const tk = (p.tokensUsed as number | undefined) ?? 0;
      return {
        icon: CheckCircle2,
        iconColor: 'text-emerald-500',
        tone: 'emerald',
        title: 'Mission completed',
        subtitle: `Score ${score} · ${tk} tokens · ${Math.floor(((p.wallTimeMs as number) ?? 0) / 1000)}s`,
      };
    }
    case 'mission:failed':
      return {
        icon: XCircle,
        iconColor: 'text-red-500',
        tone: 'red',
        title: 'Mission failed',
        subtitle: (p.message as string) ?? '(no message)',
      };
    case 'mission:rejected':
      return {
        icon: XCircle,
        iconColor: 'text-amber-500',
        tone: 'amber',
        title: 'Mission rejected',
        subtitle: (p.userMessage as string) ?? (p.reason as string),
      };
    case 'stage:started': {
      const stage = p.stage as string;
      const dims = (p.dimensions as unknown[]) ?? [];
      return {
        icon: Layers,
        iconColor: 'text-blue-500',
        tone: 'sky',
        title: `Stage started · ${stage}`,
        subtitle:
          stage === 'researchers' && dims.length > 0
            ? `${dims.length} dimensions to research`
            : typeof p.attempt === 'number'
              ? `attempt #${p.attempt}`
              : undefined,
      };
    }
    case 'stage:completed': {
      const stage = p.stage as string;
      const score = p.score as number | undefined;
      const dims = (p.dimensions as unknown[]) ?? [];
      let sub: string | undefined;
      if (stage === 'leader' && dims.length > 0)
        sub = `produced ${dims.length} dimensions`;
      else if (stage === 'reviewer' && score != null)
        sub = `consensus score ${score} · ${(p.decision as string | undefined) ?? '?'}`;
      else if (typeof p.insightsCount === 'number')
        sub = `${p.insightsCount} insights`;
      return {
        icon: CheckCircle2,
        iconColor: 'text-emerald-500',
        tone: 'emerald',
        title: `Stage completed · ${stage}`,
        subtitle: sub,
      };
    }
    case 'agent:lifecycle': {
      const agentId = (p.agentId as string) ?? '?';
      const phase = p.phase as string;
      const wallMs = p.wallTimeMs as number | undefined;
      const Icon = RoleIcon ?? Activity;
      const color =
        phase === 'completed'
          ? 'text-emerald-500'
          : phase === 'failed'
            ? 'text-red-500'
            : 'text-violet-500';
      const tone =
        phase === 'completed'
          ? 'emerald'
          : phase === 'failed'
            ? 'red'
            : 'violet';
      return {
        icon: Icon,
        iconColor: color,
        tone,
        title: `${agentId} ${phase}`,
        subtitle: wallMs != null ? `${(wallMs / 1000).toFixed(1)}s` : undefined,
      };
    }
    case 'agent:thought':
      return {
        icon: Lightbulb,
        iconColor: 'text-amber-500',
        tone: 'amber',
        title: `${(p.agentId as string) ?? 'agent'} thinking`,
        subtitle: (p.text as string) ?? '(empty)',
      };
    case 'agent:action': {
      const tool =
        (p.toolId as string) ?? (p.skillId as string) ?? (p.kind as string);
      return {
        icon: Wrench,
        iconColor: 'text-violet-500',
        tone: 'violet',
        title: `${(p.agentId as string) ?? 'agent'} → ${tool}`,
        subtitle: previewObject(p.input ?? p.calls, 160),
      };
    }
    case 'agent:observation': {
      const tool = (p.toolId as string) ?? (p.kind as string) ?? '?';
      const lat = p.latencyMs as number | undefined;
      const tk = p.tokensUsed as number | undefined;
      const err = p.error as string | undefined;
      const meta = [
        lat != null ? `${lat}ms` : null,
        tk != null && tk > 0 ? `+${tk}tk` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        icon: Eye,
        iconColor: err ? 'text-red-500' : 'text-sky-500',
        tone: err ? 'red' : 'sky',
        title: `${(p.agentId as string) ?? 'agent'} ← ${tool}`,
        subtitle: meta,
        body: err ? (
          <p className="text-[11px] text-red-600">{err}</p>
        ) : (
          <ExpandableText
            text={previewObject(p.output, 600)}
            maxChars={180}
            className="block text-[11px] text-gray-600"
          />
        ),
      };
    }
    case 'agent:reflection':
      return {
        icon: Repeat,
        iconColor: 'text-purple-500',
        tone: 'purple',
        title: `${(p.agentId as string) ?? 'agent'} reflection`,
        subtitle: (p.text as string) ?? (p.verdict as string),
      };
    case 'agent:error':
      return {
        icon: AlertCircle,
        iconColor: 'text-red-500',
        tone: 'red',
        title: `${(p.agentId as string) ?? 'agent'} error`,
        subtitle: (p.message as string) ?? '(no message)',
      };
    case 'researcher:completed': {
      const dim = p.dimension as string;
      const findings = p.findingsCount as number | undefined;
      const state = p.state as string;
      return {
        icon: Search,
        iconColor: state === 'completed' ? 'text-sky-500' : 'text-amber-500',
        tone: 'sky',
        title: `Researcher · ${dim}`,
        subtitle: `${state} · ${findings ?? 0} findings · ${Math.floor(((p.wallTimeMs as number) ?? 0) / 1000)}s`,
      };
    }
    case 'verifier:verdict': {
      const id = p.verifierId as string;
      const score = p.score as number;
      const critique = p.critique as string | undefined;
      return {
        icon: Gavel,
        iconColor:
          score >= 80
            ? 'text-emerald-500'
            : score >= 60
              ? 'text-amber-500'
              : 'text-red-500',
        tone: 'rose',
        title: `Judge · ${id} → ${score} / 100`,
        subtitle:
          typeof p.attempt === 'number' ? `attempt #${p.attempt}` : undefined,
        body: critique ? (
          <ExpandableText
            text={critique}
            maxChars={220}
            className="block text-[11px] text-gray-600"
          />
        ) : undefined,
      };
    }
    case 'cost:tick': {
      const stage = p.stage as string;
      const delta = (p.deltaTokens as number) ?? 0;
      const total = p.tokensUsed as number;
      return {
        icon: Coins,
        iconColor: 'text-amber-500',
        tone: 'amber',
        title: `Cost · ${stage}`,
        subtitle: `+${delta} tokens (total ${total ?? '?'})`,
      };
    }
    case 'budget:exhausted':
      return {
        icon: AlertCircle,
        iconColor: 'text-amber-500',
        tone: 'amber',
        title: 'Budget exhausted',
        subtitle: previewObject(p, 200),
      };
    case 'memory:indexed': {
      const chunks = p.chunks as number | undefined;
      // Normalize tags: could be string[], undefined, or contain non-string items
      const rawTags = p.tags;
      const tags: string[] = Array.isArray(rawTags)
        ? rawTags.map((t) => (typeof t === 'string' ? t : String(t ?? '')))
        : [];
      return {
        icon: Database,
        iconColor: 'text-emerald-500',
        tone: 'emerald',
        title: `Memory indexed · ${chunks ?? 0} chunks`,
        subtitle: tags.join(' · '),
      };
    }
    case 'report:draft':
      return {
        icon: PenLine,
        iconColor: 'text-rose-500',
        tone: 'rose',
        title: `Report draft · attempt ${(p.attempt as number | undefined) ?? '?'}`,
        subtitle: (p.report as { title?: string })?.title,
      };
    default:
      return {
        icon: Activity,
        iconColor: 'text-gray-400',
        tone: 'gray',
        title: t,
        subtitle: previewObject(p, 200),
      };
  }
}

function EventRow({ ev }: { ev: PlaygroundEvent }) {
  const parsed = parseEvent(ev);
  const Icon = parsed.icon;
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div
      className={`group flex gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-gray-200 ${TONE_BG[parsed.tone]}`}
    >
      <div className="shrink-0 pt-0.5">
        <Icon className={`h-4 w-4 ${parsed.iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-[12px] font-semibold text-gray-900">
            {parsed.title}
          </p>
          {parsed.subtitle && (
            <p className="line-clamp-1 flex-1 text-[11px] text-gray-600">
              {parsed.subtitle}
            </p>
          )}
        </div>
        {parsed.body && <div className="mt-1">{parsed.body}</div>}
      </div>
      <div className="flex shrink-0 items-start gap-2 pt-0.5">
        <span className="font-mono text-[10px] text-gray-400">
          <ClientDate date={ev.timestamp} format="time" />
        </span>
        <button
          type="button"
          onClick={() => setShowRaw((s) => !s)}
          className="rounded p-1 text-gray-300 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100"
          title="Toggle raw JSON"
        >
          <Code2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {showRaw && (
        <div className="absolute z-10 ml-7 mt-7 max-w-2xl rounded-lg border border-gray-200 bg-gray-900 p-3 text-[10px] text-gray-100 shadow-xl">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(ev.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function RawEventLog({ events }: { events: PlaygroundEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events.length, autoScroll]);

  return (
    <Card className="overflow-hidden" bordered>
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-gray-900">事件时间线</h3>
          <span className="text-xs text-gray-500">· 共 {events.length} 条</span>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3 w-3 cursor-pointer rounded border-gray-300 text-violet-600 focus:ring-violet-500"
          />
          自动滚动
        </label>
      </div>
      <div className="max-h-[640px] overflow-y-auto p-3">
        {events.length === 0 ? (
          <EmptyState
            size="sm"
            title="暂无事件"
            description="等待 Mission 启动"
          />
        ) : (
          <div className="space-y-1">
            {events.map((ev, i) => (
              <EventRow key={`${ev.timestamp}-${i}`} ev={ev} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </Card>
  );
}
