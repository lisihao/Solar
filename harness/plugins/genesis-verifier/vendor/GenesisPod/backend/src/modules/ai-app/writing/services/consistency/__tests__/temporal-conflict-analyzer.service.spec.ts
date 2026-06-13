import { Test, TestingModule } from "@nestjs/testing";
import {
  TemporalConflictAnalyzerService,
  TemporalTriple,
} from "../temporal-conflict-analyzer.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("TemporalConflictAnalyzerService", () => {
  let service: TemporalConflictAnalyzerService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockAiFacade: jest.Mocked<ChatFacade>;

  const makeMockTriple = (
    partial: Partial<TemporalTriple> & {
      subject: string;
      predicate: string;
      chapterNumber: number;
    },
  ): TemporalTriple => ({
    tripleType: "STATE",
    validFrom: partial.chapterNumber,
    ...partial,
  });

  beforeEach(async () => {
    mockPrisma = {
      writingChapter: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    mockAiFacade = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({ triples: [] }),
        tokensUsed: 100,
      }),
    } as unknown as jest.Mocked<ChatFacade>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemporalConflictAnalyzerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<TemporalConflictAnalyzerService>(
      TemporalConflictAnalyzerService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("analyzeProject", () => {
    it("should return empty result when no chapters exist", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.analyzeProject("proj-1");

      expect(result.conflicts).toEqual([]);
      expect(result.conflictScore).toBe(0);
      expect(result.tripleCount).toBe(0);
    });

    it("should analyze all chapters and return conflict matrix", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { chapterNumber: 1, content: "Chapter 1 content", metadata: null },
        { chapterNumber: 2, content: "Chapter 2 content", metadata: null },
      ]);
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({ triples: [] }),
        tokensUsed: 50,
      });

      const result = await service.analyzeProject("proj-1");

      expect(result.analyzedChapters).toEqual([1, 2]);
      expect(result.conflictMatrix).toBeDefined();
      expect(Array.isArray(result.conflictMatrix)).toBe(true);
    });

    it("should include analyzedAt timestamp", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.analyzeProject("proj-1");

      expect(result.analyzedAt).toBeDefined();
      expect(typeof result.analyzedAt).toBe("string");
    });
  });

  describe("analyzeChapter", () => {
    it("should return conflict detection result for new chapter content", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([]);
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({ triples: [] }),
        tokensUsed: 50,
      });

      const result = await service.analyzeChapter(
        "proj-1",
        2,
        "Chapter 2 content that is long enough to process properly yes it is",
      );

      expect(result).toHaveProperty("conflicts");
      expect(result).toHaveProperty("conflictMatrix");
      expect(result).toHaveProperty("conflictScore");
      expect(result).toHaveProperty("analyzedChapters");
      expect(result).toHaveProperty("tripleCount");
    });

    it("should detect EXISTENCE conflict for entity reappearing after death", async () => {
      // Historical chapter has terminal state (loaded from metadata cache)
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        {
          chapterNumber: 1,
          content: "x".repeat(200),
          metadata: {
            triples: [
              makeMockTriple({
                subject: "英雄",
                predicate: "死亡",
                chapterNumber: 1,
                tripleType: "STATE",
              }),
            ],
          },
        },
      ]);

      // New chapter AI extracts an ACTION triple for the "dead" entity
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          triples: [
            {
              subject: "英雄",
              predicate: "战斗",
              tripleType: "ACTION",
            },
          ],
        }),
        tokensUsed: 50,
      });

      // Content must be >= 100 chars to trigger AI extraction
      const longContent = "英雄" + "x".repeat(200);
      const result = await service.analyzeChapter("proj-1", 2, longContent);

      const existenceConflicts = result.conflicts.filter(
        (c) => c.type === "EXISTENCE",
      );
      expect(existenceConflicts.length).toBeGreaterThan(0);
      expect(existenceConflicts[0].severity).toBe("CRITICAL");
    });

    it("should detect STATE conflict for contradictory states via analyzeChapter", async () => {
      // Historical triples loaded from metadata cache
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        {
          chapterNumber: 1,
          content: "x".repeat(200),
          metadata: {
            triples: [
              makeMockTriple({
                subject: "主角",
                predicate: "活",
                chapterNumber: 1,
                tripleType: "STATE",
              }),
            ],
          },
        },
      ]);

      // New chapter AI extracts contradicting STATE triple
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          triples: [
            {
              subject: "主角",
              predicate: "死",
              tripleType: "STATE",
            },
          ],
        }),
        tokensUsed: 50,
      });

      // Content must be >= 100 chars to trigger AI extraction
      const longContent = "x".repeat(200);
      const result = await service.analyzeChapter("proj-1", 2, longContent);

      const stateConflicts = result.conflicts.filter((c) => c.type === "STATE");
      expect(stateConflicts.length).toBeGreaterThan(0);
      expect(stateConflicts[0].severity).toBe("CRITICAL");
    });
  });

  describe("extractTriples", () => {
    it("should return empty array for short content", async () => {
      const result = await service.extractTriples("Short text", 1);
      expect(result).toEqual([]);
    });

    it("should return empty array for empty content", async () => {
      const result = await service.extractTriples("", 1);
      expect(result).toEqual([]);
    });

    it("should call AI facade for content longer than 100 chars", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          triples: [
            {
              subject: "张三",
              predicate: "到达",
              tripleType: "LOCATION",
              object: "北京",
            },
          ],
        }),
        tokensUsed: 80,
      });

      // Must be at least 100 characters in JS string length
      const longContent =
        "张三到达了北京，开始了他的新生活。" + "x".repeat(100);
      const result = await service.extractTriples(longContent, 3);

      expect(mockAiFacade.chat).toHaveBeenCalled();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].subject).toBe("张三");
      expect(result[0].chapterNumber).toBe(3);
    });

    it("should handle AI returning invalid JSON gracefully", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "invalid json that cannot be parsed",
        tokensUsed: 20,
      });

      const longContent = "a".repeat(200);
      const result = await service.extractTriples(longContent, 1);

      expect(result).toEqual([]);
    });

    it("should assign correct chapter number to extracted triples", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          triples: [
            { subject: "李四", predicate: "出发", tripleType: "ACTION" },
          ],
        }),
        tokensUsed: 60,
      });

      const longContent = "b".repeat(200);
      const result = await service.extractTriples(longContent, 5);

      expect(result[0].chapterNumber).toBe(5);
      expect(result[0].validFrom).toBe(5);
    });
  });

  describe("saveTriplesToChapter", () => {
    it("should save triples to chapter metadata", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        metadata: { someExisting: "data" },
      });
      (mockPrisma.writingChapter.update as jest.Mock).mockResolvedValue({});

      const triples: TemporalTriple[] = [
        makeMockTriple({
          subject: "主角",
          predicate: "到达",
          chapterNumber: 1,
          tripleType: "LOCATION",
        }),
      ];

      await service.saveTriplesToChapter("ch-1", triples);

      expect(mockPrisma.writingChapter.update).toHaveBeenCalledWith({
        where: { id: "ch-1" },
        data: {
          metadata: expect.objectContaining({
            triples,
            triplesUpdatedAt: expect.any(String),
          }),
        },
      });
    });

    it("should not throw when chapter not found during save", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      (mockPrisma.writingChapter.update as jest.Mock).mockRejectedValue(
        new Error("Chapter not found"),
      );

      await expect(
        service.saveTriplesToChapter("missing-ch", []),
      ).resolves.not.toThrow();
    });
  });

  describe("conflict score calculation", () => {
    it("should return zero score when no conflicts", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.analyzeProject("proj-1");
      expect(result.conflictScore).toBe(0);
    });

    it("should return score between 0 and 1", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        {
          chapterNumber: 1,
          content: "c".repeat(200),
          metadata: {
            triples: [
              makeMockTriple({
                subject: "主角",
                predicate: "活着",
                chapterNumber: 1,
                tripleType: "STATE",
              }),
            ],
          },
        },
        {
          chapterNumber: 2,
          content: "d".repeat(200),
          metadata: {
            triples: [
              makeMockTriple({
                subject: "主角",
                predicate: "死",
                chapterNumber: 2,
                tripleType: "STATE",
              }),
            ],
          },
        },
      ]);

      const result = await service.analyzeProject("proj-1");
      expect(result.conflictScore).toBeGreaterThanOrEqual(0);
      expect(result.conflictScore).toBeLessThanOrEqual(1);
    });
  });
});
