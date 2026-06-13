/**
 * Unit tests for WritingContextService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WritingContextService } from "../writing-context.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ToolFacade } from "@/modules/ai-harness/facade";
import { StyleTemplateService } from "../../style/style-template.service";
import { ProfessionalVoiceService } from "../../quality/professional-voice.service";
import { SensoryImmersionService } from "../../quality/sensory-immersion.service";
import { OpeningHookService } from "../../quality/opening-hook.service";
import { NarrativeCraftService } from "../../quality/narrative-craft.service";
import { PacingControlService } from "../../quality/pacing-control.service";

function buildMocks() {
  const prisma = {
    writingChapter: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const facade = {
    capabilityGetSkillPrompts: jest.fn().mockResolvedValue({
      content: "",
      usedSkills: [],
    }),
  };

  const styleTemplate = {
    getMergedStyleConfig: jest.fn().mockResolvedValue(null),
  };

  const professionalVoice = {
    extractProfessionFromBackground: jest.fn().mockReturnValue(null),
    generateChapterVoiceConstraints: jest.fn().mockReturnValue(""),
  };

  const sensoryImmersion = {
    generateImmersionConstraints: jest.fn().mockReturnValue(""),
  };

  const openingHook = {
    generateOpeningConstraints: jest.fn().mockReturnValue(""),
  };

  const narrativeCraft = {
    generateNarrativeCraftConstraints: jest.fn().mockReturnValue(""),
  };

  const pacingControl = {
    generatePacingConstraints: jest.fn().mockReturnValue(""),
  };

  return {
    prisma,
    facade,
    styleTemplate,
    professionalVoice,
    sensoryImmersion,
    openingHook,
    narrativeCraft,
    pacingControl,
  };
}

describe("WritingContextService", () => {
  let service: WritingContextService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingContextService,
        { provide: PrismaService, useValue: mocks.prisma },
        { provide: ToolFacade, useValue: mocks.facade },
        { provide: StyleTemplateService, useValue: mocks.styleTemplate },
        {
          provide: ProfessionalVoiceService,
          useValue: mocks.professionalVoice,
        },
        { provide: SensoryImmersionService, useValue: mocks.sensoryImmersion },
        { provide: OpeningHookService, useValue: mocks.openingHook },
        { provide: NarrativeCraftService, useValue: mocks.narrativeCraft },
        { provide: PacingControlService, useValue: mocks.pacingControl },
      ],
    }).compile();

    service = module.get<WritingContextService>(WritingContextService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getWritingSkillPrompts", () => {
    it("should return skill content when skills available", async () => {
      mocks.facade.capabilityGetSkillPrompts.mockResolvedValue({
        content: "Use descriptive language",
        usedSkills: ["creative-writing"],
      });

      const result = await service.getWritingSkillPrompts({
        roleId: "writer",
      });

      expect(result).toBe("Use descriptive language");
    });

    it("should return empty string when no skills available", async () => {
      mocks.facade.capabilityGetSkillPrompts.mockResolvedValue({
        content: "",
        usedSkills: [],
      });

      const result = await service.getWritingSkillPrompts({});

      expect(result).toBe("");
    });

    it("should return empty string on facade error", async () => {
      mocks.facade.capabilityGetSkillPrompts.mockRejectedValue(
        new Error("Skill resolver failed"),
      );

      const result = await service.getWritingSkillPrompts({});

      expect(result).toBe("");
    });
  });

  describe("generateQualityConstraints", () => {
    it("should return non-empty string with final check footer", async () => {
      const result = await service.generateQualityConstraints(1);

      expect(typeof result).toBe("string");
      expect(result).toContain("最终核验清单");
    });

    it("should include narrative craft constraints when non-empty", async () => {
      mocks.narrativeCraft.generateNarrativeCraftConstraints.mockReturnValue(
        "No preaching allowed",
      );

      const result = await service.generateQualityConstraints(1);

      expect(result).toContain("No preaching allowed");
    });

    it("should include voice constraints when characters provided", async () => {
      mocks.professionalVoice.generateChapterVoiceConstraints.mockReturnValue(
        "Voice constraint text",
      );
      mocks.professionalVoice.extractProfessionFromBackground.mockReturnValue(
        "doctor",
      );

      const result = await service.generateQualityConstraints(
        1,
        "Chapter outline text",
        [{ name: "Dr. Smith", background: "Medical professional" }],
      );

      expect(result).toContain("Voice constraint text");
    });

    it("should include pacing constraints when projectId provided", async () => {
      mocks.pacingControl.generatePacingConstraints.mockReturnValue(
        "Pacing constraint text",
      );

      const result = await service.generateQualityConstraints(
        3,
        undefined,
        undefined,
        "project-1",
      );

      expect(result).toContain("Pacing constraint text");
    });

    it("should not throw when individual constraint services fail", async () => {
      mocks.narrativeCraft.generateNarrativeCraftConstraints.mockImplementation(
        () => {
          throw new Error("Service error");
        },
      );

      await expect(
        service.generateQualityConstraints(1),
      ).resolves.not.toThrow();
    });
  });

  describe("getTemplateStylePrompt", () => {
    it("should return fullPrompt when project has style config", async () => {
      mocks.styleTemplate.getMergedStyleConfig.mockResolvedValue({
        fullPrompt: "Modern realistic style",
      });

      const result = await service.getTemplateStylePrompt("project-1");

      expect(result).toBe("Modern realistic style");
    });

    it("should return undefined when project not found", async () => {
      mocks.styleTemplate.getMergedStyleConfig.mockResolvedValue(null);

      const result = await service.getTemplateStylePrompt("missing-project");

      expect(result).toBeUndefined();
    });

    it("should return undefined on error", async () => {
      mocks.styleTemplate.getMergedStyleConfig.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.getTemplateStylePrompt("project-1");

      expect(result).toBeUndefined();
    });
  });

  describe("extractChapterContext", () => {
    it("should return empty context when no previous chapters", async () => {
      mocks.prisma.writingChapter.findMany.mockResolvedValue([]);

      const result = await service.extractChapterContext("project-1", 1);

      expect(result.previousChapters).toHaveLength(0);
      expect(result.recentSummary).toBe("");
    });

    it("should return context from previous chapters", async () => {
      mocks.prisma.writingChapter.findMany.mockResolvedValue([
        {
          chapterNumber: 1,
          title: "Chapter One",
          content:
            "The hero set out on a journey that would take them far from home. They walked through forests and mountains, facing many challenges along the way.",
        },
      ]);

      const result = await service.extractChapterContext("project-1", 2);

      expect(result.previousChapters).toHaveLength(1);
      expect(result.previousChapters[0].number).toBe(1);
      expect(result.previousChapters[0].title).toBe("Chapter One");
    });

    it("should handle DB error gracefully", async () => {
      mocks.prisma.writingChapter.findMany.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.extractChapterContext("project-1", 2);

      expect(result.previousChapters).toHaveLength(0);
      expect(result.recentSummary).toBe("");
    });
  });

  describe("buildChapterWriterPrompt", () => {
    it("should return a non-empty string with chapter task info", async () => {
      const result = await service.buildChapterWriterPrompt({
        projectId: "project-1",
        chapterNumber: 1,
      });

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("章节写作任务");
    });

    it("should include chapter outline when provided", async () => {
      const result = await service.buildChapterWriterPrompt({
        projectId: "project-1",
        chapterNumber: 2,
        chapterOutline: "Hero fights the dragon",
      });

      expect(result).toContain("Hero fights the dragon");
    });

    it("should include style prompt when available", async () => {
      mocks.styleTemplate.getMergedStyleConfig.mockResolvedValue({
        fullPrompt: "Noir detective style",
      });

      const result = await service.buildChapterWriterPrompt({
        projectId: "project-1",
        chapterNumber: 1,
      });

      expect(result).toContain("Noir detective style");
    });
  });
});
