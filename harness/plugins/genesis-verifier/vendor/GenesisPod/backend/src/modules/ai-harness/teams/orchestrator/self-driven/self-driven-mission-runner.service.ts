import { Injectable, Logger, Inject } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import type {
  SelfDrivenMissionEvent,
  SelfDrivenMissionInput,
} from "../abstractions/self-driven-mission.types";
import { SelfDrivenMissionPlannerService } from "./self-driven-mission-planner.service";
import { SelfDrivenReportComposer } from "./self-driven-report-composer";
import type {
  ExecutionStep,
  MissionExecutionPlan,
} from "../orchestrator.interface";
import { DynamicTeamBuilder } from "../../dynamic-team/dynamic-team-builder";
import { AiChatService } from "../../../../ai-engine/llm/chat/ai-chat.service";
import {
  IRoleInventory,
  ROLE_INVENTORY,
} from "../../abstractions/role-inventory.interface";
import type { TaskProfile } from "../../../facade";
import { SelfDrivenHitlGateService } from "./self-driven-hitl-gate";
import { AgentFactory } from "../../../agents/core/agent-factory";
import { AgentIdentity } from "../../../agents/core/agent-identity";
import type {
  IThinkingEvent,
  IActionExecutedEvent,
  IOutputEvent,
  IErrorEvent,
} from "../../../agents/abstractions/agent-event.interface";
import {
  buildCitationMetadata,
  generateBibliography,
  type CitationRawEvidence,
  type CitationMetadata,
} from "@/modules/ai-engine/facade";

/**
 * Self-Driven Agent Team runner.
 *
 * Lifecycle:
 *   clarify  — placeholder (P1: interactive clarification loop)
 *   plan     — calls SelfDrivenMissionPlannerService; streams a `plan` event
 *   execute  — builds the dynamic team via DynamicTeamBuilder; emits `team_built`;
 *              then drives each plan step in dependency order, calling the role's
 *              LLM via AiChatService to produce real content; emits
 *              step_started / chunk / step_completed per step.
 *   deliver  — assembles per-step outputs into a Markdown report via
 *              SelfDrivenReportComposer; emits `deliverable`.
 *
 * LLM call pattern: AiChatService.chat() + TaskProfile, no hard-coded model
 * names or temperatures (fallback modelId = "" per red-line rules).
 *
 * Resilience: a single step failure does not abort the mission — the step is
 * logged and marked as degraded, execution continues with remaining steps.
 * The final report notes which steps did not produce output.
 *
 * Event contract (SelfDrivenMissionEvent) is stable; unknown types are
 * silently ignored by existing consumers.
 */
@Injectable()
export class SelfDrivenMissionRunner {
  private readonly logger = new Logger(SelfDrivenMissionRunner.name);

  /**
   * Feature flag: route tool-capable steps through the ReActLoop (AgentFactory)
   * so research/analyst steps actually run WEB_SEARCH and write claims with real
   * inline source links — instead of the LLM writing prose from parametric
   * memory with no sources.
   *
   * Default ON (2026-06-05). Set SELF_DRIVEN_ENABLE_TOOL_LOOP=0 to disable as an
   * instant escape hatch (no deploy) if report quality regresses. The formatter
   * in SelfDrivenReportComposer turns any structured agent output into Markdown
   * prose, and a 120s per-call timeout in the deliver phase keeps a hanging tool
   * provider from wedging the mission.
   */
  private static readonly ENABLE_TOOL_LOOP =
    process.env.SELF_DRIVEN_ENABLE_TOOL_LOOP !== "0";

  /**
   * Per-mission token budget ceiling. Execution stops dispatching new steps
   * once the cumulative token count across all completed steps reaches this
   * value. Already-running or already-completed steps are unaffected; the
   * report is still assembled from whatever outputs were collected.
   *
   * 200 000 tokens ≈ ~150 000 words of combined step I/O. In practice a
   * standard 3-step mission consumes ~5 000–20 000 tokens total, so the
   * ceiling is a safety net against runaway deep-depth missions rather than
   * a normal execution limit.
   */
  private static readonly SELF_DRIVEN_MISSION_MAX_TOKENS = 200_000;

  /**
   * Maximum number of steps that may execute concurrently within a single
   * topological tier.  Steps in the same tier share no dependencies, so
   * they are safe to run in parallel.  The cap prevents unbounded LLM
   * concurrency when a tier happens to contain many independent steps.
   *
   * Set to 3 to match the DAGExecutor convention used elsewhere in the
   * harness (runner/dag/dag-executor.ts § MAX_PARALLEL).
   */
  private static readonly SELF_DRIVEN_MAX_PARALLEL_STEPS = 3;

  /**
   * Hard ceiling on any single deliver-phase LLM helper call (references
   * extraction, rubric evaluation, finalize/refine pass, gate-choice
   * generation). These run AFTER the deliver gate is approved; if the provider
   * hangs with no timeout, the `deliverable`/`done` events are never yielded and
   * the mission sticks forever showing "all steps done, no report" (the UI keeps
   * the stop button up). A bounded race guarantees the deliver phase always
   * terminates — on timeout the helper's own try/catch falls back to a safe
   * default (skip references, keep draft report, proceed).
   */
  private static readonly DELIVER_LLM_TIMEOUT_MS = 120_000;

  /**
   * Short timeout for gate-choice generation specifically. These LLM calls run
   * BEFORE the HITL approval event is emitted, so they block the approval bar
   * from appearing at all. A slow/hung call here makes the mission look frozen
   * right after "execute completed" — all steps done, no gate, no report. The
   * choices are a nice-to-have (the gate still works as approve/reject/feedback
   * without them), so cap them tightly: on timeout we emit the gate with no
   * dynamic choices instead of stalling the whole mission.
   */
  private static readonly GATE_CHOICES_TIMEOUT_MS = 20_000;

  /**
   * Max input size (chars) for a single whole-document rewrite pass
   * (finalize / rubric-critique refinement).
   *
   * A `TaskProfile` "long" output caps at ~8000 tokens, which is only ~12K
   * Chinese chars (~1.5 chars/token) or ~32K English chars. Feeding a report
   * LARGER than the output can hold makes the model SILENTLY TRUNCATE it — and
   * the `<100 chars` sanity check can't catch a 45K→12K truncation, so the
   * truncated text would replace the full report (real P0 regression on the
   * project's actual 27–45K-char reports).
   *
   * Conservative ceiling = the Chinese worst case with margin: above this we
   * skip the whole-document rewrite and keep the original verbatim (safe
   * degradation). The proper fix — section-targeted editing that rewrites only
   * the critiqued Markdown subsections and splices them back — is deferred.
   */
  private static readonly FINALIZE_MAX_INPUT_CHARS = 10_000;

