/**
 * HierarchicalSummaryService Unit Tests
 *
 * Tests the four-level hierarchical summary system:
 * - generateChapterSummary(): chapter-level summary with AI + DB save
 * - generateArcSummary(): arc-level summary across chapter ranges
 * - generateVolumeSummary(): volume-level macro summary
 * - getHierarchicalContext(): smart context assembly for writing
 * - getChapterSummaries(): retrieval with on-demand generation
 * - batchUpdateSummaries(): concurrent batch processing
 * - formatContextForPrompt(): context formatting utility
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  HierarchicalSummaryService,
  ChapterSummary,
  HierarchicalContext,
  ContextRequest,
} from "../hierarchical-summary.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

describe("HierarchicalSummaryService", () => {
  let service: HierarchicalSummaryService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;
  let mockFacade: { chat: jest.Mock };

  const makeChapterSummary = (
    num: number,
    overrides: Partial<ChapterSummary> = {},
  ): ChapterSummary => ({
    chapterNumber: num,
    title: `Chapter ${num}`,
    summary: `Summary of chapter ${num}`,
    keyEvents: ["event1", "event2"],
    emotionalTone: "neutral",
    characterChanges: { hero: "grows stronger" },
    scenes: [],
    ...overrides,
  });

  const makeDbChapter = (num: number, metadata: unknown = null) => ({
    id: `chapter-${num}`,
    chapterNumber: num,
    title: `Chapter ${num}`,
    content: `Content for chapter ${num}`,
    metadata,
  });

  beforeEach(async () => {
    mockPrisma = {
      writingChapter: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      } as unknown as jest.Mocked<PrismaService["writingChapter"]>,
      writingVolume: {
        findFirst: jest.fn(),
      } as unknown as jest.Mocked<PrismaService["writingVolume"]>,
      $transaction: jest.fn(),
    } as unknown as jest.Mocked<Partial<PrismaService>>;

    mockFacade = {
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HierarchicalSummaryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<HierarchicalSummaryService>(
      HierarchicalSummaryService,
    );
  });

  // ==================== generateChapterSummary ====================

  describe("generateChapterSummary", () => {
    it("should generate chapter summary from AI response and save to DB", async () => {
      const aiResponse = {
        content: JSON.stringify({
          summary: "A hero embarks on a journey",
          keyEvents: ["meets mentor", "leaves home"],
          emotionalTone: "adventurous",
          characterChanges: { hero: "motivated" },
          scenes: [
            {
              sceneNumber: 1,
              summary: "Hero wakes up",
              location: "village",
              characters: ["hero"],
              keyAction: "decides to leave",
            },
          ],
        }),
      };
      mockFacade.chat.mockResolvedValue(aiResponse);
      (mockPrisma.writingChapter!.findUnique as jest.Mock).mockResolvedValue({
        id: "ch-1",
        metadata: { existingKey: "value" },
      });
      (mockPrisma.writingChapter!.update as jest.Mock).mockResolvedValue({});

      const result = await service.generateChapterSummary(
        "ch-1",
        "Chapter content here",
        1,
        "The Beginning",
      );

      expect(result.chapterNumber).toBe(1);
      expect(result.title).toBe("The Beginning");
      expect(result.summary).toBe("A hero embarks on a journey");
      expect(result.keyEvents).toEqual(["meets mentor", "leaves home"]);
      expect(result.emotionalTone).toBe("adventurous");
      expect(result.characterChanges).toEqual({ hero: "motivated" });
      expect(result.scenes).toHaveLength(1);
      expect(result.scenes![0].sceneNumber).toBe(1);

      // Verify AI was called with correct model type
      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: AIModelType.CHAT,
          taskProfile: expect.objectContaining({ creativity: "low" }),
        }),
      );

      // Verify DB save was called
      expect(mockPrisma.writingChapter!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ch-1" },
          data: expect.objectContaining({
            metadata: expect.any(Object),
          }),
        }),
      );
    });

    it("should truncate chapter content to 8000 chars for AI call", async () => {
      const longContent = "a".repeat(10000);
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"s","keyEvents":[],"emotionalTone":"t","characterChanges":{},"scenes":[]}',
      });
      (mockPrisma.writingChapter!.findUnique as jest.Mock).mockResolvedValue({
        metadata: {},
      });
      (mockPrisma.writingChapter!.update as jest.Mock).mockResolvedValue({});

      await service.generateChapterSummary("ch-1", longContent, 1, "Title");

      const callArg = mockFacade.chat.mock.calls[0][0];
      const userMessage = callArg.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("a".repeat(100));
      expect(userMessage.content.length).toBeLessThan(10000 + 200);
    });

    it("should return fallback summary when AI throws", async () => {
      mockFacade.chat.mockRejectedValue(new Error("AI unavailable"));

      const result = await service.generateChapterSummary(
        "ch-1",
        "content",
        3,
        "Title",
      );

      expect(result.chapterNumber).toBe(3);
      expect(result.summary).toBe("第3章");
      expect(result.keyEvents).toEqual([]);
      expect(result.emotionalTone).toBe("未知");
    });

    it("should return fallback when AI returns invalid JSON", async () => {
      mockFacade.chat.mockResolvedValue({ content: "not json at all" });
      (mockPrisma.writingChapter!.findUnique as jest.Mock).mockResolvedValue({
        metadata: {},
      });
      (mockPrisma.writingChapter!.update as jest.Mock).mockResolvedValue({});

      const result = await service.generateChapterSummary(
        "ch-1",
        "content",
        2,
        "My Title",
      );

      expect(result.chapterNumber).toBe(2);
      expect(result.title).toBe("My Title");
      // Falls back to default value + chapter number suffix
      expect(result.summary).toBe("第2章摘要");
    });

    it("should skip DB save when chapterId is empty string", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"s","keyEvents":[],"emotionalTone":"t","characterChanges":{},"scenes":[]}',
      });

      await service.generateChapterSummary("", "content", 1, "Title");

      expect(mockPrisma.writingChapter!.update).not.toHaveBeenCalled();
    });

    it("should handle DB save failure gracefully without throwing", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"test summary","keyEvents":[],"emotionalTone":"calm","characterChanges":{},"scenes":[]}',
      });
      (mockPrisma.writingChapter!.findUnique as jest.Mock).mockResolvedValue({
        metadata: {},
      });
      (mockPrisma.writingChapter!.update as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      // Should not throw
      const result = await service.generateChapterSummary(
        "ch-1",
        "content",
        1,
        "Title",
      );
      expect(result.summary).toBe("test summary");
    });

    it("should merge with existing metadata when saving", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"new summary","keyEvents":[],"emotionalTone":"tense","characterChanges":{},"scenes":[]}',
      });
      (mockPrisma.writingChapter!.findUnique as jest.Mock).mockResolvedValue({
        metadata: { existingKey: "existingValue", otherData: 42 },
      });
      (mockPrisma.writingChapter!.update as jest.Mock).mockResolvedValue({});

      await service.generateChapterSummary("ch-1", "content", 1, "Title");

      const updateCall = (mockPrisma.writingChapter!.update as jest.Mock).mock
        .calls[0][0];
      expect(updateCall.data.metadata).toMatchObject({
        existingKey: "existingValue",
        otherData: 42,
      });
      expect(updateCall.data.metadata.summary).toBeDefined();
      expect(updateCall.data.metadata.summaryUpdatedAt).toBeDefined();
    });
  });

  // ==================== generateArcSummary ====================

  describe("generateArcSummary", () => {
    beforeEach(() => {
      // getChapterSummaries is called internally — mock the DB query
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([
        makeDbChapter(1, { summary: makeChapterSummary(1) }),
        makeDbChapter(2, { summary: makeChapterSummary(2) }),
        makeDbChapter(3, { summary: makeChapterSummary(3) }),
      ]);
    });

    it("should generate arc summary using chapter summaries from DB", async () => {
      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          summary: "A grand battle arc",
          arcType: "main",
          mainConflict: "Hero vs. Dark Lord",
          resolution: "Hero wins",
          mainCharacters: ["hero", "villain"],
        }),
      });

      const result = await service.generateArcSummary(
        "project-1",
        "Battle Arc",
        [1, 3],
      );

      expect(result.arcName).toBe("Battle Arc");
      expect(result.chapterRange).toEqual([1, 3]);
      expect(result.summary).toBe("A grand battle arc");
      expect(result.arcType).toBe("main");
      expect(result.mainConflict).toBe("Hero vs. Dark Lord");
      expect(result.resolution).toBe("Hero wins");
      expect(result.mainCharacters).toEqual(["hero", "villain"]);
    });

    it("should pass chapter range to DB query", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"arc","arcType":"sub","mainConflict":"c","mainCharacters":[]}',
      });

      await service.generateArcSummary("project-1", "Sub Arc", [5, 10]);

      expect(mockPrisma.writingChapter!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            chapterNumber: { gte: 5, lte: 10 },
          }),
        }),
      );
    });

    it("should return fallback arc summary when AI throws", async () => {
      mockFacade.chat.mockRejectedValue(new Error("timeout"));

      const result = await service.generateArcSummary(
        "project-1",
        "Test Arc",
        [1, 5],
      );

      expect(result.arcName).toBe("Test Arc");
      expect(result.summary).toBe("Test Arc弧线");
      expect(result.arcType).toBe("sub");
      expect(result.mainConflict).toBe("未知");
    });

    it("should cast arcType to valid union type", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"arc","arcType":"character","mainConflict":"inner","mainCharacters":["hero"]}',
      });

      const result = await service.generateArcSummary(
        "p1",
        "Growth Arc",
        [1, 3],
      );

      expect(result.arcType).toBe("character");
    });
  });

  // ==================== generateVolumeSummary ====================

  describe("generateVolumeSummary", () => {
    it("should return empty volume when volume not found in DB", async () => {
      (mockPrisma.writingVolume!.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.generateVolumeSummary("project-1", 2);

      expect(result.volumeNumber).toBe(2);
      expect(result.title).toBe("第2卷");
      expect(result.summary).toBe("");
      expect(result.arcs).toEqual([]);
    });

    it("should use cached chapter summaries from metadata", async () => {
      const cachedSummary = makeChapterSummary(1);
      (mockPrisma.writingVolume!.findFirst as jest.Mock).mockResolvedValue({
        title: "Volume One",
        chapters: [
          {
            chapterNumber: 1,
            title: "Ch 1",
            content: "content",
            metadata: { summary: cachedSummary },
          },
        ],
      });
      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          summary: "Volume summary here",
          arcs: ["Arc 1"],
          theme: "Growth",
          startingState: "Beginning",
          endingState: "Climax",
        }),
      });

      const result = await service.generateVolumeSummary("project-1", 1);

      expect(result.volumeNumber).toBe(1);
      expect(result.title).toBe("Volume One");
      expect(result.summary).toBe("Volume summary here");
      expect(result.arcs).toEqual(["Arc 1"]);
      expect(result.theme).toBe("Growth");
      // AI should be called once for the volume summary (not for chapter summaries since cached)
      expect(mockFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("should generate chapter summary when metadata has no cached summary", async () => {
      (mockPrisma.writingVolume!.findFirst as jest.Mock).mockResolvedValue({
        title: "Vol 1",
        chapters: [
          {
            chapterNumber: 1,
            title: "Ch 1",
            content: "chapter content",
            metadata: null,
          },
        ],
      });
      (mockPrisma.writingChapter!.findUnique as jest.Mock).mockResolvedValue({
        metadata: {},
      });
      (mockPrisma.writingChapter!.update as jest.Mock).mockResolvedValue({});
      mockFacade.chat
        // First call: chapter summary generation
        .mockResolvedValueOnce({
          content:
            '{"summary":"ch1 summary","keyEvents":[],"emotionalTone":"t","characterChanges":{},"scenes":[]}',
        })
        // Second call: volume summary generation
        .mockResolvedValueOnce({
          content:
            '{"summary":"volume summary","arcs":[],"theme":"Power","startingState":"weak","endingState":"strong"}',
        });

      const result = await service.generateVolumeSummary("project-1", 1);

      expect(mockFacade.chat).toHaveBeenCalledTimes(2);
      expect(result.summary).toBe("volume summary");
    });

    it("should return fallback volume summary when AI throws on volume summarization", async () => {
      (mockPrisma.writingVolume!.findFirst as jest.Mock).mockResolvedValue({
        title: "Vol 1",
        chapters: [],
      });
      mockFacade.chat.mockRejectedValue(new Error("quota exceeded"));

      const result = await service.generateVolumeSummary("project-1", 1);

      expect(result.volumeNumber).toBe(1);
      expect(result.title).toBe("Vol 1");
      expect(result.summary).toBe("");
      expect(result.theme).toBe("未知");
    });

    it("should use outputLength 'long' for volume summary AI call", async () => {
      (mockPrisma.writingVolume!.findFirst as jest.Mock).mockResolvedValue({
        title: "Vol 1",
        chapters: [],
      });
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"s","arcs":[],"theme":"t","startingState":"s","endingState":"e"}',
      });

      await service.generateVolumeSummary("project-1", 1);

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ outputLength: "long" }),
        }),
      );
    });
  });

  // ==================== getChapterSummaries ====================

  describe("getChapterSummaries", () => {
    it("should return cached summaries from metadata without generating new ones", async () => {
      const cached1 = makeChapterSummary(1);
      const cached2 = makeChapterSummary(2);
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([
        makeDbChapter(1, { summary: cached1 }),
        makeDbChapter(2, { summary: cached2 }),
      ]);

      const result = await service.getChapterSummaries("project-1", 1, 2);

      expect(result).toHaveLength(2);
      expect(result[0].chapterNumber).toBe(1);
      expect(result[1].chapterNumber).toBe(2);
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should generate summary for chapters with content but no cached metadata", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([
        makeDbChapter(1, null), // no metadata
      ]);
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"generated","keyEvents":["e1"],"emotionalTone":"tense","characterChanges":{},"scenes":[]}',
      });
      (mockPrisma.writingChapter!.findUnique as jest.Mock).mockResolvedValue({
        metadata: {},
      });
      (mockPrisma.writingChapter!.update as jest.Mock).mockResolvedValue({});

      const result = await service.getChapterSummaries("project-1", 1, 1);

      expect(result).toHaveLength(1);
      expect(result[0].summary).toBe("generated");
      expect(mockFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("should query DB with correct projectId and chapter range filters", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([]);

      await service.getChapterSummaries("project-xyz", 5, 15);

      expect(mockPrisma.writingChapter!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            volume: { projectId: "project-xyz" },
            chapterNumber: { gte: 5, lte: 15 },
            content: { not: "" },
          },
          orderBy: { chapterNumber: "asc" },
        }),
      );
    });

    it("should return empty array when no chapters found", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getChapterSummaries("project-1", 1, 10);

      expect(result).toEqual([]);
    });

    it("should mix cached and generated summaries correctly", async () => {
      const cached = makeChapterSummary(1);
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([
        makeDbChapter(1, { summary: cached }),
        makeDbChapter(2, null), // needs generation
      ]);
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"ch2 generated","keyEvents":[],"emotionalTone":"hopeful","characterChanges":{},"scenes":[]}',
      });
      (mockPrisma.writingChapter!.findUnique as jest.Mock).mockResolvedValue({
        metadata: {},
      });
      (mockPrisma.writingChapter!.update as jest.Mock).mockResolvedValue({});

      const result = await service.getChapterSummaries("project-1", 1, 2);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(cached); // exact same object (cached)
      expect(result[1].summary).toBe("ch2 generated");
    });
  });

  // ==================== getHierarchicalContext ====================

  describe("getHierarchicalContext", () => {
    it("should assemble hierarchical context with recent, medium, and distant layers", async () => {
      // Return different data based on chapter range queries
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockImplementation(
        ({ where }) => {
          const { gte, lte } = where.chapterNumber;
          const chapters = [];
          for (let i = gte; i <= lte; i++) {
            chapters.push(makeDbChapter(i, { summary: makeChapterSummary(i) }));
          }
          return Promise.resolve(chapters);
        },
      );

      // For distant context compression
      mockFacade.chat.mockResolvedValue({
        content: "Background summary of early chapters",
      });

      const request: ContextRequest = {
        currentChapter: 10,
        targetTokens: 4000,
      };

      const result = await service.getHierarchicalContext("project-1", request);

      expect(result).toHaveProperty("recentChapters");
      expect(result).toHaveProperty("mediumChapters");
      expect(result).toHaveProperty("distantContext");
      expect(result).toHaveProperty("estimatedTokens");
      expect(typeof result.estimatedTokens).toBe("number");
      expect(result.estimatedTokens).toBeGreaterThanOrEqual(0);
    });

    it("should use correct CONTEXT_WINDOWS slicing (RECENT=3, MEDIUM=6)", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([]);

      const request: ContextRequest = {
        currentChapter: 10,
        targetTokens: 2000,
      };
      await service.getHierarchicalContext("project-1", request);

      const calls = (mockPrisma.writingChapter!.findMany as jest.Mock).mock
        .calls;
      // First call: recent chapters (chapter 7-9 for currentChapter=10, RECENT=3)
      expect(calls[0][0].where.chapterNumber).toEqual({ gte: 7, lte: 9 });
      // Second call: medium chapters (chapter 4-6 for MEDIUM=6, RECENT=3)
      expect(calls[1][0].where.chapterNumber).toEqual({ gte: 4, lte: 6 });
    });

    it("should have empty mediumChapters when currentChapter is small", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([]);

      const request: ContextRequest = { currentChapter: 2, targetTokens: 1000 };
      const result = await service.getHierarchicalContext("project-1", request);

      expect(result.mediumChapters).toEqual([]);
    });

    it("should return empty distantContext when currentChapter <= MEDIUM window (6)", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([]);

      const request: ContextRequest = { currentChapter: 5, targetTokens: 2000 };
      const result = await service.getHierarchicalContext("project-1", request);

      expect(result.distantContext).toBe("");
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should compute estimatedTokens as ceil(totalChars / 1.5)", async () => {
      // currentChapter=9 > MEDIUM(6), so distantContext IS requested.
      // recent window: chapters 6-8 (RECENT=3), medium: chapters 3-5 (MEDIUM=6 minus RECENT=3)
      // distant: chapters 1-2 (distantEnd = mediumStart - 1 = 3 - 1 = 2)
      const summary8 = makeChapterSummary(8, {
        summary: "a".repeat(150), // 150 chars
        scenes: [{ sceneNumber: 1, summary: "b".repeat(60), characters: [] }],
      });
      const summary7 = makeChapterSummary(7, {
        summary: "c".repeat(100),
        scenes: [],
      });
      const summary6 = makeChapterSummary(6, {
        summary: "d".repeat(80),
        scenes: [],
      });
      const summary5 = makeChapterSummary(5, {
        summary: "e".repeat(90),
        scenes: [],
      });
      const summary4 = makeChapterSummary(4, {
        summary: "f".repeat(70),
        scenes: [],
      });
      const summary3 = makeChapterSummary(3, {
        summary: "g".repeat(60),
        scenes: [],
      });
      const summary2 = makeChapterSummary(2, {
        summary: "h".repeat(50),
        scenes: [],
      });
      const summary1 = makeChapterSummary(1, {
        summary: "i".repeat(40),
        scenes: [],
      });

      (mockPrisma.writingChapter!.findMany as jest.Mock)
        // recent (chapters 6-8)
        .mockResolvedValueOnce([
          makeDbChapter(6, { summary: summary6 }),
          makeDbChapter(7, { summary: summary7 }),
          makeDbChapter(8, { summary: summary8 }),
        ])
        // medium (chapters 3-5)
        .mockResolvedValueOnce([
          makeDbChapter(3, { summary: summary3 }),
          makeDbChapter(4, { summary: summary4 }),
          makeDbChapter(5, { summary: summary5 }),
        ])
        // distant (chapters 1-2)
        .mockResolvedValueOnce([
          makeDbChapter(1, { summary: summary1 }),
          makeDbChapter(2, { summary: summary2 }),
        ]);

      // distant context compression returns a fixed string
      const distantSummaryText = "x".repeat(200);
      mockFacade.chat.mockResolvedValue({ content: distantSummaryText });

      const request: ContextRequest = { currentChapter: 9, targetTokens: 2000 };
      const result = await service.getHierarchicalContext("project-1", request);

      // recent: (80 + 100 + 150) summaries + 60 scene = 390
      // medium: (60 + 70 + 90) = 220
      // distant: 200 chars from AI response
      const expectedTokens = Math.ceil((390 + 220 + 200) / 1.5);
      expect(result.estimatedTokens).toBe(expectedTokens);
    });
  });

  // ==================== formatContextForPrompt ====================

  describe("formatContextForPrompt", () => {
    it("should return empty string for empty context", () => {
      const context: HierarchicalContext = {
        recentChapters: [],
        mediumChapters: [],
        distantContext: "",
        estimatedTokens: 0,
      };

      const result = service.formatContextForPrompt(context);

      expect(result).toBe("");
    });

    it("should include distantContext as 故事背景 section", () => {
      const context: HierarchicalContext = {
        recentChapters: [],
        mediumChapters: [],
        distantContext: "Long ago, a hero was born.",
        estimatedTokens: 100,
      };

      const result = service.formatContextForPrompt(context);

      expect(result).toContain("【故事背景】");
      expect(result).toContain("Long ago, a hero was born.");
    });

    it("should include mediumChapters as 近期剧情 section", () => {
      const context: HierarchicalContext = {
        recentChapters: [],
        mediumChapters: [makeChapterSummary(3), makeChapterSummary(4)],
        distantContext: "",
        estimatedTokens: 200,
      };

      const result = service.formatContextForPrompt(context);

      expect(result).toContain("【近期剧情】");
      expect(result).toContain("第3章");
      expect(result).toContain("第4章");
    });

    it("should include recentChapters as 前文详情 section with key events", () => {
      const context: HierarchicalContext = {
        recentChapters: [
          makeChapterSummary(9, {
            keyEvents: ["hero awakens power", "villain retreats"],
            characterChanges: { hero: "leveled up", sidekick: "injured" },
          }),
        ],
        mediumChapters: [],
        distantContext: "",
        estimatedTokens: 300,
      };

      const result = service.formatContextForPrompt(context);

      expect(result).toContain("【前文详情】");
      expect(result).toContain("第9章");
      expect(result).toContain("关键事件");
      expect(result).toContain("hero awakens power");
      expect(result).toContain("角色变化");
      expect(result).toContain("hero(leveled up)");
      expect(result).toContain("sidekick(injured)");
    });

    it("should omit key events section when chapter has no key events", () => {
      const context: HierarchicalContext = {
        recentChapters: [makeChapterSummary(5, { keyEvents: [] })],
        mediumChapters: [],
        distantContext: "",
        estimatedTokens: 100,
      };

      const result = service.formatContextForPrompt(context);

      expect(result).not.toContain("关键事件");
    });

    it("should omit character changes section when chapter has no character changes", () => {
      const context: HierarchicalContext = {
        recentChapters: [makeChapterSummary(5, { characterChanges: {} })],
        mediumChapters: [],
        distantContext: "",
        estimatedTokens: 100,
      };

      const result = service.formatContextForPrompt(context);

      expect(result).not.toContain("角色变化");
    });

    it("should separate sections with --- dividers", () => {
      const context: HierarchicalContext = {
        recentChapters: [makeChapterSummary(5)],
        mediumChapters: [makeChapterSummary(3)],
        distantContext: "background text",
        estimatedTokens: 500,
      };

      const result = service.formatContextForPrompt(context);

      expect(result).toContain("---");
    });
  });

  // ==================== batchUpdateSummaries ====================

  describe("batchUpdateSummaries", () => {
    it("should return 0 and log when all chapters already have summaries", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([
        makeDbChapter(1, { summary: makeChapterSummary(1) }),
        makeDbChapter(2, { summary: makeChapterSummary(2) }),
      ]);

      const result = await service.batchUpdateSummaries("project-1");

      expect(result).toBe(0);
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should return 0 when no chapters exist in project", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.batchUpdateSummaries("project-1");

      expect(result).toBe(0);
    });

    it("should generate summaries for chapters with no cached summary", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([
        makeDbChapter(1, null), // needs summary
        makeDbChapter(2, null), // needs summary
      ]);
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"generated","keyEvents":[],"emotionalTone":"calm","characterChanges":{},"scenes":[]}',
      });
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue([{}, {}]);

      const result = await service.batchUpdateSummaries("project-1");

      expect(result).toBe(2);
      expect(mockFacade.chat).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("should use fallback summary when AI rejects for a chapter (internal catch)", async () => {
      // generateChapterSummaryWithoutSave has an internal try/catch that returns a fallback
      // instead of throwing — so all chapters produce a result (fallback or real)
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([
        makeDbChapter(1, null),
        makeDbChapter(2, null),
      ]);
      mockFacade.chat
        .mockResolvedValueOnce({
          content:
            '{"summary":"ok","keyEvents":[],"emotionalTone":"t","characterChanges":{},"scenes":[]}',
        })
        .mockRejectedValueOnce(new Error("AI error for chapter 2"));
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue([{}, {}]);

      const result = await service.batchUpdateSummaries("project-1");

      // Both chapters yield a result (chapter 2 gets fallback summary)
      expect(result).toBe(2);
    });

    it("should process chapters in batches of 3 for concurrency control", async () => {
      const chapters = Array.from({ length: 5 }, (_, i) =>
        makeDbChapter(i + 1, null),
      );
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue(
        chapters,
      );
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"s","keyEvents":[],"emotionalTone":"t","characterChanges":{},"scenes":[]}',
      });
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue(
        new Array(5).fill({}),
      );

      const result = await service.batchUpdateSummaries("project-1");

      expect(result).toBe(5);
      // 5 chapters = 2 AI batches (3 + 2), so 5 AI calls total
      expect(mockFacade.chat).toHaveBeenCalledTimes(5);
    });

    it("should fall back to single updates when transaction fails", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([
        makeDbChapter(1, null),
        makeDbChapter(2, null),
      ]);
      mockFacade.chat.mockResolvedValue({
        content:
          '{"summary":"s","keyEvents":[],"emotionalTone":"t","characterChanges":{},"scenes":[]}',
      });
      (mockPrisma.$transaction as jest.Mock).mockRejectedValue(
        new Error("Transaction failed"),
      );
      (mockPrisma.writingChapter!.update as jest.Mock).mockResolvedValue({});

      const result = await service.batchUpdateSummaries("project-1");

      expect(result).toBe(2);
      // The transaction path calls writingChapter.update to build the array (2 calls),
      // then the fallback path calls it again for each item (2 more calls) = 4 total
      expect(mockPrisma.writingChapter!.update).toHaveBeenCalledTimes(4);
    });

    it("should query all chapters with non-empty content from project", async () => {
      (mockPrisma.writingChapter!.findMany as jest.Mock).mockResolvedValue([]);

      await service.batchUpdateSummaries("project-xyz");

      expect(mockPrisma.writingChapter!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            volume: { projectId: "project-xyz" },
            content: { not: "" },
          },
        }),
      );
    });
  });
});
