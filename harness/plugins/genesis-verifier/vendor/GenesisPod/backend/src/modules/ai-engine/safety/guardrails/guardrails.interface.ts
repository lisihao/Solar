/**
 * AI Engine - Guardrails Interface
 * 护栏系统接口定义
 */

/**
 * Guardrail check result
 */
export interface GuardrailResult {
  /**
   * Whether the check passed
   */
  passed: boolean;

  /**
   * Guardrail identifier
   */
  guardrailId: string;

  /**
   * Result message
   */
  message?: string;

  /**
   * Severity level
   */
  severity: "info" | "warning" | "error" | "block";

  /**
   * Transformed content (e.g. PII-redacted text).
   *
   * When a guardrail rewrites the content (PII 脱敏占位符替换), it sets this
   * field to the sanitized text. The pipeline propagates it so the caller
   * (ai-chat) can send the redacted content to the LLM provider instead of
   * the original. 仅在内容被改写时设置；未改写则保持 undefined。
   */
  transformedContent?: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Input guardrail interface
 */
export interface IInputGuardrail {
  /**
   * Unique guardrail identifier
   */
  readonly id: string;

  /**
   * Human-readable name
   */
  readonly name: string;

  /**
   * Whether this guardrail is enabled
   */
  readonly enabled: boolean;

  /**
   * Check input against this guardrail
   */
  check(input: GuardrailInput): Promise<GuardrailResult>;
}

/**
 * Output guardrail interface
 */
export interface IOutputGuardrail {
  /**
   * Unique guardrail identifier
   */
  readonly id: string;

  /**
   * Human-readable name
   */
  readonly name: string;

  /**
   * Whether this guardrail is enabled
   */
  readonly enabled: boolean;

  /**
   * Check output against this guardrail
   */
  check(output: GuardrailOutput): Promise<GuardrailResult>;
}

/**
 * Guardrail input
 */
export interface GuardrailInput {
  /**
   * Input content to validate
   */
  content: string;

  /**
   * User ID (optional)
   */
  userId?: string;

  /**
   * 服务端内部管线调用（agent-to-agent，无直接用户输入）opt-in 标记。
   *
   * 置 true 时：regex 护栏照常运行（含 block 短路与 PII 脱敏），但 'warning'
   * 级可疑结果只记日志、不升级 LLM moderation、不因升级被 block——外部网页/
   * 研究语料经常触发误报，且升级本身额外烧一轮 LLM 调用。
   * 默认 undefined = 现有行为（warning 升级 LLM moderation）。
   */
  trustedInternal?: boolean;

  /**
   * Additional context
   */
  context?: Record<string, unknown>;
}

/**
 * Guardrail output
 */
export interface GuardrailOutput {
  /**
   * Output content to validate
   */
  content: string;

  /**
   * Model ID that generated this output (optional)
   */
  modelId?: string;

  /**
   * Additional context
   */
  context?: Record<string, unknown>;
}

/**
 * Guardrails pipeline result
 */
export interface GuardrailsPipelineResult {
  /**
   * Whether all guardrails passed
   */
  passed: boolean;

  /**
   * Individual guardrail results
   */
  results: GuardrailResult[];

  /**
   * ID of guardrail that blocked (if any)
   */
  blockedBy?: string;

  /**
   * Final transformed content after running all guardrails (e.g. PII-redacted).
   *
   * Set when at least one guardrail rewrote the content. The caller MUST use
   * this (when present) as the content sent to / returned from the LLM, so
   * redaction actually takes effect (not inert). undefined = 无任何改写，沿用原文。
   */
  transformedContent?: string;
}
