/**
 * RubricGeneratorService — LLM-driven acceptance rubric generation.
 *
 * Belongs in harness/evaluation (not engine/evaluation) because it calls
 * AiChatService; engine/evaluation is permanently LLM-free.
 *
 * Each dimension's passLine is hard-clamped to
 *   [REVIEW_PASS_THRESHOLD=60, RUBRIC_PASS_LINE_CAP=90]
 * preventing an open quality-gate (passLine→0) or an unreachable bar (→99).
 *
 * LLM call pattern mirrors JudgeService: inject AiChatService, use TaskProfile,
 * no hard-coded model name (fallback = ""), no hard-coded temperature.
 */

import { Injectable, Logger } from "@nestjs/common";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { AIModelType } from "@prisma/client";
import type {
  IRubricGenerator,
  RubricDimension,
  RubricGenerationInput,
} from "../abstractions/rubric-generator.interface";
import {
  REVIEW_PASS_THRESHOLD,
  RUBRIC_PASS_LINE_CAP,
} from "../thresholds.constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert evaluator. Given a user's objective and
deliverable type, generate a set of acceptance dimensions that a reviewer should
score to judge whether the deliverable meets the objective.

Rules:
- Return a JSON array of 3-6 dimension objects.
- Each object has keys: "dimension" (string), "weight" (number 0-1), "passLine" (integer 0-100).
- "dimension" is a concise label (e.g. "accuracy", "completeness", "clarity").
- "weight" values must sum to 1.0 across all dimensions.
- "passLine" is the minimum score for that dimension to pass; set it between 60 and 90.
- Output ONLY the JSON array, no prose, no markdown fences.

Example output:
[
  { "dimension": "accuracy", "weight": 0.35, "passLine": 75 },
  { "dimension": "completeness", "weight": 0.30, "passLine": 70 },
  { "dimension": "clarity", "weight": 0.20, "passLine": 65 },
  { "dimension": "actionability", "weight": 0.15, "passLine": 65 }
]`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class RubricGeneratorService implements IRubricGenerator {
  private readonly logger = new Logger(RubricGeneratorService.name);

  constructor(private readonly chat: AiChatService) {}

  /**
   * Generate acceptance rubric dimensions for the given mission input.
   * passLine values are clamped to [REVIEW_PASS_THRESHOLD, RUBRIC_PASS_LINE_CAP].
   */
  async generate(input: RubricGenerationInput): Promise<RubricDimension[]> {
    try {
      const userContent =
        `Objective: ${input.prompt}\n` +
        `Deliverable type: ${input.deliverableType}`;

      const res = await this.chat.chat({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        taskProfile: { creativity: "deterministic", outputLength: "short" },
        responseFormat: "json",
        modelType: AIModelType.EVALUATOR,
        userId: input.userId,
        signal: input.signal,
      });

      if (
        (res as { isError?: boolean }).isError ||
        /^Request blocked by content safety guardrail/i.test(
          res.content ?? "",
        ) ||
        /^Response filtered by content safety guardrail/i.test(
          res.content ?? "",
        )
      ) {
        this.logger.warn(
          "[RubricGenerator] AiChatService returned guardrail/error — falling back to defaults.",
        );
        return this.buildDefaults();
      }

      const parsed = this.parseRubric(res.content);
      if (!parsed) {
        this.logger.warn(
          `[RubricGenerator] LLM output could not be parsed as rubric. head=${res.content.slice(0, 200)}`,
        );
        return this.buildDefaults();
      }

      return parsed;
    } catch (err) {
      this.logger.warn(
        `[RubricGenerator] generate() failed — falling back to defaults: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return this.buildDefaults();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse LLM output into rubric dimensions, clamping passLine.
   * Three-step tolerance: strip fences → direct parse → regex extract first array.
   */
  private parseRubric(raw: string): RubricDimension[] | null {
    let text = raw.trim();

    // Strip ```json ... ``` or ``` ... ``` fences
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) text = fence[1].trim();

    const tryParse = (candidate: string): RubricDimension[] | null => {
      try {
        const arr = JSON.parse(candidate) as unknown;
        if (!Array.isArray(arr) || arr.length === 0) return null;

        const dims: RubricDimension[] = [];
        for (const item of arr) {
          if (
            typeof item !== "object" ||
            item === null ||
            typeof (item as Record<string, unknown>).dimension !== "string" ||
            typeof (item as Record<string, unknown>).weight !== "number" ||
            typeof (item as Record<string, unknown>).passLine !== "number"
          ) {
            continue;
          }
          const raw = item as {
            dimension: string;
            weight: number;
            passLine: number;
          };
          dims.push({
            dimension: raw.dimension.slice(0, 80),
            weight: clamp(raw.weight, 0, 1),
            passLine: clamp(
              Math.round(raw.passLine),
              REVIEW_PASS_THRESHOLD,
              RUBRIC_PASS_LINE_CAP,
            ),
          });
        }
        return dims.length > 0 ? dims : null;
      } catch {
        return null;
      }
    };

    const direct = tryParse(text);
    if (direct) return direct;

    // Fallback: extract first [...] block
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) return tryParse(arrayMatch[0]);

    return null;
  }

  /**
   * Sensible defaults used when LLM fails or output is unparseable.
   * passLine values are already within clamp range.
   */
  private buildDefaults(): RubricDimension[] {
    return [
      {
        dimension: "accuracy",
        weight: 0.35,
        passLine: clamp(75, REVIEW_PASS_THRESHOLD, RUBRIC_PASS_LINE_CAP),
      },
      {
        dimension: "completeness",
        weight: 0.3,
        passLine: clamp(70, REVIEW_PASS_THRESHOLD, RUBRIC_PASS_LINE_CAP),
      },
      {
        dimension: "clarity",
        weight: 0.2,
        passLine: clamp(65, REVIEW_PASS_THRESHOLD, RUBRIC_PASS_LINE_CAP),
      },
      {
        dimension: "actionability",
        weight: 0.15,
        passLine: clamp(65, REVIEW_PASS_THRESHOLD, RUBRIC_PASS_LINE_CAP),
      },
    ];
  }
}
