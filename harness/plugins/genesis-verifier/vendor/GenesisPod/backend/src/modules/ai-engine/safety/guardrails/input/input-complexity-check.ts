/**
 * AI Engine - Input Complexity Check
 * 输入复杂度检查
 */

import { Injectable } from "@nestjs/common";
import {
  IInputGuardrail,
  GuardrailInput,
  GuardrailResult,
} from "../guardrails.interface";

/**
 * Complexity thresholds
 */
interface ComplexityThresholds {
  maxLength: number;
  maxTokenEstimate: number;
  warnLength: number;
  warnTokenEstimate: number;
}

/**
 * Input Complexity Check
 * Validates input length and estimated token count
 */
@Injectable()
export class InputComplexityCheck implements IInputGuardrail {
  readonly id = "input-complexity-check";
  readonly name = "Input Complexity Check";
  readonly enabled = true;

  private readonly thresholds: ComplexityThresholds = {
    maxLength: 400000, // 400k characters (~100k tokens, within model context limits)
    maxTokenEstimate: 100000, // ~100k tokens (GPT-5.1/Claude support 128k+ input)
    warnLength: 200000, // 200k characters
    warnTokenEstimate: 50000, // ~50k tokens
  };

  /**
   * Estimate token count (rough approximation: 1 token ≈ 4 characters)
   */
  private estimateTokens(text: string): number {
    // More accurate estimation:
    // - Split by whitespace and punctuation
    // - Average English word is ~1.3 tokens
    // - Chinese characters are typically 1 token each
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;

    // Rough estimate: words * 1.3 + Chinese chars
    return Math.ceil(words.length * 1.3 + chineseChars);
  }

  /**
   * Check input complexity
   */
  async check(input: GuardrailInput): Promise<GuardrailResult> {
    const length = input.content.length;
    const estimatedTokens = this.estimateTokens(input.content);

    // Check if exceeds maximum limits — warn but allow through (LLM APIs handle their own token limits)
    if (length > this.thresholds.maxLength) {
      return {
        passed: true,
        guardrailId: this.id,
        severity: "warning",
        message: `Input exceeds recommended length: ${length} characters (limit: ${this.thresholds.maxLength}). Allowing through — LLM API will enforce its own token limits.`,
        metadata: {
          length,
          maxLength: this.thresholds.maxLength,
          estimatedTokens,
          oversized: true,
        },
      };
    }

    if (estimatedTokens > this.thresholds.maxTokenEstimate) {
      return {
        passed: true,
        guardrailId: this.id,
        severity: "warning",
        message: `Input exceeds recommended token estimate: ${estimatedTokens} tokens (limit: ${this.thresholds.maxTokenEstimate}). Allowing through — LLM API will enforce its own token limits.`,
        metadata: {
          length,
          estimatedTokens,
          maxTokenEstimate: this.thresholds.maxTokenEstimate,
          oversized: true,
        },
      };
    }

    // Check if exceeds warning thresholds
    if (
      length > this.thresholds.warnLength ||
      estimatedTokens > this.thresholds.warnTokenEstimate
    ) {
      return {
        passed: true,
        guardrailId: this.id,
        severity: "warning",
        message: `Input is large: ${length} characters, ~${estimatedTokens} tokens`,
        metadata: {
          length,
          estimatedTokens,
          warnLength: this.thresholds.warnLength,
          warnTokenEstimate: this.thresholds.warnTokenEstimate,
        },
      };
    }

    // Within acceptable limits
    return {
      passed: true,
      guardrailId: this.id,
      severity: "info",
      message: `Input size acceptable: ${length} characters, ~${estimatedTokens} tokens`,
      metadata: {
        length,
        estimatedTokens,
      },
    };
  }

  /**
   * Update thresholds (for configuration)
   */
  updateThresholds(thresholds: Partial<ComplexityThresholds>): void {
    Object.assign(this.thresholds, thresholds);
  }
}
