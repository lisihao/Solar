/**
 * Unit tests for ContextBuilderService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ContextBuilderService } from "../context-builder.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { StoryBibleService } from "../../bible/story-bible.service";
import { ToolFacade } from "@/modules/ai-harness/facade";

function buildMockPrisma() {
  return {
    writingChapter: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    writingVolume: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function buildMockStoryBible() {
  return {
    getSnapshot: jest.fn().mockResolvedValue({
      characters: [],
      worldSettings: [],
      terminologies: [],
      timelineEvents: [],
      premise: "",
    }),
  };
}

function buildMockFacade() {
  return {
    capabilityGetSkillPrompts: jest.fn().mockResolvedValue({
      content: "",
      usedSkills: [],
    }),
  };
}

describe("ContextBuilderService", () => {
  let service: ContextBuilderService;
  let prisma: ReturnType<typeof buildMockPrisma>;
  let storyBible: ReturnType<typeof buildMockStoryBible>;
  let facade: ReturnType<typeof buildMockFacade>;

  const mockChapter = {
    id: "chapter-1",
    chapterNumber: 2,
    title: "The Journey",
    outline: "Hero sets out",
    volumeId: "volume-1",
    volume: {
      project: {
        id: "project-1",
        storyBible: { id: "bible-1" },
      },
    },
  };

  beforeEach(async () => {
    prisma = buildMockPrisma();
    storyBible = buildMockStoryBible();
    facade = buildMockFacade();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextBuilderService,
        { provide: PrismaService, useValue: prisma },
        { provide: StoryBibleService, useValue: storyBible },
        { provide: ToolFacade, useValue: facade },
      ],
    }).compile();

    service = module.get<ContextBuilderService>(ContextBuilderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getContextSkillPrompts", () => {
    it("should return skill content when available", async () => {
      facade.capabilityGetSkillPrompts.mockResolvedValue({
        content: "Writing skill: Use vivid imagery",
        usedSkills: ["creative-writing"],
      });

      const result = await service.getContextSkillPrompts("project-1");

      expect(result).toBe("Writing skill: Use vivid imagery");
    });

    it("should return empty string when no skills", async () => {
      facade.capabilityGetSkillPrompts.mockResolvedValue(null);

      const result = await service.getContextSkillPrompts("project-1");

      expect(result).toBe("");
    });

    it("should return empty string on error", async () => {
      facade.capabilityGetSkillPrompts.mockRejectedValue(
        new Error("Service unavailable"),
      );

      const result = await service.getContextSkillPrompts("project-1");

      expect(result).toBe("");
    });
  });

  describe("buildWritingContext", () => {
    it("should throw error when chapter not found", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(null);

      await expect(
        service.buildWritingContext("missing-chapter"),
      ).rejects.toThrow("Chapter not found");
    });

    it("should return full context with chapter and bible data", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapter);
      storyBible.getSnapshot.mockResolvedValue({
        characters: [{ name: "Alice", role: "protagonist" }],
        worldSettings: [{ name: "Forest", category: "location" }],
        terminologies: [],
        timelineEvents: [],
        premise: "Epic fantasy",
      });
      prisma.writingChapter.findMany.mockResolvedValue([]);

      const result = await service.buildWritingContext("chapter-1");

      expect(result.chapter.id).toBe("chapter-1");
      expect(result.characters).toBeDefined();
      expect(result.worldSettings).toBeDefined();
      expect(result.previousContext).toBeDefined();
    });

    it("should use provided bible snapshot instead of fetching", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapter);
      prisma.writingChapter.findMany.mockResolvedValue([]);

      const customBible = {
        characters: [{ name: "Custom Character" }],
        worldSettings: [],
        terminologies: [],
        timelineEvents: [],
      };

      const result = await service.buildWritingContext(
        "chapter-1",
        customBible as Record<string, unknown>,
      );

      expect(storyBible.getSnapshot).not.toHaveBeenCalled();
      expect(result.characters).toEqual([{ name: "Custom Character" }]);
    });
  });

  describe("getPreviousChapterContext", () => {
    it("should return empty array when no previous chapters", async () => {
      prisma.writingChapter.findMany.mockResolvedValue([]);

      const result = await service.getPreviousChapterContext("volume-1", 1);

      expect(result).toHaveLength(0);
    });

    it("should classify recent, medium and distant chapters", async () => {
      const chapters = Array.from({ length: 8 }, (_, i) => ({
        chapterNumber: 8 - i, // descending order
        title: `Chapter ${8 - i}`,
        content: "A".repeat(3000),
      }));

      prisma.writingChapter.findMany.mockResolvedValue(chapters);

      const result = await service.getPreviousChapterContext("volume-1", 9);

      const recent = result.filter((r) => r.contextType === "recent");
      const medium = result.filter((r) => r.contextType === "medium");
      const distant = result.filter((r) => r.contextType === "distant");

      expect(recent.length).toBe(3);
      expect(medium.length).toBe(3);
      expect(distant.length).toBe(2);
    });

    it("should truncate content for recent chapters at 2000 chars", async () => {
      const longContent = "A".repeat(5000);
      prisma.writingChapter.findMany.mockResolvedValue([
        {
          chapterNumber: 1,
          title: "Chapter 1",
          content: longContent,
        },
      ]);

      const result = await service.getPreviousChapterContext("volume-1", 2);

      expect(result[0].context.length).toBeLessThanOrEqual(2000);
    });

    it("should stop after 12 previous chapters", async () => {
      const chapters = Array.from({ length: 15 }, (_, i) => ({
        chapterNumber: 15 - i,
        title: `Chapter ${15 - i}`,
        content: "Content",
      }));

      prisma.writingChapter.findMany.mockResolvedValue(chapters);

      const result = await service.getPreviousChapterContext("volume-1", 16);

      expect(result.length).toBeLessThanOrEqual(12);
    });
  });

  describe("getCrossVolumeContext", () => {
    it("should return empty array when no previous volumes", async () => {
      prisma.writingVolume.findMany.mockResolvedValue([]);

      const result = await service.getCrossVolumeContext("project-1", 1);

      expect(result).toHaveLength(0);
    });

    it("should return key points from previous volumes", async () => {
      prisma.writingVolume.findMany.mockResolvedValue([
        {
          volumeNumber: 1,
          title: "Volume One",
          chapters: [
            {
              chapterNumber: 1,
              title: "Opening",
              content: "The beginning of the story with many adventures ahead.",
            },
            {
              chapterNumber: 10,
              title: "Ending",
              content:
                "The conclusion of volume one with a cliffhanger ending.",
            },
          ],
        },
      ]);

      const result = await service.getCrossVolumeContext("project-1", 2);

      expect(result).toHaveLength(1);
      expect(result[0].volumeNumber).toBe(1);
      expect(result[0].keyPoints.length).toBeGreaterThan(0);
    });
  });

  describe("formatWriterPrompt", () => {
    it("should include chapter task section", () => {
      const context = {
        chapter: {
          title: "Test Chapter",
          outline: "Hero faces challenge",
        },
        characters: [],
        worldSettings: [],
        previousContext: [],
      };

      const result = service.formatWriterPrompt(
        context as Record<string, unknown>,
      );

      expect(result).toContain("章节任务");
      expect(result).toContain("Test Chapter");
    });

    it("should include characters section when characters present", () => {
      const context = {
        chapter: { title: "Chapter", outline: null },
        characters: [
          {
            name: "Alice",
            role: "protagonist",
            appearance: null,
            personality: null,
          },
        ],
        worldSettings: [],
        previousContext: [],
      };

      const result = service.formatWriterPrompt(
        context as Record<string, unknown>,
      );

      expect(result).toContain("本章涉及角色");
      expect(result).toContain("Alice");
    });

    it("should include world settings when present", () => {
      const context = {
        chapter: { title: "Chapter", outline: null },
        characters: [],
        worldSettings: [
          {
            name: "Dark Forest",
            category: "location",
            description: "Ancient and mysterious",
          },
        ],
        previousContext: [],
      };

      const result = service.formatWriterPrompt(
        context as Record<string, unknown>,
      );

      expect(result).toContain("场景设定");
      expect(result).toContain("Dark Forest");
    });

    it("should format previous context with recent chapters", () => {
      const context = {
        chapter: { title: "Chapter 3", outline: null },
        characters: [],
        worldSettings: [],
        previousContext: [
          {
            chapterNumber: 1,
            title: "Chapter 1",
            context: "Some chapter 1 content",
            contextType: "recent",
          },
          {
            chapterNumber: 2,
            title: "Chapter 2",
            context: "Some chapter 2 content",
            contextType: "medium",
          },
        ],
      };

      const result = service.formatWriterPrompt(
        context as Record<string, unknown>,
      );

      expect(result).toContain("前情提要");
      expect(result).toContain("最近章节");
    });
  });
});
