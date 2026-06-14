import { Test, TestingModule } from "@nestjs/testing";
import { ForeshadowingService, Foreshadow } from "../foreshadowing.service";

describe("ForeshadowingService", () => {
  let service: ForeshadowingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ForeshadowingService],
    }).compile();

    service = module.get<ForeshadowingService>(ForeshadowingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("plantForeshadow", () => {
    it("should create a new foreshadow with generated id and planted status", () => {
      const input: Omit<Foreshadow, "id" | "status"> = {
        type: "mystery",
        hint: "她意味深长地笑了笑",
        chapterPlanted: 1,
        importance: "major",
      };

      const result = service.plantForeshadow("proj-1", input);

      expect(result.id).toMatch(/^fs_/);
      expect(result.status).toBe("planted");
      expect(result.type).toBe("mystery");
      expect(result.hint).toBe(input.hint);
      expect(result.chapterPlanted).toBe(1);
    });

    it("should add foreshadow to the project store", () => {
      service.plantForeshadow("proj-1", {
        type: "chekhov",
        hint: "随手捡起的铜钱",
        chapterPlanted: 2,
        importance: "minor",
      });

      const pending = service.getPendingForeshadows("proj-1");
      expect(pending).toHaveLength(1);
    });

    it("should generate unique ids for each foreshadow", () => {
      const f1 = service.plantForeshadow("proj-1", {
        type: "mystery",
        hint: "hint 1",
        chapterPlanted: 1,
        importance: "minor",
      });

      const f2 = service.plantForeshadow("proj-1", {
        type: "mystery",
        hint: "hint 2",
        chapterPlanted: 1,
        importance: "minor",
      });

      expect(f1.id).not.toBe(f2.id);
    });

    it("should support optional fields", () => {
      const result = service.plantForeshadow("proj-1", {
        type: "character",
        hint: "角色身上有奇怪的伤疤",
        chapterPlanted: 3,
        importance: "major",
        relatedCharacters: ["李明"],
        chapterToReveal: 10,
      });

      expect(result.relatedCharacters).toContain("李明");
      expect(result.chapterToReveal).toBe(10);
    });
  });

  describe("revealForeshadow", () => {
    it("should mark foreshadow as revealed", () => {
      const planted = service.plantForeshadow("proj-1", {
        type: "mystery",
        hint: "test hint",
        chapterPlanted: 1,
        importance: "major",
      });

      const success = service.revealForeshadow(
        "proj-1",
        planted.id,
        5,
        "secret revealed",
      );

      expect(success).toBe(true);
      const pending = service.getPendingForeshadows("proj-1");
      expect(pending.find((f) => f.id === planted.id)).toBeUndefined();
    });

    it("should return false when project not found", () => {
      const result = service.revealForeshadow("nonexistent", "some-id", 5);
      expect(result).toBe(false);
    });

    it("should return false when foreshadow id not found", () => {
      service.plantForeshadow("proj-1", {
        type: "mystery",
        hint: "test",
        chapterPlanted: 1,
        importance: "minor",
      });

      const result = service.revealForeshadow("proj-1", "nonexistent-id", 5);
      expect(result).toBe(false);
    });
  });

  describe("getPendingForeshadows", () => {
    it("should return empty array for new project", () => {
      const result = service.getPendingForeshadows("new-proj");
      expect(result).toHaveLength(0);
    });

    it("should not return revealed foreshadows", () => {
      const planted = service.plantForeshadow("proj-1", {
        type: "mystery",
        hint: "test",
        chapterPlanted: 1,
        importance: "minor",
      });

      service.revealForeshadow("proj-1", planted.id, 5);

      const pending = service.getPendingForeshadows("proj-1");
      expect(pending).toHaveLength(0);
    });

    it("should return multiple planted foreshadows", () => {
      service.plantForeshadow("proj-2", {
        type: "mystery",
        hint: "hint 1",
        chapterPlanted: 1,
        importance: "major",
      });
      service.plantForeshadow("proj-2", {
        type: "chekhov",
        hint: "hint 2",
        chapterPlanted: 2,
        importance: "minor",
      });

      const pending = service.getPendingForeshadows("proj-2");
      expect(pending).toHaveLength(2);
    });
  });

  describe("getShouldRevealThisChapter", () => {
    it("should return foreshadow with explicit reveal chapter that has passed", () => {
      service.plantForeshadow("proj-1", {
        type: "mystery",
        hint: "test",
        chapterPlanted: 1,
        importance: "major",
        chapterToReveal: 5,
      });

      const toReveal = service.getShouldRevealThisChapter("proj-1", 6);
      expect(toReveal).toHaveLength(1);
    });

    it("should return chekhov foreshadow after 10 chapters", () => {
      service.plantForeshadow("proj-1", {
        type: "chekhov",
        hint: "铜钱",
        chapterPlanted: 1,
        importance: "minor",
      });

      const toReveal = service.getShouldRevealThisChapter("proj-1", 11);
      expect(toReveal).toHaveLength(1);
    });

    it("should return minor foreshadow after 5 chapters", () => {
      service.plantForeshadow("proj-1", {
        type: "mystery",
        hint: "minor hint",
        chapterPlanted: 1,
        importance: "minor",
      });

      const toReveal = service.getShouldRevealThisChapter("proj-1", 6);
      expect(toReveal).toHaveLength(1);
    });

    it("should not return recently planted foreshadows", () => {
      service.plantForeshadow("proj-1", {
        type: "mystery",
        hint: "very new hint",
        chapterPlanted: 5,
        importance: "major",
      });

      const toReveal = service.getShouldRevealThisChapter("proj-1", 6);
      expect(toReveal).toHaveLength(0);
    });
  });

  describe("generateForeshadowingGuidance", () => {
    it("should return guidance with suggestions for chapter 1", () => {
      const result = service.generateForeshadowingGuidance("proj-1", 1);

      expect(result.suggestedNewForeshadows).toContainEqual(
        expect.stringContaining("第一章"),
      );
      expect(result.constraintPrompt).toContain("伏笔管理");
    });

    it("should include constraint prompt with foreshadow techniques", () => {
      const result = service.generateForeshadowingGuidance("proj-1", 5);

      expect(result.constraintPrompt).toContain("伏笔技巧");
      expect(result.constraintPrompt).toContain("契诃夫之枪");
    });

    it("should indicate climax chapter suggestions for 高潮 type", () => {
      const result = service.generateForeshadowingGuidance(
        "proj-1",
        10,
        "高潮决战",
      );

      expect(
        result.suggestedNewForeshadows.some((s) => s.includes("高潮")),
      ).toBe(true);
    });

    it("should list pending foreshadows that should be revealed", () => {
      service.plantForeshadow("proj-reveal", {
        type: "chekhov",
        hint: "overdue chekhov",
        chapterPlanted: 1,
        importance: "minor",
      });

      const result = service.generateForeshadowingGuidance("proj-reveal", 15);

      expect(result.shouldRevealThisChapter).toHaveLength(1);
      expect(result.constraintPrompt).toContain("本章应回收的伏笔");
    });
  });

  describe("extractPotentialForeshadows", () => {
    it("should detect mystery foreshadow patterns", async () => {
      const content = "他意味深长地笑了";
      const result = await service.extractPotentialForeshadows(content, 1);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe("mystery");
    });

    it("should return empty array for plain content", async () => {
      const content = "今天天气很好，大家一起出去玩了。";
      const result = await service.extractPotentialForeshadows(content, 1);

      expect(result).toHaveLength(0);
    });
  });

  describe("getForeshadowStats", () => {
    it("should return zeroed stats for new project", () => {
      const stats = service.getForeshadowStats("brand-new");

      expect(stats.total).toBe(0);
      expect(stats.planted).toBe(0);
      expect(stats.revealed).toBe(0);
    });

    it("should correctly count planted and revealed foreshadows", () => {
      const f = service.plantForeshadow("proj-stats", {
        type: "mystery",
        hint: "test",
        chapterPlanted: 1,
        importance: "minor",
      });
      service.plantForeshadow("proj-stats", {
        type: "chekhov",
        hint: "test 2",
        chapterPlanted: 2,
        importance: "minor",
      });

      service.revealForeshadow("proj-stats", f.id, 5);

      const stats = service.getForeshadowStats("proj-stats");
      expect(stats.total).toBe(2);
      expect(stats.planted).toBe(1);
      expect(stats.revealed).toBe(1);
    });
  });
});
