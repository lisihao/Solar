/**
 * ReportGeneratorService Unit Tests
 *
 * Coverage targets:
 * - checkCrossDimensionConsistency: single vs multiple dimensions
 * - generateComprehensiveReport: happy path, fallback on context_length error
 * - generateExecutiveSummary: delegates to generateComprehensiveReport
 */

// Break the ai-harness/facade import chain (transitively imports @nestjs/cache-manager)
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ReportGeneratorService } from "../report-generator.service";
import { ReportAssemblerService } from "../report-assembler.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { ResearchTopic } from "@prisma/client";
import type {
  DimensionAnalysisInput,
  EvidenceInput,
} from "../../../types/report.types";

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

const mockEnglishTopic = {
  ...mockTopic,
  language: "en",
} as unknown as ResearchTopic;

function buildDimensionInput(
  overrides?: Partial<DimensionAnalysisInput>,
): DimensionAnalysisInput {
  return {
    dimensionId: "dim-001",
    dimensionName: "技术现状",
    dimensionDescription: "当前量子计算技术状态",
    summary: "量子计算进入实用化阶段",
    keyFindings: [
      {
        finding: "超导量子位错误率下降至 1%",
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
    detailedContent: "## 技术现状\n\n量子计算机已突破 1000 量子位门槛。",
    sourcesUsed: 10,
    figureReferences: [],
    generatedCharts: [],
    ...overrides,
  };
}

function buildEvidenceInput(): EvidenceInput {
  return {
    citationIndex: 1,
    title: "Quantum Computing Progress 2024",
    url: "https://arxiv.org/abs/2024.0001",
    domain: "arxiv.org",
    sourceType: "ACADEMIC",
    publishedAt: new Date("2024-01-15"),
    credibilityScore: 0.95,
  };
}

const VALID_REPORT_JSON = JSON.stringify({
  executiveSummary: "量子计算进入新纪元，商业化路径逐渐清晰。",
  preface: "本报告基于最新研究数据...",
  conclusion:
    "## 跨维度关联分析\n内容\n\n## 风险评估\n内容\n\n## 战略建议\n内容\n\n## 结语\n最终结论。",
  highlights: [
    {
      title: "量子优越性",
      description: "已超越经典计算机",
      category: "breakthrough",
      importance: "high",
    },
  ],
  charts: [],
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ReportGeneratorService", () => {
  let service: ReportGeneratorService;
  let mockFacade: { chatWithSkills: jest.Mock };

  beforeEach(async () => {
    mockFacade = { chatWithSkills: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportGeneratorService,
        { provide: ChatFacade, useValue: mockFacade },
        {
          provide: ReportAssemblerService,
          useValue: {
            assembleFullReport: jest
              .fn()
              .mockImplementation((_topic: any, dims: any[], sc: any) => {
                const parts = [`# ${_topic.name}`];
                dims.forEach((d: any, idx: number) =>
                  parts.push(
                    `## ${idx + 1}. ${d.dimensionName || "Dimension"}\n\n${d.detailedContent || d.summary || ""}`,
                  ),
                );
                Object.values(sc || {}).forEach((v: any) => {
                  if (v) parts.push(String(v));
                });
                return parts.join("\n\n");
              }),
            postProcessFinalReport: jest
              .fn()
              .mockImplementation((content: string) => ({
                content,
                warnings: [],
              })),
            processDimensionContent: jest
              .fn()
              .mockImplementation((content: string) => content),
          },
        },
      ],
    }).compile();

    service = module.get<ReportGeneratorService>(ReportGeneratorService);
  });

  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // checkCrossDimensionConsistency
  // ============================================================

  describe("checkCrossDimensionConsistency", () => {
    it("should return high consistency without AI call for single dimension", async () => {
      const result = await service.checkCrossDimensionConsistency(mockTopic, [
        buildDimensionInput(),
      ]);

      expect(mockFacade.chatWithSkills).not.toHaveBeenCalled();
      expect(result.overallConsistency).toBe("high");
      expect(result.conflicts).toHaveLength(0);
      expect(result.summary).toBe("单维度研究，无需跨维度一致性检查");
    });

    it("should return high consistency without AI call for zero dimensions", async () => {
      const result = await service.checkCrossDimensionConsistency(
        mockTopic,
        [],
      );

      expect(mockFacade.chatWithSkills).not.toHaveBeenCalled();
      expect(result.overallConsistency).toBe("high");
    });

    it("should call AI and return parsed consistency result for multiple dimensions", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          overallConsistency: "medium",
          conflicts: [
            {
              type: "data_conflict",
              severity: "warning",
              dimensions: ["技术现状", "市场应用"],
              description: "量子位数量数据不一致",
              suggestedResolution: "以权威来源为准",
            },
          ],
          recommendations: ["统一引用标准"],
          summary: "存在轻微数据差异",
        }),
      });

      const dims = [
        buildDimensionInput(),
        buildDimensionInput({
          dimensionName: "市场应用",
          dimensionId: "dim-002",
        }),
      ];
      const result = await service.checkCrossDimensionConsistency(
        mockTopic,
        dims,
      );

      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(1);
      expect(result.overallConsistency).toBe("medium");
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe("data_conflict");
    });

    it("should return default high consistency when AI call fails", async () => {
      mockFacade.chatWithSkills.mockRejectedValue(
        new Error("AI service unavailable"),
      );

      const dims = [
        buildDimensionInput(),
        buildDimensionInput({ dimensionId: "dim-002" }),
      ];
      const result = await service.checkCrossDimensionConsistency(
        mockTopic,
        dims,
      );

      expect(result.overallConsistency).toBe("high");
      expect(result.conflicts).toHaveLength(0);
      expect(result.summary).toBe("一致性检查跳过");
    });

    it("should return default high consistency when AI response cannot be parsed", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "This is not JSON",
      });

      const dims = [
        buildDimensionInput(),
        buildDimensionInput({ dimensionId: "dim-002" }),
      ];
      const result = await service.checkCrossDimensionConsistency(
        mockTopic,
        dims,
      );

      expect(result.overallConsistency).toBe("high");
      expect(result.conflicts).toHaveLength(0);
    });

    it("should handle critical conflicts in response", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          overallConsistency: "low",
          conflicts: [
            {
              type: "logic_conflict",
              severity: "critical",
              dimensions: ["A", "B"],
              description: "逻辑矛盾",
              suggestedResolution: "重新分析",
            },
            {
              type: "data_conflict",
              severity: "warning",
              dimensions: ["A", "C"],
              description: "数据差异",
              suggestedResolution: "标注差异",
            },
          ],
          recommendations: ["重新审查数据"],
          summary: "存在严重冲突",
        }),
      });

      const dims = [
        buildDimensionInput(),
        buildDimensionInput({ dimensionId: "dim-002", dimensionName: "B" }),
      ];
      const result = await service.checkCrossDimensionConsistency(
        mockTopic,
        dims,
      );

      expect(result.overallConsistency).toBe("low");
      expect(
        result.conflicts.filter((c) => c.severity === "critical"),
      ).toHaveLength(1);
    });
  });

  // ============================================================
  // generateComprehensiveReport
  // ============================================================

  describe("generateComprehensiveReport", () => {
    it("should generate a comprehensive report on happy path", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: VALID_REPORT_JSON,
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [buildEvidenceInput()],
      );

      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(1);
      expect(result.executiveSummary).toBe(
        "量子计算进入新纪元，商业化路径逐渐清晰。",
      );
      expect(result.highlights).toHaveLength(1);
      expect(result.fullReport).toBeDefined();
    });

    it("should include conflict notice in prompt when consistency check has conflicts", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: VALID_REPORT_JSON,
      });

      const consistencyCheck = {
        overallConsistency: "low" as const,
        conflicts: [
          {
            type: "data_conflict",
            severity: "critical",
            dimensions: ["A", "B"],
            description: "数据矛盾",
            suggestedResolution: "统一标准",
          },
        ],
        recommendations: ["重新核查"],
      };

      await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [buildEvidenceInput()],
        consistencyCheck,
      );

      const chatCall = mockFacade.chatWithSkills.mock.calls[0][0];
      const userPrompt = chatCall.messages[1].content;
      expect(userPrompt).toContain("数据一致性修正指令");
      expect(userPrompt).toContain("数据矛盾");
    });

    it("should include userFeedback in prompt when provided", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: VALID_REPORT_JSON,
      });

      await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
        undefined,
        "请重点分析商业化前景",
      );

      const chatCall = mockFacade.chatWithSkills.mock.calls[0][0];
      const userPrompt = chatCall.messages[1].content;
      expect(userPrompt).toContain("请重点分析商业化前景");
    });

    it("should fall back to reduced prompt on context_length error", async () => {
      mockFacade.chatWithSkills
        .mockRejectedValueOnce(new Error("context_length exceeded"))
        .mockResolvedValueOnce({ content: VALID_REPORT_JSON });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [buildEvidenceInput()],
      );

      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(2);
      expect(result.executiveSummary).toBeDefined();
    });

    it("should fall back to reduced prompt on input-complexity-check error", async () => {
      mockFacade.chatWithSkills
        .mockRejectedValueOnce(new Error("input-complexity-check failed"))
        .mockResolvedValueOnce({ content: VALID_REPORT_JSON });

      await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(2);
      // Second call should omit detailed evidence
      const secondCall = mockFacade.chatWithSkills.mock.calls[1][0];
      const userPrompt = secondCall.messages[1].content;
      expect(userPrompt).toContain("证据列表已省略");
    });

    it("should rethrow non-complexity errors without fallback", async () => {
      mockFacade.chatWithSkills.mockRejectedValue(
        new Error("Authentication failed"),
      );

      await expect(
        service.generateComprehensiveReport(
          mockTopic,
          [buildDimensionInput()],
          [],
        ),
      ).rejects.toThrow("Authentication failed");

      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(1);
    });

    it("should not pass explicit maxTokens (delegated to TaskProfile mapper)", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: VALID_REPORT_JSON,
      });

      const manyDimensions = Array.from({ length: 20 }, (_, i) =>
        buildDimensionInput({
          dimensionId: `dim-${i}`,
          dimensionName: `维度 ${i}`,
        }),
      );

      await service.generateComprehensiveReport(mockTopic, manyDimensions, []);

      const chatCall = mockFacade.chatWithSkills.mock.calls[0][0];
      // maxTokens should NOT be passed — TaskProfile mapper handles model-specific limits
      expect(chatCall.maxTokens).toBeUndefined();
      expect(chatCall.taskProfile).toEqual({
        creativity: "medium",
        outputLength: "extended",
      });
    });

    it("should use correct modelType (CHAT) for report synthesis", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: VALID_REPORT_JSON,
      });

      await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      const chatCall = mockFacade.chatWithSkills.mock.calls[0][0];
      expect(chatCall.modelType).toBe("CHAT");
    });

    it("should handle English language topic with correct labels", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Executive summary here",
          preface: "Preface content",
          conclusion:
            "## Cross-Dimension Analysis\nContent\n\n## Risk Assessment\nContent\n\n## Strategic Recommendations\nContent\n\n## Conclusion\nFinal conclusion.",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockEnglishTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.executiveSummary).toBe("Executive summary here");
    });

    it("should handle malformed AI response gracefully", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "Not valid JSON at all.",
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      // Service normalizes the response and returns a result
      expect(result).toBeDefined();
      expect(result.fullReport).toBeDefined();
    });
  });

  // ============================================================
  // generateExecutiveSummary
  // ============================================================

  describe("generateExecutiveSummary", () => {
    it("should return only the executive summary from a comprehensive report", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: VALID_REPORT_JSON,
      });

      const summary = await service.generateExecutiveSummary(mockTopic, [
        buildDimensionInput(),
      ]);

      expect(summary).toBe("量子计算进入新纪元，商业化路径逐渐清晰。");
    });

    it("should call AI once and delegate to generateComprehensiveReport", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: VALID_REPORT_JSON,
      });

      await service.generateExecutiveSummary(mockTopic, [
        buildDimensionInput(),
      ]);

      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // buildFullReportFromDimensions — public method
  // ============================================================

  describe("buildFullReportFromDimensions", () => {
    it("should delegate to assembler.assembleFullReport", () => {
      const dims = [buildDimensionInput()];
      const supplementary = {
        preface: "研究前言内容",
        executiveSummary: "执行摘要内容",
        crossDimensionAnalysis: "跨维度分析内容",
      };

      const result = service.buildFullReportFromDimensions(
        mockTopic,
        dims,
        supplementary,
      );

      expect(typeof result).toBe("string");
      const assembler = (service as any).assembler;
      expect(assembler.assembleFullReport).toHaveBeenCalledWith(
        mockTopic,
        dims,
        supplementary,
      );
    });

    it("should return string for empty dimensionInputs", () => {
      const result = service.buildFullReportFromDimensions(mockTopic, [], {});
      expect(typeof result).toBe("string");
    });
  });

  // ============================================================
  // normalizeExecutiveSummary — object vs string format
  // ============================================================

  describe("normalizeExecutiveSummary via generateComprehensiveReport", () => {
    it("should handle executiveSummary as structured object with fullText", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: {
            fullText: "来自 fullText 的摘要",
            coreConclusions: ["结论1"],
          },
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.executiveSummary).toBe("来自 fullText 的摘要");
    });

    it("should assemble executiveSummary from structured fields when fullText absent", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: {
            coreConclusions: ["量子计算超越经典算法", "商业应用加速落地"],
            keyMetrics: [
              { metric: "市场规模", value: "$500B", source: "Gartner" },
            ],
            riskAlerts: ["量子纠错成本高"],
            actionItems: ["加大量子投资"],
          },
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.executiveSummary).toContain("核心结论");
      expect(result.executiveSummary).toContain("量子计算超越经典算法");
      expect(result.executiveSummary).toContain("关键数据");
      expect(result.executiveSummary).toContain("风险提示");
      expect(result.executiveSummary).toContain("行动建议");
    });

    it("should handle executiveSummary as JSON string containing coreConclusions", async () => {
      const esJson = JSON.stringify({
        coreConclusions: ["量子计算突破性进展"],
        fullText: "完整摘要文本",
      });

      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: esJson,
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.executiveSummary).toBe("完整摘要文本");
    });

    it("should handle executiveSummary as plain JSON string that fails to parse", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "{invalid json",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.executiveSummary).toBe("{invalid json");
    });

    it("should return empty string for null/undefined executiveSummary", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: null,
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.executiveSummary).toBe("");
    });
  });

  // ============================================================
  // normalizeReportResponse — crossDimensionAnalysis / riskAssessment / strategicRecommendations
  // ============================================================

  describe("normalizeReportResponse — supplementary content fields", () => {
    it("should use crossDimensionAnalysis.fullText when present", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "摘要",
          crossDimensionAnalysis: { fullText: "跨维度完整文本" },
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.fullReport).toContain("跨维度完整文本");
    });

    it("should generate crossDimensionAnalysis from causalChains and keyLinkages when fullText absent", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "摘要",
          crossDimensionAnalysis: {
            causalChains: [
              {
                chain: "A→B→C",
                explanation: "原因链解释",
                timeframe: "2024-2026",
              },
            ],
            keyLinkages: [
              {
                dimensions: ["技术", "市场"],
                relationship: "相互促进",
                impact: "高",
              },
            ],
          },
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.fullReport).toContain("A→B→C");
    });

    it("should generate riskAssessment from riskMatrix when fullText absent", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "摘要",
          riskAssessment: {
            riskMatrix: [
              {
                riskType: "技术风险",
                probability: "高",
                impact: "重大",
                timeframe: "2025",
                indicators: "量子错误率升高",
                mitigation: "增加纠错预算",
              },
            ],
          },
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.fullReport).toContain("技术风险");
    });

    it("should generate strategicRecommendations from forEnterprise/forInvestors when fullText absent", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "摘要",
          strategicRecommendations: {
            forEnterprise: {
              shortTerm: ["优化量子算法", "招募量子工程师"],
              midTerm: ["建立量子计算中心"],
            },
            forInvestors: {
              opportunities: ["量子计算初创公司"],
              risks: ["技术成熟期不确定"],
            },
            forPolicymakers: {
              keyObservations: ["需要国际合作框架"],
            },
          },
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.fullReport).toContain("优化量子算法");
    });

    it("should use English labels when language is en", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Summary",
          crossDimensionAnalysis: {
            causalChains: [
              { chain: "A→B", explanation: "Explanation", timeframe: "2024" },
            ],
          },
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      const result = await service.generateComprehensiveReport(
        mockEnglishTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.fullReport).toContain("Causal Chain Analysis");
    });
  });

  // ============================================================
  // createFallbackReport — when AI response cannot be parsed
  // ============================================================

  describe("createFallbackReport via malformed AI response", () => {
    it("should extract viewpoints from numbered list in fallback", async () => {
      const contentWithPoints =
        "分析结果\n\n1. 量子计算市场规模快速增长。\n2. 技术突破持续推进。";
      mockFacade.chatWithSkills.mockResolvedValue({
        content: contentWithPoints,
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result).toBeDefined();
      expect(result.fullReport).toBeDefined();
    });

    it("should extract viewpoints from key-phrase patterns in fallback", async () => {
      const contentWithKeyPhrases =
        "研究内容\n\n关键：量子计算将在五年内实现商业化突破。核心：错误纠正率成关键指标。";
      mockFacade.chatWithSkills.mockResolvedValue({
        content: contentWithKeyPhrases,
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result).toBeDefined();
    });

    it("should use first sentence as executiveSummary in fallback", async () => {
      const contentWithSentence = "量子计算市场规模超过百亿美元。后续内容...";
      mockFacade.chatWithSkills.mockResolvedValue({
        content: contentWithSentence,
      });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result.executiveSummary).toContain("量子计算市场规模超过百亿美元");
    });

    it("should use English label for fallback section when language is en", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "Research content without valid JSON.",
      });

      const result = await service.generateComprehensiveReport(
        mockEnglishTopic,
        [buildDimensionInput()],
        [],
      );

      expect(result).toBeDefined();
      expect(result.fullReport).toBeDefined();
    });
  });

  // ============================================================
  // generateComprehensiveReport — conflict notice branches
  // ============================================================

  describe("generateComprehensiveReport — conflict notice branches", () => {
    it("should include both critical and warning conflict notices", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: VALID_REPORT_JSON,
      });

      const consistencyCheck = {
        overallConsistency: "low" as const,
        conflicts: [
          {
            type: "data_conflict",
            severity: "critical",
            dimensions: ["A", "B"],
            description: "临界数据矛盾",
            suggestedResolution: "选用权威来源",
          },
          {
            type: "source_conflict",
            severity: "warning",
            dimensions: ["C", "D"],
            description: "次要差异",
            suggestedResolution: "标注来源差异",
          },
        ],
        recommendations: ["审查数据"],
      };

      await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
        consistencyCheck,
      );

      const chatCall = mockFacade.chatWithSkills.mock.calls[0][0];
      const userPrompt = chatCall.messages[1].content;
      expect(userPrompt).toContain("关键冲突");
      expect(userPrompt).toContain("次要差异");
    });

    it("should not include conflict notice when conflicts array is empty", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: VALID_REPORT_JSON,
      });

      const consistencyCheck = {
        overallConsistency: "high" as const,
        conflicts: [],
        recommendations: [],
      };

      await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
        consistencyCheck,
      );

      const chatCall = mockFacade.chatWithSkills.mock.calls[0][0];
      const userPrompt = chatCall.messages[1].content;
      expect(userPrompt).not.toContain("数据一致性修正指令");
    });

    it("should handle max_tokens error in fallback chain", async () => {
      mockFacade.chatWithSkills
        .mockRejectedValueOnce(new Error("max_tokens exceeded limit"))
        .mockResolvedValueOnce({ content: VALID_REPORT_JSON });

      const result = await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [buildEvidenceInput()],
      );

      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it("should use TaskProfile extended outputLength for any dimension count", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: VALID_REPORT_JSON,
      });

      await service.generateComprehensiveReport(
        mockTopic,
        [buildDimensionInput()],
        [],
      );

      const chatCall = mockFacade.chatWithSkills.mock.calls[0][0];
      // maxTokens delegated to TaskProfile mapper, not computed per dimension count
      expect(chatCall.maxTokens).toBeUndefined();
      expect(chatCall.taskProfile.outputLength).toBe("extended");
    });
  });

  // ============================================================
  // checkCrossDimensionConsistency — additional branches
  // ============================================================

  describe("checkCrossDimensionConsistency — additional branches", () => {
    it("should include keyFindings and trends in dimension summaries sent to AI", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          overallConsistency: "high",
          conflicts: [],
          recommendations: [],
          summary: "一致性良好",
        }),
      });

      const dimA = buildDimensionInput({
        keyFindings: [
          { finding: "发现A1", significance: "high", evidenceIds: [] },
          { finding: "发现A2", significance: "medium", evidenceIds: [] },
          { finding: "发现A3", significance: "low", evidenceIds: [] },
          { finding: "发现A4", significance: "low", evidenceIds: [] }, // Only first 3 included
        ],
        trends: [
          {
            trend: "趋势A1",
            direction: "up",
            timeframe: "2024",
            evidenceIds: [],
          },
          {
            trend: "趋势A2",
            direction: "stable",
            timeframe: "2024",
            evidenceIds: [],
          },
          {
            trend: "趋势A3",
            direction: "down",
            timeframe: "2024",
            evidenceIds: [],
          }, // Only first 2 included
        ],
      });
      const dimB = buildDimensionInput({
        dimensionId: "dim-002",
        dimensionName: "市场",
      });

      await service.checkCrossDimensionConsistency(mockTopic, [dimA, dimB]);

      const chatCall = mockFacade.chatWithSkills.mock.calls[0][0];
      const userMsg = chatCall.messages[1].content;
      // First 3 key findings
      expect(userMsg).toContain("发现A1");
      expect(userMsg).toContain("发现A3");
      // First 2 trends
      expect(userMsg).toContain("趋势A1");
      expect(userMsg).toContain("趋势A2");
    });

    it("should handle dimension with no keyFindings or trends", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          overallConsistency: "high",
          conflicts: [],
          recommendations: [],
          summary: "无数据",
        }),
      });

      const dimEmpty = buildDimensionInput({
        keyFindings: [],
        trends: [],
        summary: "",
      });
      const dimB = buildDimensionInput({ dimensionId: "dim-002" });

      const result = await service.checkCrossDimensionConsistency(mockTopic, [
        dimEmpty,
        dimB,
      ]);

      expect(result.overallConsistency).toBe("high");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // extractHighlights — public method
  // ──────────────────────────────────────────────────────────────────────────────

  describe("extractHighlights", () => {
    it("should extract highlights from sections.coreViewpoints when sections have data", () => {
      const report = {
        executiveSummary: "Summary",
        sections: [
          {
            sectionNumber: 1,
            title: "技术现状",
            coreViewpoints: [
              "市场规模：2025年AI市场将达到5000亿",
              "量子计算突破商用门槛",
            ],
            content: "详细内容",
          },
        ],
        highlights: [],
        charts: [],
      } as never;

      const dims = [buildDimensionInput()];
      const highlights = service.extractHighlights(report, dims);

      expect(Array.isArray(highlights)).toBe(true);
      expect(highlights.length).toBeGreaterThan(0);
      expect(highlights[0].dimensionName).toBe("技术现状");
    });

    it("should extract highlights from dimensionInputs.keyFindings when sections have no coreViewpoints", () => {
      const report = {
        executiveSummary: "Summary",
        sections: [
          {
            sectionNumber: 1,
            title: "技术现状",
            coreViewpoints: [], // empty
            content: "内容",
          },
        ],
        highlights: [],
        charts: [],
      } as never;

      const dims = [
        buildDimensionInput({
          keyFindings: [
            {
              finding: "超导量子位错误率降至1%",
              significance: "high",
              evidenceIds: [],
            },
            {
              finding: "机会：量子计算市场潜力巨大",
              significance: "medium",
              evidenceIds: [],
            },
          ],
        }),
      ];

      const highlights = service.extractHighlights(report, dims);

      expect(Array.isArray(highlights)).toBe(true);
      expect(highlights.length).toBeGreaterThan(0);
    });

    it("should categorize viewpoints: 机会 → 市场机会", () => {
      const report = {
        executiveSummary: "Summary",
        sections: [
          {
            sectionNumber: 1,
            title: "机会分析",
            coreViewpoints: ["机会：市场增长潜力"],
            content: "",
          },
        ],
        highlights: [],
        charts: [],
      } as never;

      const dims = [buildDimensionInput()];
      const highlights = service.extractHighlights(report, dims);

      const marketOpp = highlights.find((h) => h.category === "市场机会");
      expect(marketOpp).toBeDefined();
    });

    it("should categorize viewpoints: 趋势 → 技术趋势", () => {
      const report = {
        executiveSummary: "Summary",
        sections: [
          {
            sectionNumber: 1,
            title: "趋势",
            coreViewpoints: ["趋势：AI技术快速演进"],
            content: "",
          },
        ],
        highlights: [],
        charts: [],
      } as never;

      const dims = [buildDimensionInput()];
      const highlights = service.extractHighlights(report, dims);

      const trend = highlights.find((h) => h.category === "技术趋势");
      expect(trend).toBeDefined();
    });

    it("should categorize viewpoints: 风险 → 风险警示", () => {
      const report = {
        executiveSummary: "Summary",
        sections: [
          {
            sectionNumber: 1,
            title: "风险",
            coreViewpoints: ["风险：数据隐私挑战严峻"],
            content: "",
          },
        ],
        highlights: [],
        charts: [],
      } as never;

      const dims = [buildDimensionInput()];
      const highlights = service.extractHighlights(report, dims);

      const risk = highlights.find((h) => h.category === "风险警示");
      expect(risk).toBeDefined();
    });

    it("should categorize viewpoints: 战略 → 战略建议", () => {
      const report = {
        executiveSummary: "Summary",
        sections: [
          {
            sectionNumber: 1,
            title: "战略",
            coreViewpoints: ["战略：重点布局AI基础设施建设"],
            content: "",
          },
        ],
        highlights: [],
        charts: [],
      } as never;

      const dims = [buildDimensionInput()];
      const highlights = service.extractHighlights(report, dims);

      const strategy = highlights.find((h) => h.category === "战略建议");
      expect(strategy).toBeDefined();
    });

    it("should categorize unknown viewpoints as 核心发现", () => {
      const report = {
        executiveSummary: "Summary",
        sections: [
          {
            sectionNumber: 1,
            title: "结论",
            coreViewpoints: ["综合来看表现良好"],
            content: "",
          },
        ],
        highlights: [],
        charts: [],
      } as never;

      const dims = [buildDimensionInput()];
      const highlights = service.extractHighlights(report, dims);

      const core = highlights.find((h) => h.category === "核心发现");
      expect(core).toBeDefined();
    });

    it("should limit highlights to 10 items", () => {
      const coreViewpoints = Array.from(
        { length: 20 },
        (_, i) => `观点${i + 1}：内容`,
      );
      const sections = coreViewpoints.map((_, i) => ({
        sectionNumber: i + 1,
        title: `章节${i + 1}`,
        coreViewpoints: [coreViewpoints[i]],
        content: "",
      }));
      const dims = sections.map((s, i) =>
        buildDimensionInput({
          dimensionId: `dim-${i}`,
          dimensionName: s.title,
        }),
      );

      const report = { sections, highlights: [], charts: [] } as never;
      const highlights = service.extractHighlights(report, dims);

      expect(highlights.length).toBeLessThanOrEqual(10);
    });

    it("should return empty array when report has no sections and dims have no keyFindings", () => {
      const report = { sections: [], highlights: [], charts: [] } as never;
      const dims = [buildDimensionInput({ keyFindings: [] })];

      const highlights = service.extractHighlights(report, dims);

      expect(highlights).toEqual([]);
    });

    it("should use colon strategy in extractTitleFromContent (first key phrase before colon)", () => {
      const report = {
        sections: [
          {
            sectionNumber: 1,
            title: "测试",
            coreViewpoints: ["市场规模：2025年预计达到5000亿美元"],
            content: "",
          },
        ],
        highlights: [],
        charts: [],
      } as never;

      const dims = [buildDimensionInput()];
      const highlights = service.extractHighlights(report, dims);

      expect(highlights[0].title).toBe("市场规模");
    });

    it("should use first-sentence strategy in extractTitleFromContent", () => {
      // Content without colon, but with comma separator
      const report = {
        sections: [
          {
            sectionNumber: 1,
            title: "分析",
            coreViewpoints: ["超导量子位错误率，已经降低到了史无前例的水平"],
            content: "",
          },
        ],
        highlights: [],
        charts: [],
      } as never;

      const dims = [buildDimensionInput()];
      const highlights = service.extractHighlights(report, dims);

      expect(highlights[0].title).toBeDefined();
      expect(highlights[0].title.length).toBeGreaterThan(0);
    });

    it("should truncate very long content in extractTitleFromContent", () => {
      // Content longer than 20 chars with no early comma/colon
      const longContent =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const report = {
        sections: [
          {
            sectionNumber: 1,
            title: "Long",
            coreViewpoints: [longContent],
            content: "",
          },
        ],
        highlights: [],
        charts: [],
      } as never;

      const dims = [buildDimensionInput()];
      const highlights = service.extractHighlights(report, dims);

      expect(highlights[0].title).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // extractSectionFromConclusion — public method
  // ──────────────────────────────────────────────────────────────────────────────

  describe("extractSectionFromConclusion", () => {
    it("should extract section using ## heading pattern", () => {
      const conclusion = `## 跨维度关联分析\n\n这是跨维度分析内容。\n\n## 风险评估\n\n风险内容。`;

      const result = service.extractSectionFromConclusion(
        conclusion,
        "跨维度关联分析",
      );

      expect(result).toContain("跨维度分析内容");
    });

    it("should return empty string when conclusion is empty", () => {
      const result = service.extractSectionFromConclusion("", "跨维度关联分析");

      expect(result).toBe("");
    });

    it("should return empty string when section not found", () => {
      const conclusion = "这是结论，没有对应章节。";

      const result = service.extractSectionFromConclusion(
        conclusion,
        "不存在的章节",
      );

      expect(result).toBe("");
    });

    it("should fall back to # heading pattern (single hash)", () => {
      const conclusion = `# 战略建议\n\n建议一：加大研发投入。\n\n# 结语\n\n最后总结。`;

      const result = service.extractSectionFromConclusion(
        conclusion,
        "战略建议",
      );

      expect(result).toContain("加大研发投入");
    });

    it("should use plain title pattern as third fallback", () => {
      const conclusion = `\n风险评估\n\n风险点一。风险点二。`;

      const result = service.extractSectionFromConclusion(
        conclusion,
        "风险评估",
      );

      expect(result).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // extractFinalConclusion — public method
  // ──────────────────────────────────────────────────────────────────────────────

  describe("extractFinalConclusion", () => {
    it("should return empty string when conclusion is empty", () => {
      const result = service.extractFinalConclusion("", "zh");

      expect(result).toBe("");
    });

    it("should remove 跨维度关联分析 and 风险评估 sections from Chinese conclusion", () => {
      const conclusion = `## 跨维度关联分析\n\n分析内容。\n\n## 风险评估\n\n风险内容。\n\n## 结语\n\n最终结语。`;

      const result = service.extractFinalConclusion(conclusion, "zh");

      expect(result).not.toContain("跨维度关联分析");
      expect(result).not.toContain("风险评估");
    });

    it("should remove English section titles when language is en", () => {
      const conclusion = `## Cross-Dimension Analysis\n\nAnalysis content.\n\n## Risk Assessment\n\nRisk content.\n\n## Final\n\nFinal conclusion.`;

      const result = service.extractFinalConclusion(conclusion, "en");

      expect(result).not.toContain("Cross-Dimension Analysis");
      expect(result).not.toContain("Risk Assessment");
    });

    it("should default to zh language when not specified", () => {
      const conclusion = `## 战略建议\n\n建议内容。\n\n## 结语\n\n结语内容。`;

      const result = service.extractFinalConclusion(conclusion);

      expect(result).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // generateComprehensiveReport — rich normalizeReportResponse branches
  // ──────────────────────────────────────────────────────────────────────────────

  describe("generateComprehensiveReport — additional report structure branches", () => {
    it("should handle report with tableOfContents in normalizeReportResponse", async () => {
      const reportWithToc = JSON.stringify({
        executiveSummary: "Summary",
        tableOfContents: "1. 技术现状\n2. 市场分析",
        conclusion: "综合结论",
        highlights: [],
        charts: [],
      });

      mockFacade.chatWithSkills.mockResolvedValue({ content: reportWithToc });

      const dim = buildDimensionInput();
      const result = await service.generateComprehensiveReport(
        mockTopic,
        [dim],
        [buildEvidenceInput()],
      );

      expect(result).toBeDefined();
    });

    it("should handle report with sections containing keyData", async () => {
      const reportWithSections = JSON.stringify({
        executiveSummary: "Summary",
        sections: [
          {
            sectionNumber: 1,
            title: "技术现状",
            content: "内容",
            coreViewpoints: ["观点一"],
            keyData: [{ data: "AI市场规模5000亿", source: "IDC 2025" }],
          },
        ],
        conclusion: "结论",
        highlights: [],
        charts: [],
      });

      mockFacade.chatWithSkills.mockResolvedValue({
        content: reportWithSections,
      });

      const dim = buildDimensionInput();
      const result = await service.generateComprehensiveReport(
        mockTopic,
        [dim],
        [buildEvidenceInput()],
      );

      expect(result).toBeDefined();
    });

    it("should handle report with sections containing figureReferences", async () => {
      const reportWithFigures = JSON.stringify({
        executiveSummary: "Summary",
        sections: [
          {
            sectionNumber: 1,
            title: "技术现状",
            content: "内容",
            coreViewpoints: [],
            figureReferences: [
              {
                id: "fig-1",
                description: "AI市场增长图",
                suggestedType: "bar",
              },
            ],
          },
        ],
        conclusion: "结论",
        highlights: [],
        charts: [],
      });

      mockFacade.chatWithSkills.mockResolvedValue({
        content: reportWithFigures,
      });

      const dim = buildDimensionInput();
      const result = await service.generateComprehensiveReport(
        mockTopic,
        [dim],
        [buildEvidenceInput()],
      );

      expect(result).toBeDefined();
    });

    it("should handle report with sections containing inlineCharts (end_of_section position)", async () => {
      const reportWithInlineCharts = JSON.stringify({
        executiveSummary: "Summary",
        sections: [
          {
            sectionNumber: 1,
            title: "技术现状",
            content: "内容",
            coreViewpoints: [],
            inlineCharts: [
              {
                id: "chart-1",
                type: "bar",
                position: "end_of_section",
                data: {},
              },
            ],
          },
        ],
        conclusion: "结论",
        highlights: [],
        charts: [],
      });

      mockFacade.chatWithSkills.mockResolvedValue({
        content: reportWithInlineCharts,
      });

      const dim = buildDimensionInput();
      const result = await service.generateComprehensiveReport(
        mockTopic,
        [dim],
        [buildEvidenceInput()],
      );

      expect(result).toBeDefined();
    });

    it("should handle report with appendices", async () => {
      const reportWithAppendices = JSON.stringify({
        executiveSummary: "Summary",
        conclusion: "结论",
        appendices: [
          { title: "数据来源", content: "各数据来源说明" },
          { title: "术语表", content: "AI: 人工智能" },
        ],
        highlights: [],
        charts: [],
      });

      mockFacade.chatWithSkills.mockResolvedValue({
        content: reportWithAppendices,
      });

      const dim = buildDimensionInput();
      const result = await service.generateComprehensiveReport(
        mockTopic,
        [dim],
        [buildEvidenceInput()],
      );

      expect(result).toBeDefined();
    });

    it("should handle report with references", async () => {
      const reportWithReferences = JSON.stringify({
        executiveSummary: "Summary",
        conclusion: "结论",
        references: [
          {
            index: 1,
            title: "Quantum Computing 2024",
            domain: "arxiv.org",
            url: "https://arxiv.org/abs/2024",
            accessDate: "2024-01-01",
          },
        ],
        highlights: [],
        charts: [],
      });

      mockFacade.chatWithSkills.mockResolvedValue({
        content: reportWithReferences,
      });

      const dim = buildDimensionInput();
      const result = await service.generateComprehensiveReport(
        mockTopic,
        [dim],
        [buildEvidenceInput()],
      );

      expect(result).toBeDefined();
    });

    it("should handle normalizeExecutiveSummary with JSON containing fullText string", async () => {
      // executiveSummary as stringified JSON with fullText field
      const reportWithJsonEs = JSON.stringify({
        executiveSummary: JSON.stringify({
          fullText: "This is the full executive summary text.",
        }),
        conclusion: "结论",
        highlights: [],
        charts: [],
      });

      mockFacade.chatWithSkills.mockResolvedValue({
        content: reportWithJsonEs,
      });

      const dim = buildDimensionInput();
      const result = await service.generateComprehensiveReport(
        mockTopic,
        [dim],
        [buildEvidenceInput()],
      );

      expect(result).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // buildFullReportFromDimensions — heading demotion branches
  // ──────────────────────────────────────────────────────────────────────────────

  describe("buildFullReportFromDimensions — additional branch coverage", () => {
    it("should delegate dimension content to assembler (heading demotion is assembler responsibility)", () => {
      const dimWithDoubleHash = buildDimensionInput({
        detailedContent: "## 子章节标题\n\n内容段落。",
      });

      service.buildFullReportFromDimensions(mockTopic, [dimWithDoubleHash], {
        conclusion: "结论",
      });

      const assembler = (service as any).assembler;
      expect(assembler.assembleFullReport).toHaveBeenCalledWith(
        mockTopic,
        [dimWithDoubleHash],
        { conclusion: "结论" },
      );
    });

    it("should handle dimensions with inlineCharts with after_paragraph position", () => {
      const dimWithCharts = buildDimensionInput({
        detailedContent: "段落一内容。\n\n段落二内容。",
        generatedCharts: [
          {
            id: "chart-g1",
            type: "line",
            position: "after_paragraph_1",
            data: {},
            config: {},
          } as never,
        ],
      });

      const reportJson = JSON.stringify({
        executiveSummary: "Summary",
        conclusion: "结论",
        highlights: [],
        charts: [],
      });

      mockFacade.chatWithSkills.mockResolvedValue({ content: reportJson });

      const result = service.buildFullReportFromDimensions(
        mockTopic,
        [dimWithCharts],
        { conclusion: "结论" },
      );

      expect(result).toBeDefined();
    });

    it("should handle dimensions with figureReferences in resolveChartPlaceholders", () => {
      const dimWithFigures = buildDimensionInput({
        detailedContent: "内容 <!-- figure:1:0 --> 更多内容。",
        figureReferences: [
          {
            id: "fig-a",
            evidenceCitationIndex: 1,
            figureIndex: 0,
            description: "图表A",
            suggestedType: "bar",
          },
        ],
      });

      const reportJson = JSON.stringify({
        executiveSummary: "Summary",
        conclusion: "结论",
        highlights: [],
        charts: [],
      });

      mockFacade.chatWithSkills.mockResolvedValue({ content: reportJson });

      const result = service.buildFullReportFromDimensions(
        mockTopic,
        [dimWithFigures],
        { conclusion: "结论" },
      );

      expect(result).toBeDefined();
    });
  });
});
