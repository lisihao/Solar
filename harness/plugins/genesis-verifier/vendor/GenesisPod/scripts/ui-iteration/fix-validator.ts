/**
 * Fix Validator - validates that a fix was applied correctly
 */

import { execSync } from "child_process";
import type { FixSuggestion } from "./fix-generator";

export interface ValidationResult {
  issueId: string;
  typeCheckPassed: boolean;
  lintPassed: boolean;
  forbiddenPatternsFree: boolean;
  errors: string[];
}

/**
 * Run validation chain on a fixed file
 */
export function validateFix(
  fix: FixSuggestion,
  projectRoot: string,
): ValidationResult {
  const errors: string[] = [];
  let typeCheckPassed = false;
  let lintPassed = false;
  let forbiddenPatternsFree = true;

  // Type check
  try {
    execSync("npm run type-check:frontend", {
      cwd: projectRoot,
      stdio: "pipe",
      timeout: 60000,
    });
    typeCheckPassed = true;
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error
        ? (error as { stderr: Buffer }).stderr?.toString() || ""
        : "";
    errors.push(`Type check failed: ${stderr.substring(0, 500)}`);
  }

  // Lint check
  try {
    execSync("npm run lint:frontend", {
      cwd: projectRoot,
      stdio: "pipe",
      timeout: 60000,
    });
    lintPassed = true;
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error
        ? (error as { stderr: Buffer }).stderr?.toString() || ""
        : "";
    errors.push(`Lint failed: ${stderr.substring(0, 500)}`);
  }

  // Forbidden patterns check
  if (fix.targetFile) {
    try {
      const { readFileSync } = require("fs");
      const content = readFileSync(fix.targetFile, "utf-8");
      const forbidden = [
        { pattern: /@ts-ignore/, name: "@ts-ignore" },
        { pattern: /: any\b/, name: "any type" },
        { pattern: /console\.log\(/, name: "console.log" },
      ];
      for (const { pattern, name } of forbidden) {
        if (pattern.test(content)) {
          forbiddenPatternsFree = false;
          errors.push(`Forbidden pattern found: ${name}`);
        }
      }
    } catch {
      // File read failure is non-fatal for validation
    }
  }

  return {
    issueId: fix.issueId,
    typeCheckPassed,
    lintPassed,
    forbiddenPatternsFree,
    errors,
  };
}

/**
 * Check if validation passed all gates
 */
export function isValidationPassed(result: ValidationResult): boolean {
  return (
    result.typeCheckPassed && result.lintPassed && result.forbiddenPatternsFree
  );
}
