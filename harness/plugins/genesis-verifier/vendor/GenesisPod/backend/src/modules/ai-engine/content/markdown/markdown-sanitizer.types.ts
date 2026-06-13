/**
 * MarkdownSanitizer types
 *
 * 上游：docs/architecture/ai-harness/evaluation/report-assembly-invariant-redesign.md v1.4
 *
 * 职责：对一段 markdown body 做"无副作用安全化 + 防 ReDoS / DoS / PII 泄露"。
 *
 * 任何输出 markdown 的 stage 都可复用（business-agnostic：harness/ai-app 共享）。
 *
 * v1.2-v1.4 关键设计：
 *   - 命名遵循 standards/16: 接口 .types.ts，纯函数实现 .util.ts（单数）
 *   - SanitizeRuleApplied.positions?: number[] 不存在（B12 PII 防护）
 *   - input size 限制（B11 防 ReDoS / DoS）
 *   - thinking signature 剥离（v2.1.88 反向洞察 #6）
 *   - sanitizerVersion 输出（持久化兼容，安全 L-1）
 *   - F17 H1→H3 跳级保留语义（不主动补中间 H2）
 *   - F18 prompt injection redaction
 */

export const MARKDOWN_SANITIZER_VERSION = "1.0.0";

export interface SanitizeOptions {
  /**
   * 是否允许保留顶级 H1 / H2（默认 false：剥离让 backend 控；caller 兼容旧调用方时传 true）
   */
  allowTopLevelHeadings?: boolean;
  /**
   * dim.name 列表 — 仅匹配这些 name 的首行 H2 被剥离
   * （精确剥 H2，不破坏 dim 内合法 H2 子章节）
   */
  knownDimNames?: string[];
  /** 输入 size 上限（B11 安全：防 ReDoS / DoS）；超限 throw `InputTooLargeError` */
  maxInputBytes?: number; // 默认 2_000_000 (2MB)
  /** 超时 abort signal（caller 传入，sanitizer 在长循环中检 .aborted） */
  abortSignal?: AbortSignal;
  /** 调试：触发段名（让 metric 上报能精确到哪段触发） */
  segmentName?: string;
}

export type SanitizeRule =
  | "unclosed-fence-appended"
  | "top-level-heading-stripped"
  | "embedded-toc-removed"
  | "blockquote-fence-fixed"
  | "thinking-signature-stripped"
  | "crlf-newline-normalized"
  | "bom-stripped"
  | "instruction-injection-redacted"
  | "html-comment-stripped"
  // ★ 2026-05-08 PR-6 (mission 843f6958 实证修): LLM 写图引用 4 类垃圾
  //   主路径 (StructuralReportAssembler) 此前 0 figure 规则，4 类垃圾透传到 fullMarkdown
  | "inline-fig-image-stripped" // ![FIG-N](xxx)
  | "figure-references-tag-stripped" // <figureReferences>...</figureReferences>
  | "figure-tag-stripped"; // <figure>...</figure>

export interface SanitizeRuleApplied {
  rule: SanitizeRule;
  count: number;
  /** 严重度（驱动告警阈值） */
  severity: "low" | "medium" | "high";
  /** 触发段名（不含 body 内容，避免 PII 泄露） */
  segmentName?: string;
}

export interface SanitizeResult {
  body: string;
  appliedRules: SanitizeRuleApplied[];
  /** sanitizer 规则集版本，持久化 ReportArtifact.metadata.sanitizerVersion 用 */
  sanitizerVersion: string;
}

export class InputTooLargeError extends Error {
  constructor(
    public readonly inputBytes: number,
    public readonly maxBytes: number,
  ) {
    super(
      `MarkdownSanitizer input too large: ${inputBytes} bytes > ${maxBytes} bytes`,
    );
    this.name = "InputTooLargeError";
  }
}

export class SanitizerAbortedError extends Error {
  constructor() {
    super("MarkdownSanitizer aborted via AbortSignal");
    this.name = "SanitizerAbortedError";
  }
}
