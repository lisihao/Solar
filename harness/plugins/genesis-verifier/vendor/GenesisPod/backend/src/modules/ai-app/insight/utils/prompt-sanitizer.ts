/**
 * Prompt Sanitizer Utility
 *
 * ★ Security: 防止 Prompt Injection 攻击
 *
 * 用于消毒用户输入，防止：
 * - 指令覆盖攻击 (Instruction Override)
 * - 角色劫持攻击 (Role Hijacking)
 * - 上下文逃逸 (Context Escape)
 * - 隐藏 Unicode 字符
 *
 * @see https://owasp.org/www-project-top-10-for-large-language-model-applications/
 */

import { Logger } from "@nestjs/common";
import { createSecurityLogger } from "./security-audit-logger";

const logger = new Logger("PromptSanitizer");
const securityLogger = createSecurityLogger("PromptSanitizer");

/**
 * 危险模式定义
 */
interface DangerousPattern {
  pattern: RegExp;
  replacement: string;
  reason: string;
}

/**
 * 危险指令模式 - 匹配常见的 prompt injection 尝试
 * 这些模式会被移除或替换
 */
const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // 指令覆盖类
  {
    pattern:
      /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi,
    replacement: "[FILTERED]",
    reason: "Instruction override attempt",
  },
  {
    pattern:
      /forget\s+(everything|all|what)\s+(you\s+)?(know|learned|were\s+told)/gi,
    replacement: "[FILTERED]",
    reason: "Memory manipulation attempt",
  },
  {
    pattern:
      /disregard\s+(all|the|previous|above)\s+(instructions?|prompts?|rules?)/gi,
    replacement: "[FILTERED]",
    reason: "Disregard instruction attempt",
  },
  {
    pattern: /override\s+(your|the|all)\s+(instructions?|programming|rules?)/gi,
    replacement: "[FILTERED]",
    reason: "Override attempt",
  },

  // 角色劫持类
  {
    pattern: /you\s+are\s+(now|actually)\s+(a|an|the)/gi,
    replacement: "[FILTERED]",
    reason: "Role hijacking attempt",
  },
  {
    pattern: /pretend\s+(you\s+are|to\s+be|you're)\s+(a|an)/gi,
    replacement: "[FILTERED]",
    reason: "Role pretending attempt",
  },
  {
    pattern: /act\s+as\s+(if\s+)?(you\s+)?(are|were)\s+(a|an)/gi,
    replacement: "[FILTERED]",
    reason: "Act as attempt",
  },
  {
    pattern: /from\s+now\s+on,?\s+you\s+(are|will\s+be)/gi,
    replacement: "[FILTERED]",
    reason: "Identity change attempt",
  },

  // 系统角色伪装
  {
    pattern: /\[system\]/gi,
    replacement: "[user]",
    reason: "System role spoofing",
  },
  {
    pattern: /\[assistant\]/gi,
    replacement: "[user]",
    reason: "Assistant role spoofing",
  },
  {
    pattern: /<\/?system>/gi,
    replacement: "",
    reason: "System tag injection",
  },

  // 提示泄露类
  {
    pattern: /reveal\s+(your|the)\s+(system\s+)?prompt/gi,
    replacement: "[FILTERED]",
    reason: "Prompt reveal attempt",
  },
  {
    pattern: /show\s+(me\s+)?(your|the)\s+(original\s+)?instructions?/gi,
    replacement: "[FILTERED]",
    reason: "Instruction reveal attempt",
  },
  {
    pattern: /what\s+(are|were)\s+your\s+(original\s+)?instructions?/gi,
    replacement: "[FILTERED]",
    reason: "Instruction query attempt",
  },

  // 开发者模式类
  {
    pattern: /developer\s+mode/gi,
    replacement: "[FILTERED]",
    reason: "Developer mode attempt",
  },
  {
    // 原 /jailbreak/gi 过于宽泛：学术文献里"Jailbreaking LLMs"、"Jailbreak
    // Statistics"等合法标题全被误杀。窄化为"明显的越狱指令形式"：
    //   enable jailbreak / activate jailbreak / jailbreak mode / jailbreak me
    // 纯名词"jailbreak"（研究主题）不再被过滤。
    pattern:
      /(?:enable|activate|start|turn\s+on|initiate)\s+jailbreak|jailbreak\s+(?:mode|me|this|now)/gi,
    replacement: "[FILTERED]",
    reason: "Jailbreak attempt",
  },
  {
    pattern: /DAN\s*mode/gi,
    replacement: "[FILTERED]",
    reason: "DAN mode attempt",
  },
];

/**
 * 隐藏的 Unicode 字符（用于隐藏恶意指令）
 * 注意: 保留 \t (0x09) 和 \n (0x0A) 换行符
 */
const HIDDEN_UNICODE_RANGES = [
  // 零宽字符
  /[\u200B-\u200F]/g, // Zero-width characters
  /[\u2028-\u202F]/g, // Various space characters (includes line/paragraph separators)
  /[\u2060-\u206F]/g, // Word joiner and invisible operators
  /[\uFEFF]/g, // Byte order mark
  // 控制字符 (排除 \t=0x09 和 \n=0x0A)
  /[\u0000-\u0008\u000B-\u001F]/g, // C0 control characters except tab and newline
  /[\u007F-\u009F]/g, // C1 control characters
  // 特殊空白
  /[\u00A0\u1680\u180E]/g, // Non-breaking space, Ogham space, etc.
  /[\u2000-\u200A]/g, // Various width spaces
];

/**
 * 消毒配置选项
 */
