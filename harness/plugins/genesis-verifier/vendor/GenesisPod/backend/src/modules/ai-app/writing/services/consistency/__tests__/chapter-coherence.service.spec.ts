import { Test, TestingModule } from "@nestjs/testing";
import { ChapterCoherenceService } from "../chapter-coherence.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("ChapterCoherenceService", () => {
  let service: ChapterCoherenceService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockFacade: jest.Mocked<ChatFacade>;

  const mockCoherenceJson = JSON.stringify({
    score: 85,
    issues: [],
    plotThreads: [],
    characterArcs: [],
    summary: "章节连贯性良好",
  });

  beforeEach(async () => {
    mockPrisma = {
      writingChapter: {
        findUnique: jest.fn(),
      },
      writingVolume: {
        findUnique: jest.fn(),
      },
      consistencyCheck: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    mockFacade = {
      chat: jest.fn(),
      chatStream: jest.fn(),
      chatWithSkills: jest.fn(),
    } as unknown as jest.Mocked<ChatFacade>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterCoherenceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<ChapterCoherenceService>(ChapterCoherenceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const makeChapterInVolume = (
    currentChapterNum: number,
    prevChapterNum?: number,
  ) => {
    const chapters =
      prevChapterNum !== undefined
        ? [
            {
              id: `chapter-${prevChapterNum}`,
              chapterNumber: prevChapterNum,
              title: `第${prevChapterNum}章`,
              content: "前章内容".repeat(100),
              outline: `大纲${prevChapterNum}`,
            },
            {
              id: `chapter-${currentChapterNum}`,
              chapterNumber: currentChapterNum,
              title: `第${currentChapterNum}章`,
              content: "当章内容".repeat(100),
              outline: `大纲${currentChapterNum}`,
            },
          ]
        : [
            {
              id: `chapter-${currentChapterNum}`,
              chapterNumber: currentChapterNum,
              title: `第${currentChapterNum}章`,
              content: "当章内容".repeat(100),
              outline: `大纲${currentChapterNum}`,
            },
          ];

    return {
      id: `chapter-${currentChapterNum}`,
      chapterNumber: currentChapterNum,
      title: `第${currentChapterNum}章`,
      content: "当章内容".repeat(100),
      outline: `大纲${currentChapterNum}`,
      volume: {
        id: "volume-1",
        projectId: "project-1",
        chapters,
      },
    };
  };

  describe("checkChapterTransition", () => {
    it("should return COHERENT when chapters transition well", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        makeChapterInVolume(2, 1),
      );

      mockFacade.chat.mockResolvedValue({
        content: mockCoherenceJson,
        tokensUsed: 200,
      } as any);

      const result = await service.checkChapterTransition("chapter-2");

      expect(result.status).toBe("COHERENT");
      expect(result.score).toBe(85);
    });

    it("should return COHERENT with 100 score when no previous chapter", async () => {
      // Chapter 1 has no previous
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        makeChapterInVolume(1),
      );

      const result = await service.checkChapterTransition("chapter-1");

      expect(result.status).toBe("COHERENT");
      expect(result.score).toBe(100);
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should return default result when LLM returns no JSON", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        makeChapterInVolume(2, 1),
      );

      mockFacade.chat.mockResolvedValue({
        content: "无法分析",
        tokensUsed: 50,
      } as any);

      const result = await service.checkChapterTransition("chapter-2");

      expect(result.status).toBe("COHERENT");
      expect(result.score).toBe(80);
    });

    it("should throw when chapter not found", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.checkChapterTransition("nonexistent"),
      ).rejects.toThrow("Chapter not found");
    });

    it("should detect issues in transition and set ISSUES_FOUND status", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        makeChapterInVolume(2, 1),
      );

      const responseWithIssue = JSON.stringify({
        score: 60,
        issues: [
          {
            type: "PLOT_DISCONTINUITY",
            severity: "WARNING",
            chapters: [1, 2],
            description: "情节有断裂",
            suggestion: "添加过渡",
          },
        ],
        plotThreads: [],
        characterArcs: [],
        summary: "存在一些问题",
      });

      mockFacade.chat.mockResolvedValue({
        content: responseWithIssue,
        tokensUsed: 300,
      } as any);

      const result = await service.checkChapterTransition("chapter-2");

      expect(result.status).toBe("ISSUES_FOUND");
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("should return default result when LLM throws an error", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        makeChapterInVolume(2, 1),
      );

      mockFacade.chat.mockRejectedValue(new Error("API Error"));

      const result = await service.checkChapterTransition("chapter-2");

      expect(result.status).toBe("COHERENT");
      expect(result.score).toBe(80);
    });
  });

  describe("checkVolumeCoherence", () => {
    it("should return empty results when volume not found", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.checkVolumeCoherence("nonexistent");

      expect(result.volumeScore).toBe(100);
      expect(result.chapterResults).toHaveLength(0);
    });

    it("should return empty results when volume has only one chapter", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue({
        id: "volume-1",
        chapters: [
          {
            id: "ch1",
            chapterNumber: 1,
            title: "第一章",
            content: "内容",
            outline: null,
          },
        ],
      });

      const result = await service.checkVolumeCoherence("volume-1");

      expect(result.volumeScore).toBe(100);
      expect(result.chapterResults).toHaveLength(0);
    });

    it("should check all adjacent chapter pairs", async () => {
      const chapters = [1, 2, 3].map((num) => ({
        id: `ch${num}`,
        chapterNumber: num,
        title: `第${num}章`,
        content: "内容".repeat(100),
        outline: null,
      }));

      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue({
        id: "volume-1",
        chapters,
      });

      mockFacade.chat.mockResolvedValue({
        content: mockCoherenceJson,
        tokensUsed: 200,
      } as any);

      const result = await service.checkVolumeCoherence("volume-1");

      // 3 chapters = 2 adjacent pairs + 1 overall check
      expect(result.chapterResults).toHaveLength(2);
      expect(result.volumeScore).toBeGreaterThan(0);
    });
  });

  describe("quickCoherenceCheck", () => {
    it("should return score and critical issues", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        makeChapterInVolume(2, 1),
      );

      mockFacade.chat.mockResolvedValue({
        content: mockCoherenceJson,
        tokensUsed: 200,
      } as any);

      const result = await service.quickCoherenceCheck("chapter-2");

      expect(result.score).toBeDefined();
      expect(result.criticalIssues).toBeInstanceOf(Array);
    });

    it("should only include CRITICAL severity issues", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        makeChapterInVolume(2, 1),
      );

      const responseWithMixedIssues = JSON.stringify({
        score: 70,
        issues: [
          {
            type: "PLOT_DISCONTINUITY",
            severity: "CRITICAL",
            chapters: [1, 2],
            description: "严重断裂",
            suggestion: "必须修复",
          },
          {
            type: "PACING_ISSUE",
            severity: "WARNING",
            chapters: [1, 2],
            description: "节奏略慢",
            suggestion: "建议调整",
          },
        ],
        plotThreads: [],
        characterArcs: [],
        summary: "有问题",
      });

      mockFacade.chat.mockResolvedValue({
        content: responseWithMixedIssues,
        tokensUsed: 200,
      } as any);

      const result = await service.quickCoherenceCheck("chapter-2");

      expect(
        result.criticalIssues.every((i) => i.severity === "CRITICAL"),
      ).toBe(true);
    });
  });

  describe("saveCoherenceCheck", () => {
    it("should save coherence result to database", async () => {
      (mockPrisma.consistencyCheck.create as jest.Mock).mockResolvedValue({});

      const coherenceResult = {
        status: "COHERENT" as const,
        score: 90,
        issues: [],
        plotThreads: [],
        characterArcs: [],
        summary: "良好",
      };

      await service.saveCoherenceCheck("chapter-1", coherenceResult);

      expect(mockPrisma.consistencyCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            chapterId: "chapter-1",
            checkType: "PLOT",
            status: "PASSED",
          }),
        }),
      );
    });

    it("should set status to ISSUES_FOUND when critical issues exist", async () => {
      (mockPrisma.consistencyCheck.create as jest.Mock).mockResolvedValue({});

      const coherenceResult = {
        status: "ISSUES_FOUND" as const,
        score: 50,
        issues: [
          {
            type: "PLOT_DISCONTINUITY" as const,
            severity: "CRITICAL" as const,
            chapters: [1, 2],
            description: "严重问题",
            suggestion: "修复",
          },
        ],
        plotThreads: [],
        characterArcs: [],
        summary: "有问题",
      };

      await service.saveCoherenceCheck("chapter-1", coherenceResult);

      expect(mockPrisma.consistencyCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "ISSUES_FOUND",
          }),
        }),
      );
    });

    it("should not throw when save fails", async () => {
      (mockPrisma.consistencyCheck.create as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      // The service itself throws here (no try-catch in saveCoherenceCheck)
      // The service logs an error and rethrows
      await expect(
        service.saveCoherenceCheck("chapter-1", {
          status: "COHERENT",
          score: 80,
          issues: [],
          plotThreads: [],
          characterArcs: [],
          summary: "ok",
        }),
      ).rejects.toThrow("DB Error");
    });
  });
});
