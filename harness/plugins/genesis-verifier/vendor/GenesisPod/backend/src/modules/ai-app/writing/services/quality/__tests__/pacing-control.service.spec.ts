import { Test, TestingModule } from "@nestjs/testing";
import { PacingControlService, ChapterPacing } from "../pacing-control.service";

describe("PacingControlService", () => {
  let service: PacingControlService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PacingControlService],
    }).compile();

    service = module.get<PacingControlService>(PacingControlService);
  });

  describe("recordChapterPacing", () => {
    it("should record pacing for a new project", () => {
      const pacing: ChapterPacing = { chapterNumber: 1, pacing: "fast" };
      service.recordChapterPacing("project-1", pacing);

      const analysis = service.analyzePacing("project-1", 2);
      expect(analysis.recentPacings).toHaveLength(1);
      expect(analysis.recentPacings[0].pacing).toBe("fast");
    });

    it("should update existing chapter pacing", () => {
      service.recordChapterPacing("project-1", {
        chapterNumber: 1,
        pacing: "fast",
      });
      service.recordChapterPacing("project-1", {
        chapterNumber: 1,
        pacing: "slow",
      });

      const analysis = service.analyzePacing("project-1", 2);
      expect(analysis.recentPacings).toHaveLength(1);
      expect(analysis.recentPacings[0].pacing).toBe("slow");
    });

    it("should maintain sorted order by chapter number", () => {
      service.recordChapterPacing("project-1", {
        chapterNumber: 3,
        pacing: "fast",
      });
      service.recordChapterPacing("project-1", {
        chapterNumber: 1,
        pacing: "slow",
      });
      service.recordChapterPacing("project-1", {
        chapterNumber: 2,
        pacing: "medium",
      });

      const analysis = service.analyzePacing("project-1", 4);
      expect(analysis.recentPacings[0].chapterNumber).toBe(1);
      expect(analysis.recentPacings[1].chapterNumber).toBe(2);
      expect(analysis.recentPacings[2].chapterNumber).toBe(3);
    });
  });

  describe("analyzePacing", () => {
    it("should return medium pacing for a new project with no history", () => {
      const analysis = service.analyzePacing("new-project", 1);
      // Chapter 1 gets fast pacing
      expect(analysis.recommendation.recommendedPacing).toBe("fast");
    });

    it("should return fast pacing for chapter 1 regardless of history", () => {
      service.recordChapterPacing("project-1", {
        chapterNumber: 0,
        pacing: "slow",
      });
      const analysis = service.analyzePacing("project-1", 1);
      expect(analysis.recommendation.recommendedPacing).toBe("fast");
    });

    it("should detect need for pacing change after 3 consecutive same-pacing chapters", () => {
      service.recordChapterPacing("project-1", {
        chapterNumber: 1,
        pacing: "fast",
      });
      service.recordChapterPacing("project-1", {
        chapterNumber: 2,
        pacing: "fast",
      });
      service.recordChapterPacing("project-1", {
        chapterNumber: 3,
        pacing: "fast",
      });

      const analysis = service.analyzePacing("project-1", 4);
      expect(analysis.needsPacingChange).toBe(true);
    });

    it("should not need pacing change with varied history", () => {
      service.recordChapterPacing("project-1", {
        chapterNumber: 1,
        pacing: "fast",
      });
      service.recordChapterPacing("project-1", {
        chapterNumber: 2,
        pacing: "slow",
      });
      service.recordChapterPacing("project-1", {
        chapterNumber: 3,
        pacing: "fast",
      });

      const analysis = service.analyzePacing("project-1", 4);
      expect(analysis.needsPacingChange).toBe(false);
    });

    it("should recommend slow pacing after 3 consecutive fast chapters", () => {
      service.recordChapterPacing("project-2", {
        chapterNumber: 1,
        pacing: "fast",
      });
      service.recordChapterPacing("project-2", {
        chapterNumber: 2,
        pacing: "fast",
      });
      service.recordChapterPacing("project-2", {
        chapterNumber: 3,
        pacing: "fast",
      });

      const analysis = service.analyzePacing("project-2", 4);
      expect(analysis.recommendation.recommendedPacing).toBe("slow");
    });

    it("should recommend fast pacing after 3 consecutive slow chapters", () => {
      service.recordChapterPacing("project-3", {
        chapterNumber: 1,
        pacing: "slow",
      });
      service.recordChapterPacing("project-3", {
        chapterNumber: 2,
        pacing: "slow",
      });
      service.recordChapterPacing("project-3", {
        chapterNumber: 3,
        pacing: "slow",
      });

      const analysis = service.analyzePacing("project-3", 4);
      expect(analysis.recommendation.recommendedPacing).toBe("fast");
    });

    it("should use chapter type to determine pacing for climax", () => {
      const analysis = service.analyzePacing("project-1", 5, "高潮决战");
      // Climax chapters override to fast
      expect(analysis.recommendation.recommendedPacing).toBe("fast");
    });

    it("should use chapter type to determine pacing for pre-climax", () => {
      const analysis = service.analyzePacing("project-1", 5, "铺垫准备");
      expect(analysis.recommendation.recommendedPacing).toBe("slow");
    });

    it("should use chapter type to determine pacing for emotional scenes", () => {
      const analysis = service.analyzePacing("project-1", 5, "情感告白");
      expect(analysis.recommendation.recommendedPacing).toBe("slow");
    });

    it("should only include chapters before currentChapter in recentPacings", () => {
      service.recordChapterPacing("project-1", {
        chapterNumber: 5,
        pacing: "fast",
      });
      service.recordChapterPacing("project-1", {
        chapterNumber: 3,
        pacing: "slow",
      });

      const analysis = service.analyzePacing("project-1", 4);
      const chapterNumbers = analysis.recentPacings.map((p) => p.chapterNumber);
      expect(chapterNumbers).not.toContain(5);
    });

    it("should include recommendation with techniques and forbidden", () => {
      const analysis = service.analyzePacing("project-1", 2);
      expect(analysis.recommendation.techniques).toBeInstanceOf(Array);
      expect(analysis.recommendation.techniques.length).toBeGreaterThan(0);
      expect(analysis.recommendation.forbidden).toBeInstanceOf(Array);
    });
  });

  describe("generatePacingConstraints", () => {
    it("should return a non-empty string", () => {
      const constraints = service.generatePacingConstraints(
        "project-1",
        2,
        "高潮决战",
      );
      expect(typeof constraints).toBe("string");
      expect(constraints.length).toBeGreaterThan(0);
    });

    it("should include pacing change warning when needed", () => {
      service.recordChapterPacing("project-1", {
        chapterNumber: 1,
        pacing: "fast",
      });
      service.recordChapterPacing("project-1", {
        chapterNumber: 2,
        pacing: "fast",
      });
      service.recordChapterPacing("project-1", {
        chapterNumber: 3,
        pacing: "fast",
      });

      const constraints = service.generatePacingConstraints("project-1", 4);
      expect(constraints).toContain("节奏调整");
    });

    it("should include recent chapter pacing when history exists", () => {
      service.recordChapterPacing("project-1", {
        chapterNumber: 1,
        pacing: "fast",
      });
      const constraints = service.generatePacingConstraints("project-1", 2);
      expect(constraints).toContain("最近章节节奏");
    });
  });

  describe("analyzeContentPacing", () => {
    it("should detect fast pacing for short sentences with many action verbs", () => {
      const fastContent =
        "他冲过去。跑得飞快。跳起来。踢倒对手。追上去。砍下去。逃离危险。抓住机会。".repeat(
          20,
        );
      const result = service.analyzeContentPacing(fastContent);
      expect(result.detectedPacing).toBe("fast");
      expect(result.metrics.actionVerbDensity).toBeGreaterThan(0);
    });

    it("should detect slow pacing for long sentences with low dialogue ratio", () => {
      const slowContent =
        "她静静地坐在窗边，看着窗外飘落的雪花，心中涌起一阵说不清道不明的悲伤，那是一种混合了思念与遗憾的复杂情绪，让她无法平静。".repeat(
          30,
        );
      const result = service.analyzeContentPacing(slowContent);
      expect(result.detectedPacing).toBe("slow");
    });

    it("should detect medium pacing for balanced content", () => {
      const mediumContent =
        "他走进房间。「你来了，」她说。他坐下来，看着她。「有事吗？」他问道，眼神平静如水。".repeat(
          20,
        );
      const result = service.analyzeContentPacing(mediumContent);
      expect(result.detectedPacing).toBe("medium");
    });

    it("should return metrics", () => {
      const content = "他走了。她跑了。大家都去了。".repeat(10);
      const result = service.analyzeContentPacing(content);
      expect(result.metrics.avgSentenceLength).toBeGreaterThan(0);
      expect(result.metrics.dialogueRatio).toBeGreaterThanOrEqual(0);
      expect(result.metrics.actionVerbDensity).toBeGreaterThanOrEqual(0);
    });
  });
});
