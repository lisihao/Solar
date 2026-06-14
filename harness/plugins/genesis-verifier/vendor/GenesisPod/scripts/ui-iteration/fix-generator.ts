/**
 * Fix Generator - generates fix suggestions based on issue analysis
 */

import * as fs from "fs";
import * as path from "path";
import type { EnrichedIssue } from "./issue-analyzer";

export interface FixSuggestion {
  issueId: string;
  strategy: string;
  confidence: number;
  description: string;
  targetFile?: string;
  /** Markdown instructions for applying the fix */
  instructions: string;
}

const STRATEGY_DIR = path.resolve(__dirname, "../../.ui-patrol/fix-strategies");

/**
 * Load a fix strategy template
 */
function loadStrategy(strategyName: string): string | undefined {
  const filePath = path.join(STRATEGY_DIR, `${strategyName}.md`);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }
  return undefined;
}

/**
 * Generate fix suggestions for enriched issues
 */
export function generateFixes(issues: EnrichedIssue[]): FixSuggestion[] {
  const suggestions: FixSuggestion[] = [];

  for (const issue of issues) {
    if (!issue.autoFixable || !issue.fixStrategy) {
      continue;
    }

    const template = loadStrategy(issue.fixStrategy);
    const instructions = template
      ? applyTemplate(template, issue)
      : generateDefaultInstructions(issue);

    suggestions.push({
      issueId: issue.id,
      strategy: issue.fixStrategy,
      confidence: issue.fixConfidence,
      description: `Apply ${issue.fixStrategy} strategy to fix: ${issue.title}`,
      targetFile: issue.sourceFile,
      instructions,
    });
  }

  return suggestions;
}

function applyTemplate(template: string, issue: EnrichedIssue): string {
  return template
    .replace(/\{\{issue_id\}\}/g, issue.id)
    .replace(/\{\{url\}\}/g, issue.url)
    .replace(/\{\{category\}\}/g, issue.category)
    .replace(/\{\{description\}\}/g, issue.description)
    .replace(/\{\{source_file\}\}/g, issue.sourceFile || "unknown")
    .replace(/\{\{evidence\}\}/g, issue.evidence);
}

function generateDefaultInstructions(issue: EnrichedIssue): string {
  const file = issue.sourceFile || "the relevant component file";
  switch (issue.fixStrategy) {
    case "null-check":
      return `In ${file}, add optional chaining (?.) or nullish coalescing (??) to prevent undefined/null access. Check the data flow from API response to render.`;
    case "empty-state":
      return `In ${file}, add an empty state check before rendering the list. Use the project's EmptyState component if available.`;
    case "css-overflow":
      return `In ${file}, add overflow-hidden or truncate class to the overflowing element. For tables, use overflow-x-auto.`;
    case "api-path":
      return `Fix the API endpoint URL. Check the backend controller route and ensure the frontend API call matches.`;
    case "loading-state":
      return `In ${file}, add a loading state check. Show a skeleton or spinner while data is being fetched.`;
    default:
      return `Review and fix the issue: ${issue.description}`;
  }
}
