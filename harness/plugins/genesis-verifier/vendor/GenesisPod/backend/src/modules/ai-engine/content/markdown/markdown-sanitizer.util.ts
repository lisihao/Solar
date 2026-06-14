/**
 * MarkdownSanitizer 实现
 *
 * 上游：docs/architecture/ai-harness/evaluation/report-assembly-invariant-redesign.md v1.4 §4.1
 *
 * 设计要点（与 v1.4 文档保持严格一致）：
 *   1. fence 状态机扫描（非全文奇偶计数）— 嵌套 ` ```markdown\n```py\n```\n``` ` 也能正确处理
 *   2. 顶级 H1/H2 精确剥离 — 仅剥离 knownDimNames[i] 匹配的首行 H2
 *   3. 嵌入 [[toc]] / [TOC] 标记移除（backend 自己生成目录）
 *   4. 引用块内 fence 修复 ` > ```...` → 提到引用外
 *   5. trailing 空白 / 重复换行规整
 *   6. CRLF → LF 归一化
 *   7. BOM 清除
 *   8. <thinking>...</thinking> 整块剥离（cross-model fallback 防泄露）
 *   9. instruction-injection-redacted（F18 — `Ignore previous instructions` 等 → `[indirect prompt redacted]`）
 *  10. HTML 注释 `<!-- ... -->` 移除（防 assembler H2 误识）
 *
 * ReDoS / DoS 防御：
 *   - 入口 input.length > maxInputBytes throw
 *   - regex 用非回溯写法
 *   - 长循环每 1000 行检 abortSignal.aborted
 *
 * stateless：所有状态局部于函数栈，便于 Promise.all 并发。
 */

import {
  MARKDOWN_SANITIZER_VERSION,
  InputTooLargeError,
  SanitizerAbortedError,
  type SanitizeOptions,
  type SanitizeResult,
  type SanitizeRule,
  type SanitizeRuleApplied,
} from "./markdown-sanitizer.types";

// Re-export for facade consumers convenience（与 .types.ts 同一常量，单一源）
export { MARKDOWN_SANITIZER_VERSION } from "./markdown-sanitizer.types";

const DEFAULT_MAX_INPUT_BYTES = 2_000_000;

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:all )?(?:previous|prior|above) (?:instructions|directives|prompts)/gi,
  /disregard (?:all )?(?:previous|prior|above) (?:instructions|directives)/gi,
  /<\|(?:im_start|im_end|system|assistant|user)\|>/gi,
  /\[\[?\s*system\s*\]\]?\s*:?\s*/gi,
];

const FENCE_RE = /^(\s{0,3})(```|~~~)([^\r\n]*)$/;
const H2_RE = /^##\s+(.+?)\s*$/;
const H1_RE = /^#\s+(.+?)\s*$/;
const TOC_RE = /^\s*\[\[?\s*toc\s*\]\]?\s*$/i;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const THINKING_RE = /<thinking>[\s\S]*?<\/thinking>/gi;
const BLOCKQUOTE_FENCE_RE = /^\s*>\s*(```|~~~)([^\r\n]*)$/;

/**
 * 主入口
 */
