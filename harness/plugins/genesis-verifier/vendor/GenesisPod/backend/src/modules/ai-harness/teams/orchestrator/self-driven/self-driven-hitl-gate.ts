import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { sanitizePromptInput } from "@/modules/ai-engine/facade";
// Shared HITL DB primitive. Direct source import (not the facade barrel) since
// it's a DI-injected @Injectable — avoids the value-import circular-load class.
import {
  HumanApprovalPrimitiveService,
  approvalRequestKey,
  approvalResponseKey,
} from "../../../../ai-engine/tools/categories/collaboration/human-approval-primitive.service";

/**
 * HITL gate outcome returned to the runner at each stage boundary.
 *
 * approved — true means proceed; false means abort the mission.
 * timedOut  — true when the 10-minute gate window elapsed with no human response
 *             (auto-approve is the P4a default; gate is still considered approved).
 * appendInstruction — sanitized text the user appended to refine the next phase
 *             (present only when the user supplied feedback during approval).
 * chosenChoiceId — the id of the dynamic choice option the human selected (echoed
 *             back from the approval response's `choice` field). When present and
 *             not "proceed", the runner applies that choice as a contextual refinement.
 */
export interface HitlGateOutcome {
  approved: boolean;
  timedOut: boolean;
  appendInstruction?: string;
  /**
   * Analysis depth the human picked at the plan-confirm gate (decoded from the
   * approval response's opaque `input`). When present and different from the
   * depth the plan was built with, the runner re-plans at this depth.
   */
  analysisDepth?: "quick" | "standard" | "deep";
  /**
   * The id of the dynamic gate choice the human selected. "proceed" means
   * execute as-is; any other value is a context-specific refinement option
   * that the runner should fold into its next phase (re-plan or appendContext).
   * @deprecated Use chosenChoiceIds (array) for multi-select. Kept for back-compat.
   */
  chosenChoiceId?: string;
  /**
   * All choice ids the human selected (multi-select). When present, supersedes
   * chosenChoiceId. The runner applies ALL non-"proceed" ids.
   */
  chosenChoiceIds?: string[];
}

/** 10-minute default gate timeout (P4a spec). */
const GATE_TIMEOUT_MS = 10 * 60 * 1000;

/** Fixed owner for approval bookkeeping rows in long_term_memories. */
export const HITL_APPROVAL_USER_ID = "system";

/**
 * longTermMemory key mapping a mission to its current open approval requestId.
 * Shared by the gate (writer) and the owner-scoped approval service (reader) so
 * a non-admin owner can resolve their own gate by missionId alone.
 */
export function selfDrivenMissionGateKey(missionId: string): string {
  return `approval:mission:${missionId}`;
}

/** DB poll interval while waiting for a human response. */
const POLL_INTERVAL_MS = 2_000;

/**
 * SelfDrivenHitlGateService — thin wrapper around the DB-poll approval primitive.
 *
 * Writes an `approval:request:{requestId}` record to `longTermMemory` (same schema
 * used by HumanApprovalTool) then polls for `approval:response:{requestId}` until
 * a human responds or the gate times out.
 *
 * Timeout behaviour (P4a): auto-approve + mark timedOut=true.  The runner emits a
 * `phase` detail event so UI can show "auto-approved after 10 min".
 *
 * Append sanitization: if the human provides a feedback/append string it is passed
 * through `sanitizePromptInput` (engine facade, removes injection patterns) before
 * being returned to the caller for injection into mission context.
 *
 * Interruptible: the polling loop checks `signal.aborted` on every iteration and
 * returns early with approved=false if the abort signal fires.
 *
 * Capability singleton (capability-singleton.spec.ts): registered in
 * SelfDrivenTeamModule and re-exported from harness facade — one authoritative
 * definition in teams/orchestrator/self-driven/.
 */
@Injectable()
export class SelfDrivenHitlGateService {
  private readonly logger = new Logger(SelfDrivenHitlGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approval: HumanApprovalPrimitiveService,
  ) {}

  /**
   * Open a HITL gate and block until the human responds or the timeout elapses.
   *
   * @param missionId   Used only for logging / correlation.
   * @param gate        Identifies which gate is open (used in approval prompt context).
   * @param prompt      Human-readable description of what is being approved.
   * @param signal      Cooperative abort signal — if fired, gate returns approved=false.
   * @param timeoutMs   Override the default 10-minute timeout (used in tests).
   */
  async open(
    missionId: string,
    gate: "plan_confirm" | "deliver_confirm",
    prompt: string,
    signal?: AbortSignal,
    timeoutMs = GATE_TIMEOUT_MS,
  ): Promise<HitlGateOutcome & { requestId: string }> {
    // Back-compat convenience: prepare then wait in one call. Callers that need
    // to advertise the gate (emit awaiting_approval) between persistence and the
    // blocking wait — to avoid the approve-before-persist race — should instead
    // call prepareGate() then awaitGate() and emit in between.
    const prepared = await this.prepareGate(missionId, gate, prompt, timeoutMs);
    if (prepared.autoApproved) {
      return { requestId: prepared.requestId, approved: true, timedOut: true };
    }
    const outcome = await this.awaitGate(
      prepared.requestId,
      missionId,
      gate,
      signal,
      timeoutMs,
    );
    return { requestId: prepared.requestId, ...outcome };
  }

