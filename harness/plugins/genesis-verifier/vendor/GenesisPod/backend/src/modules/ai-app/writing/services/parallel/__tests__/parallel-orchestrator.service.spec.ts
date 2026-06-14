import { Test, TestingModule } from "@nestjs/testing";
import { ParallelOrchestratorService } from "../parallel-orchestrator.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChapterDependencyService } from "../chapter-dependency.service";
import { WriterPoolService } from "../writer-pool.service";
import { ParallelConflictDetectorService } from "../parallel-conflict-detector.service";
import { ConsistencyEngineService } from "../../consistency/consistency-engine.service";
import { StoryBibleService } from "../../bible/story-bible.service";

describe("ParallelOrchestratorService", () => {
  let service: ParallelOrchestratorService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockChapterDependency: jest.Mocked<ChapterDependencyService>;

  const mockChapters = [
    { id: "ch-1", chapterNumber: 1, title: "Chapter 1" },
    { id: "ch-2", chapterNumber: 2, title: "Chapter 2" },
    { id: "ch-3", chapterNumber: 3, title: "Chapter 3" },
  ];

  const mockVolume = {
    id: "vol-1",
    project: {
      id: "proj-1",
      ownerId: "user-1",
      maxParallelWriters: 2,
    },
    chapters: mockChapters,
  };

  const mockMission = {
    id: "mission-1",
    projectId: "proj-1",
    missionType: "CHAPTER",
    targetId: "ch-1",
    status: "PENDING",
    parallelGroupId: "pg_123",
    writerInstance: 1,
  };

  beforeEach(async () => {
    mockPrisma = {
      writingVolume: {
        findUnique: jest.fn(),
      },
      writingMission: {
        create: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    mockChapterDependency = {
      analyze: jest.fn(),
    } as unknown as jest.Mocked<ChapterDependencyService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParallelOrchestratorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChapterDependencyService, useValue: mockChapterDependency },
        { provide: WriterPoolService, useValue: {} },
        { provide: ParallelConflictDetectorService, useValue: {} },
        { provide: ConsistencyEngineService, useValue: {} },
        { provide: StoryBibleService, useValue: {} },
      ],
    }).compile();

    service = module.get<ParallelOrchestratorService>(
      ParallelOrchestratorService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("orchestrateParallelWriting", () => {
    it("should throw error when volume is not found", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.orchestrateParallelWriting("vol-1", "user-1", {}),
      ).rejects.toThrow("Volume not found or access denied");
    });

    it("should throw error when user does not own the volume", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue({
        ...mockVolume,
        project: { ...mockVolume.project, ownerId: "other-user" },
      });

      await expect(
        service.orchestrateParallelWriting("vol-1", "user-1", {}),
      ).rejects.toThrow("Volume not found or access denied");
    });

    it("should use default maxParallelWriters from project when not specified", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue(
        mockVolume,
      );
      const depGraph = new Map([
        ["ch-1", []],
        ["ch-2", ["ch-1"]],
        ["ch-3", ["ch-2"]],
      ]);
      mockChapterDependency.analyze.mockResolvedValue(depGraph);
      (mockPrisma.writingMission.create as jest.Mock).mockResolvedValue(
        mockMission,
      );

      const result = await service.orchestrateParallelWriting(
        "vol-1",
        "user-1",
        {},
      );

      expect(result.maxParallel).toBe(2);
    });

    it("should use options.maxParallel when specified", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue(
        mockVolume,
      );
      const depGraph = new Map([
        ["ch-1", []],
        ["ch-2", ["ch-1"]],
        ["ch-3", ["ch-2"]],
      ]);
      mockChapterDependency.analyze.mockResolvedValue(depGraph);
      (mockPrisma.writingMission.create as jest.Mock).mockResolvedValue(
        mockMission,
      );

      const result = await service.orchestrateParallelWriting(
        "vol-1",
        "user-1",
        { maxParallel: 3 },
      );

      expect(result.maxParallel).toBe(3);
    });

    it("should create missions for each chapter", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue(
        mockVolume,
      );
      const depGraph = new Map([
        ["ch-1", []],
        ["ch-2", ["ch-1"]],
        ["ch-3", ["ch-2"]],
      ]);
      mockChapterDependency.analyze.mockResolvedValue(depGraph);
      (mockPrisma.writingMission.create as jest.Mock).mockResolvedValue(
        mockMission,
      );

      const result = await service.orchestrateParallelWriting(
        "vol-1",
        "user-1",
        {},
      );

      expect(mockPrisma.writingMission.create).toHaveBeenCalledTimes(3);
      expect(result.totalChapters).toBe(3);
      expect(result.volumeId).toBe("vol-1");
    });

    it("should return a valid parallel group ID", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue(
        mockVolume,
      );
      const depGraph = new Map([["ch-1", []]]);
      mockChapterDependency.analyze.mockResolvedValue(depGraph);
      (mockPrisma.writingMission.create as jest.Mock).mockResolvedValue(
        mockMission,
      );

      const result = await service.orchestrateParallelWriting(
        "vol-1",
        "user-1",
        {},
      );

      expect(result.parallelGroupId).toMatch(/^pg_\d+$/);
    });

    it("should return execution plan with rounds", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue(
        mockVolume,
      );
      // Sequential dependencies: ch-1 has none, ch-2 depends on ch-1, ch-3 on ch-2
      const depGraph = new Map([
        ["ch-1", []],
        ["ch-2", ["ch-1"]],
        ["ch-3", ["ch-2"]],
      ]);
      mockChapterDependency.analyze.mockResolvedValue(depGraph);
      (mockPrisma.writingMission.create as jest.Mock).mockResolvedValue(
        mockMission,
      );

      const result = await service.orchestrateParallelWriting(
        "vol-1",
        "user-1",
        { maxParallel: 2 },
      );

      expect(result.executionPlan).toBeDefined();
      expect(Array.isArray(result.executionPlan)).toBe(true);
      // With sequential deps: round 0 = ch-1, round 1 = ch-2, round 2 = ch-3
      expect(result.executionPlan.length).toBeGreaterThan(0);
    });

    it("should respect maxParallel limit in execution rounds", async () => {
      const manyChapters = [
        { id: "ch-1", chapterNumber: 1 },
        { id: "ch-2", chapterNumber: 2 },
        { id: "ch-3", chapterNumber: 3 },
        { id: "ch-4", chapterNumber: 4 },
      ];
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue({
        ...mockVolume,
        chapters: manyChapters,
        project: { ...mockVolume.project, maxParallelWriters: 2 },
      });
      // All chapters independent
      const depGraph = new Map([
        ["ch-1", []],
        ["ch-2", []],
        ["ch-3", []],
        ["ch-4", []],
      ]);
      mockChapterDependency.analyze.mockResolvedValue(depGraph);
      (mockPrisma.writingMission.create as jest.Mock).mockResolvedValue(
        mockMission,
      );

      const result = await service.orchestrateParallelWriting(
        "vol-1",
        "user-1",
        { maxParallel: 2 },
      );

      // Each round should have at most 2 chapters
      for (const round of result.executionPlan) {
        expect(round.chapters.length).toBeLessThanOrEqual(2);
      }
    });

    it("should return mission IDs in result", async () => {
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue({
        ...mockVolume,
        chapters: [{ id: "ch-1", chapterNumber: 1 }],
      });
      const depGraph = new Map([["ch-1", []]]);
      mockChapterDependency.analyze.mockResolvedValue(depGraph);
      (mockPrisma.writingMission.create as jest.Mock).mockResolvedValue({
        id: "mission-created-1",
      });

      const result = await service.orchestrateParallelWriting(
        "vol-1",
        "user-1",
        {},
      );

      expect(result.missions).toEqual(["mission-created-1"]);
    });

    it("should handle chapters with no dependencies (all parallel)", async () => {
      const independentChapters = [
        { id: "ch-1", chapterNumber: 1 },
        { id: "ch-2", chapterNumber: 2 },
      ];
      (mockPrisma.writingVolume.findUnique as jest.Mock).mockResolvedValue({
        ...mockVolume,
        chapters: independentChapters,
      });
      // No dependencies - all independent
      const depGraph = new Map([
        ["ch-1", []],
        ["ch-2", []],
      ]);
      mockChapterDependency.analyze.mockResolvedValue(depGraph);
      (mockPrisma.writingMission.create as jest.Mock).mockResolvedValue(
        mockMission,
      );

      const result = await service.orchestrateParallelWriting(
        "vol-1",
        "user-1",
        { maxParallel: 4 },
      );

      // With no dependencies and maxParallel=4, both chapters should be in round 0
      expect(result.executionPlan[0].chapters.length).toBe(2);
    });
  });
});
