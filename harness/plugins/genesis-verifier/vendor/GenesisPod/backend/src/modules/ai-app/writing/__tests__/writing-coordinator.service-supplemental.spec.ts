// ─── Module-level mocks (must be before any imports) ─────────────────────────
// Mock @prisma/client to provide enums that may not be available if Prisma
// schema hasn't been generated in this environment (e.g. AIModelType.CHAT_FAST).
jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient { $connect = jest.fn(); $disconnect = jest.fn(); $on = jest.fn(); }, AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    REASONING: "REASONING",
    EMBEDDING: "EMBEDDING",
    IMAGE: "IMAGE",
    IMAGE_GENERATION: "IMAGE_GENERATION",
    IMAGE_EDITING: "IMAGE_EDITING",
    MULTIMODAL: "MULTIMODAL",
    RERANK: "RERANK",
  },
  WritingMissionStatus: {
    PLANNING: "PLANNING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    PAUSED: "PAUSED",
  },
  MissionStatus: {
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    PAUSED: "PAUSED",
  },
  AgentTaskStatus: {
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    REVISION_NEEDED: "REVISION_NEEDED",
  },
  PrismaClient: class {
    $connect = jest.fn();
    $disconnect = jest.fn();
  },
}));
// Mock ai-harness/facade to prevent transitive imports from loading
// AIModelType.CHAT_FAST at module initialization time
jest.mock("@/modules/ai-harness/facade", () => ({
  AgentFacade: class {},
  AIFacade: class {},
  ChatFacade: class {},
  TeamFacade: class {},
  RAGFacade: class {},
  ProgressTrackerService: class {},
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  AgentFacade: class {},
  AIFacade: class {},
  ChatFacade: class {},
  TeamFacade: class {},
  RAGFacade: class {},
  ProgressTrackerService: class {},
  BaseAgent: class {},
  PlanBasedAgent: class {},
}));
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WritingCoordinatorService - Supplemental Tests
 *
 * Covers code paths not exercised by writing-coordinator.service.spec.ts:
 * - getPublicProject()
 * - resetChaptersByNumbers() – verifies ownership before reset
 * - createVolume() / getVolumes()
 * - createChapter() / getChapters() / getChapter() / updateChapter()
 * - startWriting()
 * - getChapterRevisions() / updateChapterContent() / aiEditChapter()
 * - compareRevisions() / rollbackRevision()
 * - getChapterAnnotations() / createAnnotation() / updateAnnotation()
 * - deleteAnnotation() / resolveAnnotations()
 * - parseImport() / confirmImport() / getImportStatus()
 * - getImportHistory() / cancelImport()
 * - forceCleanupStuckMissions()
 * - getMissionLogs()
 * - reExtractChapterTitles()
 * - getChapterAnnotations() with status filter
 * - startMission() with chapterNumber but chapter not found (chapterId stays undefined)
 * - getScratchpad() – no mission, with mission, error path
 * - addRelationship() / deleteRelationship()
 * - updateCharacter() / deleteCharacter() / getCharacter()
 * - getAnalysisDashboard() – mission found but no entries
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

