/**
 * ContentTransformerService 单元测试
 *
 * 覆盖:
 * - transform() 路由分发 (所有 source type)
 * - transformDocument / transformResearch / transformReport / transformRaw
 * - transformPlanning / transformWriting / transformSocial / transformSlides
 * - transformTopicReport / preprocessTopicReportMarkdown
 * - parseMarkdown / parseListItems / parseStructuredContent
 * - NotFoundException 抛出
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException } from "@nestjs/common";
import { ContentTransformerService } from "../content-transformer.service";
import { MissionTransformerService } from "../mission-transformer.service";
import { PrismaService } from "../../../prisma/prisma.service";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Test Doc",
    createdAt: new Date("2024-01-01"),
    markdown: null,
    content: null,
    ...overrides,
  };
}

function makeResearchSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    query: "AI trends in 2024",
    createdAt: new Date("2024-01-01"),
    completedAt: null,
    report: null,
    ...overrides,
  };
}

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "report-1",
    title: "Q1 Report",
    summary: null,
    sections: null,
    createdAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function makeTopic(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "My Plan",
    description: "plan desc",
    updatedAt: new Date("2024-01-02"),
    metadata: {},
    ...overrides,
  };
}

function makeWritingProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "My Novel",
    description: "A story",
    updatedAt: new Date("2024-01-01"),
    volumes: [],
    ...overrides,
  };
}

function makeSocialContent(overrides: Record<string, unknown> = {}) {
  return {
    id: "social-1",
    title: "Post",
    contentType: "ARTICLE",
    author: "Alice",
    content: "Hello world",
    createdAt: new Date("2024-01-01"),
    connection: null,
    ...overrides,
  };
}

function makeSlidesSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "slides-1",
    title: "My Deck",
    updatedAt: new Date("2024-01-01"),
    checkpoints: [],
    ...overrides,
  };
}

function makeTopicReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "tr-1",
    topicId: "topic-1",
    fullReport: "# Report\n\nSome content",
    executiveSummary: "Summary paragraph",
    generatedAt: new Date("2024-01-01"),
    version: 1,
    ...overrides,
  };
}

function makeResearchTopic(overrides: Record<string, unknown> = {}) {
  return {
    id: "topic-1",
    name: "AI Research",
    description: "Research about AI",
    language: "zh",
    ...overrides,
  };
}

// ─── mock setup ──────────────────────────────────────────────────────────────

const mockPrisma = {
  officeDocument: { findUnique: jest.fn() },
  deepResearchSession: { findUnique: jest.fn() },
  report: { findUnique: jest.fn() },
  topic: { findFirst: jest.fn() },
  writingProject: { findUnique: jest.fn() },
  socialContent: { findUnique: jest.fn() },
  slidesSession: { findUnique: jest.fn() },
  topicReport: { findUnique: jest.fn(), findFirst: jest.fn() },
  researchTopic: { findUnique: jest.fn() },
  topicEvidence: { findMany: jest.fn() },
  dimensionAnalysis: { findMany: jest.fn() },
};

const mockMissionTransformer = {
  transform: jest.fn(),
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("ContentTransformerService", () => {
  let service: ContentTransformerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default successful returns
    mockPrisma.topicEvidence.findMany.mockResolvedValue([]);
    mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentTransformerService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: MissionTransformerService,
          useValue: mockMissionTransformer,
        },
      ],
    }).compile();

    service = module.get<ContentTransformerService>(ContentTransformerService);
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transform() – router
  // ──────────────────────────────────────────────────────────────────────────

  describe("transform() router", () => {
    it("routes DOCUMENT to transformDocument", async () => {
      mockPrisma.officeDocument.findUnique.mockResolvedValue(makeDoc());
      const result = await service.transform({
        type: "DOCUMENT",
        documentId: "doc-1",
      });
      expect(result.metadata.title).toBe("Test Doc");
    });

    it("routes RESEARCH to transformResearch", async () => {
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(
        makeResearchSession(),
      );
      const result = await service.transform({
        type: "RESEARCH",
        sessionId: "sess-1",
      });
      expect(result.metadata.subtitle).toBe("AI trends in 2024");
    });

    it("routes REPORT to transformReport", async () => {
      mockPrisma.report.findUnique.mockResolvedValue(makeReport());
      const result = await service.transform({
        type: "REPORT",
        reportId: "report-1",
      });
      expect(result.metadata.title).toBe("Q1 Report");
    });

    it("routes RAW to transformRaw (markdown)", async () => {
      const result = await service.transform({
        type: "RAW",
        content: "# Hello",
        contentType: "markdown",
        title: "My Doc",
      });
      expect(result.metadata.title).toBe("My Doc");
    });

    it("routes MISSION to missionTransformer.transform", async () => {
      mockMissionTransformer.transform.mockResolvedValue({
        metadata: { title: "Mission" },
        sections: [],
      });
      await service.transform({
        type: "MISSION",
        missionId: "m-1",
        topicId: "t-1",
      });
      expect(mockMissionTransformer.transform).toHaveBeenCalledWith(
        "m-1",
        undefined,
      );
    });

    it("routes MISSION with simplifiedMode option", async () => {
      mockMissionTransformer.transform.mockResolvedValue({
        metadata: { title: "Mission" },
        sections: [],
      });
      await service.transform(
        { type: "MISSION", missionId: "m-1", topicId: "t-1" },
        { simplifiedMode: true },
      );
      expect(mockMissionTransformer.transform).toHaveBeenCalledWith(
        "m-1",
        true,
      );
    });

    it("routes PLANNING to transformPlanning", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(
        makeTopic({ metadata: { planningMode: true } }),
      );
      const result = await service.transform({
        type: "PLANNING",
        planId: "plan-1",
      });
      expect(result.metadata.title).toBe("My Plan");
    });

    it("routes WRITING to transformWriting", async () => {
      mockPrisma.writingProject.findUnique.mockResolvedValue(
        makeWritingProject(),
      );
      const result = await service.transform({
        type: "WRITING",
        sessionId: "proj-1",
      });
      expect(result.metadata.title).toBe("My Novel");
    });

    it("routes SOCIAL to transformSocial", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(
        makeSocialContent(),
      );
      const result = await service.transform({
        type: "SOCIAL",
        contentId: "social-1",
      });
      expect(result.metadata.title).toBe("Post");
    });

    it("routes SLIDES to transformSlides", async () => {
      mockPrisma.slidesSession.findUnique.mockResolvedValue(
        makeSlidesSession(),
      );
      const result = await service.transform({
        type: "SLIDES",
        sessionId: "slides-1",
      });
      expect(result.metadata.title).toBe("My Deck");
    });

    it("routes TOPIC_REPORT to transformTopicReport", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue(makeTopicReport());
      mockPrisma.researchTopic.findUnique.mockResolvedValue(
        makeResearchTopic(),
      );
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);
      const result = await service.transform({
        type: "TOPIC_REPORT",
        topicId: "topic-1",
      });
      expect(result.metadata.title).toBe("AI Research");
    });

    it("throws on unsupported source type", async () => {
      await expect(
        service.transform({ type: "UNKNOWN" as unknown as "RAW" } as never),
      ).rejects.toThrow("Unsupported source type");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transformDocument
  // ──────────────────────────────────────────────────────────────────────────

  describe("transformDocument", () => {
    it("throws NotFoundException when document not found", async () => {
      mockPrisma.officeDocument.findUnique.mockResolvedValue(null);
      await expect(
        service.transform({ type: "DOCUMENT", documentId: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("parses markdown field", async () => {
      mockPrisma.officeDocument.findUnique.mockResolvedValue(
        makeDoc({ markdown: "# Title\n\nParagraph" }),
      );
      const result = await service.transform({
        type: "DOCUMENT",
        documentId: "doc-1",
      });
      expect(result.sections.some((s) => s.type === "heading")).toBe(true);
    });

    it("parses structured content.sections", async () => {
      mockPrisma.officeDocument.findUnique.mockResolvedValue(
        makeDoc({
          content: {
            sections: [{ id: "s1", type: "paragraph", content: "Hello" }],
            references: [{ id: 1, title: "Ref 1", url: "http://example.com" }],
          },
        }),
      );
      const result = await service.transform({
        type: "DOCUMENT",
        documentId: "doc-1",
      });
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.references).toBeDefined();
    });

    it("returns empty sections when no markdown and no content", async () => {
      mockPrisma.officeDocument.findUnique.mockResolvedValue(makeDoc());
      const result = await service.transform({
        type: "DOCUMENT",
        documentId: "doc-1",
      });
      expect(result.sections).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transformResearch
  // ──────────────────────────────────────────────────────────────────────────

  describe("transformResearch", () => {
    it("throws NotFoundException when session not found", async () => {
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(null);
      await expect(
        service.transform({ type: "RESEARCH", sessionId: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("uses completedAt when available", async () => {
      const completedAt = new Date("2024-06-01");
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(
        makeResearchSession({ completedAt }),
      );
      const result = await service.transform({
        type: "RESEARCH",
        sessionId: "sess-1",
      });
      expect(result.metadata.date).toEqual(completedAt);
    });

    it("parses executiveSummary, sections, conclusion, and references", async () => {
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(
        makeResearchSession({
          report: {
            executiveSummary: "Key takeaway",
            sections: [
              { title: "Sec 1", content: "Section body", citations: [1, 2] },
            ],
            conclusion: "Final thoughts",
            references: [
              {
                id: 1,
                title: "Paper 1",
                url: "http://paper1.com",
                snippet: "snippet",
                accessedAt: "2024-01-01",
              },
            ],
          },
        }),
      );
      const result = await service.transform({
        type: "RESEARCH",
        sessionId: "sess-1",
      });
      expect(result.sections.some((s) => s.content === "执行摘要")).toBe(true);
      expect(result.sections.some((s) => s.content === "结论")).toBe(true);
      expect(result.references).toBeDefined();
      expect(result.tableOfContents?.enabled).toBe(true);
    });

    it("handles session with no report", async () => {
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(
        makeResearchSession({ report: null }),
      );
      const result = await service.transform({
        type: "RESEARCH",
        sessionId: "sess-1",
      });
      expect(result.sections).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transformReport
  // ──────────────────────────────────────────────────────────────────────────

  describe("transformReport", () => {
    it("throws NotFoundException when report not found", async () => {
      mockPrisma.report.findUnique.mockResolvedValue(null);
      await expect(
        service.transform({ type: "REPORT", reportId: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("includes summary section when present", async () => {
      mockPrisma.report.findUnique.mockResolvedValue(
        makeReport({ summary: "Executive summary here" }),
      );
      const result = await service.transform({
        type: "REPORT",
        reportId: "r1",
      });
      expect(result.sections.some((s) => s.content === "摘要")).toBe(true);
    });

    it("parses sections array", async () => {
      mockPrisma.report.findUnique.mockResolvedValue(
        makeReport({
          sections: [
            { title: "Intro", content: "Intro content" },
            { title: "Body", content: "Body content" },
          ],
        }),
      );
      const result = await service.transform({
        type: "REPORT",
        reportId: "r1",
      });
      expect(result.sections.some((s) => s.content === "Intro")).toBe(true);
    });

    it("handles report with no summary and no sections", async () => {
      mockPrisma.report.findUnique.mockResolvedValue(makeReport());
      const result = await service.transform({
        type: "REPORT",
        reportId: "r1",
      });
      expect(result.sections).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transformRaw
  // ──────────────────────────────────────────────────────────────────────────

  describe("transformRaw", () => {
    it("uses default title when no title provided", async () => {
      const result = await service.transform({
        type: "RAW",
        content: "hello",
        contentType: "markdown",
      });
      expect(result.metadata.title).toBe("导出文档");
    });

    it("handles html content type", async () => {
      const result = await service.transform({
        type: "RAW",
        content: "<p>test</p>",
        contentType: "html",
      });
      expect(result.sections[0].type).toBe("paragraph");
      expect(result.sections[0].content).toBe("<p>test</p>");
    });

    it("handles valid json content type with sections", async () => {
      const result = await service.transform({
        type: "RAW",
        content: JSON.stringify({
          sections: [{ id: "s1", type: "paragraph", content: "Hello JSON" }],
        }),
        contentType: "json",
      });
      expect(result.sections[0].content).toBe("Hello JSON");
    });

    it("handles invalid json content type – produces code block", async () => {
      const result = await service.transform({
        type: "RAW",
        content: "not-json!!!",
        contentType: "json",
      });
      expect(result.sections[0].type).toBe("code");
      expect(result.sections[0].codeLanguage).toBe("json");
    });

    it("handles json with no sections key", async () => {
      const result = await service.transform({
        type: "RAW",
        content: JSON.stringify({ foo: "bar" }),
        contentType: "json",
      });
      expect(result.sections).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transformPlanning
  // ──────────────────────────────────────────────────────────────────────────

  describe("transformPlanning", () => {
    it("throws NotFoundException when topic not found", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);
      await expect(
        service.transform({ type: "PLANNING", planId: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns empty content placeholder when no completed phases", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(
        makeTopic({
          metadata: { planningMode: true, phaseStatus: {}, planConfig: {} },
        }),
      );
      const result = await service.transform({
        type: "PLANNING",
        planId: "plan-1",
      });
      expect(result.sections[0].content).toBe("暂无报告内容");
    });

    it("returns phase 6 content in simplified mode (default)", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(
        makeTopic({
          metadata: {
            planningMode: true,
            phaseStatus: {
              "6": { status: "completed", summary: "# Delivery Summary" },
            },
          },
        }),
      );
      const result = await service.transform({
        type: "PLANNING",
        planId: "plan-1",
      });
      expect(result.sections.some((s) => s.type === "heading")).toBe(true);
    });

    it("returns all completed phases when exportScope is full", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(
        makeTopic({
          metadata: {
            planningMode: true,
            phaseStatus: {
              "1": { status: "completed", summary: "# Phase 1" },
              "3": { status: "completed", summary: "# Phase 3" },
            },
          },
        }),
      );
      const result = await service.transform(
        { type: "PLANNING", planId: "plan-1" },
        { exportScope: "full" },
      );
      const headings = result.sections.filter(
        (s) => s.type === "heading" && s.level === 1,
      );
      expect(headings.length).toBeGreaterThanOrEqual(2);
    });

    it("falls back to all phases when phase 6 missing", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(
        makeTopic({
          metadata: {
            planningMode: true,
            phaseStatus: {
              "2": { status: "completed", summary: "# Phase 2 content" },
            },
          },
        }),
      );
      const result = await service.transform({
        type: "PLANNING",
        planId: "plan-1",
      });
      expect(result.sections.some((s) => s.content === "调研洞察")).toBe(true);
    });

    it("maps planning references", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(
        makeTopic({
          metadata: {
            planningMode: true,
            phaseStatus: {},
            references: [
              {
                id: "ref-1",
                title: "Ref Title",
                url: "http://ref.com",
                snippet: "snip",
              },
            ],
          },
        }),
      );
      const result = await service.transform({
        type: "PLANNING",
        planId: "plan-1",
      });
      expect(result.references).toBeDefined();
      expect(result.references![0].title).toBe("Ref Title");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transformWriting
  // ──────────────────────────────────────────────────────────────────────────

  describe("transformWriting", () => {
    it("throws NotFoundException when project not found", async () => {
      mockPrisma.writingProject.findUnique.mockResolvedValue(null);
      await expect(
        service.transform({ type: "WRITING", sessionId: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns placeholder when no volumes", async () => {
      mockPrisma.writingProject.findUnique.mockResolvedValue(
        makeWritingProject(),
      );
      const result = await service.transform({
        type: "WRITING",
        sessionId: "proj-1",
      });
      expect(result.sections[0].content).toBe("暂无写作内容");
    });

    it("builds sections from volumes and chapters", async () => {
      mockPrisma.writingProject.findUnique.mockResolvedValue(
        makeWritingProject({
          volumes: [
            {
              id: "v1",
              title: "Volume 1",
              volumeNumber: 1,
              chapters: [
                {
                  id: "c1",
                  title: "Chapter 1",
                  chapterNumber: 1,
                  content: "# Heading\n\nText",
                },
              ],
            },
          ],
        }),
      );
      const result = await service.transform({
        type: "WRITING",
        sessionId: "proj-1",
      });
      expect(result.sections.some((s) => s.content === "Volume 1")).toBe(true);
      expect(result.sections.some((s) => s.content === "Chapter 1")).toBe(true);
    });

    it("falls back to volume number when title is falsy", async () => {
      mockPrisma.writingProject.findUnique.mockResolvedValue(
        makeWritingProject({
          volumes: [
            {
              id: "v1",
              title: null,
              volumeNumber: 2,
              chapters: [],
            },
          ],
        }),
      );
      const result = await service.transform({
        type: "WRITING",
        sessionId: "proj-1",
      });
      expect(result.sections.some((s) => s.content === "卷 2")).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transformSocial
  // ──────────────────────────────────────────────────────────────────────────

  describe("transformSocial", () => {
    it("throws NotFoundException when social content not found", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(null);
      await expect(
        service.transform({ type: "SOCIAL", contentId: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("uses default title when no title provided", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(
        makeSocialContent({ title: null }),
      );
      const result = await service.transform({
        type: "SOCIAL",
        contentId: "social-1",
      });
      expect(result.metadata.title).toBe("社交内容");
    });

    it("parses content markdown", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(
        makeSocialContent(),
      );
      const result = await service.transform({
        type: "SOCIAL",
        contentId: "social-1",
      });
      expect(result.sections.length).toBeGreaterThan(0);
    });

    it("returns empty sections when no content", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(
        makeSocialContent({ content: null }),
      );
      const result = await service.transform({
        type: "SOCIAL",
        contentId: "social-1",
      });
      expect(result.sections).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transformSlides
  // ──────────────────────────────────────────────────────────────────────────

  describe("transformSlides", () => {
    it("throws NotFoundException when slides session not found", async () => {
      mockPrisma.slidesSession.findUnique.mockResolvedValue(null);
      await expect(
        service.transform({ type: "SLIDES", sessionId: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns placeholder when no checkpoints", async () => {
      mockPrisma.slidesSession.findUnique.mockResolvedValue(
        makeSlidesSession(),
      );
      const result = await service.transform({
        type: "SLIDES",
        sessionId: "slides-1",
      });
      expect(result.sections[0].content).toBe("暂无幻灯片内容");
    });

    it("extracts slides content from checkpoint stateJson", async () => {
      mockPrisma.slidesSession.findUnique.mockResolvedValue(
        makeSlidesSession({
          checkpoints: [
            {
              stateJson: {
                slides: [
                  { id: "s1", title: "Slide Title", content: "# Content" },
                  { id: "s2", notes: "Speaker notes" },
                ],
              },
            },
          ],
        }),
      );
      const result = await service.transform({
        type: "SLIDES",
        sessionId: "slides-1",
      });
      expect(result.sections.some((s) => s.content === "Slide Title")).toBe(
        true,
      );
    });

    it("uses 'pages' key as fallback for slides array", async () => {
      mockPrisma.slidesSession.findUnique.mockResolvedValue(
        makeSlidesSession({
          checkpoints: [
            {
              stateJson: {
                pages: [{ id: "p1", title: "Page 1", content: "Content text" }],
              },
            },
          ],
        }),
      );
      const result = await service.transform({
        type: "SLIDES",
        sessionId: "slides-1",
      });
      expect(result.sections.some((s) => s.content === "Page 1")).toBe(true);
    });

    it("uses default title when session title is falsy", async () => {
      mockPrisma.slidesSession.findUnique.mockResolvedValue(
        makeSlidesSession({ title: null }),
      );
      const result = await service.transform({
        type: "SLIDES",
        sessionId: "slides-1",
      });
      expect(result.metadata.title).toBe("演示文稿");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transformTopicReport
  // ──────────────────────────────────────────────────────────────────────────

  describe("transformTopicReport", () => {
    it("throws NotFoundException when topic report not found", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue(null);
      await expect(
        service.transform({ type: "TOPIC_REPORT", topicId: "t1" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("fetches report by reportId when provided", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(makeTopicReport());
      mockPrisma.researchTopic.findUnique.mockResolvedValue(
        makeResearchTopic(),
      );
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);
      await service.transform({
        type: "TOPIC_REPORT",
        topicId: "t1",
        reportId: "tr-1",
      });
      expect(mockPrisma.topicReport.findUnique).toHaveBeenCalledWith({
        where: { id: "tr-1" },
      });
    });

    it("maps evidences to references", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue(makeTopicReport());
      mockPrisma.researchTopic.findUnique.mockResolvedValue(
        makeResearchTopic(),
      );
      mockPrisma.topicEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          title: "Evidence 1",
          url: "http://e.com",
          snippet: "snip",
          domain: "e.com",
        },
      ]);
      const result = await service.transform({
        type: "TOPIC_REPORT",
        topicId: "t1",
      });
      expect(result.references).toBeDefined();
      expect(result.references![0].title).toBe("Evidence 1");
    });

    it("uses en-US language for English topics", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue(makeTopicReport());
      mockPrisma.researchTopic.findUnique.mockResolvedValue(
        makeResearchTopic({ language: "en" }),
      );
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);
      const result = await service.transform({
        type: "TOPIC_REPORT",
        topicId: "t1",
      });
      expect(result.metadata.language).toBe("en-US");
    });

    it("handles null topic and no evidences", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue(makeTopicReport());
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);
      const result = await service.transform({
        type: "TOPIC_REPORT",
        topicId: "t1",
      });
      expect(result.metadata.title).toBe("Topic Report");
      expect(result.references).toBeUndefined();
    });

    it("returns placeholder when fullReport is null and no executiveSummary", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue(
        makeTopicReport({ fullReport: null, executiveSummary: null }),
      );
      mockPrisma.researchTopic.findUnique.mockResolvedValue(
        makeResearchTopic(),
      );
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);
      const result = await service.transform({
        type: "TOPIC_REPORT",
        topicId: "t1",
      });
      expect(result.sections[0].content).toBe("暂无报告内容");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // parseMarkdown (tested via transformRaw)
  // ──────────────────────────────────────────────────────────────────────────

  describe("parseMarkdown – token types", () => {
    async function parse(md: string) {
      const r = await service.transform({
        type: "RAW",
        content: md,
        contentType: "markdown",
      });
      return r.sections;
    }

    it("parses heading tokens", async () => {
      const sections = await parse("# H1\n## H2");
      expect(sections[0]).toMatchObject({
        type: "heading",
        level: 1,
        content: "H1",
      });
      expect(sections[1]).toMatchObject({
        type: "heading",
        level: 2,
        content: "H2",
      });
    });

    it("parses paragraph tokens", async () => {
      const sections = await parse("Plain text paragraph.");
      expect(sections[0]).toMatchObject({ type: "paragraph" });
    });

    it("parses unordered list tokens", async () => {
      const sections = await parse("- item1\n- item2");
      expect(sections[0]).toMatchObject({ type: "list", ordered: false });
      expect(sections[0].items?.length).toBeGreaterThanOrEqual(1);
    });

    it("parses ordered list tokens", async () => {
      const sections = await parse("1. first\n2. second");
      expect(sections[0]).toMatchObject({ type: "list", ordered: true });
    });

    it("parses code block tokens", async () => {
      const sections = await parse("```typescript\nconst x = 1;\n```");
      expect(sections[0]).toMatchObject({
        type: "code",
        codeLanguage: "typescript",
      });
    });

    it("parses blockquote tokens", async () => {
      const sections = await parse("> This is a quote");
      expect(sections[0]).toMatchObject({ type: "quote" });
    });

    it("parses hr tokens", async () => {
      const sections = await parse("---");
      expect(sections[0]).toMatchObject({ type: "divider" });
    });

    it("parses table tokens", async () => {
      const sections = await parse("| A | B |\n|---|---|\n| 1 | 2 |");
      expect(sections[0]).toMatchObject({ type: "table" });
      expect(sections[0].headers).toEqual(["A", "B"]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // preprocessTopicReportMarkdown (tested via transformTopicReport)
  // ──────────────────────────────────────────────────────────────────────────

  describe("preprocessTopicReportMarkdown", () => {
    async function processReport(fullReport: string) {
      mockPrisma.topicReport.findFirst.mockResolvedValue(
        makeTopicReport({ fullReport }),
      );
      mockPrisma.researchTopic.findUnique.mockResolvedValue(
        makeResearchTopic(),
      );
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);
      return service.transform({ type: "TOPIC_REPORT", topicId: "t1" });
    }

    it("extracts markdown from JSON-wrapped fullReport with fullText key", async () => {
      const json = JSON.stringify({
        fullText: "# Extracted Content\n\nParagraph",
      });
      const result = await processReport(json);
      expect(
        result.sections.some((s) => s.content === "Extracted Content"),
      ).toBe(true);
    });

    it("strips chart placeholder comments", async () => {
      const md = "# Title\n\n<!-- chart:abc-123 -->\n\nContent";
      const result = await processReport(md);
      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).not.toContain("<!-- chart:");
    });

    it("strips code-fenced chart JSON blocks", async () => {
      const md = '# Title\n\n```json\n{"generatedCharts": []}\n```\n\nEnd';
      const result = await processReport(md);
      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).not.toContain("generatedCharts");
    });

    it("handles plain markdown without JSON wrapping", async () => {
      const result = await processReport("# Plain Title\n\nContent text");
      expect(result.sections.some((s) => s.type === "heading")).toBe(true);
    });
  });
});
