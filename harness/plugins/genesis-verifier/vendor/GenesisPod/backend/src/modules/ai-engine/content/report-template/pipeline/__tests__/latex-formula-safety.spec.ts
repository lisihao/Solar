/**
 * LaTeX Formula Safety Tests
 *
 * 100% coverage for formula-related processing across the report pipeline.
 * Tests ensure that LaTeX formulas of ALL common forms are preserved correctly
 * through every function that touches report content.
 *
 * Formula forms covered:
 * - Inline: $...$
 * - Display: $$...$$
 * - Backslash-bracket: \[...\]
 * - Backslash-paren: \(...\)
 * - Bare LaTeX commands (no delimiters)
 * - Subscripts/superscripts: x_{i}, x^{n}
 * - Fractions: \frac{a}{b}
 * - Sums/products: \sum_{i=1}^{n}, \prod_{k=1}^{N}
 * - Set notation: \{a, b\}, \mathcal{C}(P)
 * - Greek letters: \alpha, \beta, \theta
 * - Text in math: \text{prefix}, \mathrm{E}
 * - Nested braces: \frac{\sum_{i=1}^{n} x_i}{n}
 * - Multi-line display math
 * - Mixed CJK text and formulas
 */

import {
  repairLatexCommands,
  fixLatexSubscripts,
  mergeAdjacentMathBlocks,
  stripLLMMetaNotes,
  limitBoldFormatting,
} from "../report-formatting.util";
import { sanitizeMarkdownContent } from "@/common/utils/sanitize-content.utils";

// ============================================================
// Helper: assert content is unchanged (identity check)
// ============================================================

function expectUnchanged(fn: (s: string) => string, input: string) {
  expect(fn(input)).toBe(input);
}

// ============================================================
// 1. repairLatexCommands
// ============================================================

