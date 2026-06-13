/**
 * Formatting pipeline fix tests — 4 issues
 *
 * Covers the specific bugs fixed in report-formatting.util.ts:
 * 1. LaTeX wrapping for big-O notation and bare brace exponents
 * 2. Markdown table repair when separator row is missing
 * 3. Heading renumbering — duplicate and gap fixes, including #### before ###
 * 4. Inline numeric list splitting ("1. xxx 2. xxx 3. xxx")
 */

import {
  wrapBareInlineLatex,
  repairMarkdownTables,
  renumberHeadings,
  splitEnumerationToList,
} from "../../pipeline/report-formatting.util";

// ============================================================
// Issue 1: LaTeX — big-O notation and bare brace exponents
// ============================================================

describe("wrapBareInlineLatex — big-O complexity notation", () => {
  it("should wrap O(n log n) as inline math", () => {
    const input = "排序算法的时间复杂度为 O(n log n)，空间复杂度为 O(1)。";
    const result = wrapBareInlineLatex(input);
    // O(n \log n) should be wrapped in $...$
    expect(result).toMatch(/\$O\(n \\log n\)\$/);
  });

  it("should wrap O(n^2) as inline math", () => {
    const input = "朴素实现的时间复杂度为 O(n^2)。";
    const result = wrapBareInlineLatex(input);
    expect(result).toMatch(/\$O\(n\^2\)\$/);
  });

  it("should wrap O(1) as inline math", () => {
    const input = "哈希表查找的时间复杂度为 O(1)。";
    const result = wrapBareInlineLatex(input);
    expect(result).toMatch(/\$O\(1\)\$/);
  });

  it("should normalize log inside big-O to \\log", () => {
    const input = "最佳情况为 O(n log n)。";
    const result = wrapBareInlineLatex(input);
    // log should be normalized to \log inside the math span
    expect(result).toContain("\\log");
  });

  it("should not double-wrap already-wrapped big-O", () => {
    const input = "时间复杂度 $O(n \\log n)$ 已包裹。";
    const result = wrapBareInlineLatex(input);
    // No double wrapping: $$...$$ should not appear
    expect(result).not.toMatch(/\$\$O/);
    expect(result).toContain("$O(n \\log n)$");
  });

  it("should skip big-O inside headings", () => {
    const input = "### O(n log n) 排序算法";
    const result = wrapBareInlineLatex(input);
    // Headings are skipped
    expect(result).toBe(input);
  });

  it("should skip big-O inside table rows", () => {
    const input = "| 算法 | O(n log n) | O(n^2) |";
    const result = wrapBareInlineLatex(input);
    // Table rows are skipped
    expect(result).toBe(input);
  });
});

describe("wrapBareInlineLatex — bare brace exponents", () => {
  it("should wrap 10^{-3} as inline math", () => {
    const input = "灵敏度阈值为 10^{-3} 量级。";
    const result = wrapBareInlineLatex(input);
    expect(result).toMatch(/\$10\^\{-3\}\$/);
  });

  it("should wrap 2^{32} as inline math", () => {
    const input = "地址空间为 2^{32} 个字节。";
    const result = wrapBareInlineLatex(input);
    expect(result).toMatch(/\$2\^\{32\}\$/);
  });

  it("should not wrap when already inside math span", () => {
    const input = "公式 $2^{32}$ 已包裹。";
    const result = wrapBareInlineLatex(input);
    // No double wrapping
    expect(result).not.toMatch(/\$\$2/);
    expect(result).toContain("$2^{32}$");
  });
});

// ============================================================
// Issue 2: Tables — missing separator row
// ============================================================

describe("repairMarkdownTables — missing separator row", () => {
  it("should insert separator row when header and data rows have no separator", () => {
    const input = [
      "| 模型 | 参数量 | 准确率 |",
      "| GPT-4 | 1.76T | 87.5% |",
      "| Claude 3 | 未公开 | 86.8% |",
      "",
    ].join("\n");
    const result = repairMarkdownTables(input);
    // Should contain a separator row
    expect(result).toMatch(/\|\s*---/);
    // Should preserve all data
    expect(result).toContain("GPT-4");
    expect(result).toContain("Claude 3");
  });

  it("should not insert duplicate separator when separator already exists", () => {
    const input = [
      "| 模型 | 准确率 |",
      "| --- | --- |",
      "| GPT-4 | 87.5% |",
      "",
    ].join("\n");
    const result = repairMarkdownTables(input);
    // Should have exactly one separator row (a line that starts with |--- or | ---)
    const lines = result.split("\n");
    const sepLines = lines.filter((l) => /^\|[\s:]*-{2,}/.test(l.trim()));
    expect(sepLines.length).toBe(1);
  });

  it("should fix separator with wrong column count", () => {
    const input = [
      "| 模型 | 参数量 | 准确率 |",
      "| --- | --- |",
      "| GPT-4 | 1.76T | 87.5% |",
      "",
    ].join("\n");
    const result = repairMarkdownTables(input);
    // Separator should have 3 columns matching header
    const sepLine = result.split("\n").find((l) => /^\|.*---/.test(l));
    expect(sepLine).toBeDefined();
    const colCount = (sepLine!.match(/---/g) || []).length;
    expect(colCount).toBe(3);
  });

  it("should ensure blank line before table", () => {
    const input =
      "前置段落。\n| 模型 | 准确率 |\n| --- | --- |\n| GPT-4 | 87% |\n";
    const result = repairMarkdownTables(input);
    // Should have blank line before table
    expect(result).toMatch(/\n\n\|/);
  });
});