describe("WritingCoordinatorService (supplemental)", () => {
  let service: WritingCoordinatorService;

  const userId = "user-sup-1";
  const projectId = "project-sup-1";
  const missionId = "mission-sup-1";
  const chapterId = "chapter-sup-1";
  const characterId = "char-sup-1";
  const volumeId = "vol-sup-1";
  const annotationId = "ann-sup-1";
  const revisionId = "rev-sup-1";
  const importId = "import-sup-1";

  const mockProject = {
    id: projectId,
    name: "Supplemental Novel",
    ownerId: userId,
    status: "IN_PROGRESS",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockChapter = {
    id: chapterId,
    title: "Chapter One",
    content: "Chapter content here",
    chapterNumber: 1,
    volumeId,
    volume: { project: { id: projectId } },
  };

  const mockMission = {
    id: missionId,
    projectId,
    status: "running",
    missionType: "chapter",
  };

  let mockProjectService: jest.Mocked<Partial<ProjectService>>;
  let mockStoryBibleService: jest.Mocked<Partial<StoryBibleService>>;
  let mockCharacterService: jest.Mocked<Partial<CharacterService>>;
  let mockChapterWritingService: jest.Mocked<Partial<ChapterWritingService>>;
  let mockChapterRevisionService: jest.Mocked<Partial<ChapterRevisionService>>;
  let mockChapterAnnotationService: jest.Mocked<
    Partial<ChapterAnnotationService>
  >;
  let mockChapterImportService: jest.Mocked<Partial<ChapterImportService>>;
  let mockConsistencyEngine: jest.Mocked<Partial<ConsistencyEngineService>>;
  let mockParallelOrchestrator: jest.Mocked<
    Partial<ParallelOrchestratorService>
  >;
  // mockWritingMissionService removed - startMissionAsync now on mockMissionLifecycle
  let mockStoryCompletionDetector: jest.Mocked<
    Partial<StoryCompletionDetectorService>
  >;
  let mockTemporalConflictAnalyzer: jest.Mocked<
    Partial<TemporalConflictAnalyzerService>
  >;
  let mockHierarchicalSummaryService: jest.Mocked<
    Partial<HierarchicalSummaryService>
  >;
  let mockSharedScratchpadService: jest.Mocked<
    Partial<SharedScratchpadService>
  >;
  let mockMissionLifecycle: Record<string, jest.Mock>;
  let mockMissionQuery: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockProjectService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn().mockResolvedValue(mockProject),
      findPublic: jest.fn().mockResolvedValue(mockProject),
      update: jest.fn(),
      delete: jest.fn(),
      createVolume: jest.fn().mockResolvedValue({ id: volumeId }),
      getVolumes: jest.fn().mockResolvedValue([{ id: volumeId }]),
      resetChaptersByNumbers: jest.fn().mockResolvedValue({ reset: 2 }),
      findChapterByNumber: jest.fn().mockResolvedValue(null),
    };

    mockStoryBibleService = {
      getByProject: jest.fn(),
      update: jest.fn(),
    };

    mockCharacterService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ id: characterId, name: "Alice" }),
      update: jest.fn().mockResolvedValue({ id: characterId, name: "Alice" }),
      delete: jest.fn().mockResolvedValue({ id: characterId }),
      getRelationshipGraph: jest.fn(),
      addRelationship: jest
        .fn()
        .mockResolvedValue({ id: "rel-1", type: "friend" }),
      deleteRelationship: jest.fn().mockResolvedValue({ id: "rel-1" }),
    };

    mockChapterWritingService = {
      createChapter: jest
        .fn()
        .mockResolvedValue({ id: chapterId, title: "New Chapter" }),
      getChapters: jest
        .fn()
        .mockResolvedValue([{ id: chapterId, title: "Chapter One" }]),
      getChapter: jest.fn().mockResolvedValue(mockChapter),
      updateChapter: jest
        .fn()
        .mockResolvedValue({ id: chapterId, title: "Updated" }),
      startWriting: jest
        .fn()
        .mockResolvedValue({ success: true, message: "Writing started" }),
    };

    mockChapterRevisionService = {
      getRevisions: jest.fn().mockResolvedValue([{ id: revisionId }]),
      updateContent: jest.fn().mockResolvedValue({ id: chapterId }),
      aiEdit: jest
        .fn()
        .mockResolvedValue({ success: true, newContent: "edited" }),
      compareRevisions: jest.fn().mockResolvedValue({ diff: "..." }),
      rollback: jest.fn().mockResolvedValue({ success: true }),
    };

    mockChapterAnnotationService = {
      getAnnotations: jest.fn().mockResolvedValue([{ id: annotationId }]),
      createAnnotation: jest.fn().mockResolvedValue({ id: annotationId }),
      updateAnnotation: jest.fn().mockResolvedValue({ id: annotationId }),
      deleteAnnotation: jest.fn().mockResolvedValue({ id: annotationId }),
      resolveAnnotations: jest.fn().mockResolvedValue({ resolved: 2 }),
    };

    mockChapterImportService = {
      parseImport: jest.fn().mockResolvedValue({ importId }),
      confirmImport: jest.fn().mockResolvedValue({ success: true }),
      getImportStatus: jest.fn().mockResolvedValue({ status: "PROCESSING" }),
      getImportHistory: jest.fn().mockResolvedValue([{ id: importId }]),
      cancelImport: jest.fn().mockResolvedValue({ cancelled: true }),
    };

    mockConsistencyEngine = {
      validateChapter: jest.fn(),
      getProjectReport: jest.fn(),
    };

    mockParallelOrchestrator = {
      orchestrateParallelWriting: jest.fn(),
    };

    mockStoryCompletionDetector = {
      analyzeCompletion: jest.fn(),
    };

    mockTemporalConflictAnalyzer = {
      analyzeProject: jest.fn(),
      analyzeChapter: jest.fn(),
    };

    mockHierarchicalSummaryService = {
      getHierarchicalContext: jest.fn(),
      formatContextForPrompt: jest.fn(),
      batchUpdateSummaries: jest.fn(),
    };

    mockSharedScratchpadService = {
      getEntries: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingCoordinatorService,
        { provide: ProjectService, useValue: mockProjectService },
        { provide: StoryBibleService, useValue: mockStoryBibleService },
        { provide: CharacterService, useValue: mockCharacterService },
        { provide: ChapterWritingService, useValue: mockChapterWritingService },
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
              startMissionAsync: jest.fn().mockResolvedValue({ missionId }),
              cancelMission: jest.fn().mockResolvedValue({ success: true }),
              forceCleanupStuckMissions: jest
                .fn()
                .mockResolvedValue({ cleaned: 3 }),
              reExtractChapterTitles: jest
                .fn()
                .mockResolvedValue({ extracted: 3 }),
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
                .mockResolvedValue({ id: missionId, status: "COMPLETED" }),
              getProjectMissions: jest
                .fn()
                .mockResolvedValue({ items: [], total: 0 }),
              getMissionLogs: jest.fn().mockResolvedValue([{ id: "log-1" }]),
              getLatestMission: jest.fn().mockResolvedValue(mockMission),
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
  // Project Management – uncovered paths
  // =========================================================================

  describe("getPublicProject", () => {
    it("should return public project by ID", async () => {
      const result = await service.getPublicProject(projectId);

      expect(result).toEqual(mockProject);
      expect(mockProjectService.findPublic).toHaveBeenCalledWith(projectId);
    });
  });

  describe("resetChaptersByNumbers", () => {
    it("should verify ownership then reset chapters", async () => {
      const chapterNumbers = [1, 2, 3];

      const result = await service.resetChaptersByNumbers(
        projectId,
        userId,
        chapterNumbers,
      );

      expect(mockProjectService.findOne).toHaveBeenCalledWith(
        projectId,
        userId,
      );
      expect(mockProjectService.resetChaptersByNumbers).toHaveBeenCalledWith(
        projectId,
        chapterNumbers,
      );
      expect(result).toEqual({ reset: 2 });
    });
  });

  // =========================================================================
  // Volumes
  // =========================================================================

  describe("createVolume", () => {
    it("should create a volume", async () => {
      const dto = { title: "Volume One", description: "First volume" };
      const result = await service.createVolume(projectId, userId, dto);

      expect(result).toEqual({ id: volumeId });
      expect(mockProjectService.createVolume).toHaveBeenCalledWith(
        projectId,
        userId,
        dto,
      );
    });
  });

  describe("getVolumes", () => {
    it("should return volumes for a project", async () => {
      const result = await service.getVolumes(projectId, userId);

      expect(result).toEqual([{ id: volumeId }]);
      expect(mockProjectService.getVolumes).toHaveBeenCalledWith(
        projectId,
        userId,
      );
    });
  });

  // =========================================================================
  // Chapters
  // =========================================================================

  describe("createChapter", () => {
    it("should create a chapter in a volume", async () => {
      const dto = { title: "New Chapter", chapterNumber: 1 };
      const result = await service.createChapter(volumeId, userId, dto);

      expect(result).toEqual({ id: chapterId, title: "New Chapter" });
      expect(mockChapterWritingService.createChapter).toHaveBeenCalledWith(
        volumeId,
        userId,
        dto,
      );
    });
  });

  describe("getChapters", () => {
    it("should return chapters in a volume", async () => {
      const result = await service.getChapters(volumeId, userId);

      expect(result).toEqual([{ id: chapterId, title: "Chapter One" }]);
      expect(mockChapterWritingService.getChapters).toHaveBeenCalledWith(
        volumeId,
        userId,
      );
    });
  });

  describe("getChapter", () => {
    it("should return a single chapter", async () => {
      const result = await service.getChapter(chapterId, userId);

      expect(result).toEqual(mockChapter);
      expect(mockChapterWritingService.getChapter).toHaveBeenCalledWith(
        chapterId,
        userId,
      );
    });
  });

  describe("updateChapter", () => {
    it("should update chapter fields", async () => {
      const dto = { title: "Updated" };
      const result = await service.updateChapter(chapterId, userId, dto);

      expect(result).toEqual({ id: chapterId, title: "Updated" });
      expect(mockChapterWritingService.updateChapter).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto,
      );
    });
  });

  describe("startWriting", () => {
    it("should start writing for a chapter", async () => {
      const dto = { mode: "auto" };
      const result = await service.startWriting(chapterId, userId, dto);

      expect(result.success).toBe(true);
      expect(mockChapterWritingService.startWriting).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto,
      );
    });
  });

  // =========================================================================
  // Chapter Revision
  // =========================================================================

  describe("getChapterRevisions", () => {
    it("should return revisions for a chapter", async () => {
      const result = await service.getChapterRevisions(chapterId, userId);

      expect(result).toEqual([{ id: revisionId }]);
      expect(mockChapterRevisionService.getRevisions).toHaveBeenCalledWith(
        chapterId,
        userId,
      );
    });
  });

  describe("updateChapterContent", () => {
    it("should update chapter content and return updated chapter", async () => {
      const dto = {
        content: "Updated chapter content",
        changeSummary: "Minor edits",
      };
      const result = await service.updateChapterContent(chapterId, userId, dto);

      expect(result).toEqual({ id: chapterId });
      expect(mockChapterRevisionService.updateContent).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto,
      );
    });
  });

  describe("aiEditChapter", () => {
    it("should perform AI edit on chapter", async () => {
      const dto = {
        operation: "polish" as const,
        userFeedback: "Make it flow better",
        polishLevel: "moderate" as const,
      };
      const result = await service.aiEditChapter(chapterId, userId, dto);

      expect(result.success).toBe(true);
      expect(mockChapterRevisionService.aiEdit).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto,
      );
    });
  });

  describe("compareRevisions", () => {
    it("should compare two revisions", async () => {
      const revisionId2 = "rev-sup-2";
      const result = await service.compareRevisions(
        chapterId,
        revisionId,
        revisionId2,
        userId,
      );

      expect(result).toEqual({ diff: "..." });
      expect(mockChapterRevisionService.compareRevisions).toHaveBeenCalledWith(
        chapterId,
        revisionId,
        revisionId2,
        userId,
      );
    });
  });

  describe("rollbackRevision", () => {
    it("should rollback to a specific revision", async () => {
      const result = await service.rollbackRevision(
        chapterId,
        revisionId,
        userId,
        "Testing rollback",
      );

      expect(result).toEqual({ success: true });
      expect(mockChapterRevisionService.rollback).toHaveBeenCalledWith(
        chapterId,
        revisionId,
        userId,
        "Testing rollback",
      );
    });

    it("should rollback without reason", async () => {
      await service.rollbackRevision(chapterId, revisionId, userId);

      expect(mockChapterRevisionService.rollback).toHaveBeenCalledWith(
        chapterId,
        revisionId,
        userId,
        undefined,
      );
    });
  });

  // =========================================================================
  // Chapter Annotations
  // =========================================================================

  describe("getChapterAnnotations", () => {
    it("should return all annotations when no status filter", async () => {
      const result = await service.getChapterAnnotations(chapterId, userId);

      expect(result).toEqual([{ id: annotationId }]);
      expect(mockChapterAnnotationService.getAnnotations).toHaveBeenCalledWith(
        chapterId,
        userId,
        undefined,
      );
    });

    it("should filter annotations by status", async () => {
      await service.getChapterAnnotations(chapterId, userId, "OPEN");

      expect(mockChapterAnnotationService.getAnnotations).toHaveBeenCalledWith(
        chapterId,
        userId,
        "OPEN",
      );
    });
  });

  describe("createAnnotation", () => {
    it("should create an annotation on a chapter", async () => {
      const dto = {
        startOffset: 10,
        endOffset: 50,
        content: "This section needs work",
        type: "COMMENT" as const,
        selectedText: "sample text",
      };
      const result = await service.createAnnotation(chapterId, userId, dto);

      expect(result).toEqual({ id: annotationId });
      expect(
        mockChapterAnnotationService.createAnnotation,
      ).toHaveBeenCalledWith(chapterId, userId, dto);
    });
  });

  describe("updateAnnotation", () => {
    it("should update an annotation", async () => {
      const dto = { content: "Updated comment", status: "RESOLVED" as const };
      const result = await service.updateAnnotation(annotationId, userId, dto);

      expect(result).toEqual({ id: annotationId });
      expect(
        mockChapterAnnotationService.updateAnnotation,
      ).toHaveBeenCalledWith(annotationId, userId, dto);
    });
  });

  describe("deleteAnnotation", () => {
    it("should delete an annotation", async () => {
      const result = await service.deleteAnnotation(annotationId, userId);

      expect(result).toEqual({ id: annotationId });
      expect(
        mockChapterAnnotationService.deleteAnnotation,
      ).toHaveBeenCalledWith(annotationId, userId);
    });
  });

  describe("resolveAnnotations", () => {
    it("should resolve multiple annotations", async () => {
      const annotationIds = ["ann-1", "ann-2"];
      const result = await service.resolveAnnotations(
        chapterId,
        userId,
        annotationIds,
      );

      expect(result).toEqual({ resolved: 2 });
      expect(
        mockChapterAnnotationService.resolveAnnotations,
      ).toHaveBeenCalledWith(chapterId, userId, annotationIds);
    });
  });

  // =========================================================================
  // Chapter Import
  // =========================================================================

  describe("parseImport", () => {
    it("should parse an import file", async () => {
      const dto = { content: "raw text content", format: "txt" as const };
      const result = await service.parseImport(projectId, userId, dto);

      expect(result).toEqual({ importId });
      expect(mockChapterImportService.parseImport).toHaveBeenCalledWith(
        projectId,
        userId,
        dto,
      );
    });
  });

  describe("confirmImport", () => {
    it("should confirm an import", async () => {
      const dto = { chapters: [] };
      const result = await service.confirmImport(
        projectId,
        importId,
        userId,
        dto,
      );

      expect(result).toEqual({ success: true });
      expect(mockChapterImportService.confirmImport).toHaveBeenCalledWith(
        projectId,
        importId,
        userId,
        dto,
      );
    });
  });

  describe("getImportStatus", () => {
    it("should return import status", async () => {
      const result = await service.getImportStatus(projectId, importId, userId);

      expect(result).toEqual({ status: "PROCESSING" });
      expect(mockChapterImportService.getImportStatus).toHaveBeenCalledWith(
        projectId,
        importId,
        userId,
      );
    });
  });

  describe("getImportHistory", () => {
    it("should return import history for project", async () => {
      const result = await service.getImportHistory(projectId, userId);

      expect(result).toEqual([{ id: importId }]);
      expect(mockChapterImportService.getImportHistory).toHaveBeenCalledWith(
        projectId,
        userId,
      );
    });
  });

  describe("cancelImport", () => {
    it("should cancel an import", async () => {
      const result = await service.cancelImport(projectId, importId, userId);

      expect(result).toEqual({ cancelled: true });
      expect(mockChapterImportService.cancelImport).toHaveBeenCalledWith(
        projectId,
        importId,
        userId,
      );
    });
  });

  // =========================================================================
  // Writing Missions – uncovered paths
  // =========================================================================

  describe("forceCleanupStuckMissions", () => {
    it("should verify ownership then cleanup stuck missions", async () => {
      const result = await service.forceCleanupStuckMissions(projectId, userId);

      expect(mockProjectService.findOne).toHaveBeenCalledWith(
        projectId,
        userId,
      );
      expect(
        mockMissionLifecycle.forceCleanupStuckMissions,
      ).toHaveBeenCalledWith(projectId, userId);
      expect(result).toEqual({ cleaned: 3 });
    });
  });

  describe("getMissionLogs", () => {
    it("should return mission logs with default pagination", async () => {
      const result = await service.getMissionLogs(missionId, userId);

      expect(result).toEqual([{ id: "log-1" }]);
      expect(mockMissionQuery.getMissionLogs).toHaveBeenCalledWith(
        missionId,
        userId,
        undefined,
        undefined,
      );
    });

    it("should pass limit and offset", async () => {
      await service.getMissionLogs(missionId, userId, 20, 10);

      expect(mockMissionQuery.getMissionLogs).toHaveBeenCalledWith(
        missionId,
        userId,
        20,
        10,
      );
    });
  });

  describe("reExtractChapterTitles", () => {
    it("should delegate to writing mission service", async () => {
      const result = await service.reExtractChapterTitles(projectId, userId);

      expect(result).toEqual({ extracted: 3 });
      expect(mockMissionLifecycle.reExtractChapterTitles).toHaveBeenCalled();
    });
  });

  describe("startMission – chapterNumber not found", () => {
    it("should not set chapterId when chapter number not found", async () => {
      mockProjectService.findChapterByNumber = jest
        .fn()
        .mockResolvedValue(null);

      const dto = {
        prompt: "Write chapter",
        chapterNumber: 99,
      };

      const result = await service.startMission(projectId, userId, dto);

      expect(mockProjectService.findChapterByNumber).toHaveBeenCalledWith(
        projectId,
        99,
      );
      // chapterId should be undefined because the chapter was not found
      expect(mockMissionLifecycle.startMissionAsync).toHaveBeenCalledWith(
        expect.objectContaining({ chapterId: undefined }),
        userId,
      );
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // Characters – uncovered paths
  // =========================================================================

  describe("getCharacter", () => {
    it("should return a single character", async () => {
      const result = await service.getCharacter(characterId, projectId, userId);

      expect(result).toEqual({ id: characterId, name: "Alice" });
      expect(mockCharacterService.findOne).toHaveBeenCalledWith(
        characterId,
        projectId,
        userId,
      );
    });
  });

  describe("updateCharacter", () => {
    it("should update a character", async () => {
      const dto = { name: "Alice Updated", description: "Updated" };
      const result = await service.updateCharacter(
        characterId,
        projectId,
        userId,
        dto,
      );

      expect(result).toEqual({ id: characterId, name: "Alice" });
      expect(mockCharacterService.update).toHaveBeenCalledWith(
        characterId,
        projectId,
        userId,
        dto,
      );
    });
  });

  describe("deleteCharacter", () => {
    it("should delete a character", async () => {
      const result = await service.deleteCharacter(
        characterId,
        projectId,
        userId,
      );

      expect(result).toEqual({ id: characterId });
      expect(mockCharacterService.delete).toHaveBeenCalledWith(
        characterId,
        projectId,
        userId,
      );
    });
  });

  describe("addRelationship", () => {
    it("should add a relationship between characters", async () => {
      const dto = {
        targetCharacterId: "char-2",
        relationshipType: "friend",
        description: "Childhood friends",
      };
      const result = await service.addRelationship(
        characterId,
        projectId,
        userId,
        dto,
      );

      expect(result).toEqual({ id: "rel-1", type: "friend" });
      expect(mockCharacterService.addRelationship).toHaveBeenCalledWith(
        characterId,
        projectId,
        userId,
        dto,
      );
    });
  });

  describe("deleteRelationship", () => {
    it("should delete a character relationship", async () => {
      const relationshipId = "rel-1";
      const result = await service.deleteRelationship(
        relationshipId,
        projectId,
        userId,
      );

      expect(result).toEqual({ id: "rel-1" });
      expect(mockCharacterService.deleteRelationship).toHaveBeenCalledWith(
        relationshipId,
        projectId,
        userId,
      );
    });
  });

  // =========================================================================
  // Shared Scratchpad
  // =========================================================================

  describe("getScratchpad", () => {
    it("should return empty when no recent mission", async () => {
      mockMissionQuery.getLatestMission = jest.fn().mockResolvedValue(null);

      const result = await service.getScratchpad(projectId, userId, {});

      expect(result.entries).toEqual([]);
      expect(result.totalEntries).toBe(0);
    });

    it("should return entries from latest mission", async () => {
      const entries = [{ id: "entry-1", type: "thought", content: "Planning" }];
      mockSharedScratchpadService.getEntries = jest
        .fn()
        .mockResolvedValue(entries);

      const result = await service.getScratchpad(projectId, userId, {
        limit: 20,
      });

      expect(result.entries).toEqual(entries);
      expect(result.totalEntries).toBe(1);
      expect(mockSharedScratchpadService.getEntries).toHaveBeenCalledWith(
        missionId,
        { type: undefined, limit: 20 },
      );
    });

    it("should return empty and warn on error", async () => {
      mockMissionQuery.getLatestMission = jest
        .fn()
        .mockRejectedValue(new Error("DB error"));

      const result = await service.getScratchpad(projectId, userId, {});

      expect(result.entries).toEqual([]);
      expect(result.totalEntries).toBe(0);
    });

    it("should pass type filter to scratchpad service", async () => {
      const entries = [{ id: "entry-2", type: "decision", content: "Plot" }];
      mockSharedScratchpadService.getEntries = jest
        .fn()
        .mockResolvedValue(entries);

      const result = await service.getScratchpad(projectId, userId, {
        type: "decision",
        limit: 10,
      });

      expect(result.totalEntries).toBe(1);
      expect(mockSharedScratchpadService.getEntries).toHaveBeenCalledWith(
        missionId,
        { type: "decision", limit: 10 },
      );
    });
  });

  // =========================================================================
  // Analysis Dashboard – additional coverage
  // =========================================================================

  describe("getAnalysisDashboard – mission found with no entries", () => {
    it("should return empty entries when scratchpad is empty", async () => {
      mockSharedScratchpadService.getEntries = jest.fn().mockResolvedValue([]);

      const result = await service.getAnalysisDashboard(projectId, userId);

      expect(result.project.id).toBe(projectId);
      expect(result.agentActivity.recentEntries).toEqual([]);
      expect(result.agentActivity.totalEntries).toBe(0);
    });
  });
});
