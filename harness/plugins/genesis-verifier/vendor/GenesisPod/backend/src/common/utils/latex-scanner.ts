/**
 * Stateful Markdown/LaTeX Scanner
 *
 * Character-level state machine that walks the markdown once, tracking:
 *   - Code fence state  (``` / `)
 *   - Display math state ($$)
 *   - Inline math state  ($)
 *   - Bracket display    (\[ ... \])
 *   - Environment stack  (\begin{x} ... \end{x})
 *
 * Replaces the regex-based validator for detection because regex cannot
 * correctly model these nested, partially-overlapping grammars. A true
 * AST parser (remark/unified) is ESM-only and awkward to integrate into
 * this CJS codebase, so a hand-rolled scanner gives us AST-quality
 * accuracy without the dependency pain.
 *
 * Output is a list of structured issues ready to feed the LLM repair
 * prompt (`latex-delimiter-validator.ts` keeps the same public shape).
 */

export interface ScanIssue {
  kind:
    | "unclosed-inline-math"
    | "unclosed-display-math"
    | "unclosed-bracket-math"
    | "unclosed-environment"
    | "unmatched-environment"
    | "inline-math-contains-newline"
    | "inline-math-contains-cjk-prose"
    | "inline-math-unbalanced-braces";
  line: number;
  column: number;
  message: string;
  snippet?: string;
}

export interface ScanResult {
  valid: boolean;
  issues: ScanIssue[];
}

const CJK_PUNCT_RE = /[\uff0c\u3002\uff1b\uff1a\uff01\uff1f]/;

interface Position {
  line: number;
  col: number;
  index: number;
}

function lookBack(s: string, i: number, n: number): string {
  return s.substring(Math.max(0, i - n), i);
}

function lookFwd(s: string, i: number, n: number): string {
  return s.substring(i, Math.min(s.length, i + n));
}

/**
 * Main scanner. Returns structured issues list.
 */
