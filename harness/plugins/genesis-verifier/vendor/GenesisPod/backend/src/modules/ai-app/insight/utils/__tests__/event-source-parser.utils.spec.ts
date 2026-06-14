/**
 * Event Source Parser Utils Unit Tests
 *
 * Covers: assessSourceTier, extractDomain, truncateSourceContent,
 *         buildAnchorEvidence, formatAnchorContentForPrompt
 */

import {
  assessSourceTier,
  extractDomain,
  truncateSourceContent,
  buildAnchorEvidence,
  formatAnchorContentForPrompt,
} from "../event-source-parser.utils";

// ---------------------------------------------------------------------------
// assessSourceTier
// ---------------------------------------------------------------------------

describe("assessSourceTier", () => {
  describe("Tier 1 - government / official", () => {
    it("returns 1 for .gov domain", () => {
      expect(assessSourceTier("https://www.whitehouse.gov/news")).toBe(1);
    });

    it("returns 1 for .gov.uk domain", () => {
      expect(assessSourceTier("https://www.gov.uk/news")).toBe(1);
    });

    it("returns 1 for newsroom. subdomain", () => {
      expect(assessSourceTier("https://newsroom.microsoft.com/article")).toBe(
        1,
      );
    });

    it("returns 1 for press. subdomain", () => {
      expect(assessSourceTier("https://press.apple.com/release")).toBe(1);
    });

    it("returns 1 for investor. subdomain", () => {
      expect(assessSourceTier("https://investor.google.com/earnings")).toBe(1);
    });

    it("returns 1 for ir. subdomain", () => {
      expect(assessSourceTier("https://ir.tesla.com/quarterly")).toBe(1);
    });
  });

  describe("Tier 2 - authoritative media", () => {
    it("returns 2 for reuters.com", () => {
      expect(assessSourceTier("https://www.reuters.com/article")).toBe(2);
    });

    it("returns 2 for bloomberg.com", () => {
      expect(assessSourceTier("https://bloomberg.com/news")).toBe(2);
    });

    it("returns 2 for techcrunch.com", () => {
      expect(assessSourceTier("https://techcrunch.com/post")).toBe(2);
    });

    it("returns 2 for arxiv.org", () => {
      expect(assessSourceTier("https://arxiv.org/abs/2301.00001")).toBe(2);
    });

    it("returns 2 for mp.weixin.qq.com", () => {
      expect(assessSourceTier("https://mp.weixin.qq.com/s/abc123")).toBe(2);
    });

    it("returns 2 for cn.reuters.com (subdomain of tier-2)", () => {
      expect(assessSourceTier("https://cn.reuters.com/article")).toBe(2);
    });

    it("returns 2 for bbc.co.uk", () => {
      expect(assessSourceTier("https://www.bbc.co.uk/news")).toBe(2);
    });

    it("returns 2 for 36kr.com", () => {
      expect(assessSourceTier("https://36kr.com/p/123")).toBe(2);
    });
  });

  describe("Tier 3 - default", () => {
    it("returns 3 for unknown domain", () => {
      expect(assessSourceTier("https://example.com/page")).toBe(3);
    });

    it("returns 3 for invalid URL string", () => {
      expect(assessSourceTier("not-a-url")).toBe(3);
    });

    it("returns 3 for empty string", () => {
      expect(assessSourceTier("")).toBe(3);
    });

    it("returns 3 for random blog", () => {
      expect(assessSourceTier("https://someblog.io/post/1")).toBe(3);
    });
  });

  describe("domain string input (no protocol)", () => {
    it("accepts bare domain string for tier-2 match", () => {
      expect(assessSourceTier("reuters.com")).toBe(2);
    });

    it("strips www. from bare domain", () => {
      expect(assessSourceTier("www.reuters.com")).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// extractDomain
// ---------------------------------------------------------------------------

describe("extractDomain", () => {
  it("extracts hostname from https URL", () => {
    expect(extractDomain("https://www.reuters.com/article")).toBe(
      "reuters.com",
    );
  });

  it("strips www. prefix", () => {
    expect(extractDomain("https://www.bloomberg.com/news")).toBe(
      "bloomberg.com",
    );
  });

  it("preserves subdomain other than www", () => {
    expect(extractDomain("https://mp.weixin.qq.com/s/abc")).toBe(
      "mp.weixin.qq.com",
    );
  });

  it("returns undefined for invalid URL", () => {
    expect(extractDomain("not-a-url")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractDomain("")).toBeUndefined();
  });

  it("works with http protocol", () => {
    expect(extractDomain("http://techcrunch.com/post/1")).toBe(
      "techcrunch.com",
    );
  });

  it("works with path and query params", () => {
    expect(extractDomain("https://arxiv.org/abs/2301.00001?v=1")).toBe(
      "arxiv.org",
    );
  });
});

// ---------------------------------------------------------------------------
// truncateSourceContent
// ---------------------------------------------------------------------------

describe("truncateSourceContent", () => {
  it("returns content unchanged when within limit", () => {
    const content = "Hello World";
    expect(truncateSourceContent(content, 5000)).toBe(content);
  });

  it("returns content unchanged when exactly at limit", () => {
    const content = "a".repeat(5000);
    expect(truncateSourceContent(content, 5000)).toBe(content);
  });

  it("truncates and appends notice when over limit", () => {
    const content = "a".repeat(6000);
    const result = truncateSourceContent(content, 5000);
    expect(result.startsWith("a".repeat(5000))).toBe(true);
    expect(result).toContain("[... 内容已截取前 5000 字符]");
  });

  it("uses default maxLength of 5000", () => {
    const content = "b".repeat(6000);
    const result = truncateSourceContent(content);
    expect(result.length).toBeLessThan(6000);
    expect(result).toContain("5000");
  });

  it("respects custom maxLength", () => {
    const content = "c".repeat(200);
    const result = truncateSourceContent(content, 100);
    expect(result.startsWith("c".repeat(100))).toBe(true);
    expect(result).toContain("100");
  });
});

// ---------------------------------------------------------------------------
// buildAnchorEvidence
// ---------------------------------------------------------------------------

describe("buildAnchorEvidence", () => {
  const fullConfig: Record<string, unknown> = {
    sourceUrl: "https://reuters.com/article/abc",
    sourceContent: "This is a news article about important events.",
    sourceTitle: "Important Event",
    sourceDomain: "reuters.com",
    sourceTier: 2 as const,
    sourceDate: "2024-01-15",
  };

  it("builds anchor evidence with all fields present", () => {
    const result = buildAnchorEvidence(fullConfig);

    expect(result.title).toBe("[锚定文章] Important Event");
    expect(result.url).toBe("https://reuters.com/article/abc");
    expect(result.domain).toBe("reuters.com");
    expect(result.sourceType).toBe("anchor_article");
    expect(result.credibilityScore).toBe(85); // tier 2
    expect(result.publishedAt).toBe("2024-01-15");
  });

  it("maps tier 1 to credibilityScore 95", () => {
    const config = { ...fullConfig, sourceTier: 1 as const };
    const result = buildAnchorEvidence(config);
    expect(result.credibilityScore).toBe(95);
  });

  it("maps tier 3 to credibilityScore 70", () => {
    const config = { ...fullConfig, sourceTier: 3 as const };
    const result = buildAnchorEvidence(config);
    expect(result.credibilityScore).toBe(70);
  });

  it("snippet is first 300 chars of content", () => {
    const longContent = "x".repeat(500);
    const config = { ...fullConfig, sourceContent: longContent };
    const result = buildAnchorEvidence(config);
    expect(result.snippet.length).toBeLessThanOrEqual(300);
  });

  it("uses fallback placeholder when no sourceContent", () => {
    const config = {
      sourceUrl: "https://example.com/article",
      sourceTitle: "Test Article",
      sourceDomain: "example.com",
      sourceTier: 3 as const,
    };
    const result = buildAnchorEvidence(config);
    expect(result.fullContent).toContain("锚定文章");
    expect(result.fullContent).toContain("Test Article");
  });

  it("derives domain from sourceUrl when sourceDomain absent", () => {
    const config = {
      sourceUrl: "https://www.nytimes.com/article/1",
      sourceContent: "content",
      sourceTitle: "Article",
    };
    const result = buildAnchorEvidence(config);
    expect(result.domain).toBe("nytimes.com");
  });

  it("returns user-provided as domain when no url or domain", () => {
    const config = {
      sourceContent: "pasted content",
      sourceTitle: "Pasted",
    };
    const result = buildAnchorEvidence(config);
    expect(result.domain).toBe("user-provided");
  });

  it("publishedAt is null when sourceDate is absent", () => {
    const config = { sourceContent: "content" };
    const result = buildAnchorEvidence(config);
    expect(result.publishedAt).toBeNull();
  });

  it("assesses tier from sourceUrl when sourceTier absent", () => {
    const config = {
      sourceUrl: "https://reuters.com/article/1",
      sourceContent: "content",
    };
    const result = buildAnchorEvidence(config);
    // reuters.com is tier 2 → score 85
    expect(result.credibilityScore).toBe(85);
  });
});

// ---------------------------------------------------------------------------
// formatAnchorContentForPrompt
// ---------------------------------------------------------------------------

describe("formatAnchorContentForPrompt", () => {
  it("includes title when present", () => {
    const result = formatAnchorContentForPrompt({ sourceTitle: "My Article" });
    expect(result).toContain("**标题**: My Article");
  });

  it("includes source domain with tier label for tier 1", () => {
    const result = formatAnchorContentForPrompt({
      sourceDomain: "whitehouse.gov",
      sourceTier: 1,
    });
    expect(result).toContain("whitehouse.gov");
    expect(result).toContain("官方/政府");
  });

  it("includes source domain with tier label for tier 2", () => {
    const result = formatAnchorContentForPrompt({
      sourceDomain: "reuters.com",
      sourceTier: 2,
    });
    expect(result).toContain("权威媒体");
  });

  it("includes source domain with tier label for tier 3", () => {
    const result = formatAnchorContentForPrompt({
      sourceDomain: "example.com",
      sourceTier: 3,
    });
    expect(result).toContain("一般来源");
  });

  it("includes source URL when present", () => {
    const result = formatAnchorContentForPrompt({
      sourceUrl: "https://reuters.com/article/1",
    });
    expect(result).toContain("**链接**: https://reuters.com/article/1");
  });

  it("includes truncated content when present", () => {
    const result = formatAnchorContentForPrompt({
      sourceContent: "Article content here",
    });
    expect(result).toContain("**文章内容**:");
    expect(result).toContain("Article content here");
  });

  it("includes key entities when present", () => {
    const result = formatAnchorContentForPrompt({
      keyEntities: {
        people: ["Elon Musk"],
        organizations: ["Tesla"],
        technologies: ["EV"],
        locations: ["California"],
      },
    });
    expect(result).toContain("**关键实体**:");
    expect(result).toContain("人物: Elon Musk");
    expect(result).toContain("机构: Tesla");
    expect(result).toContain("技术: EV");
    expect(result).toContain("地区: California");
  });

  it("omits entity groups with empty arrays", () => {
    const result = formatAnchorContentForPrompt({
      keyEntities: {
        people: [],
        organizations: ["OpenAI"],
        technologies: [],
        locations: [],
      },
    });
    expect(result).toContain("机构: OpenAI");
    expect(result).not.toContain("人物:");
    expect(result).not.toContain("技术:");
  });

  it("returns empty string for empty config", () => {
    const result = formatAnchorContentForPrompt({});
    expect(result).toBe("");
  });

  it("does not include keyEntities section when keyEntities is absent", () => {
    const result = formatAnchorContentForPrompt({ sourceTitle: "Test" });
    expect(result).not.toContain("**关键实体**:");
  });
});
