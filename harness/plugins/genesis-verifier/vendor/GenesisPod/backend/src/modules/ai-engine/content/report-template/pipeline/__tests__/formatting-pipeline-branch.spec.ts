/**
 * dimension-content-formatting.util — supplemental branch coverage
 *
 * Targets:
 *  - formatDimensionContent optional context branches:
 *    - ctx.dimIndex provided → numberSubHeadings + renumberHeadings called
 *    - ctx.globalSeenParagraphs provided → deduplicateParagraphs called
 *    - ctx.maxDimensionChars + content too long → truncation + warning
 *    - ctx.resolveChartPlaceholders provided → called
 *    - !ctx.resolveChartPlaceholders → chart comments stripped
 *  - preprocessDimensionContent with and without dimIndex
 *  - Phase 0 helpers: stripHeadingSummaryBullets, convertOrdinalBulletsToText,
 *    fixLLMLatexCorruption
 */

import {
  formatDimensionContent,
  preprocessDimensionContent,
  stripHeadingSummaryBullets,
  convertOrdinalBulletsToText,
  fixLLMLatexCorruption,
  normalizeTableDataRows,
  removeOrphanedFigureReferences,
  fixUnbalancedLatexDelimiters,
} from "../dimension-content-formatting.util";

// ─────────────────────────────────────────────────────────────────
// formatDimensionContent — context branch coverage
// ─────────────────────────────────────────────────────────────────
describe("formatDimensionContent — context branches", () => {
  it("runs without any context (default empty ctx)", () => {
    const result = formatDimensionContent("### Heading\n\nContent here.");
    expect(typeof result).toBe("string");
  });

  it("calls numberSubHeadings + renumberHeadings when ctx.dimIndex is provided", () => {
    const content = "### Sub Heading\n\nParagraph content.";
    const result = formatDimensionContent(content, { dimIndex: 0 });
    // dimIndex=0 → dimIndex+1=1 → heading becomes ### 1.1.
    expect(result).toContain("### 1.1.");
  });

  it("skips heading numbering when ctx.dimIndex is not provided", () => {
    const content = "### Sub Heading\n\nParagraph content.";
    const result = formatDimensionContent(content);
    // No dimIndex → no numbering
    expect(result).not.toMatch(/###\s+\d+\.\d+\./);
  });

  it("calls deduplicateParagraphs when ctx.globalSeenParagraphs is provided", () => {
    const seen = new Set<string>();
    const longPara = "这是一段足够长的内容，用于测试全局段落去重。".repeat(5);
    const content = longPara + "\n\n" + longPara;
    const result = formatDimensionContent(content, {
      globalSeenParagraphs: seen,
    });
    // Second occurrence should be removed
    expect(result.trim()).not.toBe(content.trim());
  });

  it("truncates content when maxDimensionChars is exceeded", () => {
    const longContent = "A sentence here. ".repeat(500);
    const result = formatDimensionContent(longContent, {
      maxDimensionChars: 100,
    });
    expect(result.length).toBeLessThan(longContent.length);
  });

  it("calls logger.warn when truncation occurs", () => {
    const mockLogger = { warn: jest.fn() };
    const longContent = "Sentence with content. ".repeat(500);
    formatDimensionContent(longContent, {
      maxDimensionChars: 50,
      dimensionName: "TestDimension",
      logger: mockLogger,
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("TestDimension"),
    );
  });

  it("calls resolveChartPlaceholders when provided", () => {
    const resolver = jest.fn((s: string) =>
      s.replace("<!-- chart:x -->", "<chart/>"),
    );
    const content = "Text here. <!-- chart:x --> More text.";
    const result = formatDimensionContent(content, {
      resolveChartPlaceholders: resolver,
    });
    expect(resolver).toHaveBeenCalled();
    expect(result).toContain("<chart/>");
  });

  it("strips orphaned chart comments when no resolveChartPlaceholders provided", () => {
    const content = "Text. <!-- chart:d1-s1-1:2 --> More.";
    const result = formatDimensionContent(content);
    expect(result).not.toContain("<!-- chart:");
  });

  it("does NOT strip chart comments when resolveChartPlaceholders is provided", () => {
    const resolver = (s: string) => s; // identity — no-op
    const content = "Text. <!-- chart:d1-s1-1:2 --> More.";
    const result = formatDimensionContent(content, {
      resolveChartPlaceholders: resolver,
    });
    // resolver was called (identity), but the manual strip branch is skipped
    // The content may still contain the chart comment since resolver is identity
    expect(result).toContain("chart:d1-s1-1:2");
  });

  it("strips reference-style markdown image ![alt][ref]", () => {
    // The pipeline strips images with the pattern ![alt][ref] where neither part has a URL
    const content = "See ![figure description][figureref] for details.";
    const result = formatDimensionContent(content);
    // After pipeline, reference-style images should be removed
    expect(result).not.toContain("![figure description][figureref]");
  });

  it("handles enumeration markers: **第一，** → 第一，", () => {
    const content = "**第一，**这是第一点。";
    const result = formatDimensionContent(content);
    expect(result).toContain("第一，");
    expect(result).not.toContain("**第一，**");
  });

  it("handles verbose leading phrase: **这意味着，** → 这意味着，", () => {
    const content = "**这意味着，**后续需要深入分析。";
    const result = formatDimensionContent(content);
    expect(result).toContain("这意味着，");
    expect(result).not.toContain("**这意味着，**");
  });
});

// ─────────────────────────────────────────────────────────────────
// preprocessDimensionContent — legacy wrapper
// ─────────────────────────────────────────────────────────────────
describe("preprocessDimensionContent — legacy wrapper", () => {
  it("processes content with dimIndex", () => {
    const result = preprocessDimensionContent(
      "### Section Title\n\nSome content here.",
      2,
    );
    // dimIndex=2 → dimIndex+1=3 → ### 3.1.
    expect(result).toContain("3.1.");
  });

  it("processes content without dimIndex (no heading numbering)", () => {
    const result = preprocessDimensionContent(
      "### Section Title\n\nSome content here.",
    );
    expect(result).not.toMatch(/###\s+\d+\.\d+\./);
  });
});

// ─────────────────────────────────────────────────────────────────
// stripHeadingSummaryBullets
// ─────────────────────────────────────────────────────────────────
describe("stripHeadingSummaryBullets", () => {
  it("strips 2+ bullet summary lines immediately after a heading", () => {
    const content =
      "### 1.1. Heading Title\n\n- Summary point one。\n- Summary point two。\n\nActual content.";
    const result = stripHeadingSummaryBullets(content);
    expect(result).not.toContain("Summary point one");
    expect(result).toContain("Actual content.");
  });

  it("keeps single bullet (does not strip when < 2 bullets)", () => {
    const content = "### Heading\n\n- Only one bullet.\n\nContent.";
    const result = stripHeadingSummaryBullets(content);
    expect(result).toContain("Only one bullet");
  });

  it("leaves content unchanged when no heading+bullet pattern", () => {
    const content = "Plain paragraph without headings.";
    expect(stripHeadingSummaryBullets(content)).toBe(content);
  });
});

// ─────────────────────────────────────────────────────────────────
// convertOrdinalBulletsToText
// ─────────────────────────────────────────────────────────────────
describe("convertOrdinalBulletsToText", () => {
  it("converts 其一 bullet to plain text", () => {
    const content = "- 其一，这是第一点内容。";
    const result = convertOrdinalBulletsToText(content);
    expect(result).not.toMatch(/^-/);
    expect(result).toContain("其一");
  });

  it("converts 第二 bullet to plain text", () => {
    const content = "- 第二，这是第二点说明。";
    const result = convertOrdinalBulletsToText(content);
    expect(result).not.toMatch(/^-/);
    expect(result).toContain("第二");
  });

  it("converts 这意味着 bullet to plain text", () => {
    const content = "- 这意味着，后续需要关注。";
    const result = convertOrdinalBulletsToText(content);
    expect(result).not.toMatch(/^-/);
  });

  it("converts 换言之 bullet to plain text", () => {
    const content = "- 换言之，这里是解释。";
    const result = convertOrdinalBulletsToText(content);
    expect(result).not.toMatch(/^-/);
  });

  it("leaves regular bullet items unchanged", () => {
    const content = "- Regular bullet item without ordinal marker.";
    expect(convertOrdinalBulletsToText(content)).toBe(content);
  });

  it("handles bold-wrapped ordinal markers like - **其一**", () => {
    const content = "- **其一**，这是第一点内容。";
    const result = convertOrdinalBulletsToText(content);
    expect(result).not.toMatch(/^-/);
  });
});

// ─────────────────────────────────────────────────────────────────
// fixLLMLatexCorruption
// ─────────────────────────────────────────────────────────────────
describe("fixLLMLatexCorruption", () => {
  it("fixes escaped dollar before LaTeX commands", () => {
    const result = fixLLMLatexCorruption("$\\$arg\\max_x f(x)$");
    expect(result).toContain("\\arg\\max");
  });

  it("fixes triple dollar → display math", () => {
    const result = fixLLMLatexCorruption("$$$formula$$$");
    // $$$ → $$
    expect(result).not.toContain("$$$");
  });

  it("fixes $)$ → )$", () => {
    const result = fixLLMLatexCorruption("$(x+y$)$");
    expect(result).not.toContain("$)$");
  });

  it("leaves clean LaTeX unchanged", () => {
    const clean = "$x^2 + y^2 = z^2$";
    expect(fixLLMLatexCorruption(clean)).toBe(clean);
  });

  it("fixes fragmented inline math like $X$($Y$^*)", () => {
    // Pattern: $var$($other$^*) → $var(other^*)$
    const input = "$f$($x$^*)";
    const result = fixLLMLatexCorruption(input);
    // Should merge into a single $...$
    expect(result).not.toContain("$($");
  });
});

// ─────────────────────────────────────────────────────────────────
// removeHallucinatedImages — via formatDimensionContent
// (private fn; exercised through the pipeline)
// ─────────────────────────────────────────────────────────────────
describe("removeHallucinatedImages — via formatDimensionContent", () => {
  it("strips data: base64 images", () => {
    const content = "Text ![alt](data:image/png;base64,abc123) more text.";
    const result = formatDimensionContent(content);
    expect(result).not.toContain("data:image");
  });

  it("strips placeholder.com images", () => {
    const content = "Text ![alt](https://via.placeholder.com/800x400) more.";
    const result = formatDimensionContent(content);
    expect(result).not.toContain("placeholder.com");
  });

  it("strips example.com images", () => {
    const content = "Text ![alt](https://example.com/image.png) more.";
    const result = formatDimensionContent(content);
    expect(result).not.toContain("example.com");
  });

  it("strips image-not-found URLs", () => {
    const content = "See ![](https://cdn.x.com/image-not-found.png).";
    const result = formatDimensionContent(content);
    expect(result).not.toContain("image-not-found");
  });

  it("strips non-http relative paths", () => {
    const content = "See ![]( /local/path/img.png).";
    const result = formatDimensionContent(content);
    expect(result).not.toContain("/local/path");
  });

  it("strips URLs containing xxxx", () => {
    const content = "See ![](https://cdn.example.com/xxxxfake.png).";
    const result = formatDimensionContent(content);
    expect(result).not.toContain("xxxx");
  });

  it("strips PDF links used as images", () => {
    const content = "See ![Report](https://cdn.site.com/report.pdf).";
    const result = formatDimensionContent(content);
    expect(result).not.toContain(".pdf");
  });

  it("strips generic example image paths", () => {
    const content = "See ![](https://cdn.site.com/img/example-1.png).";
    const result = formatDimensionContent(content);
    expect(result).not.toContain("example-1");
  });

  it("preserves valid https image URLs", () => {
    const content = "See ![real image](https://cdn.nature.com/real-photo.jpg).";
    const result = formatDimensionContent(content);
    // Valid image should not be stripped (it passes all guards)
    expect(result).toContain("real-photo.jpg");
  });
});

// ─────────────────────────────────────────────────────────────────
// normalizeTableDataRows
// ─────────────────────────────────────────────────────────────────
describe("normalizeTableDataRows", () => {
  it("pads short rows to match separator column count", () => {
    const table =
      [
        "| Col1 | Col2 | Col3 |",
        "| --- | --- | --- |",
        "| A | B |",
        "| X | Y | Z |",
      ].join("\n") + "\n";
    const result = normalizeTableDataRows(table);
    // The short row `| A | B |` (2 cols) was padded to 3 cols
    // So the result should NOT equal the input (it was changed)
    expect(result).not.toBe(table);
    // And the result should contain a row with 4 pipe chars (3 cells = 4 pipes)
    const paddedLine = result
      .split("\n")
      .find((l) => l.includes("A") && l.includes("B"));
    expect(paddedLine).toBeDefined();
    const pipeCount = (paddedLine!.match(/\|/g) || []).length;
    expect(pipeCount).toBe(4); // | A | B |  | → 4 pipes, 3 cells
  });

  it("truncates long rows to match separator column count", () => {
    const table =
      ["| Col1 | Col2 |", "| --- | --- |", "| A | B | C | D |"].join("\n") +
      "\n";
    const result = normalizeTableDataRows(table);
    // Long row has 4 cells, separator says 2, so result should differ
    expect(result).not.toBe(table);
    const truncatedLine = result.split("\n").find((l) => l.includes("A"));
    if (truncatedLine) {
      const pipeCount = (truncatedLine.match(/\|/g) || []).length;
      expect(pipeCount).toBeLessThanOrEqual(3); // max 2 cells = 3 pipes
    }
  });

  it("returns table unchanged when all rows have correct column count", () => {
    const table =
      ["| Col1 | Col2 |", "| --- | --- |", "| A | B |", "| X | Y |"].join(
        "\n",
      ) + "\n";
    const result = normalizeTableDataRows(table);
    // All rows already have 2 cols, nothing to change
    expect(result).toBe(table);
  });

  it("returns content unchanged when no separator row found", () => {
    const content = "Not a table at all.";
    expect(normalizeTableDataRows(content)).toBe(content);
  });
});

// ─────────────────────────────────────────────────────────────────
// removeOrphanedFigureReferences
// ─────────────────────────────────────────────────────────────────
describe("removeOrphanedFigureReferences", () => {
  it("removes 如图N所示 references", () => {
    const result = removeOrphanedFigureReferences("如图3所示，数据表明...");
    expect(result).not.toContain("如图3所示");
  });

  it("removes (见图N) references", () => {
    const result = removeOrphanedFigureReferences("关键指标（见图2）上升。");
    expect(result).not.toContain("见图2");
  });

  it("removes 图N展示了 references", () => {
    const result = removeOrphanedFigureReferences("图5展示了详细趋势。");
    expect(result).not.toContain("图5展示了");
  });

  it("removes (Figure N) references", () => {
    const result = removeOrphanedFigureReferences(
      "Key trend (Figure 3) shows growth.",
    );
    expect(result).not.toContain("(Figure 3)");
  });

  it("removes 'as shown in Figure N' references", () => {
    const result = removeOrphanedFigureReferences(
      "The data, as shown in Figure 2, confirms the hypothesis.",
    );
    expect(result).not.toContain("as shown in Figure 2");
  });

  it("removes 'Figure N shows' subject-position references", () => {
    const result = removeOrphanedFigureReferences(
      "Figure 1 shows the trend over time.",
    );
    expect(result).not.toContain("Figure 1 shows");
  });
});

// ─────────────────────────────────────────────────────────────────
// fixUnbalancedLatexDelimiters
// ─────────────────────────────────────────────────────────────────
describe("fixUnbalancedLatexDelimiters", () => {
  it("leaves balanced delimiters unchanged", () => {
    const content = "Formula $x^2 + y^2$ is basic.";
    expect(fixUnbalancedLatexDelimiters(content)).toBe(content);
  });

  it("skips lines inside code blocks", () => {
    const content = "```\n$odd$ dollar\n```";
    const result = fixUnbalancedLatexDelimiters(content);
    // Code block content should not be modified
    expect(result).toBe(content);
  });

  it("skips lines starting with $$", () => {
    const content = "$$\\alpha + \\beta$$";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe(content);
  });

  it("skips heading lines", () => {
    const content = "### Heading with $formula";
    // heading is skipped by the processor
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe(content);
  });

  it("skips table rows", () => {
    const content = "| Cell $A | Cell B |";
    const result = fixUnbalancedLatexDelimiters(content);
    expect(result).toBe(content);
  });
});

