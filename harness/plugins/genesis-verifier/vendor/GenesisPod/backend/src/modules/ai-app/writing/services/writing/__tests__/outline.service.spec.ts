/**
 * Unit tests for OutlineService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { OutlineService } from "../outline.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { StoryBibleService } from "../../bible/story-bible.service";

function buildMockPrisma() {
  return {
    writingProject: {
      findUnique: jest.fn(),
    },
    writingVolume: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: "volume-1" }),
    },
    writingChapter: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: "chapter-1" }),
      update: jest.fn(),
    },
  };
}

function buildMockFacade() {
  return {
    chatWithSkills: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        volumeTitle: "第一卷",
        theme: "成长与勇气",
        chapters: [
          {
            chapterNumber: 1,
            title: "The Awakening",
            plot: "Hero discovers powers",
            keyPoint: "First transformation",
            characters: ["Alice", "Bob"],
            location: "Forest",
          },
          {
            chapterNumber: 2,
            title: "The Journey",
            plot: "Hero sets out",
            characters: ["Alice"],
          },
        ],
      }),
    }),
  };
}

function buildMockStoryBible() {
  return {
    getSnapshot: jest.fn().mockResolvedValue({
      premise: "A world of magic and adventure",
      tone: "Epic",
      theme: "Courage",
      characters: [
        {
          name: "Alice",
          role: "protagonist",
          personality: { traits: ["brave", "curious"] },
        },
      ],
    }),
  };
}

describe("OutlineService", () => {
  let service: OutlineService;
  let prisma: ReturnType<typeof buildMockPrisma>;
  let facade: ReturnType<typeof buildMockFacade>;
  let storyBible: ReturnType<typeof buildMockStoryBible>;

  const mockProject = {
    id: "project-1",
    name: "My Epic Novel",
    description: "An epic fantasy tale",
    genre: "fantasy",
    targetWords: 100000,
    storyBible: { id: "bible-1" },
  };

  beforeEach(async () => {
    prisma = buildMockPrisma();
    facade = buildMockFacade();
    storyBible = buildMockStoryBible();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutlineService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatFacade, useValue: facade },
        { provide: StoryBibleService, useValue: storyBible },
      ],
    }).compile();

    service = module.get<OutlineService>(OutlineService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("generateOutline", () => {
    it("should generate outline with correct structure", async () => {
      prisma.writingProject.findUnique.mockResolvedValue(mockProject);

      const result = await service.generateOutline("project-1", 1, 2);

      expect(result).toHaveProperty("volumeNumber", 1);
      expect(result).toHaveProperty("chapters");
      expect(result.chapters).toHaveLength(2);
      expect(result.chapters[0].title).toBe("The Awakening");
    });

    it("should throw error when project not found", async () => {
      prisma.writingProject.findUnique.mockResolvedValue(null);

      await expect(
        service.generateOutline("missing-project", 1, 5),
      ).rejects.toThrow("Project not found");
    });

    it("should call facade with chatWithSkills", async () => {
      prisma.writingProject.findUnique.mockResolvedValue(mockProject);

      await service.generateOutline("project-1", 1, 3);

      expect(facade.chatWithSkills).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: "writing",
        }),
      );
    });

    it("should include previous volume context when available", async () => {
      prisma.writingProject.findUnique.mockResolvedValue(mockProject);
      prisma.writingVolume.findMany.mockResolvedValue([
        {
          volumeNumber: 1,
          title: "Volume One",
          chapters: [{ title: "Chapter 1", outline: "The beginning" }],
        },
      ]);

      await service.generateOutline("project-1", 2, 2);

      const callArg = facade.chatWithSkills.mock.calls[0][0];
      expect(callArg.skillContext.previousOutline).toContain("第1卷");
    });

    it("should propagate error when AI call fails", async () => {
      prisma.writingProject.findUnique.mockResolvedValue(mockProject);
      facade.chatWithSkills.mockRejectedValue(new Error("API Error"));

      await expect(service.generateOutline("project-1", 1, 5)).rejects.toThrow(
        "API Error",
      );
    });

    it("should handle malformed JSON response gracefully", async () => {
      prisma.writingProject.findUnique.mockResolvedValue(mockProject);
      facade.chatWithSkills.mockResolvedValue({
        content: "This is not valid JSON",
      });

      await expect(service.generateOutline("project-1", 1, 5)).rejects.toThrow(
        "Failed to parse outline JSON",
      );
    });
  });

  describe("saveOutlineToDatabase", () => {
    it("should upsert volume and chapters", async () => {
      const outline = {
        volumeNumber: 1,
        volumeTitle: "Volume One",
        theme: "Courage",
        chapters: [
          {
            chapterNumber: 1,
            title: "Chapter 1",
            plot: "The adventure begins",
            keyPoint: "First challenge",
            characters: ["Alice"],
            location: "Forest",
          },
        ],
      };

      await service.saveOutlineToDatabase("project-1", 1, outline);

      expect(prisma.writingVolume.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId_volumeNumber: { projectId: "project-1", volumeNumber: 1 },
          }),
          create: expect.objectContaining({ title: "Volume One" }),
        }),
      );

      expect(prisma.writingChapter.upsert).toHaveBeenCalledTimes(1);
    });

    it("should include keyPoint in outline content", async () => {
      const outline = {
        volumeNumber: 1,
        volumeTitle: "Volume One",
        theme: "Test",
        chapters: [
          {
            chapterNumber: 1,
            title: "Ch 1",
            plot: "Hero's journey",
            keyPoint: "Dragon attack",
            characters: [],
          },
        ],
      };

      await service.saveOutlineToDatabase("project-1", 1, outline);

      const upsertCall = prisma.writingChapter.upsert.mock.calls[0][0];
      expect(upsertCall.create.outline).toContain("Dragon attack");
    });
  });

  describe("updateChapterOutline", () => {
    it("should update chapter outline and set status to OUTLINING", async () => {
      prisma.writingChapter.update.mockResolvedValue({
        id: "chapter-1",
        outline: "New outline text",
        status: "OUTLINING",
      });

      const result = await service.updateChapterOutline(
        "chapter-1",
        "New outline text",
      );

      expect(prisma.writingChapter.update).toHaveBeenCalledWith({
        where: { id: "chapter-1" },
        data: {
          outline: "New outline text",
          status: "OUTLINING",
        },
      });
      expect(result.status).toBe("OUTLINING");
    });
  });

  describe("analyzeOutlineDependencies", () => {
    it("should return chapters with suggested dependencies", async () => {
      prisma.writingChapter.findMany.mockResolvedValue([
        {
          id: "ch-1",
          chapterNumber: 1,
          title: "Chapter 1",
          outline: "Beginning",
          dependsOn: [],
        },
        {
          id: "ch-2",
          chapterNumber: 2,
          title: "Chapter 2",
          outline: "Middle",
          dependsOn: [],
        },
      ]);

      const result = await service.analyzeOutlineDependencies("volume-1");

      expect(result).toHaveLength(2);
      // Chapter 2 should suggest depending on chapter 1
      const ch2 = result.find((c) => c.chapterNumber === 2);
      expect(ch2?.suggestedDependencies).toContain("ch-1");
    });

    it("should return empty suggestions for first chapter", async () => {
      prisma.writingChapter.findMany.mockResolvedValue([
        {
          id: "ch-1",
          chapterNumber: 1,
          title: "Chapter 1",
          outline: "Beginning",
          dependsOn: [],
        },
      ]);

      const result = await service.analyzeOutlineDependencies("volume-1");

      expect(result[0].suggestedDependencies).toHaveLength(0);
    });
  });
});
