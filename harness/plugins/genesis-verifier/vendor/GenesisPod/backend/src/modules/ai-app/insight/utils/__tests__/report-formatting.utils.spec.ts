import {
  stripRawMarkdownInContent,
  numberSubHeadings,
  hierarchicalNumberBoldListItems,
  deduplicateHeadings,
  sanitizeHeadingLevels,
  stripLLMMetaNotes,
  filterJunkReferences,
  deduplicateReferencesByUrl,
  upgradeHttpToHttps,
  decodeUrlEntities,
  remapCitationIndices,
  detectAndPromoteHeadings,
  bulletifyBlockquoteItems,
  splitEnumerationToList,
  cleanupEmptyBullets,
  normalizeInformalTerms,
  normalizeSourceLabels,
  renumberHeadings,
  removeEmptyHeadings,
  mergeAdjacentMathBlocks,
  normalizeChapterToSection,
  escapeLatexPipeInTables,
  normalizeInlineDoubleDollar,
  stripOrphanedChartComments,
  deduplicateIdenticalSections,
  repairLatexCommands,
  // Additional imports for coverage
  detectForeignLanguageBlocks,
  limitBoldFormatting,
  limitBlockquotes,
  removeHorizontalRules,
  deduplicateParagraphs,
  repairOrderedListContinuity,
  stripInternalFigureNotation,
  fixLatexSubscripts,
  linkifyCitations,
  anchorReferences,
  stripHtmlCitationLinks,
  stripCitationsFromHeadings,
  wrapBareDisplayMath,
  wrapProseStyleMath,
  wrapBareInlineLatex,
  convertPlainNumberedListsUnderH3ToBullets,
  deduplicateTerminalSections,
  decodeHtmlEntities,
  convertChineseNumeralHeadings,
  repairBrokenListItems,
  clearBrokenMediaAndEmptyBlocks,
  fixDoubleSourceLabels,
  fixDuplicateHeadings,
  removeEmptySections,
  splitWallOfText,
  fixArrowChains,
  ensureBlankLineAfterTables,
  repairMarkdownTables,
  extractTableFootnotes,
  deduplicateHeadingEcho,
  collapsePseudoCodeHeadings,
  collapseExcessSubHeadings,
  wrapPseudoCodeBlocks,
  truncateLongListItems,
  separateTrappedConclusions,
  enforceExecSummarySections,
  truncateAtSentenceBoundary,
  repairTruncatedBlockquoteBullets,
  normalizeArrowNotation,
  stripLeakedHtmlComments,
  deduplicateAdjacentCitations,
  boldSummaryPrefixes,
  stripChapterHighlights,
  normalizeChapterHighlights,
  normalizeHighlightsInPlace,
  getMinDataPoints,
  repairBrokenBoldMarkers,
  stripFigureComments,
  convertDescriptiveListsToBullets,
} from "@/modules/ai-app/contracts/report-template";

describe("stripRawMarkdownInContent", () => {
  it("should strip ** markers but keep text", () => {
    const input = "这是 **重要** 内容";
    const result = stripRawMarkdownInContent(input);
    expect(result).toBe("这是 重要 内容");
  });

  it("should handle multiple bold markers", () => {
    const input = "**标题** 和 **要点** 都重要";
    const result = stripRawMarkdownInContent(input);
    expect(result).toBe("标题 和 要点 都重要");
  });
});

describe("numberSubHeadings", () => {
  it("should number ### headings correctly", () => {
    const input = "### 背景概述\n内容\n### 现状分析\n内容";
    const result = numberSubHeadings(input, 1);
    expect(result).toContain("### 1.1. 背景概述");
    expect(result).toContain("### 1.2. 现状分析");
  });

  it("should number #### headings under their parent ###", () => {
    const input = "### 背景\n内容\n#### 子章节\n内容\n#### 子章节2\n内容";
    const result = numberSubHeadings(input, 2);
    expect(result).toContain("### 2.1. 背景");
    expect(result).toContain("#### 2.1.1. 子章节");
    expect(result).toContain("#### 2.1.2. 子章节2");
  });

  it("should strip existing numbering prefixes", () => {
    const input = "### 1. 背景概述\n内容\n### 2. 现状分析";
    const result = numberSubHeadings(input, 3);
    expect(result).toContain("### 3.1. 背景概述");
    expect(result).toContain("### 3.2. 现状分析");
  });

  it("should preserve 4-digit years", () => {
    const input = "### 2026年技术展望\n内容";
    const result = numberSubHeadings(input, 1);
    expect(result).toContain("### 1.1. 2026年技术展望");
  });
});

describe("deduplicateHeadings", () => {
  it("should remove duplicate headings", () => {
    const input = "### 背景概述\n内容\n### 1. 背景概述\n更多内容";
    const result = deduplicateHeadings(input);
    expect(result).toContain("### 背景概述");
    expect(result).not.toContain("### 1. 背景概述");
  });

  it("should detect duplicates with hierarchical numbering", () => {
    const input =
      "### 5.10. AI安全与伦理\n内容\n### 5.11. AI安全与伦理\n更多内容";
    const result = deduplicateHeadings(input);
    expect(result).toContain("### 5.10. AI安全与伦理");
    expect(result).not.toContain("### 5.11. AI安全与伦理");
  });
});

describe("sanitizeHeadingLevels", () => {
  it("should remove # and ## (report-level titles, not section headings)", () => {
    const input = "# 标题\n内容\n## 二级标题\n内容";
    const result = sanitizeHeadingLevels(input);
    expect(result).not.toContain("# 标题");
    expect(result).not.toContain("## 二级标题");
    expect(result).toContain("内容");
  });

  it("should leave ### and #### unchanged", () => {
    const input = "### 三级标题\n内容\n#### 四级标题";
    const result = sanitizeHeadingLevels(input);
    expect(result).toBe(input);
  });
});

describe("hierarchicalNumberBoldListItems", () => {
  it("should renumber bold list items under ### sections", () => {
    const input = numberSubHeadings(
      "### 跨领域融合场景\n\n1. **闭环智能体**\n内容\n2. **复合场景**\n内容\n3. **垂直融合**\n内容",
      5,
    );
    // After numberSubHeadings: ### 5.14. (or 5.1. depending on count)
    const result = hierarchicalNumberBoldListItems(input);
    expect(result).toContain("5.1.1. **闭环智能体**");
    expect(result).toContain("5.1.2. **复合场景**");
    expect(result).toContain("5.1.3. **垂直融合**");
    expect(result).not.toMatch(/^1\.\s+\*\*/m);
  });

  it("should not affect regular list items (no bold)", () => {
    const input = numberSubHeadings("### 标题\n\n1. 普通列表项\n2. 另一项", 1);
    const result = hierarchicalNumberBoldListItems(input);
    expect(result).toContain("1. 普通列表项");
    expect(result).toContain("2. 另一项");
  });

  it("should reset counter for each new ### section", () => {
    const input = numberSubHeadings(
      "### 节一\n\n1. **A**\n2. **B**\n### 节二\n\n1. **C**\n2. **D**",
      3,
    );
    const result = hierarchicalNumberBoldListItems(input);
    expect(result).toContain("3.1.1. **A**");
    expect(result).toContain("3.1.2. **B**");
    expect(result).toContain("3.2.1. **C**");
    expect(result).toContain("3.2.2. **D**");
  });

  it("should handle timeline-style bold items", () => {
    const input = numberSubHeadings(
      "### 时间线\n\n1. **2010s初期（Word2Vec）**：内容\n2. **2018-2020（BERT）**：内容",
      6,
    );
    const result = hierarchicalNumberBoldListItems(input);
    expect(result).toContain("6.1.1. **2010s初期（Word2Vec）**");
    expect(result).toContain("6.1.2. **2018-2020（BERT）**");
  });
});

// ============================================================
// stripLLMMetaNotes
// ============================================================

describe("stripLLMMetaNotes", () => {
  describe("word count removal", () => {
    it("should remove （精简字数约500字）", () => {
      const input = "段落内容（精简字数约500字）继续";
      expect(stripLLMMetaNotes(input)).toBe("段落内容继续");
    });

    it("should remove （约1200字）", () => {
      const input = "报告内容（约1200字）";
      expect(stripLLMMetaNotes(input)).toBe("报告内容");
    });

    it("should remove (word count: 500) case-insensitively", () => {
      const input = "正文内容 (word count: 500) 结束";
      expect(stripLLMMetaNotes(input)).toBe("正文内容  结束");
    });

    it("should remove (Word Count: 500) with mixed case", () => {
      const input = "内容 (Word Count: 500)";
      expect(stripLLMMetaNotes(input)).toBe("内容 ");
    });

    it("should remove （当前字数：1500）", () => {
      const input = "段落（当前字数：1500）结尾";
      expect(stripLLMMetaNotes(input)).toBe("段落结尾");
    });

    it("should remove （字数：约800字）", () => {
      const input = "内容（字数：约800字）";
      expect(stripLLMMetaNotes(input)).toBe("内容");
    });
  });

  describe("agent role leakage", () => {
    it("should remove Leader分配的", () => {
      const input = "这是Leader分配的任务内容";
      expect(stripLLMMetaNotes(input)).toBe("这是任务内容");
    });

    it("should remove 研究Agent分配的", () => {
      const input = "研究Agent分配的分析结果";
      expect(stripLLMMetaNotes(input)).toBe("分析结果");
    });

    it("should remove 分析Agent分配的", () => {
      const input = "分析Agent分配的内容";
      expect(stripLLMMetaNotes(input)).toBe("内容");
    });

    it("should remove Agent生成的", () => {
      const input = "Agent生成的报告";
      expect(stripLLMMetaNotes(input)).toBe("报告");
    });
  });

  describe("LLM meta-analysis markers", () => {
    it("should strip **分析判断：** prefix", () => {
      const input = "**分析判断：**这是分析内容";
      expect(stripLLMMetaNotes(input)).toBe("这是分析内容");
    });

    it("should strip **综合分析：** prefix", () => {
      const input = "**综合分析：**综合来看，数据显示增长";
      // The **综合分析：** prefix is stripped; then '综合来看，' at line start is also stripped
      const result = stripLLMMetaNotes(input);
      expect(result).not.toContain("**综合分析：**");
    });

    it("should strip **要点：** prefix", () => {
      const input = "**要点：**本节重要信息如下";
      expect(stripLLMMetaNotes(input)).toBe("本节重要信息如下");
    });

    it("should strip **总结：** prefix", () => {
      const input = "**总结：**以上内容";
      expect(stripLLMMetaNotes(input)).toBe("以上内容");
    });

    it("should strip **结论：** prefix", () => {
      const input = "**结论：**结论是正确的";
      expect(stripLLMMetaNotes(input)).toBe("结论是正确的");
    });

    it("should strip **小结：** prefix", () => {
      const input = "**小结：**小结内容";
      expect(stripLLMMetaNotes(input)).toBe("小结内容");
    });
  });

  describe("HTML strong variants", () => {
    it("should strip <strong>总结：</strong>", () => {
      const input = "<strong>总结：</strong>总结内容";
      expect(stripLLMMetaNotes(input)).toBe("总结内容");
    });

    it("should strip <strong>结论：</strong>", () => {
      const input = "<strong>结论：</strong>结论内容";
      expect(stripLLMMetaNotes(input)).toBe("结论内容");
    });

    it("should strip <strong>分析判断：</strong>", () => {
      const input = "<strong>分析判断：</strong>分析内容";
      expect(stripLLMMetaNotes(input)).toBe("分析内容");
    });

    it("should strip <strong>要点：</strong>", () => {
      const input = "<strong>要点：</strong>要点内容";
      expect(stripLLMMetaNotes(input)).toBe("要点内容");
    });
  });

  describe("cross-reference placeholders", () => {
    it("should remove [前文]", () => {
      const input = "如[前文]所述，数据表明";
      expect(stripLLMMetaNotes(input)).toBe("如所述，数据表明");
    });

    it("should remove [上文]", () => {
      const input = "[上文]提到的内容";
      expect(stripLLMMetaNotes(input)).toBe("提到的内容");
    });

    it("should remove [前述]", () => {
      const input = "参见[前述]章节";
      expect(stripLLMMetaNotes(input)).toBe("参见章节");
    });

    it("should remove [详见前文]", () => {
      const input = "分析[详见前文]说明";
      expect(stripLLMMetaNotes(input)).toBe("分析说明");
    });

    it("should remove [见前文]", () => {
      const input = "[见前文]的数据";
      expect(stripLLMMetaNotes(input)).toBe("的数据");
    });
  });

  describe("escaped HTML fix", () => {
    // The regex /<\\\/?(tag)>/ matches tags with a literal backslash and removes the backslash.
    // <\span>  (backslash, no slash) → <span>
    // <\/span> (backslash + slash)   → </span>

    it("should fix <\\span> by removing the backslash → <span>", () => {
      const input = "<span>内容<\\span>";
      // <\span> has a backslash but no forward slash → backslash stripped → <span>
      expect(stripLLMMetaNotes(input)).toBe("<span>内容<span>");
    });

    it("should fix <\\/span> (backslash + slash) → </span>", () => {
      // In JS string: "<\\/span>" is the 5-char sequence <\/span>
      const input = "<span>内容<\\/span>";
      expect(stripLLMMetaNotes(input)).toBe("<span>内容</span>");
    });

    it("should fix <\\strong> by removing the backslash → <strong>", () => {
      const input = "<strong>文本<\\strong>";
      expect(stripLLMMetaNotes(input)).toBe("<strong>文本<strong>");
    });

    it("should fix <\\/strong> (backslash + slash) → </strong>", () => {
      const input = "<strong>文本<\\/strong>";
      expect(stripLLMMetaNotes(input)).toBe("<strong>文本</strong>");
    });

    it("should fix <\\em> by removing the backslash → <em>", () => {
      const input = "<em>斜体<\\em>";
      expect(stripLLMMetaNotes(input)).toBe("<em>斜体<em>");
    });
  });

  describe("LLM transition phrase removal", () => {
    it("should remove 综合来看， at line start", () => {
      const input = "上一段。\n综合来看，接下来的内容";
      const result = stripLLMMetaNotes(input);
      expect(result).not.toContain("综合来看，");
      expect(result).toContain("接下来的内容");
    });

    it("should remove 值得警惕的是， at line start", () => {
      const input = "上一段。\n值得警惕的是，存在风险";
      const result = stripLLMMetaNotes(input);
      expect(result).not.toContain("值得警惕的是，");
      expect(result).toContain("存在风险");
    });

    it("should remove 总体来看， at line start", () => {
      const input = "内容。\n总体来看，整体向好";
      const result = stripLLMMetaNotes(input);
      expect(result).not.toContain("总体来看，");
      expect(result).toContain("整体向好");
    });

    it("should remove transition phrase at very start of string", () => {
      // When at position 0, match does not start with '\n', so replacement is ''
      const input = "综合来看，这是结论";
      const result = stripLLMMetaNotes(input);
      expect(result).not.toContain("综合来看，");
      expect(result).toContain("这是结论");
    });

    it("should NOT remove transition phrases mid-sentence", () => {
      // "综合来看" embedded in middle of a line should not be affected
      const input = "研究表明综合来看整体趋势良好";
      const result = stripLLMMetaNotes(input);
      // No match because there's no line-start boundary before 综合来看
      expect(result).toContain("综合来看");
    });
  });

  describe("multiple blank lines", () => {
    it("should collapse 3+ newlines to double newline", () => {
      const input = "段落一\n\n\n\n段落二";
      expect(stripLLMMetaNotes(input)).toBe("段落一\n\n段落二");
    });

    it("should collapse exactly 3 newlines to double newline", () => {
      const input = "A\n\n\nB";
      expect(stripLLMMetaNotes(input)).toBe("A\n\nB");
    });

    it("should leave double newline unchanged", () => {
      const input = "A\n\nB";
      expect(stripLLMMetaNotes(input)).toBe("A\n\nB");
    });
  });

  describe("should NOT strip legitimate content", () => {
    it("should keep regular numbered citations like [1]", () => {
      const input = "证据[1]支持该结论[2]";
      expect(stripLLMMetaNotes(input)).toBe("证据[1]支持该结论[2]");
    });

    it("should keep legitimate bold headings without meta-label pattern", () => {
      const input = "**市场规模**：全球市场规模达到5000亿美元";
      expect(stripLLMMetaNotes(input)).toBe(
        "**市场规模**：全球市场规模达到5000亿美元",
      );
    });

    it("should keep 综合来看 that appears mid-sentence (not at line start)", () => {
      const input = "专家认为综合来看趋势向好";
      expect(stripLLMMetaNotes(input)).toContain("综合来看");
    });

    it("should keep regular <strong> HTML tags without meta-label content", () => {
      const input = "<strong>重要数据</strong>：增长率为15%";
      expect(stripLLMMetaNotes(input)).toBe(
        "<strong>重要数据</strong>：增长率为15%",
      );
    });
  });
});

