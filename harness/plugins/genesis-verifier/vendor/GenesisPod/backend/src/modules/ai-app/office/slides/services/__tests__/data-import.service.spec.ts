/**
 * Unit tests for SlidesDataImportService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { SlidesDataImportService } from "../data-import.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import {
  TOPIC_INSIGHTS_DATA_EXPORT,
  RESEARCH_PROJECT_DATA_EXPORT,
  WRITING_DATA_EXPORT,
} from "../../../../contracts/interfaces/data-export.interface";

describe("SlidesDataImportService", () => {
  let service: SlidesDataImportService;
  let prisma: jest.Mocked<PrismaService>;
  let topicInsightsExport: {
    getTopicForExport: jest.Mock;
    listTopicsForExport: jest.Mock;
  };
  let researchProjectExport: {
    getProjectForExport: jest.Mock;
    listProjectsForExport: jest.Mock;
  };
  let writingExport: {
    getProjectForExport: jest.Mock;
    listProjectsForExport: jest.Mock;
  };

  const mockResearchData = {
    id: "topic-1",
    name: "AI Research 2024",
    description: "Research on AI trends",
    language: "zh",
    createdAt: new Date("2024-01-01"),
    dimensions: [
      { name: "Technology", description: "Tech dimension", sortOrder: 0 },
      { name: "Market", description: "Market dimension", sortOrder: 1 },
    ],
    latestReport: {
      fullReport:
        "Full report content with some data https://example.com/report",
      charts: [
        {
          type: "bar",
          title: "AI Market Share",
          labels: ["OpenAI", "Google", "Anthropic"],
          series: [{ data: [40, 35, 25] }],
        },
      ],
      highlights: ["Key finding 1 about AI growth"],
      dimensionAnalyses: [
        {
          summary: "Technology summary",
          dataPoints: { key: "value" },
          dimension: { name: "Technology" },
        },
        {
          summary: "Market summary",
          dataPoints: null,
          dimension: { name: "Market" },
        },
      ],
    },
  };

  const mockResearchProjectData = {
    id: "project-1",
    name: "Deep Dive Project",
    description: "A deep research project",
    researchType: "academic",
    createdAt: new Date("2024-01-01"),
    outputs: [
      {
        id: "out-1",
        type: "report",
        title: "Chapter 1",
        status: "completed",
        content: "Chapter 1 content",
      },
      {
        id: "out-2",
        type: "report",
        title: "Chapter 2",
        status: "completed",
        content: "Chapter 2 content",
      },
    ],
  };

  const mockWritingData = {
    id: "writing-1",
    name: "My Novel",
    genre: "Sci-Fi",
    writingStyle: "Third Person",
    createdAt: new Date("2024-01-01"),
    volumes: [
      {
        id: "vol-1",
        title: "Volume 1",
        volumeNumber: 1,
        chapters: [
          {
            id: "ch-1",
            title: "Chapter 1",
            chapterNumber: 1,
            content: "Chapter 1 content here",
          },
          {
            id: "ch-2",
            title: "Chapter 2",
            chapterNumber: 2,
            content: "Chapter 2 content here",
          },
        ],
      },
    ],
  };

  const mockTopic = {
    id: "topic-1",
    name: "AI Debate",
    description: "Debate on AI ethics",
    createdAt: new Date("2024-01-01"),
    messages: [
      {
        content: "Message from Agent 1",
        senderId: null,
        aiMemberId: "agent-1",
        sender: null,
        aiMember: {
          id: "agent-1",
          displayName: "Agent Alpha",
          roleDescription: "Pro-AI perspective",
        },
      },
      {
        content: "Message from Agent 2",
        senderId: null,
        aiMemberId: "agent-2",
        sender: null,
        aiMember: {
          id: "agent-2",
          displayName: "Agent Beta",
          roleDescription: "Critical perspective",
        },
      },
    ],
    aiMembers: [
      { id: "agent-1", displayName: "Agent Alpha" },
      { id: "agent-2", displayName: "Agent Beta" },
    ],
  };

  beforeEach(async () => {
    const mockPrisma = {
      topic: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      resource: {
        findMany: jest.fn(),
      },
    };

    topicInsightsExport = {
      getTopicForExport: jest.fn(),
      listTopicsForExport: jest.fn(),
    };

    researchProjectExport = {
      getProjectForExport: jest.fn(),
      listProjectsForExport: jest.fn(),
    };

    writingExport = {
      getProjectForExport: jest.fn(),
      listProjectsForExport: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlidesDataImportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TOPIC_INSIGHTS_DATA_EXPORT, useValue: topicInsightsExport },
        {
          provide: RESEARCH_PROJECT_DATA_EXPORT,
          useValue: researchProjectExport,
        },
        { provide: WRITING_DATA_EXPORT, useValue: writingExport },
      ],
    }).compile();

    service = module.get<SlidesDataImportService>(SlidesDataImportService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("importFromResearch", () => {
    it("should import data from research topic", async () => {
      topicInsightsExport.getTopicForExport.mockResolvedValueOnce(
        mockResearchData,
      );

      const result = await service.importFromResearch("topic-1", "user-1");

      expect(result).toBeDefined();
      expect(result.sourceType).toBe("research");
      expect(result.sourceId).toBe("topic-1");
      expect(result.sections).toHaveLength(2);
      expect(result.metadata?.title).toBe("AI Research 2024");
      expect(result.metadata?.language).toBe("zh");
      expect(topicInsightsExport.getTopicForExport).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
    });

    it("should build sourceText from dimension summaries", async () => {
      topicInsightsExport.getTopicForExport.mockResolvedValueOnce(
        mockResearchData,
      );

      const result = await service.importFromResearch("topic-1", "user-1");

      expect(result.sourceText).toContain("AI Research 2024");
      expect(result.sourceText).toContain("Technology");
      expect(result.sourceText.length).toBeGreaterThan(0);
    });

    it("should cap sourceText at MAX_SOURCE_TEXT_RESEARCH (12000)", async () => {
      const longSummary = "A".repeat(2000);
      const largeData = {
        ...mockResearchData,
        latestReport: {
          ...mockResearchData.latestReport,
          dimensionAnalyses: Array.from({ length: 20 }, (_, i) => ({
            summary: longSummary,
            dataPoints: null,
            dimension: { name: `Dimension ${i}` },
          })),
        },
      };
      topicInsightsExport.getTopicForExport.mockResolvedValueOnce(largeData);

      const result = await service.importFromResearch("topic-1", "user-1");

      expect(result.sourceText.length).toBeLessThanOrEqual(12500); // 12000 + small buffer
    });

    it("should fallback to dimensions when no dimensionAnalyses in report", async () => {
      const dataWithoutAnalyses = {
        ...mockResearchData,
        latestReport: {
          ...mockResearchData.latestReport,
          dimensionAnalyses: [],
        },
      };
      topicInsightsExport.getTopicForExport.mockResolvedValueOnce(
        dataWithoutAnalyses,
      );

      const result = await service.importFromResearch("topic-1", "user-1");

      expect(result.sections).toHaveLength(0); // No dimension analyses -> no sections from that path
    });

    it("should fallback to dimensions when no latestReport", async () => {
      const dataWithoutReport = {
        ...mockResearchData,
        latestReport: null,
      };
      topicInsightsExport.getTopicForExport.mockResolvedValueOnce(
        dataWithoutReport,
      );

      const result = await service.importFromResearch("topic-1", "user-1");

      // Should use dimensions as fallback
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].title).toBe("Technology");
    });

    it("should extract charts from report", async () => {
      topicInsightsExport.getTopicForExport.mockResolvedValueOnce(
        mockResearchData,
      );

      const result = await service.importFromResearch("topic-1", "user-1");

      expect(result.charts).toBeDefined();
      expect(result.charts!.length).toBeGreaterThan(0);
    });

    it("should skip invalid chart types", async () => {
      const dataWithBadChart = {
        ...mockResearchData,
        latestReport: {
          ...mockResearchData.latestReport,
          charts: [
            {
              type: "invalid_type",
              title: "Bad Chart",
              labels: [],
              series: [],
            },
            { type: "bar", title: "Good Chart", labels: ["A"], series: [] },
          ],
        },
      };
      topicInsightsExport.getTopicForExport.mockResolvedValueOnce(
        dataWithBadChart,
      );

      const result = await service.importFromResearch("topic-1", "user-1");

      expect(result.charts!.length).toBe(1);
      expect(result.charts![0].title).toBe("Good Chart");
    });

    it("should extract key findings from highlights", async () => {
      topicInsightsExport.getTopicForExport.mockResolvedValueOnce(
        mockResearchData,
      );

      const result = await service.importFromResearch("topic-1", "user-1");

      expect(result.keyFindings).toBeDefined();
      expect(result.keyFindings!.length).toBeGreaterThan(0);
    });

    it("should extract references from report URLs", async () => {
      topicInsightsExport.getTopicForExport.mockResolvedValueOnce(
        mockResearchData,
      );

      const result = await service.importFromResearch("topic-1", "user-1");

      expect(result.references).toBeDefined();
      expect(
        result.references!.some((r) => r.url.includes("example.com")),
      ).toBe(true);
    });

    it("should skip localhost URLs in references", async () => {
      const dataWithLocalhost = {
        ...mockResearchData,
        latestReport: {
          ...mockResearchData.latestReport,
          fullReport:
            "Content https://localhost:3000/test and https://valid.com/page",
        },
      };
      topicInsightsExport.getTopicForExport.mockResolvedValueOnce(
        dataWithLocalhost,
      );

      const result = await service.importFromResearch("topic-1", "user-1");

      expect(
        result.references?.some((r) => r.url.includes("localhost")),
      ).toBeFalsy();
    });
  });

  describe("importFromResearchProject", () => {
    it("should import data from research project", async () => {
      researchProjectExport.getProjectForExport.mockResolvedValueOnce(
        mockResearchProjectData,
      );

      const result = await service.importFromResearchProject(
        "project-1",
        "user-1",
      );

      expect(result).toBeDefined();
      expect(result.sourceType).toBe("research-project");
      expect(result.sourceId).toBe("project-1");
      expect(result.sections).toHaveLength(2);
      expect(result.metadata?.title).toBe("Deep Dive Project");
    });

    it("should build sourceText from outputs", async () => {
      researchProjectExport.getProjectForExport.mockResolvedValueOnce(
        mockResearchProjectData,
      );

      const result = await service.importFromResearchProject(
        "project-1",
        "user-1",
      );

      expect(result.sourceText).toContain("Deep Dive Project");
      expect(result.sourceText).toContain("Chapter 1");
    });
  });

  describe("importFromWriting", () => {
    it("should import data from writing project", async () => {
      writingExport.getProjectForExport.mockResolvedValueOnce(mockWritingData);

      const result = await service.importFromWriting("writing-1", "user-1");

      expect(result).toBeDefined();
      expect(result.sourceType).toBe("writing");
      expect(result.sourceId).toBe("writing-1");
      expect(result.sections).toHaveLength(2);
      expect(result.metadata?.title).toBe("My Novel");
      expect(result.metadata?.genre).toBe("Sci-Fi");
    });

    it("should build outline from volumes and chapters", async () => {
      writingExport.getProjectForExport.mockResolvedValueOnce(mockWritingData);

      const result = await service.importFromWriting("writing-1", "user-1");

      expect(result.outline).toBeDefined();
      expect(result.outline!.length).toBe(1); // 1 volume
      expect(result.outline![0].children).toHaveLength(2); // 2 chapters
    });

    it("should calculate word count", async () => {
      writingExport.getProjectForExport.mockResolvedValueOnce(mockWritingData);

      const result = await service.importFromWriting("writing-1", "user-1");

      expect(result.metadata?.wordCount).toBeGreaterThan(0);
    });

    it("should cap writing sourceText at MAX_SOURCE_TEXT_WRITING (15000)", async () => {
      const largeWritingData = {
        ...mockWritingData,
        volumes: [
          {
            ...mockWritingData.volumes[0],
            chapters: Array.from({ length: 20 }, (_, i) => ({
              id: `ch-${i}`,
              title: `Chapter ${i + 1}`,
              chapterNumber: i + 1,
              content: "A".repeat(4000), // 4000 chars per chapter
            })),
          },
        ],
      };
      writingExport.getProjectForExport.mockResolvedValueOnce(largeWritingData);

      const result = await service.importFromWriting("writing-1", "user-1");

      expect(result.sourceText.length).toBeLessThanOrEqual(15500);
    });
  });

  describe("importFromTeams", () => {
    it("should import data from teams topic", async () => {
      (prisma.topic.findFirst as jest.Mock).mockResolvedValueOnce(mockTopic);

      const result = await service.importFromTeams("topic-1", "user-1");

      expect(result).toBeDefined();
      expect(result.sourceType).toBe("teams");
      expect(result.sourceId).toBe("topic-1");
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.metadata?.title).toBe("AI Debate");
      expect(result.metadata?.agents).toContain("Agent Alpha");
    });

    it("should throw NotFoundException when topic not found", async () => {
      (prisma.topic.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.importFromTeams("nonexistent-topic", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should group messages by sender", async () => {
      (prisma.topic.findFirst as jest.Mock).mockResolvedValueOnce(mockTopic);

      const result = await service.importFromTeams("topic-1", "user-1");

      // Two distinct senders -> two sections
      expect(result.sections).toHaveLength(2);
    });

    it("should build all content from all messages", async () => {
      (prisma.topic.findFirst as jest.Mock).mockResolvedValueOnce(mockTopic);

      const result = await service.importFromTeams("topic-1", "user-1");

      expect(result.sourceText).toContain("Message from Agent 1");
      expect(result.sourceText).toContain("Message from Agent 2");
    });
  });

  describe("importFromLibrary", () => {
    it("should import resources from library", async () => {
      const mockResources = [
        {
          id: "res-1",
          title: "Image Resource",
          type: "IMAGE",
          sourceUrl: "https://example.com/image.jpg",
          abstract: "An image",
          thumbnailUrl: "https://example.com/thumb.jpg",
        },
        {
          id: "res-2",
          title: "Document Resource",
          type: "PDF",
          sourceUrl: "https://example.com/doc.pdf",
          abstract: null,
          thumbnailUrl: null,
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValueOnce(
        mockResources,
      );

      const result = await service.importFromLibrary(
        ["res-1", "res-2"],
        "user-1",
      );

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("image");
      expect(result[1].type).toBe("document");
    });

    it("should return empty array when no resources found", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.importFromLibrary([], "user-1");

      expect(result).toHaveLength(0);
    });

    it("should map AUDIO type to audio", async () => {
      const mockResources = [
        {
          id: "audio-1",
          title: "Audio",
          type: "AUDIO",
          sourceUrl: "https://example.com/audio.mp3",
          abstract: null,
          thumbnailUrl: null,
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValueOnce(
        mockResources,
      );

      const result = await service.importFromLibrary(["audio-1"], "user-1");

      expect(result[0].type).toBe("audio");
    });

    it("should map unknown type to document", async () => {
      const mockResources = [
        {
          id: "unknown-1",
          title: "Unknown",
          type: "UNKNOWN_TYPE",
          sourceUrl: "https://example.com/file",
          abstract: null,
          thumbnailUrl: null,
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValueOnce(
        mockResources,
      );

      const result = await service.importFromLibrary(["unknown-1"], "user-1");

      expect(result[0].type).toBe("document");
    });
  });

  describe("listResearchTopics", () => {
    it("should list research topics for import", async () => {
      topicInsightsExport.listTopicsForExport.mockResolvedValueOnce([
        {
          id: "topic-1",
          name: "AI Research",
          description: "About AI",
          createdAt: new Date(),
          dimensionCount: 5,
        },
      ]);

      const result = await service.listResearchTopics("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("research");
      expect(result[0].title).toBe("AI Research");
    });
  });

  describe("listResearchProjects", () => {
    it("should list research projects for import", async () => {
      researchProjectExport.listProjectsForExport.mockResolvedValueOnce([
        {
          id: "proj-1",
          name: "Research Project",
          description: "Deep research",
          researchType: "academic",
          createdAt: new Date(),
          outputCount: 3,
        },
      ]);

      const result = await service.listResearchProjects("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("research-project");
    });
  });

  describe("listWritingProjects", () => {
    it("should list writing projects for import", async () => {
      writingExport.listProjectsForExport.mockResolvedValueOnce([
        {
          id: "writing-1",
          name: "Novel",
          genre: "Sci-Fi",
          createdAt: new Date(),
          volumeCount: 2,
        },
      ]);

      const result = await service.listWritingProjects("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("writing");
      expect(result[0].preview).toBe("Sci-Fi");
    });
  });

  describe("listTeamsTopics", () => {
    it("should list teams topics for import", async () => {
      (prisma.topic.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "topic-1",
          name: "Debate Topic",
          description: "About AI",
          createdAt: new Date(),
          _count: { messages: 20, aiMembers: 3 },
        },
      ]);

      const result = await service.listTeamsTopics("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("teams");
      expect(result[0].metadata?.pageCount).toBe(20);
    });
  });

  describe("listLibraryResources", () => {
    it("should list library resources for import", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "res-1",
          title: "Image 1",
          abstract: "A photo",
          thumbnailUrl: "https://example.com/thumb.jpg",
          type: "IMAGE",
          createdAt: new Date(),
        },
      ]);

      const result = await service.listLibraryResources("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("library");
    });

    it("should filter by type when provided", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValueOnce([]);

      await service.listLibraryResources("user-1", "IMAGE");

      expect(prisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: "IMAGE" },
        }),
      );
    });
  });
});
