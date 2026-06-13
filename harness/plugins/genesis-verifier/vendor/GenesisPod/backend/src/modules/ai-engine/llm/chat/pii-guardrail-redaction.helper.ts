import { redactPII } from "../../safety/guardrails/input/pii-redactor";
import type { ChatMessage } from "../types";

/**
 * ★ P1 PII 脱敏（消费侧）—— 从 AiChatService 抽出，避免 god-class 增长。
 *
 * 对每条 user message 就地脱敏（非 user 角色原样保留），返回新数组。
 * 管道返回的是 join 后的整串无法可靠拆回单条，故逐条 redactPII，结果等价。
 */
export function redactUserMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.role !== "user") return m;
    const redacted: ChatMessage = {
      ...m,
      content: redactPII(m.content).redacted,
    };
    // L1 fix：多模态消息的文本块也脱敏（contentParts[].text）。否则 Vision/多模态
    // 用户文本里的 PII 会绕过脱敏直达 provider（contentParts 在置位时代替 content）。
    // 图片块（image_url）原样保留。
    if (Array.isArray(m.contentParts)) {
      redacted.contentParts = m.contentParts.map((p) =>
        p.type === "text" ? { ...p, text: redactPII(p.text).redacted } : p,
      );
    }
    return redacted;
  });
}

/**
 * 解析输出侧应返回的（可能已脱敏的）内容：优先用管道改写结果，
 * 管道未配置输出脱敏 guardrail 时对模型输出兜底 redactPII（保证不外泄 PII）。
 */
export function resolveRedactedOutput(
  content: string,
  transformedContent: string | undefined,
): string {
  return typeof transformedContent === "string"
    ? transformedContent
    : redactPII(content).redacted;
}
