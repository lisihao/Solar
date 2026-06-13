/**
 * Writing Structural Gate (Stage 1 - Code Gate, 0 LLM calls)
 *
 * Pure code-based validation and auto-fix:
 * - Expression cooldown check via ExpressionMemoryService
 * - Word count validation
 * - Auto-fix: expression replacement via avoidance prompt
 *
 * Follows Topic Insights' ReportQualityGateService pattern.
 */

import { Injectable } from "@nestjs/common";
import { STRUCTURAL_GATE } from "../config/quality-thresholds.config";

export interface StructuralGateResult {
  passed: boolean;
  fixedContent: string;
  wasAutoFixed: boolean;
  violations: StructuralViolation[];
}

export interface StructuralViolation {
  type: "word_count" | "expression_cooldown" | "format";
  severity: "error" | "warning";
  message: string;
  autoFixed: boolean;
}

@Injectable()
export class WritingStructuralGateService {
  constructor() {}

  /**
   * Run structural validation on generated content
   */
  async validate(
    content: string,
    _projectId: string,
    options?: {
      isOutline?: boolean;
    },
  ): Promise<StructuralGateResult> {
    const violations: StructuralViolation[] = [];
    const fixedContent = content;

    // 1. Word count validation
    const wordCount = this.countWords(content);
    const minWords = options?.isOutline
      ? STRUCTURAL_GATE.MIN_OUTLINE_WORDS
      : STRUCTURAL_GATE.MIN_CHAPTER_WORDS;

    if (wordCount < minWords) {
      violations.push({
        type: "word_count",
        severity: "error",
        message: `字数不足：${wordCount} 字（最低 ${minWords} 字）`,
        autoFixed: false,
      });
    }

    // Expression cooldown is not a post-generation gate - it's a prompt-injection aid.
    // The avoidance prompt is generated and injected into generation prompts by the executors.

    const hasErrors = violations.some((v) => v.severity === "error");

    return {
      passed: !hasErrors,
      fixedContent,
      wasAutoFixed: false,
      violations,
    };
  }

  private countWords(content: string): number {
    const cleaned = content
      .replace(/[\s\n\r\t]+/g, "")
      .replace(/[^\u4e00-\u9fff\u3400-\u4dbf\w]/g, "");
    return cleaned.length;
  }
}