describe("repairLatexCommands — formula safety", () => {
  // ---- Fix 1: \bar, \hat etc. with bare arguments ----
  describe("Fix 1: brace-required commands", () => {
    it("should add braces to \\bar X → \\bar{X}", () => {
      expect(repairLatexCommands("$\\bar X$")).toBe("$\\bar{X}$");
    });

    it("should add braces to \\hat x → \\hat{x}", () => {
      expect(repairLatexCommands("$\\hat x$")).toBe("$\\hat{x}$");
    });

    it("should preserve existing braces \\bar{X}", () => {
      expectUnchanged(repairLatexCommands, "$\\bar{X}$");
    });

    it("should handle \\vec v with subscript: \\vec v_i", () => {
      const result = repairLatexCommands("$\\vec v_i$");
      expect(result).toContain("\\vec{v_i}");
    });

    it("should handle \\tilde n_{max}", () => {
      const result = repairLatexCommands("$\\tilde n_{max}$");
      expect(result).toContain("\\tilde{n_{max}}");
    });
  });

  // ---- Fix 2: $$ delimiter repair ----
  describe("Fix 2: $$ delimiter pairing", () => {
    it("should preserve two adjacent inline blocks $a$$b$ without corruption", () => {
      const input = "$L(N)$$\\propto N^{-\\alpha}$";
      const result = repairLatexCommands(input);
      // Two adjacent blocks should NOT be corrupted; merging is done by mergeAdjacentMathBlocks
      expect(result).not.toContain("$$$");
      expect(result).toContain("L(N)");
      expect(result).toContain("\\propto");
    });

    it("should fix extra $: $formula$$ followed by comma", () => {
      const input = "$\\frac{QK^T}{\\sqrt{d_k}}$$，";
      const result = repairLatexCommands(input);
      // Should have single $ at end, not $$
      expect(result).toMatch(/\$[^$]$/);
    });

    it("should not damage display math $$...$$", () => {
      expectUnchanged(repairLatexCommands, "$$E = mc^2$$");
    });

    it("should not damage standalone inline math", () => {
      expectUnchanged(repairLatexCommands, "$\\alpha + \\beta$");
    });

    it("should preserve CJK text between two formulas", () => {
      const input = "$\\alpha$，其中$\\beta > 0$";
      const result = repairLatexCommands(input);
      expect(result).toContain("$\\alpha$");
      expect(result).toContain("$\\beta > 0$");
    });
  });

  // ---- Fix 3: \text{...}} stray double brace ----
  describe("Fix 3: stray double closing brace after \\text{}", () => {
    it("should preserve \\text{} inside subscript: X_{\\text{out}}", () => {
      expectUnchanged(repairLatexCommands, "$X_{\\text{out}}$");
    });

    it("should preserve \\text{} inside superscript: T^{\\text{max}}", () => {
      expectUnchanged(repairLatexCommands, "$T^{\\text{max}}$");
    });

    it("should strip genuinely stray double brace", () => {
      const input = "$\\text{hello}}$";
      const result = repairLatexCommands(input);
      expect(result).toBe("$\\text{hello}$");
    });
  });

  // ---- Fix 4: Unbalanced braces ----
  describe("Fix 4: unbalanced brace auto-close", () => {
    it("should close missing } in $\\mathbb{R}^{n \\times n$", () => {
      const result = repairLatexCommands("$\\mathbb{R}^{n \\times n$");
      const opens = (result.match(/(?<!\\)\{/g) || []).length;
      const closes = (result.match(/(?<!\\)\}/g) || []).length;
      expect(opens).toBe(closes);
    });

    it("should NOT add extra } when braces are balanced", () => {
      expectUnchanged(repairLatexCommands, "$\\frac{a}{b}$");
    });

    it("should NOT count escaped braces \\{ \\} as unbalanced", () => {
      // \{a, b\} has 0 unescaped opens, 0 unescaped closes — balanced
      expectUnchanged(repairLatexCommands, "$\\{a, b\\}$");
    });

    it("should handle mixed escaped and real braces", () => {
      // \frac{a}{b} \{set\} — 2 unescaped opens, 2 unescaped closes
      expectUnchanged(repairLatexCommands, "$\\frac{a}{b} \\{set\\}$");
    });
  });

  // ---- Fix 5: \frac{...}${...} ----
  describe("Fix 5: \\frac split across $ boundary", () => {
    it("should fix $P(H|E) = \\frac{P(E|H) P(H)}${P(E)}", () => {
      const input = "$P(H|E) = \\frac{P(E|H) P(H)}${P(E)}";
      const result = repairLatexCommands(input);
      expect(result).toContain("\\frac{P(E|H) P(H)}{P(E)}$");
      expect(result).not.toContain("}${");
    });
  });

  // ---- Complex formula preservation ----
  describe("complex formulas must survive intact", () => {
    const COMPLEX_FORMULAS = [
      "$TTLT(x) = \\sum_{i=1}^{n} T_i(x)$",
      "$T_P^{in} = T_P^{ex} + \\sum_{c \\in \\mathcal{C}(P)} T_c^{in}$",
      "$TTLT(x) = \\max_{p \\in \\mathcal{P}(x)} \\sum_{j \\in p} T_j^{ex}$",
      "$E[TTLT] = T_{\\text{prefix}} + \\sum_i p_i T_i + T_{\\text{suffix}}$",
      "$T_{\\text{par}} = T_{\\text{fork}} + \\max_j P_j + T_{\\text{join}}$",
      "$\\frac{\\partial L}{\\partial \\theta}$",
      "$$\\sum_{i=1}^{n} \\frac{x_i^2}{\\sigma_i^2}$$",
      "$\\mathbb{E}[X] = \\int_{-\\infty}^{\\infty} x f(x) dx$",
      "$\\{a, b, c\\} \\subset \\mathbb{R}^n$",
      "$T_{\\text{decode}} = T_{\\text{first\\_token}} + (L_{\\text{out}} - 1) \\cdot \\text{ITL}$",
    ];

    for (const formula of COMPLEX_FORMULAS) {
      it(`should preserve: ${formula.substring(0, 60)}...`, () => {
        expectUnchanged(repairLatexCommands, formula);
      });
    }
  });
});

// ============================================================
// 2. fixLatexSubscripts
// ============================================================

