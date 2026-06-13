/**
 * Unit tests for DynamicOutlineService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { DynamicOutlineService } from "../dynamic-outline.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

function buildMockPrisma() {
  return {};
}

function buildMockFacade() {
  return {
    chat: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        exposition: {
          description: "Hero's home village",
          keyElements: ["Protagonist introduced", "Village life"],
        },
        risingAction: {
          description: "Journey begins",
          keyConflicts: ["Rival appears"],
          foreshadowing: ["Ancient prophecy"],
        },
        climax: {
          description: "Final confrontation",
          mainConflict: "Hero vs Dragon",
          turningPoints: ["Dragon defeated"],
        },
        fallingAction: {
          description: "Recovery period",
          resolutions: ["Peace restored"],
        },
        resolution: {
          description: "New beginning",
          ending: "Happy ending",
          themeMessage: "Courage prevails",
        },
        title: "Chapter One",
        summary: "The adventure begins",
        keyEvents: ["Event 1"],
        involvedCharacters: ["Alice"],
        scenes: [{ location: "Forest", description: "Dark and mysterious" }],
        emotionalTone: "Excited",
      }),
    }),
  };
}

describe("DynamicOutlineService", () => {
  let service: DynamicOutlineService;
  let facade: ReturnType<typeof buildMockFacade>;

  beforeEach(async () => {
    const prisma = buildMockPrisma();
    facade = buildMockFacade();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamicOutlineService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatFacade, useValue: facade },
      ],
    }).compile();

    service = module.get<DynamicOutlineService>(DynamicOutlineService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("generateInitialOutline", () => {
    it("should generate outline with correct structure", async () => {
      const result = await service.generateInitialOutline(
        "project-1",
        "A young hero discovers magic",
        10,
        "fantasy",
      );

      expect(result.projectId).toBe("project-1");
      expect(result.roughOutline).toBeDefined();
      expect(result.detailedOutlines).toHaveLength(10);
      expect(result.currentPhase).toBe("EXPOSITION");
      expect(result.currentProgress).toBe(0);
    });

    it("should generate rough outline with all 5 phases", async () => {
      const result = await service.generateInitialOutline(
        "project-1",
        "Epic fantasy tale",
        20,
      );

      const rough = result.roughOutline;
      expect(rough.exposition).toBeDefined();
      expect(rough.risingAction).toBeDefined();
      expect(rough.climax).toBeDefined();
      expect(rough.fallingAction).toBeDefined();
      expect(rough.resolution).toBeDefined();
    });

    it("should call facade with CHAT model type", async () => {
      await service.generateInitialOutline("project-1", "Fantasy story", 5);

      expect(facade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: AIModelType.CHAT,
        }),
      );
    });

    it("should use default rough outline when AI fails", async () => {
      facade.chat.mockRejectedValueOnce(new Error("API error"));
      // Second call (for detailed outlines) succeeds
      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          title: "Chapter",
          summary: "Summary",
          keyEvents: [],
          involvedCharacters: [],
          scenes: [],
          emotionalTone: "Neutral",
        }),
      });

      const result = await service.generateInitialOutline(
        "project-1",
        "Story premise",
        5,
      );

      // Should still have outline structure
      expect(result.roughOutline).toBeDefined();
      expect(result.detailedOutlines).toHaveLength(5);
    });

    it("should assign phases proportionally based on target chapters", async () => {
      const result = await service.generateInitialOutline(
        "project-1",
        "Story",
        20,
      );

      const expositionCount = result.detailedOutlines.filter(
        (o) => o.phase === "EXPOSITION",
      ).length;
      const climaxCount = result.detailedOutlines.filter(
        (o) => o.phase === "CLIMAX",
      ).length;

      // Exposition should be ~15% and climax ~20%
      expect(expositionCount).toBeLessThan(climaxCount + 3);
    });
  });

  describe("getDynamicOutline", () => {
    it("should return null when no outline exists", async () => {
      const result = await service.getDynamicOutline("no-project");

      expect(result).toBeNull();
    });

    it("should return outline after generation", async () => {
      await service.generateInitialOutline("project-2", "Test story", 5);

      const result = await service.getDynamicOutline("project-2");

      expect(result).not.toBeNull();
      expect(result?.projectId).toBe("project-2");
    });
  });

  describe("getChapterOutline", () => {
    it("should return specific chapter outline", async () => {
      await service.generateInitialOutline("project-1", "Story", 5);

      const outline = await service.getChapterOutline("project-1", 1);

      expect(outline).not.toBeNull();
      expect(outline?.chapterNumber).toBe(1);
    });

    it("should return null when chapter does not exist", async () => {
      await service.generateInitialOutline("project-1", "Story", 5);

      const outline = await service.getChapterOutline("project-1", 100);

      expect(outline).toBeNull();
    });

    it("should return null when project outline not found", async () => {
      const outline = await service.getChapterOutline("no-project", 1);

      expect(outline).toBeNull();
    });
  });

  describe("updateOutlineAfterWriting", () => {
    it("should return empty array when no outline exists", async () => {
      const result = await service.updateOutlineAfterWriting(
        "no-project",
        1,
        "Written content",
        [],
      );

      expect(result).toEqual([]);
    });

    it("should update progress after writing", async () => {
      await service.generateInitialOutline("project-1", "Story", 5);

      // Suppress AI analysis call
      facade.chat.mockResolvedValue({
        content: JSON.stringify({ adjustments: [] }),
      });

      await service.updateOutlineAfterWriting(
        "project-1",
        1,
        "Written chapter 1 content",
        [],
      );

      const outline = await service.getDynamicOutline("project-1");
      expect(outline?.currentProgress).toBe(1);

      const ch1 = outline?.detailedOutlines.find((o) => o.chapterNumber === 1);
      expect(ch1?.status).toBe("WRITTEN");
    });

    it("should apply adjustments with high confidence", async () => {
      await service.generateInitialOutline("project-1", "Story", 5);

      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          adjustments: [
            {
              type: "MODIFY",
              targetChapter: 3,
              reason: "Story deviated",
              proposed: { summary: "New summary for ch 3" },
              confidence: 0.9,
            },
          ],
        }),
      });

      const adjustments = await service.updateOutlineAfterWriting(
        "project-1",
        1,
        "Content that deviates from plan",
        [],
      );

      expect(adjustments).toHaveLength(1);
      expect(adjustments[0].targetChapter).toBe(3);
    });

    it("should ignore adjustments with confidence below 0.6", async () => {
      await service.generateInitialOutline("project-1", "Story", 5);

      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          adjustments: [
            {
              type: "MODIFY",
              targetChapter: 3,
              reason: "Minor deviation",
              proposed: { summary: "Maybe new summary" },
              confidence: 0.4,
            },
          ],
        }),
      });

      const adjustments = await service.updateOutlineAfterWriting(
        "project-1",
        1,
        "Content",
        [],
      );

      expect(adjustments).toHaveLength(0);
    });
  });

  describe("deleteDynamicOutline", () => {
    it("should remove outline from cache", async () => {
      await service.generateInitialOutline("project-1", "Story", 3);
      await service.deleteDynamicOutline("project-1");

      const result = await service.getDynamicOutline("project-1");
      expect(result).toBeNull();
    });
  });
});
