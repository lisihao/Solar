/**
 * Self-Driven Team SSE client
 *
 * Consumes POST /api/v1/ask/self-driven/stream (text/event-stream).
 * Events are the SelfDrivenMissionEvent union transparently forwarded by the
 * backend harness runner. Each raw SSE data line is parsed and delivered to
 * the onEvent callback so the caller can render incrementally.
 *
 * Isolated from the regular ask stream path — no session / reconcile / BYOK
 * wiring; this endpoint is fully stateless from the UI's perspective.
 */

import { config } from '@/lib/utils/config';

export type SelfDrivenEventType =
  | 'mission_started'
  | 'phase'
  | 'plan'
  | 'team_built'
  | 'step_started'
  | 'step_completed'
  | 'awaiting_approval'
  | 'approval_resolved'
  | 'chunk'
  | 'deliverable'
  | 'done'
  | 'error';

export interface MissionStartedEvent {
  type: 'mission_started';
  missionId: string;
}

export interface PhaseEvent {
  type: 'phase';
  missionId: string;
  phase: string;
  status: 'started' | 'completed';
}

export interface ChunkEvent {
  type: 'chunk';
  missionId: string;
  content: string;
}

export interface DeliverableEvent {
  type: 'deliverable';
  missionId: string;
  deliverableType: 'report';
  content: string;
}

export interface DoneEvent {
  type: 'done';
  missionId: string;
}

export interface SelfDrivenErrorEvent {
  type: 'error';
  missionId: string;
  message: string;
}

// --------------- new events (self-driven P1) ---------------

export interface RubricItem {
  dimension: string;
  weight: number;
  passLine: number;
}

export interface ExecutionStep {
  id: string;
  name: string;
  description: string;
  executor: string;
  type: 'task' | 'review' | 'integration' | 'delivery';
  loopKind?: 'react' | 'plan-act' | 'leader-worker';
  dependencies: string[];
  estimatedDuration: number;
  estimatedCost: number;
}

export interface RoleAssignment {
  roleId: string;
  modelId: string;
}

export interface MissionExecutionPlanSummary {
  id: string;
  missionId: string;
  steps: ExecutionStep[];
  estimatedCost: number;
  estimatedDuration: number;
  roleAssignments?: RoleAssignment[];
  rubric?: RubricItem[];
  deliverableType?: 'report';
}

export interface PlanEvent {
  type: 'plan';
  missionId: string;
  plan: MissionExecutionPlanSummary;
}

export interface TeamBuiltEvent {
  type: 'team_built';
  missionId: string;
  roles: Array<{ roleId: string; modelId: string }>;
}

export interface StepStartedEvent {
  type: 'step_started';
  missionId: string;
  stepId: string;
  stepName: string;
  executor: string;
  stepIndex: number;
  totalSteps: number;
}

export interface StepCompletedEvent {
  type: 'step_completed';
  missionId: string;
  stepId: string;
  stepName: string;
  ok: boolean;
  durationMs: number;
}

export interface ApprovalChoice {
  id: string;
  label: string;
  description?: string;
}

export interface AwaitingApprovalEvent {
  type: 'awaiting_approval';
  missionId: string;
  requestId: string;
  gate: 'plan_confirm' | 'deliver_confirm';
  prompt: string;
  choices?: ApprovalChoice[];
}

export interface ApprovalResolvedEvent {
  type: 'approval_resolved';
  missionId: string;
  requestId: string;
  gate: 'plan_confirm' | 'deliver_confirm';
  approved: boolean;
  timedOut: boolean;
  appendInstruction?: string;
}

export type SelfDrivenMissionEvent =
  | MissionStartedEvent
  | PhaseEvent
  | PlanEvent
  | TeamBuiltEvent
  | StepStartedEvent
  | StepCompletedEvent
  | AwaitingApprovalEvent
  | ApprovalResolvedEvent
  | ChunkEvent
  | DeliverableEvent
  | DoneEvent
  | SelfDrivenErrorEvent;

/**
 * Submit a HITL approval response (owner-scoped, keyed by missionId).
 * Path: POST /api/v1/ask/self-driven/missions/{missionId}/approve
 *
 * The backend resolves the mission's currently open gate — the frontend never
 * needs the requestId (awaiting_approval carries an empty one).
 */
export async function respondApproval(opts: {
  missionId: string;
  approved: boolean;
  feedback?: string;
  token: string;
  analysisDepth?: 'quick' | 'standard' | 'deep';
  /** @deprecated Use choices (array) instead. Kept for back-compat. */
  choice?: string;
  /** Multi-select: all choice ids the user ticked. */
  choices?: string[];
}): Promise<void> {
  const {
    missionId,
    approved,
    feedback,
    token,
    analysisDepth,
    choice,
    choices,
  } = opts;
  const res = await fetch(
    `${config.apiUrl}/ask/self-driven/missions/${encodeURIComponent(
      missionId
    )}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        approved,
        feedback,
        analysisDepth,
        choice,
        choices,
      }),
    }
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    throw new Error(
      (body.message as string | undefined) ?? `HTTP ${res.status}`
    );
  }
}
