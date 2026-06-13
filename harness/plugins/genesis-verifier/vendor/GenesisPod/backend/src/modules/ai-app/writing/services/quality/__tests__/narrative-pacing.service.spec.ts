import { Test, TestingModule } from "@nestjs/testing";
import { NarrativePacingService } from "../narrative-pacing.service";
import { PrismaService } from "@/common/prisma/prisma.service";

describe("NarrativePacingService", () => {
  let service: NarrativePacingService;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    mockPrisma = {
      writingChapter: {
        findMany: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NarrativePacingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<NarrativePacingService>(NarrativePacingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("analyzeChapterPacing", () => {
    it("should detect action keywords and return high pacing score", () => {
      const content =
        "主角决定采取行动，主动出手反击，选择了正确的方案，做出了决断";
      const result = service.analyzeChapterPacing(content);

      expect(result.hasProtagonistAction).toBe(true);
      expect(result.actionKeywords.length).toBeGreaterThan(0);
      expect(result.pacingScore).toBeGreaterThan(0.3);
    });

    it("should detect passive keywords and mark chapter as passive", () => {
      const content =
        "她只能看着，无能为力，只好袖手旁观，默默注视，束手无策，不敢，无法";
      const result = service.analyzeChapterPacing(content);

      expect(result.passiveKeywords.length).toBeGreaterThan(3);
      expect(result.isPassiveChapter).toBe(true);
    });

    it("should detect DIALOGUE opening type", () => {
      const content = '"你好吗？" 她问道。然后故事继续发展下去。';
      const result = service.analyzeChapterPacing(content);

      expect(result.openingType).toBe("DIALOGUE");
    });

    it("should detect ACTION opening type", () => {
      // Must start with action verb within first 30 chars, no dialogue marker
      const content = "走进房间，她快速扫视四周，开始了新的任务。";
      const result = service.analyzeChapterPacing(content);

      expect(result.openingType).toBe("ACTION");
    });

    it("should detect TIME_SKIP opening type", () => {
      // Must match time-skip pattern - avoid action verbs (走/跑/冲/闯/推开/踏入/来到) in first 30 chars
      const content = "三日后，天气依然阴沉，什么都没有改变。";
      const result = service.analyzeChapterPacing(content);

      expect(result.openingType).toBe("TIME_SKIP");
    });

    it("should detect INNER_THOUGHT opening type", () => {
      // Must start with inner thought before action
      const content = "心想此事非同小可，她暗自思量，需要仔细调查。";
      const result = service.analyzeChapterPacing(content);

      expect(result.openingType).toBe("INNER_THOUGHT");
    });

    it("should detect FLASHBACK opening type", () => {
      // Must match flashback before inner_thought - use 记得 which is not in inner_thought regex
      const content = "记得那年的往事，历历在目，令人难以忘怀。";
      const result = service.analyzeChapterPacing(content);

      expect(result.openingType).toBe("FLASHBACK");
    });

    it("should detect CLIFFHANGER_CONTINUATION opening type", () => {
      // Must match cliffhanger pattern - use 就在此时 which has no prior pattern match
      const content = "就在此时，所有人都屏住了呼吸，等待着结局。";
      const result = service.analyzeChapterPacing(content);

      expect(result.openingType).toBe("CLIFFHANGER_CONTINUATION");
    });

    it("should default to SCENE_DESCRIPTION for neutral content", () => {
      const content = "月光洒在地板上，整个房间笼罩在一片静谧之中。";
      const result = service.analyzeChapterPacing(content);

      expect(result.openingType).toBe("SCENE_DESCRIPTION");
    });

    it("should return pacing score between 0 and 1", () => {
      const content = "主角决定行动";
      const result = service.analyzeChapterPacing(content);

      expect(result.pacingScore).toBeGreaterThanOrEqual(0);
      expect(result.pacingScore).toBeLessThanOrEqual(1);
    });

    it("should handle empty content gracefully", () => {
      const result = service.analyzeChapterPacing("");

      expect(result.actionKeywords).toHaveLength(0);
      expect(result.passiveKeywords).toHaveLength(0);
      expect(result.openingType).toBe("SCENE_DESCRIPTION");
    });
  });

  describe("getPacingConstraints", () => {
    it("should return constraints with no forced action when no passive chapters", async () => {
      const activeChapterContent = "主角决定行动，选择了正确路径，主动出击";
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { content: activeChapterContent, chapterNumber: 1 },
        { content: activeChapterContent, chapterNumber: 2 },
      ]);

      const result = await service.getPacingConstraints("proj-1", 3);

      expect(result.forceProtagonistAction).toBe(false);
      expect(result.consecutivePassiveCount).toBe(0);
      expect(result.pacingPrompt).toContain("叙事节奏约束");
    });

    it("should force protagonist action after 2 consecutive passive chapters", async () => {
      const passiveContent =
        "只能看着，默默注视，无能为力，只好，束手无策，不敢，无法，只好袖手旁观";
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { content: passiveContent, chapterNumber: 2 },
        { content: passiveContent, chapterNumber: 1 },
      ]);

      const result = await service.getPacingConstraints("proj-1", 3);

      expect(result.forceProtagonistAction).toBe(true);
      expect(result.consecutivePassiveCount).toBeGreaterThanOrEqual(2);
      expect(result.pacingPrompt).toContain("强制要求");
    });

    it("should suggest opening types different from recent ones", async () => {
      const dialogueContent = '"你好吗？" 她问道。主角决定了一些事情';
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { content: dialogueContent, chapterNumber: 1 },
      ]);

      const result = await service.getPacingConstraints("proj-1", 2);

      expect(result.avoidOpeningTypes).toContain("DIALOGUE");
      expect(result.suggestedOpeningTypes).not.toContain("DIALOGUE");
    });

    it("should return empty suggested types when all types are avoided", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getPacingConstraints("proj-1", 1);

      expect(result.pacingPrompt).toBeDefined();
      expect(typeof result.pacingPrompt).toBe("string");
    });
  });

  describe("recordChapterPacing", () => {
    it("should analyze and return chapter pacing analysis", async () => {
      const content = "主角决定主动出手，采取了行动";
      const result = await service.recordChapterPacing(
        "proj-1",
        "chap-1",
        1,
        content,
      );

      expect(result).toBeDefined();
      expect(result.hasProtagonistAction).toBe(true);
    });

    it("should handle empty content in record", async () => {
      const result = await service.recordChapterPacing(
        "proj-1",
        "chap-1",
        1,
        "",
      );

      expect(result).toBeDefined();
      expect(result.openingType).toBe("SCENE_DESCRIPTION");
    });
  });
});
