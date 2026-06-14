/**
 * ai-engine/safety/security/llm-injection —— LLM 注入防御三件套（沉淀自 {app}, 2026-04-29）
 *
 * OWASP LLM01 (Indirect Prompt Injection) 防御基线。所有 LLM 调用前涉及
 * 外部内容（web 抓取、用户输入、数据库读取）都应用 wrapExternalContent 包装。
 *
 * - security-audit-logger: 安全事件审计日志（注入企图、可疑指令检测）
 * - prompt-sanitizer: 内容 sanitize（剥离不可信指令模式）
 * - external-content-wrapper: 外部内容 XML 隔离 + sanitize
 *
 * TI 仍使用 ai-app/{app}/utils/{prompt-sanitizer, external-content-wrapper, security-audit-logger}.ts。
 */

// Sediment from {app} (2026-04-29)
export {
  createSecurityLogger,
  SecurityAuditLogger,
  SecurityEventType,
  SecuritySeverity,
  type SecurityLogEntry,
} from "./security-audit-logger";
export {
  sanitize,
  sanitizePromptInput,
  sanitizeExternalContent,
  containsDangerousContent,
  escapeForPrompt,
  type SanitizeOptions,
  type SanitizeResult,
} from "./prompt-sanitizer";
export {
  wrapExternalContent,
  wrapExternalContentBatch,
  getExternalContentNotice,
  type WrapExternalContentOptions,
} from "./external-content-wrapper.utils";
