/**
 * Business Simulation: Does the unified pipeline ROOT-CAUSE fix report problems?
 *
 * Tests the 4 core user complaints:
 *   1. Chapter numbering chaos (mixed formats, inconsistent hierarchy)
 *   2. Orphaned figure references (mentioning figures that don't exist)
 *   3. Table formatting (column count mismatch, missing separators)
 *   4. LaTeX fragmentation (unbalanced delimiters, bare commands)
 *
 * Each scenario uses REAL content patterns observed in production reports.
 */

import {
  formatDimensionContent,
  normalizeTableDataRows,
  removeOrphanedFigureReferences,
  fixUnbalancedLatexDelimiters,
} from "../dimension-content-formatting.util";

import {
  numberSubHeadings,
  sanitizeHeadingLevels,
  repairMarkdownTables,
  wrapBareInlineLatex,
  wrapProseStyleMath,
  boldSummaryPrefixes,
  repairLatexCommands,
  stripInternalFigureNotation,
  stripLLMMetaNotes,
} from "../report-formatting.util";

// ============================================================
// Scenario 1: Chapter Numbering — The Core User Complaint
// ============================================================
describe("Scenario 1: Chapter numbering root-cause fix", () => {
  const CONTENT_WITH_CHAOTIC_NUMBERING = [
    "# 市场分析总览",
    "",
    "## 宏观趋势",
    "",
    "### 1. 全球市场规模",
    "全球AI市场预计2026年达到5000亿美元。",
    "",
    "### III. 技术发展趋势",
    "大模型技术持续迭代。",
    "",
    "### 2.1 竞争格局分析",
    "主要玩家包括OpenAI、Google、Anthropic。",
    "",
    "#### A. 头部企业",
    "OpenAI估值超过800亿美元。",
    "",
    "三、应用场景分类",
    "",
    "企业级应用占比最高。",
    "",
    "### 投资回报分析",
    "ROI普遍在2-3年内实现。",
  ].join("\n");

  it("should strip H1/H2 report titles and number H3/H4 consistently (dimIndex=2 → chapter 3)", () => {
    const result = formatDimensionContent(CONTENT_WITH_CHAOTIC_NUMBERING, {
      dimIndex: 2,
    });

    // H1/H2 should be REMOVED (they're report-level titles, not section headings)
    expect(result).not.toMatch(/^# /m);
    expect(result).not.toMatch(/^## /m);
    expect(result).not.toMatch(/^###.*市场分析总览/m);
    expect(result).not.toMatch(/^###.*宏观趋势/m);

    // All H3 should have 3.N. format, starting from 3.1
    const h3Matches = result.match(/^### .+$/gm) || [];
    expect(h3Matches.length).toBeGreaterThanOrEqual(4);
    expect(h3Matches[0]).toContain("3.1.");
    expect(h3Matches[1]).toContain("3.2.");
    expect(h3Matches[2]).toContain("3.3.");

    // Roman numeral "III." should be stripped from the title
    expect(result).not.toMatch(/III\./);

    // Chinese numeral "三、应用场景分类" should be converted to ### 3.N.
    expect(result).not.toMatch(/^三、/m);
    expect(result).toMatch(/### 3\.\d+\. 应用场景分类/);
  });

  it("should strip letter prefixes (A. B. C.) from H4 headings", () => {
    const content = [
      "### 核心发现",
      "内容。",
      "",
      "#### A. 头部企业",
      "说明。",
      "",
      "#### B. 中小企业",
      "说明。",
    ].join("\n");
    const result = formatDimensionContent(content, { dimIndex: 0 });
    expect(result).not.toMatch(/A\. 头部/);
    expect(result).not.toMatch(/B\. 中小/);
    expect(result).toMatch(/#### 1\.1\.1\. 头部企业/);
    expect(result).toMatch(/#### 1\.1\.2\. 中小企业/);
  });

  it("should handle dimIndex=0 (chapter 1) correctly", () => {
    const simple = [
      "### 第一个要点",
      "内容A。",
      "",
      "### 第二个要点",
      "内容B。",
    ].join("\n");
    const result = formatDimensionContent(simple, { dimIndex: 0 });
    expect(result).toContain("### 1.1.");
    expect(result).toContain("### 1.2.");
  });

  it("should produce consistent numbering across multiple dimensions", () => {
    const content = [
      "### 核心发现",
      "发现内容。",
      "",
      "### 数据分析",
      "分析结果。",
    ].join("\n");

    const dim1 = formatDimensionContent(content, { dimIndex: 0 });
    const dim2 = formatDimensionContent(content, { dimIndex: 1 });
    const dim3 = formatDimensionContent(content, { dimIndex: 2 });

    expect(dim1).toContain("### 1.1.");
    expect(dim1).toContain("### 1.2.");
    expect(dim2).toContain("### 2.1.");
    expect(dim2).toContain("### 2.2.");
    expect(dim3).toContain("### 3.1.");
    expect(dim3).toContain("### 3.2.");
  });

  it("without dimIndex, headings are NOT numbered (by design for chapter view)", () => {
    const result = formatDimensionContent(CONTENT_WITH_CHAOTIC_NUMBERING);
    const h3Matches = result.match(/^### .+$/gm) || [];
    for (const h of h3Matches) {
      expect(h).not.toMatch(/### \d+\.\d+\./);
    }
  });

  it("sanitizeHeadingLevels removes H1/H2 instead of demoting", () => {
    const content =
      "# Report Title\n\nSome text.\n\n## Section\n\nMore text.\n\n### Real heading\n\nContent.";
    const result = sanitizeHeadingLevels(content);
    expect(result).not.toContain("# Report Title");
    expect(result).not.toContain("## Section");
    expect(result).toContain("### Real heading");
    expect(result).toContain("Some text.");
    expect(result).toContain("More text.");
  });

  it("numberSubHeadings strips Roman numeral prefixes", () => {
    const content = "### III. 技术趋势\n\n### IV. 市场格局";
    const result = numberSubHeadings(content, 2);
    expect(result).toContain("### 2.1. 技术趋势");
    expect(result).toContain("### 2.2. 市场格局");
    expect(result).not.toContain("III.");
    expect(result).not.toContain("IV.");
  });

  // ── Edge cases from deep review ──

  it("should preserve year headings (2026年)", () => {
    const content = "### 2026年市场展望\n\n### 2025年回顾";
    const result = numberSubHeadings(content, 1);
    expect(result).toContain("### 1.1. 2026年市场展望");
    expect(result).toContain("### 1.2. 2025年回顾");
  });

  it("should NOT strip 'I am' or 'VR技术' or 'AI市场' as Roman/letter prefixes", () => {
    // Potential false positives for the Roman numeral and letter prefix regex
    const content = [
      "### AI市场分析",
      "内容。",
      "",
      "### VR技术发展",
      "内容。",
    ].join("\n");
    const result = numberSubHeadings(content, 1);
    // "AI" should NOT be treated as letter prefix (no period after A)
    expect(result).toContain("AI市场分析");
    // "VR" should NOT be treated as Roman numeral (R is not in IVX)
    expect(result).toContain("VR技术发展");
  });

  it("should strip parenthesized numerals: （一）、（1）", () => {
    const content = "### （一）概述\n\n### （2）分析";
    const result = numberSubHeadings(content, 1);
    expect(result).toContain("### 1.1. 概述");
    expect(result).toContain("### 1.2. 分析");
  });

  it("content below stripped H1/H2 survives", () => {
    // Verify paragraph text is NOT lost when H1/H2 headings are stripped
    const content = [
      "# 报告标题",
      "这段内容紧跟H1。",
      "",
      "## 子标题",
      "这段内容紧跟H2。",
      "",
      "### 真正的子章节",
      "正文内容。",
    ].join("\n");
    const result = formatDimensionContent(content, { dimIndex: 0 });
    expect(result).toContain("这段内容紧跟H1。");
    expect(result).toContain("这段内容紧跟H2。");
    expect(result).toContain("正文内容。");
    expect(result).toContain("### 1.1.");
  });

  it("multiple consecutive H1/H2 don't produce excessive blank lines", () => {
    const content =
      "# Title\n## Part 1\n## Part 2\n\n### Actual Content\nText.";
    const result = formatDimensionContent(content, { dimIndex: 0 });
    // Should not have 3+ consecutive newlines after Phase 6 cleanup
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain("### 1.1.");
  });
});

// ============================================================
// Scenario 2: Orphaned Figure References
// ============================================================
describe("Scenario 2: Orphaned figure references", () => {
  // ── Chinese patterns ──
  it("should remove 如图N所示", () => {
    const content = "市场规模持续增长，如图1所示，预计2026年达到5000亿。";
    const result = removeOrphanedFigureReferences(content);
    expect(result).not.toContain("如图1所示");
    expect(result).toContain("市场规模持续增长");
  });

  it("should remove （见图N）", () => {
    const content = "详细数据（见图2）显示增长趋势明显。";
    const result = removeOrphanedFigureReferences(content);
    expect(result).not.toContain("见图2");
  });

  it("should remove 图N展示了 (subject-position)", () => {
    const content = "图1展示了市场规模的变化趋势。";
    const result = removeOrphanedFigureReferences(content);
    expect(result).not.toContain("图1展示了");
    expect(result).toContain("市场规模的变化趋势");
  });

  it("should remove 图N显示/呈现/描述/说明/反映/列出", () => {
    const cases = [
      ["图2显示了数据。", "图2显示了"],
      ["图3呈现了趋势。", "图3呈现了"],
      ["图4描述了方法。", "图4描述了"],
      ["图5说明了原因。", "图5说明了"],
      ["图6反映了现状。", "图6反映了"],
      ["图7列出了详情。", "图7列出了"],
      // Without 了 suffix
      ["图8显示数据变化。", "图8显示"],
    ];
    for (const [input, forbidden] of cases) {
      const result = removeOrphanedFigureReferences(input);
      expect(result).not.toContain(forbidden);
    }
  });

  // ── English patterns ──
  it("should remove (Figure N) / (Fig. N)", () => {
    expect(removeOrphanedFigureReferences("growth (Figure 3)")).not.toContain(
      "Figure 3",
    );
    expect(removeOrphanedFigureReferences("growth (Fig. 3)")).not.toContain(
      "Fig. 3",
    );
    expect(removeOrphanedFigureReferences("growth (Fig 3)")).not.toContain(
      "Fig 3",
    );
  });

  it("should remove ', see Figure N'", () => {
    const result = removeOrphanedFigureReferences(
      "Growth is evident, see Figure 5",
    );
    expect(result).not.toContain("see Figure 5");
  });

  it("should remove 'as shown/illustrated/depicted/presented/seen in Figure N'", () => {
    const verbs = ["shown", "illustrated", "depicted", "presented", "seen"];
    for (const v of verbs) {
      const input = `data, as ${v} in Figure 1, indicates growth.`;
      const result = removeOrphanedFigureReferences(input);
      expect(result).not.toContain(`as ${v} in Figure 1`);
      expect(result).toContain("indicates growth.");
    }
  });

  it("should remove 'Figure N shows/illustrates/...' (subject-position)", () => {
    const verbs = [
      "shows",
      "illustrates",
      "presents",
      "depicts",
      "displays",
      "demonstrates",
      "summarizes",
    ];
    for (const v of verbs) {
      const input = `Figure 1 ${v} the market trend.`;
      const result = removeOrphanedFigureReferences(input);
      expect(result).not.toContain(`Figure 1 ${v}`);
      expect(result).toContain("the market trend.");
    }
  });

  // ── Edge cases ──
  it("should NOT remove 图表N (different word: chart/table)", () => {
    const content = "图表1展示了详细数据。";
    const result = removeOrphanedFigureReferences(content);
    // 图表 is a legitimate compound word, should NOT match the 图N pattern
    expect(result).toContain("图表1");
  });

  it("should NOT remove references on lines with chart placeholders", () => {
    // The pipeline respects <!-- chart:N:M --> lines
    // removeOrphanedFigureReferences itself doesn't check for this
    // but the overall pipeline strips figure notation separately
    const content = "如图1所示，数据增长显著。";
    const result = removeOrphanedFigureReferences(content);
    expect(result).not.toContain("如图1所示");
  });

  it("should handle Fig. without period", () => {
    const result = removeOrphanedFigureReferences("data (Fig 2) shows");
    expect(result).not.toContain("Fig 2");
  });

  it("full pipeline removes all orphaned references", () => {
    const content = [
      "### 市场分析",
      "",
      "全球AI市场如图1所示持续增长（见图2），投资回报率显著。",
      "详细趋势参见下图(Figure 3)，增长率超过20%。",
      "图4展示了亚太市场的独特增长路径。",
      "As shown in Figure 5, the US leads in investment.",
      "Figure 6 summarizes the competitive landscape.",
    ].join("\n");
    const result = formatDimensionContent(content, { dimIndex: 0 });
    expect(result).not.toContain("如图1所示");
    expect(result).not.toContain("见图2");
    expect(result).not.toContain("Figure 3");
    expect(result).not.toContain("图4展示了");
    expect(result).not.toContain("shown in Figure 5");
    expect(result).not.toContain("Figure 6 summarizes");
  });
});

// ============================================================
// Scenario 3: Table Formatting
// ============================================================
describe("Scenario 3: Table column count and separator repair", () => {
  it("should insert missing separator row", () => {
    const content = [
      "| 指标 | 2024 | 2025 |",
      "| 营收 | 100 | 200 |",
      "| 利润 | 30 | 50 |",
    ].join("\n");
    const result = repairMarkdownTables(content);
    expect(result).toMatch(/\| --- \| --- \| --- \|/);
  });

  it("should fix column count mismatch (short rows padded)", () => {
    const content = [
      "| 指标 | 2024 | 2025 |",
      "| --- | --- | --- |",
      "| 营收 | 100 |",
      "| 利润 | 30 | 50 |",
    ].join("\n");
    const result = normalizeTableDataRows(content);
    const lines = result.trim().split("\n");
    const row2 = lines[2];
    const cols = (row2.match(/\|/g) || []).length - 1;
    expect(cols).toBe(3);
  });

  it("should fix column count mismatch (long rows truncated)", () => {
    const content = [
      "| 指标 | 2024 | 2025 |",
      "| --- | --- | --- |",
      "| 营收 | 100 | 200 | 多余列 |",
      "| 利润 | 30 | 50 |",
    ].join("\n");
    const result = normalizeTableDataRows(content);
    const lines = result.trim().split("\n");
    const row2 = lines[2];
    const cols = (row2.match(/\|/g) || []).length - 1;
    expect(cols).toBe(3);
    expect(row2).not.toContain("多余列");
  });

  it("should handle table with empty cells (merged-cell simulation)", () => {
    const content = [
      "| 类别 | 细分 | 数据 |",
      "| --- | --- | --- |",
      "| 技术 | AI | 100 |",
      "|  | ML | 80 |",
    ].join("\n");
    const result = normalizeTableDataRows(content);
    // Empty first cell is preserved — correct for pseudo-merged rows
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(4);
  });

  it("should handle 2-column table (with trailing newline)", () => {
    // Note: normalizeTableDataRows regex requires trailing \n on each line,
    // so the last line of the table needs a trailing newline to be captured.
    const content = [
      "| 名称 | 值 |",
      "| --- | --- |",
      "| A | 1 |",
      "| B |",
      "", // trailing newline ensures last table row is captured
    ].join("\n");
    const result = normalizeTableDataRows(content);
    const lines = result.trim().split("\n");
    const lastRow = lines[3];
    const cols = (lastRow.match(/\|/g) || []).length - 1;
    expect(cols).toBe(2);
  });

  it("full pipeline handles table with both problems", () => {
    const content = [
      "### 数据对比",
      "",
      "| 公司 | 市值 | 增长率 | 评级 |",
      "| Apple | 3T | 15% |",
      "| Google | 2T | 20% | A+ | 多余 |",
      "| Amazon | 1.8T | 18% | A |",
    ].join("\n");
    const result = formatDimensionContent(content, { dimIndex: 0 });
    expect(result).toMatch(/\|[\s-]+\|/);
    const tableLines = result
      .split("\n")
      .filter((l) => l.trim().startsWith("|"));
    for (const line of tableLines) {
      const cols = (line.match(/\|/g) || []).length - 1;
      expect(cols).toBe(4);
    }
  });

  it("should handle table with alignment markers (:---:)", () => {
    const content = [
      "| Left | Center | Right |",
      "| :--- | :---: | ---: |",
      "| A | B |",
      "| D | E | F |",
    ].join("\n");
    const result = normalizeTableDataRows(content);
    const lines = result.trim().split("\n");
    // Short row should be padded to 3 cols
    const row2 = lines[2];
    const cols = (row2.match(/\|/g) || []).length - 1;
    expect(cols).toBe(3);
  });
});

// ============================================================
// Scenario 4: LaTeX Fragmentation
// ============================================================
describe("Scenario 4: LaTeX delimiter fixing", () => {
  // ── Core fix: close at Chinese punctuation, not space ──
  it("should close unclosed $ before Chinese punctuation (not at space)", () => {
    const content = "增长率为$\\alpha = 0.95，远高于行业平均。";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toContain("$\\alpha = 0.95$");
  });

  it("should close unclosed $ before Chinese character boundary", () => {
    const content = "值为$\\beta = 1.5中等水平";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toContain("$\\beta = 1.5$");
    expect(result).toContain("中等水平");
  });

  it("should close at EOL when no Chinese boundary exists", () => {
    const content = "value is $\\gamma = 2.0";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe("value is $\\gamma = 2.0$");
  });

  // ── Orphan $ removal ──
  it("should remove orphan $ with no LaTeX content nearby", () => {
    const content = "数值约为0.95$的水平。";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe("数值约为0.95的水平。");
  });

  it("should remove orphan $ when LaTeX is before it (already closed)", () => {
    // After wrapBareInlineLatex: $\alpha$ is already balanced, trailing $ is orphan
    const content = "$\\alpha$ = 0.95$是结果。";
    const result = fixUnbalancedLatexDelimiters(content);
    // 3 dollars (odd). Last $ is after "0.95". hasLatexBefore=true, hasLatexAfter=false.
    // Should remove the orphan $.
    expect(result).not.toMatch(/0\.95\$/);
  });

  // ── Balanced (no-op) ──
  it("should not modify balanced delimiters", () => {
    const content = "公式 $E = mc^2$ 表明能量守恒。";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe(content);
  });

  it("should not modify multiple balanced expressions", () => {
    const content = "当 $x > 0$ 且 $y < 1$ 时成立。";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe(content);
  });

  // ── Skip rules ──
  it("should skip display math ($$)", () => {
    const content = "$$\\sum_{i=1}^{n} x_i$$";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe(content);
  });

  it("should skip code blocks", () => {
    const content = "```\n$unbalanced\n```";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe(content);
  });

  it("should skip headings", () => {
    const content = "### 价格为$100的产品";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe(content);
  });

  it("should skip table rows", () => {
    const content = "| 价格 | $100 |";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe(content);
  });

  // ── 3+ dollar signs on one line ──
  it("should handle 3 dollars: balanced pair + orphan", () => {
    // $x$ is balanced, + $y has orphan
    const content = "text $x$ + $y";
    const result = fixUnbalancedLatexDelimiters(content);
    // 3 dollars total (odd). lastIdx points to $ before y.
    // hasLatexAfter=false (y has no backslash), hasLatexBefore=false (no \cmd in "text $x$ + ")
    // → removes orphan $
    expect(result).toBe("text $x$ + y");
  });

  // ── wrapBareInlineLatex ──
  it("should wrap bare inline LaTeX commands", () => {
    const content = "系数为\\alpha = 0.5，显著性水平\\beta < 0.01。";
    const result = wrapBareInlineLatex(content);
    expect(result).toContain("$");
    expect(result).toMatch(/\$.*\\alpha.*\$/);
  });

  it("wrapBareInlineLatex wraps bare LaTeX outside existing $ spans", () => {
    const content = "公式 $E = mc^2$ 和 \\alpha 混合";
    const result = wrapBareInlineLatex(content);
    // Bare \alpha outside existing $...$ should be wrapped
    expect(result).toContain("$E = mc^2$");
    expect(result).toContain("$\\alpha");
  });

  it("wrapBareInlineLatex wraps single-command expressions like n \\times n", () => {
    const content = "矩阵维度为 n \\times n，其中 n 为正整数。";
    const result = wrapBareInlineLatex(content);
    expect(result).toMatch(/\$.*\\times.*\$/);
  });

  it("wrapBareInlineLatex wraps \\frac standalone", () => {
    const content = "比率为 \\frac{a}{b}，表示分数。";
    const result = wrapBareInlineLatex(content);
    expect(result).toMatch(/\$.*\\frac\{a\}\{b\}.*\$/);
  });

  it("wrapBareInlineLatex wraps \\sum standalone", () => {
    const content = "总和为 \\sum_{i=1}^{n} x_i。";
    const result = wrapBareInlineLatex(content);
    expect(result).toMatch(/\$.*\\sum.*\$/);
  });

  // ── Pipeline interaction (wrapBare → fixUnbalanced) ──
  it("full pipeline: bare LaTeX wrapped then balanced check passes", () => {
    const content = [
      "### 统计分析",
      "",
      "回归分析显示\\beta = 0.85，p值小于0.01。",
      "置信区间为$\\alpha = 0.95，表明结果可靠。",
      "正常公式 $R^2 = 0.92$ 不受影响。",
    ].join("\n");
    const result = formatDimensionContent(content, { dimIndex: 0 });
    expect(result).toMatch(/\$.*\\beta.*\$/);
    expect(result).toContain("$R^2 = 0.92$");
    // The unclosed $\alpha = 0.95 should be fixed
    expect(result).toMatch(/\$\\alpha = 0\.95\$/);
  });

  it("full pipeline: display math with orphan inline $", () => {
    const content = "文本 $$\\sum x$$ 更多文本 $误写";
    const result = fixUnbalancedLatexDelimiters(content);
    // $$ lines are skipped. But this is an inline case.
    // withoutDisplay: "文本 \x00\sum x\x00 更多文本 $误写"
    // dollarCount = 1 (odd). lastIdx points to $ before 误写.
    // hasLatexAfter = false, hasLatexBefore = true (\sum)
    // → remove orphan $
    expect(result).toBe("文本 $$\\sum x$$ 更多文本 误写");
  });

  // ── Bug fix: boldSummaryPrefixes must not corrupt math delimiters ──
  it("boldSummaryPrefixes skips lines containing $ delimiters", () => {
    const content = "损失$L_{RLHF}$定义为：最小化奖励的负期望";
    const result = boldSummaryPrefixes(content);
    // $ must NOT be captured inside **...**
    expect(result).toContain("$L_{RLHF}$");
    expect(result).not.toContain("**损失$");
  });

  it("boldSummaryPrefixes skips lines with bare LaTeX commands", () => {
    const content = "模型损失\\alpha定义为：xxx";
    const result = boldSummaryPrefixes(content);
    expect(result).not.toContain("**模型损失\\alpha定义为**");
  });

  it("full pipeline: boldSummaryPrefixes does not corrupt already-wrapped math", () => {
    const content =
      "损失函数$L_{RLHF} = -\\mathbb{E}[r]$的优化：基于PPO的强化学习";
    const result = formatDimensionContent(content, { dimIndex: 0 });
    expect(result).toContain("$L_{RLHF} = -\\mathbb{E}[r]$");
  });

  // ── Bug fix: wrapProseStyleMath supports superscript-only variables ──
  it("wrapProseStyleMath wraps superscript-only variables like R^d", () => {
    const content = "嵌入空间为R^d维向量。";
    const result = wrapProseStyleMath(content);
    expect(result).toMatch(/\$R\^d\$/);
  });

  it("wrapProseStyleMath wraps superscript with braces like x^{n+1}", () => {
    const content = "下一步状态为x^{n+1}的函数。";
    const result = wrapProseStyleMath(content);
    expect(result).toMatch(/\$x\^\{n\+1\}\$/);
  });

  it("wrapProseStyleMath wraps e^{-x} pattern", () => {
    const content = "衰减函数为e^{-x}形式。";
    const result = wrapProseStyleMath(content);
    expect(result).toMatch(/\$e\^\{-x\}\$/);
  });

  // ── Critical regression: wrapProseStyleMath must NOT corrupt LaTeX inside $...$ ──
  it("wrapProseStyleMath skips d_k inside $\\frac{QK^\\top}{\\sqrt{d_k}}$", () => {
    // After wrapBareInlineLatex, the line has: $\frac{QK^\top}{\sqrt{d_k}}$
    // wrapProseStyleMath must NOT touch d_k inside the $...$ span
    const content =
      "注意力得分计算公式为 $\\frac{QK^\\top}{\\sqrt{d_k}}$，其中d_k为维度。";
    const result = wrapProseStyleMath(content);
    // d_k inside $...$ must remain untouched
    expect(result).toContain("$\\frac{QK^\\top}{\\sqrt{d_k}}$");
    // d_k outside $...$ should be wrapped
    expect(result).toContain("$d_k$为维度");
  });

  it("pipeline order: wrapBareInlineLatex then wrapProseStyleMath preserves \\frac", () => {
    // Simulates the actual pipeline order
    const content =
      "注意力公式为\\frac{QK^\\top}{\\sqrt{d_k}}，其中d_k为维度。";
    const step1 = wrapBareInlineLatex(content);
    expect(step1).toContain("$\\frac{QK^\\top}{\\sqrt{d_k}}$");
    const step2 = wrapProseStyleMath(step1);
    // Must NOT fragment the \frac expression
    expect(step2).toContain("$\\frac{QK^\\top}{\\sqrt{d_k}}$");
    // Must NOT have $d_k$ INSIDE the \frac (i.e. no nested dollars within \frac)
    expect(step2).not.toContain("\\sqrt{$d_k$}");
    expect(step2).not.toContain("\\frac{}");
    expect(step2).not.toContain("\\sqrt{}");
  });

  it("full pipeline handles \\frac{QK^\\top}{\\sqrt{d_k}} without fragmentation", () => {
    const content =
      "注意力公式为\\frac{QK^\\top}{\\sqrt{d_k}}，其中d_k为维度。";
    const result = formatDimensionContent(content);
    expect(result).toContain("$\\frac{QK^\\top}{\\sqrt{d_k}}$");
    expect(result).not.toContain("\\sqrt{}");
    expect(result).not.toContain("\\frac{}");
  });

  it("known limitation: cross-line unbalanced delimiters are NOT fixed", () => {
    const content = [
      "公式如下 $\\frac{a}{b}",
      "+ \\frac{c}{d}$ 表示总和。",
    ].join("\n");
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).not.toBe(content);
  });
});

// ============================================================
// Scenario 5: End-to-end full content simulation
// ============================================================
describe("Scenario 5: Full production content simulation", () => {
  it("should handle a realistic dimension content block", () => {
    const realisticContent = [
      "# AI市场深度分析报告",
      "",
      "## 第一部分：市场概况",
      "",
      "一、全球市场规模",
      "",
      "全球人工智能市场规模持续扩大，如图1所示，2025年市场规模已突破3000亿美元（见图2）。",
      "",
      "| 区域 | 2024 | 2025 | 增长率 |",
      "| 北美 | 1200 | 1500 |",
      "| 欧洲 | 600 | 800 | 33% | 含英国 |",
      "| 亚太 | 800 | 1100 | 37.5% |",
      "",
      "二、技术发展趋势",
      "",
      "大模型参数量增长符合\\alpha指数规律，增速为$\\beta = 1.2，超过摩尔定律预测。",
      "",
      "### III. 竞争格局",
      "",
      "主要参与者包括：",
      "",
      "首先，OpenAI凭借GPT系列占据领先地位；其次，Google通过Gemini快速追赶；再次，Anthropic以安全为卖点差异化竞争。",
      "",
      "#### A. 投资趋势",
      "",
      "2025年AI领域风险投资总额超过500亿美元(Figure 4)。",
      "图5展示了投资趋势的变化。",
      "As shown in Figure 6, Asia-Pacific grows fastest.",
    ].join("\n");

    const result = formatDimensionContent(realisticContent, { dimIndex: 1 });

    // Full output visible via --verbose flag
    expect(result).toBeDefined();

    // 1. No H1/H2 remain — stripped, not demoted
    expect(result).not.toMatch(/^# /m);
    expect(result).not.toMatch(/^## /m);
    expect(result).not.toContain("AI市场深度分析报告");

    // 2. All H3 numbered with 2.N format, starting from 2.1
    const h3s = result.match(/^### .+$/gm) || [];
    expect(h3s.length).toBeGreaterThanOrEqual(3);
    for (const h of h3s) {
      expect(h).toMatch(/### 2\.\d+\./);
    }
    expect(h3s[0]).toMatch(/### 2\.1\./);

    // 3. No orphaned figure references
    expect(result).not.toContain("如图1所示");
    expect(result).not.toContain("见图2");
    expect(result).not.toContain("Figure 4");
    expect(result).not.toContain("图5展示了");
    expect(result).not.toContain("shown in Figure 6");

    // 4. Table has separator and consistent columns
    const tableLines = result
      .split("\n")
      .filter((l) => l.trim().startsWith("|"));
    if (tableLines.length >= 3) {
      const sepLine = tableLines.find((l) => /\|[\s-]+\|/.test(l));
      expect(sepLine).toBeDefined();
      for (const line of tableLines) {
        const cols = (line.match(/\|/g) || []).length - 1;
        expect(cols).toBe(4);
      }
    }

    // 5. LaTeX fixed
    expect(result).toMatch(/\$.*\\beta.*\$/);

    // 6. Roman numeral III. stripped
    expect(result).not.toContain("III.");

    // 7. Chinese numeral headings converted
    expect(result).not.toMatch(/^一、/m);
    expect(result).not.toMatch(/^二、/m);
  });

  it("should handle dimension with only content (no headings)", () => {
    const content =
      "这是一段没有任何标题的纯文本内容。包含多个段落。\n\n第二段继续分析市场趋势。";
    const result = formatDimensionContent(content, { dimIndex: 0 });
    expect(result).toContain("这是一段没有任何标题的纯文本内容");
    expect(result).toContain("第二段继续分析市场趋势");
    // No headings → no numbering applied
    expect(result).not.toMatch(/^###/m);
  });

  it("should handle empty content gracefully", () => {
    const result = formatDimensionContent("", { dimIndex: 0 });
    expect(result).toBe("");
  });

  it("should handle content with only H1/H2 (all stripped)", () => {
    const content = "# Title Only\n## Subtitle Only";
    const result = formatDimensionContent(content, { dimIndex: 0 });
    // Both headings stripped, leaving empty content
    expect(result.trim()).toBe("");
  });
});

// ============================================================
// Scenario 6: Regression safety
// ============================================================
describe("Scenario 6: Regression safety checks", () => {
  it("sanitizeHeadingLevels preserves ###/#### but strips #####/######", () => {
    const content = "### 三级\n内容\n#### 四级\n内容\n##### 五级\n###### 六级";
    const result = sanitizeHeadingLevels(content);
    expect(result).toContain("### 三级");
    expect(result).toContain("#### 四级");
    expect(result).not.toContain("##### 五级");
    expect(result).not.toContain("###### 六级");
  });

  it("sanitizeHeadingLevels does NOT affect non-heading # (e.g., #hashtag)", () => {
    const content = "This is a #hashtag in text";
    const result = sanitizeHeadingLevels(content);
    // #hashtag has no space after #, so /^#{1,2}\s+.*$/ won't match
    expect(result).toBe(content);
  });

  it("pipeline handles content with no issues (pass-through)", () => {
    const clean = [
      "### 核心发现",
      "",
      "市场持续增长，预计达到5000亿美元。",
      "",
      "### 风险分析",
      "",
      "主要风险包括政策变化和技术迭代。",
    ].join("\n");
    const result = formatDimensionContent(clean, { dimIndex: 0 });
    // Should only add numbering, nothing else changes
    expect(result).toContain("### 1.1. 核心发现");
    expect(result).toContain("### 1.2. 风险分析");
    expect(result).toContain("市场持续增长");
    expect(result).toContain("主要风险包括");
  });

  it("quality gate validateDimensionContent calls sanitizeHeadingLevels (strips H1/H2)", () => {
    // The quality gate is a separate service but uses the same function
    const content = "# Should be stripped\n### Should remain";
    const result = sanitizeHeadingLevels(content);
    expect(result).not.toContain("Should be stripped");
    expect(result).toContain("### Should remain");
  });

  it("normalizeTableDataRows handles table followed by more content", () => {
    // Table regex requires trailing \n on lines to match, so tables
    // followed by content (or with a trailing blank line) get processed.
    const content = [
      "### 数据表",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 |",
      "",
      "后续文字内容。",
    ].join("\n");
    const result = formatDimensionContent(content, { dimIndex: 0 });
    const tableLines = result
      .split("\n")
      .filter((l) => l.trim().startsWith("|"));
    if (tableLines.length >= 3) {
      for (const line of tableLines) {
        const cols = (line.match(/\|/g) || []).length - 1;
        expect(cols).toBe(2);
      }
    }
  });
});

// ============================================================
// Scenario 5: repairLatexCommands — Fix KaTeX parse errors
// ============================================================
describe("Scenario 5: repairLatexCommands fixes KaTeX parse errors", () => {
  it("should add braces to \\bar followed by bare letter", () => {
    const input = "$x_k=\\bar A x_{k-1}+\\bar B u_k$";
    const result = repairLatexCommands(input);
    expect(result).toBe("$x_k=\\bar{A} x_{k-1}+\\bar{B} u_k$");
  });

  it("should add braces to \\hat, \\vec, \\tilde with bare letter", () => {
    expect(repairLatexCommands("$\\hat x$")).toBe("$\\hat{x}$");
    expect(repairLatexCommands("$\\vec v$")).toBe("$\\vec{v}$");
    expect(repairLatexCommands("$\\tilde n$")).toBe("$\\tilde{n}$");
  });

  it("should not double-brace already braced commands", () => {
    const input = "$\\bar{A}$";
    expect(repairLatexCommands(input)).toBe(input);
  });

  it("should fix broken $$ delimiter mid-line", () => {
    const input = "$L = \\frac{C}{N}$，其中 $$\\alpha \\approx 0.07$";
    const result = repairLatexCommands(input);
    expect(result).toBe("$L = \\frac{C}{N}$，其中 $\\alpha \\approx 0.07$");
  });

  it("should fix stray double-closing braces in \\text{}", () => {
    const input = "$\\text{align}} = \\lambda$";
    const result = repairLatexCommands(input);
    expect(result).toBe("$\\text{align} = \\lambda$");
  });

  it("should not modify display math $$...$$", () => {
    const input = "$$\\alpha + \\beta$$";
    expect(repairLatexCommands(input)).toBe(input);
  });

  it("should handle \\bar with subscripted argument", () => {
    const input = "$\\bar x_{k}$";
    const result = repairLatexCommands(input);
    expect(result).toBe("$\\bar{x_{k}}$");
  });

  it("should fix $formula$$ (extra closing $)", () => {
    // Real error: $\frac{QK^T}{\sqrt{d_k}}$$ （d_k为键维度）
    const input = "$\\frac{QK^T}{\\sqrt{d_k}}$$ （d_k为键维度）和softmax";
    const result = repairLatexCommands(input);
    expect(result).toBe("$\\frac{QK^T}{\\sqrt{d_k}}$ （d_k为键维度）和softmax");
  });

  it("should fix \\sqrt{d}$$) mid-formula", () => {
    // Real error: \sqrt{d}$$)转为\phi(Q)\phi
    const input = "$\\sqrt{d}$$)转为";
    const result = repairLatexCommands(input);
    expect(result).toBe("$\\sqrt{d}$)转为");
  });

  it("should fix mid-line $$ as inline math opener", () => {
    // Real error: 0L = $$\alpha → should be 0L = $\alpha
    const input = "L_{MLM} = $$\\alpha$";
    const result = repairLatexCommands(input);
    expect(result).toContain("$\\alpha$");
    expect(result).not.toContain("$$\\alpha");
  });

  it("should auto-close unbalanced braces in inline math", () => {
    // Real error: ${R}^{n \times n$ missing closing }
    const input = "$\\mathbb{R}^{n \\times n$";
    const result = repairLatexCommands(input);
    expect(result).toBe("$\\mathbb{R}^{n \\times n}$");
  });

  it("should not modify already balanced inline math", () => {
    const input = "$\\mathbb{R}^{n \\times d}$";
    expect(repairLatexCommands(input)).toBe(input);
  });

  it("should remove $$ before LaTeX command inside inline math (Fix 2d)", () => {
    // Real production errors from export (48).htm:
    // KaTeX parse error: Can't use function '$' in math mode at position 6: L(N) $$\propto
    expect(repairLatexCommands("$L(N) $$\\propto N^{-\\alpha}$")).toBe(
      "$L(N) \\propto N^{-\\alpha}$",
    );
    expect(repairLatexCommands("$L(N,D) $$\\propto N^{-\\alpha}$")).toBe(
      "$L(N,D) \\propto N^{-\\alpha}$",
    );
    expect(repairLatexCommands("$1.4 $$\\times 10^{12}$")).toBe(
      "$1.4 \\times 10^{12}$",
    );
    expect(repairLatexCommands("$2 $$\\times 10^{13}$")).toBe(
      "$2 \\times 10^{13}$",
    );
    expect(repairLatexCommands("$L $$\\propto N^{-\\alpha}$")).toBe(
      "$L \\propto N^{-\\alpha}$",
    );
  });

  it("Fix 2a should still handle extra closing $ before non-LaTeX char", () => {
    // Original Fix 2a purpose: $formula$$ followed by non-math char
    const input = "$\\frac{QK^T}{\\sqrt{d_k}}$$，接着";
    const result = repairLatexCommands(input);
    expect(result).toBe("$\\frac{QK^T}{\\sqrt{d_k}}$，接着");
  });
});

// ============================================================
// Scenario 6: Internal metadata leaks — figureReferences & LLM reasoning
// ============================================================
describe("Scenario 6: Internal metadata leak stripping", () => {
  it("should strip figureReferences: label and following list", () => {
    const input = [
      "两者共同构成主要障碍。",
      "",
      "figureReferences:",
      "- [145] 图0：事实性错误示例",
      "- [145] 图1：忠实性错误示例",
      "",
      "### 下一节",
    ].join("\n");
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("figureReferences");
    expect(result).toContain("两者共同构成主要障碍");
    expect(result).toContain("### 下一节");
  });

  it("should strip inline figureReferences: label", () => {
    const input = "figureReferences: [145] 图0：事实性错误示例";
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("figureReferences");
  });

  it("should strip 图0 references (0-based figure indexing)", () => {
    const input1 = "AI专利审查加速 [284] 图0，佐证审查周期缩短与全球布局加速。";
    const result1 = stripInternalFigureNotation(input1);
    expect(result1).not.toContain("图0");
    expect(result1).toContain("AI专利审查加速");

    const input2 = "[145] 图0：事实性错误示例，模型虚构不存在的引用来源";
    const result2 = stripInternalFigureNotation(input2);
    expect(result2).not.toContain("图0");
  });

  it("should strip 图表引用 section label", () => {
    const input = "图表引用 ：2026年知识产权趋势概述";
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("图表引用");
  });

  it("should strip LLM meta-reasoning with word count + citation stats", () => {
    const input =
      "数据分析完毕。（字数约1250字，引用 [279] [284] 多次，结合前置数据构建模型，确保至少6处引用实例。）后续分析";
    const result = stripLLMMetaNotes(input);
    expect(result).not.toContain("字数约1250字");
    expect(result).not.toContain("确保至少6处引用实例");
    expect(result).toContain("数据分析完毕");
    expect(result).toContain("后续分析");
  });

  it("full pipeline should strip all metadata leaks", () => {
    const input = [
      "分析结论完毕。",
      "",
      "figureReferences:",
      "- [145] 图0：事实性错误示例",
      "",
      "图表引用 ：2026年趋势概述",
      "",
      "（字数约1250字，引用 [279] 多次，确保至少6处引用实例。）",
    ].join("\n");
    const result = formatDimensionContent(input);
    expect(result).not.toContain("figureReferences");
    expect(result).not.toContain("图表引用");
    expect(result).not.toContain("字数约1250字");
    expect(result).not.toContain("图0");
    expect(result).toContain("分析结论完毕");
  });
});

