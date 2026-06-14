/**
 * json-fence-parser.util.ts (content/ 聚合根：轴外跨领域纯原语，无内容子能力可归)
 *
 * LLM 输出 → 结构化 JSON 决策的通用解析基元（零业务语义，纯函数）。
 *
 * 适用场景：任何 ai-app 让 LLM 返回 JSON-in-fence-with-fallback-prose 模式。
 * 设计原则与 standards/16 §二 (engine 判别口诀): "不需要知道 agent / mission
 * 即能做的事" — 完全 fit ai-engine/content。
 *
 * 历史：from ai-app/{app}/services/chat/leader-decision-parser.util.ts
 *      （PR-10b standardize consumer 2026-05-04，generic 抽出来）。
 *
 * 输入形态（LLM 经常不严格按 system prompt 返回，必须容错）：
 *   1. ```json fenced { ... } ```
 *   2. 裸 JSON: { ... }
 *   3. 纯文本（无 JSON）→ caller 决定 fallback
 *   4. 开场白 + ```json fence + 总结：fence 外文本可作 fallback response
 *
 * 输出：
 *   { jsonObj: T | null, outsideFenceText: string, response: string, raw: string }
 *
 * caller 拿到 jsonObj 自行做 schema 校验 + 字段白名单（业务 DSL 留 caller）。
 */

export interface JsonFenceParseResult<T = Record<string, unknown>> {
  /** 解析成功的 JSON object（null = 无 JSON / 解析失败）*/
  readonly jsonObj: T | null;
  /** ```json fence 外的纯文本（caller 可作为 response fallback）*/
  readonly outsideFenceText: string;
  /**
   * 推荐的 response 文本，按优先级 fallback：
   *   jsonObj.response > jsonObj.message > jsonObj.understanding >
   *   outsideFenceText > raw（原文）
   */
  readonly response: string;
  /** 原始输入（debug / fallback 用）*/
  readonly raw: string;
}

/**
 * 从 LLM 输出解析 JSON-fence 决策。
 *
 * @param raw LLM 原始输出
 * @param responseFieldChain 用作 response fallback 的字段名链（默认
 *                          ['response', 'message', 'understanding']）
 */
export function parseJsonFence<T = Record<string, unknown>>(
  raw: string,
  responseFieldChain: readonly string[] = [
    "response",
    "message",
    "understanding",
  ],
): JsonFenceParseResult<T> {
  const trimmed = raw.trim();
  // 找 JSON 块（```json fence 或裸 JSON）
  let jsonStr = trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  // 取 fence 外的纯文字作为 fallback（如果 LLM 在 JSON 之外还写了开场白）
  const outsideFenceText = fenceMatch
    ? trimmed.replace(fenceMatch[0], "").trim()
    : "";

  if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) {
    // 不是 JSON → 整段当 response，jsonObj=null
    return { jsonObj: null, outsideFenceText, response: raw, raw };
  }

  try {
    const parsed = JSON.parse(jsonStr) as T;
    const obj = parsed as unknown as Record<string, unknown>;
    let response = "";
    for (const field of responseFieldChain) {
      const v = obj[field];
      if (typeof v === "string" && v.trim()) {
        response = v.trim();
        break;
      }
    }
    if (!response) {
      response = outsideFenceText.length > 0 ? outsideFenceText : raw;
    }
    return { jsonObj: parsed, outsideFenceText, response, raw };
  } catch {
    return { jsonObj: null, outsideFenceText, response: raw, raw };
  }
}

/**
 * 提取 ```json fence 内容（不解析）。
 *
 * 单纯需要 fence 字符串，不要 JSON 对象的场景。
 */
export function extractJsonFenceContent(raw: string): string | null {
  const m = raw.trim().match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return m ? m[1].trim() : null;
}
