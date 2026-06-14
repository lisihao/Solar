import { Test, TestingModule } from "@nestjs/testing";
import { PreWriteInjectionService } from "../pre-write-injection.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { BibleSnapshot } from "../../bible/bible-entity.types";

describe("PreWriteInjectionService", () => {
  let service: PreWriteInjectionService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const mockBibleSnapshot: BibleSnapshot = {
    characters: [
      {
        id: "char-1",
        name: "张三",
        aliases: ["小张", "三哥"],
        role: "PROTAGONIST",
      },
      {
        id: "char-2",
        name: "李四",
        aliases: [],
        role: "ANTAGONIST",
      },
    ],
    worldSettings: [
      {
        id: "ws-1",
        name: "天龙山",
        description: "这是一座神秘的山脉，位于北方",
      },
      {
        id: "ws-2",
        name: "皇城",
        description: "帝国的首都，繁华无比",
      },
    ],
    terminologies: [{ id: "term-1", term: "灵力" }],
    timelineEvents: [{ id: "evt-1", eventName: "大战" }],
  };

  beforeEach(async () => {
    mockPrisma = {
      writingChapter: {
        findUnique: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreWriteInjectionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PreWriteInjectionService>(PreWriteInjectionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("injectContext", () => {
    it("should return injected:false when chapter is not found", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.injectContext("ch-1", mockBibleSnapshot);

      expect(result.injected).toBe(false);
      expect(result.reason).toBe("No outline available");
    });

    it("should return injected:false when chapter has no outline", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        id: "ch-1",
        outline: null,
      });

      const result = await service.injectContext("ch-1", mockBibleSnapshot);

      expect(result.injected).toBe(false);
      expect(result.reason).toBe("No outline available");
    });

    it("should return injected:false when chapter outline is empty string", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        id: "ch-1",
        outline: "",
      });

      const result = await service.injectContext("ch-1", mockBibleSnapshot);

      expect(result.injected).toBe(false);
    });

    it("should inject relevant characters from outline when chapter has outline", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        id: "ch-1",
        outline: '"张三" 在天龙山遇到了危险，需要逃脱。',
      });

      const result = await service.injectContext("ch-1", mockBibleSnapshot);

      expect(result.injected).toBe(true);
      expect(result.context).toBeDefined();
      expect(result.context!.characters).toBeDefined();
      // 张三 should be included because it's in the outline
      const charNames = result.context!.characters.map((c) => c.name);
      expect(charNames).toContain("张三");
    });

    it("should include matching characters by alias", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        id: "ch-1",
        outline: '"三哥" 出手相救，打败了对手。',
      });

      const result = await service.injectContext("ch-1", mockBibleSnapshot);

      expect(result.injected).toBe(true);
      const charNames = result.context!.characters.map((c) => c.name);
      expect(charNames).toContain("张三"); // 三哥 is an alias for 张三
    });

    it("should filter world settings based on locations in outline", async () => {
      // The location extractor uses pattern: (?:在|到|去|于)([^\s，。,\.]+)
      // So we use "在天龙山" or "到天龙山" for the regex to match
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        id: "ch-1",
        outline: "主角去天龙山，开始了新的修炼旅程。",
      });

      const result = await service.injectContext("ch-1", mockBibleSnapshot);

      expect(result.injected).toBe(true);
      const settingNames = result.context!.worldSettings.map((s) => s.name);
      expect(settingNames).toContain("天龙山");
    });

    it("should always include terminologies and timeline events from bible snapshot", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        id: "ch-1",
        outline: '"张三" 去了旅行。',
      });

      const result = await service.injectContext("ch-1", mockBibleSnapshot);

      expect(result.injected).toBe(true);
      expect(result.context!.terminology).toEqual(
        mockBibleSnapshot.terminologies,
      );
      expect(result.context!.timeline).toEqual(
        mockBibleSnapshot.timelineEvents,
      );
    });

    it("should return empty characters when outline mentions no matching characters", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        id: "ch-1",
        outline: "一个神秘的陌生人出现了，他来自遥远的地方。",
      });

      const result = await service.injectContext("ch-1", mockBibleSnapshot);

      expect(result.injected).toBe(true);
      // No matching characters since no quoted names matching bible
      expect(result.context!.characters).toEqual([]);
    });

    it("should not include character that is NOT mentioned in outline", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        id: "ch-1",
        outline: '"张三" 独自行动，没有其他人。',
      });

      const result = await service.injectContext("ch-1", mockBibleSnapshot);

      expect(result.injected).toBe(true);
      const charNames = result.context!.characters.map((c) => c.name);
      expect(charNames).not.toContain("李四");
    });

    it("should handle empty bible snapshot gracefully", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        id: "ch-1",
        outline: '"张三" 前往天龙山修炼。',
      });

      const emptyBible: BibleSnapshot = {
        characters: [],
        worldSettings: [],
        terminologies: [],
        timelineEvents: [],
      };

      const result = await service.injectContext("ch-1", emptyBible);

      expect(result.injected).toBe(true);
      expect(result.context!.characters).toEqual([]);
      expect(result.context!.worldSettings).toEqual([]);
    });
  });
});
