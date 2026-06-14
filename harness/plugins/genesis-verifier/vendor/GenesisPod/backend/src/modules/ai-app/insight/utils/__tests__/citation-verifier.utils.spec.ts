import {
  extractCitationsWithContext,
  buildEvidenceFingerprint,
  scoreCitationMatch,
  verifyCitations,
  buildContiguousMapping,
  restoreGlobalIndices,
  type EvidenceForVerification,
} from "../citation-verifier.utils";

// ==================== extractCitationsWithContext ====================

describe("extractCitationsWithContext", () => {
  it("should extract all citations with surrounding context", () => {
    const content =
      "市场规模已达到 100 亿美元 [1]，预计未来五年将保持 15% 的年均增长率 [2]。";
    const results = extractCitationsWithContext(content);

    expect(results).toHaveLength(2);
    expect(results[0].index).toBe(1);
    expect(results[1].index).toBe(2);
    // Context should contain surrounding text
    expect(results[0].context).toContain("100 亿美元");
    expect(results[1].context).toContain("15%");
  });

  it("should handle empty content", () => {
    expect(extractCitationsWithContext("")).toHaveLength(0);
  });

  it("should handle content with no citations", () => {
    expect(
      extractCitationsWithContext("这是一段没有引用的文本。"),
    ).toHaveLength(0);
  });

  it("should handle duplicate citation numbers", () => {
    const content = "数据 [3] 显示增长 [3]";
    const results = extractCitationsWithContext(content);
    expect(results).toHaveLength(2);
    expect(results[0].index).toBe(3);
    expect(results[1].index).toBe(3);
  });
});

// ==================== buildEvidenceFingerprint ====================

describe("buildEvidenceFingerprint", () => {
  it("should extract numbers from evidence", () => {
    const fp = buildEvidenceFingerprint({
      index: 1,
      title: "AI Market Report 2024",
      content: "The market grew by 45% to reach $100B in 2024.",
    });

    expect(fp.numbers.has("45%")).toBe(true);
    expect(fp.numbers.has("2024")).toBe(true);
    expect(fp.numbers.has("100")).toBe(true);
  });

  it("should extract CJK amount numbers", () => {
    const fp = buildEvidenceFingerprint({
      index: 2,
      title: "中国AI市场分析",
      content: "市场规模达到1500亿元，同比增长32%。",
    });

    expect(fp.numbers.has("1500")).toBe(true);
    expect(fp.numbers.has("32%")).toBe(true);
  });

  it("should build trigrams from title", () => {
    const fp = buildEvidenceFingerprint({
      index: 1,
      title: "AI Market",
      content: null,
    });

    expect(fp.trigrams.size).toBeGreaterThan(0);
    expect(fp.trigrams.has("ai ")).toBe(true);
  });

  it("should extract domain", () => {
    const fp = buildEvidenceFingerprint({
      index: 1,
      title: "Test",
      domain: "mckinsey.com",
    });

    expect(fp.domainLower).toBe("mckinsey.com");
  });
});

// ==================== scoreCitationMatch ====================

describe("scoreCitationMatch", () => {
  const evidence: EvidenceForVerification = {
    index: 1,
    title: "Global AI Investment Trends 2024",
    domain: "mckinsey.com",
    content:
      "Global AI investment reached $200B in 2024, growing 45% year over year.",
  };

  const fingerprint = buildEvidenceFingerprint(evidence);

  it("should score high when context matches title", () => {
    const context =
      "根据 Global AI Investment Trends 2024 报告，投资额已达到 $200B [1]";
    const score = scoreCitationMatch(context, fingerprint);
    expect(score).toBeGreaterThan(15);
  });

  it("should score high when context contains matching numbers", () => {
    const context = "AI 投资在 2024 年达到 $200B，增长 45% [1]";
    const score = scoreCitationMatch(context, fingerprint);
    expect(score).toBeGreaterThan(10);
  });

  it("should score low when context is unrelated", () => {
    const context =
      "量子计算领域在超导量子比特方面取得了重大突破 [1]，IBM 的 1121 量子比特处理器。";
    const score = scoreCitationMatch(context, fingerprint);
    expect(score).toBeLessThan(5);
  });

  it("should boost score for domain match", () => {
    const contextWithDomain = "mckinsey.com 的研究显示 [1]";
    const contextWithoutDomain = "某研究机构的研究显示 [1]";
    const scoreWith = scoreCitationMatch(contextWithDomain, fingerprint);
    const scoreWithout = scoreCitationMatch(contextWithoutDomain, fingerprint);
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });
});

