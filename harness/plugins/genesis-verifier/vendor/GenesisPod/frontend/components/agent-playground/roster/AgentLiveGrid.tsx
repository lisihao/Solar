'use client';

import { useState } from 'react';
import {
  Brain,
  Search,
  GitBranch,
  PenLine,
  Gavel,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Wrench,
  Eye,
  Lightbulb,
  Repeat,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import type {
  AgentLiveState,
  AgentRole,
  AgentTraceItem,
} from '@/lib/features/agent-playground/mission-presentation.types';
import { ExpandableText } from '@/components/agent-playground/ui';

const ROLE_META: Record<
  AgentRole,
  { Icon: typeof Brain; label: string; tone: string }
> = {
  leader: { Icon: Brain, label: 'Leader', tone: 'violet' },
  researcher: { Icon: Search, label: 'Researcher', tone: 'sky' },
  analyst: { Icon: GitBranch, label: 'Analyst', tone: 'amber' },
  writer: { Icon: PenLine, label: 'Writer', tone: 'rose' },
  reviewer: { Icon: Gavel, label: 'Reviewer', tone: 'emerald' },
};

const TONE_CLASS: Record<string, { bg: string; text: string; ring: string }> = {
  violet: {
    bg: 'bg-violet-50',
    text: 'text-violet-600',
    ring: 'ring-violet-200',
  },
  sky: { bg: 'bg-sky-50', text: 'text-sky-600', ring: 'ring-sky-200' },
  amber: {
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    ring: 'ring-amber-200',
  },
  rose: { bg: 'bg-rose-50', text: 'text-rose-600', ring: 'ring-rose-200' },
  emerald: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    ring: 'ring-emerald-200',
  },
};

function PhaseBadge({ phase }: { phase: AgentLiveState['phase'] }) {
  if (phase === 'completed')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 className="h-3 w-3" /> Done
      </span>
    );
  if (phase === 'running')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200">
        <Loader2 className="h-3 w-3 animate-spin" /> Running
      </span>
    );
  if (phase === 'failed')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-200">
        <XCircle className="h-3 w-3" /> Failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}

