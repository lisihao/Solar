/**
 * Unit tests for WritingQualityService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WritingQualityService } from "../writing-quality.service";
import { ExpressionMemoryService } from "../../quality/expression-memory.service";
import { WritingQualityGateService } from "../../quality/quality-gate.service";

function buildMockExpressionMemory() {
  return {
    getCoolingExpressions: jest.fn(),
    generateAvoidancePrompt: jest.fn(),
    analyzeAndRecordExpressions: jest.fn(),
  };
}

function buildMockQualityGate() {
  return {
    checkQualityGate: jest.fn(),
  };
}

describe("WritingQualityService", () => {
  let service: WritingQualityService;
  let expressionMemory: ReturnType<typeof buildMockExpressionMemory>;
  let qualityGate: ReturnType<typeof buildMockQualityGate>;

  beforeEach(async () => {
    expressionMemory = buildMockExpressionMemory();
    qualityGate = buildMockQualityGate();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingQualityService,
        { provide: ExpressionMemoryService, useValue: expressionMemory },
        { provide: WritingQualityGateService, useValue: qualityGate },
      ],
    }).compile();

    service = module.get<WritingQualityService>(WritingQualityService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("checkChapterQuality", () => {
    it("should delegate to WritingQualityGateService", async () => {
      const mockResult = { passed: true, score: 85, issues: [] };
      qualityGate.checkQualityGate.mockResolvedValue(mockResult);

      const result = await service.checkChapterQuality(
        "project-1",
        "chapter-1",
        1,
        "Chapter content here",
      );

      expect(qualityGate.checkQualityGate).toHaveBeenCalledWith(
        "project-1",
        "chapter-1",
        1,
        "Chapter content here",
      );
      expect(result).toEqual(mockResult);
    });

    it("should propagate errors from WritingQualityGateService", async () => {
      qualityGate.checkQualityGate.mockRejectedValue(new Error("DB error"));

      await expect(
        service.checkChapterQuality("project-1", "chapter-1", 1, "content"),
      ).rejects.toThrow("DB error");
    });
  });

  describe("getCoolingExpressions", () => {
    it("should delegate to ExpressionMemoryService with default limit", async () => {
      const mockExpressions = [{ expression: "suddenly", coolingUntil: 5 }];
      expressionMemory.getCoolingExpressions.mockResolvedValue(mockExpressions);

      const result = await service.getCoolingExpressions("project-1", 3);

      expect(expressionMemory.getCoolingExpressions).toHaveBeenCalledWith(
        "project-1",
        3,
        200,
      );
      expect(result).toEqual(mockExpressions);
    });

    it("should pass custom limit", async () => {
      expressionMemory.getCoolingExpressions.mockResolvedValue([]);

      await service.getCoolingExpressions("project-1", 2, 50);

      expect(expressionMemory.getCoolingExpressions).toHaveBeenCalledWith(
        "project-1",
        2,
        50,
      );
    });
  });

  describe("generateAvoidancePrompt", () => {
    it("should delegate to ExpressionMemoryService", async () => {
      const mockPrompt = "Avoid using: 突然, 猛然";
      expressionMemory.generateAvoidancePrompt.mockResolvedValue(mockPrompt);

      const result = await service.generateAvoidancePrompt("project-1", 4);

      expect(expressionMemory.generateAvoidancePrompt).toHaveBeenCalledWith(
        "project-1",
        4,
      );
      expect(result).toBe(mockPrompt);
    });

    it("should return empty string when no cooling expressions", async () => {
      expressionMemory.generateAvoidancePrompt.mockResolvedValue("");

      const result = await service.generateAvoidancePrompt("project-1", 1);

      expect(result).toBe("");
    });
  });

  describe("analyzeAndRecordExpressions", () => {
    it("should delegate to ExpressionMemoryService", async () => {
      const mockAnalysis = { recorded: 5 };
      expressionMemory.analyzeAndRecordExpressions.mockResolvedValue(
        mockAnalysis,
      );

      const result = await service.analyzeAndRecordExpressions(
        "project-1",
        "chapter-1",
        1,
        "Long chapter content with many expressions",
      );

      expect(expressionMemory.analyzeAndRecordExpressions).toHaveBeenCalledWith(
        "project-1",
        "chapter-1",
        1,
        "Long chapter content with many expressions",
      );
      expect(result).toEqual(mockAnalysis);
    });

    it("should handle errors from ExpressionMemoryService", async () => {
      expressionMemory.analyzeAndRecordExpressions.mockRejectedValue(
        new Error("Analysis failed"),
      );

      await expect(
        service.analyzeAndRecordExpressions(
          "project-1",
          "chapter-1",
          1,
          "content",
        ),
      ).rejects.toThrow("Analysis failed");
    });
  });
});
