'use client';

import { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Network,
  Radio,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { AdminPageLayout } from '@/components/admin/layout';
import { useApiGet } from '@/hooks/core';
import { useTranslation } from '@/lib/i18n';
import KernelMemoryPageContent from '../../kernel/memory/content';
import EvalDashboardPageContent from '../eval/content';
import GuardrailsPageContent from '../guardrails/content';
import DreamingDashboardContent from '../dreaming/content';
import { HarnessRuntimeGraph } from '@/components/harness/HarnessRuntimeGraph';
import { useMissionReplay } from '@/components/harness/useMissionReplay';

/**
 * AI Harness Hub
 *
 * Wave 5 (2026-05-11/12): L2.5 从 8 卡精简为 4 实体, 架构图 4 卡分别 link 到
 * ?tab=execution|memory|governance|interop。本 hub 不显示 inner Tab 控件,
 * 顶部 hero 标题动态显示当前 entity, 用户从架构图直接看到对应实体内容。
 *
 * 内嵌完整度:
 *  - execution:  Scheduler + Processes + Traces + Observability + Journal + Resources
 *  - memory:     KernelMemoryPageContent
 *  - governance: EvalDashboardPageContent + GuardrailsPageContent
 *  - interop:    facade + protocol 子卡导航（无独立 page 可内嵌, 永远导航形态）
 */

type HarnessEntity =
  | 'execution'
  | 'memory'
  | 'governance'
  | 'dreaming'
  | 'interop';

interface HarnessAction {
  label: string;
  href: string;
}

interface InteropSubsystem {
  id: string;
  title: string;
  description: string;
  modulePath: string;
  icon: LucideIcon;
  stats?: Array<{ label: string; key: string }>;
  actions: HarnessAction[];
}

// 仅 interop 实体保留子卡导航 — facade / protocol 没有独立 admin page,
// 子卡的 actions 仍 Link 到对应的 engine / system 实操页 (agents / teams /
// tools / skills / system?tab=settings 等)。
const INTEROP_SUBSYSTEMS: InteropSubsystem[] = [
  {
    id: 'facade',
    title: 'Facade',
    description:
      'Internal entry layer for AI, chat, RAG, agents, teams, and tool execution.',
    modulePath: 'backend/src/modules/ai-harness/facade',
    icon: Network,
    actions: [
      { label: 'Agent configs', href: '/admin/ai/agents' },
      { label: 'Team configs', href: '/admin/ai/teams' },
      { label: 'Tool configs', href: '/admin/ai/tools' },
      { label: 'Skill configs', href: '/admin/ai/skills' },
    ],
  },
  {
    id: 'protocol',
    title: 'Protocol',
    description:
      'Event bus, IPC, realtime progress, message history, MCP relay, and A2A integration.',
    modulePath: 'backend/src/modules/ai-harness/protocol',
    icon: Radio,
    stats: [{ label: 'subscriptions', key: 'kernelSubscriptions' }],
    actions: [
      { label: 'IPC bus', href: '/admin/kernel/ipc' },
      { label: 'External MCP', href: '/admin/system?tab=settings' },
    ],
  },
];

function statValue(
  overviewStats: Record<string, number> | undefined,
  key: string
): number {
  return overviewStats?.[key] ?? 0;
}

const ENTITY_I18N: Record<
  HarnessEntity,
  { titleKey: string; descriptionKey: string }
> = {
  execution: {
    titleKey: 'admin.architecture.cards.harnessExecution',
    descriptionKey: 'admin.architecture.cards.harnessExecutionDesc',
  },
  memory: {
    titleKey: 'admin.architecture.cards.harnessMemory',
    descriptionKey: 'admin.architecture.cards.harnessMemoryDesc',
  },
  governance: {
    titleKey: 'admin.architecture.cards.harnessGovernance',
    descriptionKey: 'admin.architecture.cards.harnessGovernanceDesc',
  },
  dreaming: {
    titleKey: 'admin.architecture.cards.harnessDreaming',
    descriptionKey: 'admin.architecture.cards.harnessDreamingDesc',
  },
  interop: {
    titleKey: 'admin.architecture.cards.harnessInterop',
    descriptionKey: 'admin.architecture.cards.harnessInteropDesc',
  },
};

function SubsystemSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-gray-200 pt-6 first:border-t-0 first:pt-0">
      <h2 className="mb-3 text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

interface MissionListItem {
  id: string;
  status: string;
  prompt: string;
  createdAt: string;
}

/**
 * Inline admin component — auto-loads the caller's recent self-driven missions
 * and renders the live run graph for the selected one. No manual mission-id
 * entry: it fetches the list on mount, auto-selects the newest (preferring a
 * running mission), and lets the admin switch via a dropdown.
 */
function RuntimeGraphSection() {
  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [activeMissionId, setActiveMissionId] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const didAutoSelect = useRef(false);
  const { events, isStreaming, error, load, clear } = useMissionReplay();

  const select = useCallback(
    (id: string) => {
      setActiveMissionId(id);
      if (id) load(id);
      else clear();
    },
    [load, clear]
  );

  const fetchMissions = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch(`${config.apiUrl}/ask/self-driven/missions`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      const envelope = json as {
        missions?: MissionListItem[];
        data?: { missions?: MissionListItem[] };
      };
      const list = envelope.data?.missions ?? envelope.missions ?? [];
      setMissions(list);
      // Auto-select once: prefer the newest running mission, else the newest.
      if (!didAutoSelect.current && list.length > 0) {
        didAutoSelect.current = true;
        const running = list.find((m) => m.status === 'running');
        select((running ?? list[0]).id);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, [select]);

  useEffect(() => {
    void fetchMissions();
  }, [fetchMissions]);

  const active = missions.find((m) => m.id === activeMissionId);

  return (
    <div className="space-y-4">
      {/* Mission picker row */}
      <div className="flex items-center gap-2">
        <select
          value={activeMissionId}
          onChange={(e) => select(e.target.value)}
          disabled={listLoading || missions.length === 0}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:cursor-not-allowed disabled:bg-gray-50"
        >
          {missions.length === 0 ? (
            <option value="">No missions yet</option>
          ) : (
            missions.map((m) => (
              <option key={m.id} value={m.id}>
                {(m.prompt || '(no prompt)').slice(0, 60)} · {m.status} ·{' '}
                {m.id.slice(0, 8)}
              </option>
            ))
          )}
        </select>
        <button
          onClick={() => {
            didAutoSelect.current = false;
            void fetchMissions();
          }}
          disabled={listLoading}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
          title="Refresh mission list"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${listLoading ? 'animate-spin' : ''}`}
          />
          Refresh
        </button>
      </div>

      {/* Status / error */}
      {(listError || error) && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listError ?? error}
        </p>
      )}

      {/* Graph or empty state */}
      {activeMissionId ? (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
            Mission:{' '}
            <span className="font-mono text-gray-700">{activeMissionId}</span>
            {active && (
              <span className="ml-2 text-gray-400">· {active.status}</span>
            )}
            {isStreaming && (
              <span className="ml-2 inline-flex items-center gap-1 text-teal-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                live
              </span>
            )}
            {!isStreaming && events.length > 0 && (
              <span className="ml-2 text-gray-400">(completed)</span>
            )}
          </div>
          <div style={{ height: 480 }}>
            <HarnessRuntimeGraph events={events} isStreaming={isStreaming} />
          </div>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-400">
          {listLoading
            ? 'Loading missions…'
            : 'No self-driven missions yet — start one from AI Ask to see its run graph here.'}
        </div>
      )}
    </div>
  );
}

function HarnessAdminPageInner() {
  const { t } = useTranslation();
  const { data: overviewStats } = useApiGet<Record<string, number>>(
    '/admin/overview-stats'
  );
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get('tab');
  const tab: HarnessEntity =
    rawTab === 'memory' ||
    rawTab === 'governance' ||
    rawTab === 'dreaming' ||
    rawTab === 'interop' ||
    rawTab === 'execution'
      ? rawTab
      : 'execution';

  const meta = ENTITY_I18N[tab];

  return (
    <AdminPageLayout
      title={`AI Harness — ${t(meta.titleKey)}`}
      description={t(meta.descriptionKey)}
      icon={Network}
      domain="ai"
    >
      {/* Execution = the live runtime graph only. The old static history blocks
          (Scheduler / Processes / Traces / Observability / Journal / Resources)
          were removed per product direction — this view is the dynamic run graph. */}
      {tab === 'execution' && <RuntimeGraphSection />}

      {tab === 'memory' && <KernelMemoryPageContent embedded />}

      {tab === 'governance' && (
        <div className="space-y-8">
          <SubsystemSection title="Evaluation Dashboard">
            <EvalDashboardPageContent embedded />
          </SubsystemSection>
          <SubsystemSection title="Guardrails">
            <GuardrailsPageContent embedded />
          </SubsystemSection>
        </div>
      )}

      {tab === 'dreaming' && <DreamingDashboardContent embedded />}

      {tab === 'interop' && (
        <>
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Facade and protocol internals do not have standalone mutation
            screens yet. Panels below link to the closest runtime / capability /
            protocol surfaces instead of synthesizing a Harness-only page.
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {INTEROP_SUBSYSTEMS.map((subsystem) => {
              const Icon = subsystem.icon;
              return (
                <section
                  key={subsystem.id}
                  id={subsystem.id}
                  className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-base font-semibold text-gray-900">
                          {subsystem.title}
                        </h2>
                        {subsystem.stats && (
                          <div className="flex flex-wrap justify-end gap-2">
                            {subsystem.stats.map((stat) => (
                              <span
                                key={stat.key}
                                className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600"
                              >
                                <strong className="text-gray-900">
                                  {statValue(overviewStats, stat.key)}
                                </strong>{' '}
                                {stat.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {subsystem.description}
                      </p>
                      <p className="font-mono mt-2 truncate text-xs text-gray-400">
                        {subsystem.modulePath}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {subsystem.actions.map((action) => (
                      <Link
                        key={`${subsystem.id}-${action.href}-${action.label}`}
                        href={action.href}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                      >
                        {action.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </AdminPageLayout>
  );
}

export default function HarnessAdminPage() {
  return (
    <Suspense fallback={null}>
      <HarnessAdminPageInner />
    </Suspense>
  );
}
