/**
 * StructuralReportAssembler spec
 *
 * 上游：docs/architecture/ai-harness/evaluation/report-assembly-invariant-redesign.md v1.4 §6
 *
 * 覆盖：
 *   - §6.1 F-EVIL fixtures（恶意 LLM 输入仍能产出正确 sections）
 *   - §6.2 invariant template-aware（expectedSectionCount 公式）
 *   - §6.4 并发 / partial dim failure / figures 重映射
 *   - templateId 持久化
 */

import {
  defaultStructuralReportAssembler,
  StructuralReportAssembler,
} from "../structural-report-assembler.service";
import {
  MULTI_DIMENSION_REPORT_TEMPLATE,
  SINGLE_AGENT_FREEFORM_TEMPLATE,
  expectedSectionCount,
  type ReportSegments,
} from "../report-segments.dto";
import type {
  ArtifactCitation,
  ArtifactFigure,
  ArtifactFactTriple,
  ArtifactMetadata,
} from "../report-artifact.dto";

const baseMetadata: ArtifactMetadata = {
  topic: "测试主题",
  generatedAt: new Date().toISOString(),
  generationTimeMs: 0,
  version: 1,
  isIncremental: false,
  dimensionCount: 0,
  sourceCount: 0,
  factCount: 0,
  figureCount: 0,
  wordCount: 0,
  readingTimeMinutes: 0,
  styleProfile: "academic",
  lengthProfile: "standard",
  audienceProfile: "domain-expert",
  language: "zh-CN",
  totalTokens: { prompt: 0, completion: 0, total: 0 },
  costCents: 0,
  modelTrail: [],
};

function buildSegments(
  overrides: Partial<ReportSegments> = {},
): ReportSegments {
  const dims = Array.from({ length: 3 }, (_, i) => ({
    id: `d${i + 1}`,
    name: `维度${i + 1}`,
    rationale: "...",
  }));
  return {
    plan: { themeSummary: "测试主题摘要", dimensions: dims },
    bodies: {
      executiveSummary: "执行摘要正文。",
      preface: "前言正文。",
      perDimension: dims.map((d) => ({
        dimensionId: d.id,
        body: `${d.name}的内容`,
      })),
      crossDimAnalysis: "跨维度分析正文。",
      riskAssessment: "风险评估正文。",
      recommendations: "战略建议正文。",
      conclusion: "结论正文。",
    },
    citations: [],
    figures: [],
    factTable: [],
    metadata: baseMetadata,
    qualityInputs: { verifierScores: { judge1: 80 }, warnings: [] },
    ...overrides,
  };
}

function buildSegmentsWithNDims(n: number): ReportSegments {
  const dims = Array.from({ length: n }, (_, i) => ({
    id: `d${i + 1}`,
    name: `维度${i + 1}`,
    rationale: "...",
  }));
  return buildSegments({
    plan: { themeSummary: "...", dimensions: dims },
    bodies: {
      executiveSummary: "exec",
      preface: "preface",
      perDimension: dims.map((d) => ({ dimensionId: d.id, body: "body" })),
      crossDimAnalysis: "cross",
      riskAssessment: "risk",
      recommendations: "rec",
      conclusion: "concl",
    },
  });
}

