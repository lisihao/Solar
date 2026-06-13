/**
 * report-formatting.util — branch coverage
 *
 * Covers untested pure-function exports:
 *  - deduplicateParagraphs
 *  - detectForeignLanguageBlocks
 *  - limitBlockquotes
 *  - stripRawMarkdownInContent
 *  - filterJunkReferences
 *  - deduplicateReferencesByUrl
 *  - upgradeHttpToHttps
 *  - decodeUrlEntities
 *  - remapCitationIndices
 *  - repairOrderedListContinuity
 *  - linkifyCitations
 *  - anchorReferences
 *  - numberSubHeadings guard branches (lines 61, 65, 69, 79)
 *  - renumberHeadings (two-part h4, resetless ## heading)
 *  - deduplicateHeadings Chinese-numeral normalization
 *  - limitBoldFormatting structural item preservation
 */

import {
  deduplicateParagraphs,
  detectForeignLanguageBlocks,
  limitBlockquotes,
  stripRawMarkdownInContent,
  filterJunkReferences,
  deduplicateReferencesByUrl,
  upgradeHttpToHttps,
  decodeUrlEntities,
  remapCitationIndices,
  repairOrderedListContinuity,
  linkifyCitations,
  anchorReferences,
  numberSubHeadings,
  renumberHeadings,
  deduplicateHeadings,
  limitBoldFormatting,
  deduplicateAdjacentCitations,
} from "../report-formatting.util";

// ─────────────────────────────────────────────────────────────────
// deduplicateParagraphs
// ─────────────────────────────────────────────────────────────────
describe("deduplicateParagraphs", () => {
  it("keeps short paragraphs (< DEDUP_MIN_LENGTH)", () => {
    const seen = new Set<string>();
    const content = "Short.\n\nAlso short.";
    const result = deduplicateParagraphs(content, seen);
    expect(result).toBe(content);
  });

  it("keeps headings regardless of length", () => {
    const seen = new Set<string>();
    const heading = "## " + "A".repeat(70);
    const content = heading + "\n\n" + heading;
    const result = deduplicateParagraphs(content, seen);
    // Both kept because they start with #
    expect(result).toBe(content);
  });

  it("keeps list items regardless of length", () => {
    const seen = new Set<string>();
    const item = "- " + "A".repeat(70);
    const content = item + "\n\n" + item;
    const result = deduplicateParagraphs(content, seen);
    expect(result).toBe(content);
  });

  it("keeps blockquotes regardless of length", () => {
    const seen = new Set<string>();
    const bq = "> " + "A".repeat(70);
    const content = bq + "\n\n" + bq;
    const result = deduplicateParagraphs(content, seen);
    expect(result).toBe(content);
  });

  it("removes duplicate long paragraphs", () => {
    const seen = new Set<string>();
    const para =
      "这是一个足够长的段落，用来测试去重功能是否正确运行。" + "X".repeat(60);
    const content = para + "\n\n" + para;
    const result = deduplicateParagraphs(content, seen);
    // Second occurrence should be removed
    expect(result.trim()).toBe(para.trim());
  });

  it("uses cross-paragraph shared seen set", () => {
    const seen = new Set<string>();
    const para =
      "这是一段足够长的重复内容，测试跨段落去重机制是否正常工作。" +
      "X".repeat(50);
    deduplicateParagraphs(para, seen);
    // Second call with same para should be deduped
    const result2 = deduplicateParagraphs(para + "\n\nNew content", seen);
    expect(result2.trim()).toBe("New content");
  });

  it("normalized key (no punctuation) catches rephrased duplicates", () => {
    const seen = new Set<string>();
    const para1 =
      "这是一段关于AI技术发展的重要内容，涵盖了多个方面的分析讨论。" +
      "Y".repeat(50);
    const para2 =
      "这是一段关于AI技术发展的重要内容涵盖了多个方面的分析讨论。" +
      "Y".repeat(50);
    const content = para1 + "\n\n" + para2;
    const result = deduplicateParagraphs(content, seen);
    // The normalized para1 ≈ normalized para2, so para2 should be removed
    expect(result).not.toContain(para2);
  });
});

