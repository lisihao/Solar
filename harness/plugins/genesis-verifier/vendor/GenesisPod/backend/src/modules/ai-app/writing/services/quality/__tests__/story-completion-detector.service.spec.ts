import { Test, TestingModule } from "@nestjs/testing";
import { StoryCompletionDetectorService } from "../story-completion-detector.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("StoryCompletionDetectorService", () => {
  let service: StoryCompletionDetectorService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockFacade: jest.Mocked<ChatFacade>;

  const makeChapter = (
    content: string,
    chapterNumber: number,
    wordCount = 2000,
  ) => ({
    id: `chap-${chapterNumber}`,
    content,
    title: `第${chapterNumber}章`,
    chapterNumber,
    wordCount,
    outline: null,
    volumeId: "vol-1",
    status: "completed",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const mockProject = {
    id: "proj-1",
    title: "测试小说",
    targetWords: 100000,
    storyBible: {
      id: "bible-1",
      premise: "这是一个关于穿越的故事",
      characters: [
        { id: "char-1", name: "苏曼", role: "protagonist" },
        { id: "char-2", name: "反派", role: "antagonist" },
      ],
      timelineEvents: [],
    },
    volumes: [
      {
        id: "vol-1",
        chapters: [
          makeChapter("普通章节内容", 1),
          makeChapter("普通章节内容", 2),
        ],
      },
    ],
  };

  beforeEach(async () => {
    mockPrisma = {
      writingProject: {
        findUnique: jest.fn(),
      },
      writingChapter: {
        findFirst: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    mockFacade = {
      chat: jest.fn(),
    } as unknown as jest.Mocked<ChatFacade>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoryCompletionDetectorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<StoryCompletionDetectorService>(
      StoryCompletionDetectorService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("analyzeCompletion", () => {
    it("should return isComplete=false for non-existent project", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.analyzeCompletion("nonexistent");

      expect(result.isComplete).toBe(false);
      expect(result.reason).toContain("项目不存在");
    });

    it("should return isComplete=false when no chapters written", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        volumes: [{ id: "vol-1", chapters: [makeChapter("", 1, 0)] }],
      });

      const result = await service.analyzeCompletion("proj-1");

      expect(result.isComplete).toBe(false);
      expect(result.reason).toContain("尚无已写章节");
    });

    it("should detect completion marker 全书完 and return isComplete=true", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        volumes: [
          {
            id: "vol-1",
            chapters: [
              makeChapter("正常章节内容", 1),
              makeChapter("故事到达了高潮，全书完。这是结局。", 2),
            ],
          },
        ],
      });

      const result = await service.analyzeCompletion("proj-1");

      expect(result.isComplete).toBe(true);
      expect(result.recommendation).toBe("STOP");
      expect(result.signals.some((s) => s.type === "TEXT_MARKER")).toBe(true);
    });

    it("should include analysis timestamp", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        volumes: [{ id: "vol-1", chapters: [makeChapter("内容", 1)] }],
      });
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content:
          '{"mainConflictsResolved": false, "resolutionRatio": 0.3, "reason": "test"}',
      });

      const result = await service.analyzeCompletion("proj-1");

      expect(result.analyzedAt).toBeDefined();
      expect(typeof result.analyzedAt).toBe("string");
    });

    it("should detect 大结局 completion marker", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        volumes: [
          {
            id: "vol-1",
            chapters: [
              makeChapter("正常内容", 1),
              makeChapter("这是大结局，一切都结束了。", 2),
            ],
          },
        ],
      });

      const result = await service.analyzeCompletion("proj-1");

      expect(result.isComplete).toBe(true);
    });

    it("should return CONTINUE recommendation for early stage stories", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        volumes: [
          {
            id: "vol-1",
            chapters: [
              makeChapter("内容1", 1, 2000),
              makeChapter("内容2", 2, 2000),
              makeChapter("内容3", 3, 2000),
            ],
          },
        ],
      });
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content:
          '{"mainConflictsResolved": false, "resolutionRatio": 0.2, "reason": "too early"}',
      });

      const result = await service.analyzeCompletion("proj-1");

      expect(result.recommendation).toBe("CONTINUE");
    });
  });

  describe("quickDetectCompletion", () => {
    it("should return isComplete=false when no chapters found", async () => {
      (mockPrisma.writingChapter.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.quickDetectCompletion("proj-1");

      expect(result.isComplete).toBe(false);
      expect(result.marker).toBeUndefined();
    });

    it("should detect 全书完 marker in last chapter", async () => {
      (mockPrisma.writingChapter.findFirst as jest.Mock).mockResolvedValue({
        content: "这是最后一章，全书完。",
        title: "结局",
        outline: null,
      });

      const result = await service.quickDetectCompletion("proj-1");

      expect(result.isComplete).toBe(true);
      expect(result.marker).toBe("全书完");
    });

    it("should detect 大结局 marker in chapter title", async () => {
      (mockPrisma.writingChapter.findFirst as jest.Mock).mockResolvedValue({
        content: "故事到了最后",
        title: "大结局",
        outline: null,
      });

      const result = await service.quickDetectCompletion("proj-1");

      expect(result.isComplete).toBe(true);
      expect(result.marker).toBe("大结局");
    });

    it("should not detect low-confidence markers like 番外", async () => {
      (mockPrisma.writingChapter.findFirst as jest.Mock).mockResolvedValue({
        content: "这是番外篇",
        title: "番外",
        outline: null,
      });

      const result = await service.quickDetectCompletion("proj-1");

      // 番外 has confidence 0.3, below the 0.8 threshold for quick detect
      expect(result.isComplete).toBe(false);
    });

    it("should return isComplete=false for regular chapter", async () => {
      (mockPrisma.writingChapter.findFirst as jest.Mock).mockResolvedValue({
        content: "普通的故事章节内容，主角继续冒险。",
        title: "第五章",
        outline: null,
      });

      const result = await service.quickDetectCompletion("proj-1");

      expect(result.isComplete).toBe(false);
    });
  });

  describe("calculateCompletionScore (via analyzeCompletion)", () => {
    it("should return confidence between 0 and 1", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        volumes: [{ id: "vol-1", chapters: [makeChapter("普通内容", 1)] }],
      });
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content:
          '{"mainConflictsResolved": false, "resolutionRatio": 0.3, "reason": "test"}',
      });

      const result = await service.analyzeCompletion("proj-1");

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("word count signal", () => {
    it("should trigger WORD_COUNT signal when 90%+ of target words written", async () => {
      const chapters = Array.from({ length: 5 }, (_, i) =>
        makeChapter(`内容 ${i}`, i + 1, 20000),
      );
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        targetWords: 100000,
        volumes: [{ id: "vol-1", chapters }],
      });
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content:
          '{"mainConflictsResolved": false, "resolutionRatio": 0.3, "reason": "test"}',
      });

      const result = await service.analyzeCompletion("proj-1");

      expect(result.signals.some((s) => s.type === "WORD_COUNT")).toBe(true);
    });

    it("should not trigger WORD_COUNT signal when target words is 0", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        targetWords: 0,
        volumes: [{ id: "vol-1", chapters: [makeChapter("内容", 1, 5000)] }],
      });
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content:
          '{"mainConflictsResolved": false, "resolutionRatio": 0.3, "reason": "test"}',
      });

      const result = await service.analyzeCompletion("proj-1");

      expect(result.signals.some((s) => s.type === "WORD_COUNT")).toBe(false);
    });
  });
});
