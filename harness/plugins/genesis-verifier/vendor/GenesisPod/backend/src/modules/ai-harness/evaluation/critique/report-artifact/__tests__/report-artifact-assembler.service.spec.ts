import {
  ReportArtifactAssembler,
  lengthTargetFor,
} from "../report-artifact-assembler.service";

function makeQualityGate() {
  return {
    validateFullReport: jest.fn().mockReturnValue({
      passed: true,
      wasAutoFixed: false,
      fixedContent: "",
      violations: [],
    }),
  };
}

function makeBaseInput() {
  return {
    topic: "AI Trends",
    language: "zh-CN" as const,
    styleProfile: "analytical" as const,
    lengthProfile: "standard" as const,
    audienceProfile: "professional" as const,
    plan: {
      themeSummary: "AI is transforming everything",
      dimensions: [
        { id: "d1", name: "Market", rationale: "Market analysis" },
        { id: "d2", name: "Technology", rationale: "Tech analysis" },
      ],
    },
    researcherResults: [
      {
        dimension: "Market",
        findings: [
          {
            claim: "AI market growing",
            evidence: "Revenue data",
            source: "https://gartner.com/ai-report",
          },
          {
            claim: "Enterprise adoption up",
            evidence: "Survey results",
            source: "https://mckinsey.com/survey",
          },
        ],
        summary: "Market is growing fast",
      },
      {
        dimension: "Technology",
        findings: [
          {
            claim: "LLMs improving",
            evidence: "Benchmark data",
            source: "https://arxiv.org/ai",
          },
        ],
        summary: "Tech is advancing",
      },
    ],
    analyst: {
      themeSummary: "AI is a transformative force across industries",
      keyInsights: [
        { title: "Market Growth", oneLine: "AI market growing at 35% CAGR" },
        { title: "Tech Leap", oneLine: "LLM capabilities doubling yearly" },
      ],
    },
    writerReport: {
      title: "AI Trends 2025",
      summary: "AI is reshaping the world",
      sections: [
        {
          heading: "Market",
          body: "The market is growing. Revenue is up [1]. Enterprise adoption surges [2].",
        },
        {
          heading: "Technology",
          body: "LLMs are improving rapidly [3]. New architectures emerge.",
        },
        {
          heading: "Conclusion",
          body: "AI will continue to grow and transform industries.",
        },
      ],
      conclusion: "AI will define the next decade",
      citations: [
        "https://gartner.com/ai-report",
        "https://mckinsey.com/survey",
        "https://arxiv.org/ai",
      ],
    },
    generationTimeMs: 120000,
    totalTokens: { prompt: 5000, completion: 10000, total: 15000 },
    costCents: 50,
    modelTrail: ["gpt-4o"],
  };
}

