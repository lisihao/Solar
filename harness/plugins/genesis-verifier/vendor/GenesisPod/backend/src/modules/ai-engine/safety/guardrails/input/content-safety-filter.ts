/**
 * AI Engine - Content Safety Filter
 * 内容安全过滤器
 */

import { Injectable } from "@nestjs/common";
import {
  IInputGuardrail,
  GuardrailInput,
  GuardrailResult,
} from "../guardrails.interface";
import { redactPII } from "./pii-redactor";

/**
 * Content Safety Filter
 * Detects AND redacts PII / sensitive information in input.
 *
 * ★ P1 (PII 脱敏真生效): 之前仅检测并返回 severity:'warning'，原文照进 LLM。
 * 现改为命中即调用 redactPII 脱敏，并把脱敏后文本写入 result.transformedContent，
 * 由管道传播给 ai-chat，最终用脱敏内容替换 messages 再发给 provider。
 * 策略：PII 默认脱敏（不阻断），保持 passed:true / severity:'warning'。
 */
@Injectable()
export class ContentSafetyFilter implements IInputGuardrail {
  readonly id = "content-safety-filter";
  readonly name = "Content Safety Filter";
  readonly enabled = true;

  /**
   * Check input for PII and redact in place.
   */
  async check(input: GuardrailInput): Promise<GuardrailResult> {
    const { redacted, detections } = redactPII(input.content);

    // No detections
    if (detections.length === 0) {
      return {
        passed: true,
        guardrailId: this.id,
        severity: "info",
        message: "No PII or sensitive information detected",
      };
    }

    // PII detected → 脱敏后通过（默认 redact，不阻断）
    const totalCount = detections.reduce((sum, d) => sum + d.count, 0);
    return {
      passed: true,
      guardrailId: this.id,
      severity: "warning",
      message: `Redacted ${totalCount} potential PII instances: ${detections.map((d) => `${d.name} (${d.count})`).join(", ")}`,
      // ★ 脱敏后文本回传给管道 → ai-chat 用它替换 messages 再发 provider
      transformedContent: redacted,
      metadata: {
        detections,
        totalCount,
        redacted: true,
      },
    };
  }
}