  /**
   * Reject `work` after `ms` so an unbounded provider hang can't wedge mission
   * termination. The losing promise is left to settle on its own (no way to
   * cancel an in-flight chat without a signal); the timer is always cleared.
   */
  private async withTimeout<T>(
    work: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    });
    try {
      return await Promise.race([work, guard]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  constructor(
    private readonly planner: SelfDrivenMissionPlannerService,
    private readonly teamBuilder: DynamicTeamBuilder,
    private readonly chat: AiChatService,
    private readonly composer: SelfDrivenReportComposer,
    private readonly hitlGate: SelfDrivenHitlGateService,
    private readonly agentFactory: AgentFactory,
    @Inject(ROLE_INVENTORY) private readonly roleInventory: IRoleInventory,
  ) {}

  /**
   * Run one self-driven mission, streaming lifecycle events.
   *
   * @param missionId Caller-generated id (ownership already assigned app-side).
   * @param input     The user's request + context.
   * @param signal    Cooperative cancellation (stage-boundary).
   */
  async *run(
    missionId: string,
    input: SelfDrivenMissionInput,
    signal?: AbortSignal,
  ): AsyncGenerator<SelfDrivenMissionEvent, void, unknown> {
    this.logger.log(
      `[SelfDriven] mission ${missionId} started for user ${input.userId}`,
    );
    yield { type: "mission_started", missionId };

    // Derive a human-readable target language from the locale string.
    // undefined when absent → backward-compatible (LLM picks language freely).
    const lang =
      input.language === "zh"
        ? "Chinese (简体中文)"
        : input.language === "en"
          ? "English"
          : input.language
            ? input.language
            : undefined;

    // NB: no "clarify" phase is emitted today — interactive clarification is P2+.
    // A phase that does nothing must not announce itself in the UI (it showed as a
    // misleading instant "Clarify Running → Done"). Real clarify events land in P2.

    // ── Phase: plan ───────────────────────────────────────────────────────────
    if (signal?.aborted) {
      yield { type: "error", missionId, message: "aborted" };
      return;
    }
    yield { type: "phase", missionId, phase: "plan", status: "started" };

    let plan: MissionExecutionPlan;
    try {
      plan = await this.planner.plan({
        prompt: input.prompt,
        userId: input.userId,
        context: input.clarifications
          ? (input.clarifications as Record<string, unknown>)
          : undefined,
        analysisDepth: input.analysisDepth,
        signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[SelfDriven] mission ${missionId} plan phase failed: ${message}`,
      );
      yield { type: "error", missionId, message: `plan failed: ${message}` };
      return;
    }

    yield { type: "phase", missionId, phase: "plan", status: "completed" };

    // Stream the plan as a structured event so app-side and UI can display it.
    yield { type: "plan", missionId, plan };

    // ── HITL gate: plan_confirm ───────────────────────────────────────────────
    // Block until the user approves the plan, rejects it, or the 10-minute
    // timeout elapses (auto-approve per ADR-010).  Any append instruction is
    // stored in `appendContext` and injected into every subsequent step prompt.
    if (signal?.aborted) {
      yield { type: "error", missionId, message: "aborted" };
      return;
    }
    let appendContext: string | undefined;
    // Keep a reference to the generated choices so we can look up label/description
    // of the chosen option when applying it as a re-plan context refinement.
    let planGateChoices: Array<{
      id: string;
      label: string;
      description?: string;
    }> = [];
    {
      const planGatePrompt =
        `Mission "${input.prompt.slice(0, 120)}" — plan ready.\n` +
        `Steps: ${plan.steps.length}. ` +
        `Roles: ${[...new Set(plan.steps.map((s) => s.executor))].join(", ")}.\n` +
        `Approve to proceed, reject to cancel, or provide feedback to adjust.`;

      // Generate dynamic context-aware choices (best-effort: never blocks the gate).
      const planContextSummary =
        `Objective: ${input.prompt.slice(0, 200)}\n` +
        `Plan: ${plan.steps.length} steps — ${plan.steps.map((s) => s.name).join(", ")}.\n` +
        `Roles: ${[...new Set(plan.steps.map((s) => s.executor))].join(", ")}.`;
      planGateChoices = await this.generateGateChoices(
        "plan_confirm",
        planContextSummary,
        input.userId,
        missionId,
        lang,
      );

      // Persist the gate FIRST (with choices), then advertise it with the real
      // requestId, then block waiting. Advertising before persistence would let a
      // fast client POST /approve before the gate mapping exists (spurious 404).
      // See SelfDrivenHitlGateService.prepareGate.
      const planPrep = await this.hitlGate.prepareGate(
        missionId,
        "plan_confirm",
        planGatePrompt,
        undefined,
        planGateChoices.length > 0 ? planGateChoices : undefined,
      );

      yield {
        type: "awaiting_approval",
        missionId,
        requestId: planPrep.requestId,
        gate: "plan_confirm",
        prompt: planGatePrompt,
        choices: planGateChoices.length > 0 ? planGateChoices : undefined,
      };

      const planGate = planPrep.autoApproved
        ? { requestId: planPrep.requestId, approved: true, timedOut: true }
        : {
            requestId: planPrep.requestId,
            ...(await this.hitlGate.awaitGate(
              planPrep.requestId,
              missionId,
              "plan_confirm",
              signal,
            )),
          };

      yield {
        type: "approval_resolved",
        missionId,
        requestId: planGate.requestId,
        gate: "plan_confirm",
        approved: planGate.approved,
        timedOut: planGate.timedOut,
        appendInstruction: planGate.appendInstruction,
      };

      if (!planGate.approved) {
        this.logger.log(
          `[SelfDriven] mission ${missionId} plan rejected by human`,
        );
        yield {
          type: "error",
          missionId,
          message: "plan rejected by human",
        };
        return;
      }

      if (planGate.timedOut) {
        yield {
          type: "phase",
          missionId,
          phase: "plan",
          status: "completed",
          detail: "plan_confirm gate timed out — auto-approved after 10 min",
        };
      }

      appendContext = planGate.appendInstruction;

      // ── Apply the human's chosen dynamic options (multi-select refinement) ──
      // Collect all non-"proceed" ids from chosenChoiceIds (multi) or fall back
      // to the single chosenChoiceId. Concatenate all their label+description
      // lines and fold into a single re-plan so the new plan incorporates every
      // requested adjustment. Non-fatal: keep the original plan on any error.
      const rawChosenIds =
        (planGate as { chosenChoiceIds?: string[] }).chosenChoiceIds ??
        ((planGate as { chosenChoiceId?: string }).chosenChoiceId
          ? [(planGate as { chosenChoiceId?: string }).chosenChoiceId!]
          : []);
      const activeChoiceIds = rawChosenIds.filter((id) => id !== "proceed");
      if (activeChoiceIds.length > 0 && !signal?.aborted) {
        const choiceLines = activeChoiceIds
          .map((id) => {
            const opt = planGateChoices.find((c) => c.id === id);
            if (!opt) return null;
            return opt.description
              ? `${opt.label}: ${opt.description}`
              : opt.label;
          })
          .filter((line): line is string => line !== null);

        if (choiceLines.length > 0) {
          const combinedContext = choiceLines.join("\n");
          this.logger.log(
            `[SelfDriven] mission ${missionId} re-planning with ${activeChoiceIds.length} chosen option(s): ` +
              `[${activeChoiceIds.join(", ")}]`,
          );
          yield {
            type: "phase",
            missionId,
            phase: "plan",
            status: "started",
            detail: `re-planning per chosen options: ${activeChoiceIds.join(", ")}`,
          };
          try {
            // Fold all choice refinements into the planner's `context` field.
            const choiceRefinementContext: Record<string, unknown> = {
              ...(input.clarifications
                ? (input.clarifications as Record<string, unknown>)
                : {}),
              chosenRefinement: combinedContext,
            };
            plan = await this.planner.plan({
              prompt: input.prompt,
              userId: input.userId,
              context: choiceRefinementContext,
              analysisDepth: input.analysisDepth,
              signal,
            });
            yield {
              type: "phase",
              missionId,
              phase: "plan",
              status: "completed",
            };
            yield { type: "plan", missionId, plan };
          } catch (err) {
            // Re-plan failure is non-fatal: keep the already-approved plan.
            this.logger.warn(
              `[SelfDriven] mission ${missionId} choice-driven re-plan failed, ` +
                `keeping original plan: ${err instanceof Error ? err.message : String(err)}`,
            );
            yield {
              type: "phase",
              missionId,
              phase: "plan",
              status: "completed",
              detail: "re-plan failed — proceeding with the original plan",
            };
          }
        }
      }

      // ── Re-plan if the human changed the analysis depth at this gate ─────────
      // Depth controls step-decomposition maxSteps, so a depth change must
      // regenerate the plan (and re-elect roles) before execution. The new depth
      // also flows into per-step output length via the mutated input below.
      const chosenDepth = (planGate as { analysisDepth?: string })
        .analysisDepth as "quick" | "standard" | "deep" | undefined;
      const currentDepth = input.analysisDepth ?? "standard";
      if (chosenDepth && chosenDepth !== currentDepth && !signal?.aborted) {
        this.logger.log(
          `[SelfDriven] mission ${missionId} re-planning: depth ${currentDepth} → ${chosenDepth}`,
        );
        yield {
          type: "phase",
          missionId,
          phase: "plan",
          status: "started",
          detail: `re-planning at ${chosenDepth} depth`,
        };
        try {
          plan = await this.planner.plan({
            prompt: input.prompt,
            userId: input.userId,
            context: input.clarifications
              ? (input.clarifications as Record<string, unknown>)
              : undefined,
            analysisDepth: chosenDepth,
            signal,
          });
          // Propagate the new depth to execution (per-step output length).
          input = { ...input, analysisDepth: chosenDepth };
          yield {
            type: "phase",
            missionId,
            phase: "plan",
            status: "completed",
          };
          yield { type: "plan", missionId, plan };
        } catch (err) {
          // Re-plan failure is non-fatal: keep the already-approved plan.
          this.logger.warn(
            `[SelfDriven] mission ${missionId} re-plan at depth=${chosenDepth} failed, ` +
              `keeping original plan: ${err instanceof Error ? err.message : String(err)}`,
          );
          yield {
            type: "phase",
            missionId,
            phase: "plan",
            status: "completed",
            detail: "re-plan failed — proceeding with the original plan",
          };
        }
      }
    }

    // ── Phase: execute ────────────────────────────────────────────────────────
    if (signal?.aborted) {
      yield { type: "error", missionId, message: "aborted" };
      return;
    }
    yield { type: "phase", missionId, phase: "execute", status: "started" };
    this.logger.log(
      `[SelfDriven] mission ${missionId} → execute phase: ${plan.steps.length} steps, ` +
        `roles=[${(plan.roleAssignments ?? []).map((a) => `${a.roleId}:${a.modelId || "EMPTY"}`).join(", ")}]`,
    );

    // Build the dynamic team from the planner's role assignments.
    // safety-10: DynamicTeamBuilder validates every roleId against RoleInventory
    //            and throws AgentAccessDeniedError for unknown ids.
    // safety-05: member tools are scoped to role.coreTools declared in RoleInventory.
    const assignments = plan.roleAssignments ?? [];
    if (assignments.length === 0) {
      this.logger.warn(
        `[SelfDriven] mission ${missionId} has no roleAssignments — skipping team build`,
      );
      yield {
        type: "error",
        missionId,
        message: "execute failed: plan contains no roleAssignments",
      };
      return;
    }

    try {
      const team = this.teamBuilder.build(missionId, assignments);
      this.logger.log(
        `[SelfDriven] mission ${missionId} team built: ` +
          `leader=${team.leader.role.id} members=${team.members.length}`,
      );

      // Emit team_built event (additive — unknown types silently ignored by
      // consumers that have not yet adopted this event).
      //
      // Source of truth = the planner's per-role elected assignments, NOT the
      // built team's members: the team is created with a single uniform
      // defaultModel (TeamFactory.createFromConfig has no per-role model slot),
      // so team.getAllMembers() would advertise the same model for every role
      // while each step actually executes on its own elected modelId
      // (plan.roleAssignments). Emitting the elected assignments keeps the UI's
      // model attribution consistent with what each step really runs on.
      // Include the dedicated LEADER first: it coordinates the team but executes
      // no plan step, so it has no per-step assignment — the team display would
      // otherwise be missing the leader. Its model is the team's defaultModel.
      const leaderMember = team.leader;
      const roles = [
        {
          roleId: leaderMember.role.id,
          modelId: leaderMember.model ?? "",
        },
        ...assignments.map((a) => ({
          roleId: a.roleId,
          modelId: a.modelId,
        })),
      ];
      yield { type: "team_built", missionId, roles };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[SelfDriven] mission ${missionId} execute phase — team build failed: ${message}`,
      );
      yield {
        type: "error",
        missionId,
        message: `execute failed: ${message}`,
      };
      return;
    }

    // ── Per-step execution in topological-tier order (concurrent within tier) ──
    // stepOutputs accumulates role outputs for cross-step context and final report.
    const stepOutputs = new Map<string, string>();
    const tiers = this.topologicalSortLayered(plan.steps);
    const totalSteps = plan.steps.length;

    // Mission-level token budget tracking.
    // missionTokensUsed accumulates total tokens across all completed steps.
    let missionTokensUsed = 0;

    // Global step index for step_started.stepIndex (preserve serial semantics
    // for consumers that rely on the index — within each tier we assign indices
    // in tier order, so a 3-step tier spanning indices [1,2,3] will start
    // events with those indices even though they run concurrently).
    let globalStepIndex = 0;
    let budgetExceeded = false;

    tierLoop: for (const tier of tiers) {
      if (signal?.aborted) {
        yield { type: "error", missionId, message: "aborted" };
        return;
      }

      // Budget gate: stop dispatching new tiers once the ceiling is reached.
      if (budgetExceeded) {
        break;
      }
      if (
        missionTokensUsed >=
        SelfDrivenMissionRunner.SELF_DRIVEN_MISSION_MAX_TOKENS
      ) {
        const stepsRun = globalStepIndex;
        this.logger.warn(
          `[SelfDriven] mission ${missionId} token budget exceeded: ` +
            `${missionTokensUsed} >= ${SelfDrivenMissionRunner.SELF_DRIVEN_MISSION_MAX_TOKENS} — ` +
            `stopping after ${stepsRun}/${totalSteps} steps`,
        );
        yield {
          type: "phase",
          missionId,
          phase: "execute",
          status: "completed",
          detail:
            `token budget exceeded after ${stepsRun} steps ` +
            `(${missionTokensUsed}/${SelfDrivenMissionRunner.SELF_DRIVEN_MISSION_MAX_TOKENS} tokens used)`,
        };
        budgetExceeded = true;
        break tierLoop;
      }

      // Assign indices for this tier before launching concurrency so the
      // step_started events carry deterministic indices.
      const tierIndexBase = globalStepIndex;
      globalStepIndex += tier.length;

      // Split the tier into batches of SELF_DRIVEN_MAX_PARALLEL_STEPS.
      // Within each batch, steps run concurrently; batches run sequentially.
      const maxParallel =
        SelfDrivenMissionRunner.SELF_DRIVEN_MAX_PARALLEL_STEPS;
      for (
        let batchStart = 0;
        batchStart < tier.length;
        batchStart += maxParallel
      ) {
        const batch = tier.slice(batchStart, batchStart + maxParallel);

        // Per-step token refs (isolate token tracking per concurrent step).
        const stepTokensRefs = batch.map(() => ({ value: 0 }));
        const stepStarts = batch.map(() => Date.now());

        // Emit step_started for each step in the batch (sequential to keep
        // event ordering deterministic for consumers that watch the stream).
        batch.forEach((step, batchIdx) => {
          const stepIndex = tierIndexBase + batchStart + batchIdx;
          this.logger.log(
            `[SelfDriven] mission ${missionId} step ${stepIndex + 1}/${totalSteps} started: ` +
              `"${step.name}" (executor=${step.executor}, loopKind=${step.loopKind ?? "default"})`,
          );
        });

        for (let batchIdx = 0; batchIdx < batch.length; batchIdx++) {
          const step = batch[batchIdx];
          const stepIndex = tierIndexBase + batchStart + batchIdx;
          yield {
            type: "step_started",
            missionId,
            stepId: step.id,
            stepName: step.name,
            executor: step.executor,
            stepIndex,
            totalSteps,
          };
        }

        // Build one generator per batch step and merge their event streams.
        // Each generator yields SelfDrivenMissionEvent and returns a string.
        // We need the return value (accumulated text), so we wrap each generator
        // to capture it, then merge the yielded events.
        type StepResult = {
          stepId: string;
          output: string;
          tokens: number;
          ok: boolean;
          err?: string;
        };
        const stepResultPromises: Promise<StepResult>[] = [];

        // Create wrapped generators that capture output + tokens.
        const wrappedGens: AsyncGenerator<
          SelfDrivenMissionEvent,
          void,
          unknown
        >[] = batch.map((step, batchIdx) => {
          const tokensRef = stepTokensRefs[batchIdx];
          // Wrap in an async generator that forwards all events and resolves
          // the result promise when the inner generator finishes.
          let resolveResult!: (r: StepResult) => void;
          const resultPromise = new Promise<StepResult>((res) => {
            resolveResult = res;
          });
          stepResultPromises.push(resultPromise);

          // `this` is the instance here (arrow callback). executeStep returns a
          // lazy generator (no execution until .next()), so creating it eagerly
          // here avoids aliasing `this` inside the inner generator function.
          const stepGen = this.executeStep(
            step,
            plan,
            input,
            stepOutputs,
            signal,
            appendContext,
            lang,
            tokensRef,
          );
          async function* wrappedStep(): AsyncGenerator<
            SelfDrivenMissionEvent,
            void,
            unknown
          > {
            try {
              let output = "";
              // eslint-disable-next-line no-constant-condition
              while (true) {
                const result = await stepGen.next();
                if (result.done) {
                  output = result.value ?? "";
                  break;
                }
                yield result.value;
              }
              resolveResult({
                stepId: step.id,
                output,
                tokens: tokensRef.value,
                ok: true,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              resolveResult({
                stepId: step.id,
                output: "",
                tokens: tokensRef.value,
                ok: false,
                err: msg,
              });
            }
          }

          return wrappedStep();
        });

        // Merge all concurrent generator event streams into the parent yield.
        // mergeAsyncGenerators guarantees per-generator ordering while allowing
        // interleaving between generators (same as Promise.race semantics).
        for await (const event of SelfDrivenMissionRunner.mergeAsyncGenerators(
          wrappedGens,
        )) {
          yield event;
        }

        // All batch generators are exhausted — collect results and emit step_completed.
        const batchResults = await Promise.all(stepResultPromises);

        for (let batchIdx = 0; batchIdx < batch.length; batchIdx++) {
          const step = batch[batchIdx];
          const res = batchResults[batchIdx];
          const stepStart = stepStarts[batchIdx];
          const tokensRef = stepTokensRefs[batchIdx];

          missionTokensUsed += tokensRef.value;

          if (res.ok) {
            stepOutputs.set(step.id, res.output);
            this.logger.log(
              `[SelfDriven] mission ${missionId} step "${step.name}" completed: ` +
                `ok=true durationMs=${Date.now() - stepStart} outputChars=${res.output.length}` +
                ` stepTokens=${tokensRef.value} missionTotal=${missionTokensUsed}` +
                (res.output.length === 0
                  ? " (EMPTY OUTPUT — step produced nothing)"
                  : ""),
            );
            yield {
              type: "step_completed",
              missionId,
              stepId: step.id,
              stepName: step.name,
              ok: true,
              durationMs: Date.now() - stepStart,
            };
          } else {
            this.logger.error(
              `[SelfDriven] mission ${missionId} step "${step.name}" (${step.executor}) failed: ${res.err ?? "unknown"}`,
            );
            // Single-step failure: degrade gracefully, continue with remaining steps.
            yield {
              type: "step_completed",
              missionId,
              stepId: step.id,
              stepName: step.name,
              ok: false,
              durationMs: Date.now() - stepStart,
            };
            // stepOutputs intentionally left empty for this step so the report
            // marks it as skipped rather than crashing.
          }
        }
      }
    }

    yield { type: "phase", missionId, phase: "execute", status: "completed" };
    this.logger.log(
      `[SelfDriven] mission ${missionId} execute phase done: ` +
        `${stepOutputs.size}/${totalSteps} steps produced output`,
    );

    // ── HITL gate: deliver_confirm ────────────────────────────────────────────
    // Block before the report is assembled so the user can append final
    // instructions (e.g. "add an executive summary") or reject the output.
    if (signal?.aborted) {
      yield { type: "error", missionId, message: "aborted" };
      return;
    }
    // Accumulates only deliver-gate feedback (appendInstruction + chosen options).
    // Kept separate from appendContext (which is used for execute-phase step prompts)
    // so we can apply it as a finalize LLM pass on the assembled report.
    let deliverFeedback = "";
    {
      const deliverGatePrompt =
        `Mission "${input.prompt.slice(0, 120)}" — execution complete ` +
        `(${stepOutputs.size}/${plan.steps.length} steps succeeded).\n` +
        `Approve to assemble the final report, reject to cancel, or provide ` +
        `feedback to adjust before assembly.`;

      // Generate dynamic deliver-gate choices (best-effort).
      const deliverContextSummary =
        `Objective: ${input.prompt.slice(0, 200)}\n` +
        `Completed steps (${stepOutputs.size}/${plan.steps.length}): ` +
        `${plan.steps
          .filter((s) => stepOutputs.has(s.id))
          .map((s) => s.name)
          .join(", ")}.`;
      const deliverGateChoices = await this.generateGateChoices(
        "deliver_confirm",
        deliverContextSummary,
        input.userId,
        missionId,
        lang,
      );

      const deliverPrep = await this.hitlGate.prepareGate(
        missionId,
        "deliver_confirm",
        deliverGatePrompt,
        undefined,
        deliverGateChoices.length > 0 ? deliverGateChoices : undefined,
      );

      yield {
        type: "awaiting_approval",
        missionId,
        requestId: deliverPrep.requestId,
        gate: "deliver_confirm",
        prompt: deliverGatePrompt,
        choices: deliverGateChoices.length > 0 ? deliverGateChoices : undefined,
      };

      const deliverGate = deliverPrep.autoApproved
        ? { requestId: deliverPrep.requestId, approved: true, timedOut: true }
        : {
            requestId: deliverPrep.requestId,
            ...(await this.hitlGate.awaitGate(
              deliverPrep.requestId,
              missionId,
              "deliver_confirm",
              signal,
            )),
          };

      yield {
        type: "approval_resolved",
        missionId,
        requestId: deliverGate.requestId,
        gate: "deliver_confirm",
        approved: deliverGate.approved,
        timedOut: deliverGate.timedOut,
        appendInstruction: deliverGate.appendInstruction,
      };

      if (!deliverGate.approved) {
        this.logger.log(
          `[SelfDriven] mission ${missionId} deliver rejected by human`,
        );
        yield {
          type: "error",
          missionId,
          message: "deliver rejected by human",
        };
        return;
      }

      if (deliverGate.timedOut) {
        yield {
          type: "phase",
          missionId,
          phase: "deliver",
          status: "started",
          detail: "deliver_confirm gate timed out — auto-approved after 10 min",
        };
      }

      // Merge any deliver-gate append instruction with the plan-gate one.
      if (deliverGate.appendInstruction) {
        appendContext = appendContext
          ? `${appendContext}\n\n${deliverGate.appendInstruction}`
          : deliverGate.appendInstruction;
        // Also track deliver-only feedback for the finalize LLM pass.
        deliverFeedback = deliverGate.appendInstruction;
      }

      // Apply all human-chosen deliver-gate options as additional appendContext.
      // Non-"proceed" options (e.g. "add executive summary") are appended so the
      // report composer honours every requested adjustment. Multi-select: collect
      // from chosenChoiceIds (array), fall back to single chosenChoiceId.
      const rawDeliverChosenIds =
        (deliverGate as { chosenChoiceIds?: string[] }).chosenChoiceIds ??
        ((deliverGate as { chosenChoiceId?: string }).chosenChoiceId
          ? [(deliverGate as { chosenChoiceId?: string }).chosenChoiceId!]
          : []);
      const activeDeliverIds = rawDeliverChosenIds.filter(
        (id) => id !== "proceed",
      );
      if (activeDeliverIds.length > 0) {
        for (const id of activeDeliverIds) {
          const opt = deliverGateChoices.find((c) => c.id === id);
          if (!opt) continue;
          const choiceText = opt.description
            ? `${opt.label}: ${opt.description}`
            : opt.label;
          appendContext = appendContext
            ? `${appendContext}\n\n${choiceText}`
            : choiceText;
          // Accumulate into deliverFeedback for the finalize LLM pass.
          deliverFeedback = deliverFeedback
            ? `${deliverFeedback}\n\n${choiceText}`
            : choiceText;
        }
        this.logger.log(
          `[SelfDriven] mission ${missionId} deliver-gate choices applied: ` +
            `[${activeDeliverIds.join(", ")}] → appended to context`,
        );
      }
    }

    // ── Phase: deliver ────────────────────────────────────────────────────────
    if (signal?.aborted) {
      yield { type: "error", missionId, message: "aborted" };
      return;
    }
    // "composing" detail so the UI shows the deliver phase is actively working
    // (it now runs LLM passes that can take a while) instead of a frozen bar.
    yield {
      type: "phase",
      missionId,
      phase: "deliver",
      status: "started",
      detail: "composing report",
    };

    try {
      // References extraction and the synthesis pass are INDEPENDENT, so run
      // them concurrently — this is the slowest part of the deliver phase and
      // serialising them (each up to 120s) is what made the mission look frozen
      // at "deliver approved" for minutes. Both are non-fatal best-effort.
      const [referencesMarkdown, synthesizedBody] = await Promise.all([
        this.extractReferencesMarkdown(
          stepOutputs,
          input.userId,
          missionId,
          lang,
        ),
        this.synthesizeReport(
          plan,
          stepOutputs,
          input.prompt,
          lang,
          input.userId,
          missionId,
        ),
      ]);

      const report = this.composer.compose({
        plan,
        stepOutputs,
        userPrompt: input.prompt,
        referencesMarkdown,
        language: lang,
        synthesizedBody,
      });

      this.logger.log(
        `[SelfDriven] mission ${missionId} report assembled: ` +
          `${report.wordCount} words, ` +
          `${stepOutputs.size}/${plan.steps.length} steps contributed`,
      );

      // ── Rubric self-evaluation ────────────────────────────────────────────
      // Scores the draft against plan.rubric and optionally triggers ONE
      // refinement pass. The refinement is a full-report rewrite, which is
      // SKIPPED for large reports (truncation guard) — so running the eval at
      // all is wasted latency when it could never act. Only evaluate when a
      // refinement could actually run.
      let finalContent = report.content;
      const canRefine =
        report.content.length <=
        SelfDrivenMissionRunner.FINALIZE_MAX_INPUT_CHARS;
      if (canRefine && plan.rubric && plan.rubric.length > 0) {
        const rubricResult = await this.evaluateAgainstRubric(
          report.content,
          plan.rubric,
          input.userId,
          missionId,
        );
        yield {
          type: "phase",
          missionId,
          phase: "deliver",
          status: "started",
          detail: `quality score=${rubricResult.totalScore}/100 — ${rubricResult.summary}`,
        };
        this.logger.log(
          `[SelfDriven] mission ${missionId} rubric evaluation: ` +
            `score=${rubricResult.totalScore}/100, shouldRefine=${rubricResult.shouldRefine}`,
        );
        if (rubricResult.shouldRefine) {
          this.logger.log(
            `[SelfDriven] mission ${missionId} triggering critique-driven refinement ` +
              `(score ${rubricResult.totalScore}/100 below passLine)`,
          );
          const critique = rubricResult.dimensionFeedback
            .filter((d) => d.score < d.passLine)
            .map((d) => `${d.dimension} (${d.score}/100): ${d.feedback}`)
            .join("\n");
          const refined = await this.finalizeReportViaLLM(
            report.content,
            `Improve the following quality gaps:\n${critique}`,
            input.userId,
            missionId,
          );
          if (refined) {
            finalContent = refined;
            this.logger.log(
              `[SelfDriven] mission ${missionId} rubric refinement completed: ` +
                `${finalContent.length} chars`,
            );
          } else {
            this.logger.warn(
              `[SelfDriven] mission ${missionId} rubric refinement failed — using original report`,
            );
          }
        }
      }

      // ── Finalize pass: apply deliver-gate feedback via LLM ────────────────
      // Only triggered when the user provided new instructions at the deliver
      // gate (appendInstruction or non-proceed choice options). Non-fatal:
      // any LLM error → falls back to the composed report unchanged.
      if (deliverFeedback.trim().length > 0) {
        this.logger.log(
          `[SelfDriven] mission ${missionId} finalize pass: ` +
            `applying deliver-gate feedback (${deliverFeedback.length} chars)`,
        );
        const finalized = await this.finalizeReportViaLLM(
          finalContent,
          deliverFeedback,
          input.userId,
          missionId,
        );
        if (finalized) {
          finalContent = finalized;
          this.logger.log(
            `[SelfDriven] mission ${missionId} finalize completed: ` +
              `${finalContent.length} chars`,
          );
        } else {
          this.logger.warn(
            `[SelfDriven] mission ${missionId} finalize failed — using original report`,
          );
        }
      }

      yield {
        type: "deliverable",
        missionId,
        deliverableType: "report",
        content: finalContent,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[SelfDriven] mission ${missionId} deliver phase failed: ${message}`,
      );
      // Fallback: emit whatever partial content we have as the deliverable
      // rather than failing the whole mission silently.
      const fallback =
        `# Mission Report\n\n**Objective:** ${input.prompt}\n\n` +
        `_Report assembly encountered an error: ${message}._\n\n` +
        this.buildFallbackContent(plan, stepOutputs);
      yield {
        type: "deliverable",
        missionId,
        deliverableType: "report",
        content: fallback,
      };
    }

    yield { type: "phase", missionId, phase: "deliver", status: "completed" };

    this.logger.log(`[SelfDriven] mission ${missionId} done`);
    yield { type: "done", missionId };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Best-effort citation extraction from the assembled step outputs.
   *
   * Makes ONE LLM call (deterministic, short) to extract key sources mentioned
   * in the report text, maps them to CitationMetadata via the engine's
   * buildCitationMetadata, then generates an APA bibliography via
   * generateBibliography. Returns the formattedText string or undefined when
   * there is nothing to show.
   *
   * Non-fatal: any exception → returns undefined (caller skips the section).
   */
  private async extractReferencesMarkdown(
    stepOutputs: Map<string, string>,
    userId: string,
    missionId: string,
    _lang?: string,
  ): Promise<string | undefined> {
    if (stepOutputs.size === 0) return undefined;

    const reportText = [...stepOutputs.values()].join("\n\n");
    if (reportText.trim().length === 0) return undefined;

    // Truncate to avoid hitting token limits on very large reports.
    const MAX_CHARS = 12_000;
    const excerpt =
      reportText.length > MAX_CHARS
        ? reportText.slice(0, MAX_CHARS) + "\n[...truncated...]"
        : reportText;

    const systemPrompt =
      `You are a bibliographic assistant. Analyse the provided report text and ` +
      `return ONLY a JSON array (max 20 items) of the key sources the text ` +
      `actually mentions or relies upon. Each element must have exactly these ` +
      `fields: "title" (string), "publisher" (string or null), ` +
      `"year" (4-digit string or null), "url" (string or null). ` +
      `Return [] if no identifiable sources are present. ` +
      `Output ONLY the JSON array — no markdown fences, no prose.`;

    let rawSources: Array<{
      title: string;
      publisher: string | null;
      year: string | null;
      url: string | null;
    }> = [];

    try {
      const res = await this.withTimeout(
        this.chat.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: excerpt },
          ],
          modelType: AIModelType.CHAT,
          taskProfile: { creativity: "deterministic", outputLength: "short" },
          responseFormat: "json",
          userId,
        }),
        SelfDrivenMissionRunner.DELIVER_LLM_TIMEOUT_MS,
        `mission ${missionId} references extraction`,
      );

      // Robust parse — strip optional ```json fences, try direct parse, then
      // regex-extract first [...] block (mirrors StepDecompositionService.parseSteps).
      let text = (res.content ?? "").trim();
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fence) text = fence[1].trim();

      const tryParse = (candidate: string) => {
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          /* fall through */
        }
        return null;
      };

      let parsed = tryParse(text);
      if (!parsed) {
        const arrMatch = text.match(/\[[\s\S]*\]/);
        if (arrMatch) parsed = tryParse(arrMatch[0]);
      }

      if (Array.isArray(parsed)) {
        rawSources = (parsed as unknown[])
          .slice(0, 20)
          .filter(
            (item): item is (typeof rawSources)[number] =>
              item !== null &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>)["title"] === "string" &&
              (item as Record<string, unknown>)["title"] !== "",
          );
      }
    } catch (err) {
      this.logger.warn(
        `[SelfDriven] mission ${missionId} citation extraction LLM call failed ` +
          `(non-fatal, skipping references section): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }

    if (rawSources.length === 0) {
      this.logger.debug(
        `[SelfDriven] mission ${missionId} citation extraction: 0 sources found, ` +
          `skipping references section`,
      );
      return undefined;
    }

    // Map to RawEvidence → CitationMetadata using the engine citation API.
    const metadataList: CitationMetadata[] = rawSources.map((src) => {
      const evidence: CitationRawEvidence = {
        title: src.title,
        url: src.url ?? undefined,
        metadata: {
          // Most self-driven sources are organizations (Gartner, IDC, IEA…), not
          // authored papers. Feed the publisher as the (corporate) author so the
          // bibliography renders "Gartner (2023). …" instead of "Unknown (2023). …".
          ...(src.publisher
            ? { publisher: src.publisher, authors: [src.publisher] }
            : {}),
          ...(src.year ? { publishedYear: src.year } : {}),
        },
      };
      // If we have a year string, synthesise a publishedAt date for the formatter.
      const publishedAt =
        src.year && /^\d{4}$/.test(src.year)
          ? new Date(`${src.year}-01-01`)
          : undefined;
      return buildCitationMetadata({ ...evidence, publishedAt });
    });

    const bib = generateBibliography(metadataList, "apa");

    if (!bib.formattedText || bib.formattedText.trim().length === 0) {
      return undefined;
    }

    this.logger.debug(
      `[SelfDriven] mission ${missionId} citation extraction: ` +
        `${metadataList.length} source(s) → APA bibliography generated`,
    );

    return bib.formattedText;
  }

  /**
   * Generate dynamic, context-aware gate choices via a single deterministic LLM
   * call.  Returns an array of options that is always led by a "proceed" entry
   * (proceed as-is) followed by 2–4 context-specific refinement options.
   *
   * Best-effort: any error (LLM failure, parse failure) returns [] so the gate
   * still functions as a plain approve/reject checkpoint. Never throws.
   *
   * Output format expected from the model:
   *   [{"id":"proceed","label":"按现计划执行","description":"..."},
   *    {"id":"<slug>","label":"...","description":"..."},...]
   *
   * Parsing strategy (mirrors StepDecompositionService.parseSteps):
   *   1. Strip optional ```json fences.
   *   2. JSON.parse directly.
   *   3. Regex-extract first [...] block as fallback.
   *   4. Validate items have non-empty id + label strings.
   *   5. Return [] on any failure.
   */
  private async generateGateChoices(
    gate: "plan_confirm" | "deliver_confirm",
    contextSummary: string,
    userId: string,
    missionId: string,
    lang?: string,
  ): Promise<Array<{ id: string; label: string; description?: string }>> {
    const langInstruction = lang
      ? ` Write all label and description values in ${lang}.`
      : "";
    const systemPrompt =
      gate === "plan_confirm"
        ? `You are a mission planning assistant. Given a mission plan summary, ` +
          `generate 3–5 actionable choice options the human can select at this ` +
          `checkpoint. The first option MUST be ` +
          `{"id":"proceed","label":"按现计划执行","description":"Execute the plan exactly as generated"}. ` +
          `Additional options should be context-specific adjustments (e.g. go deeper on ` +
          `a named aspect, reduce/increase steps, add or refocus a step, change depth). ` +
          `Use concise, specific labels (≤8 words).${langInstruction} ` +
          `Return ONLY a JSON array of objects with fields: id (kebab-slug, unique), ` +
          `label (string), description (string, optional). No markdown, no prose.`
        : `You are a mission delivery assistant. Given a mission execution summary, ` +
          `generate 3–5 actionable choice options the human can select before the ` +
          `final report is assembled. The first option MUST be ` +
          `{"id":"proceed","label":"按现计划交付","description":"Assemble and deliver the report as-is"}. ` +
          `Additional options should be report-level adjustments (e.g. add executive ` +
          `summary, expand a section, add key takeaways, restructure, add citations). ` +
          `Use concise, specific labels (≤8 words).${langInstruction} ` +
          `Return ONLY a JSON array of objects with fields: id (kebab-slug, unique), ` +
          `label (string), description (string, optional). No markdown, no prose.`;

    try {
      const res = await this.withTimeout(
        this.chat.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: contextSummary },
          ],
          modelType: AIModelType.CHAT,
          taskProfile: { creativity: "deterministic", outputLength: "short" },
          responseFormat: "json",
          userId,
        }),
        SelfDrivenMissionRunner.GATE_CHOICES_TIMEOUT_MS,
        `mission ${missionId} gate-choice generation`,
      );

      let text = (res.content ?? "").trim();

      // Strip optional ```json fences.
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fence) text = fence[1].trim();

      const tryParse = (
        candidate: string,
      ): Array<{ id: string; label: string; description?: string }> | null => {
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) {
            return (parsed as unknown[])
              .filter(
                (
                  item,
                ): item is {
                  id: string;
                  label: string;
                  description?: string;
                } =>
                  item !== null &&
                  typeof item === "object" &&
                  typeof (item as Record<string, unknown>)["id"] === "string" &&
                  (item as Record<string, unknown>)["id"] !== "" &&
                  typeof (item as Record<string, unknown>)["label"] ===
                    "string" &&
                  (item as Record<string, unknown>)["label"] !== "",
              )
              .slice(0, 6);
          }
        } catch {
          /* fall through */
        }
        return null;
      };

      let choices = tryParse(text);
      if (!choices) {
        const arrMatch = text.match(/\[[\s\S]*\]/);
        if (arrMatch) choices = tryParse(arrMatch[0]);
      }

      if (!choices || choices.length === 0) {
        this.logger.debug(
          `[SelfDriven] mission ${missionId} gate=${gate} choice generation: ` +
            `LLM returned unparseable content — using empty choices`,
        );
        return [];
      }

      // Ensure "proceed" is always first (model may have placed it elsewhere or
      // forgotten it entirely — inject if missing).
      const hasProceeed = choices.some((c) => c.id === "proceed");
      if (!hasProceeed) {
        const proceedLabel =
          gate === "plan_confirm" ? "按现计划执行" : "按现计划交付";
        const proceedDesc =
          gate === "plan_confirm"
            ? "Execute the plan exactly as generated"
            : "Assemble and deliver the report as-is";
        choices = [
          { id: "proceed", label: proceedLabel, description: proceedDesc },
          ...choices,
        ].slice(0, 6);
      } else {
        // Move "proceed" to the front if not already first.
        const proceedIdx = choices.findIndex((c) => c.id === "proceed");
        if (proceedIdx > 0) {
          const proceed = choices.splice(proceedIdx, 1)[0];
          choices.unshift(proceed);
        }
      }

      this.logger.debug(
        `[SelfDriven] mission ${missionId} gate=${gate} generated ` +
          `${choices.length} choices`,
      );
      return choices;
    } catch (err) {
      this.logger.warn(
        `[SelfDriven] mission ${missionId} gate=${gate} choice generation failed ` +
          `(non-fatal, gate continues as plain approve/reject): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Execute a single plan step, yielding real-time events and returning the
   * accumulated text as the generator's return value.
   *
   * Routing logic (per survey降级方案 — ITeamMember has no execute() method,
   * so ReActLoop path is deferred to a follow-up specialist task):
   *
   *   • Tool-capable path (role has coreTools AND step.loopKind is react or
   *     leader-worker): DEFERRED — falls through to chatStream identical to
   *     delivery path. When ITeamMember gains execute(), this branch will drive
   *     the ReActLoop and emit tool_call events per tool invocation.
   *
   *   • Generation / delivery path: AiChatService.chatStream(), yielding one
   *     SelfDrivenMissionEvent `chunk` per token-chunk for true per-token UI
   *     streaming. Final accumulated text is returned as generator return value.
   *
   *   • Fallback on any streaming error: falls back to this.chat.chat() (single
   *     blocking call) so a single step never crashes the mission.
   *
   * System prompt is built from:
   *   1. Role prototype systemPromptHint (from RoleInventory).
   *   2. Overall mission objective.
   *   3. Condensed prior-step outputs for cross-step context.
   *
   * TaskProfile (no hard-coded temperatures — all via TaskProfile):
   *   - delivery/writing → creativity="medium", outputLength="long"
   *   - review/critique  → creativity="low",    outputLength="medium"
   *   - task/research    → creativity="low",    outputLength="long"
   *
   * modelId: assignment's modelId if non-empty; "" = LLMFactory default
   * (red-line compliant, no hard-coded model names).
   */
  private async *executeStep(
    step: ExecutionStep,
    plan: MissionExecutionPlan,
    input: SelfDrivenMissionInput,
    priorOutputs: Map<string, string>,
    signal?: AbortSignal,
    appendContext?: string,
    lang?: string,
    stepTokensRef?: { value: number },
  ): AsyncGenerator<SelfDrivenMissionEvent, string, unknown> {
    const missionId = plan.missionId;

    // Resolve role prototype for systemPromptHint and coreTools.
    const proto = this.roleInventory.getRole(step.executor);
    const roleHint =
      proto?.systemPromptHint ??
      `You are a ${step.executor}. Complete the assigned task thoroughly.`;

    // Build condensed prior context from dependency outputs only (avoid
    // ballooning context with all prior steps unconditionally).
    const priorContext = this.buildPriorContext(step, priorOutputs, plan);

    // Incorporate any sanitized HITL append instruction into the system prompt
    // so the executing role can honour user refinements for this step.
    const effectivePrompt = appendContext
      ? `${input.prompt}\n\n[User refinement]: ${appendContext}`
      : input.prompt;

    const systemPrompt = this.composer.buildStepSystemPrompt(
      step,
      roleHint,
      effectivePrompt,
      priorContext,
      lang,
    );

    // Select TaskProfile based on step type / loopKind + analysis depth.
    const taskProfile = this.resolveTaskProfile(step, input.analysisDepth);

    // Resolve modelId from the role assignment; "" = LLMFactory default.
    const assignment = plan.roleAssignments?.find(
      (a) => a.roleId === step.executor,
    );
    const modelId = assignment?.modelId ?? "";

    const userMessage = {
      role: "user" as const,
      content:
        `Task: ${step.name}\n\n${step.description}` +
        (step.input
          ? `\n\nAdditional context: ${JSON.stringify(step.input)}`
          : ""),
    };

    // ── Determine routing ────────────────────────────────────────────────────
    // Tool-capable path: role has coreTools AND step loopKind is react or
    // leader-worker → run a real ReActLoop via AgentFactory.create().execute().
    // Generation path: chatStream for delivery / review / integration steps.
    //
    // ⚠ Report quality: the ReActLoop path returns a STRUCTURED object as its
    // final answer, which the composer can only JSON.stringify into the report —
    // raw JSON is not readable prose (a single research step dumped a
    // `{"market_research":{...}}` blob into the report). Until the agent's
    // structured output is post-formatted into Markdown, force every step through
    // the chatStream text path so the deliverable is clean prose/tables. The tool
    // path stays in code (deferred) and is re-enabled by flipping this flag.
    const isToolCapable =
      SelfDrivenMissionRunner.ENABLE_TOOL_LOOP &&
      (proto?.coreTools.length ?? 0) > 0 &&
      (step.loopKind === "react" || step.loopKind === "leader-worker");

    if (isToolCapable) {
      this.logger.debug(
        `[SelfDriven] step "${step.name}" is tool-capable (role=${step.executor}, ` +
          `loopKind=${step.loopKind}) — running ReActLoop via AgentFactory`,
      );

      // Build AgentIdentity from the role prototype and current mission context.
      // The merged systemPrompt (roleHint + mission objective + prior step outputs +
      // appendContext) is passed as spec.systemPrompt so the agent has full situational
      // awareness without requiring a separate user message for context.
      const identity = new AgentIdentity({
        role: {
          id: proto!.roleId,
          name: proto!.title,
          description: proto!.systemPromptHint,
        },
        tools: [...proto!.coreTools],
        constraints: {
          maxIterations: proto!.maxIterations,
          maxTokens: taskProfile.outputLength === "long" ? 8_000 : 4_000,
        },
      });

      const agent = this.agentFactory.create(
        {
          identity,
          loop: "react",
          systemPrompt,
          userId: input.userId,
        },
        modelId || undefined,
      );

      const agentInput =
        step.description +
        (step.input
          ? `\n\nAdditional context: ${JSON.stringify(step.input)}`
          : "") +
        (priorContext ? `\n\n[Prior step context]\n${priorContext}` : "");

      let agentOutput = "";
      try {
        for await (const ev of agent.execute({
          goal: step.name,
          input: agentInput,
          signal,
        })) {
          if (signal?.aborted) {
            throw new Error("aborted");
          }

          if (ev.type === "thinking") {
            const thinkingEv = ev as IThinkingEvent;
            if (thinkingEv.payload.text) {
              yield {
                type: "chunk",
                missionId,
                content: thinkingEv.payload.text,
              } satisfies SelfDrivenMissionEvent;
            }
          } else if (ev.type === "action_executed") {
            const actionEv = ev as IActionExecutedEvent;
            const action = actionEv.payload.action;
            if (action.kind === "tool_call") {
              yield {
                type: "tool_call",
                missionId,
                stepId: step.id,
                toolId: action.toolId,
                label: `${action.toolId}: ${step.name}`,
              } satisfies SelfDrivenMissionEvent;
            } else if (action.kind === "parallel_tool_call") {
              for (const call of action.calls) {
                yield {
                  type: "tool_call",
                  missionId,
                  stepId: step.id,
                  toolId: call.toolId,
                  label: `${call.toolId}: ${step.name}`,
                } satisfies SelfDrivenMissionEvent;
              }
            }
          } else if (ev.type === "output") {
            const outputEv = ev as IOutputEvent;
            const rawOutput = outputEv.payload.output;
            agentOutput = this.composer.formatStructuredOutput(rawOutput);
          } else if (ev.type === "error") {
            const errorEv = ev as IErrorEvent;
            throw new Error(
              `Agent error for step "${step.name}": ${errorEv.payload.message}`,
            );
          } else if (ev.type === "validation_failed") {
            // Previously swallowed silently — surface it: the agent's output did
            // not satisfy the role's output schema and is being retried/forced.
            this.logger.warn(
              `[SelfDriven] mission ${missionId} step "${step.name}" — agent output failed schema validation (retry/force-finalize)`,
            );
          } else if (ev.type === "terminated") {
            const reason = (ev as { payload?: { reason?: string } }).payload
              ?.reason;
            if (reason && reason !== "completed" && reason !== "final_answer") {
              this.logger.warn(
                `[SelfDriven] mission ${missionId} step "${step.name}" — agent terminated early: reason=${reason}`,
              );
            }
          }
          // budget_warning / iteration_progress / action_planned / reflection /
          // tools_recalled are intentionally not surfaced (non-diagnostic noise).
        }

        // Emit the final agent output as a chunk so the report composer
        // has content to include for this step.
        if (agentOutput) {
          yield {
            type: "chunk",
            missionId,
            content: agentOutput,
          } satisfies SelfDrivenMissionEvent;
        } else {
          this.logger.warn(
            `[SelfDriven] mission ${missionId} step "${step.name}" (executor=${step.executor}, model=${modelId || "default"}) — agent produced NO output; report will mark this step empty`,
          );
        }

        return agentOutput;
      } catch (agentErr) {
        // ── Fallback tier 1: chatStream (then chat() inside) ─────────────────
        const agentMessage =
          agentErr instanceof Error ? agentErr.message : String(agentErr);
        this.logger.warn(
          `[SelfDriven] step "${step.name}" ReActLoop failed (${agentMessage}), ` +
            `falling back to chatStream`,
        );
        return yield* this.executeStepViaChatStream(
          step,
          missionId,
          systemPrompt,
          userMessage,
          taskProfile,
          modelId,
          input,
          signal,
          stepTokensRef,
        );
      }
    }

    // ── chatStream path (generation / delivery / review steps) ───────────────
    return yield* this.executeStepViaChatStream(
      step,
      missionId,
      systemPrompt,
      userMessage,
      taskProfile,
      modelId,
      input,
      signal,
      stepTokensRef,
    );
  }

  /**
   * Execute a step via AiChatService.chatStream() with a blocking chat() fallback.
   * Shared by the generation path and the ReActLoop fallback path.
   *
   * stepTokensRef: optional ref-object; when provided the method writes the
   * total tokens used by this step into `stepTokensRef.value` so the caller
   * can accumulate mission-level token usage without changing the return type.
   */
  private async *executeStepViaChatStream(
    step: ExecutionStep,
    missionId: string,
    systemPrompt: string,
    userMessage: { role: "user"; content: string },
    taskProfile: TaskProfile,
    modelId: string,
    input: SelfDrivenMissionInput,
    signal?: AbortSignal,
    stepTokensRef?: { value: number },
  ): AsyncGenerator<SelfDrivenMissionEvent, string, unknown> {
    let accumulated = "";
    try {
      for await (const chunk of this.chat.chatStream({
        systemPrompt,
        messages: [userMessage],
        taskProfile,
        modelType: AIModelType.CHAT,
        model: modelId || undefined,
        userId: input.userId,
        operationName: `self_driven_step_${step.id}`,
      })) {
        if (signal?.aborted) {
          throw new Error("aborted");
        }

        if (chunk.error) {
          throw new Error(
            `chatStream error for step "${step.name}": ${chunk.error}`,
          );
        }

        if (chunk.content) {
          accumulated += chunk.content;
          yield {
            type: "chunk",
            missionId,
            content: chunk.content,
          } satisfies SelfDrivenMissionEvent;
        }

        // Accumulate token usage from the final done-chunk (contains usage).
        if (chunk.done && chunk.usage && stepTokensRef) {
          stepTokensRef.value += chunk.usage.totalTokens ?? 0;
        }
      }

      return accumulated;
    } catch (streamErr) {
      // ── Fallback: blocking chat() with ENGINE model-level failover ───────
      // The streaming attempt above pinned the elected model explicitly. When
      // it fails (e.g. the diversity-elected model is unhealthy at call time),
      // we DROP the explicit model on the retry: AiChatService.chat() only
      // engages its built-in model-level failover (runChatWithModelFailover)
      // when no explicit `model` is passed — passing one short-circuits to a
      // single chatOnce with no recovery (ai-chat.service.ts §统一 chat 入口).
      // Dropping it lets the engine fail over to a healthy default, so one bad
      // per-role election no longer fails the whole step. (Reuses the existing
      // engine failover capability — no hand-rolled retry loop.)
      const streamMessage =
        streamErr instanceof Error ? streamErr.message : String(streamErr);
      this.logger.warn(
        `[SelfDriven] step "${step.name}" chatStream failed on model ` +
          `"${modelId || "default"}" (${streamMessage}) — retrying via chat() ` +
          `with engine model-level failover (dropping the elected model)`,
      );

      const result = await this.chat.chat({
        systemPrompt,
        messages: [userMessage],
        taskProfile,
        modelType: AIModelType.CHAT,
        // model intentionally omitted → engine model-level failover engages.
        userId: input.userId,
        signal,
      });

      if ((result as { isError?: boolean }).isError) {
        throw new Error(
          `LLM returned error for step "${step.name}": ${result.content}`,
        );
      }

      // Accumulate fallback token usage (chat() returns usage.totalTokens).
      if (stepTokensRef && result.usage?.totalTokens) {
        stepTokensRef.value += result.usage.totalTokens;
      }

      const fallbackContent = result.content ?? "";
      if (fallbackContent) {
        yield {
          type: "chunk",
          missionId,
          content: fallbackContent,
        } satisfies SelfDrivenMissionEvent;
      }

      return fallbackContent;
    }
  }

  /**
   * Resolve TaskProfile based on step type, loopKind, and analysis depth.
   * No hard-coded temperatures — all creativity/length choices go through TaskProfile.
   *
   * Depth shifts only the output length: "quick" shortens each step by one notch
   * (faster, terser), "deep" pushes every step to the longest tier (exhaustive),
   * "standard" keeps the per-step-type defaults.
   */
  private resolveTaskProfile(
    step: ExecutionStep,
    depth?: "quick" | "standard" | "deep",
  ): TaskProfile {
    const base: TaskProfile =
      step.type === "delivery"
        ? { creativity: "medium", outputLength: "long" }
        : step.type === "review"
          ? { creativity: "low", outputLength: "medium" }
          : // task / integration / default → research-style output
            { creativity: "low", outputLength: "long" };

    if (depth === "deep") {
      return { ...base, outputLength: "long" };
    }
    if (depth === "quick") {
      const shorter: Record<string, TaskProfile["outputLength"]> = {
        long: "medium",
        medium: "short",
        short: "short",
        minimal: "minimal",
      };
      return { ...base, outputLength: shorter[base.outputLength ?? "long"] };
    }
    return base;
  }

  /**
   * Build condensed prior context for the current step, drawing only from
   * the outputs of declared dependency steps.  Falls back to the most recent
   * completed step if no dependencies are declared (makes single-chain plans
   * naturally flow without explicit dependency wiring in the plan).
   *
   * Context is capped at ~2 000 chars per dependency to stay within LLM
   * context budgets for long missions.
   */
  private buildPriorContext(
    step: ExecutionStep,
    priorOutputs: Map<string, string>,
    plan: MissionExecutionPlan,
  ): string {
    const DEP_CAP = 2_000;
    const parts: string[] = [];

    if (step.dependencies.length > 0) {
      for (const depId of step.dependencies) {
        const depStep = plan.steps.find((s) => s.id === depId);
        const depOutput = priorOutputs.get(depId);
        if (!depOutput || !depStep) continue;
        const snippet =
          depOutput.length > DEP_CAP
            ? depOutput.slice(0, DEP_CAP) + "…"
            : depOutput;
        parts.push(`[${depStep.name}]\n${snippet}`);
      }
    } else if (priorOutputs.size > 0) {
      // No explicit deps: take the most recently completed step as context.
      const lastKey = [...priorOutputs.keys()].at(-1);
      if (lastKey) {
        const lastOutput = priorOutputs.get(lastKey) ?? "";
        const snippet =
          lastOutput.length > DEP_CAP
            ? lastOutput.slice(0, DEP_CAP) + "…"
            : lastOutput;
        const lastStep = plan.steps.find((s) => s.id === lastKey);
        parts.push(`[${lastStep?.name ?? lastKey}]\n${snippet}`);
      }
    }

    return parts.join("\n\n");
  }

  /**
   * Merge multiple async generators into a single interleaved stream.
   *
   * Events from each generator are forwarded as soon as they arrive, so
   * fast generators are not blocked by slow ones.  Per-generator event
   * ordering is preserved (the Promise for each generator is only
   * re-queued after its previous value has been yielded).
   *
   * The merged stream ends once every generator is exhausted.  If a
   * generator throws, the error propagates out of the for-await loop in
   * the caller — the remaining generators are not cancelled (they simply
   * race to completion and their events are dropped).  This matches the
   * single-step degradation semantics: one bad step does not abort siblings.
   *
   * Time complexity: O(N) per event where N = number of generators.
   */
  private static async *mergeAsyncGenerators<T>(
    generators: AsyncGenerator<T, void, unknown>[],
  ): AsyncGenerator<T, void, unknown> {
    if (generators.length === 0) return;

    // Map each generator to a pending promise that resolves with { gen, result }.
    type Slot = {
      gen: AsyncGenerator<T, void, unknown>;
      result: IteratorResult<T, void>;
    };
    const pending = new Map<AsyncGenerator<T, void, unknown>, Promise<Slot>>();

    const enqueue = (gen: AsyncGenerator<T, void, unknown>): void => {
      pending.set(
        gen,
        gen.next().then((result) => ({ gen, result })),
      );
    };

    for (const gen of generators) {
      enqueue(gen);
    }

    while (pending.size > 0) {
      // Race: whichever generator produces a value first wins this round.
      const { gen, result } = await Promise.race(pending.values());
      pending.delete(gen);

      if (!result.done) {
        yield result.value;
        // Re-queue this generator for its next value.
        enqueue(gen);
      }
      // If done, the generator is removed from pending (already deleted above).
    }
  }

  /**
   * Topological sort returning tiers (layers) rather than a flat sequence.
   *
   * Each tier is a set of steps that have no dependency on any other step
   * in the same tier.  Steps within a tier may execute concurrently; the
   * next tier begins only after every step in the current tier completes
   * (ensuring all dependency outputs are available via buildPriorContext).
   *
   * Uses the same Kahn algorithm as topologicalSort but accumulates nodes
   * per BFS level rather than into a single flat array.
   *
   * Falls back to [[...steps]] (one single-step tier per step) if a cycle
   * is detected so execution degrades gracefully to the serial path.
   */
  private topologicalSortLayered(steps: ExecutionStep[]): ExecutionStep[][] {
    if (steps.length === 0) return [];

    const idToStep = new Map(steps.map((s) => [s.id, s]));
    const inDegree = new Map<string, number>(steps.map((s) => [s.id, 0]));
    const dependents = new Map<string, string[]>(steps.map((s) => [s.id, []]));

    for (const step of steps) {
      for (const dep of step.dependencies) {
        if (!idToStep.has(dep)) continue;
        inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
        dependents.get(dep)?.push(step.id);
      }
    }

    const tiers: ExecutionStep[][] = [];
    let currentQueue: string[] = steps
      .filter((s) => (inDegree.get(s.id) ?? 0) === 0)
      .map((s) => s.id);
    let totalSorted = 0;

    while (currentQueue.length > 0) {
      const tier: ExecutionStep[] = [];
      const nextQueue: string[] = [];

      for (const id of currentQueue) {
        const step = idToStep.get(id);
        if (!step) continue;
        tier.push(step);
        totalSorted++;

        for (const depId of dependents.get(id) ?? []) {
          const newDegree = (inDegree.get(depId) ?? 1) - 1;
          inDegree.set(depId, newDegree);
          if (newDegree === 0) {
            nextQueue.push(depId);
          }
        }
      }

      if (tier.length > 0) tiers.push(tier);
      currentQueue = nextQueue;
    }

    if (totalSorted !== steps.length) {
      // Cycle detected — fall back to serial (one step per tier).
      this.logger.warn(
        `[SelfDriven] topological sort detected a cycle in plan steps — ` +
          `falling back to serial tier-per-step order.`,
      );
      return steps.map((s) => [s]);
    }

    return tiers;
  }

  /**
   * Fallback content builder for the deliver phase error path.
   * Concatenates whatever partial outputs were collected.
   */
  private buildFallbackContent(
    plan: MissionExecutionPlan,
    stepOutputs: Map<string, string>,
  ): string {
    const parts: string[] = [];
    for (const step of plan.steps) {
      const output = stepOutputs.get(step.id);
      if (output) {
        parts.push(`## ${step.name}\n\n${output.trim()}`);
      }
    }
    return parts.join("\n\n---\n\n");
  }

  /**
   * Score the draft report against plan.rubric using a single deterministic LLM
   * call. Returns per-dimension scores, a weighted total, and whether a
   * critique-driven refinement pass should be triggered.
   *
   * Non-fatal: any LLM/parse failure returns totalScore=70, shouldRefine=false
   * so the deliver phase proceeds unchanged.
   *
   * Uses AiChatService.chat() + TaskProfile — no hard-coded model or temperature.
   */
  private async evaluateAgainstRubric(
    content: string,
    rubric: Array<{ dimension: string; weight: number; passLine: number }>,
    userId: string,
    missionId: string,
  ): Promise<{
    totalScore: number;
    shouldRefine: boolean;
    summary: string;
    dimensionFeedback: Array<{
      dimension: string;
      score: number;
      passLine: number;
      feedback: string;
    }>;
  }> {
    const noopResult = {
      totalScore: 70,
      shouldRefine: false,
      summary: "no rubric",
      dimensionFeedback: [] as Array<{
        dimension: string;
        score: number;
        passLine: number;
        feedback: string;
      }>,
    };
    if (!rubric || rubric.length === 0) return noopResult;

    // Truncate large reports to stay within token budget for the evaluator call.
    const MAX_CHARS = 8_000;
    const excerpt =
      content.length > MAX_CHARS
        ? content.slice(0, MAX_CHARS) + "\n[...truncated...]"
        : content;

    const dimList = rubric
      .map(
        (d) => `- ${d.dimension} (weight ${d.weight}, passLine ${d.passLine})`,
      )
      .join("\n");

    const systemPrompt =
      `You are a report quality evaluator. Score the provided report draft ` +
      `against the following rubric dimensions:\n${dimList}\n\n` +
      `Return ONLY a JSON object with this exact shape:\n` +
      `{"scores":[{"dimension":"...","score":0-100,"feedback":"..."}],"overallNote":"..."}\n` +
      `No markdown fences, no prose outside the JSON.`;

    try {
      const res = await this.withTimeout(
        this.chat.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Report draft:\n---\n${excerpt}\n---` },
          ],
          modelType: AIModelType.CHAT,
          taskProfile: { creativity: "deterministic", outputLength: "short" },
          responseFormat: "json",
          userId,
        }),
        SelfDrivenMissionRunner.DELIVER_LLM_TIMEOUT_MS,
        `mission ${missionId} rubric evaluation`,
      );

      // Robust parse — strip optional ```json fences.
      let text = (res.content ?? "").trim();
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fence) text = fence[1].trim();

      const parsed = JSON.parse(text) as {
        scores: Array<{ dimension: string; score: number; feedback: string }>;
        overallNote: string;
      };

      if (!Array.isArray(parsed.scores) || parsed.scores.length === 0) {
        return noopResult;
      }

      // Weighted total score (weight-sum normalised).
      const totalWeight = rubric.reduce((s, d) => s + d.weight, 0) || 1;
      let weightedSum = 0;
      const dimensionFeedback = parsed.scores.map((s) => {
        const dim = rubric.find((d) => d.dimension === s.dimension);
        const weight = dim?.weight ?? 1;
        const passLine = dim?.passLine ?? 70;
        weightedSum += s.score * weight;
        return {
          dimension: s.dimension,
          score: s.score,
          passLine,
          feedback: s.feedback,
        };
      });

      const totalScore = Math.round(weightedSum / totalWeight);
      // Trigger refinement when the weighted score is below any dimension's passLine
      // that also has a low individual score — OR the aggregate is below the mean passLine.
      const meanPassLine =
        rubric.reduce((s, d) => s + d.passLine, 0) / rubric.length;
      const shouldRefine =
        totalScore < meanPassLine ||
        dimensionFeedback.some((d) => d.score < d.passLine);

      return {
        totalScore,
        shouldRefine,
        summary: (parsed.overallNote ?? "").slice(0, 120),
        dimensionFeedback,
      };
    } catch (err) {
      this.logger.warn(
        `[SelfDriven] mission ${missionId} rubric evaluation failed (non-fatal): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return noopResult;
    }
  }

  /**
   * Synthesis pass — read ALL step outputs and write ONE coherent, non-redundant
   * report that integrates the concrete findings. This replaces the old
   * "concatenate every step verbatim" assembly (which produced multiple
   * overlapping reports + raw-JSON sections + no actual integration).
   *
   * Input can be large (all findings); output is one report (~8000 tokens =
   * a normal report length), so there's no truncation risk — the body is
   * authored fresh at its natural length, with the full detail preserved in the
   * appendix the composer adds. Non-fatal: returns undefined on any failure so
   * the composer falls back to legacy concatenation.
   */
  private async synthesizeReport(
    plan: MissionExecutionPlan,
    stepOutputs: Map<string, string>,
    userPrompt: string,
    language: string | undefined,
    userId: string,
    missionId: string,
  ): Promise<string | undefined> {
    if (stepOutputs.size === 0) return undefined;

    // Assemble the findings, capping each step so the combined input stays
    // within a comfortable context budget (8 × 6k ≈ 48k chars ≈ ~16k tokens).
    const PER_STEP_CAP = 6_000;
    const findings = plan.steps
      .map((step) => {
        const out = stepOutputs.get(step.id);
        if (!out) return null;
        const body =
          out.length > PER_STEP_CAP ? out.slice(0, PER_STEP_CAP) + "…" : out;
        return `### Finding from "${step.name}" (${step.executor})\n${body}`;
      })
      .filter((s): s is string => s !== null)
      .join("\n\n");

    const langLine = language
      ? `Write the entire report in ${language}. Do not mix languages.\n`
      : "";

    const systemPrompt =
      `You are a senior research report writer. You are given the raw findings ` +
      `from several specialist steps of a research mission. Your job is to ` +
      `SYNTHESIZE them into ONE coherent, well-structured, non-redundant report ` +
      `that directly answers the mission objective.\n\n` +
      `Hard requirements:\n` +
      `- Integrate the CONCRETE findings — the actual numbers, tables, ` +
      `scenarios, and results from the steps. Do NOT write a generic essay from ` +
      `general knowledge; use what the findings actually say.\n` +
      `- Do NOT repeat the same content in multiple sections. Each point appears ` +
      `once, in the most relevant place.\n` +
      `- Keep important data tables (render them as clean Markdown tables).\n` +
      `- Preserve any inline source links ([label](url)) that appear in the ` +
      `findings; never invent URLs.\n` +
      `- Start with a single top-level "# " title, then a brief executive ` +
      `summary, then the body, then a conclusion.\n` +
      `- Output ONLY the report Markdown — no meta-commentary about your task.\n` +
      langLine;

    const userMessage = {
      role: "user" as const,
      content:
        `Mission objective: ${userPrompt}\n\n` +
        `Raw findings to synthesize:\n\n${findings}`,
    };

    try {
      const result = await this.withTimeout(
        this.chat.chat({
          messages: [{ role: "system", content: systemPrompt }, userMessage],
          modelType: AIModelType.CHAT,
          taskProfile: { creativity: "medium", outputLength: "long" },
          userId,
        }),
        SelfDrivenMissionRunner.DELIVER_LLM_TIMEOUT_MS,
        `mission ${missionId} report synthesis`,
      );

      const synthesized = (result.content ?? "").trim();
      if (synthesized.length < 200) {
        this.logger.warn(
          `[SelfDriven] mission ${missionId} synthesis output too short ` +
            `(${synthesized.length} chars) — falling back to legacy concat`,
        );
        return undefined;
      }
      this.logger.log(
        `[SelfDriven] mission ${missionId} synthesis produced ${synthesized.length} chars ` +
          `from ${stepOutputs.size} step outputs`,
      );
      return synthesized;
    } catch (err) {
      this.logger.warn(
        `[SelfDriven] mission ${missionId} synthesis failed (non-fatal): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  /**
   * Apply deliver-gate user feedback to the assembled report via a single LLM
   * call.  The model is instructed to preserve all facts while restructuring or
   * expanding the report to honour the user's request.
   *
   * Non-fatal: returns undefined on any error (empty output, LLM failure, etc.)
   * so the caller can safely fall back to the original report.
   *
   * Uses AiChatService.chat() + TaskProfile — no hard-coded model or temperature.
   */
  private async finalizeReportViaLLM(
    baseReport: string,
    userFeedback: string,
    userId: string,
    missionId: string,
  ): Promise<string | undefined> {
    // P0 size guard (covers BOTH callers: deliver-gate finalize AND rubric
    // critique refinement). A whole-document rewrite cannot fit a report larger
    // than the ~8000-token output ceiling and would silently truncate it. Skip
    // the rewrite and keep the original verbatim rather than shipping a
    // truncated report. See FINALIZE_MAX_INPUT_CHARS.
    if (baseReport.length > SelfDrivenMissionRunner.FINALIZE_MAX_INPUT_CHARS) {
      this.logger.warn(
        `[SelfDriven] mission ${missionId} finalize SKIPPED: report ` +
          `${baseReport.length} chars exceeds the ` +
          `${SelfDrivenMissionRunner.FINALIZE_MAX_INPUT_CHARS}-char single-pass ` +
          `rewrite ceiling (~8000 output tokens) — keeping the original to ` +
          `avoid silent truncation`,
      );
      return undefined;
    }

    const systemPrompt =
      `You are a report refinement specialist. ` +
      `Your task is to take an assembled research report and apply user ` +
      `feedback to improve it. Preserve all facts and data — only restructure, ` +
      `expand, or reorganize based on the user's request. ` +
      `Output ONLY the refined report markdown, no meta-commentary.`;

    const userMessage = {
      role: "user" as const,
      content:
        `Original report:\n---\n${baseReport}\n---\n\n` +
        `User feedback: ${userFeedback}\n\n` +
        `Refactor the report to incorporate the user's request.`,
    };

    try {
      const result = await this.withTimeout(
        this.chat.chat({
          messages: [{ role: "system", content: systemPrompt }, userMessage],
          modelType: AIModelType.CHAT,
          taskProfile: { creativity: "medium", outputLength: "long" },
          userId,
        }),
        SelfDrivenMissionRunner.DELIVER_LLM_TIMEOUT_MS,
        `mission ${missionId} finalize pass`,
      );

      const refined = (result.content ?? "").trim();
      if (refined.length < 100) {
        this.logger.warn(
          `[SelfDriven] mission ${missionId} finalize: LLM output too short ` +
            `(${refined.length} chars) — reverting to original`,
        );
        return undefined;
      }

      return refined;
    } catch (err) {
      this.logger.warn(
        `[SelfDriven] mission ${missionId} finalize LLM call failed (non-fatal): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }
}