export interface SanitizeOptions {
  /** 是否移除危险模式 (默认 true) */
  removeDangerousPatterns?: boolean;
  /** 是否移除隐藏 Unicode (默认 true) */
  removeHiddenUnicode?: boolean;
  /** 是否规范化空白字符 (默认 true) */
  normalizeWhitespace?: boolean;
  /** 最大长度限制 */
  maxLength?: number;
  /** 是否记录过滤操作 (默认 true) */
  logFiltered?: boolean;
}

/**
 * 消毒结果
 */
export interface SanitizeResult {
  /** 消毒后的文本 */
  sanitized: string;
  /** 是否检测到危险内容 */
  hasDangerousContent: boolean;
  /** 检测到的危险模式列表 */
  detectedPatterns: string[];
  /** 原始长度 */
  originalLength: number;
  /** 消毒后长度 */
  sanitizedLength: number;
}

/**
 * 消毒用户输入
 *
 * @param input 用户输入的原始文本
 * @param options 消毒选项
 * @returns 消毒结果
 */
export function sanitizePromptInput(
  input: string,
  options: SanitizeOptions = {},
): SanitizeResult {
  const {
    removeDangerousPatterns = true,
    removeHiddenUnicode = true,
    normalizeWhitespace = true,
    maxLength = 10000,
    logFiltered = true,
  } = options;

  const detectedPatterns: string[] = [];
  let sanitized = input;
  const originalLength = input.length;

  // 1. 移除隐藏的 Unicode 字符 (保留 \t 和 \n)
  if (removeHiddenUnicode) {
    for (const pattern of HIDDEN_UNICODE_RANGES) {
      sanitized = sanitized.replace(pattern, "");
    }
  }

  // 2. 检测并替换危险模式
  if (removeDangerousPatterns) {
    for (const { pattern, replacement, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(sanitized)) {
        detectedPatterns.push(reason);
        sanitized = sanitized.replace(pattern, replacement);
      }
    }
  }

  // 3. 规范化空白字符
  if (normalizeWhitespace) {
    // 将多个空格合并为一个
    sanitized = sanitized.replace(/  +/g, " ");
    // 将多个换行合并为两个
    sanitized = sanitized.replace(/\n{3,}/g, "\n\n");
    // 去除首尾空白
    sanitized = sanitized.trim();
  }

  // 4. 长度限制
  // ★ 2026-05-13 P4-#10: truncate 是 caller 显式指定 maxLength 的预期行为
  //   （wrapExternalContent / writer evidence 短摘要等场景每条都会截）。从 warn
  //   降级到 debug，避免污染监控；warn 仅留给真正的异常（dangerous pattern
  //   detection）。
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
    if (logFiltered) {
      logger.debug(
        `Input truncated from ${originalLength} to ${maxLength} characters`,
      );
    }
  }

  // 5. 记录检测结果
  if (logFiltered && detectedPatterns.length > 0) {
    logger.warn(
      `Detected ${detectedPatterns.length} dangerous pattern(s): ${detectedPatterns.join(", ")}`,
    );

    // ★ Security: 记录安全审计日志
    securityLogger.logPromptInjection({
      detectedPatterns,
      inputPreview: input.substring(0, 100), // 只记录前100字符
    });
  }

  return {
    sanitized,
    hasDangerousContent: detectedPatterns.length > 0,
    detectedPatterns,
    originalLength,
    sanitizedLength: sanitized.length,
  };
}

/**
 * 快速消毒 - 返回消毒后的字符串
 *
 * @param input 用户输入
 * @param maxLength 最大长度
 * @returns 消毒后的字符串
 */
export function sanitize(input: string, maxLength = 2000): string {
  return sanitizePromptInput(input, { maxLength }).sanitized;
}

/**
 * **外部内容专用消毒** - 用于 search result 标题、PDF 抓取文本、evidence 正文等
 * 第三方内容。
 *
 * 与 {@link sanitize} 的区别：**不做 injection-pattern 检测，也不打 security event**。
 * 学术研究场景里"Jailbreaking LLMs"、"Prompt Injection Statistics"这类论文
 * 标题是合法研究内容，跟用户尝试注入是两码事；用同一规则会把整个话题方向
 * 都误杀掉。
 *
 * 仍会：去控制字符、规范空白、截断长度——保持下游 prompt 组装的稳定性。
 *
 * @param input 来自第三方（search / crawl / PDF）的文本
 * @param maxLength 最大长度
 */
export function sanitizeExternalContent(
  input: string,
  maxLength = 2000,
): string {
  if (!input || typeof input !== "string") return "";

  // 只做保底 normalization，不做 pattern detection
  // eslint-disable-next-line no-control-regex
  let out = input.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
  out = out.replace(/  +/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.trim();
  if (maxLength && out.length > maxLength) {
    out = out.substring(0, maxLength);
  }
  return out;
}

/**
 * 检查输入是否包含危险内容
 *
 * @param input 用户输入
 * @returns 是否包含危险内容
 */
export function containsDangerousContent(input: string): boolean {
  return sanitizePromptInput(input, { logFiltered: false }).hasDangerousContent;
}

/**
 * 转义特殊字符用于嵌入提示
 * 将用户输入用引号包裹并转义内部引号
 *
 * @param input 用户输入
 * @returns 转义后的字符串
 */
export function escapeForPrompt(input: string): string {
  const sanitized = sanitize(input);
  // 转义双引号
  const escaped = sanitized.replace(/"/g, '\\"');
  // 用三重引号包裹，防止上下文逃逸
  return `"""${escaped}"""`;
}
