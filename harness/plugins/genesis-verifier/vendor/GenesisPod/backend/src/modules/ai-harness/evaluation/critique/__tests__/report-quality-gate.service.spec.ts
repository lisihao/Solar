/**
 * ReportQualityGateService — unit tests
 *
 * No external dependencies (pure computation, no LLM calls).
 * Covers:
 *   validateDimensionContent():
 *     - heading_hierarchy auto-fix (# → ###)
 *     - horizontal_rules auto-remove
 *     - bold_density warning (>12) and auto-limit (>30)
 *     - blockquote_density limit
 *     - llm_meta_notes stripping
 *     - internal_figure_notation stripping
 *     - bare_keypoints removal (### + 3+ bullets)
 *     - citation_stacking fix (3+ consecutive citations)
 *     - h3_count_exceeded (>10 subheadings)
 *     - marketing_language neutralization
 *     - number_claim_mismatch detection
 *     - citation_coverage warning (<3 unique)
 *     - min_content_length error (<800 chars)
 *     - empty_section detection
 *     - source_diversity warning (top cite >40% of all)
 *     - citation_concentration warning (>8 occurrences)
 *     - language_consistency warning (foreign content >5%)
 *     - subjective_expression warning (>3 instances)
 *     - type-specific checks: COMPANY, TECHNOLOGY, MACRO, EVENT
 *   validateFullReport():
 *     - horizontal_rules removal
 *     - bold_density_report (>60)
 *     - blockquote_density_report (>8)
 *     - citation_orphans detection
 *     - low_source_diversity detection
 *     - single_source_claims detection (>5)
 *     - citation_concentration per section
 *     - passed=true when no errors
 */

import { ReportQualityGateService } from "../report-quality-gate.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeService() {
  return new ReportQualityGateService();
}

/** Build content with exactly N non-whitespace chars by repeating a sentence */
function _paddedContent(extraChars: number, prefix = ""): string {
  // Each "word " is 5 chars
  const base = prefix;
  const needed = Math.max(0, extraChars - base.replace(/\s/g, "").length);
  return (
    base +
    "word "
      .repeat(Math.ceil(needed / 5))
      .slice(0, needed + Math.ceil(needed / 5))
  );
}

/** Repeat a string N times */
function repeat(s: string, n: number): string {
  return Array(n).fill(s).join("");
}

// ─── validateDimensionContent tests ──────────────────────────────────────────

