/**
 * SelfDrivenStream
 *
 * Renders the incremental Self-Driven Team mission output inside the AI Ask
 * chat area.  Receives the live event list built by page.tsx and maps each
 * event type to a visual element:
 *
 *   mission_started    → missionId chip
 *   phase              → phase badge (started/completed/failed)
 *   plan               → execution plan card (steps / roles / rubric)
 *   team_built         → team member chips
 *   step_started       → step row (running)
 *   step_completed     → step row (done / failed + duration)
 *   awaiting_approval  → HITL approval bar
 *   approval_resolved  → resolved state on approval bar
 *   chunk              → accumulated prose text (typewriter)
 *   deliverable        → final report card
 *   done               → completion indicator
 *   error              → error banner
 *
 * Stateless — all state lives in page.tsx (except approval bar local submit state).
 */
'use client';

import { useState } from 'react';
import {
  CheckCircle,
  CircleDot,
  AlertCircle,
  FileText,
  Loader,
  Users,
  ChevronRight,
  Clock,
  Download,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  StatusBadge,
  type BadgeTone,
} from '@/components/ui/badges/StatusBadge';
import { ProgressBar } from '@/components/ui/progress/ProgressBar';
import { Button } from '@/components/ui/primitives/button';
import { config } from '@/lib/utils/config';
import { logger } from '@/lib/utils/logger';
import { useI18n } from '@/lib/i18n/i18n-context';
import { SelfDrivenPlanCard } from '@/components/ai-ask/SelfDrivenPlanCard';
import { SelfDrivenApprovalBar } from '@/components/ai-ask/SelfDrivenApprovalBar';
import type {
  SelfDrivenMissionEvent,
  MissionStartedEvent,
  PhaseEvent,
  PlanEvent,
  TeamBuiltEvent,
  StepStartedEvent,
  StepCompletedEvent,
  AwaitingApprovalEvent,
  ApprovalResolvedEvent,
  ChunkEvent,
  DeliverableEvent,
  DoneEvent,
  SelfDrivenErrorEvent,
} from '@/lib/api/self-driven-stream';

interface SelfDrivenStreamProps {
  events: SelfDrivenMissionEvent[];
  isStreaming: boolean;
  /** Bearer token forwarded from page.tsx for HITL approval calls. */
  token?: string;
}

// --------------- sub-renderers ---------------

function PhaseBadge({ ev }: { ev: PhaseEvent }) {
  const { t } = useI18n();
  const toneMap: Record<PhaseEvent['status'], BadgeTone> = {
    started: 'running',
    completed: 'success',
  };

  const tone: BadgeTone = toneMap[ev.status] ?? 'neutral';

  return (
    <StatusBadge
      tone={tone}
      label={
        <span>
          <span className="capitalize">{ev.phase}</span>
          <span className="ml-1 opacity-60">
            {ev.status === 'started'
              ? t('aiAsk.selfDriven.phaseRunning')
              : t('aiAsk.selfDriven.phaseDone')}
          </span>
        </span>
      }
      pulse={ev.status === 'started'}
      size="sm"
    />
  );
}