function compactScalar(v: unknown, maxLen = 80): string {
  if (v == null) return '∅';
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[${v.length}]`;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 0) return '{}';
    return `{${keys.slice(0, 3).join(',')}${keys.length > 3 ? '…' : ''}}`;
  }
  return String(v);
}

function previewOutput(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') {
    const trimmed = output.trim();
    // 字符串其实是 JSON 时尝试解析后取摘要
    if (
      (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
      (trimmed.endsWith('}') || trimmed.endsWith(']') || trimmed.endsWith('…'))
    ) {
      try {
        return previewOutput(JSON.parse(trimmed.replace(/…$/, '')));
      } catch {
        // 字符串不是合法 JSON 就走通用截断
      }
    }
    return trimmed.length > 240 ? trimmed.slice(0, 240) + '…' : trimmed;
  }
  if (Array.isArray(output)) {
    if (output.length === 0) return '(empty array)';
    // search 类工具返回 [{title, url, snippet}, ...]，挑前 3 条标题
    const titles = output
      .slice(0, 3)
      .map((it) => {
        if (it && typeof it === 'object') {
          const o = it as Record<string, unknown>;
          const t = o.title ?? o.name ?? o.url ?? o.headline ?? o.heading;
          if (typeof t === 'string') return t;
          // fallback：列出前几个 key
          return compactScalar(o);
        }
        return compactScalar(it);
      })
      .map((s) => (s.length > 80 ? s.slice(0, 80) + '…' : s));
    return `${output.length} items · ${titles.join(' / ')}`;
  }
  if (typeof output === 'object') {
    const o = output as Record<string, unknown>;
    if (typeof o.preview === 'string') return o.preview.slice(0, 240);
    if (typeof o.summary === 'string') return o.summary.slice(0, 240);
    if (typeof o.text === 'string') return o.text.slice(0, 240);
    // 显示首 3 个字段，值用 compactScalar 而不是 String()
    const entries = Object.entries(o).slice(0, 3);
    return entries.map(([k, v]) => `${k}: ${compactScalar(v)}`).join(' · ');
  }
  try {
    const s = JSON.stringify(output);
    return s.length > 240 ? s.slice(0, 240) + '…' : s;
  } catch {
    return String(output);
  }
}

function previewSearchResults(output: unknown):
  | {
      title: string;
      url?: string;
      snippet?: string;
    }[]
  | null {
  // 接受多种 shape: array, {results:[]}, {items:[]}, {hits:[]}, {output:[]}
  let arr: unknown[] | null = null;
  if (Array.isArray(output)) arr = output;
  else if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    if (Array.isArray(o.results)) arr = o.results;
    else if (Array.isArray(o.items)) arr = o.items;
    else if (Array.isArray(o.hits)) arr = o.hits;
    else if (Array.isArray(o.output)) arr = o.output;
    else if (Array.isArray(o.data)) arr = o.data;
  } else if (typeof output === 'string') {
    const trimmed = output.trim().replace(/…$/, '');
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return previewSearchResults(parsed);
    } catch {
      // JSON 截断时 parse 失败 → 退化为正则抓 title/url 对
      const matches: { title: string; url?: string; snippet?: string }[] = [];
      const titleRe = /"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
      const urlRe = /"url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
      const titles = [...trimmed.matchAll(titleRe)].map((m) => m[1]);
      const urls = [...trimmed.matchAll(urlRe)].map((m) => m[1]);
      const n = Math.max(titles.length, urls.length);
      for (let i = 0; i < Math.min(n, 5); i++) {
        if (titles[i] || urls[i]) {
          matches.push({ title: titles[i] || urls[i] || '', url: urls[i] });
        }
      }
      return matches.length > 0 ? matches : null;
    }
  }
  if (!arr) return null;
  return arr.slice(0, 5).map((it) => {
    if (!it || typeof it !== 'object') return { title: String(it) };
    const o = it as Record<string, unknown>;
    return {
      title:
        (typeof o.title === 'string' && o.title) ||
        (typeof o.name === 'string' && o.name) ||
        (typeof o.headline === 'string' && o.headline) ||
        (typeof o.url === 'string' && o.url) ||
        'untitled',
      url:
        (typeof o.url === 'string' && o.url) ||
        (typeof o.link === 'string' && o.link) ||
        undefined,
      snippet:
        (typeof o.snippet === 'string' && o.snippet) ||
        (typeof o.description === 'string' && o.description) ||
        (typeof o.summary === 'string' && o.summary) ||
        (typeof o.content === 'string' && o.content) ||
        undefined,
    };
  });
}

function TraceItem({ item }: { item: AgentTraceItem }) {
  if (item.kind === 'thought')
    return (
      <li className="flex gap-2 rounded-md bg-amber-50/40 px-2 py-1.5">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <div className="flex-1 text-[12px] leading-relaxed text-gray-800">
          <span className="font-semibold text-amber-700">思考 · </span>
          <ExpandableText
            text={item.text || '(空)'}
            maxChars={200}
            className=""
          />
        </div>
      </li>
    );
  if (item.kind === 'action')
    return (
      <li className="flex gap-2 rounded-md bg-violet-50/40 px-2 py-1.5">
        <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
        <div className="flex-1 text-[12px] leading-relaxed text-gray-800">
          <span className="font-semibold text-violet-700">Action · </span>
          <span className="font-mono rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800">
            {item.toolId || 'unknown'}
          </span>
          {item.input != null && (
            <span className="ml-1.5 text-gray-600">
              {previewOutput(item.input)}
            </span>
          )}
        </div>
      </li>
    );
  if (item.kind === 'observation') {
    const search = !item.error ? previewSearchResults(item.output) : null;
    return (
      <li className="flex gap-2 rounded-md bg-sky-50/40 px-2 py-1.5">
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
        <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-gray-800">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-sky-700">Observation</span>
            {item.toolId && (
              <span className="text-gray-500">
                · <span className="font-mono text-[11px]">{item.toolId}</span>
              </span>
            )}
            {item.latencyMs != null && (
              <span className="font-mono text-[10px] text-gray-400">
                {item.latencyMs}ms
              </span>
            )}
            {item.tokensUsed != null && item.tokensUsed > 0 && (
              <span className="font-mono text-[10px] text-amber-600">
                +{item.tokensUsed}tk
              </span>
            )}
          </div>
          {item.error ? (
            <p className="mt-1 text-[11px] text-red-600">{item.error}</p>
          ) : search && search.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {search.map((r, i) => (
                <li
                  key={`${r.url ?? r.title}-${i}`}
                  className="rounded border border-sky-100 bg-white/60 px-2 py-1"
                >
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="line-clamp-1 text-[11px] font-medium text-sky-700 hover:underline"
                    >
                      {r.title}
                    </a>
                  ) : (
                    <p className="line-clamp-1 text-[11px] font-medium text-gray-800">
                      {r.title}
                    </p>
                  )}
                  {r.snippet && (
                    <ExpandableText
                      text={r.snippet}
                      maxChars={140}
                      className="mt-0.5 block text-[10px] text-gray-500"
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <ExpandableText
              text={previewOutput(item.output)}
              maxChars={180}
              className="mt-1 block text-[11px] text-gray-600"
            />
          )}
        </div>
      </li>
    );
  }
  if (item.kind === 'reflection')
    return (
      <li className="flex gap-2 rounded-md bg-purple-50/40 px-2 py-1.5">
        <Repeat className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-500" />
        <p className="flex-1 text-[12px] leading-relaxed text-gray-800">
          <span className="font-semibold text-purple-700">Reflexion · </span>
          {item.text || '(empty)'}
        </p>
      </li>
    );
  return (
    <li className="flex gap-2 rounded-md bg-red-50/40 px-2 py-1.5">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
      <p className="flex-1 text-[12px] text-red-700">{item.error}</p>
    </li>
  );
}

function AgentCard({ agent }: { agent: AgentLiveState }) {
  // 防御：未知 role（如 sub-agent 漏到这里）走 fallback 而不是直接 ROLE_META[role].Icon 崩溃
  const meta = ROLE_META[agent.role] ?? {
    Icon: Brain,
    label: agent.role,
    tone: 'violet',
  };
  const tone = TONE_CLASS[meta.tone] ?? TONE_CLASS.violet;
  const Icon = meta.Icon;
  const [expanded, setExpanded] = useState(false);
  const trace = expanded ? agent.trace : agent.trace.slice(-4);
  const dur =
    agent.startedAt && agent.endedAt
      ? `${((agent.endedAt - agent.startedAt) / 1000).toFixed(1)}s`
      : agent.startedAt
        ? '…'
        : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone.bg} ${tone.text} ring-1 ${tone.ring}`}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {meta.label}
              {agent.attempt && agent.attempt > 1 && (
                <span className="ml-1 text-[10px] font-normal text-gray-400">
                  （第 {agent.attempt} 轮）
                </span>
              )}
            </p>
            <p className="font-mono text-[10px] text-gray-400">
              {agent.dimension ?? agent.agentId}
            </p>
          </div>
        </div>
        <PhaseBadge phase={agent.phase} />
      </div>

      <div className="mb-2 flex items-center gap-3 text-[10px] text-gray-500">
        {dur && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {dur}
          </span>
        )}
        {agent.iterations != null && agent.iterations > 0 && (
          <span>· {agent.iterations} 次迭代</span>
        )}
        <span className="ml-auto">{agent.trace.length} 条 trace</span>
      </div>

      {agent.trace.length === 0 ? (
        <EmptyState
          icon={<Loader2 className="h-8 w-8 animate-spin" />}
          title={
            agent.phase === 'pending'
              ? '等待启动…'
              : agent.phase === 'completed'
                ? '已完成（执行轨迹已从内存释放）'
                : agent.phase === 'failed'
                  ? '已失败（执行轨迹已从内存释放）'
                  : '执行中（暂无 trace 事件）…'
          }
          size="sm"
        />
      ) : (
        <>
          <ul className="space-y-1.5">
            {trace.map((item, i) => (
              <TraceItem key={`${item.ts}-${i}`} item={item} />
            ))}
          </ul>
          {agent.trace.length > 4 && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-gray-100 bg-gray-50 py-1.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100"
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
              {expanded ? '收起' : `展开全部 ${agent.trace.length} 条 trace`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function AgentLiveGrid({ agents }: { agents: AgentLiveState[] }) {
  if (agents.length === 0) {
    return (
      <EmptyState
        icon={<Loader2 className="h-12 w-12 animate-spin" />}
        title="等待 Agent 启动"
        description="Leader 拆分维度后，并行 Researcher 会出现在这里"
        size="md"
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-900">实时 Agent 协作</h3>
        <span className="text-xs text-gray-500">
          进行中 {agents.filter((a) => a.phase === 'running').length} · 完成{' '}
          {agents.filter((a) => a.phase === 'completed').length}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {agents.map((a) => (
          <AgentCard key={a.agentId} agent={a} />
        ))}
      </div>
    </div>
  );
}
