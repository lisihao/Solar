/**
 * Writing Critique-Refine Service (Stage 3 - Iterative Improvement)
 *
 * When Stage 2 fails, iteratively improve content:
 * 1. Identify narrative issues via NarrativeCraftService
 * 2. Auto-fix endings/cliches via rewriteEnding
 * 3. Re-evaluate and loop or accept best version
 *
 * Follows Topic Insights' CritiqueRefineService pattern.
 */

import { Injectable, Logger } from "@nestjs/common";
import { NarrativeCraftService } from "./narrative-craft.service";
import { CRITIQUE_REFINE } from "../config/quality-thresholds.config";
import type { QualityVerdict } from "./writing-content-gate.service";

export interface CritiqueRefineResult {
  content: string;
  iterations: number;
  improved: boolean;
  finalScore: number;
  stopReason:
    | "target_reached"
    | "no_improvement"
    | "max_iterations"
    | "score_converged";
}

@Injectable()
export class WritingCritiqueRefineService {
  private readonly logger = new Logger(WritingCritiqueRefineService.name);

  constructor(private readonly narrativeCraft: NarrativeCraftService) {}

  /**
   * Iteratively improve content that failed quality gate
   */
  async refine(
    content: string,
    verdict: QualityVerdict,
    _modelId: string,
  ): Promise<CritiqueRefineResult> {
    // Skip if already good enough
    if (verdict.overallScore >= CRITIQUE_REFINE.SKIP_THRESHOLD) {
      return {
        content,
        iterations: 0,
        improved: false,
        finalScore: verdict.overallScore,
        stopReason: "target_reached",
      };
    }

    let currentContent = content;
    let currentScore = verdict.overallScore;
    let bestContent = content;
    let bestScore = currentScore;

    for (let i = 0; i < CRITIQUE_REFINE.MAX_ITERATIONS; i++) {
      this.logger.log(
        `[Iteration ${i + 1}] Current score: ${currentScore}, attempting refinement`,
      );

      // Refine using narrative craft (code-based rewrite)
      const narrativeReport =
        this.narrativeCraft.analyzeContent(currentContent);
      if (!narrativeReport.passed) {
        const hasEndingOrCliche = narrativeReport.issues.some(
          (issue) =>
            issue.type === "ending" ||
            issue.category === "ai_writing_cliche" ||
            issue.category === "excessive_psychology",
        );

        if (hasEndingOrCliche) {
          const refined = await this.narrativeCraft.rewriteEnding(
            currentContent,
            narrativeReport.issues,
          );
          if (refined !== currentContent) {
            currentContent = refined;
            this.logger.log(`[Iteration ${i + 1}] Narrative issues fixed`);
          }
        }
      }

      // Re-evaluate
      const newReport = this.narrativeCraft.analyzeContent(currentContent);
      const newScore = newReport.score;

      if (newScore > bestScore) {
        bestContent = currentContent;
        bestScore = newScore;
      }

      const improvement = newScore - currentScore;
      if (improvement < CRITIQUE_REFINE.MIN_IMPROVEMENT) {
        return {
          content: bestContent,
          iterations: i + 1,
          improved: bestScore > verdict.overallScore,
          finalScore: bestScore,
          stopReason:
            improvement < CRITIQUE_REFINE.CONVERGENCE_WINDOW
              ? "score_converged"
              : "no_improvement",
        };
      }

      currentScore = newScore;

      if (currentScore >= CRITIQUE_REFINE.SKIP_THRESHOLD) {
        return {
          content: currentContent,
          iterations: i + 1,
          improved: true,
          finalScore: currentScore,
          stopReason: "target_reached",
        };
      }
    }

    return {
      content: bestContent,
      iterations: CRITIQUE_REFINE.MAX_ITERATIONS,
      improved: bestScore > verdict.overallScore,
      finalScore: bestScore,
      stopReason: "max_iterations",
    };
  }
}
