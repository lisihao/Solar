/**
 * AiWritingController Unit Tests
 *
 * Tests the writing controller endpoints by mocking WritingCoordinatorService.
 * JwtAuthGuard is overridden to always allow access.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AiWritingController } from "../ai-writing.controller";
import { WritingCoordinatorService } from "../writing-coordinator.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";

// Helper: build a mock request with a user
function mockRequest(userId = "user-001") {
  return { user: { id: userId } };
}

describe("AiWritingController", () => {
  let controller: AiWritingController;
  let coordinator: jest.Mocked<WritingCoordinatorService>;

  const mockProject = {
    id: "proj-123",
    name: "Test Novel",
    userId: "user-001",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockChapter = {
    id: "ch-001",
    title: "Chapter 1",
    content: "Once upon a time...",
  };

  beforeEach(async () => {
    const mockCoordinatorService = {
      createProject: jest.fn().mockResolvedValue(mockProject),
      getProjects: jest.fn().mockResolvedValue([mockProject]),
      getProject: jest.fn().mockResolvedValue(mockProject),
      updateProject: jest.fn().mockResolvedValue(mockProject),
      deleteProject: jest.fn().mockResolvedValue({ deleted: true }),
      getStoryBible: jest
        .fn()
        .mockResolvedValue({ premise: "A story", theme: "Adventure" }),
      updateStoryBible: jest.fn().mockResolvedValue({ updated: true }),
      createCharacter: jest
        .fn()
        .mockResolvedValue({ id: "char-001", name: "Hero" }),
      getCharacters: jest
        .fn()
        .mockResolvedValue([{ id: "char-001", name: "Hero" }]),
      getCharacter: jest
        .fn()
        .mockResolvedValue({ id: "char-001", name: "Hero" }),
      updateCharacter: jest
        .fn()
        .mockResolvedValue({ id: "char-001", name: "Updated Hero" }),
      deleteCharacter: jest.fn().mockResolvedValue({ deleted: true }),
      getRelationshipGraph: jest
        .fn()
        .mockResolvedValue({ nodes: [], edges: [] }),
      addRelationship: jest.fn().mockResolvedValue({ id: "rel-001" }),
      deleteRelationship: jest.fn().mockResolvedValue({ deleted: true }),
      createVolume: jest
        .fn()
        .mockResolvedValue({ id: "vol-001", title: "Volume 1" }),
      getVolumes: jest.fn().mockResolvedValue([{ id: "vol-001" }]),
      createChapter: jest.fn().mockResolvedValue(mockChapter),
      getChapters: jest.fn().mockResolvedValue([mockChapter]),
      getChapter: jest.fn().mockResolvedValue(mockChapter),
      updateChapter: jest.fn().mockResolvedValue(mockChapter),
      startWriting: jest.fn().mockResolvedValue({ status: "started" }),
      startParallelWriting: jest.fn().mockResolvedValue({ status: "started" }),
      checkConsistency: jest.fn().mockResolvedValue({ issues: [] }),
      getConsistencyReport: jest.fn().mockResolvedValue({ report: [] }),
      startMission: jest.fn().mockResolvedValue({ missionId: "mission-001" }),
      getMissionStatus: jest.fn().mockResolvedValue({ status: "running" }),
      cancelMission: jest.fn().mockResolvedValue({ cancelled: true }),
      forceCleanupStuckMissions: jest.fn().mockResolvedValue({ cleaned: 2 }),
      getProjectMissions: jest.fn().mockResolvedValue([]),
      getMissionLogs: jest.fn().mockResolvedValue({ logs: [] }),
      getPublicProject: jest.fn().mockResolvedValue(mockProject),
      resetChaptersByNumbers: jest.fn().mockResolvedValue({ count: 2 }),
      reExtractChapterTitles: jest
        .fn()
        .mockResolvedValue({ updated: 3, chapters: [] }),
      getChapterRevisions: jest.fn().mockResolvedValue([]),
      updateChapterContent: jest.fn().mockResolvedValue(mockChapter),
      aiEditChapter: jest.fn().mockResolvedValue({ content: "Edited content" }),
      compareRevisions: jest.fn().mockResolvedValue({ diff: [] }),
      rollbackRevision: jest.fn().mockResolvedValue(mockChapter),
      getChapterAnnotations: jest.fn().mockResolvedValue([]),
      createAnnotation: jest.fn().mockResolvedValue({ id: "ann-001" }),
      updateAnnotation: jest.fn().mockResolvedValue({ id: "ann-001" }),
      deleteAnnotation: jest.fn().mockResolvedValue(undefined),
      resolveAnnotations: jest.fn().mockResolvedValue({ resolved: 1 }),
      parseImport: jest
        .fn()
        .mockResolvedValue({ importId: "import-001", chapters: [] }),
      confirmImport: jest.fn().mockResolvedValue({ imported: 3 }),
      getImportStatus: jest.fn().mockResolvedValue({ status: "completed" }),
      getImportHistory: jest.fn().mockResolvedValue([]),
      cancelImport: jest.fn().mockResolvedValue({ cancelled: true }),
      getCompletionAnalysis: jest
        .fn()
        .mockResolvedValue({ isComplete: false, score: 0.7 }),
      getTimelineConflicts: jest.fn().mockResolvedValue({ conflicts: [] }),
      getChapterTimelineConflicts: jest
        .fn()
        .mockResolvedValue({ conflicts: [] }),
      getHierarchicalSummaries: jest.fn().mockResolvedValue({
        context: { chapters: [] },
        formattedContext: "Summary context",
      }),
      generateSummaries: jest.fn().mockResolvedValue(5),
      getScratchpad: jest
        .fn()
        .mockResolvedValue({ entries: [], totalEntries: 0 }),
      getAnalysisDashboard: jest.fn().mockResolvedValue({
        project: { name: "Test Novel" },
        agentActivity: [],
        analyzedAt: new Date().toISOString(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [AiWritingController],
      providers: [
        {
          provide: WritingCoordinatorService,
          useValue: mockCoordinatorService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiWritingController>(AiWritingController);
    coordinator = module.get(WritingCoordinatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Style Presets ====================

  describe("getStylePresets", () => {
    it("should return style presets", () => {
      const result = controller.getStylePresets();
      expect(result).toHaveProperty("presets");
      expect(Array.isArray(result.presets)).toBe(true);
    });
  });

  describe("getRecommendedStyles", () => {
    it("should return recommended styles for a genre", () => {
      const result = controller.getRecommendedStyles("fantasy");
      expect(result).toHaveProperty("genre", "fantasy");
      expect(result).toHaveProperty("recommended");
      expect(result).toHaveProperty("all");
    });

    it("should handle empty genre gracefully", () => {
      const result = controller.getRecommendedStyles("");
      expect(result).toHaveProperty("genre", "");
    });
  });

  // ==================== Project CRUD ====================

  describe("createProject", () => {
    it("should create a project", async () => {
      const dto = { title: "My Novel", genre: "fantasy" };
      const result = await controller.createProject(
        mockRequest() as Parameters<typeof controller.createProject>[0],
        dto as Parameters<typeof controller.createProject>[1],
      );
      expect(result).toEqual(mockProject);
      expect(coordinator.createProject).toHaveBeenCalledWith("user-001", dto);
    });
  });

  describe("getProjects", () => {
    it("should return projects for the user", async () => {
      const result = await controller.getProjects(
        mockRequest() as Parameters<typeof controller.getProjects>[0],
      );
      expect(Array.isArray(result)).toBe(true);
      expect(coordinator.getProjects).toHaveBeenCalledWith("user-001", {
        status: undefined,
        limit: undefined,
        cursor: undefined,
      });
    });

    it("should pass pagination params", async () => {
      await controller.getProjects(
        mockRequest() as Parameters<typeof controller.getProjects>[0],
        "active",
        "10",
        "cursor-xyz",
      );
      expect(coordinator.getProjects).toHaveBeenCalledWith("user-001", {
        status: "active",
        limit: 10,
        cursor: "cursor-xyz",
      });
    });
  });

  describe("getProject", () => {
    it("should return a project by id", async () => {
      const result = await controller.getProject(
        mockRequest() as Parameters<typeof controller.getProject>[0],
        "proj-123",
      );
      expect(result).toEqual(mockProject);
      expect(coordinator.getProject).toHaveBeenCalledWith(
        "proj-123",
        "user-001",
      );
    });
  });

  describe("updateProject", () => {
    it("should update a project", async () => {
      const dto = { name: "Updated Novel" };
      const result = await controller.updateProject(
        mockRequest() as Parameters<typeof controller.updateProject>[0],
        "proj-123",
        dto as Parameters<typeof controller.updateProject>[2],
      );
      expect(result).toEqual(mockProject);
      expect(coordinator.updateProject).toHaveBeenCalledWith(
        "proj-123",
        "user-001",
        dto,
      );
    });
  });

  describe("deleteProject", () => {
    it("should delete a project", async () => {
      const result = await controller.deleteProject(
        mockRequest() as Parameters<typeof controller.deleteProject>[0],
        "proj-123",
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  // ==================== Characters ====================

  describe("createCharacter", () => {
    it("should create a character", async () => {
      const dto = { name: "Hero", role: "protagonist" };
      const result = await controller.createCharacter(
        mockRequest() as Parameters<typeof controller.createCharacter>[0],
        "proj-123",
        dto as Parameters<typeof controller.createCharacter>[2],
      );
      expect(result).toHaveProperty("name", "Hero");
    });
  });

  describe("getCharacters", () => {
    it("should return characters for a project", async () => {
      const result = await controller.getCharacters(
        mockRequest() as Parameters<typeof controller.getCharacters>[0],
        "proj-123",
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ==================== Chapters ====================

  describe("getChapter", () => {
    it("should return a chapter by id", async () => {
      const result = await controller.getChapter(
        mockRequest() as Parameters<typeof controller.getChapter>[0],
        "ch-001",
      );
      expect(result).toEqual(mockChapter);
    });
  });

  describe("startWriting", () => {
    it("should start writing for a chapter", async () => {
      const dto = { stylePreset: "literary" };
      const result = await controller.startWriting(
        mockRequest() as Parameters<typeof controller.startWriting>[0],
        "ch-001",
        dto as Parameters<typeof controller.startWriting>[2],
      );
      expect(result).toEqual({ status: "started" });
      expect(coordinator.startWriting).toHaveBeenCalledWith(
        "ch-001",
        "user-001",
        dto,
      );
    });
  });

  // ==================== Missions ====================

  describe("startMission", () => {
    it("should start an AI writing mission", async () => {
      const dto = {
        prompt: "Write an epic fantasy novel",
        missionType: "full_story" as const,
        targetWordCount: 50000,
      };
      const result = await controller.startMission(
        mockRequest() as Parameters<typeof controller.startMission>[0],
        "proj-123",
        dto,
      );
      expect(result).toEqual({ missionId: "mission-001" });
      expect(coordinator.startMission).toHaveBeenCalledWith(
        "proj-123",
        "user-001",
        dto,
      );
    });
  });

  describe("getMissionStatus", () => {
    it("should return mission status", async () => {
      const result = await controller.getMissionStatus(
        mockRequest() as Parameters<typeof controller.getMissionStatus>[0],
        "mission-001",
      );
      expect(result).toEqual({ status: "running" });
    });
  });

  describe("cancelMission", () => {
    it("should cancel a mission", async () => {
      const result = await controller.cancelMission(
        mockRequest() as Parameters<typeof controller.cancelMission>[0],
        "mission-001",
      );
      expect(result).toEqual({ cancelled: true });
    });
  });

  // ==================== Public API ====================

  describe("getPublicProject", () => {
    it("should return a public project", async () => {
      const result = await controller.getPublicProject("proj-123");
      expect(result).toEqual(mockProject);
    });

    it("should throw NotFoundException for non-existent public project", async () => {
      coordinator.getPublicProject.mockResolvedValue(
        null as unknown as typeof mockProject,
      );

      await expect(controller.getPublicProject("unknown-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== Admin Actions ====================

  describe("resetChapterContent", () => {
    it("should reset chapters and return count", async () => {
      const result = await controller.resetChapterContent(
        mockRequest() as Parameters<typeof controller.resetChapterContent>[0],
        "proj-123",
        { chapterNumbers: [1, 2] },
      );
      expect(result.success).toBe(true);
      expect(result.resetCount).toBe(2);
    });
  });

  describe("fixChapterTitles", () => {
    it("should re-extract chapter titles", async () => {
      const result = await controller.fixChapterTitles(
        mockRequest() as Parameters<typeof controller.fixChapterTitles>[0],
        "proj-123",
      );
      expect(result.success).toBe(true);
      expect(result.updated).toBe(3);
    });
  });

  // ==================== DOME/SCORE Features ====================

  describe("getCompletionAnalysis", () => {
    it("should return completion analysis with projectId", async () => {
      const result = await controller.getCompletionAnalysis(
        mockRequest() as Parameters<typeof controller.getCompletionAnalysis>[0],
        "proj-123",
      );
      expect(result.projectId).toBe("proj-123");
      expect(result.analysis).toBeDefined();
      expect(result.analyzedAt).toBeDefined();
    });
  });

  describe("getTimelineConflicts", () => {
    it("should return timeline conflicts (empty)", async () => {
      const result = await controller.getTimelineConflicts(
        mockRequest() as Parameters<typeof controller.getTimelineConflicts>[0],
        "proj-123",
      );
      expect(result.projectId).toBe("proj-123");
      expect(result.conflicts).toEqual([]);
      expect(result.totalConflicts).toBe(0);
    });

    it("should map severity CRITICAL -> HIGH", async () => {
      coordinator.getTimelineConflicts.mockResolvedValue({
        conflicts: [
          {
            chapter1: 1,
            chapter2: 2,
            entity: "Hero",
            type: "location",
            severity: "CRITICAL",
            description: "Location mismatch",
            expected: "Castle",
            found: "Village",
            suggestion: "Fix chapter 2",
          },
        ],
      });

      const result = await controller.getTimelineConflicts(
        mockRequest() as Parameters<typeof controller.getTimelineConflicts>[0],
        "proj-123",
      );
      expect(result.conflicts[0].severity).toBe("HIGH");
    });

    it("should map severity WARNING -> MEDIUM", async () => {
      coordinator.getTimelineConflicts.mockResolvedValue({
        conflicts: [
          {
            chapter1: 1,
            chapter2: 3,
            entity: "Date",
            type: "time",
            severity: "WARNING",
            description: "Date discrepancy",
            expected: "Monday",
            found: "Friday",
            suggestion: "Align dates",
          },
        ],
      });

      const result = await controller.getTimelineConflicts(
        mockRequest() as Parameters<typeof controller.getTimelineConflicts>[0],
        "proj-123",
      );
      expect(result.conflicts[0].severity).toBe("MEDIUM");
    });

    it("should map unknown severity -> LOW", async () => {
      coordinator.getTimelineConflicts.mockResolvedValue({
        conflicts: [
          {
            chapter1: 1,
            chapter2: 4,
            entity: "Detail",
            type: "minor",
            severity: "INFO",
            description: "Minor inconsistency",
            expected: "A",
            found: "B",
            suggestion: "Check",
          },
        ],
      });

      const result = await controller.getTimelineConflicts(
        mockRequest() as Parameters<typeof controller.getTimelineConflicts>[0],
        "proj-123",
      );
      expect(result.conflicts[0].severity).toBe("LOW");
    });
  });

  describe("getChapterTimelineConflicts", () => {
    it("should return empty conflicts for a chapter", async () => {
      const result = await controller.getChapterTimelineConflicts(
        mockRequest() as Parameters<
          typeof controller.getChapterTimelineConflicts
        >[0],
        "ch-001",
      );
      expect(result.chapterId).toBe("ch-001");
      expect(result.conflicts).toEqual([]);
    });
  });

  describe("getHierarchicalSummaries", () => {
    it("should return hierarchical summaries", async () => {
      const result = await controller.getHierarchicalSummaries(
        mockRequest() as Parameters<
          typeof controller.getHierarchicalSummaries
        >[0],
        "proj-123",
        "5",
        "2000",
      );
      expect(result.projectId).toBe("proj-123");
      expect(coordinator.getHierarchicalSummaries).toHaveBeenCalledWith(
        "proj-123",
        "user-001",
        {
          currentChapter: 5,
          targetTokens: 2000,
        },
      );
    });
  });

  describe("generateSummaries", () => {
    it("should generate summaries and return count", async () => {
      const result = await controller.generateSummaries(
        mockRequest() as Parameters<typeof controller.generateSummaries>[0],
        "proj-123",
      );
      expect(result.updatedCount).toBe(5);
      expect(result.projectId).toBe("proj-123");
    });
  });

  describe("getScratchpad", () => {
    it("should return scratchpad entries", async () => {
      const result = await controller.getScratchpad(
        mockRequest() as Parameters<typeof controller.getScratchpad>[0],
        "proj-123",
      );
      expect(result.projectId).toBe("proj-123");
      expect(result.entries).toEqual([]);
      expect(result.totalEntries).toBe(0);
    });
  });

  describe("getAnalysisDashboard", () => {
    it("should return analysis dashboard data", async () => {
      const result = await controller.getAnalysisDashboard(
        mockRequest() as Parameters<typeof controller.getAnalysisDashboard>[0],
        "proj-123",
      );
      expect(result.projectId).toBe("proj-123");
      expect(result.projectName).toBe("Test Novel");
      expect(result.completion).toBeNull();
      expect(result.conflicts).toBeDefined();
    });
  });

  // ==================== Chapter Annotations ====================

  describe("getChapterAnnotations", () => {
    it("should return annotations for a chapter", async () => {
      const result = await controller.getChapterAnnotations(
        mockRequest() as Parameters<typeof controller.getChapterAnnotations>[0],
        "ch-001",
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("createAnnotation", () => {
    it("should create an annotation", async () => {
      const dto = {
        startOffset: 0,
        endOffset: 10,
        content: "Good passage",
        type: "COMMENT" as const,
      };
      const result = await controller.createAnnotation(
        mockRequest() as Parameters<typeof controller.createAnnotation>[0],
        "ch-001",
        dto,
      );
      expect(result).toHaveProperty("id", "ann-001");
    });
  });

  describe("deleteAnnotation", () => {
    it("should delete annotation and return success message", async () => {
      const result = await controller.deleteAnnotation(
        mockRequest() as Parameters<typeof controller.deleteAnnotation>[0],
        "ch-001",
        "ann-001",
      );
      expect(result).toEqual({ message: "Annotation deleted successfully" });
    });
  });

  // ==================== Chapter Revision ====================

  describe("getChapterRevisions", () => {
    it("should return revision history", async () => {
      const result = await controller.getChapterRevisions(
        mockRequest() as Parameters<typeof controller.getChapterRevisions>[0],
        "ch-001",
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("updateChapterContent", () => {
    it("should update chapter content", async () => {
      const result = await controller.updateChapterContent(
        mockRequest() as Parameters<typeof controller.updateChapterContent>[0],
        "ch-001",
        { content: "New content" },
      );
      expect(result).toEqual(mockChapter);
    });
  });

  describe("rollbackRevision", () => {
    it("should rollback to a specific revision", async () => {
      const result = await controller.rollbackRevision(
        mockRequest() as Parameters<typeof controller.rollbackRevision>[0],
        "ch-001",
        "rev-001",
        { reason: "Content was better" },
      );
      expect(result).toEqual(mockChapter);
    });
  });
});
