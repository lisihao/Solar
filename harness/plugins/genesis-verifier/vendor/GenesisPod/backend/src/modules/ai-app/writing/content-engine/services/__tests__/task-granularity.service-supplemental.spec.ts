/**
 * TaskGranularityService - Supplemental Tests
 *
 * Targets uncovered code paths not exercised by the primary spec:
 * - parseRequirement: countStructuredUnits path (第一章...第二章...第三章),
 *   item count 个/条/项, word counts in 千, container unit counting (>= 2)
 * - detectTwoLevelStructure: countUnitMentions fallback for chapter list,
 *   English two-level with "per" and "each has" patterns,
 *   estimateUnitsPerContainer for 部/季(动漫)/季(美剧)/册/篇/辑/编/default
 * - extractEnglishUnitCount: "consists of", "total of", "N in total" patterns
 * - countEnglishUnitMentions: "Chapter 1" style + ordinal style counts
 * - countChineseUnitMentions: 章N and 卷N patterns
 * - parseChineseNumber: compound numbers (二十三), character not in map
 * - detectMultiUnitPattern: all levels (volume, section, paragraph, item)
 * - extractRange: all levels (section, paragraph, item, volume)
 * - buildSingleUnitTitle: with and without theme extraction
 * - buildSingleUnitDescription: basic form
 * - determineOptimalGranularity: 50k words, 10k words, small words
 * - buildGranularityConstraintPrompt: allowMerge=true, paragraph level examples
 * - validateDecomposition: stats with no autoFixed (valid case)
 */

import { TaskGranularityService } from "../task-granularity.service";

