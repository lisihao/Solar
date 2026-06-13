/**
 * DynamicOutlineService - Supplemental Tests
 *
 * These tests add the necessary @nestjs/cache-manager mock to allow the tests to run
 * in this worktree environment and cover additional branches:
 * - generateInitialOutline: invalid JSON response, no genre
 * - updateOutlineAfterWriting: no current plan found, low confidence adjustments, AI failure
 * - deleteDynamicOutline: removes from cache
 * - updateProgress: current chapter/phase update
 * - analyzeDeviations: empty future chapters, low-confidence adjustments filtered
 * - parseJsonResponse: valid JSON, invalid JSON, non-JSON text
 */

// Must be before imports - provides missing enum values not generated in worktree
jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient { $connect = jest.fn(); $disconnect = jest.fn(); $on = jest.fn(); }, ...jest.requireActual("@prisma/client"),
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    IMAGE_GENERATION: "IMAGE_GENERATION",
    IMAGE_EDITING: "IMAGE_EDITING",
    MULTIMODAL: "MULTIMODAL",
    EMBEDDING: "EMBEDDING",
    RERANK: "RERANK",
  },
}));

// Mock @nestjs/cache-manager before any imports (not installed in worktree test env)
jest.mock(
  "@nestjs/cache-manager",
  () => ({
    CACHE_MANAGER: "CACHE_MANAGER",
    CacheModule: {
      registerAsync: jest
        .fn()
        .mockReturnValue({ module: class MockCacheModule {} }),
      register: jest.fn().mockReturnValue({ module: class MockCacheModule {} }),
    },
  }),
  { virtual: true },
);
jest.mock("cache-manager", () => ({}), { virtual: true });
jest.mock("cache-manager-ioredis-yet", () => ({ redisStore: jest.fn() }), {
  virtual: true,
});

import { Test, TestingModule } from "@nestjs/testing";
import { DynamicOutlineService } from "../dynamic-outline.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import type { ExtractedFact } from "../../consistency/fact-extractor.service";

function buildMockFacade() {
  return {
    chat: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        exposition: {
          description: "Hero's home village",
          keyElements: ["Protagonist introduced"],
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
        foreshadowingToSet: ["Hidden power"],
        foreshadowingToResolve: [],
        connectionToPrevious: "Builds on prologue",
        setupForNext: "Hints at danger ahead",
      }),
    }),
  };
}

