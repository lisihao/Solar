/**
 * Issue Analyzer - enriches issues with code location and fix suggestions
 */

import * as fs from "fs";
import * as path from "path";
import type { PatrolIssue } from "./report-generator";

export interface EnrichedIssue extends PatrolIssue {
  /** Resolved source file path */
  sourceFile?: string;
  /** Line number in source file */
  sourceLine?: number;
  /** Fix confidence score 0-100 */
  fixConfidence: number;
  /** Whether this issue can be auto-fixed */
  autoFixable: boolean;
  /** Suggested fix strategy */
  fixStrategy?: string;
}

/**
 * Confidence scoring based on available evidence
 */
function calculateConfidence(issue: PatrolIssue): number {
  let confidence = 0;

  // Stack trace or code hint available
  if (issue.codeHint) confidence += 25;

  // Issue type is pattern-based (high confidence for known patterns)
  const patternIssues = ["CONSOLE_ERROR", "NETWORK_ERROR", "BLANK_PAGE"];
  if (patternIssues.includes(issue.category)) confidence += 20;

  // Evidence is concrete (not vague)
  if (issue.evidence && issue.evidence.length > 20) confidence += 15;

  // DOM snapshot available (implies diagnostics succeeded)
  if (issue.description && issue.description.length > 50) confidence += 15;

  // Severity-based boost (critical issues more actionable)
  if (issue.severity === "critical") confidence += 10;
  if (issue.severity === "major") confidence += 5;

  return Math.min(confidence, 100);
}

/**
 * Map a URL route to likely source file
 */
function resolveSourceFile(url: string): string | undefined {
  // Extract route from URL
  const urlObj = new URL(url, "http://localhost");
  let route = urlObj.pathname;

  // Remove dynamic IDs
  route = route.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    "/[id]",
  );

  // Map to file path
  const pagePath = path.join("frontend/app", route, "page.tsx");
  if (fs.existsSync(pagePath)) {
    return pagePath;
  }

  // Try without trailing segment as dynamic
  const parts = route.split("/").filter(Boolean);
  if (parts.length > 1) {
    const parentRoute = "/" + parts.slice(0, -1).join("/") + "/[id]";
    const parentPath = path.join("frontend/app", parentRoute, "page.tsx");
    if (fs.existsSync(parentPath)) {
      return parentPath;
    }
  }

  return undefined;
}

/**
 * Determine fix strategy based on issue category
 */
function suggestFixStrategy(issue: PatrolIssue): string | undefined {
  const strategies: Record<string, string> = {
    BLANK_PAGE: "null-check",
    CONSOLE_ERROR: "null-check",
    NETWORK_ERROR: "api-path",
    OVERFLOW: "css-overflow",
    FORBIDDEN_PATTERN: "null-check",
    A11Y: "empty-state",
    PERFORMANCE: "loading-state",
  };
  return strategies[issue.category];
}

/**
 * Enrich patrol issues with code location and fix suggestions
 */
export function analyzeIssues(issues: PatrolIssue[]): EnrichedIssue[] {
  return issues.map((issue) => {
    const confidence = calculateConfidence(issue);
    const sourceFile = resolveSourceFile(issue.url);
    const fixStrategy = suggestFixStrategy(issue);

    return {
      ...issue,
      sourceFile,
      fixConfidence: confidence,
      autoFixable: confidence >= 70,
      fixStrategy,
    };
  });
}