// ============================================================
// Issue 3: Heading numbering — renumberHeadings fixes
// ============================================================

describe("renumberHeadings — gap closure", () => {
  it("should close gap when 1.2 is removed (1.1, 1.3 → 1.1, 1.2)", () => {
    const input = [
      "## 1. 维度一",
      "",
      "### 1.1. 第一节",
      "内容A",
      "",
      "### 1.3. 第三节",
      "内容B",
    ].join("\n");

    const result = renumberHeadings(input);
    expect(result).toContain("### 1.1. 第一节");
    expect(result).toContain("### 1.2. 第三节");
    expect(result).not.toContain("1.3.");
  });

  it("should close large gap (2.1, 2.5 → 2.1, 2.2)", () => {
    const input = [
      "## 2. 维度二",
      "",
      "### 2.1. 第一节",
      "内容",
      "",
      "### 2.5. 第五节",
      "内容",
    ].join("\n");

    const result = renumberHeadings(input);
    expect(result).toContain("### 2.1. 第一节");
    expect(result).toContain("### 2.2. 第五节");
    expect(result).not.toContain("2.5.");
  });

  it("should not produce duplicate numbers (consecutive renumbering)", () => {
    const input = [
      "## 1. 维度一",
      "",
      "### 1.1. 节一",
      "内容",
      "",
      "### 1.2. 节二",
      "内容",
      "",
      "### 1.3. 节三",
      "内容",
    ].join("\n");

    const result = renumberHeadings(input);
    expect(result).toContain("### 1.1. 节一");
    expect(result).toContain("### 1.2. 节二");
    expect(result).toContain("### 1.3. 节三");
    // No duplicates
    const h3Lines = result.split("\n").filter((l) => l.startsWith("###"));
    const nums = h3Lines.map((l) => l.match(/###\s+(\d+\.\d+)\./)?.[1]);
    const unique = new Set(nums.filter(Boolean));
    expect(unique.size).toBe(nums.filter(Boolean).length);
  });
});

describe("renumberHeadings — #### before ### edge case", () => {
  it("should assign implicit h3Count=1 when #### appears before any ###", () => {
    const input = [
      "## 1. 维度一",
      "",
      "内容段落",
      "",
      "#### 1.1.1. 子节",
      "子内容",
    ].join("\n");

    const result = renumberHeadings(input);
    // Should not produce #### 1.0.1. (h3Count=0 bug)
    expect(result).not.toContain("1.0.");
    // Should produce valid #### with h3Count=1
    expect(result).toContain("#### 1.1.1. 子节");
  });

  it("should correctly number #### after ### headings", () => {
    const input = [
      "## 2. 维度二",
      "",
      "### 2.1. 父节",
      "内容",
      "",
      "#### 2.1.1. 子节一",
      "内容",
      "",
      "#### 2.1.2. 子节二",
      "内容",
    ].join("\n");

    const result = renumberHeadings(input);
    expect(result).toContain("### 2.1. 父节");
    expect(result).toContain("#### 2.1.1. 子节一");
    expect(result).toContain("#### 2.1.2. 子节二");
  });
});

// ============================================================
// Issue 4: Inline numeric lists
// ============================================================

describe("splitEnumerationToList — inline numeric list splitting", () => {
  it("should split '1. A 2. B 3. C' inline pattern into separate list items", () => {
    const input =
      "分析可以从以下角度展开：1. 技术可行性分析 2. 商业化路径 3. 竞争格局评估";
    const result = splitEnumerationToList(input);
    // Should be split into separate lines
    expect(result).toContain("1. 技术可行性分析");
    expect(result).toContain("2. 商业化路径");
    expect(result).toContain("3. 竞争格局评估");
    // Lead sentence should be preserved
    expect(result).toContain("分析可以从以下角度展开：");
    // Should not be on a single line anymore
    const lines = result.split("\n");
    const item1Line = lines.find((l) => l.includes("技术可行性分析"));
    const item2Line = lines.find((l) => l.includes("商业化路径"));
    expect(item1Line).not.toBe(item2Line);
  });

  it("should split English inline numeric list", () => {
    const input =
      "Key factors include: 1. Technical feasibility 2. Market readiness 3. Regulatory compliance";
    const result = splitEnumerationToList(input);
    expect(result).toContain("1. Technical feasibility");
    expect(result).toContain("2. Market readiness");
    expect(result).toContain("3. Regulatory compliance");
  });

  it("should not split when only one inline item", () => {
    const input = "主要考虑：1. 技术可行性分析。";
    const result = splitEnumerationToList(input);
    // Only one marker — should not split
    expect(result).toBe(input);
  });

  it("should not split properly-formatted list items already on separate lines", () => {
    const input = "- 第一项\n- 第二项\n- 第三项";
    const result = splitEnumerationToList(input);
    // Already formatted — should not change
    expect(result).toBe(input);
  });

  it("should not split headings", () => {
    const input = "### 1. 第一节 2. 第二节";
    const result = splitEnumerationToList(input);
    // Headings are skipped
    expect(result).toBe(input);
  });

  it("should not split when markers are non-consecutive", () => {
    // 1 then 3 (skips 2) — not a clean inline list
    // Use plain text that does not match Chinese enumeration markers
    const input =
      "Key insights: 1. Alpha scenario with details 3. Gamma scenario with details";
    const result = splitEnumerationToList(input);
    // Non-consecutive numbers (1, 3) — should not split
    expect(result).toBe(input);
  });
});