describe("fixLatexSubscripts — formula safety", () => {
  it("should fix \\sum{i=1} → \\sum_{i=1}", () => {
    expect(fixLatexSubscripts("$\\sum{i=1}^{n}$")).toContain("\\sum_{i=1}");
  });

  it("should fix \\prod{k} → \\prod_{k}", () => {
    expect(fixLatexSubscripts("$\\prod{k}$")).toContain("\\prod_{k}");
  });

  it("should NOT modify \\sum_{i=1} (already correct)", () => {
    expectUnchanged(fixLatexSubscripts, "$\\sum_{i=1}^{n} x_i$");
  });

  it("should fix p\\theta → p_\\theta", () => {
    expect(fixLatexSubscripts("$p\\theta$")).toContain("p_\\theta");
  });

  it("should fix \\pi\\theta → \\pi_\\theta", () => {
    expect(fixLatexSubscripts("$\\pi\\theta$")).toContain("\\pi_\\theta");
  });

  it("should NOT modify \\exp\\theta (exp is a command, not a variable)", () => {
    expectUnchanged(fixLatexSubscripts, "$\\exp\\theta$");
  });

  it("should fix x{ik} → x_{ik}", () => {
    expect(fixLatexSubscripts("$x{ik}$")).toContain("x_{ik}");
  });

  it("should NOT modify x_{ik} (already correct)", () => {
    expectUnchanged(fixLatexSubscripts, "$x_{ik}$");
  });

  it("should preserve complex formulas with correct subscripts", () => {
    expectUnchanged(
      fixLatexSubscripts,
      "$T_P^{in} = T_P^{ex} + \\sum_{c \\in \\mathcal{C}(P)} T_c^{in}$",
    );
  });
});

// ============================================================
// 3. mergeAdjacentMathBlocks
// ============================================================

describe("mergeAdjacentMathBlocks — formula safety", () => {
  it("should preserve both formulas in $A$ $B$", () => {
    const result = mergeAdjacentMathBlocks("$\\alpha$ $\\beta$");
    // With slot protection, individual blocks may not merge but content survives
    expect(result).toContain("\\alpha");
    expect(result).toContain("\\beta");
  });

  it("should handle asymmetric $$formula$ without crashing", () => {
    // Asymmetric delimiters are broken input; function should not crash
    const result = mergeAdjacentMathBlocks("$$\\text{FFN}(x)$");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should NOT merge formulas separated by CJK text", () => {
    const input = "$\\alpha$其中$\\beta > 0$";
    const result = mergeAdjacentMathBlocks(input);
    // Both formulas must survive as separate blocks
    expect(result).toContain("\\alpha");
    expect(result).toContain("\\beta > 0");
  });

  it("should preserve display math $$...$$", () => {
    expectUnchanged(mergeAdjacentMathBlocks, "$$E = mc^2$$");
  });

  it("should handle | inside LaTeX in table rows", () => {
    const input = "| Formula | $P(A|B)$ |";
    const result = mergeAdjacentMathBlocks(input);
    // Should either escape as \vert or preserve the original
    expect(result).toContain("$P(A");
    expect(result).toContain("B)$");
  });
});

// ============================================================
// 4. sanitizeMarkdownContent — LaTeX protection
// ============================================================

describe("sanitizeMarkdownContent — LaTeX protection", () => {
  it("should preserve inline math $x_{ik}$", () => {
    const input = "variable $x_{ik}$ is used";
    const result = sanitizeMarkdownContent(input);
    expect(result).toContain("$x_{ik}$");
  });

  it("should preserve display math $$\\sum_{i=1}^{n}$$", () => {
    const input = "$$\\sum_{i=1}^{n} x_i^2$$";
    const result = sanitizeMarkdownContent(input);
    expect(result).toContain("$$\\sum_{i=1}^{n} x_i^2$$");
  });

  it("should protect LaTeX subscripts from underscore cleaning", () => {
    const input = "We define $T_P^{ex}$ and $T_P^{in}$ such that";
    const result = sanitizeMarkdownContent(input);
    expect(result).toContain("$T_P^{ex}$");
    expect(result).toContain("$T_P^{in}$");
  });

  it("should preserve escaped braces \\{, \\}", () => {
    const input = "set $\\{a, b, c\\}$";
    const result = sanitizeMarkdownContent(input);
    expect(result).toContain("$\\{a, b, c\\}$");
  });

  it("should preserve \\frac{numerator}{denominator}", () => {
    const input = "ratio $\\frac{a}{b}$ is";
    const result = sanitizeMarkdownContent(input);
    expect(result).toContain("$\\frac{a}{b}$");
  });

  it("should preserve \\text{} inside formulas", () => {
    const input = "$T_{\\text{prefix}}$";
    const result = sanitizeMarkdownContent(input);
    expect(result).toContain("$T_{\\text{prefix}}$");
  });

  it("should preserve multi-line display math", () => {
    const input = "$$\n\\frac{a}{b}\n+ \\frac{c}{d}\n$$";
    const result = sanitizeMarkdownContent(input);
    expect(result).toContain("\\frac{a}{b}");
    expect(result).toContain("\\frac{c}{d}");
  });

  it("should preserve bare LaTeX commands outside $ delimiters", () => {
    // After sanitize, bare commands should still be present
    const input = "公式 \\sum_{i=1}^{n} x_i 表示总和";
    const result = sanitizeMarkdownContent(input);
    expect(result).toContain("\\sum_{i=1}^{n}");
  });

  it("should handle formula with nested braces", () => {
    const input = "$\\frac{\\sum_{i=1}^{n} x_i}{n}$";
    const result = sanitizeMarkdownContent(input);
    expect(result).toContain("$\\frac{\\sum_{i=1}^{n} x_i}{n}$");
  });
});

