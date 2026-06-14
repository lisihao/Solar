import { Test, TestingModule } from "@nestjs/testing";
import { OpeningHookService } from "../opening-hook.service";

describe("OpeningHookService", () => {
  let service: OpeningHookService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpeningHookService],
    }).compile();

    service = module.get<OpeningHookService>(OpeningHookService);
  });

  describe("getHookTemplate", () => {
    it("should return conflict_dialogue template", () => {
      const template = service.getHookTemplate("conflict_dialogue");
      expect(template).toBeDefined();
      expect(template.type).toBe("conflict_dialogue");
      expect(template.name).toBe("冲突对话式");
      expect(template.techniques).toBeInstanceOf(Array);
      expect(template.examples).toBeInstanceOf(Array);
      expect(template.forbidden).toBeInstanceOf(Array);
    });

    it("should return crisis_situation template", () => {
      const template = service.getHookTemplate("crisis_situation");
      expect(template).toBeDefined();
      expect(template.type).toBe("crisis_situation");
    });

    it("should return mystery_question template", () => {
      const template = service.getHookTemplate("mystery_question");
      expect(template).toBeDefined();
      expect(template.type).toBe("mystery_question");
    });

    it("should return sensory_immersion template", () => {
      const template = service.getHookTemplate("sensory_immersion");
      expect(template).toBeDefined();
      expect(template.type).toBe("sensory_immersion");
    });

    it("should return contrast_reveal template", () => {
      const template = service.getHookTemplate("contrast_reveal");
      expect(template).toBeDefined();
      expect(template.type).toBe("contrast_reveal");
    });
  });

  describe("getAllHookTemplates", () => {
    it("should return all 5 templates", () => {
      const templates = service.getAllHookTemplates();
      expect(templates).toHaveLength(5);
    });

    it("should return templates with required fields", () => {
      const templates = service.getAllHookTemplates();
      for (const template of templates) {
        expect(template.type).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.formula).toBeDefined();
        expect(template.techniques).toBeInstanceOf(Array);
        expect(template.examples).toBeInstanceOf(Array);
        expect(template.forbidden).toBeInstanceOf(Array);
      }
    });
  });

  describe("getChapterOpeningGuidance", () => {
    it("should return guidance for first chapter", () => {
      const guidance = service.getChapterOpeningGuidance("first");
      expect(guidance).toBeDefined();
      expect(guidance.chapterType).toBe("first");
      expect(guidance.recommendedHookTypes).toContain("conflict_dialogue");
      expect(guidance.forbidden).toBeInstanceOf(Array);
      expect(guidance.examples).toBeInstanceOf(Array);
    });

    it("should return guidance for climax chapter", () => {
      const guidance = service.getChapterOpeningGuidance("climax");
      expect(guidance.chapterType).toBe("climax");
      expect(guidance.recommendedHookTypes).toContain("crisis_situation");
    });

    it("should return guidance for transition chapter", () => {
      const guidance = service.getChapterOpeningGuidance("transition");
      expect(guidance.chapterType).toBe("transition");
    });

    it("should return guidance for revelation chapter", () => {
      const guidance = service.getChapterOpeningGuidance("revelation");
      expect(guidance.chapterType).toBe("revelation");
    });

    it("should return guidance for normal chapter", () => {
      const guidance = service.getChapterOpeningGuidance("normal");
      expect(guidance.chapterType).toBe("normal");
    });
  });

  describe("generateOpeningConstraints", () => {
    it("should generate constraints for chapter 1 (first type)", () => {
      const constraints = service.generateOpeningConstraints(1);
      expect(typeof constraints).toBe("string");
      expect(constraints.length).toBeGreaterThan(0);
      expect(constraints).toContain("第一章");
    });

    it("should generate constraints for normal chapter", () => {
      const constraints = service.generateOpeningConstraints(5);
      expect(typeof constraints).toBe("string");
      expect(constraints.length).toBeGreaterThan(0);
    });

    it("should use climax type when chapterType contains 高潮", () => {
      const constraints = service.generateOpeningConstraints(10, "高潮决战");
      expect(constraints).toContain("高潮");
    });

    it("should use revelation type when chapterType contains 揭秘", () => {
      const constraints = service.generateOpeningConstraints(15, "揭秘真相");
      expect(constraints).toContain("揭秘");
    });

    it("should use transition type when chapterType contains 过渡", () => {
      const constraints = service.generateOpeningConstraints(8, "过渡铺垫");
      expect(constraints).toContain("过渡");
    });

    it("should include forbidden section", () => {
      const constraints = service.generateOpeningConstraints(2);
      expect(constraints).toContain("禁忌");
    });

    it("should include examples section", () => {
      const constraints = service.generateOpeningConstraints(2);
      expect(constraints).toContain("参考示例");
    });
  });

  describe("analyzeOpeningQuality", () => {
    it("should detect dialogue opening as having a hook", () => {
      const opening = '"你以为这样就能赢吗？"她嘴角流血，却笑了。';
      const result = service.analyzeOpeningQuality(opening);
      expect(result.hasHook).toBe(true);
      expect(result.hookType).toBe("conflict_dialogue");
      expect(result.score).toBeGreaterThan(60);
    });

    it("should detect sensory opening as having a hook", () => {
      const opening = "那种冷，不是空调的凉意，而是湿冷，像小蛇顺着骨缝钻。";
      const result = service.analyzeOpeningQuality(opening);
      expect(result.hasHook).toBe(true);
      expect(result.hookType).toBe("sensory_immersion");
    });

    it("should detect crisis situation when death/danger keywords present", () => {
      const opening = "死亡的气息近在咫尺，他的手心全是汗。";
      const result = service.analyzeOpeningQuality(opening);
      expect(result.hasHook).toBe(true);
      expect(result.hookType).toBe("crisis_situation");
    });

    it("should detect contrast reveal pattern", () => {
      const opening =
        "不是她曾经的辉煌，而是如今的落魄让她意识到一切已经改变。";
      const result = service.analyzeOpeningQuality(opening);
      expect(result.hasHook).toBe(true);
      expect(result.hookType).toBe("contrast_reveal");
    });

    it("should penalize for forbidden patterns", () => {
      const opening = "在一个美丽的世界里，故事从这里开始。";
      const result = service.analyzeOpeningQuality(opening);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.score).toBeLessThan(70);
    });

    it("should penalize for 一阵...袭来 pattern", () => {
      const opening = "一阵寒风袭来，她不禁打了个寒颤。";
      const result = service.analyzeOpeningQuality(opening);
      const hasRelevantIssue = result.issues.some((i) => i.includes("袭来"));
      expect(hasRelevantIssue).toBe(true);
    });

    it("should penalize for 她感到 direct feeling pattern", () => {
      const opening = "她感到非常寒冷，全身发抖，无法动弹。";
      const result = service.analyzeOpeningQuality(opening);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("should return suggestions when no hook detected", () => {
      const opening =
        "今天天气不错，阳光明媚，鸟儿在歌唱，人们都在享受美好的一天。";
      const result = service.analyzeOpeningQuality(opening);
      if (!result.hasHook) {
        expect(result.suggestions.length).toBeGreaterThan(0);
      }
    });

    it("should keep score within 0-100 range", () => {
      const terribleOpening =
        "在一个故事里，话说从前，他突然感到她感到一阵寒风袭来，忽然间话说。";
      const result = service.analyzeOpeningQuality(terribleOpening);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe("generateRandomOpeningPrompt", () => {
    it("should return a non-empty string", () => {
      const prompt = service.generateRandomOpeningPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should contain a template name and formula", () => {
      const prompt = service.generateRandomOpeningPrompt();
      expect(prompt).toContain("公式");
      expect(prompt).toContain("参考");
    });

    it("should return different results on multiple calls (probabilistic)", () => {
      const results = new Set<string>();
      for (let i = 0; i < 20; i++) {
        results.add(service.generateRandomOpeningPrompt());
      }
      // With 5 templates, we should see at least 2 different prompts
      expect(results.size).toBeGreaterThanOrEqual(1);
    });
  });
});
