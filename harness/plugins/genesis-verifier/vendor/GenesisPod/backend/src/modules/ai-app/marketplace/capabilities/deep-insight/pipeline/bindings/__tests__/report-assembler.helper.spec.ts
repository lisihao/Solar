/**
 * report-assembler.helper —— buildAssembleInput 单测（审计 #28/#29/#31/#32 强验证）。
 *
 * 覆盖报告装配链富数据恢复：
 *   #28 参考文献：researcher findings 的 source/sourceTitle/sourceSnippet 透传进
 *       researcherResults[].findings[]（assembler 据此收集富 citations，非裸域名）。
 *   #29 factTable：S5 reconciler 的 factTable/conflicts 接进 reconciliationReport
 *       （assembler buildFactTable 据此产出事实表，恒空 → 非空）。
 *   #31 metadata：modelTrail 从真实累积桶填充（非硬编码 []）。
 *   #32 元信息：styleProfile/lengthProfile/audienceProfile/searchTimeRange 来自
 *       用户选择（input.invocation 透传），非硬编码 academic/domain-expert/standard。
 */
import { ReportArtifactAssembler } from "@/modules/ai-harness/facade";
import {
  buildAssembleInput,
  type ProfileShape,
  type ResearcherShape,
  type ReconciliationShape,
} from "../report-assembler.helper";

