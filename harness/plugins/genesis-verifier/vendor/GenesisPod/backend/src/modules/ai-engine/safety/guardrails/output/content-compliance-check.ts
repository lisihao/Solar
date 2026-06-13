/**
 * AI Engine - Content Compliance Check
 * 内容合规检查
 */

import { Injectable } from "@nestjs/common";
import {
  IOutputGuardrail,
  GuardrailOutput,
  GuardrailResult,
} from "../guardrails.interface";

/**
 * Detection pattern
 */
interface DetectionPattern {
  pattern: RegExp;
  name: string;
  severity: "warning" | "error";
}

/**
 * Content Compliance Check
 * Detects hallucination indicators and refusal patterns in output
 */
@Injectable()
export class ContentComplianceCheck implements IOutputGuardrail {
  readonly id = "content-compliance-check";
  readonly name = "Content Compliance Check";
  readonly enabled = true;

  private readonly hallucinationPatterns: DetectionPattern[] = [
    // Knowledge cutoff mentions
    {
      pattern: /as of my (knowledge cutoff|last update|training data)/gi,
      name: "Knowledge Cutoff Reference",
      severity: "warning",
    },
    {
      pattern:
        /my (knowledge|training) (was|is) (cut off|limited to|updated)/gi,
      name: "Training Limitation",
      severity: "warning",
    },
    // Access limitations
    {
      pattern: /I (don't|do not|can't|cannot) have access to/gi,
      name: "Access Limitation",
      severity: "warning",
    },
    {
      pattern:
        /I (don't|do not|can't|cannot) have (real-time|current|live) (access|information|data)/gi,
      name: "Real-time Access Limitation",
      severity: "warning",
    },
    // Uncertainty markers
    {
      pattern: /I (think|believe|assume) (this|that|it) (might|may|could) be/gi,
      name: "High Uncertainty",
      severity: "warning",
    },
  ];

  private readonly refusalPatterns: DetectionPattern[] = [
    // Direct refusals
    {
      pattern:
        /I (can't|cannot|am not able to|refuse to) (help|assist|do|provide)/gi,
      name: "Direct Refusal",
      severity: "error",
    },
    {
      pattern: /(sorry|apologize),? (but )?I (can't|cannot|won't)/gi,
      name: "Apologetic Refusal",
      severity: "error",
    },
    // Policy violations
    {
      pattern:
        /(against|violates?) (my|the) (policy|policies|guidelines|rules)/gi,
      name: "Policy Violation",
      severity: "error",
    },
    {
      pattern: /not (allowed|permitted) to/gi,
      name: "Permission Denial",
      severity: "error",
    },
  ];

  /**
   * Check output for compliance issues
   */
  async check(output: GuardrailOutput): Promise<GuardrailResult> {
    const hallucinationDetections: string[] = [];
    const refusalDetections: string[] = [];

    // Check for hallucination indicators
    for (const { pattern, name } of this.hallucinationPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(output.content)) {
        hallucinationDetections.push(name);
      }
    }

    // Check for refusal patterns
    for (const { pattern, name } of this.refusalPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(output.content)) {
        refusalDetections.push(name);
      }
    }

    // No issues detected
    if (
      hallucinationDetections.length === 0 &&
      refusalDetections.length === 0
    ) {
      return {
        passed: true,
        guardrailId: this.id,
        severity: "info",
        message: "No compliance issues detected",
      };
    }

    // Refusal detected - error severity
    if (refusalDetections.length > 0) {
      return {
        passed: false,
        guardrailId: this.id,
        severity: "error",
        message: `Output contains refusal patterns: ${refusalDetections.join(", ")}`,
        metadata: {
          refusals: refusalDetections,
          hallucinations: hallucinationDetections,
        },
      };
    }

    // Only hallucination indicators - warning severity
    return {
      passed: true,
      guardrailId: this.id,
      severity: "warning",
      message: `Output contains hallucination indicators: ${hallucinationDetections.join(", ")}`,
      metadata: {
        hallucinations: hallucinationDetections,
      },
    };
  }
}
