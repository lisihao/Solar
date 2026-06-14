/**
 * Unit tests for WritingContentGeneratorService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { WritingContentGeneratorService } from "../writing-content-generator.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { WritingMissionInput } from "../writing-mission.service";

function buildMockPrisma() {
  return {
    writingProject: {
      findUnique: jest.fn(),
    },
  };
}

function buildMockFacade() {
  return {
    chat: jest.fn().mockResolvedValue({
      content: "AI generated story content for testing purposes",
      tokensUsed: 200,
    }),
  };
}

describe("WritingContentGeneratorService", () => {
  let service: WritingContentGeneratorService;
  let prisma: ReturnType<typeof buildMockPrisma>;
  let facade: ReturnType<typeof buildMockFacade>;

  const baseMissionInput: WritingMissionInput = {
    projectId: "project-1",
    missionType: "chapter",
    chapterId: "chapter-1",
    userPrompt: "Write a chapter about a hero's journey",
    targetWordCount: 3000,
  };

  beforeEach(async () => {
    prisma = buildMockPrisma();
    facade = buildMockFacade();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingContentGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatFacade, useValue: facade },
      ],
    }).compile();

    service = module.get<WritingContentGeneratorService>(
      WritingContentGeneratorService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("numberToChinese", () => {
    it("should convert single digits", () => {
      expect(service.numberToChinese(1)).toBe("一");
      expect(service.numberToChinese(5)).toBe("五");
      expect(service.numberToChinese(10)).toBe("十");
    });

    it("should convert teens", () => {
      expect(service.numberToChinese(11)).toBe("十一");
      expect(service.numberToChinese(19)).toBe("十九");
    });

    it("should convert tens", () => {
      expect(service.numberToChinese(20)).toBe("二十");
      expect(service.numberToChinese(35)).toBe("三十五");
    });

    it("should use toString for numbers >= 100", () => {
      expect(service.numberToChinese(100)).toBe("100");
    });
  });

  describe("buildChapterWriterPrompt", () => {
    const chapterInfo = {
      title: "The Beginning",
      plot: "Hero discovers their destiny",
      keyPoint: "First battle",
    };
    const outline = {
      core: { summary: "Epic tale", genre: "fantasy", theme: "courage" },
    };

    it("should include chapter number and title", () => {
      const result = service.buildChapterWriterPrompt(
        1,
        chapterInfo,
        outline,
        {},
        "",
        "Fantasy adventure story",
      );

      expect(result).toContain("第一章");
      expect(result).toContain("The Beginning");
    });

    it("should include story prompt and genre", () => {
      const result = service.buildChapterWriterPrompt(
        1,
        chapterInfo,
        outline,
        {},
        "",
        "Fantasy adventure story",
      );

      expect(result).toContain("Fantasy adventure story");
      expect(result).toContain("fantasy");
    });

    it("should include previous summary when provided", () => {
      const result = service.buildChapterWriterPrompt(
        2,
        chapterInfo,
        outline,
        {},
        "In the previous chapter, the hero set out.",
        "Story",
      );

      expect(result).toContain("In the previous chapter, the hero set out.");
    });

    it("should include opening note for first chapter with no previous summary", () => {
      const result = service.buildChapterWriterPrompt(
        1,
        chapterInfo,
        outline,
        {},
        "",
        "Story",
      );

      expect(result).toContain("这是故事的开始");
    });

    it("should include avoidance prompt when provided", () => {
      const result = service.buildChapterWriterPrompt(
        1,
        chapterInfo,
        outline,
        {},
        "",
        "Story",
        undefined,
        undefined,
        "突然, 猛然",
      );

      expect(result).toContain("突然");
    });

    it("should include target word count in requirements", () => {
      const result = service.buildChapterWriterPrompt(
        1,
        chapterInfo,
        outline,
        {},
        "",
        "Story",
        undefined,
        undefined,
        undefined,
        undefined,
        5000,
      );

      expect(result).toContain("5000");
    });

    it("should include character info when world settings have characters", () => {
      const worldSettings = {
        characters: [
          {
            name: "Alice",
            role: "protagonist",
            personality: ["brave", "curious"],
            motivation: "Save the world",
          },
        ],
      };

      const result = service.buildChapterWriterPrompt(
        1,
        chapterInfo,
        outline,
        worldSettings,
        "",
        "Story",
      );

      expect(result).toContain("Alice");
    });

    it("should use template style prompt when provided over styleId", () => {
      const result = service.buildChapterWriterPrompt(
        1,
        chapterInfo,
        outline,
        {},
        "",
        "Story",
        undefined,
        undefined,
        undefined,
        "Custom template style prompt text",
      );

      expect(result).toContain("Custom template style prompt text");
    });
  });

  describe("generateContentDirectly", () => {
    it("should call facade.chat and return content", async () => {
      facade.chat.mockResolvedValue({ content: "Generated story content" });

      const result = await service.generateContentDirectly(
        baseMissionInput,
        "model-gpt4",
        "mission-1",
      );

      expect(facade.chat).toHaveBeenCalled();
      expect(result).toBe("Generated story content");
    });

    it("should return null when facade returns no content", async () => {
      facade.chat.mockResolvedValue({ content: null });

      const result = await service.generateContentDirectly(
        baseMissionInput,
        "model-gpt4",
        "mission-1",
      );

      expect(result).toBeNull();
    });

    it("should throw error when facade throws", async () => {
      facade.chat.mockRejectedValue(new Error("API rate limit"));

      await expect(
        service.generateContentDirectly(
          baseMissionInput,
          "model-gpt4",
          "mission-1",
        ),
      ).rejects.toThrow("API rate limit");
    });

    it("should include targetWordCount in prompt when specified", async () => {
      const inputWithWords = { ...baseMissionInput, targetWordCount: 5000 };

      await service.generateContentDirectly(
        inputWithWords,
        "model-gpt4",
        "mission-1",
      );

      const callArgs = facade.chat.mock.calls[0][0];
      const userMessage = callArgs.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("5000");
    });

    it("should build outline prompt for outline mission type", async () => {
      const outlineInput = {
        ...baseMissionInput,
        missionType: "outline" as const,
      };

      await service.generateContentDirectly(
        outlineInput,
        "model-gpt4",
        "mission-1",
      );

      const callArgs = facade.chat.mock.calls[0][0];
      const userMessage = callArgs.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("大纲");
    });

    it("should handle edit mission type with executeLeaderCommand", async () => {
      const editInput = { ...baseMissionInput, missionType: "edit" as const };
      const executeLeaderCommand = jest
        .fn()
        .mockResolvedValue("Edited content result");

      const result = await service.generateContentDirectly(
        editInput,
        "model-gpt4",
        "mission-1",
        executeLeaderCommand,
      );

      expect(executeLeaderCommand).toHaveBeenCalled();
      expect(result).toBe("Edited content result");
    });

    it("should return DELEGATE_FULL_STORY_INTERNAL for delegation", async () => {
      const editInput = { ...baseMissionInput, missionType: "edit" as const };
      const executeLeaderCommand = jest
        .fn()
        .mockResolvedValue("[DELEGATE_TO_FULL_STORY] proceed");

      const result = await service.generateContentDirectly(
        editInput,
        "model-gpt4",
        "mission-1",
        executeLeaderCommand,
      );

      expect(result).toBe("[DELEGATE_FULL_STORY_INTERNAL]");
    });
  });

  describe("generateFullStory", () => {
    it("should throw NotFoundException when project not found", async () => {
      prisma.writingProject.findUnique.mockResolvedValue(null);

      await expect(
        service.generateFullStory(baseMissionInput, "model-gpt4", "mission-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw error for invalid userPrompt", async () => {
      prisma.writingProject.findUnique.mockResolvedValue({
        targetWords: 100000,
        description: null,
        name: null,
      });

      const inputWithEmptyPrompt = { ...baseMissionInput, userPrompt: "" };

      await expect(
        service.generateFullStory(
          inputWithEmptyPrompt,
          "model-gpt4",
          "mission-1",
        ),
      ).rejects.toThrow();
    });

    it("should throw not-implemented error even with valid input", async () => {
      prisma.writingProject.findUnique.mockResolvedValue({
        targetWords: 100000,
        description: "A great story",
        name: "My Novel",
      });

      await expect(
        service.generateFullStory(baseMissionInput, "model-gpt4", "mission-1"),
      ).rejects.toThrow("generateFullStory is not implemented");
    });
  });
});
