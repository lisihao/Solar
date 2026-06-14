import { Test, TestingModule } from "@nestjs/testing";
import {
  EnhancedDependencyService,
  ChapterNode,
} from "../enhanced-dependency.service";

describe("EnhancedDependencyService", () => {
  let service: EnhancedDependencyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EnhancedDependencyService],
    }).compile();

    service = module.get<EnhancedDependencyService>(EnhancedDependencyService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("detectCircularDependencies", () => {
    it("should detect self-reference", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: ["ch1"], // Self-reference
          estimatedTime: 100,
        },
      ];

      const circularDeps = service.detectCircularDependencies(chapters);

      expect(circularDeps).toHaveLength(1);
      expect(circularDeps[0].type).toBe("SELF_REFERENCE");
      expect(circularDeps[0].path).toEqual(["ch1", "ch1"]);
    });

    it("should detect simple circular dependency", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: ["ch2"],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"], // Creates a cycle
          estimatedTime: 100,
        },
      ];

      const circularDeps = service.detectCircularDependencies(chapters);

      expect(circularDeps.length).toBeGreaterThan(0);
      expect(circularDeps[0].type).toBe("CIRCULAR");
    });

    it("should detect no circular dependencies in valid graph", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 100,
        },
        {
          id: "ch3",
          title: "Chapter 3",
          orderIndex: 3,
          dependencies: ["ch1", "ch2"],
          estimatedTime: 100,
        },
      ];

      const circularDeps = service.detectCircularDependencies(chapters);

      expect(circularDeps).toHaveLength(0);
    });
  });

  describe("topologicalSort", () => {
    it("should sort chapters in dependency order", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch3",
          title: "Chapter 3",
          orderIndex: 3,
          dependencies: ["ch1", "ch2"],
          estimatedTime: 100,
        },
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 100,
        },
      ];

      const sorted = service.topologicalSort(chapters);

      expect(sorted).not.toBeNull();
      expect(sorted).toHaveLength(3);

      // ch1 should come before ch2 and ch3
      const ch1Index = sorted!.indexOf("ch1");
      const ch2Index = sorted!.indexOf("ch2");
      const ch3Index = sorted!.indexOf("ch3");

      expect(ch1Index).toBeLessThan(ch2Index);
      expect(ch2Index).toBeLessThan(ch3Index);
    });

    it("should return null for circular dependencies", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: ["ch2"],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 100,
        },
      ];

      const sorted = service.topologicalSort(chapters);

      expect(sorted).toBeNull();
    });
  });

  describe("findCriticalPath", () => {
    it("should find the longest path in dependency graph", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 200,
        },
        {
          id: "ch3",
          title: "Chapter 3",
          orderIndex: 3,
          dependencies: ["ch2"],
          estimatedTime: 150,
        },
        {
          id: "ch4",
          title: "Chapter 4",
          orderIndex: 4,
          dependencies: ["ch1"], // Shorter path
          estimatedTime: 100,
        },
      ];

      const criticalPath = service.findCriticalPath(chapters);

      // Critical path should be ch1 -> ch2 -> ch3 (longest time)
      expect(criticalPath).toEqual(["ch1", "ch2", "ch3"]);
    });

    it("should return empty array for circular dependencies", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: ["ch2"],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 100,
        },
      ];

      const criticalPath = service.findCriticalPath(chapters);

      expect(criticalPath).toEqual([]);
    });
  });

  describe("generateOptimalPlan", () => {
    it("should generate execution rounds based on dependencies", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch3",
          title: "Chapter 3",
          orderIndex: 3,
          dependencies: ["ch1", "ch2"],
          estimatedTime: 150,
        },
      ];

      const plan = service.generateOptimalPlan(chapters);

      expect(plan.totalRounds).toBe(2);
      expect(plan.rounds[0].chapters).toEqual(
        expect.arrayContaining(["ch1", "ch2"]),
      );
      expect(plan.rounds[1].chapters).toEqual(["ch3"]);
      expect(plan.parallelizationRate).toBe(1.5); // 3 chapters / 2 rounds
    });

    it("should respect maxParallel constraint", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch3",
          title: "Chapter 3",
          orderIndex: 3,
          dependencies: [],
          estimatedTime: 100,
        },
      ];

      const plan = service.generateOptimalPlan(chapters, 2);

      // Should split into 2 rounds due to maxParallel=2
      expect(plan.totalRounds).toBe(2);
      expect(plan.rounds[0].chapters.length).toBe(2);
      expect(plan.rounds[1].chapters.length).toBe(1);
    });

    it("should throw error for circular dependencies", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: ["ch2"],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 100,
        },
      ];

      expect(() => service.generateOptimalPlan(chapters)).toThrow(
        "circular dependency",
      );
    });
  });

  describe("validateDependencies", () => {
    it("should validate valid dependencies", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 100,
        },
      ];

      const result = service.validateDependencies(chapters);

      expect(result.isValid).toBe(true);
      expect(result.circularDependencies).toHaveLength(0);
      expect(result.invalidReferences).toHaveLength(0);
    });

    it("should detect invalid references", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: ["ch999"], // Non-existent chapter
          estimatedTime: 100,
        },
      ];

      const result = service.validateDependencies(chapters);

      expect(result.isValid).toBe(false);
      expect(result.invalidReferences.length).toBeGreaterThan(0);
    });

    it("should detect circular dependencies", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: ["ch2"],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 100,
        },
      ];

      const result = service.validateDependencies(chapters);

      expect(result.isValid).toBe(false);
      expect(result.circularDependencies.length).toBeGreaterThan(0);
    });

    it("should warn about isolated chapters", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: [],
          estimatedTime: 100,
        },
      ];

      const result = service.validateDependencies(chapters);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("isolated");
    });
  });

  describe("inferDependencies", () => {
    it("should infer sequential dependencies", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch3",
          title: "Chapter 3",
          orderIndex: 3,
          dependencies: [],
          estimatedTime: 100,
        },
      ];

      const dependencies = service.inferDependencies(chapters, {
        sequentialDependency: true,
      });

      expect(dependencies.get("ch1")).toEqual([]);
      expect(dependencies.get("ch2")).toEqual(["ch1"]);
      expect(dependencies.get("ch3")).toEqual(["ch2"]);
    });

    it("should skip introduction when specified", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Introduction",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: [],
          estimatedTime: 100,
        },
      ];

      const dependencies = service.inferDependencies(chapters, {
        sequentialDependency: true,
        skipIntroduction: true,
      });

      expect(dependencies.get("ch1")).toEqual([]);
      expect(dependencies.get("ch2")).toEqual(["ch1"]);
    });
  });

  describe("exportToMermaid", () => {
    it("should export dependency graph as Mermaid format", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 200,
        },
      ];

      const mermaid = service.exportToMermaid(chapters);

      expect(mermaid).toContain("graph TD");
      expect(mermaid).toContain('ch1["Chapter 1 (100s)"]');
      expect(mermaid).toContain('ch2["Chapter 2 (200s)"]');
      expect(mermaid).toContain("ch1 --> ch2");
    });
  });

  describe("calculateDepth", () => {
    it("should calculate depth from root nodes", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 100,
        },
        {
          id: "ch3",
          title: "Chapter 3",
          orderIndex: 3,
          dependencies: ["ch2"],
          estimatedTime: 100,
        },
      ];

      const depth = service.calculateDepth(chapters);

      expect(depth.get("ch1")).toBe(0);
      expect(depth.get("ch2")).toBe(1);
      expect(depth.get("ch3")).toBe(2);
    });
  });

  describe("getReadyChapters", () => {
    it("should return chapters with all dependencies completed", () => {
      const chapters: ChapterNode[] = [
        {
          id: "ch1",
          title: "Chapter 1",
          orderIndex: 1,
          dependencies: [],
          estimatedTime: 100,
        },
        {
          id: "ch2",
          title: "Chapter 2",
          orderIndex: 2,
          dependencies: ["ch1"],
          estimatedTime: 100,
        },
        {
          id: "ch3",
          title: "Chapter 3",
          orderIndex: 3,
          dependencies: ["ch1"],
          estimatedTime: 100,
        },
        {
          id: "ch4",
          title: "Chapter 4",
          orderIndex: 4,
          dependencies: ["ch2", "ch3"],
          estimatedTime: 100,
        },
      ];

      // Initially, only ch1 is ready
      const completed1 = new Set<string>();
      const ready1 = service.getReadyChapters(chapters, completed1);
      expect(ready1).toEqual(["ch1"]);

      // After ch1 completes, ch2 and ch3 are ready
      const completed2 = new Set<string>(["ch1"]);
      const ready2 = service.getReadyChapters(chapters, completed2);
      expect(ready2).toEqual(expect.arrayContaining(["ch2", "ch3"]));

      // After ch1, ch2, ch3 complete, ch4 is ready
      const completed3 = new Set<string>(["ch1", "ch2", "ch3"]);
      const ready3 = service.getReadyChapters(chapters, completed3);
      expect(ready3).toEqual(["ch4"]);
    });
  });
});
