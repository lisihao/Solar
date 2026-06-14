import { Test, TestingModule } from "@nestjs/testing";
import { ChapterQualityEvaluatorService } from "../chapter-quality-evaluator.service";

describe("ChapterQualityEvaluatorService", () => {
  let service: ChapterQualityEvaluatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChapterQualityEvaluatorService],
    }).compile();

    service = module.get<ChapterQualityEvaluatorService>(
      ChapterQualityEvaluatorService,
    );
  });

  describe("quickEvaluate", () => {
    const richContent = `
"斗之力，三段！"萧炎的声音平静，却让周围人倒吸一口冷气。

三年前，他是天才；三年后，他却停在了最低级的三段斗气，一直无法突破。

他走进训练场，看见一群弟子在努力修炼。冷风吹来，吹起他的衣袍。

"废物！"有人低声嘲笑，他充耳不闻，继续前行。

"萧炎，你还来这里丢人？"一个身穿华服的青年走来，眼神充满轻蔑。

萧炎转过头，看着这个曾经不如自己的人，心中涌起一丝悲哀，但随即平复。

他低下头，继续修炼。冰冷的地面上，他的手掌紧紧握住。

汗水从额头滑落，浸湿了衣领。他感到全身发热，内力似乎在涌动。

然而，每次到达临界点，能量便无端流失，如同握不住的水。

他叹了口气，静静地坐下来，感受着体内微弱的斗气波动。

"不知道还要多久，"他低声自语，声音在空旷的训练场里回响。

夕阳西下，他仍未离去，坚守在那片让无数人嘲笑却又让他坚持的地方。
`.repeat(3);

    it("should return a partial quality report", () => {
      const result = service.quickEvaluate(richContent, 1);
      expect(result).toBeDefined();
      expect(result.chapterNumber).toBe(1);
      expect(result.overallScore).toBeDefined();
      expect(typeof result.overallScore).toBe("number");
    });

    it("should return a grade", () => {
      const result = service.quickEvaluate(richContent, 2);
      expect(result.grade).toBeDefined();
      expect(["A", "B", "C", "D", "F"]).toContain(result.grade);
    });

    it("should return passed field based on score", () => {
      const result = service.quickEvaluate(richContent, 3);
      if (result.overallScore !== undefined) {
        expect(result.passed).toBe(result.overallScore >= 60);
      }
    });

    it("should include writing quality metrics", () => {
      const result = service.quickEvaluate(richContent, 1);
      expect(result.writingQuality).toBeDefined();
      expect(result.writingQuality?.sentenceFluency).toBeDefined();
      expect(result.writingQuality?.descriptionVividness).toBeDefined();
      expect(result.writingQuality?.dialogueNaturalness).toBeDefined();
      expect(result.writingQuality?.pacingControl).toBeDefined();
    });

    it("should include content quality metrics", () => {
      const result = service.quickEvaluate(richContent, 1);
      expect(result.contentQuality).toBeDefined();
      expect(result.contentQuality?.openingHook).toBeDefined();
      expect(result.contentQuality?.plotProgression).toBeDefined();
      expect(result.contentQuality?.characterDepiction).toBeDefined();
      expect(result.contentQuality?.emotionalResonance).toBeDefined();
      expect(result.contentQuality?.endingQuality).toBeDefined();
    });

    it("should track zero cost for quick evaluation", () => {
      const result = service.quickEvaluate(richContent, 1);
      expect(result.cost).toBeDefined();
      expect(result.cost?.tokensUsed).toBe(0);
      expect(result.cost?.apiCalls).toBe(0);
      expect(result.cost?.estimatedCostUsd).toBe(0);
    });

    it("should include evaluatedAt timestamp", () => {
      const result = service.quickEvaluate(richContent, 1);
      expect(result.evaluatedAt).toBeInstanceOf(Date);
    });

    it("should detect ending quality issues for summarizing endings", () => {
      const contentWithBadEnding =
        richContent + "\n\n他心中燃起斗志，暗暗发誓绝不放弃。";
      const result = service.quickEvaluate(contentWithBadEnding, 5);
      const endingIssues = result.contentQuality?.endingQuality.issues;
      expect(endingIssues?.length).toBeGreaterThan(0);
    });

    it("should give lower score to content with poor opening hook for chapter 1", () => {
      const contentWithBadOpening =
        "在一个美丽的世界里，有一个少年叫萧炎。".repeat(10) +
        "他非常厉害但却很弱。".repeat(20);
      const result = service.quickEvaluate(contentWithBadOpening, 1);
      const openingScore = result.contentQuality?.openingHook.score ?? 100;
      expect(openingScore).toBeLessThan(100);
    });

    it("should detect dialogue ratio issues", () => {
      // Content with very low dialogue ratio
      const noDialogueContent =
        "他走过去。他看了看。他想了想。他感到困惑。他决定继续。他向前走去。".repeat(
          40,
        );
      const result = service.quickEvaluate(noDialogueContent, 2);
      const dialogueIssues =
        result.writingQuality?.dialogueNaturalness.issues ?? [];
      expect(dialogueIssues.length).toBeGreaterThan(0);
    });

    it("should detect conflict patterns for plot progression", () => {
      const contentWithoutConflict =
        "他去了学校。他学习了功课。他回到家。他吃了饭。他睡觉了。".repeat(30);
      const result = service.quickEvaluate(contentWithoutConflict, 2);
      const plotIssues = result.contentQuality?.plotProgression.issues ?? [];
      expect(plotIssues.length).toBeGreaterThan(0);
    });
  });

  describe("generateSummary", () => {
    it("should generate a summary string", () => {
      const mockReport = {
        chapterNumber: 1,
        overallScore: 75,
        grade: "B" as const,
        passed: true,
        writingQuality: {
          sentenceFluency: {
            name: "句式流畅度",
            score: 80,
            weight: 0.25,
            issues: [],
            suggestions: [],
          },
          descriptionVividness: {
            name: "描写生动性",
            score: 70,
            weight: 0.3,
            issues: ["描写不足"],
            suggestions: ["增加描写"],
          },
          dialogueNaturalness: {
            name: "对话自然度",
            score: 75,
            weight: 0.25,
            issues: [],
            suggestions: [],
          },
          pacingControl: {
            name: "节奏把控",
            score: 80,
            weight: 0.2,
            issues: [],
            suggestions: [],
          },
        },
        contentQuality: {
          openingHook: {
            name: "开篇吸引力",
            score: 90,
            weight: 0.25,
            issues: [],
            suggestions: [],
          },
          plotProgression: {
            name: "情节推进",
            score: 70,
            weight: 0.2,
            issues: [],
            suggestions: [],
          },
          characterDepiction: {
            name: "人物塑造",
            score: 75,
            weight: 0.2,
            issues: [],
            suggestions: [],
          },
          emotionalResonance: {
            name: "情感共鸣",
            score: 80,
            weight: 0.15,
            issues: [],
            suggestions: [],
          },
          endingQuality: {
            name: "结尾质量",
            score: 85,
            weight: 0.2,
            issues: [],
            suggestions: [],
          },
        },
        cost: {
          tokensUsed: 0,
          apiCalls: 0,
          processingTimeMs: 50,
          estimatedCostUsd: 0,
        },
      };

      const summary = service.generateSummary(mockReport);
      expect(typeof summary).toBe("string");
      expect(summary).toContain("第1章");
      expect(summary).toContain("75/100");
      expect(summary).toContain("B级");
    });

    it("should include writing issues in summary", () => {
      const mockReport = {
        chapterNumber: 2,
        overallScore: 55,
        grade: "D" as const,
        passed: false,
        writingQuality: {
          sentenceFluency: {
            name: "句式流畅度",
            score: 50,
            weight: 0.25,
            issues: ["句子过长"],
            suggestions: [],
          },
          descriptionVividness: {
            name: "描写生动性",
            score: 60,
            weight: 0.3,
            issues: [],
            suggestions: [],
          },
          dialogueNaturalness: {
            name: "对话自然度",
            score: 60,
            weight: 0.25,
            issues: [],
            suggestions: [],
          },
          pacingControl: {
            name: "节奏把控",
            score: 60,
            weight: 0.2,
            issues: [],
            suggestions: [],
          },
        },
        cost: {
          tokensUsed: 100,
          apiCalls: 2,
          processingTimeMs: 200,
          estimatedCostUsd: 0.01,
        },
      };

      const summary = service.generateSummary(mockReport);
      expect(summary).toContain("句子过长");
      expect(summary).toContain("200ms");
    });
  });
});