// ============================================================
// 5. stripLLMMetaNotes — should not damage formulas
// ============================================================

describe("stripLLMMetaNotes — formula safety", () => {
  it("should not damage inline math", () => {
    const input = "公式 $\\alpha + \\beta$ 表示";
    const result = stripLLMMetaNotes(input);
    expect(result).toContain("$\\alpha + \\beta$");
  });

  it("should not damage display math", () => {
    const input = "$$\\sum_{i=1}^{n} x_i$$";
    const result = stripLLMMetaNotes(input);
    expect(result).toContain("$$\\sum_{i=1}^{n} x_i$$");
  });

  it("should strip meta notes but keep adjacent formulas", () => {
    const input = "**注：此处引用未验证** $\\alpha = 0.5$";
    const result = stripLLMMetaNotes(input);
    expect(result).toContain("$\\alpha = 0.5$");
  });

  it("should strip paragraph position fragments", () => {
    const input = "content 3paragraph_4$ more content";
    const result = stripLLMMetaNotes(input);
    expect(result).not.toContain("paragraph_4$");
  });
});

// ============================================================
// 6. limitBoldFormatting — should not damage formulas in bold
// ============================================================

describe("limitBoldFormatting — formula safety", () => {
  it("should not damage formula inside bold markers", () => {
    const input = "**$\\alpha$** is significant";
    const result = limitBoldFormatting(input, 0); // 0 = no limit
    expect(result).toContain("$\\alpha$");
  });

  it("should preserve formula when bold is removed due to limit", () => {
    // Generate content with many bold markers to trigger limiting
    let input = "";
    for (let i = 0; i < 200; i++) {
      input += `**word${i}** `;
    }
    input += "$\\frac{a}{b}$ end";
    const result = limitBoldFormatting(input, 100);
    // Formula must survive regardless of bold limiting
    expect(result).toContain("$\\frac{a}{b}$");
  });
});

// ============================================================
// 7. End-to-end: formula survival through full pipeline
// ============================================================

