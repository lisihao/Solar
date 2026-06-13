/**
 * AI Engine - PII Redactor
 * PII 脱敏纯函数：把命中的 PII 替换为占位符再进入 LLM 请求。
 *
 * 设计要点：
 * - 纯函数、强类型、无副作用，可在 input/output 两侧复用。
 * - 与 ContentSafetyFilter 共享同一套正则，避免双轨/漂移。
 * - 返回脱敏后的文本 + detections 元信息（类型/名称/命中次数），供调用方接线 + 审计。
 */

/**
 * PII 类型（占位符前缀的来源）
 */
export type PIIType =
  | "email"
  | "phone"
  | "credit_card"
  | "ssn"
  | "id_card"
  | "ip_address"
  | "api_key";

/**
 * 单条 PII 命中元信息
 */
export interface PIIDetection {
  /** PII 类型 */
  type: PIIType;
  /** 人类可读名称 */
  name: string;
  /** 命中次数 */
  count: number;
}

/**
 * 脱敏结果
 */
export interface RedactionResult {
  /** 脱敏后文本（PII 已替换为占位符） */
  redacted: string;
  /** 命中的 PII 元信息（保留以供审计/追踪） */
  detections: PIIDetection[];
}

/**
 * PII 规则定义（正则 + 名称 + 类型 + 占位符）
 */
interface PIIRule {
  pattern: RegExp;
  name: string;
  type: PIIType;
  placeholder: string;
}

/**
 * PII 占位符映射（与 type 一一对应，强类型）
 */
const PII_PLACEHOLDERS: Record<PIIType, string> = {
  email: "[EMAIL]",
  phone: "[PHONE]",
  credit_card: "[CREDIT_CARD]",
  ssn: "[SSN]",
  id_card: "[ID]",
  ip_address: "[IP_ADDRESS]",
  api_key: "[API_KEY]",
};

/**
 * PII 规则表
 *
 * ★ 顺序很重要（顺序脱敏，后一条作用在前一条改写后的文本上）：
 * 1. email 最先（含 @ 锚点，不与数字规则冲突）。
 * 2. api_key 紧随其后——高熵长 token（≥32 含字母+数字/连字符）必须在 phone/
 *    credit_card 这类「数字片段」规则之前整体替换，否则 phone 的 US 分支会把
 *    api_key 中间的 10 位数字啃成 [PHONE]，破坏 token。
 * 3. 之后才是 credit_card / ssn / id_card / phone / ip_address（更具体的数字
 *    结构在更宽泛的 phone 之前）。
 * 正则来源与 ContentSafetyFilter 历史实现一致（单一事实源，避免双轨）。
 */
const PII_RULES: PIIRule[] = [
  {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    name: "Email Address",
    type: "email",
    placeholder: PII_PLACEHOLDERS.email,
  },
  {
    pattern: /\b[A-Za-z0-9_-]{32,}\b/g,
    name: "Potential API Key",
    type: "api_key",
    placeholder: PII_PLACEHOLDERS.api_key,
  },
  {
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    name: "Credit Card Number",
    type: "credit_card",
    placeholder: PII_PLACEHOLDERS.credit_card,
  },
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    name: "Social Security Number",
    type: "ssn",
    placeholder: PII_PLACEHOLDERS.ssn,
  },
  {
    pattern: /\b\d{17}[\dXx]\b|\b\d{15}\b/g,
    name: "ID Card Number",
    type: "id_card",
    placeholder: PII_PLACEHOLDERS.id_card,
  },
  {
    pattern:
      /(?:\+?86)?1[3-9]\d{9}|\+?1?\s*\(?[0-9]{3}\)?[-.\s]*[0-9]{3}[-.\s]*[0-9]{4}/g,
    name: "Phone Number",
    type: "phone",
    placeholder: PII_PLACEHOLDERS.phone,
  },
  {
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    name: "IP Address",
    type: "ip_address",
    placeholder: PII_PLACEHOLDERS.ip_address,
  },
];

/**
 * 判断 api_key 命中是否为有效（过滤误报：纯字母、过短）。
 * 与 ContentSafetyFilter 的误报过滤逻辑一致。
 */
function isValidApiKeyMatch(match: string): boolean {
  return match.length >= 32 && !/^[a-zA-Z]+$/.test(match);
}

/**
 * 对文本做 PII 脱敏。
 *
 * 纯函数：相同输入恒得相同输出，不修改入参。
 * 命中的 PII 被替换为对应占位符（[EMAIL]/[PHONE]/[SSN]/[CREDIT_CARD]/[ID]/...）。
 *
 * @param text 原始文本（可能含 PII）
 * @returns { redacted, detections } —— 脱敏后文本 + 命中元信息
 */
export function redactPII(text: string): RedactionResult {
  if (!text) {
    return { redacted: text ?? "", detections: [] };
  }

  let redacted = text;
  const detections: PIIDetection[] = [];

  for (const rule of PII_RULES) {
    // 重置全局正则 lastIndex，避免跨调用状态污染
    rule.pattern.lastIndex = 0;

    if (rule.type === "api_key") {
      // api_key 需先过滤误报，再决定是否替换
      const matches = redacted.match(rule.pattern) ?? [];
      const validMatches = matches.filter(isValidApiKeyMatch);
      if (validMatches.length > 0) {
        for (const m of validMatches) {
          redacted = redacted.split(m).join(rule.placeholder);
        }
        detections.push({
          type: rule.type,
          name: rule.name,
          count: validMatches.length,
        });
      }
      continue;
    }

    rule.pattern.lastIndex = 0;
    const matches = redacted.match(rule.pattern);
    if (matches && matches.length > 0) {
      redacted = redacted.replace(rule.pattern, rule.placeholder);
      detections.push({
        type: rule.type,
        name: rule.name,
        count: matches.length,
      });
    }
  }

  return { redacted, detections };
}
