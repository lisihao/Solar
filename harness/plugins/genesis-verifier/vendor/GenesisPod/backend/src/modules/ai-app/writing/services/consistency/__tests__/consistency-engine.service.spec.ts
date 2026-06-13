import { Test, TestingModule } from "@nestjs/testing";
import { ConsistencyEngineService } from "../consistency-engine.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { PostWriteValidationService } from "../post-write-validation.service";
import { ConflictResolutionService } from "../conflict-resolution.service";
import { ChapterCoherenceService } from "../chapter-coherence.service";
import { ContextBuilderService } from "../../writing/context-builder.service";

describe("ConsistencyEngineService", () => {
  let service: ConsistencyEngineService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockPostWriteValidation: jest.Mocked<PostWriteValidationService>;
  let mockConflictResolution: jest.Mocked<ConflictResolutionService>;
  let mockChapterCoherence: jest.Mocked<ChapterCoherenceService>;
  let mockContextBuilder: jest.Mocked<ContextBuilderService>;

  const mockChapterWithOwner = {
    id: "chapter-1",
    chapterNumber: 1,
    title: "第一章",
    content: "章节内容",
    volume: {
      id: "volume-1",
      project: { ownerId: "user-1" },
    },
  };

  const mockValidationReport = {
    status: "PASSED" as const,
    issues: [],
    suggestions: [],
  };

  const mockCoherenceResult = {
    status: "COHERENT" as const,
    score: 90,
    issues: [],
    plotThreads: [],
    characterArcs: [],
    summary: "连贯性良好",
  };

  beforeEach(async () => {
    mockPrisma = {
      writingChapter: {
        findUnique: jest.fn(),
      },
      writingVolume: {
        findUnique: jest.fn(),
      },
      writingProject: {
        findFirst: jest.fn(),
      },
      consistencyCheck: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as jest.Mocked<PrismaService>;

    mockPostWriteValidation = {
      validate: jest.fn().mockResolvedValue(mockValidationReport),
    } as unknown as jest.Mocked<PostWriteValidationService>;

    mockConflictResolution = {
      resolve: jest.fn().mockResolvedValue({ resolved: [], unresolved: [] }),
    } as unknown as jest.Mocked<ConflictResolutionService>;

    mockChapterCoherence = {
      checkChapterTransition: jest.fn().mockResolvedValue(mockCoherenceResult),
      checkVolumeCoherence: jest.fn().mockResolvedValue({
        volumeScore: 85,
        chapterResults: [],
        overallIssues: [],
        plotThreadsSummary: [],
      }),
      quickCoherenceCheck: jest.fn().mockResolvedValue({
        score: 85,
        criticalIssues: [],
      }),
      saveCoherenceCheck: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ChapterCoherenceService>;

    mockContextBuilder = {
      buildWritingContext: jest.fn().mockResolvedValue({
        projectId: "project-1",
        chapterNumber: 1,
        bible: {},
        characters: [],
      }),
    } as unknown as jest.Mocked<ContextBuilderService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsistencyEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: PostWriteValidationService,
          useValue: mockPostWriteValidation,
        },
        {
          provide: ConflictResolutionService,
          useValue: mockConflictResolution,
        },
        { provide: ChapterCoherenceService, useValue: mockChapterCoherence },
        { provide: ContextBuilderService, useValue: mockContextBuilder },
      ],
    }).compile();

    service = module.get<ConsistencyEngineService>(ConsistencyEngineService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("buildWritingContext", () => {
    it("should delegate to context builder service", async () => {
      const bibleSnapshot = { characters: [] };

      await service.buildWritingContext("chapter-1", bibleSnapshot);

      expect(mockContextBuilder.buildWritingContext).toHaveBeenCalledWith(
        "chapter-1",
        bibleSnapshot,
      );
    });

    it("should work without bible snapshot", async () => {
      await service.buildWritingContext("chapter-1");

      expect(mockContextBuilder.buildWritingContext).toHaveBeenCalledWith(
        "chapter-1",
        undefined,
      );
    });
  });

  describe("validateChapter", () => {
    it("should validate chapter content and return report", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        mockChapterWithOwner,
      );

      const result = await service.validateChapter("chapter-1", "user-1");

      expect(result.status).toBe("PASSED");
      expect(mockPostWriteValidation.validate).toHaveBeenCalledWith(
        "chapter-1",
        "章节内容",
      );
    });

    it("should save consistency check to database", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        mockChapterWithOwner,
      );

      await service.validateChapter("chapter-1", "user-1");

      expect(mockPrisma.consistencyCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            chapterId: "chapter-1",
            checkType: "CHARACTER",
          }),
        }),
      );
    });

    it("should throw when chapter not found", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.validateChapter("nonexistent", "user-1"),
      ).rejects.toThrow("Chapter not found or access denied");
    });

    it("should throw when user does not own the chapter", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        ...mockChapterWithOwner,
        volume: {
          id: "volume-1",
          project: { ownerId: "other-user" },
        },
      });

      await expect(
        service.validateChapter("chapter-1", "user-1"),
      ).rejects.toThrow("Chapter not found or access denied");
    });

    it("should skip validation when chapter has no content", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        ...mockChapterWithOwner,
        content: null,
      });

      const result = await service.validateChapter("chapter-1", "user-1");

      expect(result).toEqual({
        status: "SKIPPED",
        reason: "No content to validate",
      });
      expect(mockPostWriteValidation.validate).not.toHaveBeenCalled();
    });

    it("should set ISSUES_FOUND status when validation finds issues", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        mockChapterWithOwner,
      );

      mockPostWriteValidation.validate.mockResolvedValue({
        status: "ISSUES_FOUND",
        issues: [
          {
            type: "TERMINOLOGY",
            severity: "WARNING",
            description: "术语不一致",
            suggestion: "统一用词",
          },
        ],
        suggestions: ["统一斗气用法"],
      } as any);

      await service.validateChapter("chapter-1", "user-1");

      expect(mockPrisma.consistencyCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "ISSUES_FOUND",
          }),
        }),
      );
    });
  });

  describe("getProjectReport", () => {
    it("should return project consistency report", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue({
        id: "project-1",
        ownerId: "user-1",
      });

      (mockPrisma.consistencyCheck.findMany as jest.Mock).mockResolvedValue([
        {
          id: "check-1",
          status: "PASSED",
          chapterId: "chapter-1",
          chapter: { id: "chapter-1", title: "第一章", chapterNumber: 1 },
          checkedAt: new Date(),
        },
        {
          id: "check-2",
          status: "ISSUES_FOUND",
          chapterId: "chapter-2",
          chapter: { id: "chapter-2", title: "第二章", chapterNumber: 2 },
          checkedAt: new Date(),
        },
      ]);

      const result = await service.getProjectReport("project-1", "user-1");

      expect(result.projectId).toBe("project-1");
      expect(result.summary.total).toBe(2);
      expect(result.summary.passed).toBe(1);
      expect(result.summary.issuesFound).toBe(1);
    });

    it("should throw when project not found", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.getProjectReport("nonexistent", "user-1"),
      ).rejects.toThrow("Project not found");
    });

    it("should limit recent checks to 20", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue({
        id: "project-1",
        ownerId: "user-1",
      });

      const manyChecks = Array.from({ length: 30 }, (_, i) => ({
        id: `check-${i}`,
        status: "PASSED",
        chapterId: `chapter-${i}`,
        chapter: { id: `chapter-${i}`, title: `第${i}章`, chapterNumber: i },
        checkedAt: new Date(),
      }));

      (mockPrisma.consistencyCheck.findMany as jest.Mock).mockResolvedValue(
        manyChecks,
      );

      const result = await service.getProjectReport("project-1", "user-1");

      expect(result.recentChecks.length).toBeLessThanOrEqual(20);
    });
  });

  describe("resolveConflicts", () => {
    it("should delegate to conflict resolution service", async () => {
      const issues = [{ type: "TERMINOLOGY", description: "斗气用词不一致" }];

      await service.resolveConflicts("chapter-1", issues);

      expect(mockConflictResolution.resolve).toHaveBeenCalledWith(
        "chapter-1",
        issues,
      );
    });
  });

  describe("checkChapterCoherence", () => {
    it("should check coherence and save result", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        mockChapterWithOwner,
      );

      const result = await service.checkChapterCoherence("chapter-1", "user-1");

      expect(result.status).toBe("COHERENT");
      expect(mockChapterCoherence.checkChapterTransition).toHaveBeenCalledWith(
        "chapter-1",
      );
      expect(mockChapterCoherence.saveCoherenceCheck).toHaveBeenCalledWith(
        "chapter-1",
        mockCoherenceResult,
      );
    });

    it("should throw when chapter not found or access denied", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.checkChapterCoherence("nonexistent", "user-1"),
      ).rejects.toThrow("Chapter not found or access denied");
    });

    it("should throw when user does not own the chapter", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        ...mockChapterWithOwner,
        volume: {
          id: "volume-1",
          project: { ownerId: "wrong-user" },
        },
      });

      await expect(
        service.checkChapterCoherence("chapter-1", "user-1"),
      ).rejects.toThrow("Chapter not found or access denied");
    });
  });

  describe("checkVolumeCoherence", () => {
    it("should delegate to chapter coherence service", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue({
        id: "volume-1",
        project: { ownerId: "user-1" },
      });

      const result = await service.checkVolumeCoherence("volume-1", "user-1");

      expect(mockChapterCoherence.checkVolumeCoherence).toHaveBeenCalledWith(
        "volume-1",
      );
      expect(result.volumeScore).toBeDefined();
    });

    it("should throw when volume not found or access denied", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.checkVolumeCoherence("nonexistent", "user-1"),
      ).rejects.toThrow("Volume not found or access denied");
    });
  });

  describe("quickCoherenceCheck", () => {
    it("should delegate to chapter coherence service", async () => {
      const result = await service.quickCoherenceCheck("chapter-1");

      expect(mockChapterCoherence.quickCoherenceCheck).toHaveBeenCalledWith(
        "chapter-1",
      );
      expect(result.score).toBe(85);
      expect(result.criticalIssues).toHaveLength(0);
    });
  });
});
