/**
 * Wiki-link parser (P0a-1, llm wiki v1.5.3 §3.1 + §10)
 *
 * 上游：docs/architecture/ai-app/library/wiki/llm-wiki.md §10 (10 条边界用例锁定)
 *
 * 抽取 markdown body 中的 `[[slug]]` 引用：
 *   - 跳过围栏代码块（``` / ~~~）
 *   - 跳过行内代码（`...`）
 *   - 跳过 HTML 注释（<!-- ... -->）
 *   - 跳过反斜杠转义的 \[\[...\]\]
 *   - 拒绝包含路径分隔符 `/` 的 slug（路径穿越防护）
 *   - 经 normalizeMarkdownSlug 规范化、去重后返回
 *
 * 实现策略：纯字符串 + 状态机扫描。
 *
 * 选型说明：方案文档 §10 备注"用 remark AST 实现"，但 backend/package.json
 * 当前未引入 remark / remark-parse / unist-util-visit；为遵守项目"避免不必要
 * 依赖"惯例，本实现采用等价的字符串状态机。语义与 §10 锁定的 10 条用例一一对齐
 * （见 __tests__/wiki-link-parser.util.spec.ts）。如未来引入 remark 系列依赖，
 * 可平替为 AST 实现而不影响调用方。
 *
 * 复用场景：wiki body `[[slug]]` 解析；writing/research/office 跨引用解析。
 */

import { normalizeMarkdownSlug } from "./slug-normalize.util";

/**
 * Parse `[[slug]]` references from a markdown body.
 *
 * Skips fenced code blocks, inline code, HTML comments, and escaped brackets.
 * Rejects slugs containing `/` (path traversal protection).
 * Returns deduplicated, normalized slugs in first-seen order.
 *
 * @param body markdown 原文
 * @returns 去重 + 规范化后的 slug 数组（顺序为首次出现顺序）
 *
 * @example
 *   parseMarkdownWikiLinks('See [[Machine Learning]]')   // ['machine-learning']
 *   parseMarkdownWikiLinks('`[[code]]`')                  // []
 *   parseMarkdownWikiLinks('[[a]] and [[b]]')             // ['a', 'b']
 *   parseMarkdownWikiLinks('[[a/b]]')                     // []
 */
export function parseMarkdownWikiLinks(body: string): string[] {
  const slugs = new Set<string>();
  const len = body.length;

  let i = 0;
  // Tracks whether we are inside a fenced code block (``` or ~~~).
  // Holds the current fence delimiter character (`` ` `` or `~`) when open, else null.
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;

  while (i < len) {
    const ch = body[i];

    // ───────────────────────── inside a fenced code block ─────────────────────────
    if (fenceChar !== null) {
      // Look for matching closing fence at start of a line (or current position
      // if we just consumed a newline).
      if (
        ch === fenceChar &&
        (i === 0 || body[i - 1] === "\n") // closing fence must be at line start
      ) {
        let run = 0;
        while (i + run < len && body[i + run] === fenceChar) run++;
        if (run >= fenceLen) {
          // Close the fence; skip all the fence chars then continue scanning.
          i += run;
          fenceChar = null;
          fenceLen = 0;
          continue;
        }
      }
      i++;
      continue;
    }

    // ─────────── opening fence detection (only at start of a line) ────────────
    if ((ch === "`" || ch === "~") && (i === 0 || body[i - 1] === "\n")) {
      let run = 0;
      while (i + run < len && body[i + run] === ch) run++;
      if (run >= 3) {
        fenceChar = ch as "`" | "~";
        fenceLen = run;
        i += run;
        continue;
      }
      // Fewer than 3 backticks at line start → could still be inline code; fall through.
    }

    // ───────────────────────── inline code (single backticks) ─────────────────────
    if (ch === "`") {
      // Count run length of opening backticks
      let run = 0;
      while (i + run < len && body[i + run] === "`") run++;
      // Look for matching closing run (same length)
      const opener = run;
      let j = i + run;
      while (j < len) {
        if (body[j] === "`") {
          let crun = 0;
          while (j + crun < len && body[j + crun] === "`") crun++;
          if (crun === opener) {
            // Skip the entire inline code span (opener + content + closer)
            i = j + crun;
            break;
          }
          j += crun;
        } else {
          j++;
        }
      }
      if (j >= len) {
        // Unterminated inline code: treat the rest as code-like (skip to EOF)
        i = len;
      }
      continue;
    }

    // ───────────────────────── HTML comment <!-- ... --> ─────────────────────────
    if (
      ch === "<" &&
      body[i + 1] === "!" &&
      body[i + 2] === "-" &&
      body[i + 3] === "-"
    ) {
      const end = body.indexOf("-->", i + 4);
      if (end === -1) {
        // Unterminated comment: skip to EOF
        i = len;
      } else {
        i = end + 3;
      }
      continue;
    }

    // ───────────────────────── escaped brackets \[ ─────────────────────────
    // Markdown convention: a backslash escapes the next punctuation character.
    if (ch === "\\" && body[i + 1] === "[") {
      // Skip the backslash and the bracket; this prevents `\[\[escaped\]\]`
      // from being recognized as a wiki link.
      i += 2;
      continue;
    }

    // ───────────────────────── wiki link `[[ ... ]]` ─────────────────────────
    if (ch === "[" && body[i + 1] === "[") {
      // Find closing `]]` on the same logical span. We require the contents
      // to NOT contain `[`, `]`, or newline (matches v1.5.3 §3.1 spec pattern
      // `/\[\[([^\[\]\/]+)\]\]/g` plus our additional `/` rejection).
      let j = i + 2;
      let bad = false;
      while (j < len - 1) {
        const c = body[j];
        if (c === "]" && body[j + 1] === "]") break;
        if (c === "[" || c === "]" || c === "\n") {
          bad = true;
          break;
        }
        j++;
      }
      if (!bad && j < len - 1 && body[j] === "]" && body[j + 1] === "]") {
        const raw = body.slice(i + 2, j).trim();
        if (raw.length > 0 && !raw.includes("/")) {
          const normalized = normalizeMarkdownSlug(raw);
          if (normalized) slugs.add(normalized);
        }
        i = j + 2;
        continue;
      }
      // Not a valid wiki link; advance past the `[[` and continue.
      i += 2;
      continue;
    }

    i++;
  }

  return Array.from(slugs);
}