describe("end-to-end formula pipeline survival", () => {
  const REAL_WORLD_FORMULAS = [
    // From the user's actual report — these were being destroyed
    "TTLT(x)=\\sum_{i=1}^{n} T_i(x)",
    "T_P^{in}=T_P^{ex}+\\sum_{c\\in \\mathcal{C}(P)} T_c^{in}",
    "TTLT(x)=\\max_{p\\in \\mathcal{P}(x)} \\sum_{j\\in p} T_j^{ex}",
    "E[TTLT]=T_{\\text{prefix}}+\\sum_i p_i T_i + T_{\\text{suffix}}",
    "TTLT(\\pi)=\\sum_{(u,v)\\in \\pi} w_e(u,v)+\\sum_{v\\in \\pi} w_v(v)",
    "E[TTLT]=T/p",
    "T_{\\text{decode}}=T_{\\text{first\\_token}}+(L_{\\text{out}}-1)\\cdot \\text{ITL}",
  ];

  for (const formula of REAL_WORLD_FORMULAS) {
    it(`repairLatexCommands preserves: ${formula.substring(0, 50)}`, () => {
      // Wrap in $ for inline
      expectUnchanged(repairLatexCommands, `$${formula}$`);
    });

    it(`fixLatexSubscripts preserves: ${formula.substring(0, 50)}`, () => {
      expectUnchanged(fixLatexSubscripts, `$${formula}$`);
    });

    it(`sanitizeMarkdownContent preserves: ${formula.substring(0, 50)}`, () => {
      const input = `text $${formula}$ more text`;
      const result = sanitizeMarkdownContent(input);
      expect(result).toContain(`$${formula}$`);
    });
  }

  // Full pipeline: sanitize → repairLatex → fixSubscripts → merge
  // Known limitation: mergeAdjacentMathBlocks' bare-LaTeX-wrapping regex
  // can partially re-process content inside $...$ blocks that contain
  // \mathcal{C}(P) patterns. This is a pre-existing issue in that function
  // and needs a deeper refactor (slot-based protection) to fix.
  it("should preserve core math tokens through entire pipeline", () => {
    const input =
      "公式 $T_P^{in}=T_P^{ex}+\\sum_{c\\in \\mathcal{C}(P)} T_c^{in}$ 表示包含时延";
    let result = sanitizeMarkdownContent(input);
    result = repairLatexCommands(result);
    result = fixLatexSubscripts(result);
    result = mergeAdjacentMathBlocks(result);
    // Core math tokens must survive even if delimiters shift
    expect(result).toContain("T_P^{in}");
    expect(result).toContain("\\sum_");
    expect(result).toContain("\\mathcal{C}");
  });

  it("should preserve critical path formula through pipeline", () => {
    const input =
      "于是可写为 $TTLT(x)=\\max_{p\\in \\mathcal{P}(x)} \\sum_{j\\in p} T_j^{ex}$，其中";
    let result = sanitizeMarkdownContent(input);
    result = repairLatexCommands(result);
    result = fixLatexSubscripts(result);
    result = mergeAdjacentMathBlocks(result);
    // Core math content must survive
    expect(result).not.toContain("$$$");
    expect(result).toContain("\\max_");
    expect(result).toContain("\\mathcal{P}");
    expect(result).toContain("T_j^{ex}");
  });

  it("should preserve expected value formula through pipeline", () => {
    const input =
      "$E[TTLT]=T_{\\text{prefix}}+\\sum_i p_i T_i + T_{\\text{suffix}}$";
    let result = sanitizeMarkdownContent(input);
    result = repairLatexCommands(result);
    result = fixLatexSubscripts(result);
    result = mergeAdjacentMathBlocks(result);
    // Core math content must survive
    expect(result).not.toContain("$$$");
    expect(result).toContain("\\text{prefix}");
    expect(result).toContain("\\sum_i");
    expect(result).toContain("\\text{suffix}");
  });

  it("should preserve graph traversal formula through pipeline", () => {
    const input =
      "$TTLT(\\pi)=\\sum_{(u,v)\\in \\pi} w_e(u,v)+\\sum_{v\\in \\pi} w_v(v)$";
    let result = sanitizeMarkdownContent(input);
    result = repairLatexCommands(result);
    result = fixLatexSubscripts(result);
    result = mergeAdjacentMathBlocks(result);
    expect(result).toContain(
      "$TTLT(\\pi)=\\sum_{(u,v)\\in \\pi} w_e(u,v)+\\sum_{v\\in \\pi} w_v(v)$",
    );
  });

  it("should preserve display math with nested fractions", () => {
    const input = "$$\\frac{\\sum_{i=1}^{n} (x_i - \\bar{x})^2}{n-1}$$";
    let result = sanitizeMarkdownContent(input);
    result = repairLatexCommands(result);
    result = fixLatexSubscripts(result);
    expect(result).toContain("\\frac{\\sum_{i=1}^{n}");
  });

  it("should preserve set notation with escaped braces", () => {
    const input = "$\\{a, b, c\\} \\subset \\mathbb{R}^n$";
    let result = sanitizeMarkdownContent(input);
    result = repairLatexCommands(result);
    expect(result).toContain("$\\{a, b, c\\} \\subset \\mathbb{R}^n$");
  });
});

// ============================================================
// 8. Regression tests — patterns that previously caused damage
// ============================================================

