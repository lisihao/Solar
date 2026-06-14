import { Test, TestingModule } from "@nestjs/testing";
import { FactExtractorService, ExtractedFact } from "../fact-extractor.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ChapterWritingContext } from "../../../interfaces/writing-context.interface";

describe("FactExtractorService", () => {
  let service: FactExtractorService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockFacade: jest.Mocked<ChatFacade>;

  beforeEach(async () => {
    mockPrisma = {
      writingChapter: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    mockFacade = {
      chat: jest.fn(),
      chatStream: jest.fn(),
      chatWithSkills: jest.fn(),
    } as unknown as jest.Mocked<ChatFacade>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FactExtractorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<FactExtractorService>(FactExtractorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const makeContext = (chapterNumber = 1): ChapterWritingContext =>
    ({
      chapter: {
        id: "chapter-1",
        chapterNumber,
        title: "第一章",
      },
    }) as ChapterWritingContext;

  const makeFact = (overrides: Partial<ExtractedFact> = {}): ExtractedFact => ({
    type: "CHARACTER_STATE",
    subject: "萧炎",
    predicate: "到达",
    object: "乌坦城",
    confidence: 0.9,
    evidence: "萧炎抵达乌坦城",
    chapterNumber: 1,
    extractedAt: new Date().toISOString(),
    ...overrides,
  });

  describe("extractFacts", () => {
    it("should extract facts from chapter content", async () => {
      const factData = [
        {
          type: "CHARACTER_STATE",
          subject: "萧炎",
          predicate: "到达",
          object: "乌坦城",
          confidence: 0.9,
          evidence: "萧炎抵达乌坦城",
          storyTime: "第三天",
        },
      ];

      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(factData),
        tokensUsed: 100,
      } as any);

      const content = "萧炎踏入乌坦城的城门，目光扫过热闹的街道。".repeat(10);
      const result = await service.extractFacts(content, makeContext(1));

      expect(result).toHaveLength(1);
      expect(result[0].subject).toBe("萧炎");
      expect(result[0].chapterNumber).toBe(1);
      expect(result[0].extractedAt).toBeDefined();
    });

    it("should return empty array for short content", async () => {
      const result = await service.extractFacts("短内容", makeContext());

      expect(result).toHaveLength(0);
      expect(mockFacade.chatWithSkills).not.toHaveBeenCalled();
    });

    it("should return empty array when LLM returns invalid JSON", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "not valid JSON",
        tokensUsed: 50,
      } as any);

      const content = "足够长的内容用于测试".repeat(20);
      const result = await service.extractFacts(content, makeContext());

      expect(result).toHaveLength(0);
    });

    it("should return empty array when LLM returns non-array", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: '{"result": "not an array"}',
        tokensUsed: 50,
      } as any);

      const content = "足够长的内容用于测试".repeat(20);
      const result = await service.extractFacts(content, makeContext());

      expect(result).toHaveLength(0);
    });

    it("should return empty array on LLM call failure", async () => {
      mockFacade.chatWithSkills.mockRejectedValue(new Error("API Error"));

      const content = "足够长的内容用于测试".repeat(20);
      const result = await service.extractFacts(content, makeContext());

      expect(result).toHaveLength(0);
    });

    it("should handle JSON wrapped in markdown code block", async () => {
      const factData = [
        {
          type: "PLOT_EVENT",
          subject: "萧炎",
          predicate: "获得",
          confidence: 0.85,
          evidence: "获得了功法",
        },
      ];

      mockFacade.chatWithSkills.mockResolvedValue({
        content: "```json\n" + JSON.stringify(factData) + "\n```",
        tokensUsed: 100,
      } as any);

      const content = "足够长的内容用于测试".repeat(20);
      const result = await service.extractFacts(content, makeContext(2));

      expect(result.length).toBeGreaterThan(0);
    });

    it("should set chapterNumber from context", async () => {
      const factData = [
        {
          type: "CHARACTER_STATE",
          subject: "萧炎",
          predicate: "处于",
          confidence: 0.9,
          evidence: "在修炼",
        },
      ];

      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(factData),
        tokensUsed: 100,
      } as any);

      const content = "足够长的内容用于测试".repeat(20);
      const result = await service.extractFacts(content, makeContext(5));

      expect(result[0].chapterNumber).toBe(5);
    });
  });

  describe("saveFacts", () => {
    it("should save facts to chapter metadata", async () => {
      const mockChapter = {
        id: "chapter-1",
        metadata: {},
        volume: { projectId: "project-1" },
      };
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        mockChapter,
      );
      (mockPrisma.writingChapter.update as jest.Mock).mockResolvedValue({});

      const facts = [makeFact()];
      await service.saveFacts("project-1", "chapter-1", facts);

      expect(mockPrisma.writingChapter.update).toHaveBeenCalledWith({
        where: { id: "chapter-1" },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            facts,
          }),
        }),
      });
    });

    it("should throw when chapter not found", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.saveFacts("project-1", "nonexistent", []),
      ).rejects.toThrow("Chapter nonexistent not found");
    });

    it("should throw when projectId does not match", async () => {
      const mockChapter = {
        id: "chapter-1",
        metadata: {},
        volume: { projectId: "different-project" },
      };
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        mockChapter,
      );

      await expect(
        service.saveFacts("project-1", "chapter-1", []),
      ).rejects.toThrow("Project ID mismatch");
    });

    it("should preserve existing metadata when saving facts", async () => {
      const existingMeta = { someOtherField: "value" };
      const mockChapter = {
        id: "chapter-1",
        metadata: existingMeta,
        volume: { projectId: "project-1" },
      };
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        mockChapter,
      );
      (mockPrisma.writingChapter.update as jest.Mock).mockResolvedValue({});

      const facts = [makeFact()];
      await service.saveFacts("project-1", "chapter-1", facts);

      expect(mockPrisma.writingChapter.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              someOtherField: "value",
              facts,
            }),
          }),
        }),
      );
    });
  });

  describe("getFacts", () => {
    it("should retrieve all facts from project chapters", async () => {
      const chapter1Facts = [makeFact({ chapterNumber: 1 })];
      const chapter2Facts = [
        makeFact({ chapterNumber: 2, type: "PLOT_EVENT", subject: "萧炎" }),
      ];

      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { id: "ch1", chapterNumber: 1, metadata: { facts: chapter1Facts } },
        { id: "ch2", chapterNumber: 2, metadata: { facts: chapter2Facts } },
      ]);

      const result = await service.getFacts("project-1");

      expect(result).toHaveLength(2);
    });

    it("should filter by type when option provided", async () => {
      const facts = [
        makeFact({ type: "CHARACTER_STATE" }),
        makeFact({ type: "PLOT_EVENT" }),
      ];

      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { id: "ch1", chapterNumber: 1, metadata: { facts } },
      ]);

      const result = await service.getFacts("project-1", {
        type: "PLOT_EVENT",
      });

      expect(result.every((f) => f.type === "PLOT_EVENT")).toBe(true);
    });

    it("should filter by character when option provided", async () => {
      const facts = [
        makeFact({ subject: "萧炎", object: "乌坦城" }),
        makeFact({ subject: "药老", object: "萧炎" }),
        makeFact({ subject: "黄色角色", object: "某地" }),
      ];

      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { id: "ch1", chapterNumber: 1, metadata: { facts } },
      ]);

      const result = await service.getFacts("project-1", { character: "萧炎" });

      expect(
        result.every(
          (f) => f.subject.includes("萧炎") || f.object?.includes("萧炎"),
        ),
      ).toBe(true);
    });

    it("should apply limit when option provided", async () => {
      const facts = Array.from({ length: 10 }, (_, i) =>
        makeFact({ chapterNumber: i + 1 }),
      );

      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { id: "ch1", chapterNumber: 1, metadata: { facts } },
      ]);

      const result = await service.getFacts("project-1", { limit: 3 });

      expect(result).toHaveLength(3);
    });

    it("should filter by chapterNumber when option provided", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        {
          id: "ch2",
          chapterNumber: 2,
          metadata: { facts: [makeFact({ chapterNumber: 2 })] },
        },
      ]);

      await service.getFacts("project-1", { chapterNumber: 2 });

      expect(mockPrisma.writingChapter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ chapterNumber: 2 }),
        }),
      );
    });

    it("should return empty array when chapters have no facts", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { id: "ch1", chapterNumber: 1, metadata: {} },
      ]);

      const result = await service.getFacts("project-1");

      expect(result).toHaveLength(0);
    });
  });

  describe("detectConflicts", () => {
    it("should return empty array when no new facts provided", async () => {
      const result = await service.detectConflicts("project-1", []);
      expect(result).toHaveLength(0);
      expect(mockFacade.chatWithSkills).not.toHaveBeenCalled();
    });

    it("should return empty array when no previous facts exist", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([]);

      const newFacts = [makeFact({ chapterNumber: 1 })];
      const result = await service.detectConflicts("project-1", newFacts);

      expect(result).toHaveLength(0);
    });

    it("should detect conflicts between new and existing facts", async () => {
      const previousFact = makeFact({
        chapterNumber: 1,
        subject: "萧炎",
        predicate: "拥有",
        object: "黑色眼睛",
      });

      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { id: "ch1", chapterNumber: 1, metadata: { facts: [previousFact] } },
      ]);

      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify([
          {
            conflictType: "CONTRADICTION",
            description: "眼睛颜色矛盾",
            severity: "CRITICAL",
          },
        ]),
        tokensUsed: 100,
      } as any);

      const newFacts = [
        makeFact({
          chapterNumber: 3,
          subject: "萧炎",
          predicate: "拥有",
          object: "蓝色眼睛",
        }),
      ];
      const result = await service.detectConflicts("project-1", newFacts);

      expect(result.length).toBeGreaterThan(0);
    });

    it("should only compare against previous chapter facts", async () => {
      const facts = [
        makeFact({ chapterNumber: 1 }),
        makeFact({ chapterNumber: 5 }), // future fact - should be filtered
      ];

      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { id: "ch1", chapterNumber: 1, metadata: { facts } },
      ]);

      mockFacade.chatWithSkills.mockResolvedValue({
        content: "[]",
        tokensUsed: 50,
      } as any);

      const newFacts = [makeFact({ chapterNumber: 3 })];
      await service.detectConflicts("project-1", newFacts);

      // Verify chatWithSkills was called with only previous facts
      const callArgs = mockFacade.chatWithSkills.mock.calls[0][0];
      const existingFacts = JSON.parse(
        callArgs.skillContext?.existingFacts as string,
      );
      expect(
        existingFacts.every((f: ExtractedFact) => f.chapterNumber < 3),
      ).toBe(true);
    });

    it("should return empty array on LLM failure", async () => {
      const previousFact = makeFact({ chapterNumber: 1 });
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { id: "ch1", chapterNumber: 1, metadata: { facts: [previousFact] } },
      ]);

      mockFacade.chatWithSkills.mockRejectedValue(new Error("API Error"));

      const newFacts = [makeFact({ chapterNumber: 2 })];
      const result = await service.detectConflicts("project-1", newFacts);

      expect(result).toHaveLength(0);
    });
  });

  describe("buildFactContext", () => {
    it("should return placeholder when no previous facts exist", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.buildFactContext("project-1", 1);

      expect(result).toBe("（暂无已确立的事实）");
    });

    it("should build context grouped by type", async () => {
      const facts = [
        makeFact({ type: "CHARACTER_STATE", chapterNumber: 1 }),
        makeFact({
          type: "PLOT_EVENT",
          chapterNumber: 1,
          subject: "战斗",
          predicate: "发生",
          object: "城门",
        }),
        makeFact({ type: "TIMELINE", chapterNumber: 1, storyTime: "第一天" }),
        makeFact({
          type: "RELATIONSHIP",
          chapterNumber: 1,
          subject: "萧炎",
          predicate: "认识",
          object: "药老",
        }),
      ];

      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { id: "ch1", chapterNumber: 1, metadata: { facts } },
      ]);

      const context = await service.buildFactContext("project-1", 5);

      expect(context).toContain("角色状态");
      expect(context).toContain("情节事件");
      expect(context).toContain("时间线");
      expect(context).toContain("角色关系");
    });

    it("should only include facts from previous chapters", async () => {
      const facts = [
        makeFact({ chapterNumber: 3 }), // future chapter
        makeFact({ chapterNumber: 1 }), // past chapter
      ];

      (mockPrisma.writingChapter.findMany as jest.Mock).mockResolvedValue([
        { id: "ch1", chapterNumber: 1, metadata: { facts } },
      ]);

      const context = await service.buildFactContext("project-1", 2);

      // Only ch1 facts should appear (chapterNumber < 2)
      expect(context).not.toBe("（暂无已确立的事实）");
    });

    it("should return error message on failure", async () => {
      (mockPrisma.writingChapter.findMany as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      const result = await service.buildFactContext("project-1", 2);

      expect(result).toBe("（无法加载事实上下文）");
    });
  });
});
