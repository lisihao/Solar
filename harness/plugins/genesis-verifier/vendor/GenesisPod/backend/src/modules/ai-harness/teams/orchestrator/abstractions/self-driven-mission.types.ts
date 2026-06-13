/**
 * Self-Driven Agent Team — public contract types.
 *
 * Capability cluster: user picks the `Self-Driven Team` pseudo-model in AI Ask,
 * the harness autonomously plans the workflow / builds the team / generates the
 * acceptance rubric / executes / delivers. See
 * docs/architecture/ai-harness/self-driven-team/.
 *
 * MECE: this is the aggregate-level `abstractions/` for teams/orchestrator
 * (mece-05). Engine stays unaware of mission/agent state; this lives in harness.
 */

import type { MissionExecutionPlan } from "../orchestrator.interface";

/**
 * Analysis depth knob — controls how thorough the mission is.
 *   quick    — fewer steps, shorter per-step output (fast skim).
 *   standard — the default balance (current behaviour).
 *   deep     — more steps, longer per-step output (exhaustive report).
 * Maps to step-decomposition maxSteps + per-step TaskProfile outputLength.
 */
export type SelfDrivenAnalysisDepth = "quick" | "standard" | "deep";

/** Input that drives one autonomous self-driven mission. */
export interface SelfDrivenMissionInput {
  /** Raw user request — the only thing the user must provide. */
  prompt: string;
  /** Owning user id (BYOK key resolution + mission ownership scoping). */
  userId: string;
  /** Optional answers gathered during the clarify phase. */
  clarifications?: Record<string, string>;
  /** Analysis depth (default "standard" when omitted). */
  analysisDepth?: SelfDrivenAnalysisDepth;
  /**
   * Target language for all step outputs and the final report.
   * Values: 'zh' | 'en' (or any BCP-47 locale string from the frontend).
   * When absent the LLM defaults to its own language choice (current behaviour).
   */
  language?: string;
}

/** Coarse-grained lifecycle phases of a self-driven mission. */
export type SelfDrivenMissionPhase =
  | "clarify"
  | "plan"
  | "execute"
  | "interact"
  | "deliver";

/** Supported deliverable types. v1 ships `report`; others land via projectors. */
export type SelfDrivenDeliverableType = "report";

/**
 * Streamed events emitted by {@link SelfDrivenMissionRunner.run}. The app-side
 * thin dispatch maps these onto its SSE transport for the UI.
 *
 * Event addition policy: new event types are additive; unknown types must be
 * silently ignored by consumers (frontend drops unrecognised type keys).
 */
export type SelfDrivenMissionEvent =
  | { type: "mission_started"; missionId: string }
  | {
      type: "phase";
      missionId: string;
      phase: SelfDrivenMissionPhase;
      status: "started" | "completed";
      detail?: string;
    }
  /**
   * Emitted once after the plan phase completes.
   * Carries the full extended MissionExecutionPlan (roleAssignments / rubric /
   * deliverableType / loopKind per step). Front-end consumers that do not yet
   * render plan details must silently ignore this event.
   */
  | {
      type: "plan";
      missionId: string;
      plan: MissionExecutionPlan;
    }
  /**
   * Emitted once the execute phase has successfully built the dynamic team.
   * Consumers that do not yet render team details must silently ignore this event.
   *
   * roles: one entry per built member — the modelId is the elected model (may be
   * empty string if election deferred to LLMFactory default).
   */
  | {
      type: "team_built";
      missionId: string;
      roles: Array<{ roleId: string; modelId: string }>;
    }
  /**
   * Emitted when a single plan step begins execution.
   * Consumers that do not yet render step-level progress must silently ignore.
   */
  | {
      type: "step_started";
      missionId: string;
      stepId: string;
      stepName: string;
      executor: string;
      stepIndex: number;
      totalSteps: number;
    }
  /**
   * Emitted when a single plan step finishes (success or degraded).
   * `ok` is false for degraded/skipped steps where execution failed.
   */
  | {
      type: "step_completed";
      missionId: string;
      stepId: string;
      stepName: string;
      ok: boolean;
      durationMs: number;
    }
  | { type: "chunk"; missionId: string; content: string }
  /**
   * Emitted per tool invocation during a tool-capable step's execution.
   * Consumers that do not yet render tool-call progress must silently ignore.
   *
   * NOTE: v1 emits this event for future ReActLoop integration; the runner
   * currently routes tool-capable steps through chatStream until member.execute()
   * is available on ITeamMember (tracked as a follow-up specialist task).
   */
  | {
      type: "tool_call";
      missionId: string;
      stepId: string;
      /** Tool identifier from the role's coreTools whitelist. */
      toolId: string;
      /** Human-readable tool call label (e.g. "web_search: AI jobs"). */
      label?: string;
    }
  | {
      type: "deliverable";
      missionId: string;
      deliverableType: SelfDrivenDeliverableType;
      content: string;
    }
  | { type: "done"; missionId: string }
  | { type: "error"; missionId: string; message: string }
  /**
   * Emitted when the runner is blocked at a HITL gate, waiting for human
   * approval/reject/append before proceeding to the next phase.
   * Consumers that do not yet render HITL UI must silently ignore this event.
   */
  | {
      type: "awaiting_approval";
      missionId: string;
      /**
       * The DB approval request id.
       *
       * NOTE: this event is yielded *before* `SelfDrivenHitlGateService.open()`
       * returns, so the real request record has not been created yet at emit time.
       * Consumers must treat `requestId === ""` as "not yet known" and use the
       * `requestId` carried by the subsequent `approval_resolved` event for any
       * correlation. Do not render or store the empty-string value as a real id.
       */
      requestId: string;
      /**
       * Which gate is open.
       * "plan_confirm"   — post-plan, before execute.
       * "deliver_confirm" — after report assembled, before final emit.
       */
      gate: "plan_confirm" | "deliver_confirm";
      prompt: string;
      /**
       * Dynamically generated context-specific options the human can choose at
       * this gate. Each option has an id (to echo back in the approve payload),
       * a short label, and an optional description.
       *
       * Always includes an option with id="proceed" as the first entry (meaning
       * "execute as-is"). Other options are context-specific refinements generated
       * by an LLM call in the runner. Consumers that do not yet render choice UI
       * must silently ignore this field and treat the gate as approve/reject only.
       *
       * May be empty or absent when choice generation failed (best-effort; the gate
       * still works as a plain approve/reject checkpoint).
       */
      choices?: Array<{ id: string; label: string; description?: string }>;
    }
  /**
   * Emitted once the HITL gate is resolved (approved, rejected, or timed-out).
   * Consumers that do not yet render HITL UI must silently ignore this event.
   */
  | {
      type: "approval_resolved";
      missionId: string;
      requestId: string;
      gate: "plan_confirm" | "deliver_confirm";
      /** true = approved/timed-out-auto-approve; false = rejected */
      approved: boolean;
      timedOut: boolean;
      /** Sanitized append instruction injected into mission context (if any). */
      appendInstruction?: string;
    };