// ==================== verifyCitations ====================

describe("verifyCitations", () => {
  const evidenceList: EvidenceForVerification[] = [
    {
      index: 1,
      title: "Big Ideas in Tech 2024",
      domain: "a16z.com",
      content:
        "AI market size reached $200 billion in 2024, with enterprise adoption growing 45%.",
    },
    {
      index: 2,
      title: "Multi-Agent Systems Research",
      domain: "arxiv.org",
      content:
        "Multi-agent collaboration frameworks show 30% improvement in complex task completion.",
    },
    {
      index: 3,
      title: "Global AI Chip Market Analysis",
      domain: "gartner.com",
      content:
        "NVIDIA dominates the AI chip market with 80% share. GPU demand increased 60% in Q3 2024.",
    },
  ];

  it("should keep correctly placed citations", () => {
    // Use sufficient separation so context windows don't overlap and cause scoring ambiguity
    const para1 =
      "根据 Big Ideas in Tech 2024 的研究，AI market size 在 2024 年达到 $200 billion，" +
      "enterprise adoption 同比增长 45%，这是近年来最重要的行业里程碑之一。" +
      "投资机构普遍认为这一趋势将在未来三年持续，市场预计将在 2027 年突破 $500 billion。[1]";
    const separator =
      "\n\n" +
      "这是两段之间的填充文字，用于确保两个引用的上下文窗口不相互重叠。".repeat(
        3,
      ) +
      "\n\n";
    const para2 =
      "Multi-Agent Systems Research 表明，multi-agent collaboration frameworks 在 complex task completion 上" +
      "展现出显著优势。实验数据显示协作完成率提升了 30% improvement，这验证了多智能体协作范式的有效性。[2]";
    const content = para1 + separator + para2;
    const result = verifyCitations(content, evidenceList);

    // Both citations should be correctly identified - no hallucinations
    expect(result.stats.removed).toBe(0);
    expect(result.stats.total).toBe(2);
  });

  it("should correct misplaced citations", () => {
    // [2] 引用了 AI chip 的数据（应该是 [3]），[3] 引用了 multi-agent 的数据（应该是 [2]）
    const content =
      "NVIDIA 在 AI chip market 占据 80% 份额，GPU demand 在 2024 Q3 增长 60% [2]。多智能体 multi-agent 协作框架的 complex task 完成度提升了 30% [3]。";
    const result = verifyCitations(content, evidenceList);

    // 至少一个应该被纠正
    expect(result.stats.corrected).toBeGreaterThanOrEqual(1);
  });

  it("should remove hallucinated citations (non-existent index)", () => {
    const content = "这是一段包含不存在证据的引用 [99]。";
    const result = verifyCitations(content, evidenceList);

    const hallucinated = result.results.find((r) => r.originalIndex === 99);
    expect(hallucinated).toBeDefined();
    expect(hallucinated!.action).toBe("remove");
  });

  it("should handle empty content", () => {
    const result = verifyCitations("", evidenceList);
    expect(result.stats.total).toBe(0);
    expect(result.content).toBe("");
  });

  it("should handle empty evidence list", () => {
    const result = verifyCitations("Some content [1]", []);
    expect(result.stats.total).toBe(0);
    expect(result.content).toBe("Some content [1]");
  });

  it("should preserve non-citation content", () => {
    const content = "这是正文内容。\n\n### 子标题\n\n更多内容。";
    const result = verifyCitations(content, evidenceList);
    expect(result.content).toBe(content);
  });

  it("should handle multiple citations in same sentence", () => {
    const content =
      "AI 市场在 2024 达到 $200 billion [1]，NVIDIA GPU demand 增长 60% [3]。";
    const result = verifyCitations(content, evidenceList);

    // Both should be kept as correct
    expect(result.stats.kept).toBe(2);
  });
});

// ==================== buildContiguousMapping ====================

