/**
 * Iteration Controller - drives the self-improvement cycle
 *
 * This controller orchestrates the loop:
 *   patrol -> evaluate -> identify gaps -> adjust rules -> re-patrol
 *
 * The actual bug-fixing step is performed by Claude Code (human-in-the-loop),
 * not by this script. This script handles:
 * 1. Running patrol
 * 2. Loading evaluation data (human annotations)
 * 3. Computing metrics
 * 4. Checking exit criteria
 * 5. Tracking iteration history
 */

import * as fs from "fs";
import * as path from "path";
import { runPatrol } from "./patrol-runner";
import {
  calculateMetrics,
  meetsExitCriteria,
  saveEvaluation,
  type PatrolAccuracyMetrics,
  type HumanAnnotation,
  type FalseNegative,
} from "./evaluator";
import type { PatrolReport } from "./report-generator";
import { DEFAULT_CONFIG } from "./config";

export interface IterationConfig {
  maxIterations: number;
  exitCriteria: {
    precision: number;
    recall: number;
  };
}

export const DEFAULT_ITERATION_CONFIG: IterationConfig = {
  maxIterations: 5,
  exitCriteria: {
    precision: 0.7,
    recall: 0.5,
  },
};

interface IterationRecord {
  round: number;
  timestamp: string;
  metrics: { precision: number; recall: number; f1: number };
  status: "pending_review" | "adjusted" | "passed";
  reportPath?: string;
  adjustments: string[];
}

interface IterationHistory {
  phase: number;
  iterations: IterationRecord[];
  finalMetrics?: { precision: number; recall: number; f1: number };
  totalRuleAdjustments: number;
  humanReviewRounds: number;
}

const HISTORY_PATH = path.join(
  DEFAULT_CONFIG.evaluationDir,
  "iteration-history.json",
);

/**
 * Load iteration history from disk
 */
export function loadHistory(): IterationHistory {
  const defaultHistory: IterationHistory = {
    phase: 1,
    iterations: [],
    totalRuleAdjustments: 0,
    humanReviewRounds: 0,
  };

  if (fs.existsSync(HISTORY_PATH)) {
    try {
      return JSON.parse(
        fs.readFileSync(HISTORY_PATH, "utf-8"),
      ) as IterationHistory;
    } catch {
      console.warn(`Warning: Could not parse ${HISTORY_PATH}, starting fresh`);
      return defaultHistory;
    }
  }
  return defaultHistory;
}

/**
 * Save iteration history
 */
function saveHistory(history: IterationHistory): void {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

/**
 * Run a single iteration: patrol + save report for human review
 */
export async function runIteration(
  round: number,
): Promise<{ report: PatrolReport; reportPath: string }> {
  console.log(`\n=== Iteration ${round} ===`);

  const report = await runPatrol();

  // Save report
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(
    DEFAULT_CONFIG.reportDir,
    `iter-${round}-${timestamp}.json`,
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Update history
  const history = loadHistory();
  history.iterations.push({
    round,
    timestamp: new Date().toISOString(),
    metrics: { precision: 0, recall: 0, f1: 0 }, // Will be filled after human review
    status: "pending_review",
    reportPath,
    adjustments: [],
  });
  saveHistory(history);

  console.log(`\nReport saved: ${reportPath}`);
  console.log("Awaiting human review. Annotate issues and run evaluation.");

  return { report, reportPath };
}

/**
 * Evaluate an iteration after human annotations are provided
 */
export function evaluateIteration(
  reportPath: string,
  annotations: HumanAnnotation[],
  falseNegatives: FalseNegative[],
  config: IterationConfig = DEFAULT_ITERATION_CONFIG,
): { metrics: PatrolAccuracyMetrics; passed: boolean } {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report file not found: ${reportPath}`);
  }
  let report: PatrolReport;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as PatrolReport;
  } catch (error) {
    throw new Error(
      `Failed to parse report: ${reportPath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const metrics = calculateMetrics(report, annotations, falseNegatives);
  const passed = meetsExitCriteria(metrics, config.exitCriteria);

  // Save evaluation
  const evalPath = saveEvaluation(metrics);
  console.log(`Evaluation saved: ${evalPath}`);

  // Update history
  const history = loadHistory();
  const lastIteration = history.iterations[history.iterations.length - 1];
  if (lastIteration) {
    lastIteration.metrics = {
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
    };
    lastIteration.status = passed ? "passed" : "adjusted";
    history.humanReviewRounds++;
    if (passed) {
      history.finalMetrics = lastIteration.metrics;
    }
  }
  saveHistory(history);

  if (passed) {
    console.log(
      `Exit criteria met. Precision: ${metrics.precision}, Recall: ${metrics.recall}`,
    );
  } else {
    console.log(
      `Not yet meeting criteria. Precision: ${metrics.precision} (need ${config.exitCriteria.precision}), Recall: ${metrics.recall} (need ${config.exitCriteria.recall})`,
    );
  }

  return { metrics, passed };
}
