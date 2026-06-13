/**
 * AI Engine - Prompt Injection Detector
 * 提示词注入检测器
 */

import { Injectable } from "@nestjs/common";
import {
  IInputGuardrail,
  GuardrailInput,
  GuardrailResult,
} from "../guardrails.interface";

/**
 * Detection pattern
 */
interface DetectionPattern {
  pattern: RegExp;
  name: string;
  severity: "warning" | "block";
}

/**
 * Prompt Injection Detector
 * Detects common prompt injection patterns
 */
@Injectable()
export class PromptInjectionDetector implements IInputGuardrail {
  readonly id = "prompt-injection-detector";
  readonly name = "Prompt Injection Detector";
  readonly enabled = true;

  private readonly patterns: DetectionPattern[] = [
    // Ignore/disregard instructions
    {
      pattern:
        /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?|commands?)/gi,
      name: "Ignore Instructions",
      severity: "block",
    },
    {
      pattern:
        /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi,
      name: "Disregard Instructions",
      severity: "block",
    },
    // Override/bypass system
    {
      pattern: /override\s+(system|safety|security|restrictions?)/gi,
      name: "Override System",
      severity: "block",
    },
    {
      pattern: /bypass\s+(filter|safety|security|restrictions?)/gi,
      name: "Bypass Safety",
      severity: "block",
    },
    // Jailbreak attempts — "DAN" only in explicit jailbreak context
    // Bare "DAN" removed: too many false positives on common English name "Dan"
    // Covered patterns: act as DAN, you are (now) DAN, I am DAN, become DAN,
    // pretend to be DAN, enable/activate/enter/switch to DAN, DAN mode, jailbreak
    {
      pattern:
        /\bjailbreak\b|(?:act\s+as|you\s+are(?:\s+now)?|I\s+am|become|pretend\s+to\s+be|enable|activate|enter|switch\s+to)\s+DAN\b|\bDAN\s+mode\b/gi,
      name: "Jailbreak Attempt",
      severity: "block",
    },
    // Role manipulation
    {
      pattern: /you\s+are\s+now\s+(a|an)\s+/gi,
      name: "Role Manipulation",
      severity: "warning",
    },
    {
      pattern: /act\s+as\s+(if|though)\s+you/gi,
      name: "Acting Instructions",
      severity: "warning",
    },
    // System prompt extraction
    {
      pattern:
        /(show|reveal|display|print|output)\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions?)/gi,
      name: "System Prompt Extraction",
      severity: "block",
    },
    // Delimiter injection
    {
      pattern: /```\s*(system|assistant|user)\s*:/gi,
      name: "Delimiter Injection",
      severity: "warning",
    },
  ];

  /**
   * Check input for prompt injection patterns
   */
  async check(input: GuardrailInput): Promise<GuardrailResult> {
    const detections: Array<{
      pattern: string;
      severity: "warning" | "block";
    }> = [];

    for (const { pattern, name, severity } of this.patterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;

      if (pattern.test(input.content)) {
        detections.push({ pattern: name, severity });
      }
    }

    // No detections
    if (detections.length === 0) {
      return {
        passed: true,
        guardrailId: this.id,
        severity: "info",
        message: "No prompt injection patterns detected",
      };
    }

    // Check for blocking patterns
    const blockingDetections = detections.filter((d) => d.severity === "block");
    if (blockingDetections.length > 0) {
      return {
        passed: false,
        guardrailId: this.id,
        severity: "block",
        message: `Potential prompt injection detected: ${blockingDetections.map((d) => d.pattern).join(", ")}`,
        metadata: {
          detections: blockingDetections.map((d) => d.pattern),
          totalDetections: detections.length,
        },
      };
    }

    // Only warnings
    return {
      passed: true,
      guardrailId: this.id,
      severity: "warning",
      message: `Suspicious patterns detected: ${detections.map((d) => d.pattern).join(", ")}`,
      metadata: {
        detections: detections.map((d) => d.pattern),
        totalDetections: detections.length,
      },
    };
  }
}