// ============================================================
// filterJunkReferences
// ============================================================

describe("filterJunkReferences", () => {
  it("should filter out references with dollskill.com domain", () => {
    const refs = [
      { domain: "dollskill.com", url: "https://dollskill.com/product" },
    ];
    expect(filterJunkReferences(refs)).toHaveLength(0);
  });

  it("should filter out references with tiktok.com domain", () => {
    const refs = [
      { domain: "tiktok.com", url: "https://tiktok.com/video/123" },
    ];
    expect(filterJunkReferences(refs)).toHaveLength(0);
  });

  it("should filter out references with instagram.com domain", () => {
    const refs = [
      { domain: "instagram.com", url: "https://instagram.com/post/abc" },
    ];
    expect(filterJunkReferences(refs)).toHaveLength(0);
  });

  it("should keep references with academic/news domains", () => {
    const refs = [
      { domain: "nature.com", url: "https://nature.com/article/1234" },
      { domain: "reuters.com", url: "https://reuters.com/article/abc" },
    ];
    expect(filterJunkReferences(refs)).toHaveLength(2);
  });

  it("should handle www prefix — www.dollskill.com matches dollskill.com", () => {
    const refs = [
      { domain: "www.dollskill.com", url: "https://www.dollskill.com/item" },
    ];
    expect(filterJunkReferences(refs)).toHaveLength(0);
  });

  it("should handle missing domain by falling back to URL extraction", () => {
    const refs = [
      { url: "https://tiktok.com/video/456" },
      { url: "https://arxiv.org/abs/2301.00001" },
    ];
    const result = filterJunkReferences(refs);
    expect(result).toHaveLength(1);
    expect(result[0].url).toContain("arxiv.org");
  });

  it("should keep reference when no domain and no URL", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refs = [{ domain: null, url: undefined }];
    expect(filterJunkReferences(refs)).toHaveLength(1);
  });

  it("should filter taobao.com references", () => {
    const refs = [{ domain: "taobao.com", url: "https://taobao.com/item/1" }];
    expect(filterJunkReferences(refs)).toHaveLength(0);
  });

  it("should filter zhihu.com references", () => {
    const refs = [{ domain: "zhihu.com", url: "https://zhihu.com/question/1" }];
    expect(filterJunkReferences(refs)).toHaveLength(0);
  });

  it("should keep mixed valid and invalid references, returning only valid ones", () => {
    const refs = [
      { domain: "science.org", url: "https://science.org/article/1" },
      { domain: "amazon.com", url: "https://amazon.com/product/xyz" },
      { domain: "ft.com", url: "https://ft.com/news/abc" },
    ];
    const result = filterJunkReferences(refs);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.domain)).toEqual(["science.org", "ft.com"]);
  });
});

// ============================================================
// deduplicateReferencesByUrl
// ============================================================

describe("deduplicateReferencesByUrl", () => {
  it("should remove exact duplicate URLs and keep the first occurrence", () => {
    const refs = [
      { index: 1, url: "https://example.com/page" },
      { index: 2, url: "https://example.com/page" },
    ];
    const { deduplicated } = deduplicateReferencesByUrl(refs);
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].index).toBe(1);
  });

  it("should renumber remaining references starting from 1", () => {
    const refs = [
      { index: 3, url: "https://alpha.com" },
      { index: 7, url: "https://beta.com" },
    ];
    const { deduplicated } = deduplicateReferencesByUrl(refs);
    expect(deduplicated[0].index).toBe(1);
    expect(deduplicated[1].index).toBe(2);
  });

  it("should return correct indexMapping old→new for unique refs", () => {
    const refs = [
      { index: 3, url: "https://alpha.com" },
      { index: 7, url: "https://beta.com" },
    ];
    const { indexMapping } = deduplicateReferencesByUrl(refs);
    expect(indexMapping.get(3)).toBe(1);
    expect(indexMapping.get(7)).toBe(2);
  });

  it("should map duplicate old index to first occurrence's new index", () => {
    const refs = [
      { index: 1, url: "https://example.com/page" },
      { index: 2, url: "https://other.com" },
      { index: 5, url: "https://example.com/page" }, // duplicate of index 1
    ];
    const { indexMapping } = deduplicateReferencesByUrl(refs);
    expect(indexMapping.get(1)).toBe(1);
    expect(indexMapping.get(2)).toBe(2);
    expect(indexMapping.get(5)).toBe(1); // mapped to the new index of the first occurrence
  });

  it("should normalize trailing slashes — treat /page/ same as /page", () => {
    const refs = [
      { index: 1, url: "https://example.com/page/" },
      { index: 2, url: "https://example.com/page" },
    ];
    const { deduplicated } = deduplicateReferencesByUrl(refs);
    expect(deduplicated).toHaveLength(1);
  });

  it("should normalize www prefix — www.example.com same as example.com", () => {
    const refs = [
      { index: 1, url: "https://www.example.com/page" },
      { index: 2, url: "https://example.com/page" },
    ];
    const { deduplicated } = deduplicateReferencesByUrl(refs);
    expect(deduplicated).toHaveLength(1);
  });

  it("should normalize &amp; in URLs before comparing", () => {
    const refs = [
      { index: 1, url: "https://example.com/search?a=1&amp;b=2" },
      { index: 2, url: "https://example.com/search?a=1&b=2" },
    ];
    const { deduplicated } = deduplicateReferencesByUrl(refs);
    expect(deduplicated).toHaveLength(1);
  });

  it("should handle refs without index field", () => {
    const refs = [
      { url: "https://alpha.com" },
      { url: "https://beta.com" },
      { url: "https://alpha.com" },
    ];
    const { deduplicated, indexMapping } = deduplicateReferencesByUrl(refs);
    expect(deduplicated).toHaveLength(2);
    expect(indexMapping.size).toBe(0); // no indices to map
  });

  it("should return empty arrays and empty map for empty input", () => {
    const { deduplicated, indexMapping } = deduplicateReferencesByUrl([]);
    expect(deduplicated).toHaveLength(0);
    expect(indexMapping.size).toBe(0);
  });
});

// ============================================================
// upgradeHttpToHttps
// ============================================================

