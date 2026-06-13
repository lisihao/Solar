/**
 * TopicExportService — Supplemental Tests
 *
 * Covers uncovered branches:
 * - getSharedTopicLatestReport: visibility !== "PUBLIC" → NotFoundException (lines 291-292)
 * - getSharedTopic: visibility !== "PUBLIC" → NotFoundException (lines 376-377)
 * - transformReportForFrontend: deeply nested sanitization of dimension analyses
 *   - trends/challenges/opportunities arrays (lines 405-453)
 *   - cleanHtmlTagsFromContent: HTML tags stripped, <br> → \n, </p><p> → \n\n, etc.
 *   - keyFindings cleaning
 *   - executiveSummary / fullReport cleaning
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { TopicExportService } from "../topic-export.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ExportOrchestratorService } from "@/common/export/services/export-orchestrator.service";
import { ReportSynthesisService } from "../../../report/report-synthesis.service";

// ─── Mock factories ───────────────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    researchTopic: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    topicCollaborator: {
      count: jest.fn().mockResolvedValue(0),
    },
    topicReport: {
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ visibility: "PRIVATE" }]),
  };
}

function buildMockExportOrchestrator() {
  return { createExportJob: jest.fn() };
}

function buildMockReportService() {
  return { getReport: jest.fn() };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildReportWithAnalyses(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "report-1",
    topicId: "topic-1",
    version: 1,
    executiveSummary: "Summary",
    fullReport: "Full report",
    dimensionAnalyses: [],
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("TopicExportService — supplemental", () => {
  let service: TopicExportService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;
  let mockReportService: ReturnType<typeof buildMockReportService>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();
    mockReportService = buildMockReportService();
    const mockExportOrchestrator = buildMockExportOrchestrator();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicExportService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ExportOrchestratorService,
          useValue: mockExportOrchestrator,
        },
        { provide: ReportSynthesisService, useValue: mockReportService },
      ],
    }).compile();

    service = module.get<TopicExportService>(TopicExportService);
    jest.clearAllMocks();
  });

  // ─── getSharedTopicLatestReport: SHARED/PRIVATE topics are rejected ────────

  describe("getSharedTopicLatestReport — visibility guard", () => {
    it("throws NotFoundException when topic visibility is SHARED", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "Shared Topic",
        visibility: "SHARED",
      });

      await expect(
        service.getSharedTopicLatestReport("topic-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when topic visibility is PRIVATE", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "Private Topic",
        visibility: "PRIVATE",
      });

      await expect(
        service.getSharedTopicLatestReport("topic-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getSharedTopic: SHARED/PRIVATE topics are rejected ───────────────────

  describe("getSharedTopic — visibility guard", () => {
    it("throws NotFoundException when topic visibility is SHARED", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "Shared Topic",
        visibility: "SHARED",
        dimensions: [],
      });

      await expect(service.getSharedTopic("topic-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── transformReportForFrontend via getSharedTopicLatestReport ────────────

  describe("transformReportForFrontend — dimension analyses sanitization", () => {
    beforeEach(() => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "Public Topic",
        visibility: "PUBLIC",
      });
    });

    it("sanitizes executiveSummary and fullReport HTML tags", async () => {
      const report = buildReportWithAnalyses({
        executiveSummary: "<p>Summary content</p>",
        fullReport: "<div>Full <strong>report</strong></div>",
        topic: {
          id: "topic-1",
          name: "T",
          type: "TECHNOLOGY",
          description: "",
        },
        dimensionAnalyses: [],
      });

      mockPrisma.topicReport.findFirst.mockResolvedValue(report);

      const result = await service.getSharedTopicLatestReport("topic-1");

      // HTML tags should be stripped
      expect(result.executiveSummary).not.toContain("<p>");
      expect(result.fullReport).not.toContain("<div>");
      expect(result.fullReport).not.toContain("<strong>");
    });

    it("sanitizes br tags as newlines in analysis content", async () => {
      const report = buildReportWithAnalyses({
        executiveSummary: "Line1<br>Line2<br />Line3",
        fullReport: "A<br/>B",
        topic: {
          id: "topic-1",
          name: "T",
          type: "TECHNOLOGY",
          description: "",
        },
        dimensionAnalyses: [],
      });

      mockPrisma.topicReport.findFirst.mockResolvedValue(report);

      const result = await service.getSharedTopicLatestReport("topic-1");

      expect(result.executiveSummary).toContain("\n");
      expect(result.fullReport).toContain("\n");
    });

    it("sanitizes dimension analysis text fields (analysis, summary)", async () => {
      const report = buildReportWithAnalyses({
        executiveSummary: "Clean",
        fullReport: "Clean",
        topic: {
          id: "topic-1",
          name: "T",
          type: "TECHNOLOGY",
          description: "",
        },
        dimensionAnalyses: [
          {
            analysis: "<p>Analysis with <strong>HTML</strong></p>",
            summary: "<em>Summary</em>",
            dataPoints: null,
            keyFindings: [],
            dimension: { id: "dim-1", name: "Market", description: "" },
          },
        ],
      });

      mockPrisma.topicReport.findFirst.mockResolvedValue(report);

      const result = await service.getSharedTopicLatestReport("topic-1");
      const analyses = result.dimensionAnalyses as Array<{
        analysis: string;
        summary: string;
      }>;

      expect(analyses[0].analysis).not.toContain("<p>");
      expect(analyses[0].analysis).not.toContain("<strong>");
      expect(analyses[0].summary).not.toContain("<em>");
    });

    it("sanitizes keyFindings finding and implication text", async () => {
      const report = buildReportWithAnalyses({
        executiveSummary: "Clean",
        fullReport: "Clean",
        topic: {
          id: "topic-1",
          name: "T",
          type: "TECHNOLOGY",
          description: "",
        },
        dimensionAnalyses: [
          {
            analysis: "Clean analysis",
            summary: "Clean summary",
            dataPoints: null,
            keyFindings: [
              {
                finding: "<b>Key finding</b>",
                implication: "<i>Important implication</i>",
              },
            ],
            dimension: { id: "dim-1", name: "Market", description: "" },
          },
        ],
      });

      mockPrisma.topicReport.findFirst.mockResolvedValue(report);

      const result = await service.getSharedTopicLatestReport("topic-1");
      const analyses = result.dimensionAnalyses as Array<{
        keyFindings: Array<{ finding: string; implication: string }>;
      }>;

      expect(analyses[0].keyFindings[0].finding).not.toContain("<b>");
      expect(analyses[0].keyFindings[0].implication).not.toContain("<i>");
    });

    it("sanitizes trends array text fields (trend, drivers, prediction)", async () => {
      const report = buildReportWithAnalyses({
        executiveSummary: "Clean",
        fullReport: "Clean",
        topic: {
          id: "topic-1",
          name: "T",
          type: "TECHNOLOGY",
          description: "",
        },
        dimensionAnalyses: [
          {
            analysis: "Clean",
            summary: "Clean",
            dataPoints: {
              trends: [
                {
                  trend: "<span>AI Growth</span>",
                  drivers: "<p>Tech drivers</p>",
                  prediction: "<b>2025 prediction</b>",
                },
              ],
              challenges: [],
              opportunities: [],
              confidenceLevel: "high",
              detailedContent: "Content",
            },
            keyFindings: [],
            dimension: { id: "dim-1", name: "Market", description: "" },
          },
        ],
      });

      mockPrisma.topicReport.findFirst.mockResolvedValue(report);

      const result = await service.getSharedTopicLatestReport("topic-1");
      const analyses = result.dimensionAnalyses as Array<{
        trends: Array<{ trend: string; drivers: string; prediction: string }>;
        challenges: unknown[];
        opportunities: unknown[];
        confidenceLevel: string;
        detailedContent: string;
      }>;

      expect(analyses[0].trends[0].trend).not.toContain("<span>");
      expect(analyses[0].trends[0].drivers).not.toContain("<p>");
      expect(analyses[0].trends[0].prediction).not.toContain("<b>");
    });

    it("sanitizes challenges array text fields (challenge, rootCause, impact, potentialSolutions)", async () => {
      const report = buildReportWithAnalyses({
        executiveSummary: "Clean",
        fullReport: "Clean",
        topic: {
          id: "topic-1",
          name: "T",
          type: "TECHNOLOGY",
          description: "",
        },
        dimensionAnalyses: [
          {
            analysis: "Clean",
            summary: "Clean",
            dataPoints: {
              trends: [],
              challenges: [
                {
                  challenge: "<div>Data privacy</div>",
                  rootCause: "<p>Legacy systems</p>",
                  impact: "<em>High impact</em>",
                  potentialSolutions: "<ul><li>Solution A</li></ul>",
                },
              ],
              opportunities: [],
              confidenceLevel: "medium",
              detailedContent: "",
            },
            keyFindings: [],
            dimension: { id: "dim-1", name: "Market", description: "" },
          },
        ],
      });

      mockPrisma.topicReport.findFirst.mockResolvedValue(report);

      const result = await service.getSharedTopicLatestReport("topic-1");
      const analyses = result.dimensionAnalyses as Array<{
        challenges: Array<{
          challenge: string;
          rootCause: string;
          impact: string;
          potentialSolutions: string;
        }>;
      }>;

      expect(analyses[0].challenges[0].challenge).not.toContain("<div>");
      expect(analyses[0].challenges[0].rootCause).not.toContain("<p>");
      expect(analyses[0].challenges[0].impact).not.toContain("<em>");
      expect(analyses[0].challenges[0].potentialSolutions).not.toContain(
        "<ul>",
      );
    });

    it("sanitizes opportunities array text fields (opportunity, potential, requirements)", async () => {
      const report = buildReportWithAnalyses({
        executiveSummary: "Clean",
        fullReport: "Clean",
        topic: {
          id: "topic-1",
          name: "T",
          type: "TECHNOLOGY",
          description: "",
        },
        dimensionAnalyses: [
          {
            analysis: "Clean",
            summary: "Clean",
            dataPoints: {
              trends: [],
              challenges: [],
              opportunities: [
                {
                  opportunity: "<h1>Market entry</h1>",
                  potential: "<span>High potential</span>",
                  requirements: "<b>Capital + Team</b>",
                },
              ],
              confidenceLevel: "low",
              detailedContent: "<p>Details</p>",
            },
            keyFindings: [],
            dimension: { id: "dim-1", name: "Market", description: "" },
          },
        ],
      });

      mockPrisma.topicReport.findFirst.mockResolvedValue(report);

      const result = await service.getSharedTopicLatestReport("topic-1");
      const analyses = result.dimensionAnalyses as Array<{
        opportunities: Array<{
          opportunity: string;
          potential: string;
          requirements: string;
        }>;
        confidenceLevel: string;
        detailedContent: string;
      }>;

      expect(analyses[0].opportunities[0].opportunity).not.toContain("<h1>");
      expect(analyses[0].opportunities[0].potential).not.toContain("<span>");
      expect(analyses[0].opportunities[0].requirements).not.toContain("<b>");
      expect(analyses[0].confidenceLevel).toBe("low");
      expect(analyses[0].detailedContent).not.toContain("<p>");
    });

    it("handles dimension analyses with empty dataPoints (null)", async () => {
      const report = buildReportWithAnalyses({
        executiveSummary: "Summary",
        fullReport: "Full",
        topic: {
          id: "topic-1",
          name: "T",
          type: "TECHNOLOGY",
          description: "",
        },
        dimensionAnalyses: [
          {
            analysis: "Some analysis",
            summary: "Some summary",
            dataPoints: null,
            keyFindings: [],
            dimension: { id: "dim-1", name: "Market", description: "" },
          },
        ],
      });

      mockPrisma.topicReport.findFirst.mockResolvedValue(report);

      const result = await service.getSharedTopicLatestReport("topic-1");
      const analyses = result.dimensionAnalyses as Array<{
        trends: unknown[];
        challenges: unknown[];
        opportunities: unknown[];
        confidenceLevel: unknown;
        detailedContent: string;
      }>;

      // Empty arrays for missing dataPoints fields
      expect(analyses[0].trends).toEqual([]);
      expect(analyses[0].challenges).toEqual([]);
      expect(analyses[0].opportunities).toEqual([]);
      expect(analyses[0].confidenceLevel).toBeNull();
    });

    it("handles </p><p> paragraph separators in content", async () => {
      const report = buildReportWithAnalyses({
        executiveSummary: "<p>Para 1</p><p>Para 2</p>",
        fullReport: "Clean",
        topic: {
          id: "topic-1",
          name: "T",
          type: "TECHNOLOGY",
          description: "",
        },
        dimensionAnalyses: [],
      });

      mockPrisma.topicReport.findFirst.mockResolvedValue(report);

      const result = await service.getSharedTopicLatestReport("topic-1");

      // Should convert paragraph breaks to double newlines
      expect(result.executiveSummary).toContain("Para 1");
      expect(result.executiveSummary).toContain("Para 2");
      expect(result.executiveSummary).not.toContain("<p>");
    });
  });
});
