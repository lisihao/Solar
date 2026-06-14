/**
 * Unit tests for WritingStyleService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WritingStyleService } from "../writing-style.service";
import { StyleTemplateService } from "../../style/style-template.service";

function buildMockStyleTemplateService() {
  return {
    getMergedStyleConfig: jest.fn(),
  };
}

describe("WritingStyleService", () => {
  let service: WritingStyleService;
  let styleTemplateService: ReturnType<typeof buildMockStyleTemplateService>;

  beforeEach(async () => {
    styleTemplateService = buildMockStyleTemplateService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingStyleService,
        {
          provide: StyleTemplateService,
          useValue: styleTemplateService,
        },
      ],
    }).compile();

    service = module.get<WritingStyleService>(WritingStyleService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getProjectStylePrompt", () => {
    it("should return fullPrompt from merged style config", async () => {
      styleTemplateService.getMergedStyleConfig.mockResolvedValue({
        fullPrompt: "Write in a modern realistic style.",
      });

      const result = await service.getProjectStylePrompt("project-1");

      expect(result).toBe("Write in a modern realistic style.");
      expect(styleTemplateService.getMergedStyleConfig).toHaveBeenCalledWith(
        "project-1",
      );
    });

    it("should return undefined when project not found", async () => {
      styleTemplateService.getMergedStyleConfig.mockResolvedValue(null);

      const result = await service.getProjectStylePrompt("missing-project");

      expect(result).toBeUndefined();
    });

    it("should return undefined and not throw on service error", async () => {
      styleTemplateService.getMergedStyleConfig.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.getProjectStylePrompt("project-1");

      expect(result).toBeUndefined();
    });
  });

  describe("recommendStylesByGenre", () => {
    it("should return style recommendations for known genre", () => {
      const result = service.recommendStylesByGenre("fantasy");
      expect(Array.isArray(result)).toBe(true);
    });

    it("should return array for unknown genre", () => {
      const result = service.recommendStylesByGenre("unknown-genre-xyz");
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("generateStylePromptFromPreset", () => {
    it("should return a non-empty string for a known preset", () => {
      const result = service.generateStylePromptFromPreset("modern_realistic");
      expect(typeof result).toBe("string");
    });

    it("should return a string for unknown preset", () => {
      const result =
        service.generateStylePromptFromPreset("non-existent-style");
      expect(typeof result).toBe("string");
    });
  });

  describe("mapTemperatureToCreativity", () => {
    it("should return deterministic for temp <= 0.2", () => {
      expect(service.mapTemperatureToCreativity(0.0)).toBe("deterministic");
      expect(service.mapTemperatureToCreativity(0.2)).toBe("deterministic");
    });

    it("should return low for temp 0.21-0.3", () => {
      expect(service.mapTemperatureToCreativity(0.3)).toBe("low");
    });

    it("should return medium for temp 0.31-0.7", () => {
      expect(service.mapTemperatureToCreativity(0.5)).toBe("medium");
      expect(service.mapTemperatureToCreativity(0.7)).toBe("medium");
    });

    it("should return high for temp > 0.7", () => {
      expect(service.mapTemperatureToCreativity(0.8)).toBe("high");
      expect(service.mapTemperatureToCreativity(1.0)).toBe("high");
    });
  });

  describe("mapMaxTokensToOutputLength", () => {
    it("should return minimal for tokens <= 1000", () => {
      expect(service.mapMaxTokensToOutputLength(500)).toBe("minimal");
      expect(service.mapMaxTokensToOutputLength(1000)).toBe("minimal");
    });

    it("should return short for tokens 1001-2000", () => {
      expect(service.mapMaxTokensToOutputLength(1500)).toBe("short");
      expect(service.mapMaxTokensToOutputLength(2000)).toBe("short");
    });

    it("should return medium for tokens 2001-4000", () => {
      expect(service.mapMaxTokensToOutputLength(3000)).toBe("medium");
      expect(service.mapMaxTokensToOutputLength(4000)).toBe("medium");
    });

    it("should return standard for tokens 4001-6000", () => {
      expect(service.mapMaxTokensToOutputLength(5000)).toBe("standard");
      expect(service.mapMaxTokensToOutputLength(6000)).toBe("standard");
    });

    it("should return long for tokens 6001-8000", () => {
      expect(service.mapMaxTokensToOutputLength(7000)).toBe("long");
      expect(service.mapMaxTokensToOutputLength(8000)).toBe("long");
    });

    it("should return extended for tokens > 8000", () => {
      expect(service.mapMaxTokensToOutputLength(10000)).toBe("extended");
    });
  });
});