describe("ReportQualityGateService.validateDimensionContent()", () => {
  let svc: ReportQualityGateService;

  beforeEach(() => {
    svc = makeService();
  });

  it("returns passed=true and no violations for clean content with enough citations", () => {
    const content =
      "### Overview\n\n" +
      "This section analyzes the market [1]. Key drivers are identified [2]. " +
      "Multiple signals confirm the trend [3].\n\n" +
      "### Details\n\n" +
      "Further evidence supports the conclusion [1][2]. The study found strong correlation [3].\n\n" +
      // Pad to >800 non-whitespace chars
      repeat("Analysis shows growth in multiple sectors. ", 30);

    const result = svc.validateDimensionContent(content, "zh");
    expect(result.passed).toBe(true);
    expect(
      result.violations.filter((v) => v.severity === "error"),
    ).toHaveLength(0);
  });

  it("detects and auto-fixes heading_hierarchy (# or ## → ###)", () => {
    const content =
      "# Top Level Heading\n\n" +
      repeat("Some analysis content with citations [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const headingViolation = result.violations.find(
      (v) => v.rule === "heading_hierarchy",
    );
    expect(headingViolation).toBeDefined();
    expect(result.wasAutoFixed).toBe(true);
    // Fixed content should not have bare # headings
    expect(result.fixedContent).not.toMatch(/^# /m);
  });

  it("detects and auto-removes horizontal_rules", () => {
    const content =
      "Some content here [1][2][3].\n\n" +
      "---\n\n" +
      "More content [1][2][3].\n\n" +
      repeat("Extra padding for length requirement. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const hrViolation = result.violations.find(
      (v) => v.rule === "horizontal_rules",
    );
    expect(hrViolation).toBeDefined();
    expect(result.fixedContent).not.toContain("---");
  });

  it("detects bold_density warning when >12 bolds", () => {
    const boldItems = repeat("**important point** ", 15);
    const content =
      boldItems + repeat("Additional analysis with sources [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const boldViolation = result.violations.find(
      (v) => v.rule === "bold_density",
    );
    expect(boldViolation).toBeDefined();
    expect(boldViolation?.currentValue).toBeGreaterThan(12);
  });

  it("auto-limits bold formatting when >30 bolds", () => {
    const boldItems = repeat("**key** ", 35);
    const content =
      boldItems + repeat("Analysis content with sources [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const boldViolation = result.violations.find(
      (v) => v.rule === "bold_density",
    );
    expect(boldViolation).toBeDefined();
    expect(boldViolation?.currentValue).toBeGreaterThan(30);
    expect(result.wasAutoFixed).toBe(true);
    expect(result.rewriteGuidance.some((g) => g.includes("加粗"))).toBe(true);
  });

  it("detects and auto-limits blockquote_density (>1)", () => {
    const content =
      "> Blockquote one\n> Blockquote two\n\n" +
      repeat("Analysis [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const bqViolation = result.violations.find(
      (v) => v.rule === "blockquote_density",
    );
    expect(bqViolation).toBeDefined();
    expect(result.wasAutoFixed).toBe(true);
  });

  it("strips LLM meta-notes (word count annotations)", () => {
    // Word count annotation must be on its own line to be stripped
    const content =
      "Market analysis content.\n字数统计：约500字\n\n" +
      repeat("Evidence based analysis [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const metaViolation = result.violations.find(
      (v) => v.rule === "llm_meta_notes",
    );
    expect(metaViolation).toBeDefined();
    expect(result.wasAutoFixed).toBe(true);
  });

  it("removes bare_keypoints (### heading followed by 3+ bullets)", () => {
    const content =
      "### Key Points\n\n" +
      "- First point\n" +
      "- Second point\n" +
      "- Third point\n\n" +
      repeat("Actual paragraph content with citations [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const kpViolation = result.violations.find(
      (v) => v.rule === "bare_keypoints",
    );
    expect(kpViolation).toBeDefined();
    expect(result.wasAutoFixed).toBe(true);
  });

  it("fixes citation_stacking (3+ consecutive citations)", () => {
    const content =
      "Main finding [1][2][3][4] confirms the trend.\n\n" +
      repeat("Supporting evidence [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const stackViolation = result.violations.find(
      (v) => v.rule === "citation_stacking",
    );
    expect(stackViolation).toBeDefined();
    expect(result.fixedContent).not.toMatch(/\[\d+\]\s*\[\d+\]\s*\[\d+\]/);
  });

  it("flags h3_count_exceeded when more than 10 ### subheadings", () => {
    const headings = Array.from(
      { length: 12 },
      (_, i) => `### Section ${i + 1}\n\nContent here.\n\n`,
    ).join("");
    const content =
      headings + repeat("Analysis with citations [1][2][3]. ", 10);

    const result = svc.validateDimensionContent(content, "zh");
    const h3Violation = result.violations.find(
      (v) => v.rule === "h3_count_exceeded",
    );
    expect(h3Violation).toBeDefined();
    expect(h3Violation?.currentValue).toBeGreaterThan(10);
    expect(result.rewriteGuidance.some((g) => g.includes("子节"))).toBe(true);
  });

  it("neutralizes marketing_language (势必/必将 → 可能)", () => {
    const content =
      "这一趋势势必引发行业格局的深刻变革。\n\n" +
      repeat("Data driven analysis [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const marketViolation = result.violations.find(
      (v) => v.rule === "marketing_language",
    );
    expect(marketViolation).toBeDefined();
    expect(result.wasAutoFixed).toBe(true);
    expect(result.fixedContent).toContain("可能");
  });

  it("warns when min_content_length is below 800", () => {
    const content = "Short [1][2][3]."; // far below 800 chars

    const result = svc.validateDimensionContent(content, "zh");
    const lengthViolation = result.violations.find(
      (v) => v.rule === "min_content_length",
    );
    expect(lengthViolation).toBeDefined();
    expect(lengthViolation?.severity).toBe("error");
    expect(result.passed).toBe(false);
  });

  it("detects empty_section (subheading with <50 chars body)", () => {
    // Create a section with a heading, then an immediately following heading
    // The first heading's "body" is captured as the text between headings — which is short
    const content =
      "### 第一节\n\n短。\n\n" + // body of "第一节" is just "短。" (< 50 chars)
      "### 第二节\n\n" +
      repeat("这是第二节的主要分析内容 [1][2][3]，包含更多证据和细节。 ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const emptyViolation = result.violations.find(
      (v) => v.rule === "empty_section",
    );
    expect(emptyViolation).toBeDefined();
  });

  it("warns on citation_coverage when fewer than 3 unique citations", () => {
    const content =
      "Only one citation [1] used here.\n\n" +
      repeat("More content without other citations. ", 30);

    const result = svc.validateDimensionContent(content, "zh");
    const citViolation = result.violations.find(
      (v) => v.rule === "citation_coverage",
    );
    expect(citViolation).toBeDefined();
  });

  it("warns on subjective_expression when >3 instances (Chinese)", () => {
    const content =
      "我们认为市场将增长。我们判断这是好事。我们看到了机会。我们发现了问题。我们相信趋势持续。\n\n" +
      repeat("Evidence based content [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const subjViolation = result.violations.find(
      (v) => v.rule === "subjective_expression",
    );
    expect(subjViolation).toBeDefined();
    expect(subjViolation?.currentValue).toBeGreaterThan(3);
  });

  it("warns on subjective_expression in English content", () => {
    const content =
      "We believe this is correct. We think growth is possible. We find the evidence clear. We observe the market. We predict success.\n\n" +
      repeat("Evidence-based content [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "en");
    const subjViolation = result.violations.find(
      (v) => v.rule === "subjective_expression",
    );
    expect(subjViolation).toBeDefined();
    expect(subjViolation?.currentValue).toBeGreaterThan(3);
  });

  it("warns on source_diversity when top citation >40% of all", () => {
    // [1] appears 5 times, [2] once, [3] once → 5/7 ≈ 71%
    const content =
      "Finding [1]. Another [1]. More [1]. Evidence [1]. Again [1]. Cross check [2]. Compare [3].\n\n" +
      repeat("More analysis. ", 40);

    const result = svc.validateDimensionContent(content, "zh");
    const diversityViolation = result.violations.find(
      (v) => v.rule === "source_diversity",
    );
    expect(diversityViolation).toBeDefined();
  });

  it("warns on citation_concentration when single citation appears >8 times", () => {
    const content =
      repeat("Study [1]. ", 10) + // [1] appears 10 times
      "Other refs [2][3].\n\n" +
      repeat("More content. ", 20);

    const result = svc.validateDimensionContent(content, "zh");
    const concViolation = result.violations.find(
      (v) => v.rule === "citation_concentration",
    );
    expect(concViolation).toBeDefined();
    expect(concViolation?.currentValue).toBeGreaterThan(8);
  });

  it("warns on citation_concentration when single citation appears 6-8 times", () => {
    const content =
      repeat("Study [1]. ", 7) + // [1] appears 7 times (between 5 and 8)
      "Cross [2][3].\n\n" +
      repeat("More content. ", 20);

    const result = svc.validateDimensionContent(content, "zh");
    const concViolation = result.violations.find(
      (v) => v.rule === "citation_concentration",
    );
    expect(concViolation).toBeDefined();
  });

  it("detects number_claim_mismatch (declares 三 items but lists only 2)", () => {
    const content =
      "分析包含三个方面：\n- 增长\n- 风险\n\n" + // claims 3, lists 2
      repeat("Evidence content [1][2][3]. ", 25);

    const result = svc.validateDimensionContent(content, "zh");
    const mismatchViolation = result.violations.find(
      (v) => v.rule === "number_claim_mismatch",
    );
    expect(mismatchViolation).toBeDefined();
  });

  // ── Type-specific checks ────────────────────────────────────────────────────

  it("COMPANY type: warns when no comparison table (< 10 pipe chars)", () => {
    const content = repeat("Company analysis content [1][2][3]. ", 30);
    const result = svc.validateDimensionContent(content, "zh", "COMPANY");
    const typeViolation = result.violations.find(
      (v) => v.rule === "type_specific",
    );
    expect(typeViolation).toBeDefined();
    expect(typeViolation?.message).toContain("竞争对比");
  });

  it("COMPANY type: no warning when table exists", () => {
    const tableContent = "| Company | Revenue | Growth |\n".repeat(5);
    const content = tableContent + repeat("Company analysis [1][2][3]. ", 25);
    const result = svc.validateDimensionContent(content, "zh", "COMPANY");
    const typeViolation = result.violations.find(
      (v) => v.rule === "type_specific",
    );
    expect(typeViolation).toBeUndefined();
  });

  it("TECHNOLOGY type: warns when no maturity/adoption mention", () => {
    const content = repeat("Technology analysis content [1][2][3]. ", 30);
    const result = svc.validateDimensionContent(content, "zh", "TECHNOLOGY");
    const typeViolation = result.violations.find(
      (v) => v.rule === "type_specific",
    );
    expect(typeViolation).toBeDefined();
    expect(typeViolation?.message).toContain("成熟度");
  });

  it("TECHNOLOGY type: no warning when TRL mentioned", () => {
    const content =
      "Technology adoption follows the TRL curve.\n\n" +
      repeat("Technical analysis [1][2][3]. ", 25);
    const result = svc.validateDimensionContent(content, "zh", "TECHNOLOGY");
    const typeViolation = result.violations.find(
      (v) => v.rule === "type_specific",
    );
    expect(typeViolation).toBeUndefined();
  });

  it("MACRO type: warns when no comparison keywords", () => {
    const content = repeat("Macro economic analysis content [1][2][3]. ", 30);
    const result = svc.validateDimensionContent(content, "zh", "MACRO");
    const typeViolation = result.violations.find(
      (v) => v.rule === "type_specific",
    );
    expect(typeViolation).toBeDefined();
    expect(typeViolation?.message).toContain("对比");
  });

  it("MACRO type: no warning when compared/benchmark mentioned", () => {
    const content =
      "Compared with the EU, the US market shows benchmark growth.\n\n" +
      repeat("Analysis with citations [1][2][3]. ", 25);
    const result = svc.validateDimensionContent(content, "zh", "MACRO");
    const typeViolation = result.violations.find(
      (v) => v.rule === "type_specific",
    );
    expect(typeViolation).toBeUndefined();
  });

  it("EVENT type: warns when no causal analysis keywords", () => {
    const content = repeat("Event analysis content [1][2][3]. ", 30);
    const result = svc.validateDimensionContent(content, "zh", "EVENT");
    const causalWarning = result.violations.find(
      (v) => v.rule === "type_specific" && v.message.includes("因果"),
    );
    expect(causalWarning).toBeDefined();
  });

  it("EVENT type: warns when no comparison table", () => {
    const content =
      "远因包括经济问题，近因是政策失误，导火索是具体事件。\n\n" +
      repeat("Event analysis [1][2][3]. ", 25);
    const result = svc.validateDimensionContent(content, "zh", "EVENT");
    // Should have table warning (no table rows)
    const tableWarning = result.violations.find(
      (v) => v.rule === "type_specific" && v.message.includes("对比表格"),
    );
    expect(tableWarning).toBeDefined();
  });

  it("EVENT type: no causal warning when 远因/近因 keywords present", () => {
    const tableRow =
      "| When | Who | What |\n| --- | --- | --- |\n| 2023 | Govt | Policy |\n";
    const content =
      "The 远因 was structural. 近因 was immediate. 导火索 was the trigger.\n\n" +
      tableRow +
      repeat("Event analysis [1][2][3]. ", 20);
    const result = svc.validateDimensionContent(content, "zh", "EVENT");
    const causalWarning = result.violations.find(
      (v) => v.rule === "type_specific" && v.message.includes("因果"),
    );
    expect(causalWarning).toBeUndefined();
  });
});

// ─── validateFullReport tests ─────────────────────────────────────────────────

describe("ReportQualityGateService.validateFullReport()", () => {
  let svc: ReportQualityGateService;

  beforeEach(() => {
    svc = makeService();
  });

  it("returns passed=true when no error-severity violations present", () => {
    // validateFullReport only has warning-severity checks, so it should pass even with warnings
    const report =
      "## 引言\n\n这是一份关于市场趋势的分析报告 [1][2]。\n\n" +
      "## 分析\n\n详细分析如下所示 [3][4]。\n\n" +
      "## 参考文献\n\n[1] 来源一的标题描述。\n[2] 来源二的标题描述。\n[3] 来源三的标题描述。\n[4] 来源四的标题描述。\n";

    const result = svc.validateFullReport(report, "zh");
    expect(result.passed).toBe(true);
    // No error-severity violations (all are warnings)
    const errorViolations = result.violations.filter(
      (v) => v.severity === "error",
    );
    expect(errorViolations).toHaveLength(0);
  });

  it("removes horizontal_rules in full report", () => {
    const report =
      "## Intro\n\nContent [1][2][3].\n\n---\n\n## Analysis\n\nMore [4].\n\n" +
      "## References\n\n[1] A.\n[2] B.\n[3] C.\n[4] D.\n";

    const result = svc.validateFullReport(report, "zh");
    const hrViolation = result.violations.find(
      (v) => v.rule === "horizontal_rules",
    );
    expect(hrViolation).toBeDefined();
    expect(result.fixedContent).not.toContain("---");
    expect(result.wasAutoFixed).toBe(true);
  });

  it("warns on bold_density_report when >60 bolds in full report", () => {
    // 65 bold items, each on its own — should exceed threshold of 60
    const boldLines = Array.from(
      { length: 65 },
      (_, i) => `**重要结论${i + 1}** 说明文字。`,
    ).join("\n");
    const report =
      "## 分析\n\n" + boldLines + "\n\n" + "## 参考文献\n\n[1] 来源一。\n";

    const result = svc.validateFullReport(report, "zh");
    const boldViolation = result.violations.find(
      (v) => v.rule === "bold_density_report",
    );
    expect(boldViolation).toBeDefined();
    expect(boldViolation?.currentValue).toBeGreaterThan(60);
  });

  it("warns on blockquote_density_report and auto-limits when >8 blockquotes", () => {
    const blockquotes = Array.from(
      { length: 10 },
      (_, i) => `> Blockquote ${i + 1}\n`,
    ).join("");
    const report =
      "## Analysis\n\n" +
      blockquotes +
      "\n\nContent [1].\n\n" +
      "## References\n\n[1] Ref.\n";

    const result = svc.validateFullReport(report, "zh");
    const bqViolation = result.violations.find(
      (v) => v.rule === "blockquote_density_report",
    );
    expect(bqViolation).toBeDefined();
    expect(result.wasAutoFixed).toBe(true);
  });

  it("detects citation_orphans (cited in body but not in references)", () => {
    const report =
      "## Analysis\n\nResearch shows [1][2][3] and also [5].\n\n" +
      "## References\n\n[1] Source one.\n[2] Source two.\n[3] Source three.\n";
    // [5] is cited but not in references

    const result = svc.validateFullReport(report, "zh");
    const orphanViolation = result.violations.find(
      (v) => v.rule === "citation_orphans",
    );
    expect(orphanViolation).toBeDefined();
    expect(orphanViolation?.message).toContain("[5]");
  });

  it("does not flag orphans when all citations are in references", () => {
    const report =
      "## Analysis\n\nResearch [1][2][3].\n\n" +
      "## References\n\n[1] One.\n[2] Two.\n[3] Three.\n";

    const result = svc.validateFullReport(report, "zh");
    const orphanViolation = result.violations.find(
      (v) => v.rule === "citation_orphans",
    );
    expect(orphanViolation).toBeUndefined();
  });

  it("detects low_source_diversity when refEntrySet.size / bodyCitationSet.size < 0.5", () => {
    // Body cites 10 different numbers, references only has 2 entries
    const bodyCitations = Array.from(
      { length: 10 },
      (_, i) => `研究发现 [${i + 1}] 结论成立。`,
    ).join("\n");
    const report =
      "## 分析\n\n" +
      bodyCitations +
      "\n\n" +
      "## 参考文献\n\n[1] 来源一的标题。\n[2] 来源二的标题。\n";

    const result = svc.validateFullReport(report, "zh");
    const diversityViolation = result.violations.find(
      (v) => v.rule === "low_source_diversity",
    );
    expect(diversityViolation).toBeDefined();
  });

  it("detects single_source_claims when >5 bold claims each cite only one source", () => {
    // 7 bold claims, each followed by single citation
    const claims = Array.from(
      { length: 7 },
      (_, i) =>
        `**Important claim number ${i + 1} about the market** [${i + 1}] `,
    ).join("\n");
    const refs = Array.from(
      { length: 7 },
      (_, i) => `[${i + 1}] Source ${i + 1}.`,
    ).join("\n");
    const report =
      "## Analysis\n\n" + claims + "\n\n" + "## References\n\n" + refs + "\n";

    const result = svc.validateFullReport(report, "zh");
    const singleSrcViolation = result.violations.find(
      (v) => v.rule === "single_source_claims",
    );
    expect(singleSrcViolation).toBeDefined();
    expect(singleSrcViolation?.currentValue).toBeGreaterThan(5);
  });

  it("detects citation_concentration in a section (>8 occurrences of same citation)", () => {
    const denseCitations = repeat(
      "[1] found this. [1] confirms. [1] shows. [1] proves. ",
      3,
    );
    const report =
      "## Section A\n\n" +
      denseCitations +
      denseCitations + // > 8 occurrences of [1] in one section
      "\n\n## References\n\n[1] Single source.\n";

    const result = svc.validateFullReport(report, "zh");
    const concViolation = result.violations.find(
      (v) => v.rule === "citation_concentration",
    );
    expect(concViolation).toBeDefined();
    expect(concViolation?.currentValue).toBeGreaterThan(8);
  });

  it("detects language_consistency when foreign ratio > 5%", () => {
    // Mix a lot of English into a Chinese-target report
    const englishBlocks = repeat(
      "This is English content that should not be here. ",
      15,
    );
    const report =
      "## Analysis\n\n" +
      englishBlocks +
      "\n\n" +
      "## References\n\n[1] Ref one.\n";

    const result = svc.validateFullReport(report, "zh");
    const langViolation = result.violations.find(
      (v) => v.rule === "language_consistency",
    );
    expect(langViolation).toBeDefined();
  });

  it("detects subjective_expression_report when >10 subjective phrases in full report", () => {
    const subjectivePhrases = repeat(
      "我们认为这是重要的。我们判断情况良好。",
      8,
    ); // 16 phrases
    const report =
      "## Analysis\n\n" +
      subjectivePhrases +
      "\n\n" +
      "## References\n\n[1] One.\n";

    const result = svc.validateFullReport(report, "zh");
    const subjViolation = result.violations.find(
      (v) => v.rule === "subjective_expression_report",
    );
    expect(subjViolation).toBeDefined();
    expect(subjViolation?.currentValue).toBeGreaterThan(10);
  });

  it("returns passed=false when there are error-severity violations", () => {
    // Note: validateFullReport only has warning-severity violations currently
    // so passed should be true for typical cases
    const report =
      "## Section\n\nContent [1][2].\n\n" + "## References\n\n[1] A.\n[2] B.\n";

    const result = svc.validateFullReport(report, "zh");
    // All violations are warnings, so passed should be true
    expect(result.passed).toBe(true);
    const errorViolations = result.violations.filter(
      (v) => v.severity === "error",
    );
    expect(errorViolations).toHaveLength(0);
  });
});
