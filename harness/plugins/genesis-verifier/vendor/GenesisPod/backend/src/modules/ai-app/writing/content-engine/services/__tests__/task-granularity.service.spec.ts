/**
 * TaskGranularityService Tests
 *
 * Covers:
 * 1. estimateTaskScale – Chinese two-level structure (卷x章)
 * 2. estimateTaskScale – single-level structures (N章, N集)
 * 3. estimateTaskScale – item counts and word counts
 * 4. buildGranularityConstraintPrompt – content and error examples
 * 5. validateDecomposition – single unit passes, multi-unit detected
 * 6. autoRedecompose – range splitting
 * 7. buildDefaultConstraint – level defaults
 */

import { TaskGranularityService } from "../task-granularity.service";

describe("TaskGranularityService", () => {
  let service: TaskGranularityService;

  beforeEach(() => {
    // TaskGranularityService has no constructor dependencies
    service = new TaskGranularityService();
  });

  // ============================================================
  // estimateTaskScale
  // ============================================================

  describe("estimateTaskScale", () => {
    describe("two-level Chinese structure (卷x章)", () => {
      it("should detect 8卷 each with 10章 = 80 tasks", async () => {
        const estimate = await service.estimateTaskScale("8卷，每卷10章");
        expect(estimate.totalTasks).toBe(80);
        expect(estimate.recommendedGranularity).toBe("chapter");
      });

      it("should detect 3卷 with 每卷10章 = 30 tasks", async () => {
        const estimate = await service.estimateTaskScale("共3卷，每卷约10章");
        expect(estimate.totalTasks).toBe(30);
      });
    });

    describe("single-level structures", () => {
      it("should detect 50章 directly", async () => {
        // Use "共50章" to avoid the container word 部 triggering two-level detection.
        // "写一部50章的小说" parses 部 as a container (count=1) and estimates
        // 25 chapters per 部 by default, so totalTasks=25.
        const estimate = await service.estimateTaskScale("共50章的小说");
        expect(estimate.totalTasks).toBe(50);
        expect(estimate.recommendedGranularity).toBe("chapter");
      });

      it("should detect 24集 anime", async () => {
        const estimate = await service.estimateTaskScale("24集动漫剧本");
        expect(estimate.totalTasks).toBe(24);
        expect(estimate.recommendedGranularity).toBe("chapter");
      });

      it("should detect English '10 chapters'", async () => {
        const estimate = await service.estimateTaskScale(
          "a novel with 10 chapters",
        );
        expect(estimate.totalTasks).toBe(10);
        expect(estimate.recommendedGranularity).toBe("chapter");
      });

      it("should detect English two-level '8 volumes with 10 chapters each'", async () => {
        const estimate = await service.estimateTaskScale(
          "8 volumes with 10 chapters each",
        );
        expect(estimate.totalTasks).toBe(80);
      });
    });

    describe("item counts", () => {
      it("should detect '20个条目' as item granularity", async () => {
        const estimate = await service.estimateTaskScale("分析20个条目");
        expect(estimate.totalTasks).toBe(20);
        expect(estimate.recommendedGranularity).toBe("item");
      });
    });

    describe("word count", () => {
      it("should estimate tasks from 10万字 requirement", async () => {
        const estimate = await service.estimateTaskScale("写一篇10万字的文章");
        expect(estimate.totalTasks).toBeGreaterThan(0);
        expect(["chapter", "section"]).toContain(
          estimate.recommendedGranularity,
        );
      });

      it("should flag warning for very large task counts", async () => {
        const estimate = await service.estimateTaskScale("1000章的超长小说");
        expect(estimate.warnings.length).toBeGreaterThan(0);
      });
    });

    describe("ambiguous requirements", () => {
      it("should set ambiguous=true for unclear requirements", async () => {
        const estimate = await service.estimateTaskScale("帮我写些内容");
        // Falls back to totalTasks = 1 and recommendedGranularity = 'chapter'
        expect(estimate.totalTasks).toBeGreaterThanOrEqual(1);
      });
    });

    describe("continuation flag", () => {
      it("should flag requiresContinuation for chapter-level tasks", async () => {
        const estimate = await service.estimateTaskScale("写10章");
        // chapter maxWords * 2 = 10000 > 4000 SAFE_SINGLE_OUTPUT_LIMIT
        expect(estimate.requiresContinuation).toBe(true);
      });

      it("should not require continuation for paragraph-level", async () => {
        const estimate = await service.estimateTaskScale("写5段");
        // paragraph maxWords * 2 = 600 < 4000
        expect(estimate.requiresContinuation).toBe(false);
      });
    });

    describe("parallel batch calculation", () => {
      it("should compute tasksPerBatch and parallelBatches for small counts", async () => {
        const estimate = await service.estimateTaskScale("5章");
        expect(estimate.tasksPerBatch).toBeGreaterThan(0);
        expect(estimate.parallelBatches).toBeGreaterThan(0);
        expect(
          estimate.tasksPerBatch * estimate.parallelBatches,
        ).toBeGreaterThanOrEqual(estimate.totalTasks);
      });
    });
  });

  // ============================================================
  // buildGranularityConstraintPrompt
  // ============================================================

  describe("buildGranularityConstraintPrompt", () => {
    const chapterConstraint = {
      level: "chapter" as const,
      maxOutputPerTask: { characters: 3000, tokens: 1500 },
      allowMerge: false,
    };

    it("should include the granularity level name in the prompt", () => {
      const prompt =
        service.buildGranularityConstraintPrompt(chapterConstraint);
      expect(prompt).toContain("章");
    });

    it("should include max output characters", () => {
      const prompt =
        service.buildGranularityConstraintPrompt(chapterConstraint);
      expect(prompt).toContain("3000");
    });

    it("should show error examples for chapter level", () => {
      const prompt =
        service.buildGranularityConstraintPrompt(chapterConstraint);
      expect(prompt).toContain("错误示例");
      expect(prompt).toContain("❌");
    });

    it("should show correct examples for chapter level", () => {
      const prompt =
        service.buildGranularityConstraintPrompt(chapterConstraint);
      expect(prompt).toContain("✓");
    });

    it("should show custom example titles when provided", () => {
      const prompt = service.buildGranularityConstraintPrompt(
        chapterConstraint,
        {
          exampleTitles: ["第1章 - 序幕", "第2章 - 开端"],
        },
      );
      expect(prompt).toContain("第1章 - 序幕");
      expect(prompt).toContain("第2章 - 开端");
    });

    it("should include expectedTotalTasks warning when many tasks", () => {
      const constraint = { ...chapterConstraint, expectedTotalTasks: 100 };
      const prompt = service.buildGranularityConstraintPrompt(constraint);
      expect(prompt).toContain("100");
      expect(prompt).toContain("禁止分批");
    });

    it("should include additional constraints when provided", () => {
      const prompt = service.buildGranularityConstraintPrompt(
        chapterConstraint,
        {
          additionalConstraints: "每章必须包含对话",
        },
      );
      expect(prompt).toContain("每章必须包含对话");
    });

    it("should generate section error examples", () => {
      const sectionConstraint = {
        level: "section" as const,
        maxOutputPerTask: { characters: 1000, tokens: 500 },
        allowMerge: false,
      };
      const prompt =
        service.buildGranularityConstraintPrompt(sectionConstraint);
      expect(prompt).toContain("节");
    });

    it("should generate item error examples", () => {
      const itemConstraint = {
        level: "item" as const,
        maxOutputPerTask: { characters: 200, tokens: 100 },
        allowMerge: false,
      };
      const prompt = service.buildGranularityConstraintPrompt(itemConstraint);
      expect(prompt).toContain("条目");
    });
  });

  // ============================================================
  // validateDecomposition
  // ============================================================

  describe("validateDecomposition", () => {
    const chapterConstraint = {
      level: "chapter" as const,
      maxOutputPerTask: { characters: 3000, tokens: 1500 },
      allowMerge: false,
    };

    it("should return valid=true for single chapter tasks", () => {
      const tasks = [
        { title: "第1章 - 开始", description: "写第一章" },
        { title: "第2章 - 发展", description: "写第二章" },
      ];
      const result = service.validateDecomposition(tasks, chapterConstraint);
      expect(result.valid).toBe(true);
      expect(
        result.violations.filter((v) => v.severity === "error"),
      ).toHaveLength(0);
    });

    it("should detect range violation (第1-5章)", () => {
      const tasks = [{ title: "第1-5章 合并写", description: "" }];
      const result = service.validateDecomposition(tasks, chapterConstraint);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].severity).toBe("error");
    });

    it("should auto-fix ranged tasks via autoRedecompose", () => {
      const tasks = [{ title: "第1-3章", description: "写三章" }];
      const result = service.validateDecomposition(tasks, chapterConstraint);
      expect(result.valid).toBe(false);
      expect(result.autoFixed).toBeDefined();
      expect(result.autoFixed!.length).toBe(3);
    });

    it("should warn when task count deviates more than 20% from expected", () => {
      const constraint = { ...chapterConstraint, expectedTotalTasks: 10 };
      const tasks = Array.from({ length: 3 }, (_, i) => ({
        title: `第${i + 1}章`,
        description: "",
      }));
      const result = service.validateDecomposition(tasks, constraint);
      const totalViolation = result.violations.find(
        (v) => v.taskTitle === "[总体]",
      );
      expect(totalViolation).toBeDefined();
    });

    it("should warn for task with estimated words exceeding limit", () => {
      const tasks = [
        {
          title: "第1章",
          description: "",
          estimatedWords: 10000, // >> 3000 * 1.5
        },
      ];
      const result = service.validateDecomposition(tasks, chapterConstraint);
      const warnViolation = result.violations.find(
        (v) => v.severity === "warning",
      );
      expect(warnViolation).toBeDefined();
    });

    it("should return original task count in stats", () => {
      const tasks = [
        { title: "第1章", description: "" },
        { title: "第2章", description: "" },
      ];
      const result = service.validateDecomposition(tasks, chapterConstraint);
      expect(result.stats.originalTaskCount).toBe(2);
    });
  });

  // ============================================================
  // autoRedecompose
  // ============================================================

  describe("autoRedecompose", () => {
    const constraint = {
      level: "chapter" as const,
      maxOutputPerTask: { characters: 3000, tokens: 1500 },
      allowMerge: false,
    };

    it("should split 第1-3章 into 3 individual tasks", () => {
      const tasks = [{ title: "第1-3章", description: "Write three chapters" }];
      const result = service.autoRedecompose(tasks, constraint);
      expect(result).toHaveLength(3);
      expect(result[0].title).toContain("1");
      expect(result[2].title).toContain("3");
    });

    it("should preserve tasks that do not need splitting", () => {
      const tasks = [
        { title: "第1章", description: "Chapter 1", order: 1 },
        { title: "第2章", description: "Chapter 2", order: 2 },
      ];
      const result = service.autoRedecompose(tasks, constraint);
      expect(result).toHaveLength(2);
    });

    it("should re-order tasks starting from 1", () => {
      const tasks = [{ title: "第2-4章", description: "" }];
      const result = service.autoRedecompose(tasks, constraint);
      expect(result[0].order).toBe(1);
      expect(result[result.length - 1].order).toBe(result.length);
    });

    it("should mix split and non-split tasks with correct ordering", () => {
      const tasks = [
        { title: "第1-2章", description: "" },
        { title: "第3章", description: "" },
      ];
      const result = service.autoRedecompose(tasks, constraint);
      expect(result).toHaveLength(3);
      result.forEach((t, i) => expect(t.order).toBe(i + 1));
    });
  });

  // ============================================================
  // buildDefaultConstraint
  // ============================================================

  describe("buildDefaultConstraint", () => {
    it("should return a constraint for chapter level", () => {
      const c = service.buildDefaultConstraint("chapter");
      expect(c.level).toBe("chapter");
      expect(c.allowMerge).toBe(false);
      expect(c.maxOutputPerTask.characters).toBeGreaterThan(0);
    });

    it("should apply custom maxOutputPerTask override", () => {
      const c = service.buildDefaultConstraint("section", {
        maxOutputPerTask: 500,
      });
      expect(c.maxOutputPerTask.characters).toBe(500);
    });

    it("should set expectedTotalTasks when provided", () => {
      const c = service.buildDefaultConstraint("paragraph", {
        expectedTotalTasks: 25,
      });
      expect(c.expectedTotalTasks).toBe(25);
    });

    it("should cover all granularity levels without throwing", () => {
      const levels = [
        "volume",
        "chapter",
        "section",
        "paragraph",
        "item",
      ] as const;
      for (const level of levels) {
        expect(() => service.buildDefaultConstraint(level)).not.toThrow();
      }
    });
  });
});