export function scanMarkdownForMathIssues(md: string): ScanResult {
  const issues: ScanIssue[] = [];
  let line = 1;
  let col = 1;

  // State
  let inFencedCode = false; // ``` blocks
  let inInlineCode = false; // ` ... `
  let inDisplayMath = false;
  let inlineMathStart: Position | null = null; // null = not in inline math
  let bracketMathStart: Position | null = null;
  const envStack: Array<{ name: string; line: number; col: number }> = [];

  const emit = (
    issue: Omit<ScanIssue, "line" | "column"> & {
      line?: number;
      column?: number;
    },
  ) => {
    issues.push({
      line: issue.line ?? line,
      column: issue.column ?? col,
      ...issue,
    });
  };

  for (let i = 0; i < md.length; i++) {
    const c = md[i];
    const cc = md[i + 1] ?? "";
    const prev = md[i - 1] ?? "";

    // Newline handling
    if (c === "\n") {
      // Inline math cannot span newlines — if we're still in it, flag
      if (inlineMathStart) {
        emit({
          kind: "inline-math-contains-newline",
          line: inlineMathStart.line,
          column: inlineMathStart.col,
          message: `Inline math opened at line ${inlineMathStart.line} col ${inlineMathStart.col} was not closed before the line ended.`,
          snippet: lookBack(md, i, 60),
        });
        inlineMathStart = null;
      }
      // Inline code also stops at EOL (for GFM)
      inInlineCode = false;
      line++;
      col = 1;
      continue;
    }

    // Fenced code block: ```
    if (c === "`" && cc === "`" && md[i + 2] === "`") {
      inFencedCode = !inFencedCode;
      i += 2;
      col += 3;
      continue;
    }

    // Skip everything inside fenced code
    if (inFencedCode) {
      col++;
      continue;
    }

    // Inline code toggle: `
    if (c === "`" && prev !== "\\") {
      inInlineCode = !inInlineCode;
      col++;
      continue;
    }

    // Skip inline code content
    if (inInlineCode) {
      col++;
      continue;
    }

    // \[ ... \] bracket display math
    if (c === "\\" && cc === "[") {
      if (bracketMathStart) {
        emit({
          kind: "unclosed-bracket-math",
          line: bracketMathStart.line,
          column: bracketMathStart.col,
          message: `Nested \\[ encountered before previous \\[ at line ${bracketMathStart.line} was closed.`,
        });
      }
      bracketMathStart = { line, col, index: i };
      i += 1;
      col += 2;
      continue;
    }
    if (c === "\\" && cc === "]") {
      if (bracketMathStart) {
        bracketMathStart = null;
      } else {
        emit({
          kind: "unclosed-bracket-math",
          message: `Found \\] with no matching \\[.`,
        });
      }
      i += 1;
      col += 2;
      continue;
    }

    // \begin{env} ... \end{env}
    if (c === "\\" && lookFwd(md, i, 6) === "\\begin") {
      const match = md.substring(i).match(/^\\begin\{([a-zA-Z*]+)\}/);
      if (match) {
        envStack.push({ name: match[1], line, col });
        i += match[0].length - 1;
        col += match[0].length;
        continue;
      }
    }
    if (c === "\\" && lookFwd(md, i, 4) === "\\end") {
      const match = md.substring(i).match(/^\\end\{([a-zA-Z*]+)\}/);
      if (match) {
        const name = match[1];
        const top = envStack.pop();
        if (!top) {
          emit({
            kind: "unmatched-environment",
            message: `Found \\end{${name}} with no matching \\begin.`,
          });
        } else if (top.name !== name) {
          emit({
            kind: "unmatched-environment",
            message: `Found \\end{${name}} but innermost open environment was \\begin{${top.name}} at line ${top.line}.`,
          });
        }
        i += match[0].length - 1;
        col += match[0].length;
        continue;
      }
    }

    // Escaped $ — skip the $
    if (c === "\\" && cc === "$") {
      i += 1;
      col += 2;
      continue;
    }

    // $ delimiters (inline or display)
    if (c === "$") {
      const isDisplay = cc === "$";

      if (isDisplay) {
        // $$
        if (inlineMathStart) {
          // Closing $ of an inline math followed by another $.
          // GFM ambiguity: treat as end of inline + start of adjacent.
          // We interpret the FIRST $ as closing the inline, second opens new inline.
          inlineMathStart = null;
          i += 0; // advance by 1 below
          col++;
          continue;
        }
        if (inDisplayMath) {
          inDisplayMath = false;
        } else {
          inDisplayMath = true;
        }
        i += 1;
        col += 2;
        continue;
      }

      // Single $
      if (inDisplayMath) {
        // Inside display math — ignore single $
        col++;
        continue;
      }
      if (inlineMathStart) {
        // Closing inline math — validate content inside
        const content = md.substring(inlineMathStart.index + 1, i);
        validateInlineMathContent(content, inlineMathStart, emit);
        inlineMathStart = null;
      } else {
        inlineMathStart = { line, col, index: i };
      }
      col++;
      continue;
    }

    col++;
  }

  // End of document: flush unclosed states
  if (inlineMathStart) {
    emit({
      kind: "unclosed-inline-math",
      line: inlineMathStart.line,
      column: inlineMathStart.col,
      message: `Inline math opened at line ${inlineMathStart.line} col ${inlineMathStart.col} was never closed.`,
    });
  }
  if (inDisplayMath) {
    emit({
      kind: "unclosed-display-math",
      message: `Display math ($$) opened but never closed before end of document.`,
    });
  }
  if (bracketMathStart) {
    emit({
      kind: "unclosed-bracket-math",
      line: bracketMathStart.line,
      column: bracketMathStart.col,
      message: `\\[ opened at line ${bracketMathStart.line} was never closed.`,
    });
  }
  for (const env of envStack) {
    emit({
      kind: "unclosed-environment",
      line: env.line,
      column: env.col,
      message: `\\begin{${env.name}} at line ${env.line} was never closed.`,
    });
  }

  return { valid: issues.length === 0, issues };
}

function validateInlineMathContent(
  content: string,
  start: Position,
  emit: (
    i: Omit<ScanIssue, "line" | "column"> & { line?: number; column?: number },
  ) => void,
): void {
  // Strip \text{...} groups — legitimate CJK lives there
  const strippedForCjk = content.replace(/\\text\{[^}]*\}/g, "");
  if (CJK_PUNCT_RE.test(strippedForCjk)) {
    emit({
      kind: "inline-math-contains-cjk-prose",
      line: start.line,
      column: start.col,
      message: `Inline math at line ${start.line} contains CJK punctuation (，。；) outside \\text{…}. A closing $ was probably placed too late.`,
      snippet: content.substring(0, 80),
    });
  }
  const cjkRun = strippedForCjk.match(/[\u4e00-\u9fff]{4,}/);
  if (cjkRun) {
    emit({
      kind: "inline-math-contains-cjk-prose",
      line: start.line,
      column: start.col,
      message: `Inline math at line ${start.line} contains a run of CJK characters (${cjkRun[0]}). Either wrap them in \\text{…} or close the formula earlier.`,
      snippet: content.substring(0, 80),
    });
  }
  // Brace balance
  const opens = (content.match(/(?<!\\)\{/g) || []).length;
  const closes = (content.match(/(?<!\\)\}/g) || []).length;
  if (opens !== closes) {
    emit({
      kind: "inline-math-unbalanced-braces",
      line: start.line,
      column: start.col,
      message: `Inline math at line ${start.line} has unbalanced braces (${opens} open vs ${closes} close).`,
      snippet: content.substring(0, 80),
    });
  }
}