export function sanitizeMarkdownBody(
  raw: string,
  opts: SanitizeOptions = {},
): SanitizeResult {
  const maxBytes = opts.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const inputBytes = Buffer.byteLength(raw, "utf-8");
  if (inputBytes > maxBytes) {
    throw new InputTooLargeError(inputBytes, maxBytes);
  }

  const appliedCount = new Map<SanitizeRule, number>();
  const inc = (rule: SanitizeRule): void => {
    appliedCount.set(rule, (appliedCount.get(rule) ?? 0) + 1);
  };

  let body = raw;

  // 1. BOM 剥除（开头）
  if (body.charCodeAt(0) === 0xfeff) {
    body = body.slice(1);
    inc("bom-stripped");
  }

  // 2. CRLF → LF
  if (body.includes("\r")) {
    const before = body.length;
    body = body.replace(/\r\n?/g, "\n");
    if (body.length !== before) inc("crlf-newline-normalized");
  }

  // 3. <thinking>...</thinking> 整块剥离
  body = body.replace(THINKING_RE, () => {
    inc("thinking-signature-stripped");
    return "";
  });

  // 4. HTML 注释剥除
  body = body.replace(HTML_COMMENT_RE, () => {
    inc("html-comment-stripped");
    return "";
  });

  // 5. prompt injection redaction
  for (const pat of PROMPT_INJECTION_PATTERNS) {
    body = body.replace(pat, () => {
      inc("instruction-injection-redacted");
      return "[indirect prompt redacted]";
    });
  }

  // ★ 2026-05-08 PR-6 (mission 843f6958 实证修, 4/4 Round 2 第 4 路指出 PR-4 装错管线):
  //   主路径 (StructuralReportAssembler → sanitizeMarkdownBody) 历史 0 figure
  //   规则，LLM 写出 4 类图引用垃圾（inline-fig URL / <figureReferences> 标签 /
  //   <figure> 标签 / prompt 提示语当 url）全透传到 fullMarkdown。这里加 3 条
  //   主路径规则，与 ai-engine/content/report-template 的 removeHallucinatedImages
  //   规则等价，但移到主路径生效（feedback_no_dual_sources：单源治理）。
  //
  //   注意：保留合法 `![](#fig-N)` 占位（reportAssembler.injectFigurePlaceholders
  //   注入），因此 inline-fig 规则只剥 `![FIG-N](xxx)` 形式（chapter-writer 严令
  //   禁止此格式，唯一图引用路径是 finalize.figureReferences 结构化字段）。
  body = body.replace(/!\[FIG-\d+[^\]]*\]\([^)]+\)/gi, () => {
    inc("inline-fig-image-stripped");
    return "";
  });
  body = body.replace(
    /<figureReferences?>[\s\S]*?<\/figureReferences?>/gi,
    () => {
      inc("figure-references-tag-stripped");
      return "";
    },
  );
  // 单边孤立 <figureReferences> / </figureReferences>（无配对）
  body = body.replace(/<\/?figureReferences?>/gi, () => {
    inc("figure-references-tag-stripped");
    return "";
  });
  body = body.replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, () => {
    inc("figure-tag-stripped");
    return "";
  });
  body = body.replace(/<\/?figure[^>]*>/gi, () => {
    inc("figure-tag-stripped");
    return "";
  });

  // 6. 状态机扫描 — fence 配对 + 顶级 heading 处理 + blockquote fence 修复 + TOC 移除
  body = scanLines(body, opts, inc);

  // 7. 折叠 ≥3 个 \n 为 \n\n（trailing 空白规整）
  body = body.replace(/\n{3,}/g, "\n\n").replace(/^[ \t]+\n/gm, "\n");

  if (opts.abortSignal?.aborted) throw new SanitizerAbortedError();

  const appliedRules: SanitizeRuleApplied[] = [];
  for (const [rule, count] of appliedCount) {
    appliedRules.push({
      rule,
      count,
      severity: severityOf(rule),
      segmentName: opts.segmentName,
    });
  }

  return {
    body,
    appliedRules,
    sanitizerVersion: MARKDOWN_SANITIZER_VERSION,
  };
}

/**
 * v1.7 (代码审 / 测试三轮反馈): 仅当 fence info string（lang）属于
 * "孤儿 fence 高发"语言时，才触发 fence 内 H2 就近补关。
 *
 * 真实场景：mission `eafceb32` 是 mermaid 漏关；其他可能漏关的是
 * 无 lang 标记的纯 ```...```。编程语言（python/bash/js/ts/...）的
 * 代码块内合法存在 `## comment`（如教 markdown 语法），不应被误判。
 */
const ORPHAN_FENCE_LANGS = new Set([
  "", // 无 lang 标记的裸 fence（最易孤儿）
  "mermaid",
  "mmd",
  "graph",
  "flowchart",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "erdiagram",
  "gantt",
  "journey",
  "pie",
]);

