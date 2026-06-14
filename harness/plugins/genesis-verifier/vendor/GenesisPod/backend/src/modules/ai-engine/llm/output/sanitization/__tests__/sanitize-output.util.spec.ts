/**
 * sanitize-output.utils.ts 单元测试
 */
import {
  sanitizeSectionOutput,
  stripLeadingBulletLists,
  stripAnalyticalInlineBullets,
  stripSectionOpeningShortLines,
  stripCitationStacking,
  replaceMarketingLanguage,
  repairBrokenBoldPairs,
  normalizeTransitionHeadings,
  normalizeBoldStyle,
  convertOrdinalBulletsToParagraphs,
  fixOrdinalBoldPosition,
  convertLongListItemsToParagraphs,
  removeOrphanCitations,
} from "../sanitize-output.utils";

describe("sanitizeSectionOutput", () => {
  it("should return empty string for falsy input", () => {
    expect(sanitizeSectionOutput("")).toBe("");
  });

  it("should preserve heading lines", () => {
    const content = "## 第一章\n### 第一节\n#### 小节";
    const result = sanitizeSectionOutput(content);
    expect(result).toContain("## 第一章");
    expect(result).toContain("### 第一节");
  });

  it("should preserve empty lines", () => {
    const content = "## 标题\n\n段落内容";
    const result = sanitizeSectionOutput(content);
    expect(result).toContain("\n\n");
  });

  it("should preserve chart placeholders", () => {
    const content = "## 标题\n\n<!-- chart:bar -->\n\n正文";
    const result = sanitizeSectionOutput(content);
    expect(result).toContain("<!-- chart:bar -->");
  });

  it("should preserve table rows", () => {
    const content = "## 标题\n\n| 列1 | 列2 |\n|---|---|\n| A | B |";
    const result = sanitizeSectionOutput(content);
    expect(result).toContain("| 列1 | 列2 |");
    expect(result).toContain("| A | B |");
  });

  it("should preserve blockquote lines", () => {
    const content = "## 标题\n\n> 这是引用块内容";
    const result = sanitizeSectionOutput(content);
    expect(result).toContain("> 这是引用块内容");
  });

  it("should preserve reference entries", () => {
    const content = "## 标题\n\n[1] 参考文献一\n[2] 参考文献二";
    const result = sanitizeSectionOutput(content);
    expect(result).toContain("[1] 参考文献一");
  });

  it("should preserve horizontal rules", () => {
    const content = "## 标题\n\n---\n\n正文";
    const result = sanitizeSectionOutput(content);
    expect(result).toContain("---");
  });

  it("should filter JSON property lines without Chinese", () => {
    const content = '## 标题\n\n"title": "Some value",\n\n正文内容包含中文汉字';
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain('"title": "Some value"');
  });

  it("should filter isolated JSON symbols", () => {
    const content = "## 标题\n\n]\n}\n,\n\n正文内容包含中文汉字";
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain("]\n}");
    expect(result).toContain("正文内容");
  });

  it("should filter bracket meta-comments", () => {
    const content = "## 标题\n\n[字数约1000字]\n[图表引用待定]\n\n正文内容";
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain("[字数约1000字]");
    expect(result).not.toContain("[图表引用待定]");
  });

  it("should filter word count lines", () => {
    const content = "## 标题\n\n字数统计：约1500字\n\n正文内容";
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain("字数统计");
  });

  it("should filter parenthetical meta-comments", () => {
    const content = "## 标题\n\n（注：请参考图表）\n\n正文内容";
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain("（注：请参考图表）");
  });

  it("should filter internal config lines", () => {
    const content = "## 标题\n\n以下是图表配置信息\n\n正文";
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain("以下是图表配置信息");
  });

  it("should filter position directive leaks", () => {
    const content = "## 标题\n\nposition: afterparagraph_3\n\n正文";
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain("position: afterparagraph_3");
  });

  it("should filter Figure References labels", () => {
    const content = "## 标题\n\nFigure References:\n\n正文";
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain("Figure References");
  });

  it("should filter erroneous image format !(url)", () => {
    const content = "## 标题\n\n!(https://example.com/img.jpg)\n\n正文";
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain("!(https://");
  });

  it("should filter bare URLs", () => {
    const content = "## 标题\n\nhttps://example.com/page\n\n正文";
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain("https://example.com/page");
  });

  it("should preserve normal Chinese content", () => {
    const content = "## 标题\n\n这是一段正常的中文段落，包含足够多的汉字内容。";
    const result = sanitizeSectionOutput(content);
    expect(result).toContain("这是一段正常的中文段落");
  });

  it("should filter heading with inline JSON starting with {", () => {
    // The rule: heading lines starting with # followed by { AND containing "key": pattern
    // Use ASCII key (not Chinese) to match the regex /^#{1,4}\s+\{/ && /"[a-zA-Z_][\w-]*"\s*:/
    const content =
      '## 标题\n\n#### {"scenario": "optimistic", "rate": 60}\n\n正文';
    const result = sanitizeSectionOutput(content);
    expect(result).not.toContain('{"scenario"');
  });

  it("should preserve code block content", () => {
    const content = '## 标题\n\n```python\n"key": "value"\n```\n\n正文';
    const result = sanitizeSectionOutput(content);
    expect(result).toContain('"key": "value"');
  });

  it("should compress triple blank lines", () => {
    const content = "段落一\n\n\n\n段落二";
    const result = sanitizeSectionOutput(content);
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe("stripLeadingBulletLists", () => {
  it("should not modify content without headings followed by bullets", () => {
    const content = "正文段落一\n\n正文段落二";
    expect(stripLeadingBulletLists(content)).toBe(content);
  });

  it("should strip 3+ bullets immediately after heading", () => {
    const content = "## 标题\n\n- 要点一\n- 要点二\n- 要点三\n\n这是正文内容。";
    const result = stripLeadingBulletLists(content);
    expect(result).toContain("## 标题");
    expect(result).not.toContain("- 要点一");
    expect(result).toContain("这是正文内容");
  });

  it("should preserve bullets if fewer than 3", () => {
    const content = "## 标题\n\n- 要点一\n- 要点二\n\n这是正文内容。";
    const result = stripLeadingBulletLists(content);
    expect(result).toContain("- 要点一");
    expect(result).toContain("- 要点二");
  });

  it("should preserve content after stripping bullets", () => {
    const content =
      "## 标题\n\n- 要点一\n- 要点二\n- 要点三\n- 要点四\n\n正文段落一\n\n正文段落二";
    const result = stripLeadingBulletLists(content);
    expect(result).toContain("正文段落一");
    expect(result).toContain("正文段落二");
  });

  it("should handle H3 headings", () => {
    const content = "### 小节\n\n- 项目一\n- 项目二\n- 项目三\n\n正文";
    const result = stripLeadingBulletLists(content);
    expect(result).toContain("### 小节");
    expect(result).not.toContain("- 项目一");
  });
});

describe("stripAnalyticalInlineBullets", () => {
  it("should preserve short bullet lists (items <= 30 chars)", () => {
    const content = "## 标题\n\n- Google\n- OpenAI\n- Anthropic\n\n正文";
    const result = stripAnalyticalInlineBullets(content);
    expect(result).toContain("- Google");
  });

  it("should convert analytical bullet lists (all items > 30 chars, 3+ bullets) to paragraphs", () => {
    // Each item must be > 30 chars when stripped of bullet and bold markers
    // Use ASCII to guarantee exact character count
    const longItem = "a".repeat(35); // 35 chars, definitely > 30
    const content = `- ${longItem}A\n- ${longItem}B\n- ${longItem}C\n\n结尾`;
    const result = stripAnalyticalInlineBullets(content);
    // Bullet markers should be removed - items converted to paragraphs
    expect(result).not.toMatch(/^- /m);
    expect(result).toContain(longItem);
  });

  it("should preserve bullets if fewer than 3 items", () => {
    const longItem = "这是一个超过三十个字符的非常长的分析性观点内容描述";
    const content = `- ${longItem}一\n- ${longItem}二\n\n结尾`;
    const result = stripAnalyticalInlineBullets(content);
    expect(result).toContain("- ");
  });

  it("should handle bullet blocks with empty lines between bullets", () => {
    const longItem = "这是一个超过三十个字符的非常长的分析性观点内容描述";
    const content = `- ${longItem}一\n\n- ${longItem}二\n\n- ${longItem}三\n\n结尾`;
    const result = stripAnalyticalInlineBullets(content);
    // Should convert to paragraphs
    expect(result).toContain(longItem.slice(0, 5));
  });
});

describe("stripSectionOpeningShortLines", () => {
  it("should return content unchanged if fewer than 2 short citation lines", () => {
    const content = "## 标题\n\n这是一个完整的段落，不含引用。[1]\n\n正文";
    expect(stripSectionOpeningShortLines(content)).toBe(content);
  });

  it("should strip 2+ consecutive short citation lines at section start", () => {
    const content =
      "## 标题\n\n多智能体通信开销随规模急增。[5]\n\n高并发下实时性常先失效。[5][10]\n\n这是正文段落内容，比较长的段落内容描述。";
    const result = stripSectionOpeningShortLines(content);
    expect(result).not.toContain("多智能体通信开销");
    expect(result).toContain("这是正文段落内容");
  });

  it("should preserve content if no short citation lines", () => {
    const content =
      "## 标题\n\n这是正常的正文段落内容，不含引用短句。\n\n另一段。";
    const result = stripSectionOpeningShortLines(content);
    expect(result).toContain("这是正常的正文段落内容");
  });

  it("should stop stripping at bullet lines", () => {
    const content = "## 标题\n\n短句。[1]\n\n- 列表项目开始\n\n正文";
    // Only 1 short citation line before bullet - won't strip
    const result = stripSectionOpeningShortLines(content);
    expect(typeof result).toBe("string");
  });

  it("should return original if no body content after stripping", () => {
    const content = "## 标题\n\n短句一。[1]\n\n短句二。[2]";
    // No body after short lines → return original
    const result = stripSectionOpeningShortLines(content);
    expect(result).toBe(content);
  });
});

describe("stripCitationStacking", () => {
  it("should preserve single citations", () => {
    const content = "正文[1]继续";
    expect(stripCitationStacking(content)).toBe(content);
  });

  it("should preserve two consecutive citations", () => {
    const content = "正文[1][2]继续";
    expect(stripCitationStacking(content)).toBe(content);
  });

  it("should strip 3+ consecutive citations, keeping first 2", () => {
    const content = "正文[1][2][3]继续";
    const result = stripCitationStacking(content);
    expect(result).toBe("正文[1][2]继续");
  });

  it("should strip 4+ consecutive citations", () => {
    const content = "正文[1][2][3][4][5]继续";
    const result = stripCitationStacking(content);
    expect(result).toBe("正文[1][2]继续");
  });
});

describe("replaceMarketingLanguage", () => {
  it("should replace 势必 with 可能", () => {
    const content = "AI 势必引发行业变革";
    const result = replaceMarketingLanguage(content);
    expect(result).toContain("可能引发");
    expect(result).not.toContain("势必");
  });

  it("should replace 必将 with 可能", () => {
    const result = replaceMarketingLanguage("技术必将重塑未来");
    expect(result).toContain("可能重塑");
  });

  it("should replace 不可忽视的机遇 with 值得关注的机遇", () => {
    const result = replaceMarketingLanguage("这是不可忽视的机遇");
    expect(result).toContain("值得关注的机遇");
  });

  it("should replace 不容忽视的趋势 with 值得关注的趋势", () => {
    const result = replaceMarketingLanguage("这是不容忽视的趋势");
    expect(result).toContain("值得关注的趋势");
  });

  it("should leave unmatched content unchanged", () => {
    const content = "这是正常的中文内容，没有营销话术。";
    expect(replaceMarketingLanguage(content)).toBe(content);
  });
});

describe("repairBrokenBoldPairs", () => {
  it("should replace **** with ，", () => {
    const content = "**第一****内容**";
    const result = repairBrokenBoldPairs(content);
    expect(result).toContain("，内容**");
    expect(result).not.toContain("****");
  });

  it("should leave normal bold unchanged", () => {
    const content = "**正常加粗**内容";
    expect(repairBrokenBoldPairs(content)).toBe(content);
  });

  it("should handle multiple occurrences", () => {
    const content = "**第一****内容**和**第二****更多**";
    const result = repairBrokenBoldPairs(content);
    expect(result).not.toContain("****");
  });
});

describe("normalizeTransitionHeadings", () => {
  it("should normalize 一方面 heading to inline text", () => {
    const content = "### 一方面\n\n正文";
    const result = normalizeTransitionHeadings(content);
    expect(result).not.toMatch(/^#{1,4}\s+.*一方面/m);
    expect(result).toContain("一方面");
  });

  it("should normalize 首先 heading", () => {
    const content = "## 首先\n\n正文";
    const result = normalizeTransitionHeadings(content);
    expect(result).not.toMatch(/^##\s+首先/m);
    expect(result).toContain("首先");
  });

  it("should preserve non-transition headings", () => {
    const content = "## 技术架构分析\n\n正文";
    const result = normalizeTransitionHeadings(content);
    expect(result).toContain("## 技术架构分析");
  });

  it("should handle headings with trailing punctuation", () => {
    const content = "### 此外：\n\n正文";
    const result = normalizeTransitionHeadings(content);
    expect(result).not.toMatch(/^###\s+此外/m);
  });
});

describe("normalizeBoldStyle", () => {
  it("should remove bold from ordinal markers 第一", () => {
    const content = "**第一，**要点内容";
    const result = normalizeBoldStyle(content);
    expect(result).not.toContain("**第一，**");
    expect(result).toContain("第一，");
  });

  it("should remove bold from 其一", () => {
    const content = "**其一，**分析内容";
    const result = normalizeBoldStyle(content);
    expect(result).not.toContain("**其一，**");
  });

  it("should remove bold from 一是", () => {
    const content = "**一是**要点";
    const result = normalizeBoldStyle(content);
    expect(result).not.toContain("**一是**");
    expect(result).toContain("一是");
  });

  it("should remove bold from 首先", () => {
    const content = "**首先**，分析";
    const result = normalizeBoldStyle(content);
    expect(result).not.toContain("**首先**");
    expect(result).toContain("首先");
  });

  it("should remove bold from 此外", () => {
    const content = "**此外**分析";
    const result = normalizeBoldStyle(content);
    expect(result).not.toContain("**此外**");
  });

  it("should remove bold from lead phrases like 这意味着", () => {
    const content = "**这意味着，**后续影响";
    const result = normalizeBoldStyle(content);
    expect(result).not.toContain("**这意味着，**");
  });

  it("should remove bold from line-start guide phrases", () => {
    const content = "**综合现有证据，可以得出一个明确的判断**：分析内容";
    const result = normalizeBoldStyle(content);
    expect(result).not.toMatch(/^\*\*综合/m);
  });

  it("should preserve normal bold", () => {
    const content = "这是**重要概念**的加粗";
    const result = normalizeBoldStyle(content);
    expect(result).toContain("**重要概念**");
  });
});

describe("convertOrdinalBulletsToParagraphs", () => {
  it("should convert bullets with 2+ ordinal prefixes to paragraphs", () => {
    const content =
      "- 其一，第一个观点内容\n- 其二，第二个观点内容\n- 其三，第三个观点内容\n\n正文";
    const result = convertOrdinalBulletsToParagraphs(content);
    expect(result).not.toMatch(/^- 其[一二三]/m);
    expect(result).toContain("其一，第一个观点内容");
  });

  it("should preserve bullet lists without ordinal prefixes", () => {
    const content = "- Google\n- OpenAI\n- Anthropic\n\n正文";
    const result = convertOrdinalBulletsToParagraphs(content);
    expect(result).toContain("- Google");
  });

  it("should handle mixed ordinal/non-ordinal bullets", () => {
    const content = "- 其一，观点\n- 普通项目\n\n正文";
    const result = convertOrdinalBulletsToParagraphs(content);
    // Only 1 ordinal, no conversion
    expect(typeof result).toBe("string");
  });

  it("should handle 第一/第二 ordinal prefixes", () => {
    const content =
      "- 第一，核心观点一\n- 第二，核心观点二\n- 第三，核心观点三\n\n正文";
    const result = convertOrdinalBulletsToParagraphs(content);
    expect(result).not.toMatch(/^- 第[一二三]/m);
  });

  it("should handle bullets with empty lines between them", () => {
    const content = "- 其一，观点A\n\n- 其二，观点B\n\n正文";
    const result = convertOrdinalBulletsToParagraphs(content);
    expect(typeof result).toBe("string");
  });
});

describe("fixOrdinalBoldPosition", () => {
  it("should fix ordinal outside bold markers by moving ordinal inside bold", () => {
    // Pattern: bullet + ordinal + ** + content + ** → bullet + ** + ordinal + content + **
    const content = "- 第一**类是底层基础设施**";
    const result = fixOrdinalBoldPosition(content);
    // Ordinal is moved inside bold markers: **第一类是底层基础设施**
    expect(result).toContain("**第一类是底层基础设施**");
    expect(result).not.toContain("第一**类");
  });

  it("should handle 第二 ordinal", () => {
    const content = "- 第二**层是应用框架层**";
    const result = fixOrdinalBoldPosition(content);
    expect(result).toContain("**第二层是应用框架层**");
    expect(result).not.toContain("第二**层");
  });

  it("should not modify content without the pattern", () => {
    const content = "- **第一类**是底层基础设施";
    expect(fixOrdinalBoldPosition(content)).toBe(content);
  });
});

describe("convertLongListItemsToParagraphs", () => {
  // Each Chinese char = 1 in JS length; need > 120 chars after removing bullet prefix
  const LONG_ITEM = "a".repeat(121); // 121 ASCII chars, definitely > 120

  it("should convert list items > 120 chars to paragraphs", () => {
    const content = `- ${LONG_ITEM}\n\n继续`;
    const result = convertLongListItemsToParagraphs(content);
    expect(result).not.toMatch(/^- /m);
    expect(result).toContain(LONG_ITEM);
  });

  it("should preserve short list items", () => {
    const content = "- 短列表项\n- 另一个短项\n\n正文";
    const result = convertLongListItemsToParagraphs(content);
    expect(result).toContain("- 短列表项");
  });

  it("should insert blank line before converted paragraph when previous line is non-empty", () => {
    const content = `前面有内容\n- ${LONG_ITEM}`;
    const result = convertLongListItemsToParagraphs(content);
    expect(result).toContain("\n\n");
  });

  it("should handle * list markers", () => {
    const content = `* ${LONG_ITEM}`;
    const result = convertLongListItemsToParagraphs(content);
    expect(result).not.toMatch(/^\* /m);
  });

  it("should not insert blank line when previous line is already empty", () => {
    const content = `\n- ${LONG_ITEM}`;
    const result = convertLongListItemsToParagraphs(content);
    expect(result).not.toMatch(/^- /m);
  });
});

describe("removeOrphanCitations", () => {
  it("should return content unchanged if maxCitationIndex <= 0", () => {
    const content = "正文[1][10][99]";
    expect(removeOrphanCitations(content, 0)).toBe(content);
    expect(removeOrphanCitations(content, -1)).toBe(content);
  });

  it("should remove citations beyond maxCitationIndex", () => {
    const content = "正文[1][3][5]";
    const result = removeOrphanCitations(content, 3);
    expect(result).toContain("[1]");
    expect(result).toContain("[3]");
    expect(result).not.toContain("[5]");
  });

  it("should preserve citations within range", () => {
    const content = "正文[1][2][3][4][5]";
    const result = removeOrphanCitations(content, 5);
    expect(result).toBe(content);
  });

  it("should handle content without citations", () => {
    const content = "没有引用的正文";
    expect(removeOrphanCitations(content, 10)).toBe(content);
  });
});