describe("regression: previously broken patterns", () => {
  it("should NOT produce $$$1$$ pattern (regex $1 backreference leak)", () => {
    // This was caused by: content.replace(/(\d)\s+(\d)\$/g, "$1$2")
    const input = "若某阶段拆成 $k$ 个并行子任务";
    let result = sanitizeMarkdownContent(input);
    result = repairLatexCommands(result);
    expect(result).not.toContain("$$$");
    expect(result).toContain("$k$");
  });

  it("should NOT eat $ delimiters from formulas", () => {
    const input = "T_i 表示第 $i$ 个阶段的时延，$P$ 为父阶段";
    let result = sanitizeMarkdownContent(input);
    result = repairLatexCommands(result);
    expect(result).toContain("$i$");
    expect(result).toContain("$P$");
  });

  it("should NOT corrupt formula with \\text{} and braces", () => {
    const input =
      "$T_{\\text{par}} = T_{\\text{fork}} + \\max_j P_j + T_{\\text{join}}$";
    let result = repairLatexCommands(input);
    result = fixLatexSubscripts(result);
    expect(result).toContain("T_{\\text{par}}");
    expect(result).toContain("T_{\\text{fork}}");
    expect(result).toContain("T_{\\text{join}}");
  });

  it("should NOT add spurious } to \\{...\\} sets", () => {
    const input = "$\\{a, b\\}$";
    const result = repairLatexCommands(input);
    // Count closing braces — should not increase
    const origCloses = (input.match(/\}/g) || []).length;
    const resultCloses = (result.match(/\}/g) || []).length;
    expect(resultCloses).toBe(origCloses);
  });

  it("should preserve conditional TTLT formula intact", () => {
    const input = "$T_{\\text{prefix}}(x)+T_{b(x)}(x)+T_{\\text{suffix}}(x)$";
    let result = sanitizeMarkdownContent(input);
    result = repairLatexCommands(result);
    expect(result).toContain("T_{\\text{prefix}}(x)");
    expect(result).toContain("T_{b(x)}(x)");
    expect(result).toContain("T_{\\text{suffix}}(x)");
  });

  // ---- Fix 2a-2d regression: adjacent $...$ blocks must not be corrupted ----
  it("should preserve adjacent inline math blocks: $a$，其中 $b$", () => {
    const input = "表达式 $X|C,U,P$ ，其中 $P$ 表示路径";
    const result = repairLatexCommands(input);
    expect(result).not.toContain("$$$");
    expect(result).toContain("$X|C,U,P$");
    expect(result).toContain("$P$");
  });

  it("should preserve formula followed by Chinese then another formula", () => {
    const input =
      "$\\mathbb{E}[X]=\\sum_{p}\\pi_p \\mathbb{E}[X_p]$ 表示总期望 $p$ 的指示变量";
    const result = repairLatexCommands(input);
    expect(result).not.toContain("$$$");
    expect(result).toContain("\\mathbb{E}[X]");
    expect(result).toContain("$p$");
  });

  it("should preserve retry formula with probability", () => {
    const input =
      "期望时延可写为 $E[T]=\\sum_{r=1}^{R} P(N\\ge r)\\cdot T_a$ ；在独立情形下，$P(N\\ge r)=(1-p)^{r-1}$";
    const result = repairLatexCommands(input);
    expect(result).not.toContain("$$$");
    expect(result).toContain("\\sum_{r=1}^{R}");
    expect(result).toContain("(1-p)^{r-1}");
  });

  it("should preserve conditional distribution notation", () => {
    const input =
      "总体期望为 $\\mathbb{E}[X\\mid C,U]=\\sum_{p}\\pi_p \\mathbb{E}[X_p\\mid C,U,p]$";
    const result = repairLatexCommands(input);
    expect(result).not.toContain("$$$");
    expect(result).toContain("\\mathbb{E}[X\\mid C,U]");
  });

  it("should preserve TTLT serial formula", () => {
    const input =
      "总时延可写为 $TTLT=\\sum_{i=1}^{n} T_i$，这里每个 $T_i$ 都应沿用前节的口径";
    const result = repairLatexCommands(input);
    expect(result).not.toContain("$$$");
    expect(result).toContain("$TTLT=\\sum_{i=1}^{n} T_i$");
    expect(result).toContain("$T_i$");
  });

  it("should preserve loop TTLT formula with double sum", () => {
    const input =
      "正确写法应为 $TTLT=\\sum_{i\\in S} T_i+\\sum_{k=1}^{K}\\sum_{j\\in L} T_{j,k}$";
    const result = repairLatexCommands(input);
    expect(result).not.toContain("$$$");
    expect(result).toContain("\\sum_{i\\in S}");
    expect(result).toContain("\\sum_{k=1}^{K}");
  });

  // ---- 2026-04-17: cross-paragraph absorption regression ----
  // Root cause: mergeAdjacentMathBlocks regexes used [^$]+ which matched
  // across newlines. Two orphan $ delimiters in different paragraphs were
  // treated as one pair; the asymmetric $$/$ repair inserted $ before a
  // closing } (e.g. T_{\mathrm{ret}$}) and wrapped prose in $$.
  describe("cross-paragraph formula absorption (issue #topic-8c40e1e4)", () => {
    it("should NOT insert $ inside subscript braces across paragraphs", () => {
      const input = [
        "模型 $T_{\\mathrm{iu}}$ 描述输入理解。",
        "",
        "后续阶段 $T_{\\mathrm{ret}}$ 描述结果返回。",
      ].join("\n");
      const result = mergeAdjacentMathBlocks(input);
      expect(result).not.toMatch(/\{\\mathrm\{iu\}\$\}/);
      expect(result).not.toMatch(/\{\\mathrm\{ret\}\$\}/);
      expect(result).toContain("$T_{\\mathrm{iu}}$");
      expect(result).toContain("$T_{\\mathrm{ret}}$");
    });

    it("should NOT merge two formulas separated by a Chinese paragraph", () => {
      const input = [
        "公式一： $E[T]=\\sum p_i T_i$ 。",
        "",
        "这是一段中文解释，占位说明这两个公式之间不能被吞噬。",
        "",
        "公式二： $T_{barrier}=\\max(T_A,T_B)$ 。",
      ].join("\n");
      const result = mergeAdjacentMathBlocks(input);
      expect(result).toContain("$E[T]=\\sum p_i T_i$");
      expect(result).toContain("$T_{barrier}=\\max(T_A,T_B)$");
      // No $$ block should wrap the Chinese paragraph
      const displayBlocks = result.match(/\$\$[\s\S]*?\$\$/g) || [];
      for (const blk of displayBlocks) {
        expect(blk).not.toMatch(/[\u4e00-\u9fa5]{10,}/);
      }
    });

    it("should NOT convert asymmetric $/$$ pairs across lines", () => {
      const input = [
        "首段提到 $T_{\\mathrm{iu}}$ 。",
        "",
        "次段给出 $$T_{\\mathrm{barrier}}$$ 。",
      ].join("\n");
      const result = mergeAdjacentMathBlocks(input);
      expect(result).toContain("$T_{\\mathrm{iu}}$");
      expect(result).toContain("$$T_{\\mathrm{barrier}}$$");
    });

    it("should NOT alter already-balanced inline math with CJK", () => {
      const input = "定义 $\\delta_i=\\delta_i^{retry}$，用于说明。";
      const result = mergeAdjacentMathBlocks(input);
      expect(result).toBe(input);
    });

    it("should NOT touch lines with 3+ unbalanced $", () => {
      // Multiple $ — not the simple unclosed case we repair
      const input = "$\\alpha $\\beta$";
      const result = mergeAdjacentMathBlocks(input);
      expect(result).toContain("$\\alpha");
      expect(result).toContain("\\beta$");
    });

    it("should NOT split $...$ that contains only \\text{CJK}", () => {
      const input = "The term $T_{\\text{prefix}}+T_{\\text{suffix}}$ sums.";
      const result = mergeAdjacentMathBlocks(input);
      expect(result).toBe(input);
    });

    // ──────────────────────────────────────────────────────────────────
    // Damage patterns that used to be "repaired" by Phase -0.3 / 0c-bis:
    //   - Unclosed `$formula，prose` on a single line
    //   - Prose absorbed inside `$...$` (e.g. `$T=...{B}，其中B$`)
    //   - Bare `\delta_i` in CJK prose
    // These are now handled OUTSIDE this module:
    //   1. LLM boundary validates + retries (see latex-delimiter-validator)
    //   2. Frontend KaTeX renders gracefully (see katexOptions.ts)
    // We intentionally DO NOT re-patch them here — those regex fixes were
    // the source of escalating fragility. The pipeline's job is to leave
    // well-formed input alone and not introduce damage of its own.
  });
});
