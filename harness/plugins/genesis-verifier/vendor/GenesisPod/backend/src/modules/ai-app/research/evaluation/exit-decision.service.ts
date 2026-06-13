import { Injectable } from "@nestjs/common";
import {
  MAX_ITERATIONS,
  QUALITY_THRESHOLD,
  EXIT_DECISION_CONFIG,
} from "../config/research.config";

export interface ExitDecision {
  exit: boolean;
  reason?:
    | "budget_exhausted"
    | "quality_met"
    | "information_saturated"
    | "converged"
    | "no_gaps"
    | "round_error";
  nextResearchFocus?: string[];
}

export interface ExitContext {
  iteration: number;
  depth: "quick" | "standard" | "thorough";
  /** Scores from each completed iteration, in order */
  scores: number[];
  /** New unique sources / total sources searched this round */
  informationGain: number;
  gaps: {
    dataGaps: string[];
    ideaGaps: string[];
  };
}

const {
  SATURATION_GAIN_THRESHOLD,
  CONVERGENCE_DELTA_THRESHOLD,
  MIN_ITERATIONS_FOR_EARLY_EXIT,
} = EXIT_DECISION_CONFIG;

@Injectable()
export class ExitDecisionService {
  decide(context: ExitContext): ExitDecision {
    const { iteration, depth, gaps } = context;
    // Sanitize scores: filter out NaN/Infinity
    const scores = context.scores.filter((s) => isFinite(s));
    const informationGain = isFinite(context.informationGain)
      ? context.informationGain
      : 0;
    const latestScore = scores.length > 0 ? scores[scores.length - 1] : 0;

    // 1. Budget exhausted: iteration count hit the depth maximum
    if (iteration >= MAX_ITERATIONS[depth]) {
      return { exit: true, reason: "budget_exhausted" };
    }

    // Guard: always run at least one real iteration (round 1) before allowing
    // quality/gap/saturation/convergence exits. Round 0 is just the initial
    // analysis — exiting before any follow-up research defeats the purpose.
    if (iteration <= 1) {
      return {
        exit: false,
        nextResearchFocus: [...new Set([...gaps.dataGaps, ...gaps.ideaGaps])],
      };
    }

    // 2. Quality met: latest score is at or above the depth threshold
    if (latestScore >= QUALITY_THRESHOLD[depth]) {
      return { exit: true, reason: "quality_met" };
    }

    // 3. No gaps remaining: both gap lists are empty
    //    But only exit if quality is reasonable — 0 gaps with low score means
    //    evaluation failed, not that research is complete.
    const hasNoGaps = gaps.dataGaps.length === 0 && gaps.ideaGaps.length === 0;
    if (hasNoGaps && latestScore >= 0.3) {
      return { exit: true, reason: "no_gaps" };
    }

    // 4. Information saturated: this round added very few new unique sources
    //    P1-1 fix: Only trigger after MIN_ITERATIONS_FOR_EARLY_EXIT completed iterations
    //    to prevent premature exit when Round 0 finds many sources and Round 1 adds few.
    // Only exit for saturation if quality is at least 50% of the depth target.
    // Otherwise, low information gain just means we need better queries, not that we should stop.
    const qualityFloor = QUALITY_THRESHOLD[depth] * 0.5;
    if (
      iteration >= MIN_ITERATIONS_FOR_EARLY_EXIT &&
      informationGain < SATURATION_GAIN_THRESHOLD &&
      latestScore >= qualityFloor
    ) {
      return { exit: true, reason: "information_saturated" };
    }

    // 5. Converged: last 2 score deltas are both below the convergence threshold
    //    Also require a minimum score to prevent early convergence at low quality
    //    P1-1 fix: Also require MIN_ITERATIONS_FOR_EARLY_EXIT
    if (
      scores.length >= 3 &&
      latestScore >= qualityFloor &&
      iteration >= MIN_ITERATIONS_FOR_EARLY_EXIT
    ) {
      const delta1 = Math.abs(
        scores[scores.length - 1] - scores[scores.length - 2],
      );
      const delta2 = Math.abs(
        scores[scores.length - 2] - scores[scores.length - 3],
      );
      if (
        delta1 < CONVERGENCE_DELTA_THRESHOLD &&
        delta2 < CONVERGENCE_DELTA_THRESHOLD
      ) {
        return { exit: true, reason: "converged" };
      }
    }

    // Continue: provide next research focus from remaining gaps (deduplicated)
    const nextResearchFocus = [
      ...new Set([...gaps.dataGaps, ...gaps.ideaGaps]),
    ];

    return { exit: false, nextResearchFocus };
  }
}
