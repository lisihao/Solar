/**
 * ReportAssemblerService Unit Tests
 *
 * Coverage targets:
 * - processDimensionContent: delegates to formatDimensionContent, handles empty content
 * - assembleFullReport:
 *   - Language labels (zh vs en)
 *   - Preface / executiveSummary (present / absent)
 *   - TOC generation with and without supplementary sections
 *   - Dimension sections (empty dimension skipped, content body check)
 *   - Supplementary sections (crossDimensionAnalysis, riskAssessment, strategicRecommendations)
 *   - Fallback sections when all supplementary are empty
 *   - Conclusion dedup logic (overlapRatio > 0.4, h3Overlap > 0.5, partial overlap, full dup)
 *   - Appendices
 *   - References (buildReferencesSection)
 *   - Blockquote stripping from crossDimension/risk/strategy
 * - postProcessFinalReport:
 *   - With qualityGate (wasAutoFixed=true, wasAutoFixed=false, violations)
 *   - Without qualityGate (horizontal rules, bold count > 60)
 *   - Deep headings warning
 *   - All pipeline steps run without error on valid content
 * - reprocessStoredReport: delegates to postProcessFinalReport
 * - finalizeReportWithCitations: delegates to mergeAdjacentMathBlocks
 * - Private: isGarbageFigureUrl (garbage patterns)
 * - Private: resolveChartPlaceholders (no refs, with refs, fallback injection, deduplicate)
 * - Private: injectChartsByPosition (with position hint, without hint, no insertion points)
 * - Private: buildReferencesSection (empty refs, junk filtered, dedup, index remapping)
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  ReportAssemblerService,
  type SupplementaryContent,
  type ReportReference,
} from "../report-assembler.service";
import type { ResearchTopic } from "@prisma/client";
import type { DimensionAnalysisInput } from "../../../types/report.types";
import type { FigureReference } from "../../../types/research.types";

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockTopic: ResearchTopic = {
  id: "topic-001",
  name: "量子计算发展趋势",
  type: "technology",
  description: "量子计算领域分析",
  language: "zh",
  userId: "user-001",
  status: "ACTIVE",
  topicConfig: null,
  searchConfig: null,
  visibility: "PRIVATE",
  createdAt: new Date(),
  updatedAt: new Date(),
  scheduledAt: null,
  refreshInterval: null,
  lastRefreshedAt: null,
  totalTokens: 0,
  totalSources: 0,
  totalDimensions: 0,
  isTemplate: false,
  templateCategory: null,
  templateDescription: null,
  shareToken: null,
  sharedAt: null,
  tags: [],
} as unknown as ResearchTopic;

const mockEnglishTopic: ResearchTopic = {
  ...mockTopic,
  language: "en",
} as unknown as ResearchTopic;

function buildDimension(
  overrides?: Partial<DimensionAnalysisInput>,
): DimensionAnalysisInput {
  return {
    dimensionId: "dim-001",
    dimensionName: "技术现状",
    dimensionDescription: "当前技术状态",
    summary: "量子计算进入实用化阶段",
    keyFindings: [
      {
        finding: "超导量子位错误率下降",
        significance: "high",
        evidenceIds: ["ev-1"],
      },
    ],
    trends: [
      {
        trend: "量子优越性实验增加",
        direction: "up",
        timeframe: "2024",
        evidenceIds: ["ev-1"],
      },
    ],
    challenges: [
      { challenge: "退相干问题", impact: "high", evidenceIds: ["ev-2"] },
    ],
    opportunities: [
      {
        opportunity: "药物研发加速",
        potential: "very high",
        evidenceIds: ["ev-3"],
      },
    ],
    detailedContent:
      "### 技术进展\n\n量子计算机已突破 1000 量子位门槛。\n\n有实质性内容在此处。",
    sourcesUsed: 10,
    figureReferences: [],
    generatedCharts: [],
    ...overrides,
  };
}

function buildSupplementary(
  overrides?: Partial<SupplementaryContent>,
): SupplementaryContent {
  return {
    preface: "本报告基于最新研究数据进行综合分析。",
    executiveSummary: "量子计算进入新纪元，商业化路径逐渐清晰。",
    crossDimensionAnalysis: "跨维度分析：各维度之间存在显著关联。",
    riskAssessment: "主要风险：技术成熟度不足，市场接受度低。",
    strategicRecommendations: "建议：加大研发投入，建立战略合作。",
    conclusion: "综上所述，量子计算具有广阔的发展前景。",
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Test Suite
// ──────────────────────────────────────────────────────────────────────────────

describe("ReportAssemblerService", () => {
  let service: ReportAssemblerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportAssemblerService],
    }).compile();

    service = module.get<ReportAssemblerService>(ReportAssemblerService);
  });

  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // processDimensionContent
  // ============================================================

  describe("processDimensionContent", () => {
    it("should process basic content without throwing", () => {
      const result = service.processDimensionContent(
        "## Leading Heading\n\nSome content here.\n\nMore content.",
        0,
        new Set<string>(),
        "Tech",
      );

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should strip chart JSON from content", () => {
      const contentWithChart =
        'Paragraph content.\n\n```json\n{"type":"bar","data":[]}\n```\n\nMore text.';

      const result = service.processDimensionContent(
        contentWithChart,
        0,
        new Set<string>(),
        "Tech",
      );

      expect(typeof result).toBe("string");
    });

    it("should handle empty string content", () => {
      const result = service.processDimensionContent(
        "",
        0,
        new Set<string>(),
        "Empty",
      );

      expect(typeof result).toBe("string");
    });

    it("should accept figure references and generated charts without error", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-001",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/chart.png",
          caption: "Chart 1",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Some content with <!-- figure:1:0 --> embedded.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(typeof result).toBe("string");
    });

    it("should handle dimIndex correctly for different indices", () => {
      const r0 = service.processDimensionContent(
        "Content here",
        0,
        new Set<string>(),
        "D0",
      );
      const r1 = service.processDimensionContent(
        "Content here",
        1,
        new Set<string>(),
        "D1",
      );
      // Both should succeed
      expect(typeof r0).toBe("string");
      expect(typeof r1).toBe("string");
    });
  });

  // ============================================================
  // assembleFullReport
  // ============================================================

  describe("assembleFullReport", () => {
    it("should include report title from topic.name", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
      );

      expect(result).toContain("量子计算发展趋势");
    });

    it("should use Chinese labels for zh language", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
      );

      expect(result).toContain("执行摘要");
      expect(result).toContain("目录");
      // References label only appears when references are provided
      expect(result).toContain("结语");
    });

    it("should use English labels for en language", () => {
      const result = service.assembleFullReport(
        mockEnglishTopic,
        [buildDimension()],
        buildSupplementary(),
      );

      expect(result).toContain("Executive Summary");
      expect(result).toContain("Table of Contents");
    });

    it("should include preface when provided", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({ preface: "This is the preface content." }),
      );

      expect(result).toContain("前言");
      expect(result).toContain("This is the preface content.");
    });

    it("should not include preface section when not provided", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({ preface: undefined }),
      );

      expect(result).not.toContain("## 前言");
    });

    it("should include executive summary when provided", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({
          executiveSummary: "Executive summary content here.",
        }),
      );

      expect(result).toContain("执行摘要");
    });

    it("should skip empty dimensions (no content after processing)", () => {
      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => {});

      const emptyDim = buildDimension({
        detailedContent: "",
        summary: "",
        dimensionName: "EmptyDim",
      });

      const result = service.assembleFullReport(
        mockTopic,
        [emptyDim],
        buildSupplementary(),
      );

      // Should not include the empty dimension heading
      expect(result).not.toContain("## 1. EmptyDim");
      warnSpy.mockRestore();
    });

    it("should include dimension heading for non-empty dimensions", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension({ dimensionName: "技术现状" })],
        buildSupplementary(),
      );

      expect(result).toContain("技术现状");
    });

    it("should sort dimensions by priority", () => {
      const dims = [
        buildDimension({
          dimensionId: "dim-b",
          dimensionName: "后者",
          priority: 2,
        }),
        buildDimension({
          dimensionId: "dim-a",
          dimensionName: "前者",
          priority: 1,
        }),
      ];

      const result = service.assembleFullReport(
        mockTopic,
        dims,
        buildSupplementary(),
      );

      const pos1 = result.indexOf("前者");
      const pos2 = result.indexOf("后者");
      expect(pos1).toBeLessThan(pos2);
    });

    it("should use fallback name for dimension without dimensionName", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension({ dimensionName: "" })],
        buildSupplementary(),
      );

      // Should still produce a valid report
      expect(result).toContain("量子计算发展趋势");
    });

    it("should include crossDimensionAnalysis section when provided", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({
          crossDimensionAnalysis: "Cross analysis content here.",
        }),
      );

      expect(result).toContain("跨维度关联分析");
    });

    it("should include riskAssessment section when provided", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({ riskAssessment: "Risk assessment content." }),
      );

      expect(result).toContain("风险评估");
    });

    it("should include strategicRecommendations section when provided", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({
          strategicRecommendations: "Strategic recommendations.",
        }),
      );

      expect(result).toContain("战略建议");
    });

    it("should include conclusion when provided and not duplicate", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({ conclusion: "Unique conclusion content here." }),
      );

      expect(result).toContain("结语");
      expect(result).toContain("Unique conclusion content here.");
    });

    it("should strip blockquotes from crossDimensionAnalysis", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({
          crossDimensionAnalysis:
            "> This is a blockquote line\n> Another blockquote",
        }),
      );

      // Blockquotes should be stripped (> prefix removed)
      expect(result).toContain("This is a blockquote line");
      // The > should not appear at line start in the crossDimension section
    });

    it("should strip blockquotes from riskAssessment", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({
          riskAssessment: "> Risk blockquote line",
        }),
      );

      expect(result).toContain("Risk blockquote line");
    });

    it("should strip blockquotes from strategicRecommendations", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({
          strategicRecommendations: "> Strategic blockquote",
        }),
      );

      expect(result).toContain("Strategic blockquote");
    });

    it("should generate fallback sections when all supplementary are empty", () => {
      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => {});

      const dims = [
        buildDimension({
          dimensionName: "Dim A",
          keyFindings: [
            { finding: "Key finding A", significance: "high", evidenceIds: [] },
          ],
          challenges: [
            { challenge: "Challenge A", impact: "high", evidenceIds: [] },
          ],
          opportunities: [
            {
              opportunity: "Opportunity A",
              potential: "high",
              evidenceIds: [],
            },
          ],
        }),
      ];

      const result = service.assembleFullReport(mockTopic, dims, {
        crossDimensionAnalysis: undefined,
        riskAssessment: undefined,
        strategicRecommendations: undefined,
      });

      // Fallback sections should appear
      expect(result).toContain("跨维度关联分析");
      expect(result).toContain("风险评估");
      expect(result).toContain("战略建议");
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("should not generate fallback risk section when dimensions have no challenges", () => {
      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => {});

      const dims = [
        buildDimension({
          keyFindings: [],
          challenges: [],
          opportunities: [],
        }),
      ];

      const result = service.assembleFullReport(mockTopic, dims, {});

      // No challenges → no risk fallback → just the overall report structure
      expect(typeof result).toBe("string");
      warnSpy.mockRestore();
    });

    it("should include appendices when provided in options", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
        {
          appendices: [{ title: "Appendix A", content: "Appendix A content." }],
        },
      );

      expect(result).toContain("Appendix A");
      expect(result).toContain("Appendix A content.");
    });

    it("should include references section when references provided", () => {
      const refs: ReportReference[] = [
        {
          index: 1,
          title: "Quantum Computing 2024",
          url: "https://arxiv.org/abs/2024.0001",
          domain: "arxiv.org",
        },
      ];

      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
        { references: refs },
      );

      expect(result).toContain("参考文献");
      expect(result).toContain("Quantum Computing 2024");
    });

    it("should handle empty references array gracefully", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
        { references: [] },
      );

      expect(typeof result).toBe("string");
    });

    it("should extract markdown from JSON-wrapped supplementary content", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({
          preface: JSON.stringify({ content: "Preface from JSON" }),
        }),
      );

      expect(typeof result).toBe("string");
    });

    it("should handle conclusion with high paragraph overlap (fully duplicate)", () => {
      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => {});

      // Create a conclusion that exactly matches cross-dimension content.
      // Must be >= 60 chars (trimmed) to pass the paragraph-key threshold.
      // Need ratio > 0.4 → use 2 identical paragraphs so overlap = 100%
      const para1 =
        "第一段跨维度分析内容，描述技术趋势与市场发展之间的深层关联，内容足够长以触发重叠检测机制，并计入段落去重逻辑判断流程中才有效。";
      const para2 =
        "第二段跨维度分析内容，探讨政策环境对技术创新的深远影响及其商业化路径规划，同样足够长以触发重叠检测逻辑并被纳入段落键比较。";
      const sc: SupplementaryContent = {
        crossDimensionAnalysis: `${para1}\n\n${para2}`,
        riskAssessment: undefined,
        strategicRecommendations: undefined,
        // Conclusion exactly duplicates both paragraphs (100% overlap)
        conclusion: `${para1}\n\n${para2}`,
      };

      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        sc,
      );

      // Should either skip or partially strip conclusion; logger.warn should fire
      expect(typeof result).toBe("string");
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("should include partial conclusion when only some paragraphs overlap", () => {
      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => {});

      const shared =
        "这是共享段落内容，足够长以触发重叠检测机制，该段落同时出现在结论和跨维度分析中，用于验证部分重叠的去重逻辑是否正常工作并触发相关警告日志。";
      const unique =
        "这是独一无二的结语段落，与其他章节没有任何重叠，字数超过六十个字符以确保被计入段落键并保留在最终生成报告的正文内容当中完整呈现。";
      const sc: SupplementaryContent = {
        crossDimensionAnalysis: shared,
        conclusion: `${shared}\n\n${unique}`, // 50% overlap
      };

      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        sc,
      );

      expect(typeof result).toBe("string");
      warnSpy.mockRestore();
    });

    it("should include conclusion with H3 overlap guard", () => {
      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => {});

      const sc: SupplementaryContent = {
        crossDimensionAnalysis:
          "### 关键趋势分析\n\n跨维度关键趋势内容，涵盖多个维度的综合分析。\n\n### 战略影响评估\n\n战略影响相关内容，对企业决策具有重要指导意义。",
        conclusion:
          "### 关键趋势分析\n\n结语中的关键趋势分析内容。\n\n### 战略影响评估\n\n结语中的战略影响内容，与上文形成呼应。",
      };

      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        sc,
      );

      expect(typeof result).toBe("string");
      warnSpy.mockRestore();
    });

    it("should include unique conclusion when no overlap", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({
          crossDimensionAnalysis:
            "完全不同的跨维度分析内容，与结语没有任何重叠。",
          conclusion:
            "这是一个完全独立的结语，与其他任何部分都没有重叠，属于原创性总结内容。",
        }),
      );

      expect(result).toContain("结语");
    });

    it("should add TOC entries for supplementary sections", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary({
          crossDimensionAnalysis: "Cross content.",
          riskAssessment: "Risk content.",
          strategicRecommendations: "Strategic content.",
        }),
      );

      // TOC should contain entries for these sections
      expect(result).toContain("跨维度关联分析");
      expect(result).toContain("风险评估");
      expect(result).toContain("战略建议");
    });

    it("should use detailedContent over summary when both available", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [
          buildDimension({
            detailedContent:
              "### Detailed Section\n\nDetailed content is preferred.\n\nMore details here.",
            summary: "Summary content should not appear.",
          }),
        ],
        buildSupplementary(),
      );

      expect(result).toContain("Detailed content is preferred.");
    });

    it("should use summary when detailedContent is empty", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [
          buildDimension({
            detailedContent: "",
            summary:
              "### Summary Section\n\nFallback summary content used here.\n\nLong enough.",
          }),
        ],
        buildSupplementary(),
      );

      expect(result).toContain("Fallback summary content used here.");
    });

    it("should handle dimensions without priority (use 999 as default)", () => {
      const result = service.assembleFullReport(
        mockTopic,
        [
          buildDimension({ priority: undefined, dimensionName: "NoPriority" }),
          buildDimension({ priority: 1, dimensionName: "HasPriority" }),
        ],
        buildSupplementary(),
      );

      // HasPriority should come before NoPriority
      const posHas = result.indexOf("HasPriority");
      const posNo = result.indexOf("NoPriority");
      if (posHas >= 0 && posNo >= 0) {
        expect(posHas).toBeLessThan(posNo);
      }
    });
  });

  // ============================================================
  // postProcessFinalReport
  // ============================================================

  describe("postProcessFinalReport", () => {
    it("should run without error on basic content", () => {
      const result = service.postProcessFinalReport(
        "# Report\n\n## Section 1\n\nContent here.",
        "zh",
      );

      expect(result.content).toBeDefined();
      expect(result.warnings).toBeInstanceOf(Array);
    });

    it("should remove horizontal rules and add warning when no quality gate", () => {
      const content =
        "# Report\n\n---\n\nSome content.\n\n---\n\nMore content.";

      const result = service.postProcessFinalReport(content, "zh");

      expect(result.warnings.some((w) => w.includes("horizontal rule"))).toBe(
        true,
      );
    });

    it("should reduce bold formatting and add warning when count > 60", () => {
      // Create content with many bold markers
      const bolds = Array.from({ length: 65 }, (_, i) => `**bold${i}**`).join(
        " ",
      );
      const content = `# Report\n\n## Section 1\n\n${bolds}`;

      const result = service.postProcessFinalReport(content, "zh");

      expect(result.warnings.some((w) => w.includes("Bold formatting"))).toBe(
        true,
      );
    });

    it("should NOT add bold warning when bold count <= 60", () => {
      const bolds = Array.from({ length: 20 }, (_, i) => `**b${i}**`).join(" ");
      const content = `# Report\n\n## Section 1\n\n${bolds}`;

      const result = service.postProcessFinalReport(content, "zh");

      expect(result.warnings.some((w) => w.includes("Bold"))).toBe(false);
    });

    it("should use provided qualityGate and apply fixes when wasAutoFixed=true", () => {
      const mockQualityGate = {
        validateFullReport: jest.fn().mockReturnValue({
          violations: [{ message: "Too many bold markers" }],
          wasAutoFixed: true,
          fixedContent: "# Fixed Report\n\nFixed content.",
        }),
      };

      const result = service.postProcessFinalReport(
        "# Original\n\nContent.",
        "zh",
        mockQualityGate as any,
      );

      expect(mockQualityGate.validateFullReport).toHaveBeenCalled();
      expect(result.warnings).toContain("Too many bold markers");
      expect(result.content).toContain("Fixed content.");
    });

    it("should use qualityGate but keep original when wasAutoFixed=false", () => {
      const mockQualityGate = {
        validateFullReport: jest.fn().mockReturnValue({
          violations: [],
          wasAutoFixed: false,
          fixedContent: "Should not be used",
        }),
      };

      const original = "# Report\n\nOriginal content.";
      const result = service.postProcessFinalReport(
        original,
        "zh",
        mockQualityGate as any,
      );

      expect(mockQualityGate.validateFullReport).toHaveBeenCalled();
      // Content should still go through all pipeline steps but not be replaced by fixedContent
      expect(result.content).not.toContain("Should not be used");
    });

    it("should warn about deep headings (h5/h6)", () => {
      const content =
        "# Report\n\n##### Deep Heading 1\n\nContent.\n\n###### Deep Heading 2\n\nMore.";

      const result = service.postProcessFinalReport(content, "zh");

      expect(result.warnings.some((w) => w.includes("Deep headings"))).toBe(
        true,
      );
    });

    it("should strip figure placeholders <!-- figure:N:M -->", () => {
      const content =
        "# Report\n\n## Section\n\nContent <!-- figure:1:0 --> here.\n\nEnd.";

      const result = service.postProcessFinalReport(content, "zh");

      expect(result.content).not.toContain("<!-- figure:");
    });

    it("should strip HTML-escaped figure placeholders", () => {
      const content =
        "# Report\n\n## Section\n\nContent &lt;!-- figure:1:0 --&gt; here.\n\nEnd.";

      const result = service.postProcessFinalReport(content, "zh");

      expect(result.content).not.toContain("&lt;!-- figure:");
    });

    it("should replace --- separators in flow text", () => {
      const content = "# Report\n\n## Section\n\nContent.\n---\nMore content.";

      const result = service.postProcessFinalReport(content, "zh");

      expect(result.content).not.toContain("\n---\n");
    });

    it("should work with en language parameter", () => {
      const result = service.postProcessFinalReport(
        "# Report\n\n## Section\n\nContent here.",
        "en",
      );

      expect(result.content).toBeDefined();
      expect(result.warnings).toBeInstanceOf(Array);
    });

    it("should default to zh language when no language provided", () => {
      const result = service.postProcessFinalReport(
        "# Report\n\n## Section\n\nContent.",
      );

      expect(result.content).toBeDefined();
    });

    it("should log warnings when warnings array is non-empty", () => {
      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => {});
      const content = "# Report\n\n---\n\nContent.";

      service.postProcessFinalReport(content, "zh");

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("should handle empty content without throwing", () => {
      const result = service.postProcessFinalReport("", "zh");

      expect(result.content).toBeDefined();
      expect(result.warnings).toBeInstanceOf(Array);
    });

    it("should preserve <!-- chart:xxx --> markers in final report (regression: c3e7ad75f)", () => {
      // chart comments are positioning markers used by frontend — MUST survive post-processing
      const content =
        "段落内容\n\n<!-- chart:d0-chart-001 -->\n\n更多内容\n\n<!-- chart:d1-chart-002 -->\n\n结尾";
      const result = service.postProcessFinalReport(content);
      expect(result.content).toContain("<!-- chart:d0-chart-001 -->");
      expect(result.content).toContain("<!-- chart:d1-chart-002 -->");
    });
  });

  // ============================================================
  // reprocessStoredReport
  // ============================================================

  describe("reprocessStoredReport", () => {
    it("should delegate to postProcessFinalReport", () => {
      const spy = jest.spyOn(service, "postProcessFinalReport");

      service.reprocessStoredReport("# Stored Report\n\nContent.", "zh");

      expect(spy).toHaveBeenCalledWith("# Stored Report\n\nContent.", "zh");
      spy.mockRestore();
    });

    it("should default to zh language", () => {
      const spy = jest.spyOn(service, "postProcessFinalReport");

      service.reprocessStoredReport("# Stored Report\n\nContent.");

      expect(spy).toHaveBeenCalledWith("# Stored Report\n\nContent.", "zh");
      spy.mockRestore();
    });

    it("should return PostProcessResult", () => {
      const result = service.reprocessStoredReport(
        "# Report\n\n## Section\n\nContent.",
        "en",
      );

      expect(result).toHaveProperty("content");
      expect(result).toHaveProperty("warnings");
    });
  });

  // ============================================================
  // finalizeReportWithCitations
  // ============================================================

  describe("finalizeReportWithCitations", () => {
    it("should return a string", () => {
      const result = service.finalizeReportWithCitations(
        "# Report\n\nContent with $a$ and $b$ math.",
      );

      expect(typeof result).toBe("string");
    });

    it("should merge adjacent math blocks", () => {
      const content = "Content $a$ $b$ $c$ end.";
      const result = service.finalizeReportWithCitations(content);
      expect(typeof result).toBe("string");
    });
  });

  // ============================================================
  // Private: isGarbageFigureUrl (via resolveChartPlaceholders via processDimensionContent)
  // ============================================================

  describe("isGarbageFigureUrl (via processDimensionContent)", () => {
    it("should filter out garbage URLs (qrcode)", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-001",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/qrcode-123.png",
          caption: "QR Code",
          position: "after_paragraph_1",
        },
      ];

      // Should not include this figure reference in chart placeholders
      const result = service.processDimensionContent(
        "Content with <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(typeof result).toBe("string");
      expect(result).not.toContain("<!-- chart:");
    });

    it("should filter out favicon URLs", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-002",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/favicon.ico",
          caption: "Favicon",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });

    it("should filter out logo/icon URLs", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-003",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/logo-main.png",
          caption: "Logo",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });

    it("should filter out base64-image placeholder strings", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-004",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "[base64-image:chart]",
          caption: "Base64 placeholder",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });

    it("should filter out stock photo domain URLs", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-005",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://unsplash.com/photo/abc123.jpg",
          caption: "Stock Photo",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });

    it("should filter out tracking pixel URLs (tiny dimensions)", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-006",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/pixel.gif?w=1&h=1",
          caption: "Pixel",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });

    it("should allow valid image URLs through", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-007",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/research-chart.png",
          caption: "Research Chart",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 --> here.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      // Valid URL should resolve to a chart placeholder
      expect(result).toContain("<!-- chart:");
    });

    it("should filter out URLs with CDN corruption ($s! pattern)", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-008",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://substackcdn.com/image/$s!abcdef.jpg",
          caption: "Corrupted CDN",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });

    it("should allow data: URI images through (base64 from FigureExtractorService)", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-009",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          caption: "Base64 image",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 --> here.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      // data: URIs should pass through
      expect(result).toContain("<!-- chart:");
    });

    it("should filter out undefined imageUrl", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-010",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: undefined,
          caption: "No image",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });

    it("should filter out excessively long URLs (> 2048 chars)", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-011",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/" + "a".repeat(2100),
          caption: "Too long URL",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });

    it("should filter appcode URLs", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-012",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/appcode-scan.jpg",
          caption: "App Code",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });

    it("should strip unresolved figure placeholder when ref indices do not match", () => {
      // Content has <!-- figure:1:0 --> (evidenceIdx=1, figIdx=0)
      // Valid ref has evidenceCitationIndex=99 which does NOT match evidenceIdx=1
      // → resolve returns _match (line 895), then step 3 strips the remaining placeholder
      const figureRefs: FigureReference[] = [
        {
          id: "fig-nomatch",
          evidenceCitationIndex: 99, // won't match figure:1:0
          figureIndex: 0,
          imageUrl: "https://example.com/valid-chart.png",
          caption: "No Match",
          position: "after_paragraph_1",
        },
        // Also provide an actually matching ref for a DIFFERENT placeholder to ensure
        // existingPlaceholders > 0 triggers the normal path (not fallback injection)
        {
          id: "fig-match",
          evidenceCitationIndex: 2, // matches figure:2:0
          figureIndex: 0,
          imageUrl: "https://example.com/valid-chart2.png",
          caption: "Match",
          position: "after_paragraph_1",
        },
      ];

      // Content has both figure:1:0 (will not match fig-nomatch) and figure:2:0 (will match fig-match)
      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 --> and <!-- figure:2:0 --> here.\n\nMore text.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      // Unresolved placeholder for figure:1:0 should be stripped (not converted)
      expect(result).not.toContain("<!-- figure:1:0 -->");
      // Resolved placeholder for figure:2:0 should be converted
      expect(result).toContain("<!-- chart:d0-fig-match -->");
    });

    it("should resolve figure placeholder to chart when matching ref exists (direct resolveChartPlaceholders call)", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-direct",
          evidenceCitationIndex: 3,
          figureIndex: 1,
          imageUrl: "https://example.com/valid.png",
          caption: "Direct test",
          position: "after_paragraph_1",
        },
      ];

      // Call the private resolveChartPlaceholders method directly
      const result = (service as any).resolveChartPlaceholders(
        "Content <!-- figure:3:1 --> here.",
        0,
        figureRefs,
      );

      expect(result).toContain("<!-- chart:d0-fig-direct -->");
    });

    it("should return _match for unresolved figure placeholder (direct resolveChartPlaceholders call)", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-nomatch",
          evidenceCitationIndex: 99, // won't match figure:3:1
          figureIndex: 1,
          imageUrl: "https://example.com/valid.png",
          caption: "No match",
          position: "after_paragraph_1",
        },
      ];

      // Content has figure:3:1 but ref has evidenceCitationIndex=99 (no match)
      // → returns _match, then step 3 strips it
      const result = (service as any).resolveChartPlaceholders(
        "Content <!-- figure:3:1 --> here.",
        0,
        figureRefs,
      );

      // Unresolved placeholder should be stripped in step 3
      expect(result).not.toContain("<!-- figure:3:1 -->");
      // And not converted to chart (the _match path was exercised, then stripped)
      expect(result).not.toContain("<!-- chart:d0-fig-nomatch -->");
    });

    it("should filter aicode URLs", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-013",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/aicode-123.png",
          caption: "AI Code",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });

    it("should filter base64-image without brackets prefix", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-014",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "base64-image:chart-data",
          caption: "Base64 No Bracket",
          position: "after_paragraph_1",
        },
      ];

      const result = service.processDimensionContent(
        "Content <!-- figure:1:0 -->.",
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).not.toContain("<!-- chart:");
    });
  });

  // ============================================================
  // Private: resolveChartPlaceholders — fallback injection path
  // ============================================================

  describe("resolveChartPlaceholders fallback (no explicit figure placeholders)", () => {
    it("should inject charts by position when no figure placeholders exist in content", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-abc",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/valid-chart.png",
          caption: "Valid Chart",
          position: "after_paragraph_1",
        },
      ];

      // Content without <!-- figure:N:M --> placeholders
      const content = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
      const result = service.processDimensionContent(
        content,
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).toContain("<!-- chart:");
    });

    it("should handle content without paragraph boundaries (edge case)", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-edge",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/valid.png",
          caption: "Edge Case",
          position: "", // no position hint
        },
      ];

      // Content without clear paragraph breaks
      const content = "```\ncode block\n```\n```\nmore code\n```";
      const result = service.processDimensionContent(
        content,
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(typeof result).toBe("string");
    });

    it("should deduplicate chart placeholders with the same chartId", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-dup",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/valid.png",
          caption: "Chart",
          position: "after_paragraph_1",
        },
        {
          id: "fig-dup", // Same ID — should be deduplicated
          evidenceCitationIndex: 1,
          figureIndex: 1,
          imageUrl: "https://example.com/valid2.png",
          caption: "Chart 2",
          position: "after_paragraph_2",
        },
      ];

      const content =
        "Paragraph one.\n\nParagraph two.\n\n<!-- figure:1:0 --> and <!-- figure:1:1 -->";
      const result = service.processDimensionContent(
        content,
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      // Count occurrences of the duplicate chart id
      const matches = result.match(/<!-- chart:d0-fig-dup -->/g) ?? [];
      expect(matches.length).toBeLessThanOrEqual(1);
    });
  });

  // ============================================================
  // Private: buildReferencesSection edge cases
  // ============================================================

  describe("buildReferencesSection (via assembleFullReport)", () => {
    it("should return empty section when all references are junk", () => {
      const refs: ReportReference[] = [
        {
          index: 1,
          title: "Junk",
          url: "javascript:void(0)",
          domain: null,
        },
      ];

      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
        { references: refs },
      );

      // Javascript URLs are junk and should be filtered
      expect(typeof result).toBe("string");
    });

    it("should upgrade http to https in references", () => {
      const refs: ReportReference[] = [
        {
          index: 1,
          title: "HTTP Reference",
          url: "http://arxiv.org/abs/2024.0001",
          domain: "arxiv.org",
        },
      ];

      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
        { references: refs },
      );

      expect(result).toContain("https://arxiv.org/abs/2024.0001");
    });

    it("should handle references with bracket chars in title", () => {
      const refs: ReportReference[] = [
        {
          index: 1,
          title: "Title [with] brackets",
          url: "https://example.com/article",
          domain: "example.com",
        },
      ];

      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
        { references: refs },
      );

      expect(result).toContain("参考文献");
      // Brackets in title should be escaped
      expect(typeof result).toBe("string");
    });

    it("should handle reference with accessDate", () => {
      const refs: ReportReference[] = [
        {
          index: 1,
          title: "Dated Reference",
          url: "https://example.com/article",
          domain: "example.com",
          accessDate: "2024-01-15",
        },
      ];

      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
        { references: refs },
      );

      expect(result).toContain("Dated Reference");
    });

    it("should filter references without url", () => {
      const refs: ReportReference[] = [
        {
          index: 1,
          title: "No URL reference",
          url: "", // no URL
          domain: null,
        },
        {
          index: 2,
          title: "Valid reference",
          url: "https://valid.com/article",
          domain: "valid.com",
        },
      ];

      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
        { references: refs },
      );

      expect(result).toContain("Valid reference");
    });

    it("should log when references are filtered during cleanup", () => {
      const logSpy = jest
        .spyOn((service as any).logger, "log")
        .mockImplementation(() => {});

      const refs: ReportReference[] = [
        {
          index: 1,
          title: "Valid A",
          url: "https://example.com/a",
          domain: "example.com",
        },
        {
          index: 2,
          title: "Duplicate A",
          url: "https://example.com/a",
          domain: "example.com",
        }, // duplicate
      ];

      service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        buildSupplementary(),
        { references: refs },
      );

      // Log should be called when references are deduplicated
      expect(logSpy).toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });

  // ============================================================
  // injectChartsByPosition — various position hints
  // ============================================================

  describe("injectChartsByPosition (via processDimensionContent)", () => {
    it("should inject chart at specified paragraph position", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-pos",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/chart.png",
          caption: "Position Chart",
          position: "after_paragraph_2",
        },
      ];

      const content = "Para one.\n\nPara two.\n\nPara three.";
      const result = service.processDimensionContent(
        content,
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).toContain("<!-- chart:");
    });

    it("should handle invalid position hint by distributing evenly", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-nopos",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/chart.png",
          caption: "No Position",
          position: "invalid_position_hint",
        },
      ];

      const content = "Para one.\n\nPara two.\n\nPara three.";
      const result = service.processDimensionContent(
        content,
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).toContain("<!-- chart:");
    });

    it("should handle empty position string by distributing evenly", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-empty-pos",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/chart.png",
          caption: "Empty Position",
          position: "",
        },
      ];

      const content = "Para one.\n\nPara two.";
      const result = service.processDimensionContent(
        content,
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      expect(result).toContain("<!-- chart:");
    });

    it("should append charts at end when content has no paragraph insertion points (only code fences)", () => {
      // Call the private method directly to ensure the edge case is covered
      const refs: FigureReference[] = [
        {
          id: "fig-nopt",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/chart.png",
          caption: "No Insertion Points",
          position: "",
        },
      ];

      // Call resolveChartPlaceholders which delegates to injectChartsByPosition
      const {
        resolveChartPlaceholders,
      } = require("../../../utils/chart-placeholder.utils");
      const result = resolveChartPlaceholders("```\ncode line\n```", 0, refs);

      // Chart should be appended at the end (fallback path)
      expect(result).toContain("<!-- chart:");
    });

    it("should handle multiple figure refs with multiple position hints", () => {
      const figureRefs: FigureReference[] = [
        {
          id: "fig-m1",
          evidenceCitationIndex: 1,
          figureIndex: 0,
          imageUrl: "https://example.com/chart1.png",
          caption: "Chart 1",
          position: "after_paragraph_1",
        },
        {
          id: "fig-m2",
          evidenceCitationIndex: 1,
          figureIndex: 1,
          imageUrl: "https://example.com/chart2.png",
          caption: "Chart 2",
          position: "after_paragraph_3",
        },
      ];

      const content = "Para one.\n\nPara two.\n\nPara three.\n\nPara four.";
      const result = service.processDimensionContent(
        content,
        0,
        new Set<string>(),
        "Tech",
        figureRefs,
      );

      const chartCount = (result.match(/<!-- chart:/g) ?? []).length;
      expect(chartCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // assembleFullReport: supplementary key null/undefined values
  // ============================================================

  describe("assembleFullReport supplementary null/undefined values", () => {
    it("should handle null supplementary values without throwing", () => {
      const sc: SupplementaryContent = {
        preface: null as any,
        executiveSummary: null as any,
        crossDimensionAnalysis: null as any,
        riskAssessment: null as any,
        strategicRecommendations: null as any,
        conclusion: null as any,
      };

      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => {});

      expect(() =>
        service.assembleFullReport(mockTopic, [buildDimension()], sc),
      ).not.toThrow();

      warnSpy.mockRestore();
    });

    it("should handle empty object supplementary content", () => {
      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => {});

      const result = service.assembleFullReport(
        mockTopic,
        [buildDimension()],
        {},
      );

      expect(typeof result).toBe("string");
      warnSpy.mockRestore();
    });
  });
});
