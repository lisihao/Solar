import { scanMarkdownForMathIssues } from "../latex-scanner";

describe("latex-scanner (state machine)", () => {
  describe("valid inputs (no issues)", () => {
    const valid: Array<{ name: string; input: string }> = [
      { name: "empty", input: "" },
      { name: "pure prose", input: "Just plain text." },
      { name: "clean inline math", input: "Let $\\alpha + \\beta$ be." },
      { name: "clean display math", input: "Total: $$\\sum_i T_i$$ done." },
      {
        name: "multi-line display math",
        input: "Intro\n\n$$\n\\frac{a}{b}\n$$\n\nmore",
      },
      {
        name: "\\text with CJK",
        input: "设 $T_{\\text{延迟}}$ 为总延迟。",
      },
      { name: "escaped dollar", input: "价格是 \\$5。" },
      {
        name: "multiple inline on same line",
        input: "$a$, $b$, and $c$.",
      },
      {
        name: "\\begin/\\end inside $$",
        input: "$$\n\\begin{aligned}\na &= 1 \\\\\nb &= 2\n\\end{aligned}\n$$",
      },
      {
        name: "fenced code block with dollar signs",
        input: "```\nLet x = $100 and y = $50\n$alpha = beta\n```\nContinue.",
      },
      {
        name: "inline code with dollar signs",
        input: "Use `$variable` as syntax.",
      },
    ];

    for (const { name, input } of valid) {
      it(`passes: ${name}`, () => {
        const r = scanMarkdownForMathIssues(input);
        expect(r.valid).toBe(true);
        expect(r.issues).toEqual([]);
      });
    }
  });

  describe("detects unclosed / misplaced delimiters", () => {
    it("flags inline math unclosed before EOL", () => {
      const r = scanMarkdownForMathIssues(
        "Setup $\\alpha + \\beta not closed yet",
      );
      expect(r.valid).toBe(false);
      expect(r.issues.some((i) => i.kind === "unclosed-inline-math")).toBe(
        true,
      );
    });

    it("flags inline math spanning a newline (auto-closed at EOL)", () => {
      const r = scanMarkdownForMathIssues(
        "Start $\\alpha\nNext line continues",
      );
      expect(r.valid).toBe(false);
      expect(
        r.issues.some((i) => i.kind === "inline-math-contains-newline"),
      ).toBe(true);
    });

    it("flags display math opened but never closed", () => {
      const r = scanMarkdownForMathIssues("Intro\n\n$$\\alpha + \\beta\n\n");
      expect(r.valid).toBe(false);
      expect(r.issues.some((i) => i.kind === "unclosed-display-math")).toBe(
        true,
      );
    });

    it("flags \\[ without \\]", () => {
      const r = scanMarkdownForMathIssues("Math \\[\\alpha");
      expect(r.valid).toBe(false);
      expect(r.issues.some((i) => i.kind === "unclosed-bracket-math")).toBe(
        true,
      );
    });

    it("flags \\] without matching \\[", () => {
      const r = scanMarkdownForMathIssues("Stray \\] here");
      expect(r.valid).toBe(false);
    });

    it("flags mismatched \\begin/\\end names", () => {
      const r = scanMarkdownForMathIssues(
        "$$\\begin{aligned}a = 1\\end{pmatrix}$$",
      );
      expect(r.valid).toBe(false);
      expect(r.issues.some((i) => i.kind === "unmatched-environment")).toBe(
        true,
      );
    });

    it("flags \\begin without \\end", () => {
      const r = scanMarkdownForMathIssues("$$\\begin{aligned}a = 1$$");
      expect(r.valid).toBe(false);
      expect(r.issues.some((i) => i.kind === "unclosed-environment")).toBe(
        true,
      );
    });
  });

  describe("detects content issues inside $...$", () => {
    it("flags CJK punctuation inside inline math", () => {
      const r = scanMarkdownForMathIssues(
        "$T_{norm}=\\frac{a}{b}，其中B$ 是基准",
      );
      expect(r.valid).toBe(false);
      expect(
        r.issues.some((i) => i.kind === "inline-math-contains-cjk-prose"),
      ).toBe(true);
    });

    it("flags long CJK run outside \\text{}", () => {
      const r = scanMarkdownForMathIssues("研究 $T_{输入理解层}$ 的延迟。");
      expect(r.valid).toBe(false);
      expect(
        r.issues.some((i) => i.kind === "inline-math-contains-cjk-prose"),
      ).toBe(true);
    });

    it("allows CJK inside \\text{}", () => {
      const r = scanMarkdownForMathIssues("$T_{\\text{输入理解}}$");
      expect(r.valid).toBe(true);
    });

    it("flags unbalanced braces inside inline math", () => {
      const r = scanMarkdownForMathIssues("关系 $\\frac{a}{b$ 如上。");
      expect(r.valid).toBe(false);
      expect(
        r.issues.some((i) => i.kind === "inline-math-unbalanced-braces"),
      ).toBe(true);
    });
  });

  describe("boundary: code blocks isolate math-looking syntax", () => {
    it("ignores $ inside fenced code", () => {
      const r = scanMarkdownForMathIssues(
        "```\nunclosed $\\alpha here inside code\n```\nNormal text.",
      );
      expect(r.valid).toBe(true);
    });

    it("ignores $ inside inline code", () => {
      const r = scanMarkdownForMathIssues("Use `$var` notation. Rest is fine.");
      expect(r.valid).toBe(true);
    });

    it("re-enters math detection after code block closes", () => {
      const r = scanMarkdownForMathIssues(
        "```\n$broken\n```\nNow $unclosed after code",
      );
      expect(r.valid).toBe(false);
      expect(r.issues.some((i) => i.kind === "unclosed-inline-math")).toBe(
        true,
      );
    });
  });

  describe("edge cases that commonly trip regex validators", () => {
    it("handles $$ immediately after inline $ correctly", () => {
      // `$a$$b$` is ambiguous but reasonable parse: `$a$` then `$b$`
      const r = scanMarkdownForMathIssues("Combined $a$$b$ test.");
      expect(r.valid).toBe(true);
    });

    it("handles escaped braces inside math", () => {
      // \{ and \} should not affect brace balance
      const r = scanMarkdownForMathIssues("$\\{x \\in \\mathbb{R}\\}$");
      expect(r.valid).toBe(true);
    });

    it("does not confuse `$$` inside code fence with display math", () => {
      const r = scanMarkdownForMathIssues(
        "Example:\n```bash\necho $$ for PID\n```\nContinuing.",
      );
      expect(r.valid).toBe(true);
    });
  });
});
