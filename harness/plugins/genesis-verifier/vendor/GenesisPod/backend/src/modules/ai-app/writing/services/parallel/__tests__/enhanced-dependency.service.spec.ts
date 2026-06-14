import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import {
  EnhancedDependencyService,
  ChapterNode,
} from "../enhanced-dependency.service";

describe("EnhancedDependencyService", () => {
  let service: EnhancedDependencyService;

  // Helper to create chapter nodes
  const makeChapter = (
    id: string,
    deps: string[] = [],
    estimatedTime = 100,
    orderIndex?: number,
  ): ChapterNode => {
    const defaultIndex = parseInt(id.replace(/\D/g, ""), 10) || 0;
    return {
      id,
      title: `Chapter ${id}`,
      orderIndex: orderIndex !== undefined ? orderIndex : defaultIndex,
      dependencies: deps,
      estimatedTime,
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EnhancedDependencyService],
    }).compile();

    service = module.get<EnhancedDependencyService>(EnhancedDependencyService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // ==================== detectCircularDependencies ====================

  describe("detectCircularDependencies", () => {
    it("should return empty array for chapters with no dependencies", () => {
      const chapters = [makeChapter("1"), makeChapter("2"), makeChapter("3")];

      const result = service.detectCircularDependencies(chapters);

      expect(result).toHaveLength(0);
    });

    it("should detect self-reference", () => {
      const chapters = [makeChapter("1", ["1"])];

      const result = service.detectCircularDependencies(chapters);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("SELF_REFERENCE");
      expect(result[0].path).toEqual(["1", "1"]);
    });

    it("should detect simple A -> B -> A circular dependency", () => {
      const chapters = [makeChapter("A", ["B"]), makeChapter("B", ["A"])];

      const result = service.detectCircularDependencies(chapters);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe("CIRCULAR");
    });

    it("should detect longer circular chain A -> B -> C -> A", () => {
      const chapters = [
        makeChapter("A", ["B"]),
        makeChapter("B", ["C"]),
        makeChapter("C", ["A"]),
      ];

      const result = service.detectCircularDependencies(chapters);

      expect(result.length).toBeGreaterThan(0);
      const types = result.map((r) => r.type);
      expect(types).toContain("CIRCULAR");
    });

    it("should return empty for valid linear dependency chain", () => {
      const chapters = [
        makeChapter("1"),
        makeChapter("2", ["1"]),
        makeChapter("3", ["2"]),
        makeChapter("4", ["3"]),
      ];

      const result = service.detectCircularDependencies(chapters);

      expect(result).toHaveLength(0);
    });

    it("should return empty for DAG with multiple paths", () => {
      const chapters = [
        makeChapter("A"),
        makeChapter("B", ["A"]),
        makeChapter("C", ["A"]),
        makeChapter("D", ["B", "C"]),
      ];

      const result = service.detectCircularDependencies(chapters);

      expect(result).toHaveLength(0);
    });

    it("should handle empty chapters array", () => {
      const result = service.detectCircularDependencies([]);

      expect(result).toHaveLength(0);
    });

    it("should ignore references to non-existent chapters", () => {
      const chapters = [makeChapter("1", ["nonexistent"])];

      const result = service.detectCircularDependencies(chapters);

      expect(result).toHaveLength(0);
    });
  });

  // ==================== topologicalSort ====================

  describe("topologicalSort", () => {
    it("should return sorted order for linear chain", () => {
      const chapters = [
        makeChapter("3", ["2"]),
        makeChapter("1"),
        makeChapter("2", ["1"]),
      ];

      const result = service.topologicalSort(chapters);

      expect(result).not.toBeNull();
      expect(result!.indexOf("1")).toBeLessThan(result!.indexOf("2"));
      expect(result!.indexOf("2")).toBeLessThan(result!.indexOf("3"));
    });

    it("should return null when circular dependency exists", () => {
      const chapters = [makeChapter("A", ["B"]), makeChapter("B", ["A"])];

      const result = service.topologicalSort(chapters);

      expect(result).toBeNull();
    });

    it("should handle independent nodes", () => {
      const chapters = [makeChapter("A"), makeChapter("B"), makeChapter("C")];

      const result = service.topologicalSort(chapters);

      expect(result).not.toBeNull();
      expect(result!.length).toBe(3);
    });

    it("should handle DAG with multiple paths", () => {
      const chapters = [
        makeChapter("D", ["B", "C"]),
        makeChapter("B", ["A"]),
        makeChapter("C", ["A"]),
        makeChapter("A"),
      ];

      const result = service.topologicalSort(chapters);

      expect(result).not.toBeNull();
      expect(result!.indexOf("A")).toBeLessThan(result!.indexOf("B"));
      expect(result!.indexOf("A")).toBeLessThan(result!.indexOf("C"));
    });

    it("should return array of correct length", () => {
      const chapters = [
        makeChapter("1"),
        makeChapter("2", ["1"]),
        makeChapter("3", ["1"]),
      ];

      const result = service.topologicalSort(chapters);

      expect(result!.length).toBe(3);
    });

    it("should handle empty array", () => {
      const result = service.topologicalSort([]);

      expect(result).toEqual([]);
    });
  });

  // ==================== findCriticalPath ====================

  describe("findCriticalPath", () => {
    it("should find critical path in linear chain", () => {
      const chapters = [
        makeChapter("1", [], 100),
        makeChapter("2", ["1"], 200),
        makeChapter("3", ["2"], 150),
      ];

      const result = service.findCriticalPath(chapters);

      expect(result).toEqual(["1", "2", "3"]);
    });

    it("should find the longest path when multiple paths exist", () => {
      const chapters = [
        makeChapter("A", [], 100),
        makeChapter("B", ["A"], 100), // short path: 200
        makeChapter("C", ["A"], 500), // long path: 600
        makeChapter("D", ["B", "C"], 50),
      ];

      const result = service.findCriticalPath(chapters);

      // Critical path should include C (longer estimated time)
      expect(result).toContain("C");
    });

    it("should return empty array when circular dependency exists", () => {
      const chapters = [makeChapter("A", ["B"]), makeChapter("B", ["A"])];

      const result = service.findCriticalPath(chapters);

      expect(result).toEqual([]);
    });

    it("should handle single chapter", () => {
      const chapters = [makeChapter("1", [], 100)];

      const result = service.findCriticalPath(chapters);

      expect(result).toEqual(["1"]);
    });

    it("should handle independent chapters with same time", () => {
      const chapters = [makeChapter("A", [], 100), makeChapter("B", [], 100)];

      const result = service.findCriticalPath(chapters);

      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ==================== generateOptimalPlan ====================

  describe("generateOptimalPlan", () => {
    it("should generate execution plan for simple chain", () => {
      const chapters = [
        makeChapter("1"),
        makeChapter("2", ["1"]),
        makeChapter("3", ["2"]),
      ];

      const plan = service.generateOptimalPlan(chapters);

      expect(plan.totalRounds).toBe(3);
      expect(plan.rounds[0].chapters).toContain("1");
      expect(plan.rounds[1].chapters).toContain("2");
      expect(plan.rounds[2].chapters).toContain("3");
    });

    it("should parallelize independent chapters in same round", () => {
      const chapters = [makeChapter("A"), makeChapter("B"), makeChapter("C")];

      const plan = service.generateOptimalPlan(chapters);

      expect(plan.totalRounds).toBe(1);
      expect(plan.rounds[0].chapters).toHaveLength(3);
    });

    it("should throw when circular dependency detected", () => {
      const chapters = [makeChapter("A", ["B"]), makeChapter("B", ["A"])];

      expect(() => service.generateOptimalPlan(chapters)).toThrow(
        "circular dependency",
      );
    });

    it("should respect maxParallel constraint", () => {
      const chapters = [
        makeChapter("A"),
        makeChapter("B"),
        makeChapter("C"),
        makeChapter("D"),
      ];

      const plan = service.generateOptimalPlan(chapters, 2);

      // With maxParallel=2, 4 independent chapters should become 2 rounds
      expect(plan.totalRounds).toBe(2);
      for (const round of plan.rounds) {
        expect(round.chapters.length).toBeLessThanOrEqual(2);
      }
    });

    it("should calculate parallelization rate", () => {
      const chapters = [makeChapter("A"), makeChapter("B"), makeChapter("C")];

      const plan = service.generateOptimalPlan(chapters);

      // 3 chapters in 1 round = parallelization rate of 3
      expect(plan.parallelizationRate).toBe(3);
    });

    it("should calculate total estimated time", () => {
      const chapters = [
        makeChapter("A", [], 100),
        makeChapter("B", ["A"], 200),
      ];

      const plan = service.generateOptimalPlan(chapters);

      // Round 1: A (100), Round 2: B (200) = 300 total
      expect(plan.estimatedTotalTime).toBe(300);
    });

    it("should include critical path in plan", () => {
      const chapters = [
        makeChapter("A", [], 100),
        makeChapter("B", ["A"], 200),
      ];

      const plan = service.generateOptimalPlan(chapters);

      expect(plan.criticalPath.length).toBeGreaterThan(0);
    });

    it("should sort chapters by descending time within batch when maxParallel is limited", () => {
      const chapters = [
        makeChapter("fast", [], 50),
        makeChapter("slow", [], 300),
        makeChapter("medium", [], 150),
      ];

      const plan = service.generateOptimalPlan(chapters, 2);

      // First batch should contain the slowest chapters
      expect(plan.rounds[0].chapters).toContain("slow");
    });
  });

  // ==================== validateDependencies ====================

  describe("validateDependencies", () => {
    it("should return isValid=true for valid dependency graph", () => {
      const chapters = [
        makeChapter("A"),
        makeChapter("B", ["A"]),
        makeChapter("C", ["B"]),
      ];

      const result = service.validateDependencies(chapters);

      expect(result.isValid).toBe(true);
      expect(result.circularDependencies).toHaveLength(0);
      expect(result.invalidReferences).toHaveLength(0);
    });

    it("should detect invalid references to non-existent chapters", () => {
      const chapters = [makeChapter("A", ["nonexistent-chapter"])];

      const result = service.validateDependencies(chapters);

      expect(result.isValid).toBe(false);
      expect(result.invalidReferences).toHaveLength(1);
      expect(result.invalidReferences[0]).toContain("nonexistent-chapter");
    });

    it("should detect circular dependencies", () => {
      const chapters = [makeChapter("A", ["B"]), makeChapter("B", ["A"])];

      const result = service.validateDependencies(chapters);

      expect(result.isValid).toBe(false);
      expect(result.circularDependencies.length).toBeGreaterThan(0);
    });

    it("should warn about isolated chapters", () => {
      const chapters = [
        makeChapter("isolated"),
        makeChapter("connected"),
        makeChapter("depends-on-connected", ["connected"]),
      ];

      const result = service.validateDependencies(chapters);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("isolated");
    });

    it("should handle empty chapters", () => {
      const result = service.validateDependencies([]);

      expect(result.isValid).toBe(true);
      expect(result.circularDependencies).toHaveLength(0);
      expect(result.invalidReferences).toHaveLength(0);
    });

    it("should include both circular and invalid reference errors", () => {
      const chapters = [
        makeChapter("A", ["B", "missing"]),
        makeChapter("B", ["A"]),
      ];

      const result = service.validateDependencies(chapters);

      expect(result.isValid).toBe(false);
      expect(result.invalidReferences.length).toBeGreaterThan(0);
      expect(result.circularDependencies.length).toBeGreaterThan(0);
    });
  });

  // ==================== inferDependencies ====================

  describe("inferDependencies", () => {
    it("should infer sequential dependencies by default", () => {
      const chapters = [
        makeChapter("ch1", [], 100, 0),
        makeChapter("ch2", [], 100, 1),
        makeChapter("ch3", [], 100, 2),
      ];

      const result = service.inferDependencies(chapters);

      expect(result.get("ch2")).toContain("ch1");
      expect(result.get("ch3")).toContain("ch2");
    });

    it("should skip first chapter when skipIntroduction is true", () => {
      const chapters = [
        makeChapter("intro", [], 100, 0),
        makeChapter("ch2", [], 100, 1),
      ];

      const result = service.inferDependencies(chapters, {
        skipIntroduction: true,
      });

      expect(result.get("intro")).toEqual([]);
    });

    it("should include first chapter in dependencies when skipIntroduction is false", () => {
      const chapters = [
        makeChapter("intro", [], 100, 0),
        makeChapter("ch2", [], 100, 1),
      ];

      const result = service.inferDependencies(chapters, {
        skipIntroduction: false,
      });

      // ch2 should depend on intro
      expect(result.get("ch2")).toContain("intro");
    });

    it("should sort by orderIndex before inferring", () => {
      const chapters = [
        makeChapter("last", [], 100, 2),
        makeChapter("first", [], 100, 0),
        makeChapter("middle", [], 100, 1),
      ];

      const result = service.inferDependencies(chapters);

      // middle should depend on first, not last
      expect(result.get("middle")).toContain("first");
    });

    it("should return a Map with entries for all chapters", () => {
      const chapters = [
        makeChapter("A", [], 100, 0),
        makeChapter("B", [], 100, 1),
        makeChapter("C", [], 100, 2),
      ];

      const result = service.inferDependencies(chapters);

      expect(result.size).toBe(3);
    });
  });

  // ==================== exportToMermaid ====================

  describe("exportToMermaid", () => {
    it("should export chapters to Mermaid diagram format", () => {
      const chapters = [
        makeChapter("A", [], 100),
        makeChapter("B", ["A"], 200),
      ];

      const result = service.exportToMermaid(chapters);

      expect(result).toContain("graph TD");
      expect(result).toContain("Chapter A");
      expect(result).toContain("Chapter B");
      expect(result).toContain("A --> B");
    });

    it("should include estimated time in node labels", () => {
      const chapters = [makeChapter("X", [], 300)];

      const result = service.exportToMermaid(chapters);

      expect(result).toContain("300s");
    });

    it("should handle chapters with no dependencies", () => {
      const chapters = [makeChapter("A"), makeChapter("B")];

      const result = service.exportToMermaid(chapters);

      expect(result).toContain("graph TD");
      expect(result).not.toContain("-->");
    });

    it("should not render edges for non-existent dependency references", () => {
      const chapters = [makeChapter("A", ["nonexistent"])];

      const result = service.exportToMermaid(chapters);

      expect(result).not.toContain("-->");
    });
  });

  // ==================== calculateDepth ====================

  describe("calculateDepth", () => {
    it("should calculate depth 0 for root chapters", () => {
      const chapters = [makeChapter("root"), makeChapter("child", ["root"])];

      const result = service.calculateDepth(chapters);

      expect(result.get("root")).toBe(0);
    });

    it("should calculate correct depth for linear chain", () => {
      const chapters = [
        makeChapter("A"),
        makeChapter("B", ["A"]),
        makeChapter("C", ["B"]),
      ];

      const result = service.calculateDepth(chapters);

      expect(result.get("A")).toBe(0);
      expect(result.get("B")).toBe(1);
      expect(result.get("C")).toBe(2);
    });

    it("should return empty map for circular dependency", () => {
      const chapters = [makeChapter("A", ["B"]), makeChapter("B", ["A"])];

      const result = service.calculateDepth(chapters);

      expect(result.size).toBe(0);
    });

    it("should calculate max depth for chapter with multiple parents", () => {
      const chapters = [
        makeChapter("A"),
        makeChapter("B", ["A"]),
        makeChapter("C", ["B"]),
        makeChapter("D", ["A", "C"]), // D has two paths: A->D (depth 1) and A->B->C->D (depth 3)
      ];

      const result = service.calculateDepth(chapters);

      expect(result.get("D")).toBe(3); // Takes the max depth
    });
  });

  // ==================== getReadyChapters ====================

  describe("getReadyChapters", () => {
    it("should return chapters with no dependencies when nothing is completed", () => {
      const chapters = [makeChapter("A"), makeChapter("B", ["A"])];

      const result = service.getReadyChapters(chapters, new Set());

      expect(result).toContain("A");
      expect(result).not.toContain("B");
    });

    it("should return B when A is completed", () => {
      const chapters = [makeChapter("A"), makeChapter("B", ["A"])];

      const result = service.getReadyChapters(chapters, new Set(["A"]));

      expect(result).toContain("B");
      expect(result).not.toContain("A"); // A is already completed
    });

    it("should not return already completed chapters", () => {
      const chapters = [makeChapter("A")];

      const result = service.getReadyChapters(chapters, new Set(["A"]));

      expect(result).not.toContain("A");
    });

    it("should only return chapters where ALL dependencies are completed", () => {
      const chapters = [
        makeChapter("A"),
        makeChapter("B"),
        makeChapter("C", ["A", "B"]),
      ];

      // Only A is completed, B is not
      const result = service.getReadyChapters(chapters, new Set(["A"]));

      expect(result).not.toContain("C");
      expect(result).toContain("B"); // B has no unmet deps
    });

    it("should return multiple ready chapters simultaneously", () => {
      const chapters = [
        makeChapter("A"),
        makeChapter("B"),
        makeChapter("C"),
        makeChapter("D", ["A"]),
      ];

      const result = service.getReadyChapters(chapters, new Set());

      expect(result).toContain("A");
      expect(result).toContain("B");
      expect(result).toContain("C");
      expect(result).not.toContain("D");
    });

    it("should return empty array when all chapters are completed", () => {
      const chapters = [makeChapter("A"), makeChapter("B")];

      const result = service.getReadyChapters(chapters, new Set(["A", "B"]));

      expect(result).toHaveLength(0);
    });
  });
});