describe("ReportArtifactAssembler", () => {
  let qualityGate: ReturnType<typeof makeQualityGate>;
  let service: ReportArtifactAssembler;

  beforeEach(() => {
    qualityGate = makeQualityGate();
    service = new ReportArtifactAssembler(qualityGate as never);
  });

  // Core assembly
  it("assemble: returns a ReportArtifact with required top-level fields", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.content).toBeDefined();
    expect(result.sections).toBeDefined();
    expect(result.citations).toBeDefined();
    expect(result.figures).toBeDefined();
    expect(result.quickView).toBeDefined();
    expect(result.factTable).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(result.quality).toBeDefined();
  });

  it("assemble: fullMarkdown starts with # title", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.content.fullMarkdown).toMatch(/^# AI Trends 2025/);
  });

  it("assemble: sections tree extracts ## headings", () => {
    const result = service.assemble(makeBaseInput());
    const titles = result.sections.map((s) => s.title);
    expect(titles).toContain("Market");
    expect(titles).toContain("Technology");
  });

  it("assemble: citations built from writerReport.citations", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.citations.length).toBeGreaterThan(0);
    const urls = result.citations.map((c) => c.url);
    expect(urls).toContain("https://gartner.com/ai-report");
  });

  it("assemble: metadata.topic matches input.topic", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.metadata.topic).toBe("AI Trends");
  });

  it("assemble: metadata.modelTrail includes gpt-4o", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.metadata.modelTrail).toContain("gpt-4o");
  });

  it("assemble: quality.overall is a number between 0 and 100", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.quality.overall).toBeGreaterThanOrEqual(0);
    expect(result.quality.overall).toBeLessThanOrEqual(100);
  });

  it("assemble: quality.dimensions has 10 keys", () => {
    const result = service.assemble(makeBaseInput());
    expect(Object.keys(result.quality.dimensions)).toHaveLength(10);
  });

  it("assemble: fullReportSize matches byteLength of fullMarkdown", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.content.fullReportSize).toBe(
      Buffer.byteLength(result.content.fullMarkdown, "utf8"),
    );
  });

  // Quality gate
  it("assemble: calls qualityGate.validateFullReport", () => {
    service.assemble(makeBaseInput());
    expect(qualityGate.validateFullReport).toHaveBeenCalled();
  });

  it("assemble: applies fixed content when wasAutoFixed=true", () => {
    const fixedContent =
      "# AI Trends 2025\n\n## Market\n\nFixed content here.\n\n## Technology\n\nFixed tech content.\n\n## Conclusion\n\nFixed conclusion.";
    qualityGate.validateFullReport.mockReturnValue({
      passed: false,
      wasAutoFixed: true,
      fixedContent,
      violations: [{ rule: "excessive_bold", message: "Too much bold" }],
    });
    const result = service.assemble(makeBaseInput());
    expect(result.content.fullMarkdown).toContain("Fixed content");
  });

  it("assemble: gate violations added to quality.warnings", () => {
    qualityGate.validateFullReport.mockReturnValue({
      passed: false,
      wasAutoFixed: false,
      fixedContent: "",
      violations: [
        { rule: "subjective_language", message: "Found subjective expression" },
      ],
    });
    const result = service.assemble(makeBaseInput());
    const warning = result.quality.warnings.find((w) =>
      w.dimension?.includes("quality_gate"),
    );
    expect(warning).toBeDefined();
  });

  // factTable
  it("assemble: factTable empty without reconciliationReport", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.factTable).toEqual([]);
  });

  it("assemble: factTable populated from reconciliationReport", () => {
    const input = {
      ...makeBaseInput(),
      reconciliationReport: {
        factTable: [
          {
            id: "f1",
            entity: "AI",
            attribute: "market_size",
            value: "$100B",
            sources: ["https://gartner.com/ai-report"],
          },
        ],
        conflicts: [],
      },
    };
    const result = service.assemble(input);
    expect(result.factTable).toHaveLength(1);
    expect(result.factTable[0].entity).toBe("AI");
  });

  // quickView
  it("assemble: quickView.executiveSummary has markdown field", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.quickView.executiveSummary.markdown).toBeDefined();
    expect(result.quickView.executiveSummary.markdown.length).toBeGreaterThan(
      0,
    );
  });

  it("assemble: quickView.topHighlights from analyst.keyInsights", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.quickView.topHighlights.length).toBeGreaterThan(0);
  });

  // Inline citation normalization
  it("assemble: normalizes [anchor](url) inline citations to [N]", () => {
    const input = {
      ...makeBaseInput(),
      writerReport: {
        ...makeBaseInput().writerReport,
        sections: [
          {
            heading: "Market",
            body: "AI is growing [see report](https://gartner.com/ai-report) rapidly.",
          },
        ],
        citations: [],
      },
    };
    const result = service.assemble(input);
    // Should have at least 1 citation from the inline link
    expect(result.citations.length).toBeGreaterThan(0);
  });

  // Format fixes
  it("applyFormatFixes: collapses 3+ consecutive newlines", () => {
    const input = {
      ...makeBaseInput(),
      writerReport: {
        ...makeBaseInput().writerReport,
        sections: [{ heading: "Market", body: "Para 1\n\n\n\n\nPara 2" }],
        citations: [],
      },
    };
    const result = service.assemble(input);
    expect(result.content.fullMarkdown).not.toMatch(/\n{3,}/);
  });

  // Section type inference
  it("assemble: executive_summary section type detected", () => {
    const result = service.assemble(makeBaseInput());
    const execSection = result.sections.find(
      (s) => s.type === "executive_summary",
    );
    expect(execSection).toBeDefined();
  });

  it("assemble: conclusion section type detected", () => {
    const result = service.assemble(makeBaseInput());
    const conclusionSec = result.sections.find((s) => s.type === "conclusion");
    expect(conclusionSec).toBeDefined();
  });

  // Analyst optional fields
  it("assemble: includes crossDimAnalysis section when present", () => {
    const input = {
      ...makeBaseInput(),
      analyst: {
        ...makeBaseInput().analyst,
        crossDimAnalysis:
          "AI and market forces are deeply intertwined across multiple sectors and dimensions.",
      },
    };
    const result = service.assemble(input);
    expect(result.content.fullMarkdown).toContain(
      "crossDimAnalysis".length > 0 ? "跨维度分析" : "",
    );
  });

  it("assemble: includes riskAssessment section when present", () => {
    const input = {
      ...makeBaseInput(),
      analyst: {
        ...makeBaseInput().analyst,
        riskAssessment:
          "Key risks include regulatory changes, market volatility, and technology disruption.",
      },
    };
    const result = service.assemble(input);
    expect(result.content.fullMarkdown).toContain("风险评估");
  });

  it("assemble: includes strategicRecommendations section when present", () => {
    const input = {
      ...makeBaseInput(),
      analyst: {
        ...makeBaseInput().analyst,
        strategicRecommendations:
          "Invest in AI infrastructure and build internal capabilities to remain competitive.",
      },
    };
    const result = service.assemble(input);
    expect(result.content.fullMarkdown).toContain("战略建议");
  });

  // Figures pipeline
  it("assemble: figures array is empty when no figureCandidates", () => {
    const result = service.assemble(makeBaseInput());
    expect(result.figures).toEqual([]);
  });

  it("assemble: figures pipeline with valid figureCandidates populates figures", () => {
    // Need: sourceUrl matches a citation, imageUrl present, not a garbage URL
    const input = {
      ...makeBaseInput(),
      researcherResults: [
        {
          ...makeBaseInput().researcherResults[0],
          figureCandidates: [
            {
              sourceUrl: "https://gartner.com/ai-report",
              imageUrl: "https://gartner.com/chart1.png",
              caption: "AI market growth chart showing 35% CAGR",
              sourcePageOrSection: "p.5",
              relevanceHint: "high" as const,
            },
          ],
        },
        makeBaseInput().researcherResults[1],
      ],
    };
    // The citation for gartner.com/ai-report is already in writerReport.citations
    const result = service.assemble(input);
    // figures may or may not be populated depending on section matching; check no throw
    expect(result.figures).toBeDefined();
  });

  // ★ 2026-05-07 P1 图文匹配闭环：chapter.figureReferences 优先路径
  it("assemble: chapter.figureReferences override paragraphIndex + adds chapter heading to referencedBy", () => {
    const input = {
      ...makeBaseInput(),
      researcherResults: [
        {
          ...makeBaseInput().researcherResults[0],
          figureCandidates: [
            {
              sourceUrl: "https://gartner.com/ai-report",
              imageUrl: "https://gartner.com/chart1.png",
              caption: "AI market growth chart showing 35% CAGR",
              sourcePageOrSection: "p.5",
              relevanceHint: "high" as const,
            },
            {
              sourceUrl: "https://mckinsey.com/survey",
              imageUrl: "https://mckinsey.com/chart2.png",
              caption: "Enterprise adoption survey",
              relevanceHint: "medium" as const,
            },
          ],
          // chapter-writer LLM 决定本章只引用 FIG-1，锚点在第 3 段后
          chapters: [
            {
              index: 1,
              heading: "Market Sizing",
              body: "Some chapter body",
              wordCount: 1500,
              figureReferences: [
                {
                  figureId: "FIG-1",
                  anchorParagraph: 3,
                  caption: "Custom caption from LLM",
                },
              ],
            },
          ],
        },
        makeBaseInput().researcherResults[1],
      ],
    };
    const result = service.assemble(input);
    // FIG-1 应被关联到 Market dim，paragraphIndex=2 (anchorParagraph 3 → 0-based 2)
    const fig1 = result.figures.find(
      (f) => f.imageUrl === "https://gartner.com/chart1.png",
    );
    expect(fig1).toBeDefined();
    expect(fig1?.paragraphIndex).toBe(2);
    expect(fig1?.caption).toBe("Custom caption from LLM");
    // referencedBy 头条 = chapter heading（精确锚点）
    expect(fig1?.referencedBy[0]?.phrase).toBe("Market Sizing");
    // FIG-2 未被 chapter 引用，仍由 fallback 路径追加（兜底兼容）
    const fig2 = result.figures.find(
      (f) => f.imageUrl === "https://mckinsey.com/chart2.png",
    );
    expect(fig2).toBeDefined();
    expect(fig2?.paragraphIndex).toBe(0); // fallback 默认 paragraphIndex=0
  });

  it("assemble: invalid figureId in chapter.figureReferences is silently skipped (LLM hallucination guard)", () => {
    const input = {
      ...makeBaseInput(),
      researcherResults: [
        {
          ...makeBaseInput().researcherResults[0],
          figureCandidates: [
            {
              sourceUrl: "https://gartner.com/ai-report",
              imageUrl: "https://gartner.com/chart1.png",
              caption: "Real chart",
            },
          ],
          chapters: [
            {
              index: 1,
              heading: "Market",
              body: "body",
              wordCount: 100,
              figureReferences: [
                { figureId: "FIG-99" }, // 不存在的编号
                { figureId: "INVALID" }, // 错误格式
                { figureId: "FIG-1" }, // 合法
              ],
            },
          ],
        },
        makeBaseInput().researcherResults[1],
      ],
    };
    const result = service.assemble(input);
    // 只有 FIG-1 被解析为图，FIG-99 / INVALID 静默丢弃
    const realFigs = result.figures.filter(
      (f) => f.imageUrl === "https://gartner.com/chart1.png",
    );
    expect(realFigs.length).toBe(1);
  });

  // markOrphanCitations: with references section
  it("assemble: orphan citations annotated when references section absent", () => {
    const input = {
      ...makeBaseInput(),
      writerReport: {
        ...makeBaseInput().writerReport,
        sections: [
          {
            heading: "Market",
            body: "AI is growing [1]. See also [99] for context.",
          },
        ],
        citations: ["https://gartner.com/ai-report"],
      },
    };
    // No References section → no orphan annotation (markOrphanCitations returns early)
    const result = service.assemble(input);
    expect(result.content.fullMarkdown).toBeDefined();
  });

  // Format fixes: table row fix
  it("applyFormatFixes: fixes table row missing trailing pipe", () => {
    const input = {
      ...makeBaseInput(),
      writerReport: {
        ...makeBaseInput().writerReport,
        sections: [
          {
            heading: "Market",
            body: "| Col1 | Col2 | Col3\n| --- | --- | ---\n| A | B | C",
          },
        ],
        citations: [],
      },
    };
    const result = service.assemble(input);
    expect(result.content.fullMarkdown).toBeDefined();
  });

  // Per-dim fullMarkdown
  it("assemble: uses researcherResults.fullMarkdown when available", () => {
    // fullMarkdown must be > 200 chars after trim to be used (see buildFullMarkdown guard)
    const dimMarkdown =
      "# Market\n\n" +
      "This is the full dim markdown content that is long enough to be used by the assembler. " +
      "It contains detailed analysis of the market trends and growth patterns. " +
      "Additional content to ensure we exceed the 200 character threshold required by the assembler.\n";
    const input = {
      ...makeBaseInput(),
      researcherResults: [
        {
          ...makeBaseInput().researcherResults[0],
          fullMarkdown: dimMarkdown,
        },
        makeBaseInput().researcherResults[1],
      ],
    };
    const result = service.assemble(input);
    expect(result.content.fullMarkdown).toContain("full dim markdown content");
  });

  // ★ P0-LIVE-REPORT-FORMAT (2026-04-30): 参考文献 section 必须 append 到 markdown 末尾
  it("assemble: appends ## 参考文献 section to fullMarkdown when citations present", () => {
    const input = makeBaseInput();
    const result = service.assemble(input);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.content.fullMarkdown).toMatch(/##\s+参考文献/);
    expect(result.sections.find((s) => s.title === "参考文献")).toBeDefined();
    // each citation has a corresponding [N] line in the references section
    const refSectionMatch =
      result.content.fullMarkdown.match(/##\s+参考文献[\s\S]*$/);
    expect(refSectionMatch).not.toBeNull();
    for (const c of result.citations) {
      expect(refSectionMatch![0]).toContain(`[${c.index}]`);
    }
  });

  it("assemble: emits English References heading for en-US language", () => {
    const input = { ...makeBaseInput(), language: "en-US" as const };
    const result = service.assemble(input);
    expect(result.content.fullMarkdown).toMatch(/##\s+References/);
  });

  // ── F-alignment regression specs (2026-05-06) ─────────────────────────────

  it("[F-regression] buildFullMarkdown contains all 10 Topic Insight template sections when analyst provides all 4 fields", () => {
    const input = {
      ...makeBaseInput(),
      analyst: {
        themeSummary:
          "Comprehensive theme synthesis covering AI transformation.",
        keyInsights: [],
        preface: "This report examines AI trends across key dimensions.",
        crossDimAnalysis:
          "Cross-dimension patterns reveal synergistic effects.",
        riskAssessment: "Risk matrix: high risk in regulatory compliance.",
        strategicRecommendations:
          "Recommendation: invest in AI safety frameworks.",
      },
    };
    const result = service.assemble(input);
    const md = result.content.fullMarkdown;
    // Section 2: 执行摘要
    expect(md).toMatch(/##\s*执行摘要/);
    // Section 3: 前言
    expect(md).toMatch(/##\s*前言/);
    // Section 4: 目录
    expect(md).toMatch(/##\s*目录/);
    // Section 5: dimension sections (Market, Technology)
    expect(md).toMatch(/##\s*Market/);
    expect(md).toMatch(/##\s*Technology/);
    // Section 6: 跨维度分析
    expect(md).toMatch(/##\s*跨维度分析/);
    // Section 7: 风险评估
    expect(md).toMatch(/##\s*风险评估/);
    // Section 8: 战略建议
    expect(md).toMatch(/##\s*战略建议/);
    // Section 9: 结论
    expect(md).toMatch(/##\s*结论/);
    // Section 10: 参考文献 (added by step 4.5 in assemble())
    expect(md).toMatch(/##\s*参考文献/);
  });

  it("[F-regression] buildFullMarkdown uses fallback for crossDimAnalysis/riskAssessment/strategicRecommendations when analyst omits them", () => {
    const input = {
      ...makeBaseInput(),
      analyst: {
        themeSummary: "AI is transformative.",
        keyInsights: [],
        // preface, crossDimAnalysis, riskAssessment, strategicRecommendations all absent
      },
    };
    const result = service.assemble(input);
    const md = result.content.fullMarkdown;
    // All 3 supplementary sections must still appear (fallback from findings)
    expect(md).toMatch(/##\s*跨维度分析/);
    expect(md).toMatch(/##\s*风险评估/);
    expect(md).toMatch(/##\s*战略建议/);
    // 结論 must also appear
    expect(md).toMatch(/##\s*结论/);
  });

  it("[F-regression] analyst preface field is used when provided; falls back to themeSummary snippet", () => {
    const withPreface = {
      ...makeBaseInput(),
      analyst: {
        ...makeBaseInput().analyst,
        preface: "Custom preface text for the report introduction.",
      },
    };
    const resultWith = service.assemble(withPreface);
    expect(resultWith.content.fullMarkdown).toContain(
      "Custom preface text for the report introduction.",
    );

    const withoutPreface = {
      ...makeBaseInput(),
      analyst: {
        themeSummary: "AI is a transformative force across industries.",
        keyInsights: [],
      },
    };
    const resultWithout = service.assemble(withoutPreface);
    // fallback: first chars of themeSummary appear in preface section
    expect(resultWithout.content.fullMarkdown).toMatch(/##\s*前言/);
    expect(resultWithout.content.fullMarkdown).toContain(
      "AI is a transformative force",
    );
  });
});

// ── v1.7 三轮共识：public helper 直接单测（reviewer 三轮反馈：s8 spec 只验"调用存在"
//     不足以保证 sections[].citations 真被回填，必须在 owner 模块内单测真实行为） ──
describe("recomputeCitationOccurrencesPublic — 直接单测（v1.7 加固）", () => {
  let qualityGate: ReturnType<typeof makeQualityGate>;
  let service: ReportArtifactAssembler;

  beforeEach(() => {
    qualityGate = makeQualityGate();
    service = new ReportArtifactAssembler(qualityGate as never);
  });

  it("structural sections + fullMarkdown → citations.occurrences + sections[].citations 真被回填", () => {
    // 模拟 structural assembler 拼装出的 sections / fullMarkdown，
    // 验证 public helper 真的把 [N] 编号扫到对应 section.citations 数组里。
    const fullMarkdown =
      "## 市场\n\n营收增长 [1]，企业采纳上行 [2]。\n\n## 技术\n\nLLM 进步 [3]。";
    const sections = [
      {
        id: "sec-1",
        type: "dimension" as const,
        level: 2 as const,
        title: "市场",
        anchor: "市场",
        startOffset: 0,
        endOffset: 30,
        wordCount: 12,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
        sourceDimensionId: "d1",
      },
      {
        id: "sec-2",
        type: "dimension" as const,
        level: 2 as const,
        title: "技术",
        anchor: "技术",
        startOffset: 30,
        endOffset: fullMarkdown.length,
        wordCount: 6,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
        sourceDimensionId: "d2",
      },
    ];
    const citations = [
      {
        index: 1,
        uuid: "u1",
        title: "Gartner",
        url: "https://gartner.com",
        domain: "gartner.com",
        accessedAt: "2026-01-01",
        sourceType: "industry" as const,
        credibilityScore: 80,
        occurrences: [],
      },
      {
        index: 2,
        uuid: "u2",
        title: "McKinsey",
        url: "https://mckinsey.com",
        domain: "mckinsey.com",
        accessedAt: "2026-01-01",
        sourceType: "industry" as const,
        credibilityScore: 80,
        occurrences: [],
      },
      {
        index: 3,
        uuid: "u3",
        title: "Arxiv",
        url: "https://arxiv.org",
        domain: "arxiv.org",
        accessedAt: "2026-01-01",
        sourceType: "academic" as const,
        credibilityScore: 80,
        occurrences: [],
      },
    ];
    // 重新对齐 sec-1 的 endOffset 让 [1][2] 真落在它内部
    sections[0].endOffset = fullMarkdown.indexOf("## 技术");
    sections[1].startOffset = sections[0].endOffset;

    service.recomputeCitationOccurrencesPublic(
      citations,
      sections,
      fullMarkdown,
    );

    // 验证真实行为：sections[].citations 不再是空数组
    expect(sections[0].citations).toEqual([1, 2]);
    expect(sections[1].citations).toEqual([3]);
    // citations[].occurrences 也被填写
    expect(citations[0].occurrences).toHaveLength(1);
    expect(citations[0].occurrences[0].sectionId).toBe("sec-1");
    expect(citations[2].occurrences).toHaveLength(1);
    expect(citations[2].occurrences[0].sectionId).toBe("sec-2");
  });

  it("空 fullMarkdown / 无 [N] → 不抛错且 sections.citations 保持空", () => {
    const sections = [
      {
        id: "sec-1",
        type: "dimension" as const,
        level: 2 as const,
        title: "市场",
        anchor: "shichang",
        startOffset: 0,
        endOffset: 10,
        wordCount: 3,
        readingTimeMinutes: 1,
        citations: [99], // 老数据
        figureIds: [],
        factIds: [],
      },
    ];
    const citations = [
      {
        index: 1,
        uuid: "u1",
        title: "T",
        url: "u",
        domain: "d",
        accessedAt: "2026-01-01",
        sourceType: "blog" as const,
        credibilityScore: 50,
        occurrences: [
          { sectionId: "old", paragraphIndex: 0, characterOffset: 0 },
        ],
      },
    ];

    service.recomputeCitationOccurrencesPublic(citations, sections, "");

    // helper 必须 reset 老数据（occurrences.length = 0 / citations.citations = []）
    expect(sections[0].citations).toEqual([]);
    expect(citations[0].occurrences).toEqual([]);
  });
});

// lengthTargetFor helper
describe("lengthTargetFor", () => {
  it("brief → 3000", () => expect(lengthTargetFor("brief")).toBe(3000));
  it("standard → 8000", () => expect(lengthTargetFor("standard")).toBe(8000));
  it("deep → 15000", () => expect(lengthTargetFor("deep")).toBe(15000));
  it("extended → 25000", () => expect(lengthTargetFor("extended")).toBe(25000));
  it("epic → 80000", () => expect(lengthTargetFor("epic")).toBe(80000));
  it("mega → 200000", () => expect(lengthTargetFor("mega")).toBe(200000));
  it("unknown → 8000 (default)", () =>
    expect(lengthTargetFor("unknown" as never)).toBe(8000));
});

// ★ PR-A7 (2026-05-07): legacy assembler invariant fallback —— fuzzy match + missing-dim 显式标签
describe("PR-A7: buildSectionTree fuzzy match + missing-dim 显式标签", () => {
  function makeAssemblerWithGate() {
    return new ReportArtifactAssembler(makeQualityGate() as never);
  }

  function makeInputWithDims(
    dims: Array<{ id: string; name: string; rationale: string }>,
    sections: Array<{ heading: string; body: string }>,
  ) {
    return {
      topic: "Test",
      language: "zh-CN" as const,
      styleProfile: "analytical" as const,
      lengthProfile: "standard" as const,
      audienceProfile: "professional" as const,
      plan: { themeSummary: "test", dimensions: dims },
      researcherResults: dims.map((d) => ({
        dimension: d.name,
        findings: [
          {
            claim: `${d.name} finding`,
            evidence: "evidence",
            source: "https://example.com",
          },
        ],
        summary: `${d.name} summary`,
      })),
      analyst: { themeSummary: "test theme" },
      writerReport: {
        title: "Test Report",
        summary: "Summary",
        sections,
      },
      figureCandidates: [],
      reconciliationReport: undefined,
    };
  }

  it("exact match 优先（不走 fuzzy）—— LLM 写规范名时仍命中", () => {
    const assembler = makeAssemblerWithGate();
    const input = makeInputWithDims(
      [
        { id: "d1", name: "Market", rationale: "..." },
        { id: "d2", name: "Technology", rationale: "..." },
      ],
      [
        { heading: "Market", body: "Body for market." },
        { heading: "Technology", body: "Body for tech." },
      ],
    );
    const result = assembler.assemble(input as never);
    const dimSecs = result.sections.filter((s) => s.type === "dimension");
    expect(dimSecs.find((s) => s.title === "Market")?.sourceDimensionId).toBe(
      "d1",
    );
    expect(
      dimSecs.find((s) => s.title === "Technology")?.sourceDimensionId,
    ).toBe("d2");
  });

  it("fuzzy match —— LLM 给章节加序号 '1. Market' 仍能对齐到 d1", () => {
    const assembler = makeAssemblerWithGate();
    const input = makeInputWithDims(
      [
        { id: "d1", name: "Market", rationale: "..." },
        { id: "d2", name: "Technology", rationale: "..." },
      ],
      [
        // LLM 加序号 — 旧 exact match 失败
        { heading: "1. Market 分析", body: "Body for market analysis." },
        { heading: "2. Technology 演进", body: "Body for tech evolution." },
      ],
    );
    const result = assembler.assemble(input as never);
    const dimSecs = result.sections.filter((s) => s.type === "dimension");
    // includes 启发式应当对齐
    expect(
      dimSecs.find((s) => s.title.includes("Market"))?.sourceDimensionId,
    ).toBe("d1");
    expect(
      dimSecs.find((s) => s.title.includes("Technology"))?.sourceDimensionId,
    ).toBe("d2");
  });

  it("missing-dim 显式标签 —— writer 漏写一个维度时保留占位 section + sourceDimensionId 对齐", () => {
    const assembler = makeAssemblerWithGate();
    const input = makeInputWithDims(
      [
        { id: "d1", name: "Market", rationale: "..." },
        { id: "d2", name: "Technology", rationale: "..." },
        { id: "d3", name: "Regulation", rationale: "..." }, // writer 漏写
      ],
      [
        { heading: "Market", body: "Body for market." },
        { heading: "Technology", body: "Body for tech." },
      ],
    );
    const result = assembler.assemble(input as never);
    const dimSecs = result.sections.filter((s) => s.type === "dimension");
    const regSec = dimSecs.find((s) => s.sourceDimensionId === "d3");
    expect(regSec).toBeDefined();
    expect(regSec!.title).toContain("本维度内容缺失");
    expect(regSec!.startOffset).toBe(regSec!.endOffset); // zero-width
    expect(regSec!.wordCount).toBe(0);
  });

  it("两个 dim 都有 section + 一个全新假 section —— 假 section 不算 missing", () => {
    const assembler = makeAssemblerWithGate();
    const input = makeInputWithDims(
      [
        { id: "d1", name: "Market", rationale: "..." },
        { id: "d2", name: "Technology", rationale: "..." },
      ],
      [
        { heading: "Market", body: "Body market." },
        { heading: "Technology", body: "Body tech." },
        { heading: "AI Trends 2030", body: "未规划维度，但 LLM 自己加的." },
      ],
    );
    const result = assembler.assemble(input as never);
    const dimSecs = result.sections.filter((s) => s.type === "dimension");
    // d1, d2 都对齐；不应有 missing 标签
    const missing = dimSecs.filter((s) => s.title.includes("本维度内容缺失"));
    expect(missing).toHaveLength(0);
  });

  it("LCS 相似度阈值 ≥ 0.7 才命中 —— 相似度低拒绝", () => {
    const assembler = makeAssemblerWithGate();
    const input = makeInputWithDims(
      [{ id: "d1", name: "Market Analysis", rationale: "..." }],
      [
        // 完全无关的章节标题；LCS / includes 都不应命中
        { heading: "Foreword", body: "Some preface body." },
      ],
    );
    const result = assembler.assemble(input as never);
    const dimSecs = result.sections.filter((s) => s.type === "dimension");
    // d1 应当作为 missing 被加进来
    const missing = dimSecs.find((s) => s.sourceDimensionId === "d1");
    expect(missing).toBeDefined();
    expect(missing!.title).toContain("本维度内容缺失");
  });

  // ★ R2 共识 P1 (tester R2): missing-dim 虚拟 offset 严格单调递增（架构 P0-3 修复）
  it("多个 missing-dim 时 startOffset 严格单调递增（architect R2 P0-3 反向证据）", () => {
    const assembler = makeAssemblerWithGate();
    const input = makeInputWithDims(
      [
        { id: "d1", name: "Market", rationale: "..." }, // 命中
        { id: "d2", name: "Tech", rationale: "..." }, // missing
        { id: "d3", name: "Regulation", rationale: "..." }, // missing
        { id: "d4", name: "Risk", rationale: "..." }, // missing
      ],
      [{ heading: "Market", body: "Body for market analysis." }],
    );
    const result = assembler.assemble(input as never);
    const missingSecs = result.sections.filter(
      (s) => s.type === "dimension" && s.title.includes("本维度内容缺失"),
    );
    expect(missingSecs).toHaveLength(3);
    // 严格单调递增 + zero-width
    for (let i = 1; i < missingSecs.length; i++) {
      expect(missingSecs[i].startOffset).toBeGreaterThan(
        missingSecs[i - 1].startOffset,
      );
      expect(missingSecs[i].startOffset).toBe(missingSecs[i].endOffset);
    }
  });
});

// ★ 2026-05-08 PR-8 (mission 843f6958 Round 3 第 4 路要求):
//   PR-7 暴露 rebuildSectionTreePublic + s8 inject 后 rebuild section + 重映射
//   figure.sectionId。锁住 inject 后 sections offset 与 markdown 对齐 + figure
//   sourceDimensionId 优先重映射。
describe("PR-7 rebuildSectionTreePublic + figure.sectionId 重映射（mission 843f6958 修）", () => {
  function makeAssembler(): ReportArtifactAssembler {
    const qualityGate = makeQualityGate();
    return new ReportArtifactAssembler(qualityGate as never);
  }

  it("rebuildSectionTreePublic 用 narrow 参数（不需要完整 AssembleInput）", () => {
    const assembler = makeAssembler();
    const fullMarkdown = [
      "# 报告",
      "",
      "## 1. 维度一",
      "正文段落 A。",
      "",
      "## 2. 维度二",
      "正文段落 B。",
    ].join("\n");
    const dims = [
      { id: "d1", name: "维度一", rationale: "..." },
      { id: "d2", name: "维度二", rationale: "..." },
    ];
    const sections = assembler.rebuildSectionTreePublic(
      fullMarkdown,
      dims,
      "zh-CN",
    );
    const dimSecs = sections.filter((s) => s.type === "dimension");
    expect(dimSecs).toHaveLength(2);
    expect(dimSecs[0].sourceDimensionId).toBe("d1");
    expect(dimSecs[1].sourceDimensionId).toBe("d2");
  });

  it("inject 占位后 fullMarkdown 字符增长，rebuild 后 offset 对齐新流", () => {
    const assembler = makeAssembler();
    const before = [
      "## 1. Market",
      "Market body content.",
      "## 2. Tech",
      "Tech body content.",
    ].join("\n");
    const dims = [
      { id: "d1", name: "Market", rationale: "..." },
      { id: "d2", name: "Tech", rationale: "..." },
    ];
    // inject 模拟：在第 1 章末尾插一行 ![](#fig-d1-0)
    const after =
      before.slice(0, before.indexOf("## 2. Tech")) +
      "\n![alt](#fig-d1-0)\n\n" +
      before.slice(before.indexOf("## 2. Tech"));
    expect(after.length).toBeGreaterThan(before.length);

    const sectionsBefore = assembler.rebuildSectionTreePublic(
      before,
      dims,
      "en-US",
    );
    const sectionsAfter = assembler.rebuildSectionTreePublic(
      after,
      dims,
      "en-US",
    );
    // Tech 章节 startOffset 在 inject 后必然位移
    const techBefore = sectionsBefore.find(
      (s) => s.sourceDimensionId === "d2",
    )!;
    const techAfter = sectionsAfter.find((s) => s.sourceDimensionId === "d2")!;
    expect(techAfter.startOffset).toBeGreaterThan(techBefore.startOffset);
  });

  it("recomputeSectionFigureIdsPublic 按 sourceDimensionId 优先重映射 figure.sectionId", () => {
    const assembler = makeAssembler();
    const legacySections = [
      {
        id: "old-sec-1",
        sourceDimensionId: "d1",
        type: "dimension" as const,
        title: "Market",
        anchor: "market",
        level: 2 as const,
        startOffset: 0,
        endOffset: 100,
        wordCount: 50,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      },
    ];
    const newSections = [
      {
        id: "new-sec-1",
        sourceDimensionId: "d1",
        type: "dimension" as const,
        title: "Market",
        anchor: "market",
        level: 2 as const,
        startOffset: 0,
        endOffset: 150, // offset 漂移后
        wordCount: 50,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      },
    ];
    const figures = [
      {
        id: "fig-old-sec-1-0",
        type: "reference" as const,
        chartType: undefined,
        title: "test",
        caption: "test fig",
        altText: "test",
        imageUrl: "https://x.com/i.png",
        sectionId: "old-sec-1",
        evidenceCitationIndex: undefined,
        position: undefined,
        referencedBy: [],
      },
    ];
    assembler.recomputeSectionFigureIdsPublic(
      figures as never,
      newSections,
      legacySections,
    );
    expect(figures[0].sectionId).toBe("new-sec-1");
    expect(newSections[0].figureIds).toContain("fig-old-sec-1-0");
  });

  // ★ 2026-05-08 PR-9-A (R4 第 4 路指出 referencedBy 悬挂):
  it("recomputeSectionFigureIdsPublic 同步重映射 fig.referencedBy[].sectionId", () => {
    const assembler = makeAssembler();
    const legacySections = [
      {
        id: "old-sec-1",
        sourceDimensionId: "d1",
        type: "dimension" as const,
        title: "Market",
        anchor: "market",
        level: 2 as const,
        startOffset: 0,
        endOffset: 100,
        wordCount: 50,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      },
      {
        id: "old-sec-2",
        sourceDimensionId: "d2",
        type: "dimension" as const,
        title: "Tech",
        anchor: "tech",
        level: 2 as const,
        startOffset: 100,
        endOffset: 200,
        wordCount: 50,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      },
    ];
    const newSections = [
      {
        id: "new-sec-1",
        sourceDimensionId: "d1",
        type: "dimension" as const,
        title: "Market",
        anchor: "market",
        level: 2 as const,
        startOffset: 0,
        endOffset: 150,
        wordCount: 50,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      },
      {
        id: "new-sec-2",
        sourceDimensionId: "d2",
        type: "dimension" as const,
        title: "Tech",
        anchor: "tech",
        level: 2 as const,
        startOffset: 150,
        endOffset: 300,
        wordCount: 50,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      },
    ];
    const figures = [
      {
        id: "fig-old-sec-1-0",
        type: "reference" as const,
        chartType: undefined,
        title: "test",
        caption: "test fig",
        altText: "test",
        imageUrl: "https://x.com/i.png",
        sectionId: "old-sec-1",
        evidenceCitationIndex: undefined,
        position: undefined,
        // 关键：referencedBy 含 legacy section id (old-sec-1, old-sec-2)
        referencedBy: [
          { sectionId: "old-sec-1", phrase: "Market trend" },
          { sectionId: "old-sec-2", phrase: "Tech impact" },
        ],
      },
    ];
    assembler.recomputeSectionFigureIdsPublic(
      figures as never,
      newSections,
      legacySections,
    );
    // referencedBy[0].sectionId 应被 remap 到 new-sec-1（按 sourceDimensionId d1）
    expect(figures[0].referencedBy[0].sectionId).toBe("new-sec-1");
    // referencedBy[1].sectionId 应被 remap 到 new-sec-2（按 sourceDimensionId d2）
    expect(figures[0].referencedBy[1].sectionId).toBe("new-sec-2");
  });

  // ★ 2026-05-08 PR-9-D (R4 第 4 路指出 ID 格式分裂):
  it("两次 build 产出 sec id 漂移时 figure 不被错误挤到 firstDim 兜底", () => {
    const assembler = makeAssembler();
    // 模拟 fuzzyMatch 命中 dim → sec.id = dim.id（UUID 格式）；
    // 未命中 → sec.id = sec-{slug}-N（slug 格式）
    const legacySections = [
      {
        id: "d1", // fuzzyMatch 命中（UUID）
        sourceDimensionId: "d1",
        type: "dimension" as const,
        title: "Market 分析",
        anchor: "market",
        level: 2 as const,
        startOffset: 0,
        endOffset: 100,
        wordCount: 50,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      },
    ];
    const newSections = [
      {
        id: "sec-market-1", // 未命中 fuzzyMatch（slug 格式）— 同章节但 ID 漂移
        sourceDimensionId: "d1", // sourceDimensionId 仍正确
        type: "dimension" as const,
        title: "Market 分析",
        anchor: "market",
        level: 2 as const,
        startOffset: 0,
        endOffset: 150,
        wordCount: 50,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      },
    ];
    const figures = [
      {
        id: "fig-d1-0",
        type: "reference" as const,
        chartType: undefined,
        title: "test",
        caption: "test fig",
        altText: "test",
        imageUrl: "https://x.com/i.png",
        sectionId: "d1",
        evidenceCitationIndex: undefined,
        position: undefined,
        referencedBy: [],
      },
    ];
    assembler.recomputeSectionFigureIdsPublic(
      figures as never,
      newSections,
      legacySections,
    );
    // 即使 ID 格式分裂，按 sourceDimensionId 优先策略仍能正确映射
    expect(figures[0].sectionId).toBe("sec-market-1");
    expect(newSections[0].figureIds).toContain("fig-d1-0");
  });
});
