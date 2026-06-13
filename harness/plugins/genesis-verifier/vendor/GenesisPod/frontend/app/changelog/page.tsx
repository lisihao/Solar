'use client';

import { useMemo, useState } from 'react';
import { Sparkles, Bug, Zap, AlertTriangle, History } from 'lucide-react';
import {
  CHANGELOG,
  CURRENT_VERSION,
  getChangeTypeInfo,
} from '@/lib/utils/changelog';
import type { ChangelogEntry } from '@/lib/utils/changelog';
import AppShell from '@/components/layout/AppShell';
import { Tabs } from '@/components/ui/tabs/Tabs';

type ChangeType = ChangelogEntry['changes'][0]['type'];

const typeIcons: Record<ChangeType, React.ReactNode> = {
  feature: <Sparkles className="h-4 w-4" />,
  fix: <Bug className="h-4 w-4" />,
  improvement: <Zap className="h-4 w-4" />,
  breaking: <AlertTriangle className="h-4 w-4" />,
};

const statConfig: {
  type: ChangeType;
  label: string;
  icon: React.ReactNode;
  gradient: string;
  textColor: string;
}[] = [
  {
    type: 'feature',
    label: 'Features',
    icon: <Sparkles className="h-5 w-5" />,
    gradient: 'from-emerald-50 to-green-50 border-emerald-200',
    textColor: 'text-emerald-700',
  },
  {
    type: 'fix',
    label: 'Bug Fixes',
    icon: <Bug className="h-5 w-5" />,
    gradient: 'from-red-50 to-rose-50 border-red-200',
    textColor: 'text-red-600',
  },
  {
    type: 'improvement',
    label: 'Improvements',
    icon: <Zap className="h-5 w-5" />,
    gradient: 'from-blue-50 to-indigo-50 border-blue-200',
    textColor: 'text-blue-600',
  },
  {
    type: 'breaking',
    label: 'Breaking',
    icon: <AlertTriangle className="h-5 w-5" />,
    gradient: 'from-amber-50 to-orange-50 border-amber-200',
    textColor: 'text-amber-600',
  },
];

// ── Architecture evolution (user-facing positive story) ─────────────────────
const EVOLUTION: { date: string; title: string; desc: string }[] = [
  {
    date: '2025.11',
    title: 'Genesis · A research engine is born',
    desc: 'Launched as DeepDive Engine — deep research, multi-step planning reports, and video comment analysis, all in one codebase.',
  },
  {
    date: '2025.12 – 2026.01',
    title: 'Engine abstraction',
    desc: 'Domain-agnostic capabilities sank out of the apps into a shared AI Engine. A TaskProfile abstraction unified every LLM call, and three databases were consolidated into PostgreSQL + Redis.',
  },
  {
    date: '2026.02',
    title: 'Facade boundaries',
    desc: 'A three-layer Facade contract hardened module boundaries: one monolithic facade split into five domain facades, with ESLint enforcing clean imports across the codebase.',
  },
  {
    date: '2026.02 – 04',
    title: 'A dedicated agent runtime',
    desc: 'Experiments converged on the AI Harness — a ReAct loop, a SKILL.md skill system, isolated sub-agents, and checkpoint / resume for long-running work.',
  },
  {
    date: '2026.05',
    title: 'Layered architecture',
    desc: 'The Harness settled into its own L2.5 layer. Engine and Harness were reorganized into clean, industry-standard aggregates with strict one-way dependencies.',
  },
  {
    date: '2026.05 – 06',
    title: 'Architecture guardrails',
    desc: 'Layering became machine-enforced: ESLint rules, architecture spec tests, and a CI merge gate keep every layer honest on every commit.',
  },
  {
    date: '2026.06',
    title: 'One-Person-Company OS',
    desc: 'A self-driven agent team turns a single prompt into plan → build → execute → deliver. The platform became an operating system for autonomous work.',
  },
];

const LAYERS: { lv: string; name: string; detail: string; accent: string }[] = [
  {
    lv: 'L4',
    name: 'Open API',
    detail: 'Outward-facing API & trust boundary',
    accent: 'border-l-purple-400 text-purple-600',
  },
  {
    lv: 'L3',
    name: 'AI Apps · 19 modules',
    detail: 'research · teams · office · writing · ask · image · social · …',
    accent: 'border-l-blue-500 text-blue-600',
  },
  {
    lv: 'L2.5',
    name: 'AI Harness · 11 aggregates',
    detail:
      'agent & mission aware — agents · runner · teams · memory · lifecycle',
    accent: 'border-l-emerald-500 text-emerald-600',
  },
  {
    lv: 'L2',
    name: 'AI Engine · 12 aggregates',
    detail:
      'stateless primitives — llm · tools · rag · knowledge · routing · safety',
    accent: 'border-l-amber-500 text-amber-600',
  },
  {
    lv: 'L1',
    name: 'Platform',
    detail: 'infrastructure — BYOK credentials · NestJS · Prisma · Redis',
    accent: 'border-l-gray-400 text-gray-500',
  },
];