  /**
   * Phase 1 of the gate: PERSIST the approval request + the missionId→requestId
   * mapping, then return the real requestId immediately (no blocking poll).
   *
   * The caller MUST persist the gate before it advertises it (emits
   * awaiting_approval): the owner-scoped approve endpoint resolves the gate via
   * the mapping this writes, so advertising first would let a fast client POST
   * /approve before the mapping exists and get a spurious 404. Splitting persist
   * from wait closes that race and lets the awaiting_approval event carry the
   * real requestId instead of an empty placeholder.
   *
   * autoApproved=true means the backing table is unavailable and the gate should
   * be treated as auto-approved (mission must not be silently killed).
   *
   * @param choices Dynamically generated option choices for the human to select.
   *                When provided they are stored in the approval request payload's
   *                `choices` field (reusing the existing ApprovalRequestPayload
   *                capability). Pass empty array or omit to send null (plain gate).
   */
  async prepareGate(
    missionId: string,
    gate: "plan_confirm" | "deliver_confirm",
    prompt: string,
    timeoutMs?: number,
    choices?: Array<{ id: string; label: string; description?: string }>,
  ): Promise<{ requestId: string; autoApproved: boolean }> {
    const resolvedTimeout = timeoutMs ?? GATE_TIMEOUT_MS;
    const requestId = randomUUID();
    this.logger.log(
      `[HitlGate] mission=${missionId} gate=${gate} requestId=${requestId} ` +
        `timeout=${resolvedTimeout}ms choices=${choices?.length ?? 0}`,
    );
    try {
      if (!(await this.approval.tableReady())) {
        this.logger.warn(
          `[HitlGate] mission=${missionId} long_term_memories table not available — ` +
            `auto-approving gate=${gate}`,
        );
        return { requestId, autoApproved: true };
      }
      await this.storeRequest(
        requestId,
        missionId,
        gate,
        prompt,
        resolvedTimeout,
        choices,
      );
      return { requestId, autoApproved: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[HitlGate] mission=${missionId} gate=${gate} prepare error: ${message}`,
      );
      // Persistence failed → auto-approve so the mission is not silently killed.
      return { requestId, autoApproved: true };
    }
  }

  /**
   * Phase 2 of the gate: BLOCK until the human responds, the abort signal fires,
   * or the timeout elapses (auto-approve on timeout per P4a/ADR-010). Must be
   * called with a requestId returned by prepareGate().
   */
  async awaitGate(
    requestId: string,
    missionId: string,
    gate: "plan_confirm" | "deliver_confirm",
    signal?: AbortSignal,
    timeoutMs = GATE_TIMEOUT_MS,
  ): Promise<HitlGateOutcome> {
    try {
      return await this.pollForResponse(
        requestId,
        missionId,
        gate,
        timeoutMs,
        signal,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[HitlGate] mission=${missionId} gate=${gate} wait error: ${message}`,
      );
      // Unexpected errors auto-approve so the mission is not silently killed.
      return { approved: true, timedOut: true };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async storeRequest(
    requestId: string,
    missionId: string,
    gate: "plan_confirm" | "deliver_confirm",
    prompt: string,
    timeoutMs: number,
    choices?: Array<{ id: string; label: string; description?: string }>,
  ): Promise<void> {
    const USER_ID = "system";
    const expiresAt = new Date(Date.now() + timeoutMs + 60_000);

    // Store the request via the shared primitive (request payload is gate-specific).
    // choices reuses the existing ApprovalRequestPayload.choices capability —
    // populated with dynamic context-specific options when present, null otherwise.
    await this.approval.storeRequest({
      requestId,
      payload: {
        requestId,
        missionId,
        approvalType: "review" as const,
        prompt,
        context: { summary: `Self-driven mission gate: ${gate}` },
        choices:
          choices && choices.length > 0
            ? choices
            : (null as unknown as {
                id: string;
                label: string;
                description?: string;
              }[]),
        defaultAction: "approve",
        status: "pending",
        createdAt: new Date().toISOString(),
      },
      tags: ["human-approval", "self-driven", gate],
      expiresAt,
    });

    // Owner-scoped approval lookup: the frontend only knows the missionId (the
    // awaiting_approval event carries requestId=""), so map missionId -> the
    // current open requestId. AskSelfDrivenApprovalService reads this to resolve
    // the gate without admin access. Last-open-gate-wins (upsert by missionId).
    await this.prisma.longTermMemory.upsert({
      where: {
        userId_key: {
          userId: USER_ID,
          key: selfDrivenMissionGateKey(missionId),
        },
      },
      create: {
        userId: USER_ID,
        key: selfDrivenMissionGateKey(missionId),
        type: "human_approval_mission_gate",
        value: { requestId, gate } as never,
        importance: 8,
        tags: ["human-approval", "self-driven", `mission:${missionId}`],
        expiresAt,
      },
      update: { value: { requestId, gate } as never, expiresAt },
    });

    this.logger.debug(
      `[HitlGate] requestId=${requestId} stored in DB, polling for response`,
    );
  }

  private async pollForResponse(
    requestId: string,
    missionId: string,
    gate: "plan_confirm" | "deliver_confirm",
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<HitlGateOutcome> {
    // Poll via the shared primitive. The gate keeps its policy: abort →
    // approved=false, timeout → auto-approve (P4a/ADR-010), resolved → sanitize.
    const result = await this.approval.pollForResponse(
      requestId,
      timeoutMs,
      signal,
      POLL_INTERVAL_MS,
    );

    if (result.kind === "aborted") {
      this.logger.log(
        `[HitlGate] mission=${missionId} gate=${gate} aborted while waiting`,
      );
      await this.cleanupGate(requestId, missionId, false);
      return { approved: false, timedOut: false };
    }

    if (result.kind === "timed_out") {
      this.logger.warn(
        `[HitlGate] mission=${missionId} gate=${gate} timed out after ${timeoutMs}ms — auto-approving`,
      );
      await this.cleanupGate(requestId, missionId, false);
      return { approved: true, timedOut: true };
    }

    // resolved
    const responseData = result.data;
    const approved = responseData.approved ?? true;

    // Decode the optional analysis-depth override carried in the opaque `input`.
    const inputObj =
      responseData.input && typeof responseData.input === "object"
        ? (responseData.input as { analysisDepth?: unknown })
        : undefined;
    const analysisDepth =
      inputObj?.analysisDepth === "quick" ||
      inputObj?.analysisDepth === "standard" ||
      inputObj?.analysisDepth === "deep"
        ? inputObj.analysisDepth
        : undefined;

    // Sanitize any append instruction the human provided. `input` is now used to
    // carry the depth object, so the legacy string-input feedback fallback only
    // applies when input is a plain string (older clients).
    let appendInstruction: string | undefined;
    const rawFeedback =
      typeof responseData.feedback === "string"
        ? responseData.feedback
        : typeof responseData.input === "string"
          ? responseData.input
          : undefined;

    if (rawFeedback && rawFeedback.trim().length > 0) {
      const sanitized = sanitizePromptInput(rawFeedback, { maxLength: 2000 });
      if (sanitized.sanitized.trim().length > 0) {
        appendInstruction = sanitized.sanitized;
        if (sanitized.detectedPatterns.length > 0) {
          this.logger.warn(
            `[HitlGate] mission=${missionId} gate=${gate} sanitized append: ` +
              `detected patterns=[${sanitized.detectedPatterns.join(", ")}]`,
          );
        }
      }
    }

    // Decode multi-select choice ids from the opaque `input.choiceIds` array
    // (set by the approval service when the multi-select path is used).
    const rawChoiceIds =
      inputObj && Array.isArray((inputObj as { choiceIds?: unknown }).choiceIds)
        ? (inputObj as { choiceIds: unknown[] }).choiceIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          )
        : undefined;

    // Decode the legacy single-choice id (top-level `choice` field, back-compat).
    const chosenChoiceId =
      typeof responseData.choice === "string" && responseData.choice.length > 0
        ? responseData.choice
        : undefined;

    // Resolve the effective set: prefer multi-select array, fall back to single.
    const chosenChoiceIds: string[] | undefined =
      rawChoiceIds && rawChoiceIds.length > 0
        ? rawChoiceIds
        : chosenChoiceId
          ? [chosenChoiceId]
          : undefined;

    this.logger.log(
      `[HitlGate] mission=${missionId} gate=${gate} resolved: ` +
        `approved=${approved} hasAppend=${!!appendInstruction} ` +
        `chosenChoiceIds=${chosenChoiceIds ? JSON.stringify(chosenChoiceIds) : "none"}`,
    );
    await this.cleanupGate(requestId, missionId, true);
    return {
      approved,
      timedOut: false,
      appendInstruction,
      analysisDepth,
      chosenChoiceId,
      chosenChoiceIds,
    };
  }

  /**
   * Delete the gate's bookkeeping rows: the request + the missionId→requestId
   * mapping, plus the response row when the gate was resolved by a human.
   */
  private async cleanupGate(
    requestId: string,
    missionId: string,
    includeResponse: boolean,
  ): Promise<void> {
    const keys = [
      approvalRequestKey(requestId),
      selfDrivenMissionGateKey(missionId),
    ];
    if (includeResponse) keys.push(approvalResponseKey(requestId));
    await this.approval.cleanup(keys);
  }
}
