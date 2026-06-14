/**
 * Evaluator - calculates patrol accuracy metrics
 */

import * as fs from "fs";
import * as path from "path";
import type { PatrolReport, PatrolIssue } from "./report-generator";
import { DEFAULT_CONFIG } from "./config";

export type HumanVerdict = "true_positive" | "false_positive" | "not_reviewed";

export interface HumanAnnotation {
  issueId: string;
  verdict: HumanVerdict;
  notes?: string;
}

export interface FalseNegative {
  description: string;
  url: string;
  category: string;
  severity: string;
}

export interface PatrolAccuracyMetrics {
  timestamp: string;
  totalPages: number;
  totalIssuesFound: number;
  humanReview: {
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    notReviewed: number;
  };
  precision: number;
  recall: number;
  f1: number;
  byCategory: Record<
    string,
    { precision: number; recall: number; tp: number; fp: number; fn: number }
  >;
  notes?: string;
}

/**
 * Calculate accuracy metrics from human annotations
 */
export function calculateMetrics(
  report: PatrolReport,
  annotations: HumanAnnotation[],
  falseNegatives: FalseNegative[],
): PatrolAccuracyMetrics {
  const annotationMap = new Map(annotations.map((a) => [a.issueId, a]));

  let tp = 0;
  let fp = 0;
  let notReviewed = 0;

  // Per-category tracking
  const categoryStats: Record<string, { tp: number; fp: number; fn: number }> =
    {};

  for (const issue of report.issues) {
    const annotation = annotationMap.get(issue.id);
    const cat = issue.category;

    if (!categoryStats[cat]) {
      categoryStats[cat] = { tp: 0, fp: 0, fn: 0 };
    }

    if (!annotation || annotation.verdict === "not_reviewed") {
      notReviewed++;
    } else if (annotation.verdict === "true_positive") {
      tp++;
      categoryStats[cat].tp++;
    } else {
      fp++;
      categoryStats[cat].fp++;
    }
  }

  // Add false negatives per category
  for (const fn of falseNegatives) {
    if (!categoryStats[fn.category]) {
      categoryStats[fn.category] = { tp: 0, fp: 0, fn: 0 };
    }
    categoryStats[fn.category].fn++;
  }

  const fnCount = falseNegatives.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fnCount > 0 ? tp / (tp + fnCount) : 0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

  // Calculate per-category metrics
  const byCategory: PatrolAccuracyMetrics["byCategory"] = {};
  for (const [cat, stats] of Object.entries(categoryStats)) {
    const catPrecision =
      stats.tp + stats.fp > 0 ? stats.tp / (stats.tp + stats.fp) : 0;
    const catRecall =
      stats.tp + stats.fn > 0 ? stats.tp / (stats.tp + stats.fn) : 0;
    byCategory[cat] = {
      precision: Math.round(catPrecision * 1000) / 1000,
      recall: Math.round(catRecall * 1000) / 1000,
      tp: stats.tp,
      fp: stats.fp,
      fn: stats.fn,
    };
  }

  return {
    timestamp: new Date().toISOString(),
    totalPages: report.summary.totalPages,
    totalIssuesFound: report.summary.totalIssues,
    humanReview: {
      truePositive: tp,
      falsePositive: fp,
      falseNegative: fnCount,
      notReviewed,
    },
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    byCategory,
  };
}

/**
 * Check if metrics meet exit criteria
 */
export function meetsExitCriteria(
  metrics: PatrolAccuracyMetrics,
  criteria: { precision: number; recall: number } = {
    precision: 0.7,
    recall: 0.5,
  },
): boolean {
  return (
    metrics.precision >= criteria.precision && metrics.recall >= criteria.recall
  );
}

/**
 * Save evaluation results to disk
 */
export function saveEvaluation(
  metrics: PatrolAccuracyMetrics,
  outputDir: string = DEFAULT_CONFIG.evaluationDir,
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(outputDir, `patrol-accuracy-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(metrics, null, 2));
  return filePath;
}