export default function ChangelogPage() {
  const [tab, setTab] = useState<'whats-new' | 'evolution'>('whats-new');

  const stats = useMemo(() => {
    const counts: Record<ChangeType, number> = {
      feature: 0,
      fix: 0,
      improvement: 0,
      breaking: 0,
    };
    for (const entry of CHANGELOG) {
      for (const change of entry.changes) {
        counts[change.type]++;
      }
    }
    return counts;
  }, []);

  const totalVersions = CHANGELOG.length;

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5">
            <h1 className="text-2xl font-bold text-gray-900">
              {tab === 'whats-new' ? "What's New" : 'Architecture Evolution'}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {tab === 'whats-new' ? (
                <>
                  Current version:{' '}
                  <span className="font-mono rounded bg-gray-100 px-2 py-0.5">
                    v{CURRENT_VERSION}
                  </span>
                  <span className="ml-3 text-gray-400">
                    {totalVersions} releases
                  </span>
                </>
              ) : (
                <>From DeepDive Engine to a one-person-company OS</>
              )}
            </p>
          </div>

          <Tabs
            className="mb-6"
            value={tab}
            onChange={(k) => setTab(k as 'whats-new' | 'evolution')}
            items={[
              { key: 'whats-new', label: "What's New", icon: Sparkles },
              { key: 'evolution', label: 'Evolution', icon: History },
            ]}
          />

          {tab === 'whats-new' && (
            <>
              <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {statConfig.map(
                  ({ type, label, icon, gradient, textColor }) => (
                    <div
                      key={type}
                      className={`rounded-xl border bg-gradient-to-br ${gradient} p-3.5`}
                    >
                      <div className={`flex items-center gap-2 ${textColor}`}>
                        {icon}
                        <span className="text-2xl font-bold tabular-nums">
                          {stats[type]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-gray-500">
                        {label}
                      </p>
                    </div>
                  )
                )}
              </div>

              <div className="space-y-8">
                {CHANGELOG.map((entry) => (
                  <div key={entry.version} className="relative">
                    <div className="mb-3 flex items-center gap-3">
                      <h2 className="text-lg font-semibold text-gray-900">
                        v{entry.version}
                      </h2>
                      <span className="text-sm text-gray-400">
                        {entry.date}
                      </span>
                      {entry.version === CURRENT_VERSION && (
                        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          Latest
                        </span>
                      )}
                    </div>
                    <ul className="space-y-2">
                      {entry.changes.map((change, i) => {
                        const info = getChangeTypeInfo(change.type);
                        return (
                          <li key={i} className="flex items-start gap-2.5">
                            <span
                              className={`mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${info.color}`}
                            >
                              {typeIcons[change.type]}
                              {info.label}
                            </span>
                            <span className="text-sm text-gray-700">
                              {change.description}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'evolution' && (
            <>
              <div className="relative">
                <div className="absolute bottom-2 left-[7px] top-2 w-0.5 bg-gray-200" />
                <div className="space-y-4">
                  {EVOLUTION.map((e) => (
                    <div key={e.title} className="relative pl-8">
                      <div className="absolute left-0 top-2 h-4 w-4 rounded-full border-2 border-white bg-blue-500 shadow ring-2 ring-blue-100" />
                      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="font-mono text-xs font-medium text-blue-600">
                            {e.date}
                          </span>
                          <h3 className="text-base font-semibold text-gray-900">
                            {e.title}
                          </h3>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                          {e.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-10">
                <h2 className="mb-3 text-lg font-semibold text-gray-900">
                  Today&apos;s architecture
                </h2>
                <p className="mb-4 text-sm text-gray-500">
                  Five layers, strict one-way dependencies (L4 → L3 → L2.5 → L2
                  → L1).
                </p>
                <div className="space-y-2">
                  {LAYERS.map((l) => (
                    <div
                      key={l.lv}
                      className={`flex items-center gap-4 rounded-xl border border-l-4 border-gray-200 bg-white p-3.5 shadow-sm ${l.accent}`}
                    >
                      <span className="font-mono w-12 flex-shrink-0 text-sm font-bold">
                        {l.lv}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900">
                          {l.name}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {l.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
