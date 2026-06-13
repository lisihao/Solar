/**
 * StepDecompositionService — role-agnostic step decomposition primitive
 *
 * engine/planning placement (ADR-009): no agent/mission state. The service
 * knows nothing about roles, rubrics, or model election — those belong to
 * the harness caller.
 *
 * LLM call pattern follows judge.service.ts (same layer):
 *   - injected AiChatService, TaskProfile, AIModelType
 *   - fallback model = "" (resolved by AiChatService via TaskProfile)
 *   - no hardcoded model names or temperatures
 */

import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { AiChatService } from "../../llm/chat/ai-chat.service";
import type {
  IStepDecompositionService,
  RawExecutionStep,
  StepDecompositionInput,
  StepDecompositionResult,
} from "./abstractions/step-decomposition.interface";

const MAX_STEPS_DEFAULT = 8;

/**
 * System prompt is intentionally static (no timestamps / random ids) so that
 * prompt-cache prefix stays stable across calls (Claude Code reverse-insight #3/#7).
 * Dynamic content (goal, context, maxSteps) goes into the user-role message only.
 */
const SYSTEM_PROMPT = `You are a role-agnostic planning assistant.
Given a goal, produce a minimal ordered list of execution steps.
Each step must be completable independently or after its declared dependencies.

For each step return:
  - name:               short action-oriented title
  - description:        what the step must produce or accomplish
  - type:               one of [task, review, integration, delivery]
  - loopKind:           one of [react, plan-act, leader-worker]
  - dependencyIndices:  array of 0-based indices of steps this one depends on
  - estimatedDurationMs: estimated wall-clock duration in milliseconds

Rules:
  - Do NOT assign roles, models, or agents — the caller handles that.
  - Include at most one "delivery" step (final output assembly).
  - Include at most one "integration" step (merging parallel outputs).
  - "review" steps should validate the most recent "task" or "integration" step.
  - Minimise steps; prefer depth over breadth.
  - loopKind guidance:
      react         → open-ended search / tool-using exploration
      plan-act      → structured multi-step reasoning without live tools
      leader-worker → parallelize subtasks across multiple workers

Output ONLY a JSON array, no markdown fences, no prose:
[
  {
    "name": "...",
    "description": "...",
    "type": "task|review|integration|delivery",
    "loopKind": "react|plan-act|leader-worker",
    "dependencyIndices": [],
    "estimatedDurationMs": 60000
  }
]`;

@Injectable()
export class StepDecompositionService implements IStepDecompositionService {
  private readonly logger = new Logger(StepDecompositionService.name);

  constructor(private readonly chat: AiChatService) {}

  async decompose(
    input: StepDecompositionInput,
  ): Promise<StepDecompositionResult> {
    const maxSteps = input.maxSteps ?? MAX_STEPS_DEFAULT;

    const userMessage = buildUserMessage(input.goal, input.context, maxSteps);

    try {
      const res = await this.chat.chat({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        taskProfile: { creativity: "low", outputLength: "medium" },
        responseFormat: "json",
        modelType: AIModelType.CHAT,
      });

      const steps = this.parseSteps(res.content, maxSteps);
      this.logger.log(
        `[StepDecomposition] decomposed "${input.goal.slice(0, 60)}..." → ${steps.length} steps`,
      );
      return { steps };
    } catch (err) {
      this.logger.error(
        `[StepDecomposition] LLM call failed, using single-step fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { steps: buildFallback(input.goal) };
    }
  }

  /**
   * Parse raw LLM output into typed RawExecutionStep[].
   * Three-pass approach matching judge.service.ts parseVerdict robustness:
   *   1. strip optional ```json fence
   *   2. direct JSON.parse
   *   3. regex-extract first [...] array block
   */
  private parseSteps(raw: string, maxSteps: number): RawExecutionStep[] {
    let text = raw.trim();

    // Strip optional ```json ... ``` fence
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) text = fence[1].trim();

    const tryParse = (candidate: string): RawRawStep[] | null => {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed as RawRawStep[];
      } catch {
        /* fall through */
      }
      return null;
    };

    let raw2 = tryParse(text);
    if (!raw2) {
      const arrMatch = text.match(/\[[\s\S]*\]/);
      if (arrMatch) raw2 = tryParse(arrMatch[0]);
    }

    if (!raw2 || raw2.length === 0) {
      this.logger.warn(
        `[StepDecomposition] parseSteps: empty or unparseable LLM response, ` +
          `using fallback. raw head (200 chars): ${JSON.stringify(text.slice(0, 200))}`,
      );
      return [];
    }

    const limited = raw2.slice(0, maxSteps);
    return limited.map((r, i) => normaliseStep(r, i));
  }
}

// ---------- internal helpers ----------

/** Shape produced by the LLM before normalisation. */
interface RawRawStep {
  name?: unknown;
  description?: unknown;
  type?: unknown;
  loopKind?: unknown;
  dependencyIndices?: unknown;
  estimatedDurationMs?: unknown;
}

const VALID_TYPES = new Set<string>([
  "task",
  "review",
  "integration",
  "delivery",
]);
const VALID_LOOP_KINDS = new Set<string>([
  "react",
  "plan-act",
  "leader-worker",
]);

function normaliseStep(r: RawRawStep, index: number): RawExecutionStep {
  const type =
    typeof r.type === "string" && VALID_TYPES.has(r.type)
      ? (r.type as RawExecutionStep["type"])
      : "task";

  const loopKind =
    typeof r.loopKind === "string" && VALID_LOOP_KINDS.has(r.loopKind)
      ? (r.loopKind as RawExecutionStep["loopKind"])
      : "react";

  const depIndices = Array.isArray(r.dependencyIndices)
    ? (r.dependencyIndices as unknown[])
        .filter((d) => typeof d === "number" && d >= 0 && d < index)
        .map(Number)
    : [];

  const durationMs =
    typeof r.estimatedDurationMs === "number" && r.estimatedDurationMs > 0
      ? r.estimatedDurationMs
      : 60_000;

  return {
    id: String(index),
    name: typeof r.name === "string" ? r.name.slice(0, 200) : `Step ${index}`,
    description:
      typeof r.description === "string"
        ? r.description.slice(0, 1000)
        : `Step ${index} execution`,
    type,
    loopKind,
    dependencyIndices: depIndices,
    estimatedDurationMs: durationMs,
  };
}

function buildUserMessage(
  goal: string,
  context: Record<string, unknown> | undefined,
  maxSteps: number,
): string {
  const parts: string[] = [`Goal: ${goal}`, `Max steps: ${maxSteps}`];
  if (context && Object.keys(context).length > 0) {
    parts.push(`Context: ${JSON.stringify(context)}`);
  }
  return parts.join("\n");
}

function buildFallback(goal: string): RawExecutionStep[] {
  return [
    {
      id: "0",
      name: "Execute",
      description: goal,
      type: "task",
      loopKind: "react",
      dependencyIndices: [],
      estimatedDurationMs: 60_000,
    },
  ];
}