describe("StructuralReportAssembler", () => {
  describe("invariant (template-aware)", () => {
    it.each([1, 5, 12, 20])(
      "MULTI_DIMENSION sections.length === expectedSectionCount (n=%i)",
      (n) => {
        const segments = buildSegmentsWithNDims(n);
        const r = defaultStructuralReportAssembler.assemble(segments);
        const expected = expectedSectionCount(
          MULTI_DIMENSION_REPORT_TEMPLATE,
          segments,
        );
        expect(r.sections.length).toBe(expected);
      },
    );

    it("SINGLE_AGENT_FREEFORM sections.length === 1", () => {
      const segments = buildSegments({
        template: SINGLE_AGENT_FREEFORM_TEMPLATE,
      });
      const r = defaultStructuralReportAssembler.assemble(segments);
      expect(r.sections.length).toBe(1);
    });

    it("templateId 持久化到 metadata（observability）— v1.5 直接读字段", () => {
      const a = defaultStructuralReportAssembler.assemble(buildSegments());
      const b = defaultStructuralReportAssembler.assemble(
        buildSegments({ template: SINGLE_AGENT_FREEFORM_TEMPLATE }),
      );
      expect(a.metadata.templateId).toBe(MULTI_DIMENSION_REPORT_TEMPLATE.id);
      expect(b.metadata.templateId).toBe(SINGLE_AGENT_FREEFORM_TEMPLATE.id);
    });

    it("sectionCountMismatch 一致时不写字段（v1.5 收尾）", () => {
      const r = defaultStructuralReportAssembler.assemble(
        buildSegmentsWithNDims(5),
      );
      expect(r.metadata.sectionCountMismatch).toBeUndefined();
    });

    it("sectionCountMismatch 不一致时真写 metadata（v1.7：用 sanitizer 净空触发真分歧，不用 jest.spyOn）", () => {
      // v1.6 原版用 jest.spyOn(dto, 'expectedSectionCount') mock — tester 三轮指出
      // 这种对 ES named export 的 spyOn 在不同 transpile target / strict mode 下不稳定。
      // v1.7 改为构造真实分歧：optional 段 body 在 sanitize 前非空（expectedSectionCount 计入），
      // 但 sanitize 后净空（assembler 实际跳过）→ actual === expected - 1，真触发 mismatch 写入。
      const segments = buildSegmentsWithNDims(3);
      // crossDimAnalysis 是 fromBodies 类型 optional slot：
      //   expectedSectionCount 看 raw.trim() → "<thinking>...</thinking>".trim() 真 → 计入
      //   assembler 走 sanitizer，<thinking> 块整段剥离 → body = "" → !body.trim() 真 → 跳过
      segments.bodies.crossDimAnalysis =
        "<thinking>本应有内容但 sanitize 后净空</thinking>";
      const r = defaultStructuralReportAssembler.assemble(segments);
      expect(r.metadata.sectionCountMismatch).toBeDefined();
      expect(r.metadata.sectionCountMismatch?.expected).toBe(
        (r.metadata.sectionCountMismatch?.actual ?? 0) + 1,
      );
      expect(r.metadata.sectionCountMismatch?.actual).toBe(r.sections.length);
    });

    it("dim sections 顺序与 plan.dimensions 一一对齐（template 含 loop slot）", () => {
      const segments = buildSegmentsWithNDims(5);
      const r = defaultStructuralReportAssembler.assemble(segments);
      const dimSecs = r.sections.filter((s) => s.type === "dimension");
      expect(dimSecs.map((s) => s.sourceDimensionId)).toEqual(
        segments.plan.dimensions.map((d) => d.id),
      );
    });

    it("每个 section 的 startOffset/endOffset 切出来必定以 ## 开头", () => {
      const r = defaultStructuralReportAssembler.assemble(buildSegments());
      for (const sec of r.sections) {
        const slice = r.content.fullMarkdown.slice(
          sec.startOffset,
          sec.endOffset,
        );
        expect(slice.startsWith(`## ${sec.title}`)).toBe(true);
      }
    });
  });

  describe("F-EVIL: 恶意 LLM 输入仍能产出正确 sections", () => {
    it("F-EVIL-1 dim body 含孤儿 mermaid fence → sections 数量正确", () => {
      const segments = buildSegments({
        bodies: {
          ...buildSegments().bodies,
          perDimension: [
            {
              dimensionId: "d1",
              body: "```mermaid\ngraph LR\n  A --> B\n  end\n*标题*\n## 偷渡 H2",
            },
            { dimensionId: "d2", body: "正常 body" },
            { dimensionId: "d3", body: "正常 body" },
          ],
        },
      });
      const r = defaultStructuralReportAssembler.assemble(segments);
      // 公式：3 fixed (exec/preface/toc) + 3 dim + 4 optional + 1 references = 11
      expect(r.sections.length).toBe(
        expectedSectionCount(MULTI_DIMENSION_REPORT_TEMPLATE, segments),
      );
    });

    it("F-EVIL-3 dim body 内嵌 5 个 ## 假标题 → sections 数量不变", () => {
      const segments = buildSegments({
        bodies: {
          ...buildSegments().bodies,
          perDimension: [
            {
              dimensionId: "d1",
              body: "## 假 1\n## 假 2\n## 假 3\n## 假 4\n## 假 5",
            },
            { dimensionId: "d2", body: "正常" },
            { dimensionId: "d3", body: "正常" },
          ],
        },
      });
      const r = defaultStructuralReportAssembler.assemble(segments);
      const dimSecs = r.sections.filter((s) => s.type === "dimension");
      expect(dimSecs.length).toBe(3);
    });

    it("F-EVIL-4 dim body=null → 占位文字 + section 仍存在", () => {
      const segments = buildSegments({
        bodies: {
          ...buildSegments().bodies,
          perDimension: [
            { dimensionId: "d1", body: null },
            { dimensionId: "d2", body: "正常" },
            { dimensionId: "d3", body: "正常" },
          ],
        },
      });
      const r = defaultStructuralReportAssembler.assemble(segments);
      const dimSecs = r.sections.filter((s) => s.type === "dimension");
      expect(dimSecs.length).toBe(3);
      expect(r.content.fullMarkdown).toContain("（本维度内容缺失）");
    });

    it("F-EVIL-7 (2026-05-07 hotfix mission c195035f) preface body 空 → preface section 不产出，不再触发 S11 guard", () => {
      // mission c195035f 暴露：leader signoff 没 wire preface body，
      // preface 原是 fixed slot 总产 section（bodyBytes=0）→ S11 chapter_content_incomplete
      // 修：preface 改 optional + fromBuilder('foreword-preface')。这里反向锁住：
      //   bodies.preface 空 → 该 slot 跳过 → 没有 type='preface' 且 title='前言' 的 section
      const segments = buildSegments({
        bodies: {
          ...buildSegments().bodies,
          preface: "", // 空 preface（leader 未填 foreword）
        },
      });
      const r = defaultStructuralReportAssembler.assemble(segments);
      const prefaceSec = r.sections.find(
        (s) => s.title === "前言" && s.type === "preface",
      );
      expect(prefaceSec).toBeUndefined();
      // sectionCountMismatch 保持一致（expectedSectionCount 与 assembler 同步跳过）
      expect(r.metadata.sectionCountMismatch).toBeUndefined();
    });

    it("F-EVIL-7b preface body 非空 → preface section 正常产出", () => {
      const segments = buildSegments({
        bodies: {
          ...buildSegments().bodies,
          preface: "本报告综合评估了... 共计 N 个维度。",
        },
      });
      const r = defaultStructuralReportAssembler.assemble(segments);
      const prefaceSec = r.sections.find((s) => s.title === "前言");
      expect(prefaceSec).toBeDefined();
      expect(prefaceSec?.type).toBe("preface");
    });

    it("F-EVIL-6 optional 段全空 → sections 仅保留有内容的段", () => {
      const segments = buildSegments({
        bodies: {
          executiveSummary: "exec",
          preface: "p",
          perDimension: [{ dimensionId: "d1", body: "x" }],
          // crossDim/risk/rec/conclusion 全空 → 4 个 optional 全跳过
        },
        plan: {
          themeSummary: "...",
          dimensions: [{ id: "d1", name: "维度一", rationale: "" }],
        },
      });
      const r = defaultStructuralReportAssembler.assemble(segments);
      // 公式：3 fixed + 1 dim + 0 optional + 1 references = 5
      expect(r.sections.length).toBe(5);
    });
  });

  describe("dim.name 防御", () => {
    it("\\r\\n 注入被剥（B9 安全）", () => {
      const segments = buildSegments({
        plan: {
          themeSummary: "...",
          dimensions: [
            {
              id: "d1",
              name: "合规\n## 攻击者注入章节",
              rationale: "",
            },
          ],
        },
        bodies: {
          ...buildSegments().bodies,
          perDimension: [{ dimensionId: "d1", body: "正常" }],
        },
      });
      const r = defaultStructuralReportAssembler.assemble(segments);
      // 拼装层 sanitizePlan 会 strip newline + slice
      expect(r.content.fullMarkdown).not.toMatch(/\n## 攻击者注入章节/);
    });

    it("dim.name 超长截到 200", () => {
      const segments = buildSegments({
        plan: {
          themeSummary: "...",
          dimensions: [
            {
              id: "d1",
              name: "x".repeat(500),
              rationale: "",
            },
          ],
        },
        bodies: {
          ...buildSegments().bodies,
          perDimension: [{ dimensionId: "d1", body: "正常" }],
        },
      });
      const r = defaultStructuralReportAssembler.assemble(segments);
      const dimSec = r.sections.find((s) => s.type === "dimension");
      expect(dimSec?.title.length).toBeLessThanOrEqual(200);
    });
  });

  describe("stateless 并发", () => {
    it("Promise.all 并发互不污染（B6）", async () => {
      const s1 = buildSegmentsWithNDims(3);
      const s2 = buildSegmentsWithNDims(7);
      const s3 = buildSegments({ template: SINGLE_AGENT_FREEFORM_TEMPLATE });
      const [r1, r2, r3] = await Promise.all([
        Promise.resolve(defaultStructuralReportAssembler.assemble(s1)),
        Promise.resolve(defaultStructuralReportAssembler.assemble(s2)),
        Promise.resolve(defaultStructuralReportAssembler.assemble(s3)),
      ]);
      expect(r1.sections.length).toBe(
        expectedSectionCount(MULTI_DIMENSION_REPORT_TEMPLATE, s1),
      );
      expect(r2.sections.length).toBe(
        expectedSectionCount(MULTI_DIMENSION_REPORT_TEMPLATE, s2),
      );
      expect(r3.sections.length).toBe(1);
      // sections 是不同对象，不共享引用
      expect(r1.sections).not.toBe(r2.sections);
    });

    it("StructuralReportAssembler 实例无 mutable state（B6 强约束）", () => {
      const a = new StructuralReportAssembler();
      const before = JSON.stringify(a);
      a.assemble(buildSegments());
      const after = JSON.stringify(a);
      expect(after).toBe(before);
    });
  });

  describe("offset 准确性", () => {
    it("拼装 offset 与切片完全对齐", () => {
      const segments = buildSegmentsWithNDims(4);
      const r = defaultStructuralReportAssembler.assemble(segments);
      for (const sec of r.sections) {
        const slice = r.content.fullMarkdown.slice(
          sec.startOffset,
          sec.endOffset,
        );
        // 每段切片 = "## title\n\nbody"
        expect(slice).toMatch(/^## /);
      }
    });
  });

  describe("citations / references builder", () => {
    it("空 citations → 占位文字", () => {
      const r = defaultStructuralReportAssembler.assemble(
        buildSegments({ citations: [] }),
      );
      expect(r.content.fullMarkdown).toContain("（本报告无参考文献）");
    });

    it("有 citations → 渲染编号 + 链接", () => {
      const cites: ArtifactCitation[] = [
        {
          index: 1,
          uuid: "u1",
          title: "ABC",
          url: "https://a.com",
          domain: "a.com",
          accessedAt: "2026-01-01",
          sourceType: "industry",
          credibilityScore: 70,
          occurrences: [],
        },
      ];
      const r = defaultStructuralReportAssembler.assemble(
        buildSegments({ citations: cites }),
      );
      expect(r.content.fullMarkdown).toContain("[ABC](https://a.com)");
    });
  });

  describe("citations / figures / factTable 直通", () => {
    it("不丢失输入的 citations / figures / factTable", () => {
      const cites: ArtifactCitation[] = [
        {
          index: 1,
          uuid: "u1",
          title: "T",
          url: "u",
          domain: "d",
          accessedAt: "2026-01-01",
          sourceType: "blog",
          credibilityScore: 50,
          occurrences: [],
        },
      ];
      const figs: ArtifactFigure[] = [];
      const facts: ArtifactFactTriple[] = [];
      const r = defaultStructuralReportAssembler.assemble(
        buildSegments({ citations: cites, figures: figs, factTable: facts }),
      );
      expect(r.citations).toEqual(cites);
      expect(r.figures).toEqual(figs);
      expect(r.factTable).toEqual(facts);
    });
  });

  describe("buildQuickView 结构化数据派生（PR-quickview-parity）", () => {
    it("无 quickViewData 时 5 组数组兜底为空，前端卡片短路", () => {
      const r = defaultStructuralReportAssembler.assemble(buildSegments());
      expect(r.quickView.topHighlights).toEqual([]);
      expect(r.quickView.topTrends).toEqual([]);
      expect(r.quickView.keyRisks).toEqual([]);
      expect(r.quickView.topRecommendations).toEqual([]);
      expect(r.quickView.whatYouWillLearn).toEqual([]);
      expect(r.quickView.riskMatrix).toEqual([]);
      expect(r.quickView.keyFindingsByDimension).toEqual([]);
      expect(r.quickView.recommendationsByAudience).toBeUndefined();
    });

    it("keyFindingsByDimension 透传 + 派生 topHighlights（带 sourceDimensionId）", () => {
      const r = defaultStructuralReportAssembler.assemble(
        buildSegments({
          quickViewData: {
            keyFindingsByDimension: [
              {
                dimensionName: "维度1",
                findings: [
                  { finding: "发现 A", significance: "high" },
                  { finding: "发现 B", significance: "low" },
                ],
              },
              {
                dimensionName: "维度2",
                findings: [{ finding: "发现 C", significance: "medium" }],
              },
            ],
          },
        }),
      );
      expect(r.quickView.keyFindingsByDimension).toHaveLength(2);
      expect(r.quickView.keyFindingsByDimension[0].dimensionId).toBe("d1");
      expect(r.quickView.keyFindingsByDimension[0].findings).toHaveLength(2);
      // topHighlights 派生：3 条 finding
      expect(r.quickView.topHighlights).toHaveLength(3);
      expect(r.quickView.topHighlights[0].type).toBe("finding");
      expect(r.quickView.topHighlights[0].sourceDimensionId).toBe("d1");
      expect(r.quickView.topHighlights[2].sourceDimensionId).toBe("d2");
    });

    it("keyFindingsByDimension 缺失时从 insights[] 兜底派生 topHighlights", () => {
      const r = defaultStructuralReportAssembler.assemble(
        buildSegments({
          quickViewData: {
            insights: [
              {
                headline: "洞察 1",
                narrative: "解释 1",
                supportingDimensions: ["维度2"],
                confidence: 0.8,
              },
              {
                headline: "洞察 2",
                narrative: "解释 2",
                supportingDimensions: ["维度1", "维度3"],
                confidence: 0.7,
              },
            ],
          },
        }),
      );
      expect(r.quickView.keyFindingsByDimension).toEqual([]);
      expect(r.quickView.topHighlights).toHaveLength(2);
      expect(r.quickView.topHighlights[0].sourceDimensionId).toBe("d2");
      expect(r.quickView.topHighlights[1].sourceDimensionId).toBe("d1");
    });

    it("trendsByDimension 展平为 topTrends，保留 direction + timeframe", () => {
      const r = defaultStructuralReportAssembler.assemble(
        buildSegments({
          quickViewData: {
            trendsByDimension: [
              {
                dimensionName: "维度1",
                trends: [
                  {
                    trend: "趋势 A",
                    direction: "increasing",
                    timeframe: "12个月",
                  },
                  {
                    trend: "趋势 B",
                    direction: "emerging",
                    timeframe: "未来 3 年",
                  },
                ],
              },
            ],
          },
        }),
      );
      expect(r.quickView.topTrends).toHaveLength(2);
      expect(r.quickView.topTrends[0].direction).toBe("increasing");
      expect(r.quickView.topTrends[0].timeframe).toBe("12个月");
      expect(r.quickView.topTrends[0].sourceDimensionId).toBe("d1");
      expect(r.quickView.topTrends[1].direction).toBe("emerging");
    });

    it("riskMatrix 直透 + 派生扁平 keyRisks（带 prob/impact/timeframe 描述）", () => {
      const r = defaultStructuralReportAssembler.assemble(
        buildSegments({
          quickViewData: {
            riskMatrix: [
              {
                riskType: "市场风险",
                probability: "高",
                impact: "中",
                timeframe: "6-12个月",
              },
              {
                riskType: "合规风险",
                probability: "低",
                impact: "高",
                timeframe: "12-24个月",
              },
            ],
          },
        }),
      );
      expect(r.quickView.riskMatrix).toHaveLength(2);
      expect(r.quickView.riskMatrix[0].probability).toBe("高");
      expect(r.quickView.keyRisks).toHaveLength(2);
      expect(r.quickView.keyRisks[0].title).toBe("市场风险");
      expect(r.quickView.keyRisks[0].description).toContain("概率 高");
      expect(r.quickView.keyRisks[0].description).toContain("影响 中");
      expect(r.quickView.keyRisks[0].description).toContain("6-12个月");
    });

    it("recommendationsByAudience 直透 + 派生 topRecommendations（按受众×时间窗口）", () => {
      const r = defaultStructuralReportAssembler.assemble(
        buildSegments({
          quickViewData: {
            recommendationsByAudience: {
              forEnterprise: {
                shortTerm: ["企业短期 1", "企业短期 2", "企业短期 3"],
                midTerm: ["企业中期 1", "企业中期 2"],
              },
              forInvestors: {
                shortTerm: ["投资者短期 1"],
                midTerm: ["投资者中期 1"],
              },
            },
          },
        }),
      );
      expect(r.quickView.recommendationsByAudience).toEqual({
        forEnterprise: expect.objectContaining({
          shortTerm: expect.arrayContaining(["企业短期 1"]),
        }),
        forInvestors: expect.any(Object),
      });
      // topRecommendations: 企业 (2 short + 1 mid) + 投资者 (1 short + 1 mid) = 5 条
      expect(r.quickView.topRecommendations).toHaveLength(5);
      expect(r.quickView.topRecommendations[0]).toEqual({
        title: "企业·短期",
        description: "企业短期 1",
      });
      expect(r.quickView.topRecommendations[3]).toEqual({
        title: "投资者·短期",
        description: "投资者短期 1",
      });
    });

    it("whatYouWillLearn 直接透传", () => {
      const r = defaultStructuralReportAssembler.assemble(
        buildSegments({
          quickViewData: {
            whatYouWillLearn: ["要点 1", "要点 2", "要点 3"],
          },
        }),
      );
      expect(r.quickView.whatYouWillLearn).toEqual([
        "要点 1",
        "要点 2",
        "要点 3",
      ]);
    });
  });
});
