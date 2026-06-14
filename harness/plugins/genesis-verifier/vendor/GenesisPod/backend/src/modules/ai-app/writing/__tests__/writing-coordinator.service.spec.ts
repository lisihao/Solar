/**
 * WritingCoordinatorService 单元测试
 *
 * 测试 Writing Coordinator 核心协调功能：
 * - createProject() 创建项目
 * - getProjects() 获取项目列表
 * - startMission() 启动写作任务
 * - getMissionStatus() 获取任务状态
 * - checkConsistency() 一致性检查
 * - createCharacter() 创建角色
 * - getHierarchicalSummaries() 层级摘要
 * - getAnalysisDashboard() 分析仪表板
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { WritingCoordinatorService } from "../writing-coordinator.service";
import { ProjectService } from "../services/writing/project.service";
import { StoryBibleService } from "../services/bible/story-bible.service";
import { CharacterService } from "../services/bible/character.service";
import { ChapterWritingService } from "../services/writing/chapter-writing.service";
import { ChapterRevisionService } from "../services/writing/chapter-revision.service";
import { ChapterAnnotationService } from "../services/writing/chapter-annotation.service";
import { ChapterImportService } from "../services/writing/chapter-import.service";
import { ConsistencyEngineService } from "../services/consistency/consistency-engine.service";
import { ParallelOrchestratorService } from "../services/parallel/parallel-orchestrator.service";
// WritingMissionService removed - replaced by WritingMissionLifecycleService + WritingMissionQueryService
import { StoryCompletionDetectorService } from "../services/quality/story-completion-detector.service";
import { TemporalConflictAnalyzerService } from "../services/consistency/temporal-conflict-analyzer.service";
import { HierarchicalSummaryService } from "../services/writing/hierarchical-summary.service";
import { SharedScratchpadService } from "../services/mission/shared-scratchpad.service";
import { WritingMissionLifecycleService } from "../services/mission/writing-mission-lifecycle.service";
import { WritingMissionQueryService } from "../services/mission/writing-mission-query.service";
import { WritingTextProcessorService } from "../services/mission/writing-text-processor.service";

describe("WritingCoordinatorService", () => {
  let service: WritingCoordinatorService;
  let mockProjectService: any;
  let mockStoryBibleService: any;
  let mockCharacterService: any;
  let mockChapterWritingService: any;
  let mockChapterRevisionService: any;
  let mockChapterAnnotationService: any;
  let mockChapterImportService: any;
  let mockConsistencyEngine: any;
  let mockParallelOrchestrator: any;
  let mockStoryCompletionDetector: any;
  let mockTemporalConflictAnalyzer: any;
  let mockHierarchicalSummaryService: any;
  let mockSharedScratchpadService: any;
  let mockMissionLifecycle: any;
  let mockMissionQuery: any;

  const userId = "user-123";
  const projectId = "project-456";
  const missionId = "mission-789";
  const chapterId = "chapter-101";
  const characterId = "char-001";

  const mockProject = {
    id: projectId,
    name: "My Novel",
    description: "A great story",
    ownerId: userId,
    status: "IN_PROGRESS",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCharacter = {
    id: characterId,
    name: "John Doe",
    role: "protagonist",
    description: "Main character",
    projectId,
  };

  const _mockMission = {
    id: missionId,
    projectId,
    status: "running",
    missionType: "chapter",
  };

  beforeEach(async () => {
    // Mock all dependencies
    mockProjectService = {
      create: jest.fn().mockResolvedValue(mockProject),
      findAll: jest.fn().mockResolvedValue([mockProject]),
      findOne: jest.fn().mockResolvedValue(mockProject),
      findPublic: jest.fn().mockResolvedValue(mockProject),
      update: jest.fn().mockResolvedValue({ ...mockProject, name: "Updated" }),
      delete: jest.fn().mockResolvedValue(mockProject),
      createVolume: jest.fn(),
      getVolumes: jest.fn().mockResolvedValue([]),
      resetChaptersByNumbers: jest.fn().mockResolvedValue({ success: true }),
      findChapterByNumber: jest.fn(),
    };

    mockStoryBibleService = {
      getByProject: jest.fn().mockResolvedValue({
        id: "bible-1",
        projectId,
        premise: "Test premise",
      }),
      update: jest.fn().mockResolvedValue({
        id: "bible-1",
        premise: "Updated premise",
      }),
    };

    mockCharacterService = {
      create: jest.fn().mockResolvedValue(mockCharacter),
      findAll: jest.fn().mockResolvedValue([mockCharacter]),
      findOne: jest.fn().mockResolvedValue(mockCharacter),
      update: jest.fn().mockResolvedValue(mockCharacter),
      delete: jest.fn().mockResolvedValue(mockCharacter),
      getRelationshipGraph: jest.fn().mockResolvedValue({
        nodes: [mockCharacter],
        edges: [],
      }),
      addRelationship: jest.fn(),
      deleteRelationship: jest.fn(),
    };

    mockChapterWritingService = {
      createChapter: jest.fn(),
      getChapters: jest.fn().mockResolvedValue([]),
      getChapter: jest.fn().mockResolvedValue({
        id: chapterId,
        content: "Chapter content",
        chapterNumber: 1,
        volumeId: "vol-1",
        volume: { project: { id: projectId } },
      }),
      updateChapter: jest.fn(),
      startWriting: jest.fn().mockResolvedValue({
        success: true,
        message: "Writing started",
      }),
    };

    mockChapterRevisionService = {
      getRevisions: jest.fn().mockResolvedValue([]),
      updateContent: jest.fn(),
      aiEdit: jest.fn(),
      compareRevisions: jest.fn(),
      rollback: jest.fn(),
    };

    mockChapterAnnotationService = {
      getAnnotations: jest.fn().mockResolvedValue([]),
      createAnnotation: jest.fn(),
      updateAnnotation: jest.fn(),
      deleteAnnotation: jest.fn(),
      resolveAnnotations: jest.fn(),
    };

    mockChapterImportService = {
      parseImport: jest.fn(),
      confirmImport: jest.fn(),
      getImportStatus: jest.fn(),
      getImportHistory: jest.fn().mockResolvedValue([]),
      cancelImport: jest.fn(),
    };

    mockConsistencyEngine = {
      validateChapter: jest.fn().mockResolvedValue({
        isValid: true,
        violations: [],
      }),
      getProjectReport: jest.fn().mockResolvedValue({
        projectId,
        totalViolations: 0,
      }),
    };

    mockParallelOrchestrator = {
      orchestrateParallelWriting: jest.fn().mockResolvedValue({
        success: true,
        chaptersStarted: 3,
      }),
    };

    mockStoryCompletionDetector = {
      analyzeCompletion: jest.fn().mockResolvedValue({
        completionScore: 0.85,
        missingElements: [],
      }),
    };

    mockTemporalConflictAnalyzer = {
      analyzeProject: jest.fn().mockResolvedValue({
        conflicts: [],
      }),
      analyzeChapter: jest.fn().mockResolvedValue({
        conflicts: [],
      }),
    };

    mockHierarchicalSummaryService = {
      getHierarchicalContext: jest.fn().mockResolvedValue({
        summaries: [],
        totalTokens: 1000,
      }),
      formatContextForPrompt: jest.fn().mockReturnValue("Formatted context"),
      batchUpdateSummaries: jest.fn().mockResolvedValue({ updated: 5 }),
    };

    mockSharedScratchpadService = {
      getEntries: jest.fn().mockResolvedValue([
        {
          id: "entry-1",
          type: "thought",
          content: "Planning chapter",
          timestamp: new Date(),
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingCoordinatorService,
        { provide: ProjectService, useValue: mockProjectService },
        { provide: StoryBibleService, useValue: mockStoryBibleService },
        { provide: CharacterService, useValue: mockCharacterService },
        {
          provide: ChapterWritingService,
          useValue: mockChapterWritingService,
        },
        {
          provide: ChapterRevisionService,
          useValue: mockChapterRevisionService,
        },
        {
          provide: ChapterAnnotationService,
          useValue: mockChapterAnnotationService,
        },
        { provide: ChapterImportService, useValue: mockChapterImportService },
        { provide: ConsistencyEngineService, useValue: mockConsistencyEngine },
        {
          provide: ParallelOrchestratorService,
          useValue: mockParallelOrchestrator,
        },
        {
          provide: StoryCompletionDetectorService,
          useValue: mockStoryCompletionDetector,
        },
        {
          provide: TemporalConflictAnalyzerService,
          useValue: mockTemporalConflictAnalyzer,
        },
        {
          provide: HierarchicalSummaryService,
          useValue: mockHierarchicalSummaryService,
        },
        {
          provide: SharedScratchpadService,
          useValue: mockSharedScratchpadService,
        },
        {
          provide: WritingMissionLifecycleService,
          useFactory: () => {
            mockMissionLifecycle = {
              startMissionAsync: jest
                .fn()
                .mockResolvedValue({ missionId: "mission-789" }),
              cancelMission: jest.fn().mockResolvedValue({ success: true }),
              forceCleanupStuckMissions: jest
                .fn()
                .mockResolvedValue({ success: true, cleanedCount: 0 }),
              reExtractChapterTitles: jest
                .fn()
                .mockResolvedValue({ updated: 0, chapters: [] }),
            };
            return mockMissionLifecycle;
          },
        },
        {
          provide: WritingMissionQueryService,
          useFactory: () => {
            mockMissionQuery = {
              getMissionStatus: jest
                .fn()
                .mockResolvedValue({ id: "m1", status: "COMPLETED" }),
              getProjectMissions: jest
                .fn()
                .mockResolvedValue({ items: [], total: 0 }),
              getMissionLogs: jest
                .fn()
                .mockResolvedValue({ items: [], total: 0 }),
              getLatestMission: jest.fn().mockResolvedValue({
                id: "mission-1",
                status: "COMPLETED",
                missionType: "CHAPTER",
                createdAt: new Date(),
              }),
            };
            return mockMissionQuery;
          },
        },
        {
          provide: WritingTextProcessorService,
          useValue: {
            extractChapterTitle: jest.fn().mockReturnValue("Chapter Title"),
            countWords: jest.fn().mockReturnValue(3000),
          },
        },
      ],
    }).compile();

    service = module.get<WritingCoordinatorService>(WritingCoordinatorService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Project Management
  // =========================================================================

  describe("createProject", () => {
    it("should create a new project", async () => {
      const dto = {
        name: "My Novel",
        description: "A great story",
        genre: "fantasy" as const,
      };

      const result = await service.createProject(userId, dto);

      expect(result).toEqual(mockProject);
      expect(mockProjectService.create).toHaveBeenCalledWith(userId, dto);
    });
  });

  describe("getProjects", () => {
    it("should return list of projects", async () => {
      const options = { status: "IN_PROGRESS", limit: 10 };

      const result = await service.getProjects(userId, options);

      expect(result).toEqual([mockProject]);
      expect(mockProjectService.findAll).toHaveBeenCalledWith(userId, options);
    });
  });

  describe("getProject", () => {
    it("should return a single project", async () => {
      const result = await service.getProject(projectId, userId);

      expect(result).toEqual(mockProject);
      expect(mockProjectService.findOne).toHaveBeenCalledWith(
        projectId,
        userId,
      );
    });
  });

  describe("updateProject", () => {
    it("should update project", async () => {
      const dto = { name: "Updated" };

      const result = await service.updateProject(projectId, userId, dto);

      expect(result.name).toBe("Updated");
      expect(mockProjectService.update).toHaveBeenCalledWith(
        projectId,
        userId,
        dto,
      );
    });
  });

  describe("deleteProject", () => {
    it("should delete project", async () => {
      const result = await service.deleteProject(projectId, userId);

      expect(result).toEqual(mockProject);
      expect(mockProjectService.delete).toHaveBeenCalledWith(projectId, userId);
    });
  });

  // =========================================================================
  // Story Bible
  // =========================================================================

  describe("getStoryBible", () => {
    it("should return story bible", async () => {
      const result = await service.getStoryBible(projectId, userId);

      expect(result).toHaveProperty("premise");
      expect(mockStoryBibleService.getByProject).toHaveBeenCalledWith(
        projectId,
        userId,
      );
    });
  });

  describe("updateStoryBible", () => {
    it("should update story bible", async () => {
      const dto = { premise: "Updated premise" };

      const result = await service.updateStoryBible(projectId, userId, dto);

      expect(result.premise).toBe("Updated premise");
      expect(mockStoryBibleService.update).toHaveBeenCalledWith(
        projectId,
        userId,
        dto,
      );
    });
  });

  // =========================================================================
  // Characters
  // =========================================================================

  describe("createCharacter", () => {
    it("should create a character", async () => {
      const dto = {
        name: "Jane Doe",
        role: "ANTAGONIST" as const,
        description: "Villain",
      };

      const result = await service.createCharacter(projectId, userId, dto);

      expect(result).toEqual(mockCharacter);
      expect(mockCharacterService.create).toHaveBeenCalledWith(
        projectId,
        userId,
        dto,
      );
    });
  });

  describe("getCharacters", () => {
    it("should return list of characters", async () => {
      const result = await service.getCharacters(projectId, userId);

      expect(result).toEqual([mockCharacter]);
      expect(mockCharacterService.findAll).toHaveBeenCalledWith(
        projectId,
        userId,
      );
    });
  });

  describe("getRelationshipGraph", () => {
    it("should return character relationship graph", async () => {
      const result = await service.getRelationshipGraph(projectId, userId);

      expect(result).toHaveProperty("nodes");
      expect(result).toHaveProperty("edges");
      expect(mockCharacterService.getRelationshipGraph).toHaveBeenCalledWith(
        projectId,
        userId,
      );
    });
  });

  // =========================================================================
  // Writing Missions
  // =========================================================================

  describe("startMission", () => {
    it("should start a writing mission", async () => {
      const dto = {
        prompt: "Write chapter 1",
        missionType: "chapter" as const,
        targetWordCount: 3000,
      };

      const result = await service.startMission(projectId, userId, dto);

      expect(result.success).toBe(true);
      expect(result.missionId).toBe(missionId);
      expect(mockMissionLifecycle.startMissionAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          missionType: "chapter",
          userPrompt: "Write chapter 1",
        }),
        userId,
      );
    });

    it("should find chapter by number if chapterNumber provided", async () => {
      mockProjectService.findChapterByNumber.mockResolvedValue({
        id: chapterId,
      });

      const dto = {
        prompt: "Write chapter 1",
        chapterNumber: 1,
      };

      await service.startMission(projectId, userId, dto);

      expect(mockProjectService.findChapterByNumber).toHaveBeenCalledWith(
        projectId,
        1,
      );
      expect(mockMissionLifecycle.startMissionAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterId,
        }),
        userId,
      );
    });
  });

  describe("getMissionStatus", () => {
    it("should return mission status", async () => {
      const result = await service.getMissionStatus(missionId, userId);

      expect(result.status).toBe("COMPLETED");
      expect(mockMissionQuery.getMissionStatus).toHaveBeenCalledWith(
        missionId,
        userId,
      );
    });
  });

  describe("cancelMission", () => {
    it("should cancel mission", async () => {
      const result = await service.cancelMission(missionId, userId);

      expect(result.success).toBe(true);
      expect(mockMissionLifecycle.cancelMission).toHaveBeenCalledWith(
        missionId,
        userId,
      );
    });
  });

  describe("getProjectMissions", () => {
    it("should verify ownership before getting missions", async () => {
      await service.getProjectMissions(projectId, userId);

      expect(mockProjectService.findOne).toHaveBeenCalledWith(
        projectId,
        userId,
      );
      expect(mockMissionQuery.getProjectMissions).toHaveBeenCalledWith(
        projectId,
        undefined,
      );
    });

    it("should filter missions by status", async () => {
      await service.getProjectMissions(projectId, userId, "running");

      expect(mockMissionQuery.getProjectMissions).toHaveBeenCalledWith(
        projectId,
        "running",
      );
    });
  });

  // =========================================================================
  // Consistency Checking
  // =========================================================================

  describe("checkConsistency", () => {
    it("should validate chapter consistency", async () => {
      const result = await service.checkConsistency(chapterId, userId);

      expect(result).toBeDefined();
      expect(mockConsistencyEngine.validateChapter).toHaveBeenCalledWith(
        chapterId,
        userId,
      );
    });
  });

  describe("getConsistencyReport", () => {
    it("should return project consistency report", async () => {
      const result = await service.getConsistencyReport(projectId, userId);

      expect(result).toBeDefined();
      expect(mockConsistencyEngine.getProjectReport).toHaveBeenCalledWith(
        projectId,
        userId,
      );
    });
  });

  // =========================================================================
  // Parallel Writing
  // =========================================================================

  describe("startParallelWriting", () => {
    it("should start parallel writing for volume", async () => {
      const volumeId = "vol-1";
      const dto = { maxParallel: 3 };

      const result = await service.startParallelWriting(volumeId, userId, dto);

      expect(result).toBeDefined();
      expect(
        mockParallelOrchestrator.orchestrateParallelWriting,
      ).toHaveBeenCalledWith(volumeId, userId, dto);
    });
  });

  // =========================================================================
  // Quality Analysis
  // =========================================================================

  describe("getCompletionAnalysis", () => {
    it("should verify ownership and analyze completion", async () => {
      const result = await service.getCompletionAnalysis(projectId, userId);

      expect(mockProjectService.findOne).toHaveBeenCalledWith(
        projectId,
        userId,
      );
      expect(
        mockStoryCompletionDetector.analyzeCompletion,
      ).toHaveBeenCalledWith(projectId);
      expect(result).toBeDefined();
    });
  });

  describe("getTimelineConflicts", () => {
    it("should verify ownership and analyze timeline conflicts", async () => {
      const result = await service.getTimelineConflicts(projectId, userId);

      expect(mockProjectService.findOne).toHaveBeenCalledWith(
        projectId,
        userId,
      );
      expect(mockTemporalConflictAnalyzer.analyzeProject).toHaveBeenCalledWith(
        projectId,
      );
      expect(result.conflicts).toEqual([]);
    });
  });

  describe("getChapterTimelineConflicts", () => {
    it("should analyze chapter timeline conflicts", async () => {
      await service.getChapterTimelineConflicts(chapterId, userId);

      expect(mockChapterWritingService.getChapter).toHaveBeenCalledWith(
        chapterId,
        userId,
      );
      expect(mockTemporalConflictAnalyzer.analyzeChapter).toHaveBeenCalledWith(
        projectId,
        1,
        "Chapter content",
      );
    });

    it("should return empty conflicts if chapter has no content", async () => {
      mockChapterWritingService.getChapter.mockResolvedValue({
        id: chapterId,
        content: null,
        chapterNumber: 1,
      });

      const result = await service.getChapterTimelineConflicts(
        chapterId,
        userId,
      );

      expect(result).toEqual({ conflicts: [] });
      expect(
        mockTemporalConflictAnalyzer.analyzeChapter,
      ).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Hierarchical Summaries
  // =========================================================================

  describe("getHierarchicalSummaries", () => {
    it("should verify ownership and get hierarchical context", async () => {
      const options = { currentChapter: 5, targetTokens: 3000 };

      const result = await service.getHierarchicalSummaries(
        projectId,
        userId,
        options,
      );

      expect(mockProjectService.findOne).toHaveBeenCalledWith(
        projectId,
        userId,
      );
      expect(
        mockHierarchicalSummaryService.getHierarchicalContext,
      ).toHaveBeenCalledWith(projectId, {
        currentChapter: 5,
        targetTokens: 3000,
      });
      expect(result).toHaveProperty("context");
      expect(result).toHaveProperty("formattedContext");
    });

    it("should use default values for options", async () => {
      await service.getHierarchicalSummaries(projectId, userId, {});

      expect(
        mockHierarchicalSummaryService.getHierarchicalContext,
      ).toHaveBeenCalledWith(projectId, {
        currentChapter: 999,
        targetTokens: 4000,
      });
    });
  });

  describe("generateSummaries", () => {
    it("should verify ownership and batch update summaries", async () => {
      const result = await service.generateSummaries(projectId, userId);

      expect(mockProjectService.findOne).toHaveBeenCalledWith(
        projectId,
        userId,
      );
      expect(
        mockHierarchicalSummaryService.batchUpdateSummaries,
      ).toHaveBeenCalledWith(projectId);
      expect(result).toEqual({ updated: 5 });
    });
  });

  // =========================================================================
  // Analysis Dashboard
  // =========================================================================

  describe("getAnalysisDashboard", () => {
    it("should return dashboard data with scratchpad entries", async () => {
      const result = await service.getAnalysisDashboard(projectId, userId);

      expect(result.project.id).toBe(projectId);
      expect(result.project.name).toBe("My Novel");
      expect(result.agentActivity.recentEntries).toHaveLength(1);
      expect(result).toHaveProperty("analyzedAt");
    });

    it("should handle project lookup failure", async () => {
      mockProjectService.findOne.mockRejectedValue(new Error("Not found"));

      const result = await service.getAnalysisDashboard(projectId, userId);

      expect(result.project.name).toBe("Unknown");
      expect(result.agentActivity.recentEntries).toEqual([]);
    });

    it("should handle scratchpad failure gracefully", async () => {
      mockMissionQuery.getLatestMission.mockRejectedValue(
        new Error("No mission"),
      );

      const result = await service.getAnalysisDashboard(projectId, userId);

      expect(result.agentActivity.totalEntries).toBe(0);
    });

    it("should return empty activity if no recent mission", async () => {
      mockMissionQuery.getLatestMission.mockResolvedValue(null);

      const result = await service.getAnalysisDashboard(projectId, userId);

      expect(result.agentActivity.recentEntries).toEqual([]);
      expect(result.agentActivity.totalEntries).toBe(0);
    });
  });
});
