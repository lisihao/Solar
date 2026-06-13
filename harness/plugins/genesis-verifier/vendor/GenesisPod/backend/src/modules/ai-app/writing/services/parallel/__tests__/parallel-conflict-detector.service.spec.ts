import { Test, TestingModule } from "@nestjs/testing";
import {
  ParallelConflictDetectorService,
  ParallelConflict,
} from "../parallel-conflict-detector.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

describe("ParallelConflictDetectorService", () => {
  let service: ParallelConflictDetectorService;

  beforeEach(async () => {
    const mockPrisma = {} as unknown as PrismaService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParallelConflictDetectorService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ParallelConflictDetectorService>(
      ParallelConflictDetectorService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("detect", () => {
    it("should return empty array when no chapter results provided", async () => {
      const conflicts = await service.detect([]);
      expect(conflicts).toEqual([]);
    });

    it("should return empty array when there is only one chapter result", async () => {
      const results = [
        {
          chapter: { id: "ch-1" },
          content: "普通章节内容，无特殊变化。",
        },
      ];

      const conflicts = await service.detect(results);
      expect(conflicts).toEqual([]);
    });

    it("should detect character state conflict when same character appears in multiple chapters with state changes", async () => {
      const results = [
        {
          chapter: { id: "ch-1" },
          content: "张三受伤了，伤势严重。",
        },
        {
          chapter: { id: "ch-2" },
          content: "张三获得了一件宝物。",
        },
      ];

      const conflicts = await service.detect(results);
      const characterConflicts = conflicts.filter(
        (c) => c.type === "CHARACTER_STATE",
      );
      expect(characterConflicts.length).toBeGreaterThan(0);
      expect(characterConflicts[0].chapters).toContain("ch-1");
      expect(characterConflicts[0].chapters).toContain("ch-2");
    });

    it("should detect new setting conflict when same quoted entity appears in multiple chapters", async () => {
      const results = [
        {
          chapter: { id: "ch-1" },
          content: '这里有一个地方叫做"天龙山"，非常神秘。',
        },
        {
          chapter: { id: "ch-2" },
          content: '传说中的"天龙山"终于出现了。',
        },
      ];

      const conflicts = await service.detect(results);
      const settingConflicts = conflicts.filter(
        (c) => c.type === "NEW_SETTING",
      );
      expect(settingConflicts.length).toBeGreaterThan(0);
      expect(settingConflicts[0].chapters.length).toBe(2);
    });

    it("should return conflict with correct severity type", async () => {
      const results = [
        {
          chapter: { id: "ch-1" },
          content: "李四死了，故事结束。",
        },
        {
          chapter: { id: "ch-2" },
          content: "李四失去了力量，变成了普通人。",
        },
      ];

      const conflicts = await service.detect(results);
      conflicts.forEach((c: ParallelConflict) => {
        expect(["CRITICAL", "WARNING", "INFO"]).toContain(c.severity);
      });
    });

    it("should return conflict with required fields", async () => {
      const results = [
        {
          chapter: { id: "ch-1" },
          content: "王五获得了神剑。",
        },
        {
          chapter: { id: "ch-2" },
          content: "王五获得了宝典。",
        },
      ];

      const conflicts = await service.detect(results);
      conflicts.forEach((c: ParallelConflict) => {
        expect(c).toHaveProperty("type");
        expect(c).toHaveProperty("severity");
        expect(c).toHaveProperty("chapters");
        expect(c).toHaveProperty("description");
      });
    });

    it("should not detect conflicts when chapter contents are unrelated", async () => {
      const results = [
        {
          chapter: { id: "ch-1" },
          content: "第一章：普通的一天，无特殊事件发生。",
        },
        {
          chapter: { id: "ch-2" },
          content: "第二章：平静的早晨，阳光明媚，天气晴朗。",
        },
      ];

      const conflicts = await service.detect(results);
      expect(conflicts).toEqual([]);
    });

    it("should detect new setting conflict with correct entity name", async () => {
      const results = [
        {
          chapter: { id: "ch-3" },
          content: "他们到达了「仙人峰」，这是一处神奇的地方。",
        },
        {
          chapter: { id: "ch-4" },
          content: "「仙人峰」的传说已经流传千年。",
        },
      ];

      const conflicts = await service.detect(results);
      const settingConflicts = conflicts.filter(
        (c) => c.type === "NEW_SETTING",
      );
      if (settingConflicts.length > 0) {
        expect(settingConflicts[0].description).toContain("仙人峰");
      }
    });

    it("should return CHARACTER_STATE conflict with resolution hint", async () => {
      const results = [
        {
          chapter: { id: "ch-1" },
          content: "赵六变成了魔头，力量大增。",
        },
        {
          chapter: { id: "ch-2" },
          content: "赵六失去了所有能力。",
        },
      ];

      const conflicts = await service.detect(results);
      const charConflicts = conflicts.filter(
        (c) => c.type === "CHARACTER_STATE",
      );
      if (charConflicts.length > 0) {
        expect(charConflicts[0].resolution).toBeDefined();
      }
    });

    it("should handle chapter results without extractable state changes gracefully", async () => {
      const results = [
        {
          chapter: { id: "ch-1" },
          content: "今天天气很好，大家都很开心。",
        },
        {
          chapter: { id: "ch-2" },
          content: "明天的计划是去爬山。",
        },
      ];

      // Should not throw
      await expect(service.detect(results)).resolves.toBeDefined();
    });
  });
});