function TeamCard({ ev }: { ev: TeamBuiltEvent }) {
  const { t } = useI18n();
  if (!ev.roles.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <Users size={15} className="shrink-0 text-violet-600" aria-hidden />
        <span className="text-sm font-semibold text-gray-800">
          {t('aiAsk.selfDriven.team')}
        </span>
        <span className="ml-auto text-xs text-gray-400">
          {t('aiAsk.selfDriven.members', { count: ev.roles.length })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        {ev.roles.map((r) => (
          <div
            key={r.roleId}
            className="flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5"
          >
            <span className="text-xs font-medium text-gray-700">
              {r.roleId}
            </span>
            {r.modelId && (
              <>
                <ChevronRight size={10} className="text-gray-300" aria-hidden />
                <span className="font-mono text-[11px] text-gray-500">
                  {r.modelId}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepRow({
  step,
  completed,
  model,
}: {
  step: StepStartedEvent;
  completed: StepCompletedEvent | undefined;
  model?: string;
}) {
  const isRunning = !completed;
  const ok = completed?.ok ?? true;

  return (
    <div className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm odd:bg-gray-50">
      {/* Status icon */}
      <span className="shrink-0">
        {isRunning ? (
          <Loader
            size={13}
            className="animate-spin text-blue-500"
            aria-hidden
          />
        ) : ok ? (
          <CheckCircle size={13} className="text-emerald-500" aria-hidden />
        ) : (
          <AlertCircle size={13} className="text-red-500" aria-hidden />
        )}
      </span>

      {/* Index */}
      <span className="w-5 shrink-0 text-center text-[11px] font-bold text-gray-400">
        {step.stepIndex + 1}
      </span>

      {/* Name */}
      <span
        className={`flex-1 ${isRunning ? 'text-gray-800' : ok ? 'text-gray-600' : 'text-red-700'}`}
      >
        {step.stepName}
      </span>

      {/* Executor role */}
      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
        {step.executor}
      </span>

      {/* Model */}
      {model && (
        <span className="font-mono hidden shrink-0 text-[10px] text-gray-400 sm:inline">
          {model}
        </span>
      )}

      {/* Duration */}
      {completed && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-gray-400">
          <Clock size={10} aria-hidden />
          {(completed.durationMs / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

function StepsProgress({
  startedEvents,
  completedEvents,
  roleModel,
}: {
  startedEvents: StepStartedEvent[];
  completedEvents: StepCompletedEvent[];
  roleModel: Map<string, string>;
}) {
  const { t } = useI18n();
  if (!startedEvents.length) return null;

  const completedMap = new Map(completedEvents.map((e) => [e.stepId, e]));

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <CheckCircle size={15} className="shrink-0 text-blue-600" aria-hidden />
        <span className="text-sm font-semibold text-gray-800">
          {t('aiAsk.selfDriven.progress')}
        </span>
        <span className="ml-auto text-xs text-gray-400">
          {completedEvents.length} / {startedEvents[0].totalSteps}
        </span>
      </div>
      <div className="divide-y divide-gray-50 py-1">
        {startedEvents.map((step) => (
          <StepRow
            key={step.stepId}
            step={step}
            completed={completedMap.get(step.stepId)}
            model={roleModel.get(step.executor)}
          />
        ))}
      </div>
    </div>
  );
}

// Render inline citation links as new-tab anchors so sources are clickable and
// safe (the report weaves [label](url) citations after factual claims).
const MD_COMPONENTS = {
  a: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-violet-600 underline decoration-violet-300 underline-offset-2 hover:text-violet-700"
      {...props}
    >
      {children}
    </a>
  ),
};

function ChunkAccumulator({ events }: { events: SelfDrivenMissionEvent[] }) {
  const accumulated = events
    .filter((e): e is ChunkEvent => e.type === 'chunk')
    .map((e) => e.content)
    .join('');

  if (!accumulated) return null;

  // Fixed-height scroll box so the live token stream doesn't balloon the whole
  // page as 9 steps write (the "starts small, expands huge" jank). The final
  // deliverable renders as a compact file card separately.
  return (
    <div className="prose prose-sm max-h-64 max-w-none overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/50 p-3 text-gray-800">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {accumulated}
      </ReactMarkdown>
    </div>
  );
}

function DeliverableCard({
  ev,
  token,
}: {
  ev: DeliverableEvent;
  token: string;
}) {
  const { t } = useI18n();
  const [downloading, setDownloading] = useState(false);
  // Expanded by default so the report is visible (collapsing it made users think
  // "no report"). The earlier small-then-huge jank is handled by capping the live
  // streaming preview height, not by hiding the final report. Click to collapse.
  const [open, setOpen] = useState(true);

  const filename = `self-driven-report-${ev.missionId.slice(0, 8)}.md`;
  const sizeKb = Math.max(1, Math.round((ev.content?.length ?? 0) / 1024));

  const handleDownload = async () => {
    if (!ev.missionId || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(
        `${config.apiUrl}/ask/self-driven/missions/${encodeURIComponent(
          ev.missionId
        )}/report.md`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      logger.warn('[SelfDriven] report download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      {/* Embedded file artifact — the deliverable rendered as a downloadable
          document card (icon + name + type/size + a prominent Download action). */}
      <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 shadow-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 transition-colors hover:bg-violet-100"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <FileText size={18} className="text-violet-600" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="truncate text-sm font-semibold text-gray-800">
            {filename}
          </div>
          <div className="text-xs text-gray-400">
            {t('aiAsk.selfDriven.deliverable')} · MD · {sizeKb} KB
          </div>
        </button>
        <Button
          variant="default"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={handleDownload}
          disabled={downloading || !token}
        >
          {downloading ? (
            <Loader size={13} className="animate-spin" aria-hidden />
          ) : (
            <Download size={13} aria-hidden />
          )}
          {downloading
            ? t('aiAsk.selfDriven.downloading')
            : t('aiAsk.selfDriven.download')}
        </Button>
      </div>

      {/* Inline preview of the rendered report (collapsible from the card). */}
      {open && (
        <div className="prose prose-sm max-w-none rounded-xl border border-gray-200 bg-white px-4 py-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {ev.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// --------------- main component ---------------

export function SelfDrivenStream({
  events,
  isStreaming,
  token = '',
}: SelfDrivenStreamProps) {
  const { t } = useI18n();
  if (events.length === 0 && !isStreaming) return null;

  const startedEv = events.find(
    (e): e is MissionStartedEvent => e.type === 'mission_started'
  );
  const missionId = startedEv?.missionId ?? '';

  const phaseEvents = events.filter((e): e is PhaseEvent => e.type === 'phase');

  // plan event — last wins if somehow emitted more than once
  const planEvents = events.filter((e): e is PlanEvent => e.type === 'plan');
  const planEvent = planEvents[planEvents.length - 1];

  // team_built
  const teamBuiltEvent = events.find(
    (e): e is TeamBuiltEvent => e.type === 'team_built'
  );

  // role → model map (team_built is the source of truth; fall back to the plan's
  // roleAssignments). Used to label each task row with the model that ran it.
  const roleModelMap = new Map<string, string>();
  for (const r of teamBuiltEvent?.roles ?? []) {
    if (r.modelId) roleModelMap.set(r.roleId, r.modelId);
  }
  for (const a of planEvent?.plan?.roleAssignments ?? []) {
    if (a.modelId && !roleModelMap.has(a.roleId))
      roleModelMap.set(a.roleId, a.modelId);
  }

  // step events
  const stepStartedEvents = events.filter(
    (e): e is StepStartedEvent => e.type === 'step_started'
  );
  const stepCompletedEvents = events.filter(
    (e): e is StepCompletedEvent => e.type === 'step_completed'
  );

  // HITL
  // Last awaiting event wins (in case of multiple gates in sequence)
  const awaitingEvents = events.filter(
    (e): e is AwaitingApprovalEvent => e.type === 'awaiting_approval'
  );
  const awaitingEvent = awaitingEvents[awaitingEvents.length - 1] ?? null;
  const resolvedEvent = events.findLast
    ? (events.findLast(
        (e): e is ApprovalResolvedEvent => e.type === 'approval_resolved'
      ) ?? null)
    : (events
        .filter(
          (e): e is ApprovalResolvedEvent => e.type === 'approval_resolved'
        )
        .pop() ?? null);

  const deliverables = events.filter(
    (e): e is DeliverableEvent => e.type === 'deliverable'
  );
  const deliverable = deliverables[deliverables.length - 1];

  const done = events.find((e): e is DoneEvent => e.type === 'done');

  const errorEv = events.find(
    (e): e is SelfDrivenErrorEvent => e.type === 'error'
  );

  // ── Overall mission progress ──────────────────────────────────────────────
  // A single honest progress signal across the plan → execute → deliver phases:
  //   planning            → ~3%   (indeterminate-ish, plan not ready)
  //   plan ready          → 5%
  //   executing           → 5–85% proportional to completed/total steps
  //   composing report    → 90%
  //   deliverable ready   → 97%
  //   done                → 100%
  const totalSteps = planEvent?.plan?.steps?.length ?? 0;
  const completedSteps = stepCompletedEvents.length;
  const deliverStarted = phaseEvents.some(
    (p) => p.phase === 'deliver' && p.status === 'started'
  );
  const executeSeen = phaseEvents.some((p) => p.phase === 'execute');

  let progressPct: number;
  let progressLabel: string;
  if (done) {
    progressPct = 100;
    progressLabel = t('aiAsk.selfDriven.missionComplete');
  } else if (deliverable) {
    progressPct = 97;
    progressLabel = t('aiAsk.selfDriven.progressComposing');
  } else if (deliverStarted) {
    progressPct = 90;
    progressLabel = t('aiAsk.selfDriven.progressComposing');
  } else if (totalSteps > 0 && executeSeen) {
    progressPct = 5 + Math.round((completedSteps / totalSteps) * 80);
    progressLabel = `${t('aiAsk.selfDriven.progress')} ${completedSteps}/${totalSteps}`;
  } else if (planEvent) {
    progressPct = 5;
    progressLabel = t('aiAsk.selfDriven.progressPlanning');
  } else {
    progressPct = 3;
    progressLabel = t('aiAsk.selfDriven.progressPlanning');
  }
  // Show the bar while the mission is live; once done the report card itself
  // signals completion, so we keep it only when not yet done (or on error).
  const showProgress = !!missionId && (errorEv ? true : !done);

  return (
    <div className="space-y-2.5">
      {/* Mission status chip — friendly label instead of the raw mission UUID.
          The id is kept in the title tooltip for log/replay correlation. */}
      {missionId && (
        <div className="flex items-center gap-1.5" title={missionId}>
          <CircleDot
            size={12}
            className={
              isStreaming ? 'animate-pulse text-violet-500' : 'text-emerald-500'
            }
            aria-hidden
          />
          <span className="text-[11px] font-medium text-gray-500">
            {isStreaming
              ? t('aiAsk.selfDriven.missionStarted')
              : t('aiAsk.selfDriven.missionComplete')}
          </span>
        </div>
      )}

      {/* Overall progress bar */}
      {showProgress && (
        <ProgressBar
          value={progressPct}
          label={progressLabel}
          showPercentage
          tone={errorEv ? 'danger' : 'primary'}
          size="sm"
        />
      )}

      {/* Phase badges */}
      {phaseEvents.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {phaseEvents.map((ev, i) => (
            <PhaseBadge key={`${ev.phase}-${ev.status}-${i}`} ev={ev} />
          ))}
        </div>
      )}

      {/* Execution plan card */}
      {planEvent && <SelfDrivenPlanCard ev={planEvent} />}

      {/* HITL approval bar — shown after plan or deliver gate */}
      {awaitingEvent && (
        <SelfDrivenApprovalBar
          awaiting={awaitingEvent}
          resolved={resolvedEvent}
          token={token}
        />
      )}

      {/* Team members */}
      {teamBuiltEvent && <TeamCard ev={teamBuiltEvent} />}

      {/* Step-by-step progress — task · role · model */}
      {stepStartedEvents.length > 0 && (
        <StepsProgress
          startedEvents={stepStartedEvents}
          completedEvents={stepCompletedEvents}
          roleModel={roleModelMap}
        />
      )}

      {/* Streaming chunk text (before deliverable arrives) */}
      {!deliverable && <ChunkAccumulator events={events} />}

      {/* Final deliverable */}
      {deliverable && <DeliverableCard ev={deliverable} token={token} />}

      {/* Error banner */}
      {errorEv && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>{errorEv.message}</span>
        </div>
      )}

      {/* Done indicator */}
      {done && !errorEv && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-600">
          <CheckCircle size={13} aria-hidden />
          <span>{t('aiAsk.selfDriven.missionComplete')}</span>
        </div>
      )}

      {/* Streaming pulse when no chunk yet */}
      {isStreaming && !missionId && (
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 animate-bounce rounded-full bg-violet-500"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="h-2 w-2 animate-bounce rounded-full bg-violet-500"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="h-2 w-2 animate-bounce rounded-full bg-violet-500"
            style={{ animationDelay: '300ms' }}
          />
          <span className="text-sm text-gray-500">
            {t('aiAsk.selfDriven.thinking')}
          </span>
        </div>
      )}
    </div>
  );
}