describe("buildAssembleInput 富数据恢复", () => {
  const baseResearcher: ResearcherShape[] = [
    {
      dimension: "市场规模",
      summary: "市场快速增长",
      findings: [
        {
          claim: "2025 年市场规模达 100 亿美元",
          evidence: "据 IDC 报告",
          source: "https://idc.com/report-2025",
          sourceTitle: "IDC 2025 市场报告",
          sourceSnippet: "全球市场规模……",
          sourcePublishedAt: "2025-01-01",
        },
      ],
    },
  ];

  const baseReconciliation: ReconciliationShape = {
    factTable: [
      {
        id: "fact-1",
        entity: "市场",
        attribute: "规模",
        value: "100 亿美元",
        sources: ["https://idc.com/report-2025"],
      },
    ],
    conflicts: [
      {
        factIds: ["fact-1", "fact-2"],
        resolutionType: "preferred-one",
        preferredFactId: "fact-1",
        rationale: "IDC 来源权威度更高，优先采纳",
      },
    ],
  };

  const baseProfile: ProfileShape = {
    topic: "AI 芯片市场",
    language: "zh-CN",
    depth: "standard",
    styleProfile: "executive",
    lengthProfile: "extended",
    audienceProfile: "general-public",
    searchTimeRange: "90d",
  };

  function build(overrides?: {
    profile?: Partial<ProfileShape>;
    researcherResults?: ResearcherShape[];
    reconciliation?: ReconciliationShape | null;
    modelTrail?: string[];
  }) {
    return buildAssembleInput({
      profile: { ...baseProfile, ...overrides?.profile },
      plan: {
        themeSummary: "AI 芯片市场全景",
        dimensions: [{ id: "d1", name: "市场规模", rationale: "核心维度" }],
      },
      researcherResults: overrides?.researcherResults ?? baseResearcher,
      analyst: undefined,
      writerReport: {
        title: "AI 芯片市场报告",
        summary: "摘要",
        sections: [{ heading: "市场规模", body: "正文 [1]" }],
        conclusion: "结论",
      },
      reconciliation:
        overrides?.reconciliation === undefined
          ? baseReconciliation
          : overrides.reconciliation,
      usage: {
        totalTokens: 12345,
        totalCostCents: 50,
        generationTimeMs: 6000,
      },
      modelTrail: overrides?.modelTrail ?? ["gpt-x", "claude-y"],
    });
  }

  it("#28 researcher findings 的 source 元数据透传（assembler 据此产富 citations）", () => {
    const input = build();
    const f = input.researcherResults[0].findings[0];
    expect(f.source).toBe("https://idc.com/report-2025");
    expect(f.sourceTitle).toBe("IDC 2025 市场报告");
    expect(f.sourceSnippet).toBe("全球市场规模……");
    expect(f.sourcePublishedAt).toBe("2025-01-01");
  });

  it("#29 factTable/conflicts 接进 reconciliationReport（非恒空）", () => {
    const input = build();
    expect(input.reconciliationReport).toBeDefined();
    expect(input.reconciliationReport?.factTable.length).toBeGreaterThan(0);
    expect(input.reconciliationReport?.factTable[0]).toMatchObject({
      id: "fact-1",
      entity: "市场",
      attribute: "规模",
      value: "100 亿美元",
    });
    expect(input.reconciliationReport?.conflicts[0]).toMatchObject({
      resolutionType: "preferred-one",
      preferredFactId: "fact-1",
    });
  });

  it("#29 reconciler 跳过/失败（factTable 空或 null）→ reconciliationReport 省略", () => {
    expect(
      build({ reconciliation: null }).reconciliationReport,
    ).toBeUndefined();
    expect(
      build({ reconciliation: { factTable: [], conflicts: [] } })
        .reconciliationReport,
    ).toBeUndefined();
  });

  it("#31 modelTrail 从真实累积填充（非硬编码 []）", () => {
    const input = build({ modelTrail: ["gpt-x", "claude-y"] });
    expect(input.modelTrail).toEqual(["gpt-x", "claude-y"]);
    // 缺省（trail 为空）保持空数组，不造假
    expect(build({ modelTrail: [] }).modelTrail).toEqual([]);
  });

  it("#32 style/length/audience/searchTimeRange 来自用户选择（非硬编码）", () => {
    const input = build();
    expect(input.styleProfile).toBe("executive");
    expect(input.lengthProfile).toBe("extended");
    expect(input.audienceProfile).toBe("general-public");
    expect(input.searchTimeRange).toBe("90d");
  });

  it("#32 非法/缺省档位回退基线默认（不 crash、不漏档）", () => {
    const input = build({
      profile: {
        styleProfile: "not-a-style",
        lengthProfile: undefined,
        audienceProfile: undefined,
        searchTimeRange: undefined,
        depth: "deep",
      },
    });
    expect(input.styleProfile).toBe("academic");
    // lengthProfile 缺省 → depth=deep 映射
    expect(input.lengthProfile).toBe("deep");
    expect(input.audienceProfile).toBe("domain-expert");
    expect(input.searchTimeRange).toBeUndefined();
  });

  it("#31 per-dim fullMarkdown/chapters 存在时透传（对齐基线正文优先路径）", () => {
    const withChapters: ResearcherShape[] = [
      {
        ...baseResearcher[0],
        fullMarkdown: "# 市场规模\n\n" + "正文".repeat(200),
        chapters: [
          {
            index: 0,
            heading: "市场规模",
            body: "章节正文",
            wordCount: 800,
            figureReferences: [{ figureId: "fig-1", anchorParagraph: 1 }],
          },
        ],
      },
    ];
    const input = build({ researcherResults: withChapters });
    expect(input.researcherResults[0].fullMarkdown).toContain("市场规模");
    expect(input.researcherResults[0].chapters?.length).toBe(1);
    expect(
      input.researcherResults[0].chapters?.[0].figureReferences?.[0],
    ).toMatchObject({ figureId: "fig-1" });
  });

  it("能力轨单发 writer（无 fullMarkdown/chapters）→ 字段省略，由 writer.sections 兜底", () => {
    const input = build();
    expect(input.researcherResults[0].fullMarkdown).toBeUndefined();
    expect(input.researcherResults[0].chapters).toBeUndefined();
    expect(input.writerReport.sections.length).toBeGreaterThan(0);
  });

  // ── 端到端强验证：buildAssembleInput → 真实 ReportArtifactAssembler.assemble ──
  //   含 findings/factTable/modelTrail 的 state → artifact.citations 非空、
  //   factTable 非空、metadata.modelTrail 非空、styleProfile 来自 input 而非硬编码。
  it("E2E：富 state → assemble 产出 citations/factTable/modelTrail 全非空 + 档位来自 input", () => {
    const assembler = new ReportArtifactAssembler({
      validateFullReport: jest.fn().mockReturnValue({
        passed: true,
        wasAutoFixed: false,
        fixedContent: "",
        violations: [],
      }),
    } as never);
    const input = build();
    const artifact = assembler.assemble(input as never);

    // #28 citations 非空（来自 researcher findings 的 source 元数据）
    expect(artifact.citations.length).toBeGreaterThan(0);
    expect(artifact.citations.some((c) => c.url.includes("idc.com"))).toBe(
      true,
    );
    // #29 factTable 非空（来自 S5 reconciler 产物）
    expect(artifact.factTable.length).toBeGreaterThan(0);
    expect(artifact.metadata.factCount).toBeGreaterThan(0);
    // #31 metadata.modelTrail 非空（真实累积，非硬编码 []）
    expect(artifact.metadata.modelTrail).toEqual(["gpt-x", "claude-y"]);
    // #32 styleProfile/audienceProfile/searchTimeRange 来自 input（非硬编码）
    expect(artifact.metadata.styleProfile).toBe("executive");
    expect(artifact.metadata.audienceProfile).toBe("general-public");
    expect(artifact.metadata.searchTimeRange).toBe("90d");
  });
});