describe("buildContiguousMapping", () => {
  it("should map non-contiguous indices to contiguous 1-based", () => {
    const map = buildContiguousMapping([2, 5, 8, 11, 13]);

    expect(map.get(1)).toBe(2);
    expect(map.get(2)).toBe(5);
    expect(map.get(3)).toBe(8);
    expect(map.get(4)).toBe(11);
    expect(map.get(5)).toBe(13);
  });

  it("should handle already contiguous indices", () => {
    const map = buildContiguousMapping([1, 2, 3]);

    expect(map.get(1)).toBe(1);
    expect(map.get(2)).toBe(2);
    expect(map.get(3)).toBe(3);
  });

  it("should sort input before mapping", () => {
    const map = buildContiguousMapping([13, 2, 8, 5, 11]);

    expect(map.get(1)).toBe(2);
    expect(map.get(5)).toBe(13);
  });

  it("should handle empty array", () => {
    const map = buildContiguousMapping([]);
    expect(map.size).toBe(0);
  });

  it("should handle single element", () => {
    const map = buildContiguousMapping([7]);
    expect(map.get(1)).toBe(7);
    expect(map.size).toBe(1);
  });
});

// ==================== restoreGlobalIndices ====================

describe("restoreGlobalIndices", () => {
  it("should restore local indices to global", () => {
    const map = buildContiguousMapping([2, 5, 8]);
    const content = "根据报告 [1]，市场规模达到 100 亿 [2]，增长率为 15% [3]。";
    const result = restoreGlobalIndices(content, map);

    expect(result).toBe(
      "根据报告 [2]，市场规模达到 100 亿 [5]，增长率为 15% [8]。",
    );
  });

  it("should leave unmapped indices unchanged", () => {
    const map = buildContiguousMapping([2, 5]);
    const content = "数据 [1] 和 [2] 以及 [99]。";
    const result = restoreGlobalIndices(content, map);

    expect(result).toBe("数据 [2] 和 [5] 以及 [99]。");
  });

  it("should handle empty map", () => {
    const content = "不变的内容 [1] [2]。";
    const result = restoreGlobalIndices(content, new Map());
    expect(result).toBe(content);
  });

  it("should handle figure references without interfering", () => {
    const map = buildContiguousMapping([3, 7]);
    const content = "文本 [1] 和 <!-- figure:1:0 --> 内容 [2]。";
    const result = restoreGlobalIndices(content, map);

    // [1]→[3], [2]→[7], figure comment should not be affected
    expect(result).toBe("文本 [3] 和 <!-- figure:1:0 --> 内容 [7]。");
  });
});

// ==================== Integration: Contiguous + Verify ====================

describe("Integration: contiguous mapping + verification", () => {
  it("should handle full pipeline: remap → LLM output → restore → verify", () => {
    // Simulate: evidence with global indices [3, 7, 12]
    const globalIndices = [3, 7, 12];
    const map = buildContiguousMapping(globalIndices);

    // LLM writes with contiguous [1], [2], [3] but makes an error:
    // [2] should reference evidence about chips (global 12) but writes [2] (global 7)
    const llmOutput =
      "AI chips 市场由 NVIDIA 主导 [2]，多智能体系统正在崛起 [3]。";

    // Step 1: Restore global indices
    // [2]→[7], [3]→[12]
    const restored = restoreGlobalIndices(llmOutput, map);
    expect(restored).toBe(
      "AI chips 市场由 NVIDIA 主导 [7]，多智能体系统正在崛起 [12]。",
    );

    // Step 2: Verify citations
    const evidenceList: EvidenceForVerification[] = [
      {
        index: 3,
        title: "AI Market Overview",
        content: "Comprehensive overview of AI market trends.",
      },
      {
        index: 7,
        title: "Multi-Agent Framework Study",
        content:
          "Multi-agent systems show promise in collaborative task solving.",
      },
      {
        index: 12,
        title: "AI Chip Market Analysis",
        domain: "gartner.com",
        content:
          "NVIDIA dominates AI chip market with 80% share. GPU demand surged.",
      },
    ];

    const verified = verifyCitations(restored, evidenceList);

    // The verifier should catch that [7] is used in chip context (should be [12])
    // and [12] is used in multi-agent context (should be [7])
    expect(verified.stats.total).toBe(2);
    // At least one should be corrected or the content should be more accurate
    expect(
      verified.stats.corrected + verified.stats.kept,
    ).toBeGreaterThanOrEqual(1);
  });
});