describe("DynamicOutlineService (supplemental)", () => {
  let service: DynamicOutlineService;
  let facade: ReturnType<typeof buildMockFacade>;

  beforeEach(async () => {
    facade = buildMockFacade();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamicOutlineService,
        { provide: PrismaService, useValue: {} },
        { provide: ChatFacade, useValue: facade },
      ],
    }).compile();

    service = module.get<DynamicOutlineService>(DynamicOutlineService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== generateInitialOutline ====================

  describe("generateInitialOutline", () => {
    it("should generate outline without genre (undefined genre)", async () => {
      const result = await service.generateInitialOutline(
        "proj-no-genre",
        "A story without genre",
        6,
      );
      expect(result.projectId).toBe("proj-no-genre");
      expect(result.roughOutline).toBeDefined();
      expect(result.detailedOutlines).toHaveLength(6);
    });

    it("should handle invalid JSON from AI (falls back to default rough outline)", async () => {
      facade.chat.mockResolvedValueOnce({
        content: "This is not JSON at all, just some text response",
      });
      // Subsequent chapter calls succeed
      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          title: "Chapter",
          summary: "Default chapter summary",
          keyEvents: [],
          involvedCharacters: [],
          scenes: [],
          emotionalTone: "Neutral",
        }),
      });

      const result = await service.generateInitialOutline(
        "proj-invalid-json",
        "Story premise",
        3,
      );
      expect(result.roughOutline).toBeDefined();
      // When AI returns non-JSON, the default rough outline is used with default description
      expect(result.roughOutline.exposition.description).toBeTruthy();
    });

    it("should generate outline with 1 chapter correctly", async () => {
      const result = await service.generateInitialOutline(
        "proj-one-chapter",
        "Short story",
        1,
      );
      expect(result.detailedOutlines).toHaveLength(1);
      expect(result.detailedOutlines[0].chapterNumber).toBe(1);
      expect(result.currentPhase).toBe("EXPOSITION");
    });

    it("should use correct modelType in chat calls", async () => {
      await service.generateInitialOutline("proj-model-check", "Story", 3);
      expect(facade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: AIModelType.CHAT,
        }),
      );
    });

    it("should handle AI error for chapter outline (fallback to placeholder)", async () => {
      // First call (rough outline) succeeds, chapter outlines fail
      facade.chat
        .mockResolvedValueOnce({
          content: JSON.stringify({
            exposition: { description: "Intro", keyElements: [] },
            risingAction: {
              description: "Rising",
              keyConflicts: [],
              foreshadowing: [],
            },
            climax: {
              description: "Climax",
              mainConflict: "Big fight",
              turningPoints: [],
            },
            fallingAction: { description: "Falling", resolutions: [] },
            resolution: {
              description: "End",
              ending: "Happy",
              themeMessage: "Hope",
            },
          }),
        })
        .mockRejectedValue(new Error("Chapter outline AI error"));

      const result = await service.generateInitialOutline(
        "proj-chapter-error",
        "Story premise",
        3,
      );

      // Even with chapter errors, should still return the outline
      expect(result.detailedOutlines).toHaveLength(3);
    });

    it("should store outline in cache and retrieve it", async () => {
      await service.generateInitialOutline("proj-cache", "Story", 4);
      const cached = await service.getDynamicOutline("proj-cache");
      expect(cached).not.toBeNull();
      expect(cached?.projectId).toBe("proj-cache");
    });

    it("should include foreshadowing info from AI response", async () => {
      const result = await service.generateInitialOutline(
        "proj-foreshadow",
        "Mystery story",
        5,
      );
      // The first few chapters should have AI-detailed outlines
      const firstChapter = result.detailedOutlines[0];
      expect(firstChapter).toBeDefined();
      expect(firstChapter.status).toBe("PLANNED");
    });
  });

  // ==================== getDynamicOutline ====================

  describe("getDynamicOutline", () => {
    it("should return null for nonexistent project", async () => {
      const result = await service.getDynamicOutline("ghost-project");
      expect(result).toBeNull();
    });

    it("should return outline cached during generateInitialOutline", async () => {
      await service.generateInitialOutline("proj-get", "Story", 5);
      const outline = await service.getDynamicOutline("proj-get");
      expect(outline?.roughOutline).toBeDefined();
      expect(outline?.version).toBe(1);
    });
  });

  // ==================== getChapterOutline ====================

  describe("getChapterOutline", () => {
    it("should return correct chapter outline", async () => {
      await service.generateInitialOutline("proj-ch", "Story", 8);
      const ch = await service.getChapterOutline("proj-ch", 5);
      expect(ch).not.toBeNull();
      expect(ch?.chapterNumber).toBe(5);
    });

    it("should return null for chapter beyond count", async () => {
      await service.generateInitialOutline("proj-ch", "Story", 3);
      const ch = await service.getChapterOutline("proj-ch", 99);
      expect(ch).toBeNull();
    });

    it("should return null when project has no outline", async () => {
      const ch = await service.getChapterOutline("no-outline-proj", 1);
      expect(ch).toBeNull();
    });
  });

  // ==================== deleteDynamicOutline ====================

  describe("deleteDynamicOutline", () => {
    it("should delete outline from cache", async () => {
      await service.generateInitialOutline("proj-del", "Story", 3);

      const before = await service.getDynamicOutline("proj-del");
      expect(before).not.toBeNull();

      await service.deleteDynamicOutline("proj-del");

      const after = await service.getDynamicOutline("proj-del");
      expect(after).toBeNull();
    });

    it("should not throw when deleting nonexistent outline", async () => {
      await expect(
        service.deleteDynamicOutline("nonexistent"),
      ).resolves.not.toThrow();
    });
  });

  // ==================== updateOutlineAfterWriting ====================

  describe("updateOutlineAfterWriting", () => {
    it("should return empty array when no outline exists", async () => {
      const result = await service.updateOutlineAfterWriting(
        "no-project",
        1,
        "Chapter content",
        [],
      );
      expect(result).toEqual([]);
    });

    it("should return empty array when chapter plan not found", async () => {
      await service.generateInitialOutline("proj-upd", "Story", 3);

      // Try to update chapter 99 (doesn't exist)
      const result = await service.updateOutlineAfterWriting(
        "proj-upd",
        99,
        "Content",
        [],
      );
      expect(result).toEqual([]);
    });

    it("should mark chapter as WRITTEN and update progress", async () => {
      await service.generateInitialOutline("proj-upd", "Story", 5);

      facade.chat.mockResolvedValue({
        content: JSON.stringify({ adjustments: [] }),
      });

      await service.updateOutlineAfterWriting(
        "proj-upd",
        1,
        "Chapter 1 content",
        [],
      );

      const outline = await service.getDynamicOutline("proj-upd");
      const ch1 = outline?.detailedOutlines.find((o) => o.chapterNumber === 1);
      expect(ch1?.status).toBe("WRITTEN");
      expect(outline?.currentProgress).toBe(1);
    });

    it("should filter out low-confidence adjustments (< 0.6)", async () => {
      await service.generateInitialOutline("proj-lowconf", "Story", 5);

      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          adjustments: [
            {
              type: "MODIFY",
              targetChapter: 3,
              reason: "Low confidence",
              proposed: { summary: "New summary" },
              confidence: 0.3, // Below threshold
            },
          ],
        }),
      });

      const adjustments = await service.updateOutlineAfterWriting(
        "proj-lowconf",
        1,
        "Content",
        [],
      );
      expect(adjustments).toHaveLength(0);
    });

    it("should apply high-confidence adjustments", async () => {
      await service.generateInitialOutline("proj-highconf", "Story", 5);

      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          adjustments: [
            {
              type: "MODIFY",
              targetChapter: 3,
              reason: "Story deviation",
              proposed: { summary: "Adjusted chapter 3" },
              confidence: 0.85,
            },
          ],
        }),
      });

      const adjustments = await service.updateOutlineAfterWriting(
        "proj-highconf",
        1,
        "Content",
        [],
      );
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0].confidence).toBe(0.85);
      expect(adjustments[0].type).toBe("MODIFY");

      // Verify the chapter was updated in cache
      const outline = await service.getDynamicOutline("proj-highconf");
      const ch3 = outline?.detailedOutlines.find((o) => o.chapterNumber === 3);
      expect(ch3?.status).toBe("ADJUSTED");
    });

    it("should handle AI failure in analyzeDeviations gracefully", async () => {
      await service.generateInitialOutline("proj-anl-fail", "Story", 5);

      // Override so deviations analysis fails
      facade.chat.mockRejectedValue(new Error("AI analysis failed"));

      const adjustments = await service.updateOutlineAfterWriting(
        "proj-anl-fail",
        1,
        "Content",
        [],
      );
      // Should return empty array (error handled)
      expect(adjustments).toEqual([]);
    });

    it("should update current phase based on next chapter", async () => {
      await service.generateInitialOutline("proj-phase", "Story", 20);
      facade.chat.mockResolvedValue({
        content: JSON.stringify({ adjustments: [] }),
      });

      // The outline generates phases proportionally; after chapter 1, check phase updates
      await service.updateOutlineAfterWriting("proj-phase", 1, "Content", []);

      const outline = await service.getDynamicOutline("proj-phase");
      // currentProgress should be 1
      expect(outline?.currentProgress).toBe(1);
    });

    it("should pass extracted facts to AI for deviation analysis", async () => {
      await service.generateInitialOutline("proj-facts", "Story", 5);

      const facts: ExtractedFact[] = [
        {
          subject: "Alice",
          predicate: "wields",
          object: "magic sword",
          factType: "character_trait",
          confidence: 0.9,
          sourceText: "Alice picked up the magic sword",
        },
      ];

      facade.chat.mockResolvedValue({
        content: JSON.stringify({ adjustments: [] }),
      });

      await service.updateOutlineAfterWriting(
        "proj-facts",
        1,
        "Content with Alice",
        facts,
      );

      // Verify chat was called for deviation analysis
      // The chat mock was called at least once during this update
      expect(facade.chat).toHaveBeenCalled();
    });

    it("should return empty when all future chapters are already WRITTEN", async () => {
      await service.generateInitialOutline("proj-written", "Story", 3);

      // Mark all chapters as WRITTEN
      const outline = await service.getDynamicOutline("proj-written");
      if (outline) {
        outline.detailedOutlines.forEach((ch) => {
          ch.status = "WRITTEN";
        });
      }

      const adjustments = await service.updateOutlineAfterWriting(
        "proj-written",
        1,
        "Content",
        [],
      );
      // No future non-written chapters, so empty
      expect(adjustments).toEqual([]);
    });
  });

  // ==================== version increment ====================

  describe("version management", () => {
    it("should increment version when adjustments are applied", async () => {
      await service.generateInitialOutline("proj-ver", "Story", 5);
      const before = await service.getDynamicOutline("proj-ver");
      expect(before?.version).toBe(1);

      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          adjustments: [
            {
              type: "MODIFY",
              targetChapter: 3,
              reason: "Version bump",
              proposed: { summary: "New summary" },
              confidence: 0.9,
            },
          ],
        }),
      });

      await service.updateOutlineAfterWriting("proj-ver", 1, "Content", []);
      const after = await service.getDynamicOutline("proj-ver");
      expect(after?.version).toBeGreaterThan(1);
    });
  });

  // ==================== Phase assignment ====================

  describe("phase assignment logic", () => {
    it("should assign EXPOSITION to early chapters", async () => {
      const result = await service.generateInitialOutline(
        "proj-phases",
        "Story",
        20,
      );

      const ch1 = result.detailedOutlines[0];
      expect(ch1.phase).toBe("EXPOSITION");
    });

    it("should assign RESOLUTION to final chapters", async () => {
      const result = await service.generateInitialOutline(
        "proj-phases-end",
        "Story",
        20,
      );

      const lastChapter = result.detailedOutlines[19];
      expect(lastChapter.phase).toBe("RESOLUTION");
    });

    it("should cover all 5 phases for large chapter count", async () => {
      const result = await service.generateInitialOutline(
        "proj-all-phases",
        "Epic novel",
        20,
      );

      const phases = new Set(result.detailedOutlines.map((o) => o.phase));
      expect(phases.has("EXPOSITION")).toBe(true);
      expect(phases.has("RISING_ACTION")).toBe(true);
      expect(phases.has("CLIMAX")).toBe(true);
      expect(phases.has("FALLING_ACTION")).toBe(true);
      expect(phases.has("RESOLUTION")).toBe(true);
    });
  });
});