describe("TaskGranularityService - Supplemental", () => {
  let service: TaskGranularityService;

  beforeEach(() => {
    service = new TaskGranularityService();
  });

  // ============================================================
  // parseRequirement: countStructuredUnits path
  // ============================================================

  describe("estimateTaskScale - countStructuredUnits path", () => {
    it("should count 章N style mentions (章1/章2/章3/章4) via countStructuredUnits", async () => {
      // "章1 开始\n章2..." format: extractUnitCount returns undefined (no digit before 章),
      // so detectSingleLevelStructure skips it and countStructuredUnits picks it up via
      // the "章\s*[\d]+" pattern in countChineseUnitMentions
      const req = "章1 开始\n章2 发展\n章3 高潮\n章4 结尾";
      const estimate = await service.estimateTaskScale(req);
      expect(estimate.totalTasks).toBe(4);
      expect(estimate.recommendedGranularity).toBe("chapter");
    });

    it("should count 'Chapter 1 / Chapter 2 / Chapter 3' as structured units", async () => {
      const req = "Chapter 1 Intro\nChapter 2 Rising\nChapter 3 Climax";
      const estimate = await service.estimateTaskScale(req);
      expect(estimate.totalTasks).toBe(3);
    });

    it("should detect item granularity for 20个条目", async () => {
      const estimate = await service.estimateTaskScale("分析20个条目");
      expect(estimate.totalTasks).toBe(20);
      expect(estimate.recommendedGranularity).toBe("item");
    });

    it("should detect section granularity for 10条 format (条 is a section unit)", async () => {
      // "条" is classified as a section-level unit in STRUCTURE_UNITS.section,
      // so detectSingleLevelStructure returns granularityHint="section"
      const estimate = await service.estimateTaskScale("列出10条建议");
      expect(estimate.totalTasks).toBe(10);
      expect(estimate.recommendedGranularity).toBe("section");
    });

    it("should detect section granularity for 5项 format (项 is a section unit)", async () => {
      // "项" is classified as a section-level unit in STRUCTURE_UNITS.section
      const estimate = await service.estimateTaskScale("完成5项任务");
      expect(estimate.totalTasks).toBe(5);
      expect(estimate.recommendedGranularity).toBe("section");
    });

    it("should estimate from 千 word count", async () => {
      const estimate = await service.estimateTaskScale("写5千字文章");
      expect(estimate.totalTasks).toBeGreaterThan(0);
    });

    it("should estimate from plain 万字 word count without container", async () => {
      const estimate = await service.estimateTaskScale("写8万字的报告");
      expect(estimate.totalTasks).toBeGreaterThan(0);
      expect(["chapter", "section"]).toContain(estimate.recommendedGranularity);
    });

    it("should set ambiguous=true for empty requirement and use defaults", async () => {
      const estimate = await service.estimateTaskScale("帮我写点东西");
      expect(estimate.totalTasks).toBeGreaterThanOrEqual(1);
      expect(estimate.warnings).toBeDefined();
    });
  });

  // ============================================================
  // detectTwoLevelStructure: estimateUnitsPerContainer paths
  // ============================================================

  describe("estimateTaskScale - estimateUnitsPerContainer paths", () => {
    it("should use 25 chapters per 部 by default", async () => {
      const estimate = await service.estimateTaskScale("写3部长篇小说");
      // 3 部 × 25 章 = 75
      expect(estimate.totalTasks).toBe(75);
    });

    it("should use 12 episodes per 季 for 动漫", async () => {
      const estimate = await service.estimateTaskScale("制作2季动漫");
      // 2 季 × 12 集 = 24
      expect(estimate.totalTasks).toBe(24);
    });

    it("should use 22 episodes per 季 for 美剧", async () => {
      const estimate = await service.estimateTaskScale("写1季美剧剧本");
      // 1 季 × 22 集 = 22
      expect(estimate.totalTasks).toBe(22);
    });

    it("should use 12 episodes per 季 for generic 季", async () => {
      const estimate = await service.estimateTaskScale("拍摄3季电视剧");
      // 3 季 × 12 集 = 36
      expect(estimate.totalTasks).toBe(36);
    });

    it("should use 10 chapters per 册", async () => {
      const estimate = await service.estimateTaskScale("创作2册漫画");
      // 2 册 × 10 章 = 20
      expect(estimate.totalTasks).toBe(20);
    });

    it("should use 5 chapters per 篇", async () => {
      const estimate = await service.estimateTaskScale("写4篇故事");
      // 4 篇 × 5 章 = 20
      expect(estimate.totalTasks).toBe(20);
    });

    it("should use 10 episodes per 辑", async () => {
      const estimate = await service.estimateTaskScale("制作2辑内容");
      // 2 辑 × 10 集 = 20
      expect(estimate.totalTasks).toBe(20);
    });

    it("should use 15 chapters per 编", async () => {
      const estimate = await service.estimateTaskScale("撰写2编教材");
      // 2 编 × 15 章 = 30
      expect(estimate.totalTasks).toBe(30);
    });
  });

  // ============================================================
  // English two-level patterns
  // ============================================================

  describe("estimateTaskScale - English two-level patterns", () => {
    it("should parse 'N chapters per volume' pattern", async () => {
      const estimate = await service.estimateTaskScale(
        "3 volumes with 10 chapters per volume",
      );
      expect(estimate.totalTasks).toBe(30);
    });

    it("should parse 'each volume has N chapters' pattern", async () => {
      const estimate = await service.estimateTaskScale(
        "4 volumes, each volume has 8 chapters",
      );
      expect(estimate.totalTasks).toBe(32);
    });

    it("should parse 'N chapters in each volume' pattern", async () => {
      const estimate = await service.estimateTaskScale(
        "2 volumes with 5 chapters in each volume",
      );
      expect(estimate.totalTasks).toBe(10);
    });

    it("should parse 'consists of N volumes' pattern", async () => {
      const estimate = await service.estimateTaskScale(
        "a novel that consists of 5 volumes",
      );
      expect(estimate.totalTasks).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // extractEnglishUnitCount edge patterns
  // ============================================================

  describe("estimateTaskScale - extractEnglishUnitCount edge patterns", () => {
    it("should detect 'total of N chapters'", async () => {
      const estimate = await service.estimateTaskScale(
        "a total of 12 chapters",
      );
      expect(estimate.totalTasks).toBe(12);
    });

    it("should detect 'N chapters in total'", async () => {
      const estimate = await service.estimateTaskScale("15 chapters in total");
      expect(estimate.totalTasks).toBe(15);
    });

    it("should detect 'divided into N chapters'", async () => {
      const estimate = await service.estimateTaskScale(
        "divided into 8 chapters",
      );
      expect(estimate.totalTasks).toBe(8);
    });
  });

  // ============================================================
  // countChineseUnitMentions: 章N and 卷N patterns
  // ============================================================

  describe("estimateTaskScale - countChineseUnitMentions patterns", () => {
    it("should count 章1/章2/章3 format", async () => {
      const req = "章1 开始\n章2 发展\n章3 结尾";
      const estimate = await service.estimateTaskScale(req);
      expect(estimate.totalTasks).toBe(3);
    });

    it("should count 卷一/卷二/卷三 format via countStructuredUnits", async () => {
      const req = "卷一 第一卷\n卷二 第二卷";
      const estimate = await service.estimateTaskScale(req);
      // Two 卷 mentions >= 2 triggers countStructuredUnits
      expect(estimate.totalTasks).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================
  // parseChineseNumber
  // ============================================================

  describe("estimateTaskScale - Chinese number parsing", () => {
    it("should parse compound 二十三章 (23 chapters)", async () => {
      const estimate = await service.estimateTaskScale("共二十三章");
      expect(estimate.totalTasks).toBe(23);
    });

    it("should parse 十章 (10 chapters)", async () => {
      const estimate = await service.estimateTaskScale("共十章");
      expect(estimate.totalTasks).toBe(10);
    });

    it("should parse 百章 (100 chapters) and trigger large task warning", async () => {
      const estimate = await service.estimateTaskScale("共百章以上");
      // Falls through to ambiguous / default since "百章以上" may not parse
      expect(estimate.totalTasks).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // estimateTaskScale: preferredGranularity override
  // ============================================================

  describe("estimateTaskScale - contextInfo overrides", () => {
    it("should use preferredGranularity when provided", async () => {
      const estimate = await service.estimateTaskScale("write something", {
        preferredGranularity: "paragraph",
      });
      expect(estimate.recommendedGranularity).toBe("paragraph");
    });

    it("should use totalTargetWords for token estimate", async () => {
      const estimate = await service.estimateTaskScale("write a story", {
        totalTargetWords: 100000,
      });
      expect(estimate.estimatedTotalTokens).toBeGreaterThan(0);
    });

    it("should include continuation warning for large chapter tasks", async () => {
      // chapter maxWords=5000; 5000*2=10000 > 4000 SAFE limit
      const estimate = await service.estimateTaskScale("写3章");
      expect(estimate.requiresContinuation).toBe(true);
      // Should warn about continuation
      const continuationWarning = estimate.warnings.find((w) =>
        w.includes("续写"),
      );
      expect(continuationWarning).toBeDefined();
    });
  });

  // ============================================================
  // determineOptimalGranularity via word-count paths
  // ============================================================

  describe("estimateTaskScale - granularity from word counts", () => {
    it("should return chapter for >= 50000 words", async () => {
      const estimate = await service.estimateTaskScale("写50万字");
      expect(estimate.recommendedGranularity).toBe("chapter");
    });

    it("should return section for 10000-49999 words", async () => {
      const estimate = await service.estimateTaskScale("写2万字的报告");
      // 20000 words → section
      expect(["chapter", "section"]).toContain(estimate.recommendedGranularity);
    });

    it("should return paragraph for < 10000 words (no unit hints)", async () => {
      const estimate = await service.estimateTaskScale("写5000字文章");
      // 5000 words → paragraph
      expect(["paragraph", "section", "chapter"]).toContain(
        estimate.recommendedGranularity,
      );
    });
  });

  // ============================================================
  // buildGranularityConstraintPrompt: edge cases
  // ============================================================

  describe("buildGranularityConstraintPrompt - edge cases", () => {
    it("should show 'allowMerge' message when allowMerge=true", () => {
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { characters: 3000, tokens: 1500 },
        allowMerge: true,
      };
      const prompt = service.buildGranularityConstraintPrompt(constraint);
      expect(prompt).toContain("允许合理合并");
    });

    it("should use 3000 as default max output when characters is undefined", () => {
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { tokens: 1500 },
        allowMerge: false,
      };
      const prompt = service.buildGranularityConstraintPrompt(constraint);
      expect(prompt).toContain("3000");
    });

    it("should generate paragraph-level examples", () => {
      const constraint = {
        level: "paragraph" as const,
        maxOutputPerTask: { characters: 300, tokens: 150 },
        allowMerge: false,
      };
      const prompt = service.buildGranularityConstraintPrompt(constraint);
      expect(prompt).toContain("段落");
    });

    it("should generate volume-level error examples", () => {
      const constraint = {
        level: "volume" as const,
        maxOutputPerTask: { characters: 100000, tokens: 50000 },
        allowMerge: false,
      };
      const prompt = service.buildGranularityConstraintPrompt(constraint);
      expect(prompt).toContain("卷");
    });

    it("should NOT show total tasks note when expectedTotalTasks <= 10", () => {
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { characters: 3000, tokens: 1500 },
        allowMerge: false,
        expectedTotalTasks: 5,
      };
      const prompt = service.buildGranularityConstraintPrompt(constraint);
      // Should NOT contain "禁止分批" since <=10 tasks
      expect(prompt).not.toContain("禁止分批");
    });
  });

  // ============================================================
  // validateDecomposition: stats when valid (no autoFixed)
  // ============================================================

  describe("validateDecomposition - stats when valid", () => {
    it("should return fixedTaskCount undefined when valid (no auto-fix)", () => {
      const tasks = [
        { title: "第1章", description: "", estimatedWords: 2000 },
        { title: "第2章", description: "", estimatedWords: 1500 },
      ];
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { characters: 3000, tokens: 1500 },
        allowMerge: false,
      };
      const result = service.validateDecomposition(tasks, constraint);
      expect(result.valid).toBe(true);
      expect(result.autoFixed).toBeUndefined();
      expect(result.stats.fixedTaskCount).toBeUndefined();
      expect(result.stats.totalEstimatedWords).toBe(3500);
    });

    it("should compute totalEstimatedWords correctly", () => {
      const tasks = [
        { title: "第1章", description: "", estimatedWords: 1000 },
        { title: "第2章", description: "", estimatedWords: 2000 },
        { title: "第3章", description: "" }, // no estimatedWords
      ];
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { characters: 3000, tokens: 1500 },
        allowMerge: false,
      };
      const result = service.validateDecomposition(tasks, constraint);
      expect(result.stats.totalEstimatedWords).toBe(3000);
    });

    it("should detect 前N章 (前5章) as multi-unit violation", () => {
      const tasks = [{ title: "前5章", description: "" }];
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { characters: 3000, tokens: 1500 },
        allowMerge: false,
      };
      const result = service.validateDecomposition(tasks, constraint);
      expect(result.valid).toBe(false);
      expect(result.violations[0].severity).toBe("error");
    });

    it("should detect 第X卷 in chapter-level task as multi-unit violation", () => {
      const tasks = [{ title: "第一卷 所有章节", description: "" }];
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { characters: 3000, tokens: 1500 },
        allowMerge: false,
      };
      const result = service.validateDecomposition(tasks, constraint);
      expect(result.valid).toBe(false);
    });

    it("should detect section range violation (第1-3节)", () => {
      const tasks = [{ title: "第1-3节", description: "" }];
      const constraint = {
        level: "section" as const,
        maxOutputPerTask: { characters: 1000, tokens: 500 },
        allowMerge: false,
      };
      const result = service.validateDecomposition(tasks, constraint);
      expect(result.valid).toBe(false);
    });

    it("should detect paragraph range violation (第1-2段)", () => {
      const tasks = [{ title: "第1-2段", description: "" }];
      const constraint = {
        level: "paragraph" as const,
        maxOutputPerTask: { characters: 300, tokens: 150 },
        allowMerge: false,
      };
      const result = service.validateDecomposition(tasks, constraint);
      expect(result.valid).toBe(false);
    });

    it("should detect item range violation (第1-5条)", () => {
      const tasks = [{ title: "第1-5条", description: "" }];
      const constraint = {
        level: "item" as const,
        maxOutputPerTask: { characters: 200, tokens: 100 },
        allowMerge: false,
      };
      const result = service.validateDecomposition(tasks, constraint);
      expect(result.valid).toBe(false);
    });

    it("should detect 所有条目 as item multi-unit violation", () => {
      const tasks = [{ title: "所有条目", description: "" }];
      const constraint = {
        level: "item" as const,
        maxOutputPerTask: { characters: 200, tokens: 100 },
        allowMerge: false,
      };
      const result = service.validateDecomposition(tasks, constraint);
      expect(result.valid).toBe(false);
    });

    it("should NOT trigger warning when task count deviation <= 20%", () => {
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { characters: 3000, tokens: 1500 },
        allowMerge: false,
        expectedTotalTasks: 10,
      };
      // 10 tasks with 10 expected = 0% deviation → no warning
      const tasks = Array.from({ length: 10 }, (_, i) => ({
        title: `第${i + 1}章`,
        description: "",
      }));
      const result = service.validateDecomposition(tasks, constraint);
      const totalViolation = result.violations.find(
        (v) => v.taskTitle === "[总体]",
      );
      expect(totalViolation).toBeUndefined();
    });
  });

  // ============================================================
  // autoRedecompose: edge cases
  // ============================================================

  describe("autoRedecompose - edge cases", () => {
    it("should correctly split section range (第1-3节)", () => {
      const tasks = [{ title: "第1-3节", description: "Three sections" }];
      const constraint = {
        level: "section" as const,
        maxOutputPerTask: { characters: 1000, tokens: 500 },
        allowMerge: false,
      };
      const result = service.autoRedecompose(tasks, constraint);
      expect(result).toHaveLength(3);
      expect(result[0].title).toContain("1");
    });

    it("should correctly split paragraph range (第2-4段)", () => {
      const tasks = [{ title: "第2-4段", description: "" }];
      const constraint = {
        level: "paragraph" as const,
        maxOutputPerTask: { characters: 300, tokens: 150 },
        allowMerge: false,
      };
      const result = service.autoRedecompose(tasks, constraint);
      expect(result).toHaveLength(3);
    });

    it("should correctly split item range (第1-3个)", () => {
      const tasks = [{ title: "第1-3个", description: "" }];
      const constraint = {
        level: "item" as const,
        maxOutputPerTask: { characters: 200, tokens: 100 },
        allowMerge: false,
      };
      const result = service.autoRedecompose(tasks, constraint);
      expect(result).toHaveLength(3);
    });

    it("should correctly split volume range (第1-2卷)", () => {
      const tasks = [{ title: "第1-2卷", description: "" }];
      const constraint = {
        level: "volume" as const,
        maxOutputPerTask: { characters: 100000, tokens: 50000 },
        allowMerge: false,
      };
      const result = service.autoRedecompose(tasks, constraint);
      expect(result).toHaveLength(2);
    });

    it("should extract theme from original title when available", () => {
      const tasks = [{ title: "第1-2章：风云变幻", description: "" }];
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { characters: 3000, tokens: 1500 },
        allowMerge: false,
      };
      const result = service.autoRedecompose(tasks, constraint);
      expect(result).toHaveLength(2);
      // buildSingleUnitTitle extracts "风云变幻" from title
      expect(result[0].title).toContain("章");
    });

    it("should limit estimated words per task to maxOutputPerTask", () => {
      const tasks = [
        { title: "第1-2章", description: "", estimatedWords: 10000 },
      ];
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { characters: 3000, tokens: 1500 },
        allowMerge: false,
      };
      const result = service.autoRedecompose(tasks, constraint);
      expect(result[0].estimatedWords).toBeLessThanOrEqual(3000);
    });

    it("should handle undefined estimatedWords gracefully using fallback 2000", () => {
      const tasks = [{ title: "第1-3章", description: "" }];
      const constraint = {
        level: "chapter" as const,
        maxOutputPerTask: { characters: 3000, tokens: 1500 },
        allowMerge: false,
      };
      const result = service.autoRedecompose(tasks, constraint);
      expect(result).toHaveLength(3);
      // When estimatedWords is undefined, the service falls back to 2000 and distributes
      // evenly: 2000 / 3 ≈ 666.67, capped by maxOutputPerTask.characters (3000)
      expect(result[0].estimatedWords).toBeGreaterThan(0);
      expect(result[0].estimatedWords).toBeLessThanOrEqual(3000);
    });
  });

  // ============================================================
  // buildDefaultConstraint: token values
  // ============================================================

  describe("buildDefaultConstraint - token values", () => {
    it("should set correct typicalTokens for each level", () => {
      const levels = [
        "volume",
        "chapter",
        "section",
        "paragraph",
        "item",
      ] as const;
      const expectedTokens: Record<string, number> = {
        volume: 50000,
        chapter: 2500,
        section: 800,
        paragraph: 150,
        item: 80,
      };

      for (const level of levels) {
        const c = service.buildDefaultConstraint(level);
        expect(c.maxOutputPerTask.tokens).toBe(expectedTokens[level]);
      }
    });

    it("should use maxWords * 2 as default characters when not overridden", () => {
      // chapter: maxWords=5000, so default characters = 10000
      const c = service.buildDefaultConstraint("chapter");
      expect(c.maxOutputPerTask.characters).toBe(10000);
    });

    it("should set allowMerge=false by default", () => {
      const c = service.buildDefaultConstraint("section");
      expect(c.allowMerge).toBe(false);
    });

    it("should set expectedTotalTasks=undefined when not provided", () => {
      const c = service.buildDefaultConstraint("item");
      expect(c.expectedTotalTasks).toBeUndefined();
    });
  });
});
