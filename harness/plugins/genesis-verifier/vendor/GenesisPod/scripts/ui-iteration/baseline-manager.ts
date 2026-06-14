/**
 * Baseline Manager - manages screenshot baselines for regression detection
 */

import * as fs from "fs";
import * as path from "path";
import {
  compareWithBaseline,
  updateBaselines,
  type DiffResult,
} from "./visual-diff";
import { DEFAULT_CONFIG } from "./config";

const BASELINE_DIR = ".ui-patrol/baselines";

export interface BaselineReport {
  timestamp: string;
  totalComparisons: number;
  identical: number;
  minor: number;
  major: number;
  missing: number;
  results: DiffResult[];
}

/**
 * Compare all current screenshots against baselines
 */
export function compareAllBaselines(
  screenshotDir: string = DEFAULT_CONFIG.screenshotDir,
): BaselineReport {
  const results: DiffResult[] = [];
  let missing = 0;

  if (!fs.existsSync(screenshotDir)) {
    console.warn(`Screenshot directory not found: ${screenshotDir}`);
    return {
      timestamp: new Date().toISOString(),
      totalComparisons: 0,
      identical: 0,
      minor: 0,
      major: 0,
      missing: 0,
      results: [],
    };
  }

  const files = fs.readdirSync(screenshotDir).filter((f) => f.endsWith(".png"));

  for (const file of files) {
    // Parse route and viewport from filename: route_name_viewport.png
    const parts = file.replace(".png", "").split("_");
    const viewport = parts.pop() || "desktop";
    const route = "/" + parts.join("/");

    const screenshotPath = path.join(screenshotDir, file);
    const result = compareWithBaseline(screenshotPath, route, viewport);

    if (result) {
      results.push(result);
    } else {
      missing++;
    }
  }

  const report: BaselineReport = {
    timestamp: new Date().toISOString(),
    totalComparisons: results.length,
    identical: results.filter((r) => r.classification === "identical").length,
    minor: results.filter((r) => r.classification === "minor").length,
    major: results.filter((r) => r.classification === "major").length,
    missing,
    results,
  };

  console.log(
    `Baseline comparison: ${report.identical} identical, ${report.minor} minor, ${report.major} major, ${report.missing} missing baselines`,
  );

  return report;
}

/**
 * Save current screenshots as new baselines
 */
export function saveBaselines(
  screenshotDir: string = DEFAULT_CONFIG.screenshotDir,
): number {
  return updateBaselines(screenshotDir);
}

/**
 * Check if baseline comparison passes (no major diffs)
 */
export function baselineCheckPasses(
  report: BaselineReport,
  failOnMajor: boolean = true,
): boolean {
  if (failOnMajor && report.major > 0) {
    console.error(
      `Baseline check FAILED: ${report.major} major visual differences detected`,
    );
    return false;
  }
  return true;
}