// ─────────────────────────────────────────────────────────────────
// detectForeignLanguageBlocks
// ─────────────────────────────────────────────────────────────────
describe("detectForeignLanguageBlocks", () => {
  it("returns passed=true for empty content", () => {
    const result = detectForeignLanguageBlocks("");
    expect(result.foreignRatio).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.blocks).toEqual([]);
  });

  it("returns passed=true for Chinese content with no Latin", () => {
    const result =
      detectForeignLanguageBlocks("这是一段纯中文内容，没有任何外文。");
    expect(result.passed).toBe(true);
  });

  it("detects long Latin runs in Chinese target", () => {
    const longLatin =
      "This is a very long English sentence that definitely exceeds eighty characters in length.";
    const result = detectForeignLanguageBlocks(
      "中文内容。" + longLatin + " ".repeat(5) + longLatin,
      "zh",
    );
    // Long Latin ≥ 80 chars with 5+ words
    expect(result.blocks.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores short Latin runs (< 5 words) in Chinese target", () => {
    const shortLatin = "AI GPT-4 RLHF";
    const result = detectForeignLanguageBlocks("中文" + shortLatin, "zh");
    expect(result.blocks).toEqual([]);
  });

  it("detects CJK runs in English target", () => {
    const longCjk = "这是一段很长的中文内容" + "测试".repeat(20);
    const result = detectForeignLanguageBlocks(
      "English text. " + longCjk,
      "en",
    );
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it("strips code blocks before detection", () => {
    const codeBlock = "```\n" + "A".repeat(100) + "\n```";
    const result = detectForeignLanguageBlocks(codeBlock, "zh");
    expect(result.blocks).toEqual([]);
  });

  it("strips URLs before detection", () => {
    const url =
      "https://example.com/very-long-path/with-many-words/" +
      "word/".repeat(10);
    const result = detectForeignLanguageBlocks("中文内容 " + url, "zh");
    expect(result.blocks).toEqual([]);
  });

  it("strips citation markers before detection", () => {
    const content = "中文[1][2][3]内容";
    const result = detectForeignLanguageBlocks(content, "zh");
    expect(result.blocks).toEqual([]);
  });

  it("uses custom threshold correctly", () => {
    const result = detectForeignLanguageBlocks("Pure Chinese content", "zh", 0);
    expect(result.passed).toBe(true); // No foreign detected
  });

  it("handles zh-CN and zh-TW same as zh", () => {
    const resultCN = detectForeignLanguageBlocks("纯中文", "zh-CN");
    const resultTW = detectForeignLanguageBlocks("純中文", "zh-TW");
    expect(resultCN.passed).toBe(true);
    expect(resultTW.passed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// limitBlockquotes
// ─────────────────────────────────────────────────────────────────
describe("limitBlockquotes", () => {
  it("keeps blockquotes within limit", () => {
    const content = "> Quote 1\n\n> Quote 2";
    const result = limitBlockquotes(content, 5);
    expect(result).toBe(content);
  });

  it("converts excess blockquotes to paragraphs", () => {
    const quotes = Array.from({ length: 10 }, (_, i) => `> Quote ${i}`).join(
      "\n\n",
    );
    const result = limitBlockquotes(quotes, 3);
    // First 3 should remain as >, rest converted
    const blockquoteLines = result
      .split("\n")
      .filter((l) => l.startsWith("> "));
    expect(blockquoteLines.length).toBe(3);
  });

  it("truncates overly long blockquotes at sentence boundary", () => {
    // > block with 200+ chars but sentence break within 120 chars
    const longInner = "这是第一句话，用于测试。" + "X".repeat(200);
    const result = limitBlockquotes(`> ${longInner}`, 8, 120);
    expect(result.startsWith("> ")).toBe(true);
    expect(result.length).toBeLessThan(`> ${longInner}`.length);
  });

  it("keeps long blockquote as-is when no sentence boundary found within limit", () => {
    const longInner = "X".repeat(200); // no sentence boundary
    const result = limitBlockquotes(`> ${longInner}`, 8, 120);
    // No truncation when no sentence boundary found
    expect(result).toContain(longInner);
  });
});

// ─────────────────────────────────────────────────────────────────
// stripRawMarkdownInContent
// ─────────────────────────────────────────────────────────────────
describe("stripRawMarkdownInContent", () => {
  it("strips **bold** markers leaving inner text", () => {
    expect(stripRawMarkdownInContent("Some **bold** text")).toBe(
      "Some bold text",
    );
  });

  it("strips multiple bold markers", () => {
    expect(stripRawMarkdownInContent("**one** and **two**")).toBe(
      "one and two",
    );
  });

  it("leaves text without bold unchanged", () => {
    expect(stripRawMarkdownInContent("plain text")).toBe("plain text");
  });
});

// ─────────────────────────────────────────────────────────────────
// filterJunkReferences
// ─────────────────────────────────────────────────────────────────
describe("filterJunkReferences", () => {
  it("filters references from junk domains", () => {
    const refs = [
      { url: "https://pinterest.com/pin/123", domain: "pinterest.com" },
      { url: "https://arxiv.org/abs/123", domain: "arxiv.org" },
    ];
    const result = filterJunkReferences(refs);
    expect(result.length).toBe(1);
    expect(result[0].domain).toBe("arxiv.org");
  });

  it("filters by subdomain of junk domain", () => {
    const refs = [
      { url: "https://shop.amazon.com/item", domain: "shop.amazon.com" },
    ];
    const result = filterJunkReferences(refs);
    expect(result).toEqual([]);
  });

  it("filters by junk title keywords", () => {
    const refs = [
      {
        title:
          "Advances in biopolymer synthesis for food packaging applications",
      },
      { title: "AI language model performance benchmarks 2024" },
    ];
    const result = filterJunkReferences(refs);
    expect(result.length).toBe(1);
    expect(result[0].title).toContain("AI language model");
  });

  it("keeps references with short titles (< 10 chars)", () => {
    const refs = [{ title: "Bio" }]; // too short to keyword-match
    const result = filterJunkReferences(refs);
    expect(result.length).toBe(1);
  });

  it("uses url to extract domain when domain field is missing", () => {
    const refs = [{ url: "https://reddit.com/r/ai/comments/123" }];
    const result = filterJunkReferences(refs);
    expect(result).toEqual([]);
  });

  it("keeps clean references", () => {
    const refs = [
      { url: "https://nature.com/articles/s123", domain: "nature.com" },
      { url: "https://arxiv.org/abs/456", domain: "arxiv.org" },
    ];
    const result = filterJunkReferences(refs);
    expect(result.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// deduplicateReferencesByUrl
// ─────────────────────────────────────────────────────────────────
describe("deduplicateReferencesByUrl", () => {
  it("deduplicates references with same normalized URL", () => {
    const refs = [
      { url: "https://example.com/page", index: 1 },
      { url: "https://example.com/page/", index: 2 }, // trailing slash normalized away
      { url: "https://different.com/page", index: 3 },
    ];
    const { deduplicated, indexMapping } = deduplicateReferencesByUrl(refs);
    expect(deduplicated.length).toBe(2);
    expect(indexMapping.get(2)).toBe(1); // ref 2 maps to ref 1's new index
    expect(indexMapping.get(3)).toBe(2);
  });

  it("maps www to non-www as duplicates", () => {
    const refs = [
      { url: "https://www.example.com/page", index: 1 },
      { url: "https://example.com/page", index: 2 },
    ];
    const { deduplicated } = deduplicateReferencesByUrl(refs);
    expect(deduplicated.length).toBe(1);
  });

  it("handles refs without index field", () => {
    const refs = [
      { url: "https://example.com/page" },
      { url: "https://example.com/page" },
    ];
    const { deduplicated, indexMapping } = deduplicateReferencesByUrl(refs);
    expect(deduplicated.length).toBe(1);
    expect(indexMapping.size).toBe(0);
  });

  it("handles refs with empty url", () => {
    const refs = [
      { url: "", index: 1 },
      { url: "", index: 2 },
    ];
    const { deduplicated } = deduplicateReferencesByUrl(refs);
    // Both have empty url → normalized to same key → deduped to 1
    expect(deduplicated.length).toBe(1);
  });

  it("handles amp; encoded URLs as same as decoded", () => {
    const refs = [
      { url: "https://example.com/page?a=1&amp;b=2", index: 1 },
      { url: "https://example.com/page?a=1&b=2", index: 2 },
    ];
    const { deduplicated } = deduplicateReferencesByUrl(refs);
    expect(deduplicated.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// upgradeHttpToHttps
// ─────────────────────────────────────────────────────────────────
describe("upgradeHttpToHttps", () => {
  it("upgrades http:// to https:// for regular URLs", () => {
    const refs = [{ url: "http://example.com/page" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("https://example.com/page");
  });

  it("does not upgrade localhost URLs", () => {
    const refs = [{ url: "http://localhost:3000/api" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("http://localhost:3000/api");
  });

  it("does not upgrade 127.x.x.x URLs", () => {
    const refs = [{ url: "http://127.0.0.1:8080/api" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("http://127.0.0.1:8080/api");
  });

  it("does not upgrade 192.168.x.x URLs", () => {
    const refs = [{ url: "http://192.168.1.1/page" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("http://192.168.1.1/page");
  });

  it("does not upgrade 10.x.x.x URLs", () => {
    const refs = [{ url: "http://10.0.0.1/page" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("http://10.0.0.1/page");
  });

  it("leaves https:// URLs unchanged", () => {
    const refs = [{ url: "https://example.com/page" }];
    const result = upgradeHttpToHttps(refs);
    expect(result[0].url).toBe("https://example.com/page");
  });

  it("leaves refs without url unchanged", () => {
    const refs = [{ title: "No URL ref" }] as { url?: string; title: string }[];
    const result = upgradeHttpToHttps(refs);
    expect(result[0]).toEqual({ title: "No URL ref" });
  });
});

// ─────────────────────────────────────────────────────────────────
// decodeUrlEntities
// ─────────────────────────────────────────────────────────────────
describe("decodeUrlEntities", () => {
  it("decodes &amp; in URLs", () => {
    const refs = [{ url: "https://example.com/page?a=1&amp;b=2" }];
    const result = decodeUrlEntities(refs);
    expect(result[0].url).toBe("https://example.com/page?a=1&b=2");
  });

  it("decodes &lt; and &gt;", () => {
    const refs = [{ url: "https://example.com/?q=&lt;search&gt;" }];
    const result = decodeUrlEntities(refs);
    expect(result[0].url).toBe("https://example.com/?q=<search>");
  });

  it("decodes &quot; and &#39;", () => {
    const refs = [
      { url: "https://example.com/?q=&quot;hello&quot;&amp;x=&#39;y&#39;" },
    ];
    const result = decodeUrlEntities(refs);
    expect(result[0].url).toContain('"hello"');
  });

  it("returns same ref object when no encoding changes", () => {
    const ref = { url: "https://example.com/page" };
    const refs = [ref];
    const result = decodeUrlEntities(refs);
    expect(result[0]).toBe(ref); // Same reference (no change)
  });

  it("skips refs without url", () => {
    const refs = [{ title: "No URL" }] as { url?: string; title: string }[];
    const result = decodeUrlEntities(refs);
    expect(result[0]).toEqual({ title: "No URL" });
  });
});

// ─────────────────────────────────────────────────────────────────
// remapCitationIndices
// ─────────────────────────────────────────────────────────────────
describe("remapCitationIndices", () => {
  it("returns content unchanged when mapping is empty", () => {
    const content = "See [1] and [2] for details.";
    expect(remapCitationIndices(content, new Map())).toBe(content);
  });

  it("remaps citation indices according to the mapping", () => {
    const mapping = new Map([
      [1, 3],
      [2, 5],
    ]);
    const content = "See [1] and [2] for more.";
    const result = remapCitationIndices(content, mapping);
    expect(result).toBe("See [3] and [5] for more.");
  });

  it("keeps citations not in the mapping unchanged", () => {
    const mapping = new Map([[1, 10]]);
    const content = "See [1] and [99] for details.";
    const result = remapCitationIndices(content, mapping);
    expect(result).toBe("See [10] and [99] for details.");
  });
});

// ─────────────────────────────────────────────────────────────────
// repairOrderedListContinuity
// ─────────────────────────────────────────────────────────────────
describe("repairOrderedListContinuity", () => {
  it("re-numbers out-of-sequence items in a list", () => {
    const content = "1. First\n1. Second\n1. Third";
    const result = repairOrderedListContinuity(content);
    expect(result).toBe("1. First\n2. Second\n3. Third");
  });

  it("does not repair lists separated by paragraph content", () => {
    const content = "1. First\n\nSome paragraph text.\n\n1. New list";
    const result = repairOrderedListContinuity(content);
    // "1. New list" is a new list context, should remain 1.
    expect(result).toContain("1. New list");
  });

  it("resets at headings", () => {
    const content = "1. Item A\n\n### New Section\n\n1. Item B";
    const result = repairOrderedListContinuity(content);
    expect(result).toContain("1. Item B");
  });

  it("does not repair correctly-numbered lists", () => {
    const content = "1. First\n2. Second\n3. Third";
    const result = repairOrderedListContinuity(content);
    expect(result).toBe(content);
  });

  it("converts bullet-point items to normal when near list items", () => {
    const content = "1. Item\n- bullet\n1. Next";
    const result = repairOrderedListContinuity(content);
    // After bullet, lastListNum resets
    expect(result).toContain("1. Next");
  });

  it("handles blank lines between list items (max 1 blank)", () => {
    const content = "1. First\n\n1. Second";
    const result = repairOrderedListContinuity(content);
    // One blank line: still contiguous → repair
    expect(result).toContain("2. Second");
  });

  it("resets when blockquote appears in list context", () => {
    const content = "1. Item A\n> blockquote\n1. After blockquote";
    const result = repairOrderedListContinuity(content);
    expect(result).toContain("1. After blockquote");
  });
});

// ─────────────────────────────────────────────────────────────────
// linkifyCitations
// ─────────────────────────────────────────────────────────────────
describe("linkifyCitations", () => {
  it("returns content unchanged when no references section", () => {
    const content = "Text with [1] citation but no ref section.";
    expect(linkifyCitations(content)).toBe(content);
  });

  it("linkifies single citations in body (before reference section)", () => {
    const content =
      "Analysis [1] shows this.\n\n# References\n\n[1] Some article.";
    const result = linkifyCitations(content);
    expect(result).toContain('<a href="#ref-1" class="citation-link">[1]</a>');
  });

  it("linkifies multi-citations [1,2,3]", () => {
    const content = "See [1,2] for details.\n\n# References\n\n[1] A.\n[2] B.";
    const result = linkifyCitations(content);
    expect(result).toContain('<a href="#ref-1"');
    expect(result).toContain('<a href="#ref-2"');
  });

  it("does not linkify citations already in markdown links", () => {
    const content =
      "See [1](https://example.com).\n\n# References\n\n[1] Article.";
    const result = linkifyCitations(content);
    // [1](url) should not be touched
    expect(result).toContain("[1](https://example.com)");
  });

  it("preserves reference section without linkifying it", () => {
    const content = "Text.\n\n# References\n\n[1] First ref.\n[2] Second ref.";
    const result = linkifyCitations(content);
    // Reference section should remain unchanged
    expect(result).toContain("[1] First ref.");
    expect(result).toContain("[2] Second ref.");
  });
});

// ─────────────────────────────────────────────────────────────────
// anchorReferences
// ─────────────────────────────────────────────────────────────────
describe("anchorReferences", () => {
  it("adds anchor id to reference entries", () => {
    const content = "[1] First reference.\n[2] Second reference.";
    const result = anchorReferences(content);
    expect(result).toContain('<a id="ref-1"></a>[1] ');
    expect(result).toContain('<a id="ref-2"></a>[2] ');
  });

  it("leaves content without reference entries unchanged", () => {
    const content = "No references here.";
    expect(anchorReferences(content)).toBe(content);
  });
});

// ─────────────────────────────────────────────────────────────────
// numberSubHeadings guard branches
// ─────────────────────────────────────────────────────────────────
describe("numberSubHeadings guard branches", () => {
  const DIM = 1;

  it("removes JSON-like content masquerading as heading (line 61)", () => {
    const content = "### {key: value, data: 123}";
    const result = numberSubHeadings(content, DIM);
    expect(result).toBe("");
  });

  it("removes array-like content masquerading as heading (line 61)", () => {
    const content = "### [item1, item2]";
    const result = numberSubHeadings(content, DIM);
    expect(result).toBe("");
  });

  it("demotes long heading with period to bold paragraph (line 65)", () => {
    // Must be >40 chars AND contain 。 or .
    const longTitle =
      "这是一个超过四十个字符的很长标题内容，包含了许多详细信息并且以句号结尾说明完毕结束。";
    expect(longTitle.length).toBeGreaterThan(40);
    const content = `### ${longTitle}`;
    const result = numberSubHeadings(content, DIM);
    expect(result).toContain("**");
  });

  it("italicizes chart/figure caption heading (line 69)", () => {
    // Must start with 图 or 表 AND be >30 chars
    const caption =
      "图表展示了人工智能技术发展的历史脉络与未来展望，包含详细数据分析结果。";
    expect(caption.length).toBeGreaterThan(30);
    const content = `### ${caption}`;
    const result = numberSubHeadings(content, DIM);
    expect(result).toMatch(/^\*/);
  });

  it("handles h4 appearing before any h3 (line 79)", () => {
    const content = "#### Sub-section Title";
    const result = numberSubHeadings(content, DIM);
    // h3Count becomes 1 implicitly
    expect(result).toContain("1.1.1.");
  });

  it("strips Roman numeral prefix from heading", () => {
    const content = "### III. Roman Numeral Heading";
    const result = numberSubHeadings(content, DIM);
    expect(result).toContain("Roman Numeral Heading");
    expect(result).not.toContain("III.");
  });

  it("strips Chinese ordinal prefix from heading", () => {
    const content = "### 一、Chinese Ordinal Heading";
    const result = numberSubHeadings(content, DIM);
    expect(result).toContain("Chinese Ordinal Heading");
  });

  it("strips parenthesized ordinal prefix", () => {
    const content = "### （一）Parenthesized Heading";
    const result = numberSubHeadings(content, DIM);
    expect(result).toContain("Parenthesized Heading");
  });

  it("strips letter prefix like A. or B)", () => {
    const content = "### A. Letter Prefix Heading";
    const result = numberSubHeadings(content, DIM);
    expect(result).toContain("Letter Prefix Heading");
    expect(result).not.toContain("A.");
  });

  it("preserves 4-digit year in heading", () => {
    const content = "### 2026年技术展望";
    const result = numberSubHeadings(content, DIM);
    expect(result).toContain("2026年");
  });
});

// ─────────────────────────────────────────────────────────────────
// renumberHeadings — additional branches
// ─────────────────────────────────────────────────────────────────
describe("renumberHeadings — additional branches", () => {
  it("re-numbers #### two-part headings (#### N.M. format)", () => {
    const content = [
      "## 1. Chapter",
      "### 1.1. Sub",
      "### 1.2. Sub2",
      // Simulate that 1.1 was removed, now we have #### 1.2.1. and need renumber
      "#### 1.2.1. Deep",
    ].join("\n");
    const result = renumberHeadings(content);
    expect(result).toContain("#### 1.2.1.");
  });

  it("resets counter when non-numbered ## heading appears", () => {
    const content = [
      "## 1. Chapter",
      "### 1.1. Section",
      "## Unnumbered Chapter",
      "### 1.2. Should not be re-numbered",
    ].join("\n");
    const result = renumberHeadings(content);
    // After unnumbered ## heading, currentDim resets to 0
    expect(result).toContain("## Unnumbered Chapter");
  });

  it("handles bold list items re-numbering", () => {
    const content = [
      "## 1. Chapter",
      "### 1.1. Section",
      "8.22.1. **Item A**",
      "8.22.2. **Item B**",
    ].join("\n");
    const result = renumberHeadings(content);
    expect(result).toContain("1.1.1. **Item A**");
    expect(result).toContain("1.1.2. **Item B**");
  });

  it("converts plain numbered items under heading to bullets", () => {
    const content = ["## 1. Chapter", "### 1.1. Section", "1. Plain item"].join(
      "\n",
    );
    const result = renumberHeadings(content);
    expect(result).toContain("- Plain item");
  });
});

// ─────────────────────────────────────────────────────────────────
// deduplicateHeadings — Chinese numeral normalization
// ─────────────────────────────────────────────────────────────────
describe("deduplicateHeadings — normalization", () => {
  it("deduplicates headings with Chinese numeral prefix", () => {
    const content = "### 一、Title\n\n### Title";
    const result = deduplicateHeadings(content);
    // Both normalize to 'Title', second should be removed
    const headingCount = (result.match(/^###/gm) || []).length;
    expect(headingCount).toBe(1);
  });

  it("deduplicates headings with different whitespace", () => {
    const content = "### TitleWithSpaces\n\n### Title With Spaces";
    const result = deduplicateHeadings(content);
    const headingCount = (result.match(/^###/gm) || []).length;
    expect(headingCount).toBe(1);
  });

  it("keeps non-heading lines", () => {
    const content = "### Heading\n\nParagraph text.\n\n### Different Heading";
    const result = deduplicateHeadings(content);
    expect(result).toContain("Paragraph text.");
  });
});

// ─────────────────────────────────────────────────────────────────
// limitBoldFormatting — structural item preservation
// ─────────────────────────────────────────────────────────────────
describe("limitBoldFormatting — structural item preservation", () => {
  it("preserves bold on hierarchical list items regardless of count", () => {
    const content = [
      "### Section",
      "1.2.3. **Title Item**",
      "**extra bold 1**",
      "**extra bold 2**",
      "**extra bold 3**",
    ].join("\n");
    const result = limitBoldFormatting(content, 2);
    // Hierarchical item should always be preserved
    expect(result).toContain("**Title Item**");
  });

  it("strips bold beyond maxPerSection limit", () => {
    const content = [
      "### Section",
      "**Bold 1**",
      "**Bold 2**",
      "**Bold 3** should be stripped",
    ].join("\n");
    const result = limitBoldFormatting(content, 2);
    // Third bold should lose ** markers
    expect(result).toContain("should be stripped");
    const remainingBolds = (result.match(/\*\*/g) || []).length;
    expect(remainingBolds).toBeLessThanOrEqual(4); // 2 open + 2 close
  });
});

// ─────────────────────────────────────────────────────────────────
// deduplicateAdjacentCitations (already tested elsewhere, but add
// branches for edge cases)
// ─────────────────────────────────────────────────────────────────
describe("deduplicateAdjacentCitations — edge cases", () => {
  it("merges adjacent identical citations [1][1] → [1]", () => {
    const result = deduplicateAdjacentCitations("See [1][1] for details.");
    expect(result).toBe("See [1] for details.");
  });

  it("preserves distinct adjacent citations [1][2]", () => {
    const result = deduplicateAdjacentCitations("See [1][2] for details.");
    expect(result).toBe("See [1][2] for details.");
  });
});