function scanLines(
  body: string,
  opts: SanitizeOptions,
  inc: (rule: SanitizeRule) => void,
): string {
  const lines = body.split("\n");
  const out: string[] = [];
  /** fence stack：每条记录 fence 类型 + lang，多条表示嵌套 */
  const fenceStack: { type: string; lang: string; line: number }[] = [];
  const knownDims = new Set(opts.knownDimNames ?? []);
  /** 是否已经处理首行 H2 剥离（仅首行允许剥） */
  let firstNonEmpty = true;

  for (let i = 0; i < lines.length; i++) {
    if (i % 1000 === 999 && opts.abortSignal?.aborted) {
      throw new SanitizerAbortedError();
    }

    const line = lines[i];

    // blockquote 内 fence → 提到引用外（修复后跳过普通 fence 处理这一行）
    const bqFence = BLOCKQUOTE_FENCE_RE.exec(line);
    if (bqFence) {
      out.push(bqFence[1] + bqFence[2]);
      const fenceType = bqFence[1];
      const top = fenceStack[fenceStack.length - 1];
      if (top && top.type === fenceType) fenceStack.pop();
      else fenceStack.push({ type: fenceType, lang: "", line: i });
      inc("blockquote-fence-fixed");
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const fenceType = fence[2];
      const fenceLang = (fence[3] ?? "").trim().toLowerCase();
      const top = fenceStack[fenceStack.length - 1];
      if (top && top.type === fenceType) {
        fenceStack.pop();
      } else {
        fenceStack.push({ type: fenceType, lang: fenceLang, line: i });
      }
      out.push(line);
      continue;
    }

    // 仍在 fence 内 → 检查是否遇到看起来像 H2 的行（孤儿 fence 治理）
    //
    // ★ v1.6 + v1.7 启发式精确化：
    // sanitizer 原行为是只在 EOF 补关 fence，但若 fence 漏关后下游内容含
    // 多个 ## H2，按 EOF 补关会让所有 H2 都仍在 fence 内（前端渲染为代码块）。
    // 真正的修复是在 fence 内遇到 H2 就近补关，让该 H2 作为 fence 外的真章节。
    //
    // v1.7：仅当 fence lang ∈ ORPHAN_FENCE_LANGS（mermaid / 无 lang）时
    // 才触发，避免 python/bash 代码块内合法的 `## comment` 被误关。
    if (fenceStack.length > 0) {
      const looksLikeH2 = /^##\s/.test(line) && !/^###/.test(line);
      const top = fenceStack[fenceStack.length - 1];
      const langOrphanProne = ORPHAN_FENCE_LANGS.has(top.lang);
      if (looksLikeH2 && langOrphanProne) {
        // 在 H2 前补关所有未关 fence（最常见情况是 1 个，即 mermaid 的 ```）
        while (fenceStack.length > 0) {
          const f = fenceStack.pop()!;
          out.push(f.type);
          inc("unclosed-fence-appended");
        }
        // 然后正常处理这个 H2（落到下面的"在 fence 外"分支）
      } else {
        // 普通 fence 内行（代码块内容）→ 保留原样
        out.push(line);
        continue;
      }
    }

    // 嵌入 TOC 标记移除
    if (TOC_RE.test(line)) {
      inc("embedded-toc-removed");
      continue;
    }

    // 顶级 heading 处理（仅在 fence 外）
    if (!opts.allowTopLevelHeadings) {
      const h2 = H2_RE.exec(line);
      if (h2) {
        const title = h2[1].trim();
        // 仅当首行 H2 且匹配 knownDimNames，剥离
        if (firstNonEmpty && knownDims.has(title)) {
          inc("top-level-heading-stripped");
          firstNonEmpty = false;
          continue;
        }
        // 其他 H2 保留（dim 内合法 H2 子章节）
      }
      const h1 = H1_RE.exec(line);
      if (h1) {
        // F2: body 开头 # 大标题 → 降为 ### 大标题（保留语义但避免顶级冲突）
        // F17: 标题跳跃 — 不主动补中间 H2，由前端目录组件容忍
        out.push(`### ${h1[1].trim()}`);
        inc("top-level-heading-stripped");
        if (firstNonEmpty) firstNonEmpty = false;
        continue;
      }
    }

    if (firstNonEmpty && line.trim() !== "") firstNonEmpty = false;
    out.push(line);
  }

  // 收尾：fence stack 残留 → 在 EOF 前补关
  while (fenceStack.length > 0) {
    const f = fenceStack.pop()!;
    out.push(f.type);
    inc("unclosed-fence-appended");
  }

  return out.join("\n");
}

function severityOf(rule: SanitizeRule): "low" | "medium" | "high" {
  switch (rule) {
    case "unclosed-fence-appended":
      return "high"; // 影响整个文档结构
    case "instruction-injection-redacted":
      return "high"; // 安全相关
    case "thinking-signature-stripped":
      return "medium";
    case "top-level-heading-stripped":
    case "blockquote-fence-fixed":
      return "medium";
    case "embedded-toc-removed":
    case "html-comment-stripped":
    case "crlf-newline-normalized":
    case "bom-stripped":
      return "low";
    case "inline-fig-image-stripped":
    case "figure-references-tag-stripped":
    case "figure-tag-stripped":
      return "medium"; // LLM 写错图引用契约，应被 chapter-writer prompt + reviewer 拦
  }
}