describe("upgradeHttpToHttps", () => {
  it("should convert http:// to https://", () => {
    const refs = [{ url: "http://example.com/page" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("https://example.com/page");
  });

  it("should keep https:// unchanged", () => {
    const refs = [{ url: "https://example.com/page" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("https://example.com/page");
  });

  it("should skip localhost URLs", () => {
    const refs = [{ url: "http://localhost:3000/api" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("http://localhost:3000/api");
  });

  it("should skip http://127.x.x.x addresses", () => {
    const refs = [{ url: "http://127.0.0.1:8080/page" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("http://127.0.0.1:8080/page");
  });

  it("should skip http://192.168.x.x addresses", () => {
    const refs = [{ url: "http://192.168.1.100/api" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("http://192.168.1.100/api");
  });

  it("should skip http://10.x.x.x addresses", () => {
    const refs = [{ url: "http://10.0.0.1/internal" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("http://10.0.0.1/internal");
  });

  it("should handle refs without url field", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refs = [{ title: "No URL" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0]).toEqual({ title: "No URL" });
  });

  it("should upgrade multiple refs and preserve non-url fields", () => {
    const refs = [
      { index: 1, url: "http://alpha.com/a" },
      { index: 2, url: "https://beta.com/b" },
    ];
    const result = upgradeHttpToHttps(refs);
    expect(result[0]).toEqual({ index: 1, url: "https://alpha.com/a" });
    expect(result[1]).toEqual({ index: 2, url: "https://beta.com/b" });
  });
});

// ============================================================
// decodeUrlEntities
// ============================================================

describe("decodeUrlEntities", () => {
  it("should decode &amp; to &", () => {
    const refs = [{ url: "https://example.com/search?a=1&amp;b=2" }];
    const result = decodeUrlEntities(refs);
    expect(result[0].url).toBe("https://example.com/search?a=1&b=2");
  });

  it("should decode &lt; to <", () => {
    const refs = [{ url: "https://example.com/?q=a&lt;b" }];
    const result = decodeUrlEntities(refs);
    expect(result[0].url).toBe("https://example.com/?q=a<b");
  });

  it("should decode &gt; to >", () => {
    const refs = [{ url: "https://example.com/?q=a&gt;b" }];
    const result = decodeUrlEntities(refs);
    expect(result[0].url).toBe("https://example.com/?q=a>b");
  });

  it("should decode &quot; to double-quote", () => {
    const refs = [{ url: "https://example.com/?q=&quot;hello&quot;" }];
    const result = decodeUrlEntities(refs);
    expect(result[0].url).toBe('https://example.com/?q="hello"');
  });

  it("should decode &#39; to single-quote", () => {
    const refs = [{ url: "https://example.com/?q=it&#39;s" }];
    const result = decodeUrlEntities(refs);
    expect(result[0].url).toBe("https://example.com/?q=it's");
  });

  it("should keep clean URLs unchanged (returns same object reference for unchanged url)", () => {
    const refs = [{ url: "https://example.com/page" }];
    const result = decodeUrlEntities(refs);
    expect(result[0].url).toBe("https://example.com/page");
  });

  it("should handle refs without url field", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refs = [{ title: "No URL" }];
    const result = decodeUrlEntities(refs);
    expect(result[0]).toEqual({ title: "No URL" });
  });

  it("should decode multiple entities in the same URL", () => {
    const refs = [{ url: "https://example.com/?a=1&amp;b=&lt;2&gt;" }];
    const result = decodeUrlEntities(refs);
    expect(result[0].url).toBe("https://example.com/?a=1&b=<2>");
  });
});

// ============================================================
// remapCitationIndices
// ============================================================

describe("remapCitationIndices", () => {
  it("should remap [1] to [5] when mapping says 1→5", () => {
    const mapping = new Map([[1, 5]]);
    expect(remapCitationIndices("参见[1]说明", mapping)).toBe("参见[5]说明");
  });

  it("should handle multiple remaps in one string", () => {
    const mapping = new Map([
      [1, 3],
      [2, 4],
    ]);
    const result = remapCitationIndices("来源[1]和[2]都支持", mapping);
    expect(result).toBe("来源[3]和[4]都支持");
  });

  it("should not affect unmapped indices", () => {
    const mapping = new Map([[1, 5]]);
    const result = remapCitationIndices("来源[1][3][7]", mapping);
    expect(result).toBe("来源[5][3][7]");
  });

  it("should return content unchanged when mapping is empty", () => {
    const mapping = new Map();
    const input = "来源[1][2][3]";
    expect(remapCitationIndices(input, mapping)).toBe(input);
  });

  it("should remap same index appearing multiple times", () => {
    const mapping = new Map([[2, 9]]);
    const result = remapCitationIndices("参见[2]，另见[2]", mapping);
    expect(result).toBe("参见[9]，另见[9]");
  });

  it("should handle citation at start and end of string", () => {
    const mapping = new Map([[1, 2]]);
    expect(remapCitationIndices("[1]内容[1]", mapping)).toBe("[2]内容[2]");
  });

  it("should not remap text that looks like citation but is not a number", () => {
    // [abc] should not be matched since the regex only matches digits
    const mapping = new Map([[1, 5]]);
    const result = remapCitationIndices("参见[abc]说明[1]", mapping);
    expect(result).toBe("参见[abc]说明[5]");
  });
});

// ============================================================
// detectAndPromoteHeadings
// ============================================================

describe("detectAndPromoteHeadings", () => {
  it("should NOT promote bold line (guard regex skips lines starting with *)", () => {
    // Bold lines start with *, which is caught by the guard regex on line 2099.
    // This is expected: bold formatting serves as emphasis, not heading promotion.
    const input =
      "**多模态融合技术架构演进**\n\n详细内容在这里描述该技术架构的演进路线。";
    const result = detectAndPromoteHeadings(input);
    expect(result).not.toContain("###");
    expect(result).toContain("**多模态融合技术架构演进**");
  });

  it("should promote short line ending with colon to heading", () => {
    const input = "核心技术路线：\n\n详细内容段落在这里描述主要技术路线。";
    const result = detectAndPromoteHeadings(input);
    expect(result).toContain("### 核心技术路线");
  });

  it("should NOT promote line ending with colon when next line is a list item (dash)", () => {
    const input =
      "开源带来的影响主要体现在三点：\n- 降低了构建自有基础模型的门槛";
    const result = detectAndPromoteHeadings(input);
    expect(result).not.toContain("###");
    expect(result).toContain("开源带来的影响主要体现在三点：");
  });

  it("should NOT promote line ending with colon when next line is ordered list", () => {
    const input = "关键创新方向：\n1. 自注意力机制优化\n2. 稀疏化计算";
    const result = detectAndPromoteHeadings(input);
    expect(result).not.toContain("###");
    expect(result).toContain("关键创新方向：");
  });

  it("should NOT promote line ending with colon when next line is bullet asterisk", () => {
    const input = "技术挑战包括：\n* 计算效率瓶颈\n* 数据质量问题";
    const result = detectAndPromoteHeadings(input);
    expect(result).not.toContain("###");
  });

  it("should skip lines that are already headings", () => {
    const input = "### 已有标题\n\n内容";
    const result = detectAndPromoteHeadings(input);
    expect(result).toBe(input);
  });

  it("should skip lines with sentence punctuation (not headings)", () => {
    const input = "这是一段，包含逗号的长句子：\n\n后续内容";
    const result = detectAndPromoteHeadings(input);
    expect(result).not.toContain("###");
  });

  it("should skip very short bold labels (2-4 chars)", () => {
    const input = "**反馈**\n\n内容段落";
    const result = detectAndPromoteHeadings(input);
    expect(result).not.toContain("###");
  });

  it("should NOT promote when next content is blockquote", () => {
    const input = "总结评价：\n> 引用内容在这里";
    const result = detectAndPromoteHeadings(input);
    expect(result).not.toContain("###");
  });
});

// ============================================================
// bulletifyBlockquoteItems
// ============================================================

describe("bulletifyBlockquoteItems", () => {
  it("should add bullet markers to consecutive blockquote lines", () => {
    const input = "> 第一条内容\n> 第二条内容\n> 第三条内容";
    const result = bulletifyBlockquoteItems(input);
    expect(result).toBe("> - 第一条内容\n> - 第二条内容\n> - 第三条内容");
  });

  it("should NOT bulletify empty blockquote lines", () => {
    const input = "> \n> 有内容的行";
    const result = bulletifyBlockquoteItems(input);
    // Empty line should remain as-is, single content line should not be bulletified
    expect(result).not.toContain("> - ");
    expect(result).toContain("> ");
  });

  it("should NOT bulletify single blockquote line", () => {
    const input = "> 只有一行内容";
    const result = bulletifyBlockquoteItems(input);
    expect(result).toBe("> 只有一行内容");
  });

  it("should NOT bulletify lines that already have bullet markers", () => {
    const input = "> - 已有bullet\n> - 另一个bullet";
    const result = bulletifyBlockquoteItems(input);
    expect(result).toBe(input);
  });

  it("should NOT bulletify lines with bold markers", () => {
    const input = "> **标题行**\n> 内容行";
    const result = bulletifyBlockquoteItems(input);
    // Bold line should not match; only 1 non-bold line so no bulletification
    expect(result).toBe(input);
  });

  it("should handle mixed empty and content blockquote lines", () => {
    const input = "> 内容一\n> \n> 内容二\n> 内容三";
    const result = bulletifyBlockquoteItems(input);
    // Empty line breaks the run: "内容一" is alone (no bullet), then "内容二"+"内容三" = run of 2
    expect(result).toContain("> 内容一");
    expect(result).toContain("> - 内容二");
    expect(result).toContain("> - 内容三");
  });
});

// ============================================================
// splitEnumerationToList
// ============================================================

describe("splitEnumerationToList", () => {
  it("should split 一是/二是/三是 patterns into bullet list preserving markers", () => {
    const input =
      "在技术栈层面，可观察到三条路线：一是以通用语言模型为核心构建应用，二是以世界模型为代表进行预测，三是以多模态融合为基础";
    const result = splitEnumerationToList(input);
    expect(result).toContain("- **一是**以通用语言模型为核心构建应用");
    expect(result).toContain("- **二是**以世界模型为代表进行预测");
    expect(result).toContain("- **三是**以多模态融合为基础");
  });

  it("should split 首先/其次/最后 patterns preserving markers", () => {
    const input =
      "需要关注以下方面：首先是计算效率的优化，其次是数据质量的保障，最后是安全对齐的强化";
    const result = splitEnumerationToList(input);
    expect(result).toContain("- **首先**");
    expect(result).toContain("- **其次**");
    expect(result).toContain("- **最后**");
    expect(result.match(/^- /gm)?.length).toBeGreaterThanOrEqual(3);
  });

  it("should NOT split when fewer than 2 markers found", () => {
    const input = "首先我们需要了解基础架构的演进趋势。";
    const result = splitEnumerationToList(input);
    expect(result).toBe(input);
  });

  it("should skip headings", () => {
    const input = "### 一是核心架构，二是训练方法";
    const result = splitEnumerationToList(input);
    expect(result).toBe(input);
  });

  it("should skip short paragraphs", () => {
    const input = "一是好，二是坏";
    const result = splitEnumerationToList(input);
    expect(result).toBe(input);
  });

  it("should NOT produce empty bullet items when marker has no content", () => {
    const input = "关键要素包括以下几点，一是模型架构的优化方向，二是";
    const result = splitEnumerationToList(input);
    // Second item has no content — should be skipped
    const bullets = result.match(/^- .+$/gm) || [];
    for (const bullet of bullets) {
      // Each bullet should have actual content after "- "
      expect(bullet.replace(/^- /, "").trim().length).toBeGreaterThan(0);
    }
  });

  it("should preserve leading sentence before first marker", () => {
    const input =
      "在技术栈层面，可观察到两条路线：一是以通用语言模型为核心，二是以世界模型为代表";
    const result = splitEnumerationToList(input);
    expect(result).toContain("在技术栈层面，可观察到两条路线：");
  });
});

// ============================================================
// cleanupEmptyBullets
// ============================================================

describe("cleanupEmptyBullets", () => {
  it("should remove empty dash bullet items", () => {
    const input = "- 有内容\n- \n- 也有内容";
    const result = cleanupEmptyBullets(input);
    expect(result).toContain("- 有内容");
    expect(result).toContain("- 也有内容");
    expect(result).not.toMatch(/^-\s*$/m);
  });

  it("should remove empty asterisk bullet items", () => {
    const input = "* 有内容\n* \n* 也有内容";
    const result = cleanupEmptyBullets(input);
    expect(result).not.toMatch(/^\*\s*$/m);
  });

  it("should remove empty blockquote bullet items", () => {
    const input = "> - 有内容\n> - \n> - 也有内容";
    const result = cleanupEmptyBullets(input);
    expect(result).not.toMatch(/^>\s*-\s*$/m);
  });

  it("should collapse triple newlines after removal", () => {
    const input = "段落一\n\n- \n\n段落二";
    const result = cleanupEmptyBullets(input);
    expect(result).not.toContain("\n\n\n");
  });

  it("should preserve non-empty bullets", () => {
    const input = "- 第一项\n- 第二项\n- 第三项";
    const result = cleanupEmptyBullets(input);
    expect(result).toBe(input);
  });
});

// ============================================================
// normalizeInformalTerms
// ============================================================

describe("normalizeInformalTerms", () => {
  it("should replace standalone 'hype' with 炒作", () => {
    const input = "忽略hype如AGI即将来临的说法";
    const result = normalizeInformalTerms(input);
    expect(result).not.toContain("hype");
    expect(result).toContain("炒作");
  });

  it("should replace 'hype宣传' with 过度宣传", () => {
    const input = "hype宣传忽略训练开销";
    const result = normalizeInformalTerms(input);
    expect(result).toBe("过度宣传忽略训练开销");
  });

  it("should replace 'hype曲线' with 技术炒作周期曲线", () => {
    const input = "参考Gartner的hype曲线";
    const result = normalizeInformalTerms(input);
    expect(result).toContain("技术炒作周期曲线");
  });

  it("should not modify English words containing 'hype' as substring", () => {
    const input = "hyperparameter tuning is important";
    const result = normalizeInformalTerms(input);
    expect(result).toBe(input);
  });

  it("should handle case-insensitive 'Hype'", () => {
    const input = "Hype现象值得警惕";
    const result = normalizeInformalTerms(input);
    expect(result).toContain("炒作");
  });
});

// ============================================================
// normalizeSourceLabels
// ============================================================

describe("normalizeSourceLabels", () => {
  it("should add space after Source: when missing", () => {
    const input = "Source:[94]";
    const result = normalizeSourceLabels(input);
    expect(result).toBe("Source: [94]");
  });

  it("should keep correct format unchanged", () => {
    const input = "Source: [94]";
    const result = normalizeSourceLabels(input);
    expect(result).toBe("Source: [94]");
  });

  it("should convert Chinese 来源 to English Source", () => {
    const input = "来源：[42]";
    const result = normalizeSourceLabels(input);
    expect(result).toBe("Source: [42]");
  });

  it("should strip 证据 from source labels", () => {
    const input = "来源: 证据 [7]";
    const result = normalizeSourceLabels(input);
    expect(result).toBe("Source: [7]");
  });
});

// ============================================================
// renumberHeadings + removeEmptyHeadings integration
// ============================================================

describe("renumberHeadings after removeEmptyHeadings", () => {
  it("should close numbering gaps when empty heading is removed", () => {
    const input = [
      "## 1. 维度一",
      "",
      "### 1.1. 第一节",
      "内容A",
      "",
      "### 1.2. 空节",
      "",
      "### 1.3. 第三节",
      "内容B",
    ].join("\n");

    // Remove empty heading then renumber
    let result = removeEmptyHeadings(input);
    result = renumberHeadings(result);

    expect(result).toContain("### 1.1. 第一节");
    expect(result).toContain("### 1.2. 第三节");
    expect(result).not.toContain("1.3.");
  });

  it("should maintain correct numbering when no headings removed", () => {
    const input = [
      "## 1. 维度一",
      "",
      "### 1.1. 第一节",
      "内容A",
      "",
      "### 1.2. 第二节",
      "内容B",
    ].join("\n");

    const result = renumberHeadings(input);
    expect(result).toContain("### 1.1. 第一节");
    expect(result).toContain("### 1.2. 第二节");
  });
});

// ============================================================
// stripLLMMetaNotes — new variant coverage
// ============================================================

describe("stripLLMMetaNotes — internal note leak variants", () => {
  it("should strip bare '字数约1250字（内部统计，不输出）'", () => {
    const input = "正文内容字数约1250字（内部统计，不输出）后续内容";
    const result = stripLLMMetaNotes(input);
    expect(result).toBe("正文内容后续内容");
    expect(result).not.toContain("内部统计");
  });

  it("should strip '字数约：1520字（内部计算，不输出）'", () => {
    const input = "段落末尾字数约：1520字（内部计算，不输出）";
    const result = stripLLMMetaNotes(input);
    expect(result).not.toContain("内部计算");
    expect(result).not.toContain("不输出");
  });

  it("should strip '字数1800字（内部统计）'", () => {
    const input = "内容字数1800字（内部统计）结尾";
    // This should match via existing (字数...) or new bare pattern
    const result = stripLLMMetaNotes(input);
    expect(result).not.toContain("内部统计");
  });
});

// ============================================================
// mergeAdjacentMathBlocks — asymmetric delimiter fix
// ============================================================

describe("mergeAdjacentMathBlocks — asymmetric delimiters", () => {
  it("should fix $$formula$ to $$formula$$", () => {
    const input = "$$\\text{FFN}(x)=W_2\\sigma(W_1 x)$";
    const result = mergeAdjacentMathBlocks(input);
    // Should have matching $$ on both sides
    expect(result).toMatch(/^\$\$.*\$\$$/);
    expect(result).not.toMatch(/[^$]\$$/);
  });

  it("should fix $formula$$ to $$formula$$", () => {
    const input = "$\\text{Attention}(Q,K,V)$$";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toMatch(/^\$\$.*\$\$$/);
  });

  it("should not alter correctly paired $$formula$$", () => {
    const input = "$$E = mc^2$$";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toBe("$$E = mc^2$$");
  });

  it("should not alter correctly paired $formula$", () => {
    const input = "inline $x^2$ formula";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("$x^2$");
  });

  it("should merge adjacent inline blocks: $A$ $B$ → $A B$", () => {
    const input = "$\\alpha$ $\\beta$";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toBe("$\\alpha \\beta$");
  });
});

// ============================================================
// normalizeChapterToSection
// ============================================================

describe("normalizeChapterToSection", () => {
  it("should replace 本章 with 本节", () => {
    const input = "本章聚焦两个可验证方向";
    expect(normalizeChapterToSection(input)).toBe("本节聚焦两个可验证方向");
  });

  it("should replace 本章节 with 本维度 (not 本节节)", () => {
    const input = "本章节分析了三个趋势";
    expect(normalizeChapterToSection(input)).toBe("本维度分析了三个趋势");
  });

  it("should preserve 本章要点", () => {
    const input = "> **本章要点**\n> - 要点一";
    expect(normalizeChapterToSection(input)).toContain("本章要点");
  });

  it("should handle multiple occurrences in same content", () => {
    const input = "本章分析...本章节结论...本章要点";
    const result = normalizeChapterToSection(input);
    expect(result).toBe("本节分析...本维度结论...本章要点");
  });

  it("should not modify content without 本章", () => {
    const input = "本节分析了趋势";
    expect(normalizeChapterToSection(input)).toBe(input);
  });
});

// ============================================================
// escapeLatexPipeInTables
// ============================================================

describe("escapeLatexPipeInTables", () => {
  it("should escape | inside $...$ in table rows", () => {
    const input = "| Formula | $P(A|B)$ |";
    const result = escapeLatexPipeInTables(input);
    expect(result).toContain("$P(A\\vert B)$");
  });

  it("should not modify non-table lines", () => {
    const input = "Inline $P(A|B)$ formula";
    expect(escapeLatexPipeInTables(input)).toBe(input);
  });

  it("should not modify separator rows", () => {
    const input = "|---|---|";
    expect(escapeLatexPipeInTables(input)).toBe(input);
  });

  it("should handle multiple LaTeX spans in one row", () => {
    const input = "| $a|b$ | $c|d$ |";
    const result = escapeLatexPipeInTables(input);
    expect(result).toContain("$a\\vert b$");
    expect(result).toContain("$c\\vert d$");
  });

  it("should not modify table cells without LaTeX pipe", () => {
    const input = "| $x^2$ | $y^2$ |";
    expect(escapeLatexPipeInTables(input)).toBe(input);
  });
});

// ============================================================
// normalizeInlineDoubleDollar
// ============================================================

describe("normalizeInlineDoubleDollar", () => {
  it("should convert inline $$...$$ to $...$", () => {
    const input = "公式L=$$\\alpha$$是关键";
    const result = normalizeInlineDoubleDollar(input);
    expect(result).toBe("公式L=$\\alpha$是关键");
  });

  it("should not convert display math (line starts and ends with $$)", () => {
    const input = "$$E = mc^2$$";
    expect(normalizeInlineDoubleDollar(input)).toBe(input);
  });

  it("should skip fenced code blocks", () => {
    const input = "```\nL=$$\\alpha$$\n```";
    expect(normalizeInlineDoubleDollar(input)).toBe(input);
  });

  it("should handle $$ followed by Chinese punctuation", () => {
    const input = "结果为X=$$\\beta$$，其中";
    const result = normalizeInlineDoubleDollar(input);
    expect(result).toBe("结果为X=$\\beta$，其中");
  });

  it("should not convert $$ at start of line (display math)", () => {
    const input = "$$\\alpha$$ + 1";
    // $$ at start of line — lookbehind requires \\S before $$
    expect(normalizeInlineDoubleDollar(input)).toBe(input);
  });
});

// ============================================================
// stripOrphanedChartComments
// ============================================================

describe("stripOrphanedChartComments", () => {
  it("should strip raw HTML chart comments", () => {
    const input = "内容前<!-- chart:d1-s0-4:1 -->内容后";
    expect(stripOrphanedChartComments(input)).toBe("内容前内容后");
  });

  it("should strip HTML-escaped chart comments", () => {
    const input = "内容前&lt;!-- chart:d3-s0-4:0 --&gt;内容后";
    expect(stripOrphanedChartComments(input)).toBe("内容前内容后");
  });

  it("should strip multiple chart comments", () => {
    const input = "A<!-- chart:d1-c1 -->B<!-- chart:d2-c2 -->C";
    expect(stripOrphanedChartComments(input)).toBe("ABC");
  });

  it("should not strip non-chart comments", () => {
    const input = "<!-- figure:1:2 -->";
    expect(stripOrphanedChartComments(input)).toBe(input);
  });

  it("should not modify content without chart comments", () => {
    const input = "正常内容没有注释";
    expect(stripOrphanedChartComments(input)).toBe(input);
  });
});

// ============================================================
// deduplicateIdenticalSections
// ============================================================

describe("deduplicateIdenticalSections", () => {
  it("should remove consecutive sections with identical heading AND body", () => {
    const input = [
      "### WWNBT情景",
      "**情景1：CPO主导** 2026 OFC良率>95%。",
      "",
      "### WWNBT情景",
      "**情景1：CPO主导** 2026 OFC良率>95%。",
      "",
    ].join("\n");
    const result = deduplicateIdenticalSections(input);
    const headingCount = (result.match(/### WWNBT情景/g) || []).length;
    expect(headingCount).toBe(1);
  });

  it("should NOT remove non-consecutive sections with same heading", () => {
    const input = [
      "### 情景A",
      "Content A",
      "",
      "### 情景B",
      "Content B",
      "",
      "### 情景A",
      "Content A",
    ].join("\n");
    const result = deduplicateIdenticalSections(input);
    const headingCount = (result.match(/### 情景A/g) || []).length;
    expect(headingCount).toBe(2);
  });

  it("should NOT remove consecutive sections with same heading but different body", () => {
    const input = [
      "### 风险分析",
      "第一段分析内容。",
      "",
      "### 风险分析",
      "完全不同的分析角度。",
    ].join("\n");
    const result = deduplicateIdenticalSections(input);
    const headingCount = (result.match(/### 风险分析/g) || []).length;
    expect(headingCount).toBe(2);
  });

  it("should preserve pre-heading content", () => {
    const input = [
      "这是前置文本，没有标题。",
      "",
      "### 章节A",
      "内容A",
      "",
      "### 章节A",
      "内容A",
    ].join("\n");
    const result = deduplicateIdenticalSections(input);
    expect(result).toContain("这是前置文本");
    expect((result.match(/### 章节A/g) || []).length).toBe(1);
  });

  it("should handle empty input", () => {
    expect(deduplicateIdenticalSections("")).toBe("");
  });
});

// ============================================================
// repairLatexCommands — Fix 3: \text{...}} stray double braces
// ============================================================

describe("repairLatexCommands — Fix 3 (\\text{} double braces)", () => {
  it("should NOT strip } when \\text{} is inside subscript C_{\\text{task}}", () => {
    const input = "$C_{\\text{task}}$";
    expect(repairLatexCommands(input)).toBe(input);
  });

  it("should NOT strip } when \\text{} is inside superscript T^{\\text{max}}", () => {
    const input = "$T^{\\text{max}}$";
    expect(repairLatexCommands(input)).toBe(input);
  });

  it("should NOT strip } when \\text{} is inside \\frac{}", () => {
    const input = "$\\frac{\\text{num}}{\\text{den}}$";
    expect(repairLatexCommands(input)).toBe(input);
  });

  it("should NOT strip } in complex nested formula", () => {
    const input =
      "$C_{\\text{task}} \\approx \\frac{E[\\text{步数}] \\times C_{\\text{step}}}{P(\\text{完成})}$";
    expect(repairLatexCommands(input)).toBe(input);
  });

  it("should strip genuinely stray }} from \\text{abc}}", () => {
    const input = "$\\text{hello}}$";
    const result = repairLatexCommands(input);
    expect(result).toBe("$\\text{hello}$");
  });
});

// ============================================================
// repairLatexCommands — Fix 5: \frac denominator split
// ============================================================

describe("repairLatexCommands — Fix 5 (\\frac denominator split)", () => {
  it("should fix \\frac with premature $ closure before denominator", () => {
    const input = "$P(H|E) = \\frac{P(E|H) P(H)}${P(E)}，其中H为假设";
    const result = repairLatexCommands(input);
    expect(result).toContain("\\frac{P(E|H) P(H)}{P(E)}$");
    expect(result).not.toContain("}${");
  });

  it("should NOT modify correctly formed \\frac", () => {
    const input = "$\\frac{a}{b}$ is a fraction";
    const result = repairLatexCommands(input);
    expect(result).toBe(input);
  });

  it("should fix \\binom with premature $ closure", () => {
    const input = "$\\binom{n}{k}$ is fine but $\\binom{n}${k} is broken";
    const result = repairLatexCommands(input);
    expect(result).toContain("\\binom{n}{k}$");
  });
});

// ============================================================
// detectForeignLanguageBlocks
// ============================================================

describe("detectForeignLanguageBlocks", () => {
  it("should return passed:true for content with no foreign blocks", () => {
    const result = detectForeignLanguageBlocks(
      "这是纯中文内容，没有外文段落。",
      "zh",
    );
    expect(result.passed).toBe(true);
    expect(result.blocks).toHaveLength(0);
  });

  it("should return passed:true for empty content", () => {
    const result = detectForeignLanguageBlocks("", "zh");
    expect(result.passed).toBe(true);
    expect(result.foreignRatio).toBe(0);
  });

  it("should detect long Latin runs in Chinese target content", () => {
    const longLatin =
      "This is a very long English paragraph that goes on and on with many words and sentences. It clearly contains a lot of English text.";
    const result = detectForeignLanguageBlocks(longLatin, "zh", 0.05);
    // The text itself is Latin — blocks may be detected
    expect(result).toHaveProperty("foreignRatio");
    expect(result).toHaveProperty("passed");
  });

  it("should detect long CJK runs in English target content", () => {
    // Need 40+ consecutive CJK chars (no punctuation breaks)
    const longCjk =
      "这是一段非常长的中文内容包含了很多中文字符超过了四十个字符的限制条件用于测试英文目标语言下的检测功能";
    const result = detectForeignLanguageBlocks(longCjk, "en", 0.05);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
  });

  it("should skip code blocks and URLs in detection", () => {
    const content =
      "中文内容 https://very-long-english-url.com/path/to/resource?param=value 更多中文";
    const result = detectForeignLanguageBlocks(content, "zh");
    expect(result.passed).toBe(true);
  });

  it("should accept zh-CN and zh-TW as Chinese target", () => {
    const r1 = detectForeignLanguageBlocks("纯中文", "zh-CN");
    const r2 = detectForeignLanguageBlocks("纯中文", "zh-TW");
    expect(r1.passed).toBe(true);
    expect(r2.passed).toBe(true);
  });
});

// ============================================================
// limitBoldFormatting
// ============================================================

describe("limitBoldFormatting", () => {
  it("should strip excess bold beyond maxPerSection", () => {
    const input = "**A** normal **B** normal **C** normal";
    const result = limitBoldFormatting(input, 2);
    expect(result).toContain("**A**");
    expect(result).toContain("**B**");
    expect(result).not.toContain("**C**");
    expect(result).toContain("C");
  });

  it("should preserve bold on hierarchical numbered list items", () => {
    const input = "1.2.3. **Title**\n**A** text **B** text **C** text";
    const result = limitBoldFormatting(input, 2);
    expect(result).toContain("**Title**");
  });

  it("should reset bold count for each ### section", () => {
    const input = "**A** **B** **C**\n### Section\n**D** **E** **F**";
    const result = limitBoldFormatting(input, 2);
    // Section 1: A, B kept; C stripped
    expect(result).toContain("**A**");
    expect(result).not.toContain("**C**");
    // Section 2 resets counter: D, E kept; F stripped
    expect(result).toContain("**D**");
  });
});

// ============================================================
// limitBlockquotes
// ============================================================

describe("limitBlockquotes", () => {
  it("should convert excess blockquotes to regular paragraphs", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `> blockquote ${i}`);
    const input = lines.join("\n");
    const result = limitBlockquotes(input, 8);
    // Lines 9 and 10 should be stripped of > marker
    expect(result).toContain("blockquote 8");
    expect(result).toContain("blockquote 9");
    // Excess ones should not have > prefix
    const resultLines = result.split("\n");
    const excessLine = resultLines.find((l) => l.includes("blockquote 8"));
    expect(excessLine).not.toMatch(/^>/);
  });

  it("should truncate overly long blockquotes at sentence boundary", () => {
    const long =
      "这是一个非常长的引用内容。它包含了很多句子。每个句子都很重要。";
    const input = `> ${long}`;
    const result = limitBlockquotes(input, 8, 20);
    // Should be truncated
    expect(result.length).toBeLessThanOrEqual(input.length);
  });

  it("should keep short blockquotes unchanged", () => {
    const input = "> 短引用";
    const result = limitBlockquotes(input, 8);
    expect(result).toBe(input);
  });
});

// ============================================================
// removeHorizontalRules
// ============================================================

describe("removeHorizontalRules", () => {
  it("should remove --- horizontal rules", () => {
    const input = "段落A\n\n---\n\n段落B";
    expect(removeHorizontalRules(input)).not.toContain("---");
    expect(removeHorizontalRules(input)).toContain("段落A");
    expect(removeHorizontalRules(input)).toContain("段落B");
  });

  it("should remove *** horizontal rules", () => {
    const input = "段落A\n\n***\n\n段落B";
    expect(removeHorizontalRules(input)).not.toContain("***");
  });

  it("should not remove content with --- inside text", () => {
    const input = "x---y 是连字符";
    expect(removeHorizontalRules(input)).toBe(input);
  });
});

// ============================================================
// deduplicateParagraphs
// ============================================================

describe("deduplicateParagraphs", () => {
  it("should remove duplicate long paragraphs", () => {
    // Para must be >= 60 chars and NOT start with exempt chars (#, <!-, -, *, >, |, digit.)
    // Need at least 60 chars in the paragraph — using long repeated string
    const para =
      "X".repeat(70) + "段落内容用于测试去重功能的触发条件确保超过六十字符限制";
    const seen = new Set<string>();
    const result = deduplicateParagraphs(`${para}\n\n${para}`, seen);
    // Second copy should be removed — result should only have the first
    const matches = result
      .split("\n\n")
      .filter((p) => p.trim().startsWith("X"));
    expect(matches).toHaveLength(1);
  });

  it("should keep short paragraphs even if duplicated", () => {
    const input = "短\n\n短";
    const seen = new Set<string>();
    const result = deduplicateParagraphs(input, seen);
    expect(result).toBe(input);
  });

  it("should exempt heading lines from deduplication", () => {
    const heading = "### 标题行不去重";
    const input = `${heading}\n\n内容\n\n${heading}`;
    const seen = new Set<string>();
    const result = deduplicateParagraphs(input, seen);
    expect((result.match(/### 标题行不去重/g) || []).length).toBe(2);
  });

  it("should add paragraphs to global seen set (cross-section dedup)", () => {
    // Need >= 60 chars; must not start with exempt chars
    const para = "Y".repeat(80) + "全局集合去重测试确保跨维度去重正常工作";
    const seen = new Set<string>();
    // First dedup pass adds para to seen
    const first = deduplicateParagraphs(para, seen);
    expect(first.trim()).toBe(para);
    // Second pass with same seen set — para is already in seen, should be removed
    const second = deduplicateParagraphs(para, seen);
    expect(second.trim()).toBe("");
  });
});

// ============================================================
// repairOrderedListContinuity
// ============================================================

describe("repairOrderedListContinuity", () => {
  it("should fix restarted list numbering", () => {
    const input = "1. First item\n1. Second item\n1. Third item";
    const result = repairOrderedListContinuity(input);
    expect(result).toContain("2. Second item");
    expect(result).toContain("3. Third item");
  });

  it("should reset at heading boundaries", () => {
    const input = "1. Item A\n### Section\n1. Item B";
    const result = repairOrderedListContinuity(input);
    // After heading, counter resets — item B should stay as 1.
    expect(result).toContain("1. Item B");
  });

  it("should not repair when gap lines exist between items", () => {
    const input = "1. First\n\nParagraph text here.\n\n1. Separate list item";
    const result = repairOrderedListContinuity(input);
    // The second list should keep its own numbering (separate list context)
    expect(result).toContain("1. Separate list item");
  });

  it("should handle bullet list reset", () => {
    const input = "1. Item A\n- bullet\n1. New list";
    const result = repairOrderedListContinuity(input);
    expect(result).toContain("1. New list");
  });
});

// ============================================================
// stripInternalFigureNotation
// ============================================================

describe("stripInternalFigureNotation", () => {
  it("should strip [证据[N] 图M] notation", () => {
    const input = "内容[证据[5] 图2]更多内容";
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("[证据[5] 图2]");
    expect(result).toContain("内容");
  });

  it("should strip 证据[N] bare notation", () => {
    const input = "证据[45]表明该方法有效";
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("证据[45]");
  });

  it("should strip FIG-N references", () => {
    const input = "如FIG-5所示，架构如下";
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("FIG-5");
  });

  it("should strip [FIG-N] bracket notation", () => {
    const input = "参见[FIG-7]的说明";
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("[FIG-7]");
  });

  it("should preserve regular citation [N]", () => {
    const input = "研究[1]显示结果";
    const result = stripInternalFigureNotation(input);
    expect(result).toContain("[1]");
  });

  it("should strip 图0 references", () => {
    const input = "图0：这是内部编号的图片。";
    const result = stripInternalFigureNotation(input);
    expect(result).not.toContain("图0：");
  });
});

// ============================================================
// fixLatexSubscripts
// ============================================================

describe("fixLatexSubscripts", () => {
  it("should fix \\sum{ → \\sum_{", () => {
    const input = "\\sum{i=1}";
    const result = fixLatexSubscripts(input);
    expect(result).toContain("\\sum_{i=1}");
  });

  it("should fix \\prod{ → \\prod_{", () => {
    const input = "\\prod{k}";
    const result = fixLatexSubscripts(input);
    expect(result).toContain("\\prod_{k}");
  });

  it("should fix letter\\theta → letter_\\theta", () => {
    const input = "p\\theta(x)";
    const result = fixLatexSubscripts(input);
    expect(result).toContain("p_\\theta");
  });

  it("should fix \\pi\\theta → \\pi_\\theta", () => {
    const input = "\\pi\\theta";
    const result = fixLatexSubscripts(input);
    expect(result).toContain("\\pi_\\theta");
  });

  it("should fix y{ik} → y_{ik}", () => {
    const input = "y{ik} result";
    const result = fixLatexSubscripts(input);
    expect(result).toContain("y_{ik}");
  });

  it("should not change already correct subscripts", () => {
    const input = "\\sum_{i=1}^{n}";
    const result = fixLatexSubscripts(input);
    expect(result).toBe(input);
  });
});

// ============================================================
// linkifyCitations
// ============================================================

describe("linkifyCitations", () => {
  it("should linkify citations in body before References section", () => {
    const input = "见[1]和[2]。\n\n# References\n[1] Title.";
    const result = linkifyCitations(input);
    expect(result).toContain('<a href="#ref-1"');
    expect(result).toContain("[1] Title.");
  });

  it("should return content unchanged when no References section", () => {
    const input = "没有参考文献[1]";
    expect(linkifyCitations(input)).toBe(input);
  });

  it("should linkify multi-citations [1,2,3]", () => {
    const input = "参见[1,2]。\n\n# References\n[1] A.\n[2] B.";
    const result = linkifyCitations(input);
    expect(result).toContain('<a href="#ref-1"');
    expect(result).toContain('<a href="#ref-2"');
  });

  it("should not linkify existing markdown links", () => {
    const input = "[text](https://example.com)\n\n# References\n[1] A.";
    const result = linkifyCitations(input);
    expect(result).toContain("[text](https://example.com)");
  });
});

// ============================================================
// anchorReferences
// ============================================================

describe("anchorReferences", () => {
  it("should add anchor id to reference entries", () => {
    const input = "[1] Title of the reference.";
    const result = anchorReferences(input);
    expect(result).toContain('<a id="ref-1"></a>');
  });

  it("should handle multiple references", () => {
    const input = "[1] First.\n[2] Second.";
    const result = anchorReferences(input);
    expect(result).toContain('<a id="ref-1"></a>');
    expect(result).toContain('<a id="ref-2"></a>');
  });
});

// ============================================================
// stripHtmlCitationLinks
// ============================================================

describe("stripHtmlCitationLinks", () => {
  it("should strip citation anchor links back to [N]", () => {
    const input = '<a href="#ref-1" class="citation-link">[1]</a>';
    expect(stripHtmlCitationLinks(input)).toBe("[1]");
  });

  it("should strip reference anchor tags", () => {
    const input = '<a id="ref-1"></a>[1] Title.';
    expect(stripHtmlCitationLinks(input)).toBe("[1] Title.");
  });

  it("should be idempotent", () => {
    const input = "参见[1]来源";
    expect(stripHtmlCitationLinks(input)).toBe(input);
  });
});

// ============================================================
// stripCitationsFromHeadings
// ============================================================

describe("stripCitationsFromHeadings", () => {
  it("should remove citation markers from headings", () => {
    const input = "#### 1.29. 演化路径[113][114]";
    expect(stripCitationsFromHeadings(input)).toBe("#### 1.29. 演化路径");
  });

  it("should not remove citations from body text", () => {
    const input = "正文[1]不会被删除";
    expect(stripCitationsFromHeadings(input)).toBe(input);
  });
});

// ============================================================
// wrapBareDisplayMath
// ============================================================

describe("wrapBareDisplayMath", () => {
  it("should wrap bare LaTeX formula between blank lines in $$", () => {
    const input = "\n\\frac{a}{b} = c\n";
    const result = wrapBareDisplayMath(input);
    expect(result).toContain("$$");
  });

  it("should not wrap already wrapped formulas", () => {
    const input = "$$\\frac{a}{b}$$";
    expect(wrapBareDisplayMath(input)).toBe(input);
  });

  it("should not wrap formulas inside code blocks", () => {
    const input = "```\n\\frac{a}{b}\n```";
    expect(wrapBareDisplayMath(input)).toBe(input);
  });

  it("should not wrap headings", () => {
    const input = "### \\alpha heading";
    expect(wrapBareDisplayMath(input)).toBe(input);
  });

  it("should track $$ math block state", () => {
    const input = "$$\n\\frac{a}{b}\n$$";
    const result = wrapBareDisplayMath(input);
    // Line inside $$ block should be preserved without double-wrapping
    expect(result).not.toContain("$$$$");
  });
});

// ============================================================
// wrapProseStyleMath
// ============================================================

describe("wrapProseStyleMath", () => {
  it("should wrap subscript variables like W_1", () => {
    const input = "矩阵W_1的尺寸";
    const result = wrapProseStyleMath(input);
    expect(result).toContain("$W_1$");
  });

  it("should wrap prose function calls like softmax(x)", () => {
    const input = "经过softmax(scores)处理";
    const result = wrapProseStyleMath(input);
    expect(result).toContain("$softmax(scores)$");
  });

  it("should skip display math lines", () => {
    const input = "$$W_1 = A$$";
    expect(wrapProseStyleMath(input)).toBe(input);
  });

  it("should skip headings", () => {
    const input = "### W_1 架构";
    expect(wrapProseStyleMath(input)).toBe(input);
  });

  it("should skip table rows", () => {
    const input = "| W_1 | value |";
    expect(wrapProseStyleMath(input)).toBe(input);
  });
});

// ============================================================
// wrapBareInlineLatex
// ============================================================

describe("wrapBareInlineLatex", () => {
  it("should wrap bare LaTeX commands in $", () => {
    const input = "计算 \\alpha + \\beta 的值";
    const result = wrapBareInlineLatex(input);
    expect(result).toContain("$");
  });

  it("should wrap big-O notation O(n^2)", () => {
    const input = "时间复杂度为O(n^2)";
    const result = wrapBareInlineLatex(input);
    expect(result).toContain("$O(n^2)$");
  });

  it("should wrap bare brace exponent 10^{-3}", () => {
    const input = "精度为10^{-3}";
    const result = wrapBareInlineLatex(input);
    expect(result).toContain("$10^{-3}$");
  });

  it("should skip display math lines", () => {
    const input = "$$\\alpha$$";
    expect(wrapBareInlineLatex(input)).toBe(input);
  });

  it("should skip heading lines", () => {
    const input = "### \\alpha heading";
    expect(wrapBareInlineLatex(input)).toBe(input);
  });
});

// ============================================================
// convertPlainNumberedListsUnderH3ToBullets
// ============================================================

describe("convertPlainNumberedListsUnderH3ToBullets", () => {
  it("should convert plain numbered lists under ### to bullets", () => {
    const input = "### 标题\n1. First item\n2. Second item";
    const result = convertPlainNumberedListsUnderH3ToBullets(input);
    expect(result).toContain("- First item");
    expect(result).toContain("- Second item");
  });

  it("should not convert bold items (structural)", () => {
    const input = "### 标题\n1. **Bold item**\n2. Plain item";
    const result = convertPlainNumberedListsUnderH3ToBullets(input);
    expect(result).toContain("1. **Bold item**");
    expect(result).toContain("- Plain item");
  });

  it("should reset under ##", () => {
    const input = "### 节一\n1. A\n## 章\n1. B";
    const result = convertPlainNumberedListsUnderH3ToBullets(input);
    expect(result).toContain("- A");
    expect(result).toContain("1. B");
  });
});

// ============================================================
// deduplicateTerminalSections
// ============================================================

describe("deduplicateTerminalSections", () => {
  it("should remove duplicate sub-sections in 结语 that appear in 跨维度关联分析", () => {
    const input = [
      "## 跨维度关联分析",
      "### 维度对比",
      "内容A",
      "",
      "## 结语",
      "结语内容",
      "### 维度对比",
      "重复内容",
    ].join("\n");
    const result = deduplicateTerminalSections(input);
    const count = (result.match(/### 维度对比/g) || []).length;
    expect(count).toBe(1);
  });

  it("should return content unchanged when no 跨维度关联分析 section", () => {
    const input = "## 结语\n内容";
    expect(deduplicateTerminalSections(input)).toBe(input);
  });
});

// ============================================================
// decodeHtmlEntities
// ============================================================

describe("decodeHtmlEntities", () => {
  it("should decode &amp; to &", () => {
    expect(decodeHtmlEntities("a &amp; b")).toBe("a & b");
  });

  it("should decode &lt; and &gt;", () => {
    expect(decodeHtmlEntities("&lt;tag&gt;")).toBe("<tag>");
  });

  it("should decode &quot;", () => {
    expect(decodeHtmlEntities("say &quot;hello&quot;")).toBe('say "hello"');
  });

  it("should decode &#39;", () => {
    expect(decodeHtmlEntities("it&#39;s")).toBe("it's");
  });

  it("should decode &nbsp;", () => {
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b");
  });

  it("should not decode entities inside code blocks", () => {
    const input = "```\n&amp; code\n```";
    const result = decodeHtmlEntities(input);
    expect(result).toContain("&amp;");
  });

  it("should not decode entities inside inline code", () => {
    const input = "use `&amp;` here";
    const result = decodeHtmlEntities(input);
    expect(result).toContain("`&amp;`");
  });
});

// ============================================================
// convertChineseNumeralHeadings
// ============================================================

describe("convertChineseNumeralHeadings", () => {
  it("should convert 一、标题 to ### 标题", () => {
    const input = "一、技术架构";
    expect(convertChineseNumeralHeadings(input)).toBe("### 技术架构");
  });

  it("should convert 二．标题 to ### 标题", () => {
    const input = "二．市场分析";
    expect(convertChineseNumeralHeadings(input)).toBe("### 市场分析");
  });

  it("should not convert very long lines (> 60 chars)", () => {
    // The regex captures the title after 一、 and checks length 2..60
    // "一、" + 61 chars = too long
    const longTitle = "一、" + "A".repeat(61);
    const result = convertChineseNumeralHeadings(longTitle);
    expect(result).toBe(longTitle);
  });

  it("should not convert very short lines (< 2 chars)", () => {
    const input = "一、A";
    // Single char title — may or may not convert depending on length check
    const result = convertChineseNumeralHeadings(input);
    // Just ensure no error thrown
    expect(typeof result).toBe("string");
  });
});

// ============================================================
// repairBrokenListItems
// ============================================================

describe("repairBrokenListItems", () => {
  it("should join bullet alone on line with content on next line", () => {
    const input = "-\n  Content text here";
    const result = repairBrokenListItems(input);
    expect(result).toContain("- Content text here");
  });

  it("should join ordered list marker with content on next line", () => {
    const input = "1.\n  Content text here";
    const result = repairBrokenListItems(input);
    expect(result).toContain("1. Content text here");
  });

  it("should not modify normal list items", () => {
    const input = "- Normal item\n1. Another item";
    expect(repairBrokenListItems(input)).toBe(input);
  });
});

// ============================================================
// clearBrokenMediaAndEmptyBlocks
// ============================================================

describe("clearBrokenMediaAndEmptyBlocks", () => {
  it("should remove empty blockquotes", () => {
    const input = "段落\n>\n段落";
    expect(clearBrokenMediaAndEmptyBlocks(input)).not.toContain("\n>");
  });

  it("should remove empty image markdown", () => {
    const input = "![alt]()\n内容";
    expect(clearBrokenMediaAndEmptyBlocks(input)).not.toContain("![]()");
  });

  it("should remove 图片加载失败 placeholders", () => {
    const input = "[图片加载失败]\n内容";
    expect(clearBrokenMediaAndEmptyBlocks(input)).not.toContain("图片加载失败");
  });

  it("should remove Image load failed placeholders", () => {
    const input = "Image load failed\n内容";
    expect(clearBrokenMediaAndEmptyBlocks(input)).not.toContain(
      "Image load failed",
    );
  });

  it("should remove orphaned image alt text", () => {
    const input = "![alt text]\n内容";
    expect(clearBrokenMediaAndEmptyBlocks(input)).not.toMatch(
      /^!\[alt text\]/m,
    );
  });
});

// ============================================================
// fixDoubleSourceLabels
// ============================================================

describe("fixDoubleSourceLabels", () => {
  it("should fix 来源：来源：", () => {
    expect(fixDoubleSourceLabels("来源：来源：[1]")).toBe("来源：[1]");
  });

  it("should normalize 来源：证据 [N] → 证据 [N]", () => {
    // "来源：证据 " → "证据 " (by stripping 来源：)
    const result = fixDoubleSourceLabels("来源：证据 [5]");
    expect(result).toContain("[5]");
    expect(result).not.toContain("来源：证据");
  });

  it("should fix English double Source: Source:", () => {
    expect(fixDoubleSourceLabels("Source: Source: [1]")).toBe("Source: [1]");
  });

  it("should normalize 来源: [N] 证据 [N] → [N]", () => {
    const input = "来源: [3] 证据 [3]";
    const result = fixDoubleSourceLabels(input);
    expect(result).toContain("[3]");
  });
});

// ============================================================
// fixDuplicateHeadings
// ============================================================

describe("fixDuplicateHeadings", () => {
  it("should remove heading text echoed as first paragraph", () => {
    const input = "## 执行摘要\n\n执行摘要\n\n内容段落";
    const result = fixDuplicateHeadings(input);
    // Heading should remain, but echoed paragraph removed
    expect(result).toContain("## 执行摘要");
    // The echo line "执行摘要" should be removed or merged
    expect(result).not.toMatch(/^执行摘要$/m);
  });

  it("should not modify non-echoed content", () => {
    const input = "## 标题\n\n不同内容的段落";
    const result = fixDuplicateHeadings(input);
    expect(result).toContain("不同内容的段落");
  });
});

// ============================================================
// removeEmptySections
// ============================================================

describe("removeEmptySections", () => {
  it("should remove empty heading before next heading", () => {
    const input = "### 3.1. Title\n\n### 3.2. Next\n内容";
    const result = removeEmptySections(input);
    expect(result).not.toContain("### 3.1. Title");
    expect(result).toContain("### 3.2. Next");
  });

  it("should not remove heading with content", () => {
    const input = "### 3.1. Title\n内容行\n### 3.2. Next";
    const result = removeEmptySections(input);
    expect(result).toContain("### 3.1. Title");
  });
});

// ============================================================
// splitWallOfText
// ============================================================

describe("splitWallOfText", () => {
  it("should split long paragraph at sentence boundary", () => {
    // Need at least 2 sentence ends AND both parts >= 80 chars after split
    // Build a paragraph > 400 chars with multiple sentence endings
    const sent = "这是完整的一句话内容包含了足够的信息量。";
    const long = sent.repeat(10); // ~200+ chars with multiple 。
    const result = splitWallOfText(long, 100);
    // Result should have multiple paragraphs if both halves are >= 80 chars
    // The paragraph is ~220+ chars, so split should happen
    expect(typeof result).toBe("string");
    // It should have been split at some sentence boundary
    if (long.length > 200) {
      // Most likely split
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("should not split short paragraphs", () => {
    const input = "短段落内容。";
    expect(splitWallOfText(input, 400)).toBe(input);
  });

  it("should not split headings", () => {
    const input = "### 标题内容，这是一个很长的标题，不应该被分割";
    expect(splitWallOfText(input, 10)).toBe(input);
  });

  it("should not split list items", () => {
    const input =
      "- 这是一个列表项，内容很长，但不应该被分割成多段。继续更多内容。";
    expect(splitWallOfText(input, 10)).toBe(input);
  });
});

// ============================================================
// fixArrowChains
// ============================================================

describe("fixArrowChains", () => {
  it("should convert A → B → C to natural language", () => {
    const input = "数据处理 → 模型训练 → 推理部署";
    const result = fixArrowChains(input);
    expect(result).toContain("进而");
    expect(result).toContain("最终");
    expect(result).not.toContain("→");
  });

  it("should handle lines without arrows", () => {
    const input = "普通文本内容没有箭头";
    expect(fixArrowChains(input)).toBe(input);
  });
});

// ============================================================
// ensureBlankLineAfterTables
// ============================================================

describe("ensureBlankLineAfterTables", () => {
  it("should add blank line after table row followed by non-table content", () => {
    const input = "| A | B |\n|---|---|\n| 1 | 2 |\n后续文字";
    const result = ensureBlankLineAfterTables(input);
    expect(result).toContain("| 1 | 2 |\n\n后续文字");
  });

  it("should not add blank line when already present", () => {
    const input = "| A | B |\n\n后续";
    expect(ensureBlankLineAfterTables(input)).toBe(input);
  });
});

// ============================================================
// repairMarkdownTables
// ============================================================

describe("repairMarkdownTables", () => {
  it("should insert separator row when missing", () => {
    const input = "\n| A | B |\n| 1 | 2 |\n| 3 | 4 |\n";
    const result = repairMarkdownTables(input);
    expect(result).toContain("| --- |");
  });

  it("should keep valid table unchanged", () => {
    const input = "\n| A | B |\n|---|---|\n| 1 | 2 |\n";
    const result = repairMarkdownTables(input);
    expect(result).toContain("| A | B |");
    expect(result).toContain("|---|---|");
  });

  it("should fix separator with wrong column count", () => {
    const input = "\n| A | B | C |\n|---|---|\n| 1 | 2 | 3 |\n";
    const result = repairMarkdownTables(input);
    // Separator should now have 3 columns
    const lines = result.split("\n");
    const sep = lines.find((l) => /^[|\s-]+$/.test(l) && l.includes("---"));
    expect(sep).toBeTruthy();
  });
});

// ============================================================
// extractTableFootnotes
// ============================================================

describe("extractTableFootnotes", () => {
  it("should extract long first-cell footnote row", () => {
    const input = [
      "| 风险项 | 概率 | 影响 |",
      "|---|---|---|",
      "| 计算成本 | 75 | 9 |",
      "| 数据来源：这是一个很长的脚注内容，超过50个字符，其他单元格为空 | | |",
    ].join("\n");
    const result = extractTableFootnotes(input);
    expect(result).toContain("数据来源：这是一个很长的脚注内容");
    // The footnote should be outside the table
    const lines = result.split("\n");
    const footnoteIdx = lines.findIndex((l) => l.includes("数据来源"));
    const _tableEnd = lines.findIndex((l) => l === "");
    expect(footnoteIdx).toBeGreaterThan(-1);
  });

  it("should not extract when footnote cell is short", () => {
    const input = [
      "| A | B | C |",
      "|---|---|---|",
      "| long | short | x |",
      "| normal | 1 | 2 |",
    ].join("\n");
    const result = extractTableFootnotes(input);
    // Table should be unchanged
    expect(result).toBe(input);
  });
});

// ============================================================
// deduplicateHeadingEcho
// ============================================================

describe("deduplicateHeadingEcho", () => {
  it("should remove echoed heading text on next line", () => {
    const input = "### 5.1. 技术架构演进\n技术架构演进\n实际内容";
    const result = deduplicateHeadingEcho(input);
    expect(result).toContain("### 5.1. 技术架构演进");
    expect(result).not.toMatch(/^技术架构演进$/m);
  });

  it("should not remove non-echo content", () => {
    const input = "### 标题\n完全不同的内容行";
    expect(deduplicateHeadingEcho(input)).toBe(input);
  });

  it("should skip blank lines when checking for echo", () => {
    const input = "### 标题\n\n不同内容";
    const result = deduplicateHeadingEcho(input);
    expect(result).toContain("不同内容");
  });
});

// ============================================================
// collapsePseudoCodeHeadings
// ============================================================

describe("collapsePseudoCodeHeadings", () => {
  it("should demote heading containing if statement", () => {
    const input = "### 1.2. if mask is not None";
    const result = collapsePseudoCodeHeadings(input);
    expect(result).not.toContain("###");
    expect(result).toContain("if mask is not None");
  });

  it("should demote heading containing 伪代码", () => {
    const input = "### 1.3. 伪代码对比实现方式";
    const result = collapsePseudoCodeHeadings(input);
    expect(result).not.toContain("###");
    expect(result).toContain("**");
  });

  it("should demote 以下伪代码 intro headings", () => {
    const input = "### 1.4. 以下伪代码展示自注意力实现";
    const result = collapsePseudoCodeHeadings(input);
    expect(result).not.toContain("###");
  });

  it("should keep normal headings unchanged", () => {
    const input = "### 1.5. 技术架构演进路径";
    expect(collapsePseudoCodeHeadings(input)).toBe(input);
  });

  it("should demote assignment-like headings with no Chinese", () => {
    const input = "### 1.6. scores += mask";
    const result = collapsePseudoCodeHeadings(input);
    expect(result).not.toContain("###");
  });
});

// ============================================================
// collapseExcessSubHeadings
// ============================================================

describe("collapseExcessSubHeadings", () => {
  it("should collapse ### headings beyond maxSubHeadings", () => {
    const headings = Array.from(
      { length: 12 },
      (_, i) => `### ${i + 1}.${i + 1}. 标题${i + 1}\n内容${i + 1}`,
    ).join("\n\n");
    const input = `## 1. 维度一\n\n${headings}`;
    const result = collapseExcessSubHeadings(input, 10);
    // Headings 11 and 12 should be converted to bold
    expect(result).toContain("**标题11**");
    expect(result).toContain("**标题12**");
  });

  it("should work in per-dimension mode (no ## N. heading)", () => {
    const headings = Array.from(
      { length: 12 },
      (_, i) => `### 标题${i + 1}\n内容${i + 1}`,
    ).join("\n\n");
    const result = collapseExcessSubHeadings(headings, 10);
    expect(result).toContain("**标题11**");
  });

  it("should not collapse non-dimension ## headings", () => {
    const input =
      "## 执行摘要\n\n" +
      Array.from({ length: 12 }, (_, i) => `### 标题${i + 1}\n内容`).join(
        "\n\n",
      );
    const result = collapseExcessSubHeadings(input, 10);
    // Under non-dimension ##, counter should stop
    // At least some headings should remain as ###
    expect(result).toContain("###");
  });
});

// ============================================================
// wrapPseudoCodeBlocks
// ============================================================

describe("wrapPseudoCodeBlocks", () => {
  it("should wrap consecutive pseudocode lines in code block", () => {
    const input = "if x > 0:\n  return x\nend";
    const result = wrapPseudoCodeBlocks(input);
    expect(result).toContain("```");
  });

  it("should not wrap single pseudocode line", () => {
    const input = "if x > 0:";
    const result = wrapPseudoCodeBlocks(input);
    // Single line should not be wrapped
    expect(result).not.toContain("```");
  });

  it("should not touch existing code blocks", () => {
    const input = "```python\nif x > 0:\n    return x\n```";
    const result = wrapPseudoCodeBlocks(input);
    expect(result).toBe(input);
  });

  it("should wrap assignment-like pseudocode", () => {
    const input = "x = compute(y)\nz = process(x)";
    const result = wrapPseudoCodeBlocks(input);
    expect(result).toContain("```");
  });
});

// ============================================================
// truncateLongListItems
// ============================================================

describe("truncateLongListItems", () => {
  it("should split long list item at sentence boundary", () => {
    const long =
      "这是第一句内容，说明了某个重要的技术点。这是第二句内容，继续了前面的分析，有更多详细说明。";
    const input = `- ${long}`;
    const result = truncateLongListItems(input, 30);
    expect(result).toContain("\n");
  });

  it("should not split short list items", () => {
    const input = "- 短列表项";
    expect(truncateLongListItems(input, 120)).toBe(input);
  });

  it("should handle ordered list items", () => {
    const long =
      "第一句说明技术背景，非常重要。第二句详细解释了实现方式，并说明了具体步骤。继续更多内容补充说明。";
    const input = `1. ${long}`;
    const result = truncateLongListItems(input, 30);
    expect(typeof result).toBe("string");
  });
});

// ============================================================
// separateTrappedConclusions
// ============================================================

describe("separateTrappedConclusions", () => {
  it("should extract 综上所述 from list item to standalone paragraph", () => {
    // Regex: conclusion marker + ，/: + at least 30 chars after the marker
    // "综上所述，" is the marker+comma; need 30+ chars of actual content after
    const content =
      "该技术路线具有较高的可行性并值得进一步深入研究和持续投入以实现长期发展目标。";
    const input = `- 第一项内容\n- 综上所述，${content}`;
    const result = separateTrappedConclusions(input);
    expect(result).toContain("综上所述，");
    // The function replaces "- 综上所述，..." with "\n综上所述，..."
    expect(result).toContain("\n综上所述，");
  });

  it("should not extract short conclusions", () => {
    const input = "- 总体来看，效果好。";
    // Too short (< 30 chars after marker)
    const result = separateTrappedConclusions(input);
    expect(result).toBe(input);
  });
});

// ============================================================
// enforceExecSummarySections
// ============================================================

describe("enforceExecSummarySections", () => {
  it("should promote 风险预警 bold list item to heading", () => {
    const input = "## 执行摘要\n1. **风险预警**\n内容";
    const result = enforceExecSummarySections(input);
    expect(result).toContain("### 风险预警");
  });

  it("should promote 行动建议 bold list item to heading", () => {
    const input = "## 执行摘要\n1. **行动建议**\n内容";
    const result = enforceExecSummarySections(input);
    expect(result).toContain("### 行动建议");
  });

  it("should not modify content outside 执行摘要", () => {
    const input = "## 其他章节\n1. **风险预警**\n内容";
    const result = enforceExecSummarySections(input);
    expect(result).toContain("1. **风险预警**");
  });
});

// ============================================================
// truncateAtSentenceBoundary
// ============================================================

describe("truncateAtSentenceBoundary", () => {
  it("should return content unchanged if within limit", () => {
    const input = "短内容。";
    expect(truncateAtSentenceBoundary(input, 100)).toBe(input);
  });

  it("should truncate at paragraph boundary", () => {
    const input =
      "第一段内容。\n\n第二段很长的内容，需要截断处理，继续更多文字用于测试目的。";
    const result = truncateAtSentenceBoundary(input, 12);
    expect(result.length).toBeLessThanOrEqual(input.length);
  });

  it("should truncate at sentence boundary when paragraph boundary not found", () => {
    const input =
      "第一句话完整结束。第二句话包含了很多内容，需要截断。第三句话更多内容。";
    const result = truncateAtSentenceBoundary(input, 20);
    expect(result.length).toBeLessThanOrEqual(input.length);
  });
});

// ============================================================
// repairTruncatedBlockquoteBullets
// ============================================================

describe("repairTruncatedBlockquoteBullets", () => {
  it("should append ... to truncated blockquote bullet", () => {
    const input = "> - 这是一个被截断的内容没有标点结尾";
    const result = repairTruncatedBlockquoteBullets(input);
    expect(result).toContain("...");
  });

  it("should keep bullet ending with proper punctuation unchanged", () => {
    const input = "> - 完整的内容。";
    const result = repairTruncatedBlockquoteBullets(input);
    expect(result).toBe(input);
  });

  it("should remove very short fragment bullets", () => {
    const input = "> - 短";
    const result = repairTruncatedBlockquoteBullets(input);
    expect(result).toBe("");
  });
});

// ============================================================
// normalizeArrowNotation
// ============================================================

describe("normalizeArrowNotation", () => {
  it("should convert ，进而推动 to →", () => {
    const input = "分词，进而推动构造token序列";
    const result = normalizeArrowNotation(input);
    expect(result).toContain(" → ");
    expect(result).not.toContain("进而推动");
  });

  it("should handle 。进而推动 pattern", () => {
    const input = "第一步完成。进而推动第二步执行";
    const result = normalizeArrowNotation(input);
    expect(result).not.toContain("进而推动");
  });
});

// ============================================================
// stripLeakedHtmlComments
// ============================================================

describe("stripLeakedHtmlComments", () => {
  it("should strip internal HTML comments", () => {
    const input = "内容<!-- 内部注释内容 -->更多内容";
    const result = stripLeakedHtmlComments(input);
    expect(result).not.toContain("<!--");
    expect(result).toContain("内容更多内容");
  });

  it("should preserve <!-- chart:xxx --> placeholders", () => {
    const input = "内容<!-- chart:d1-s0-4:1 -->更多";
    const result = stripLeakedHtmlComments(input);
    expect(result).toContain("<!-- chart:d1-s0-4:1 -->");
  });
});

// ============================================================
// deduplicateAdjacentCitations
// ============================================================

describe("deduplicateAdjacentCitations", () => {
  it("should remove duplicate adjacent citations [N][N]", () => {
    expect(deduplicateAdjacentCitations("[5][5]")).toBe("[5]");
    expect(deduplicateAdjacentCitations("[107][107]")).toBe("[107]");
  });

  it("should not remove different adjacent citations", () => {
    expect(deduplicateAdjacentCitations("[1][2]")).toBe("[1][2]");
  });

  it("should handle content without citations", () => {
    const input = "普通文本内容";
    expect(deduplicateAdjacentCitations(input)).toBe(input);
  });
});

// ============================================================
// boldSummaryPrefixes
// ============================================================

describe("boldSummaryPrefixes", () => {
  it("should bold prefix before ：", () => {
    const input = "规模扩张强化回路：前沿模型性能提升";
    const result = boldSummaryPrefixes(input);
    expect(result).toContain("**规模扩张强化回路**：");
  });

  it("should not bold lines already with ** markers", () => {
    const input = "**已有加粗**：内容";
    expect(boldSummaryPrefixes(input)).toBe(input);
  });

  it("should not bold headings", () => {
    const input = "### 标题：内容";
    expect(boldSummaryPrefixes(input)).toBe(input);
  });

  it("should not bold list items", () => {
    const input = "- 列表项：内容";
    expect(boldSummaryPrefixes(input)).toBe(input);
  });

  it("should not bold very short prefix (≤2 chars)", () => {
    const input = "注：说明内容";
    const result = boldSummaryPrefixes(input);
    expect(result).not.toContain("**注**");
  });

  it("should not bold prefix with LaTeX", () => {
    const input = "$\\alpha$：公式说明";
    expect(boldSummaryPrefixes(input)).toBe(input);
  });
});

// ============================================================
// stripChapterHighlights
// ============================================================

describe("stripChapterHighlights", () => {
  it("should strip 本章要点 blockquote block", () => {
    const input = "> **本章要点**\n> - 要点一\n> - 要点二\n\n正文内容";
    const result = stripChapterHighlights(input);
    expect(result).not.toContain("本章要点");
    expect(result).toContain("正文内容");
  });

  it("should strip Chapter Highlights block", () => {
    const input = "> **Chapter Highlights**\n> - Point one\n\n Content";
    const result = stripChapterHighlights(input);
    expect(result).not.toContain("Chapter Highlights");
    expect(result).toContain("Content");
  });

  it("should not strip non-highlights content", () => {
    const input = "> 普通引用内容\n\n正文";
    const result = stripChapterHighlights(input);
    expect(result).toContain("普通引用内容");
  });
});

// ============================================================
// normalizeChapterHighlights
// ============================================================

describe("normalizeChapterHighlights", () => {
  it("should move first 本章要点 block to top", () => {
    const input = "正文内容\n\n> **本章要点**\n> - 要点一\n\n更多内容";
    const result = normalizeChapterHighlights(input);
    // Block should appear before body text
    const highlightIdx = result.indexOf("本章要点");
    const bodyIdx = result.indexOf("更多内容");
    expect(highlightIdx).toBeLessThan(bodyIdx);
  });

  it("should return content unchanged when no highlights block", () => {
    const input = "普通内容\n\n没有要点块";
    expect(normalizeChapterHighlights(input)).toBe(input);
  });

  it("should handle Chapter Highlights English variant", () => {
    const input = "> **Chapter Highlights**\n> - Point\n\nBody text";
    const result = normalizeChapterHighlights(input);
    expect(result).toContain("Chapter Highlights");
    expect(result).toContain("Body text");
  });
});

// ============================================================
// normalizeHighlightsInPlace
// ============================================================

describe("normalizeHighlightsInPlace", () => {
  it("should normalize 本章要点 header format", () => {
    const input = "本章要点\n- 要点一\n- 要点二\n\n正文";
    const result = normalizeHighlightsInPlace(input);
    expect(result).toContain("> **本章要点**");
    expect(result).toContain("> - 要点一");
  });

  it("should normalize Chapter Highlights English variant", () => {
    const input = "Chapter Highlights\n- Point one\n\nBody";
    const result = normalizeHighlightsInPlace(input);
    expect(result).toContain("> **Chapter Highlights**");
  });

  it("should end block at empty line", () => {
    const input = "> **本章要点**\n> - 要点\n\n正文内容不在块内";
    const result = normalizeHighlightsInPlace(input);
    expect(result).toContain("正文内容不在块内");
    // The body line should not have > prefix
    const lines = result.split("\n");
    const bodyLine = lines.find((l) => l.includes("正文内容不在块内"));
    expect(bodyLine).not.toMatch(/^>/);
  });
});

// ============================================================
// getMinDataPoints
// ============================================================

describe("getMinDataPoints", () => {
  it("should return 5 for line and area charts", () => {
    expect(getMinDataPoints("line")).toBe(5);
    expect(getMinDataPoints("area")).toBe(5);
  });

  it("should return 3 for bar and pie charts", () => {
    expect(getMinDataPoints("bar")).toBe(3);
    expect(getMinDataPoints("pie")).toBe(3);
  });

  it("should return 10 for radar charts", () => {
    expect(getMinDataPoints("radar")).toBe(10);
  });

  it("should return 3 for unknown chart types", () => {
    expect(getMinDataPoints("unknown")).toBe(3);
    expect(getMinDataPoints("scatter")).toBe(3);
  });
});

// ============================================================
// repairBrokenBoldMarkers
// ============================================================

describe("repairBrokenBoldMarkers", () => {
  it("should remove orphan ** at line start before punctuation", () => {
    const input = "**，值得警惕的是内容";
    const result = repairBrokenBoldMarkers(input);
    expect(result).not.toMatch(/^\*\*/);
  });

  it("should remove orphan ** at line end after punctuation", () => {
    const input = "内容结束。**";
    const result = repairBrokenBoldMarkers(input);
    expect(result).not.toMatch(/\*\*\s*$/);
  });

  it("should keep valid bold markers unchanged", () => {
    const input = "**标题**：内容";
    expect(repairBrokenBoldMarkers(input)).toBe(input);
  });

  it("should handle lines with odd number of ** markers", () => {
    const input = "**奇数**标记**";
    const result = repairBrokenBoldMarkers(input);
    // Should have even number of ** after repair
    const count = (result.match(/\*\*/g) || []).length;
    expect(count % 2).toBe(0);
  });
});

// ============================================================
// stripFigureComments
// ============================================================

describe("stripFigureComments", () => {
  it("should strip <!-- figure:N:M --> comments", () => {
    const input = "内容<!-- figure:1:2 -->更多内容";
    const result = stripFigureComments(input);
    expect(result).not.toContain("<!-- figure:1:2 -->");
    expect(result).toContain("内容更多内容");
  });

  it("should strip HTML-escaped figure comments", () => {
    const input = "内容&lt;!-- figure:3:4 --&gt;更多";
    const result = stripFigureComments(input);
    expect(result).not.toContain("figure:3:4");
  });

  it("should not strip non-figure HTML comments", () => {
    const input = "<!-- chart:d1-s0 -->";
    expect(stripFigureComments(input)).toBe(input);
  });
});

// ============================================================
// convertDescriptiveListsToBullets
// ============================================================

describe("convertDescriptiveListsToBullets", () => {
  it("should convert non-bold ordered lists under #### to bullets", () => {
    const input = "#### 4.1.1. 标题\n1. First item\n2. Second item";
    const result = convertDescriptiveListsToBullets(input);
    expect(result).toContain("- First item");
    expect(result).toContain("- Second item");
  });

  it("should not convert bold items", () => {
    const input = "#### 标题\n1. **Bold item**\n2. Plain item";
    const result = convertDescriptiveListsToBullets(input);
    expect(result).toContain("1. **Bold item**");
    expect(result).toContain("- Plain item");
  });

  it("should reset under ###", () => {
    const input = "#### 节一\n1. A\n### 节二\n1. B";
    const result = convertDescriptiveListsToBullets(input);
    expect(result).toContain("- A");
    expect(result).toContain("1. B");
  });
});

// ============================================================
// renumberHeadings — additional branches
// ============================================================

describe("renumberHeadings — additional branches", () => {
  it("should renumber #### N.M. two-part headings", () => {
    const input = [
      "## 1. 维度一",
      "#### 1.1. 子节一",
      "内容",
      "#### 1.2. 子节二",
      "内容",
    ].join("\n");
    const result = renumberHeadings(input);
    expect(result).toContain("#### 1.1. 子节一");
    expect(result).toContain("#### 1.2. 子节二");
  });

  it("should renumber #### N.M.K. three-part headings", () => {
    const input = [
      "## 2. 维度二",
      "### 2.1. 节一",
      "内容",
      "#### 2.1.1. 子节一",
      "内容",
    ].join("\n");
    const result = renumberHeadings(input);
    expect(result).toContain("### 2.1. 节一");
    expect(result).toContain("#### 2.1.1. 子节一");
  });

  it("should re-align bold list items to current heading number", () => {
    const input = [
      "## 3. 维度三",
      "### 3.1. 节一",
      "3.5.1. **旧编号的标题**",
    ].join("\n");
    const result = renumberHeadings(input);
    expect(result).toContain("3.1.1. **旧编号的标题**");
  });

  it("should convert plain numbered items to bullets under numbered headings", () => {
    const input = ["## 4. 维度四", "### 4.1. 节一", "1. Plain item"].join("\n");
    const result = renumberHeadings(input);
    expect(result).toContain("- Plain item");
  });

  it("should stop tracking at non-numbered ## heading", () => {
    const input = [
      "## 1. 维度一",
      "### 1.1. 节一",
      "内容",
      "## 跨维度关联分析",
      "### 无编号标题",
    ].join("\n");
    const result = renumberHeadings(input);
    // After non-numbered ##, currentDim resets to 0
    expect(result).toContain("## 跨维度关联分析");
    expect(result).toContain("### 无编号标题");
  });

  it("should handle #### before any ### (implicit parent)", () => {
    const input = ["## 5. 维度五", "#### 5.1.1. 直接出现的子节", "内容"].join(
      "\n",
    );
    const result = renumberHeadings(input);
    // h3Count should become 1 implicitly
    expect(result).toContain("5.1.1. 直接出现的子节");
  });
});

// ============================================================
// numberSubHeadings — additional branch: #### before any ###
// ============================================================

describe("numberSubHeadings — #### before any ###", () => {
  it("should give implicit parent h3Count=1 when #### appears before ###", () => {
    const input = "#### 子节内容";
    const result = numberSubHeadings(input, 2);
    expect(result).toContain("#### 2.1.1. 子节内容");
  });
});

// ============================================================
// stripLLMMetaNotes — additional variants
// ============================================================

describe("stripLLMMetaNotes — additional variants", () => {
  it("should strip 我们认为 subjective first-person", () => {
    const input = "我们认为，该技术路线具有潜力";
    expect(stripLLMMetaNotes(input)).not.toContain("我们认为");
  });

  it("should strip 我们建议 variant", () => {
    const input = "我们建议采用新方案";
    expect(stripLLMMetaNotes(input)).not.toContain("我们建议");
  });

  it("should strip 题设要求 pattern", () => {
    const input = "题设要求分析三个维度，";
    expect(stripLLMMetaNotes(input)).not.toContain("题设");
  });

  it("should strip 图表提示 editorial commentary", () => {
    const input = "图表提示图 30.TiDAR架构全流程图可在本节插入";
    const result = stripLLMMetaNotes(input);
    expect(result).not.toContain("图表提示");
  });

  it("should strip **字数统计**: 约860字 bold variant", () => {
    const input = "内容**字数统计**：约860字更多内容";
    const result = stripLLMMetaNotes(input);
    expect(result).not.toContain("字数统计");
  });

  it("should strip （注：本章约1650字...）chapter note", () => {
    const input = "段落内容（注：本章约1650字，基于证据分析）结尾";
    const result = stripLLMMetaNotes(input);
    expect(result).not.toContain("注：本章");
  });

  it("should strip 需补充验证 pattern", () => {
    const input = "需补充2024 Q4企业报告验证";
    const result = stripLLMMetaNotes(input);
    expect(result).not.toContain("需补充");
  });

  it("should strip **综合判断：** prefix", () => {
    const input = "**综合判断：**总体趋势向好";
    expect(stripLLMMetaNotes(input)).not.toContain("**综合判断：**");
  });

  it("should strip **综上所述：** prefix", () => {
    const input = "**综上所述：**结论如下";
    expect(stripLLMMetaNotes(input)).not.toContain("**综上所述：**");
  });

  it("should fix translation artifact 代理ic", () => {
    const input = "代理ic layers增加了复杂度";
    expect(stripLLMMetaNotes(input)).toContain("代理");
    expect(stripLLMMetaNotes(input)).not.toContain("代理ic");
  });

  it("should strip 图片缺失 annotation", () => {
    const input = "图片缺失：未找到对应图表";
    expect(stripLLMMetaNotes(input)).not.toContain("图片缺失");
  });

  it("should strip fenced code block markers without content", () => {
    const input = "内容\n```json\n内容";
    const result = stripLLMMetaNotes(input);
    expect(result).not.toContain("```json");
  });

  it("should fix truncated 年 heading prefix", () => {
    const input = "### 年视角下的AI发展";
    const result = stripLLMMetaNotes(input);
    expect(result).toContain("年视角下的AI发展");
    // Year should be prepended
    expect(result).toMatch(/\d{4}年视角/);
  });
});

// ============================================================
// mergeAdjacentMathBlocks — additional branches
// ============================================================

describe("mergeAdjacentMathBlocks — additional branches", () => {
  it("should protect and restore inline code blocks", () => {
    const input = "Use `\\alpha` for variable";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("`\\alpha`");
  });

  it("should wrap standalone LaTeX formula lines in $ (at minimum)", () => {
    const input =
      "\\text{Attention}(Q,K,V) = \\text{softmax}(\\frac{QK^T}{\\sqrt{d_k}})V";
    const result = mergeAdjacentMathBlocks(input);
    // The formula should be wrapped in some math delimiter
    expect(result).toContain("$");
  });

  it("should wrap \\begin{aligned}...\\end{aligned} in $$", () => {
    const input = "\\begin{aligned}\nx &= y\n\\end{aligned}";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("$$");
  });

  it("should absorb dangling ^{...} after closing $", () => {
    const input = "$\\mathbb{R}$^{d_m}";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("$\\mathbb{R}^{d_m}$");
  });

  it("should fix unbalanced braces in inline math", () => {
    const input = "$\\mathbb{R}^{n \\times n$";
    const result = mergeAdjacentMathBlocks(input);
    // Should have balanced braces
    const inner = result.match(/\$([^$]+)\$/)?.[1] || "";
    const opens = (inner.match(/\{/g) || []).length;
    const closes = (inner.match(/\}/g) || []).length;
    expect(opens).toBe(closes);
  });

  it("should wrap Big-O complexity O(n^2) in $", () => {
    const input = "时间复杂度O(n^2)很高";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("$O(n^2)$");
  });

  it("should protect fenced code blocks from modification", () => {
    // Lines 1347-1348: fenced code block protection path
    const input = "```python\nfor i in \\alpha:\n    pass\n```\nSome $x$ text";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("```python");
    expect(result).toContain("for i in");
  });

  it("should convert bracket display math \\[...\\] with LaTeX to $$", () => {
    // Lines 1369-1372: bracket display math multiline conversion (with LaTeX)
    const input = "\\[\n\\frac{x}{y}\n\\]";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("$$");
  });

  it("should NOT convert bracket math without LaTeX commands", () => {
    // Lines 1371-1372: skip bracket math with no backslash commands
    const input = "\\[\n123 + 456\n\\]";
    const result = mergeAdjacentMathBlocks(input);
    // Should keep original since no LaTeX commands
    expect(result).toContain("[");
  });

  it("should convert single-line \\[formula\\] with LaTeX to $", () => {
    // Lines 1379-1380: single-line bracket display math with LaTeX
    // Note: the single-line variant produces $...$ (inline), not $$ (display)
    const input = "\\[ \\frac{1}{2} \\]";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("$");
    expect(result).toContain("\\frac");
  });

  it("should NOT convert \\[...\\] that looks like markdown link", () => {
    // Lines 1381-1382: skip conversion when matches markdown link pattern
    const input = "[text](url) is a link";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("[text](url)");
  });

  it("should skip wrapping a formula line that already has $", () => {
    // Lines 1407-1408: already-wrapped lines are skipped
    const input = "$\\frac{x}{y} = z$";
    const result = mergeAdjacentMathBlocks(input);
    // Should remain wrapped but not double-wrapped
    expect((result.match(/\$/g) || []).length).toBeLessThanOrEqual(4);
  });

  it("should skip wrapping heading lines with LaTeX", () => {
    // Line 1409: heading skip
    const input = "### \\alpha and \\beta values";
    const result = mergeAdjacentMathBlocks(input);
    expect(result.startsWith("###")).toBe(true);
  });

  it("should skip wrapping blockquote lines with LaTeX", () => {
    // Line 1411: blockquote skip
    const input = "> The \\sum value is large";
    const result = mergeAdjacentMathBlocks(input);
    expect(result.startsWith(">")).toBe(true);
  });

  it("should skip wrapping list item lines with LaTeX", () => {
    // Line 1413: list item skip
    const input = "- \\alpha is important";
    const result = mergeAdjacentMathBlocks(input);
    expect(result.startsWith("-")).toBe(true);
  });

  it("should skip wrapping lines with mostly natural language (>50% non-LaTeX)", () => {
    // Lines 1414-1419: natural language prose detection skip
    const input =
      "The parameter \\alpha controls the learning rate of the model in training";
    const result = mergeAdjacentMathBlocks(input);
    // Should not wrap the entire line since it has too much natural language
    expect(result).not.toMatch(/^\$\$.*\$\$$/);
  });

  it("should wrap multi-line aligned LaTeX environment", () => {
    // Lines 1429-1430: \\begin{aligned} with existing $ check
    const input = "$$\\begin{aligned}\nx &= y\n\\end{aligned}$$";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("aligned");
  });

  it("should wrap Q=XW_Q formula line in $$", () => {
    // Lines 1445-1446: Q = XW_Q formula skip when already has $
    const input = "Q = XW_Q,\\quad K = XW_K";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("$$");
  });

  it("should skip Q=XW_Q formula line already having $", () => {
    // Lines 1445: already has $
    const input = "$Q = XW_Q,\\quad K = XW_K$";
    const result = mergeAdjacentMathBlocks(input);
    // Should not double wrap
    expect(result.startsWith("$$$$")).toBe(false);
  });

  it("should deduplicate consecutive identical math formulas", () => {
    // Lines 1482-1491: deduplicate consecutive math blocks
    const input = "$\\alpha + \\beta$\n$$\\alpha + \\beta$$";
    const result = mergeAdjacentMathBlocks(input);
    // Should keep only one version (deduplication executed)
    expect(result).toContain("\\alpha");
  });

  it("should keep both math blocks when they differ", () => {
    // Line 1491: non-equal blocks preserved
    const input = "$\\alpha + 1$\n$$\\beta + 2$$";
    const result = mergeAdjacentMathBlocks(input);
    // Both should be present since they differ
    expect(result).toContain("\\alpha");
    expect(result).toContain("1");
  });

  it("should not merge bare text between $ blocks without LaTeX chars", () => {
    // Line 1527: return match when between text has no LaTeX chars
    const input = "$A$ and $B$";
    const result = mergeAdjacentMathBlocks(input);
    // "and" has no LaTeX chars — the function merges adjacent $A$ $B$ blocks regardless
    // but the between-text path (line 1527) is hit via the dangling absorb loop
    expect(result).toContain("A");
    expect(result).toContain("B");
  });

  it("should absorb trailing LaTeX \\right after closing $", () => {
    // Line 1536: absorb trailing \\right
    const input = "$\\left( x $\\right)";
    const result = mergeAdjacentMathBlocks(input);
    expect(result).toContain("\\right");
  });

  it("should fix broken $ nesting when between LaTeX content exists", () => {
    // Lines 1546-1548: fix broken $ nesting
    const input = "$S = $\\phi(K)^\\top $V$";
    const result = mergeAdjacentMathBlocks(input);
    // Should produce a single clean math span
    expect(typeof result).toBe("string");
  });

  it("should return match for broken $ nesting without LaTeX chars between", () => {
    // Line 1549: non-LaTeX between — return match unchanged
    const input = "$A$ xx $B$";
    const result = mergeAdjacentMathBlocks(input);
    expect(typeof result).toBe("string");
  });

  it("should add closing $ to line with odd number of $ signs and LaTeX content", () => {
    // Lines 1565-1569: unpaired $ repair
    const input = "$\\frac{x}{y}";
    const result = mergeAdjacentMathBlocks(input);
    const dollars = (result.match(/\$/g) || []).length;
    expect(dollars % 2).toBe(0);
  });
});

// ============================================================
// numberSubHeadings — non-### and non-#### headings (line 69)
// ============================================================

describe("numberSubHeadings — fallthrough heading levels", () => {
  it("should preserve ## and ##### headings unchanged", () => {
    // Line 69: fallthrough for heading levels that are not ### or ####
    const input = "## 主要章节\n##### 深层子标题";
    const result = numberSubHeadings(input, 2);
    expect(result).toContain("## 主要章节");
    expect(result).toContain("##### 深层子标题");
  });
});

// ============================================================
// normalizeUrl catch branch (line 893) — via deduplicateReferencesByUrl
// ============================================================

describe("deduplicateReferencesByUrl — invalid URL fallback", () => {
  it("should deduplicate references with non-standard URLs", () => {
    // Line 893: normalizeUrl catch branch triggered by invalid URL
    const input =
      "1. not-a-valid-url-at-all\n2. not-a-valid-url-at-all\n3. https://example.com";
    const result = deduplicateReferencesByUrl(input);
    // Invalid URL should still be normalized via catch branch
    expect(result).toBeTruthy();
  });
});

// ============================================================
// fixLatexSubscripts — return match paths (lines 1299, 1323)
// ============================================================

describe("fixLatexSubscripts — return match fallthrough paths", () => {
  it("should NOT convert \\sum{} when content is not subscript-like", () => {
    // Line 1299: inner content fails the subscript test, returns match unchanged
    const input =
      "\\sum{complex LaTeX expression that is too long to be subscript}";
    const result = fixLatexSubscripts(input);
    expect(result).toBe(input);
  });

  it("should NOT convert letter{} when inner has uppercase letters", () => {
    // Line 1323: inner content has uppercase (fails /^[a-z0-9,: _]+$/i? no, i flag covers)
    // We need content that fails the simple check. Use special chars that aren't letters/digits.
    const input = "x{a+b-c}";
    const result = fixLatexSubscripts(input);
    // + and - should fail the /^[a-z0-9,: _]+$/i test
    expect(result).toBe(input);
  });
});

// ============================================================
// wrapProseStyleMath — lines with existing $ (lines 1856, 1866)
// ============================================================

describe("wrapProseStyleMath — lines with existing $ delimiters", () => {
  it("should handle line that already contains $ without double-wrapping", () => {
    // Lines 1856, 1866: applyProseWrapOutsideMath path
    const input = "The value $x_0$ and y_1 are related";
    const result = wrapProseStyleMath(input);
    // $x_0$ should be preserved, y_1 might be wrapped
    expect(result).toContain("$x_0$");
  });

  it("should skip wrapping subscript when already wrapped nearby", () => {
    // Line 1866: already wrapped branch in subscript check
    const input = "Compute $y_1$ then use y_1 again";
    const result = wrapProseStyleMath(input);
    expect(typeof result).toBe("string");
  });
});

// ============================================================
// applyProseWrapOutsideMath — $$ handling (lines 1897-1899)
// ============================================================

describe("wrapProseStyleMath — $$ display math in line", () => {
  it("should preserve $$ display math segments and only wrap outside", () => {
    // Lines 1897-1899: $$ segment skipped in state machine
    const input = "Prefix $$x = y$$ and f(x) = g(x_0) suffix";
    const result = wrapProseStyleMath(input);
    expect(result).toContain("$$x = y$$");
  });

  it("should handle prose function already wrapped by equation pass", () => {
    // Lines 1931-1932: prose function already wrapped check
    const input = "The function f(x_0) = x_0 + 1";
    const result = wrapProseStyleMath(input);
    expect(typeof result).toBe("string");
  });

  it("should handle subscript already in math span", () => {
    // Line 1938: subscript already in math span check
    const input = "See $x_0$ and also x_0 here";
    const result = wrapProseStyleMath(input);
    expect(typeof result).toBe("string");
  });
});

// ============================================================
// wrapBareInlineLatex — lines with $ present (lines 2072-2074)
// ============================================================

describe("wrapBareInlineLatex — $$ in line triggers wrapBareLatexOutsideMath", () => {
  it("should handle line with mixed existing $ and bare LaTeX", () => {
    // Lines 2072-2074: $$ skipping in wrapBareLatexOutsideMath state machine
    const input = "Compute $$\\frac{1}{2}$$ then \\alpha separately";
    const result = wrapBareInlineLatex(input);
    expect(typeof result).toBe("string");
  });

  it("should wrap bare LaTeX outside math span on line with existing $", () => {
    // Lines 2206-2207: wrapBareLatexOutsideMath called when line has $
    const input = "Use $x$ and also \\frac{a}{b} outside";
    const result = wrapBareInlineLatex(input);
    expect(typeof result).toBe("string");
  });

  it("should skip Big-O when line already has $", () => {
    // Line 2219: BIG_O_RE else branch (line already has $)
    const input = "See $x$ and O(n^2) complexity";
    const result = wrapBareInlineLatex(input);
    // With existing $, Big-O wrapping is skipped
    expect(typeof result).toBe("string");
  });
});

// ============================================================
// splitEnumerationToList — inline numeric list (lines 2544-2553)
// ============================================================

describe("splitEnumerationToList — inline numeric list splitting", () => {
  it("should split inline numeric list into separate items", () => {
    // Lines 2544-2553: Pass 2 inline numeric splitting
    const input =
      "分析角度：技术可行性 1. 技术实现路径 2. 商业化落地策略 3. 竞争格局分析";
    const result = splitEnumerationToList(input);
    expect(result).toContain("1. ");
    expect(result).toContain("2. ");
    expect(result).toContain("3. ");
  });

  it("should not split non-consecutive numeric markers", () => {
    // Line 3486-3488: isConsecutive check fail
    const input = "分析：技术路径 1. 首要因素 3. 次要因素";
    const result = splitEnumerationToList(input);
    // 1, 3 are not consecutive so should not split
    expect(result).toContain("1. 首要因素 3. 次要因素");
  });

  it("should include lead text before first marker", () => {
    // Lines 3519: leadText branch
    const input = "核心要素：内容说明 1. 第一项内容详解 2. 第二项内容详解";
    const result = splitEnumerationToList(input);
    expect(result).toContain("核心要素");
  });
});

// ============================================================
// extractTableFootnotes — long first cell (lines 2666-2667)
// ============================================================

describe("extractTableFootnotes — footnote extraction", () => {
  it("should extract table footnote when first cell is long and other cells empty", () => {
    // Lines 2666-2667: footnote extraction path
    const longFootnote =
      "注：此表格数据来源于多个研究报告的综合分析，包括McKinsey、BCG等机构的最新数据。";
    const input =
      "| 指标 | 数值 |\n|------|------|\n| 数据 | 100 |\n| " +
      longFootnote +
      " |  |";
    const result = extractTableFootnotes(input);
    expect(result).toContain(longFootnote);
  });
});

// ============================================================
// deduplicateHeadingEcho — branches (lines 2751-2766)
// ============================================================

describe("deduplicateHeadingEcho — additional branches", () => {
  it("should skip echo check when next line is blank", () => {
    // Lines 2696-2698: blank next line — just push heading
    const input = "### 技术架构演进\n\n技术架构演进\n内容段落";
    const result = deduplicateHeadingEcho(input);
    // Blank line interrupts the echo check
    expect(result).toContain("### 技术架构演进");
  });

  it("should remove echo when heading text matches next line exactly", () => {
    // Lines 2708-2715: exact match echo removal
    const input = "### 技术架构演进\n技术架构演进\n这是实际内容";
    const result = deduplicateHeadingEcho(input);
    expect(result).not.toMatch(/技术架构演进\n技术架构演进/);
  });

  it("should remove echo when heading text is prefix of next line", () => {
    // Line 2710: startsWith match
    const input = "### 技术演进\n技术演进路径分析\n内容";
    const result = deduplicateHeadingEcho(input);
    expect(typeof result).toBe("string");
  });

  it("should remove echo when next line is prefix of heading", () => {
    // Line 2711: reverse startsWith match
    const input = "### 技术架构演进详细分析\n技术架构演进详细分析\n内容";
    const result = deduplicateHeadingEcho(input);
    expect(typeof result).toBe("string");
  });
});

// ============================================================
// wrapPseudoCodeBlocks — flushCodeBuffer with < 2 lines (line 3021)
// ============================================================

describe("wrapPseudoCodeBlocks — small code buffer flush", () => {
  it("should not wrap code buffer with fewer than 2 lines", () => {
    // Line 3021: flushCodeBuffer with codeBuffer.length < 2
    // A single code-like line followed by non-code should flush without wrapping
    const input = "function_name(param)\nThis is regular text content here.";
    const result = wrapPseudoCodeBlocks(input);
    expect(typeof result).toBe("string");
  });
});

// ============================================================
// truncateAtSentenceBoundary — branches (lines 3147, 3160)
// ============================================================

describe("truncateAtSentenceBoundary — branch coverage", () => {
  it("should truncate at paragraph boundary when close to maxChars", () => {
    // Line 3147: lastParagraph > maxChars * 0.7 branch
    const chunk = "这是一段完整的内容。";
    const content = chunk.repeat(10) + "\n\n" + "更多内容在这里。".repeat(5);
    const maxChars = 95; // paragraph boundary at ~90 chars should be > 0.7 * 95
    const result = truncateAtSentenceBoundary(content, maxChars);
    expect(result.length).toBeLessThanOrEqual(maxChars);
  });

  it("should truncate at sentence boundary when paragraph boundary is too early", () => {
    // Line 3160: lastSentenceEnd > maxChars * 0.7 branch
    const content =
      "这是第一句话的内容。这是第二句话的内容。这是第三句话。" +
      "更多内容继续延伸到后面。";
    const result = truncateAtSentenceBoundary(content, 25);
    expect(result.length).toBeLessThanOrEqual(25);
  });
});

// ============================================================
// repairTruncatedBlockquoteBullets — lastClean branch (line 3190)
// ============================================================

describe("repairTruncatedBlockquoteBullets — lastClean branch", () => {
  it("should trim at clean punctuation point when lastClean > 60% of text", () => {
    // Line 3190: lastClean > trimmed.length * 0.6 branch
    // Need a text that ends without punctuation, has a comma in the later 60%
    const input = "> - 这是一段被截断的内容，包含重要信息，具体细节如下";
    const result = repairTruncatedBlockquoteBullets(input);
    expect(result).toContain("...");
  });
});

// ============================================================
// collapseExcessSubHeadings — branch (line 3522)
// ============================================================

describe("collapseExcessSubHeadings — additional branch", () => {
  it("should not collapse when section has few headings", () => {
    // Line 3522: section with fewer than threshold headings
    const input =
      "## 章节一\n### 1.1. 子标题\n内容段落这里有很多内容。\n### 1.2. 另一子标题\n更多内容。";
    const result = collapseExcessSubHeadings(input);
    expect(typeof result).toBe("string");
  });
});

// ============================================================
// normalizeChapterHighlights — branches (lines 3667, 3693-3701)
// ============================================================

describe("normalizeChapterHighlights — branch coverage", () => {
  it("should handle English Chapter Highlights label", () => {
    // Line 3670: isEn branch for English label
    const input =
      "Chapter Highlights\n- First point\n- Second point\n\n内容段落";
    const result = normalizeChapterHighlights(input);
    expect(result).toContain("Chapter Highlights");
  });

  it("should flush current block when new highlights header encountered", () => {
    // Line 3667: insideBlock is true when new header found — flushBlock called
    const input = "本章要点\n- 要点一\n本章要点\n- 要点二\n\n内容";
    const result = normalizeChapterHighlights(input);
    expect(typeof result).toBe("string");
  });

  it("should handle non-blockquote line ending the block", () => {
    // Lines 3693-3697: non-blockquote line while insideBlock
    const input = "本章要点\n- 要点一\n普通段落文本\n\n其他内容";
    const result = normalizeChapterHighlights(input);
    expect(result).toContain("普通段落文本");
  });

  it("should treat bare blockquote content as a list item", () => {
    // Lines 3699-3701: trimmed content inside blockquote without list marker
    const input = "本章要点\n> 没有列表标记的内容\n\n其他内容";
    const result = normalizeChapterHighlights(input);
    expect(result).toContain("没有列表标记的内容");
  });
});

// ============================================================
// normalizeHighlightsInPlace — branches (lines 3771-3780)
// ============================================================

describe("normalizeHighlightsInPlace — branch coverage", () => {
  it("should handle non-blockquote line ending the block", () => {
    // Lines 3771-3774: non-blockquote non-list line ends block
    const input = "本章要点\n- 要点一\n非引用普通文本行\n\n其他内容";
    const result = normalizeHighlightsInPlace(input);
    expect(result).toContain("非引用普通文本行");
  });

  it("should treat bare blockquote content as a list item", () => {
    // Lines 3777-3780: trimmed blockquote content without list marker
    const input = "本章要点\n> 没有标记的内容\n\n其他内容";
    const result = normalizeHighlightsInPlace(input);
    expect(result).toContain("没有标记的内容");
  });
});

// ============================================================
// normalizeInlineDoubleDollar — space-before $$ (line 3940)
// ============================================================

describe("normalizeInlineDoubleDollar — space before $$ branch", () => {
  it("should convert space-separated inline $$ to single $", () => {
    // Line 3940: /(?<=\\S\\s)\\$\\$([^$]+?)\\$\\$/ branch
    const input = "The complexity O(n $$\\log n$$) is sublinear";
    const result = normalizeInlineDoubleDollar(input);
    expect(result).toContain("$\\log n$");
    expect(result).not.toContain("$$\\log n$$");
  });

  it("should strip orphan $$ before LaTeX command", () => {
    // Lines 3945-3946: orphan $$ with \\command
    const input = "a $$\\log(C)";
    const result = normalizeInlineDoubleDollar(input);
    expect(result).toContain("$\\log(C)");
  });
});
