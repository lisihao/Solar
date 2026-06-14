jest.mock(
  "@nestjs/cache-manager",
  () => ({
    CACHE_MANAGER: "CACHE_MANAGER",
    CacheModule: {
      registerAsync: jest.fn().mockReturnValue({ module: class {} }),
    },
  }),
  { virtual: true },
);

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { AiFileOrganizerController } from "../ai-file-organizer.controller";
import {
  AiFileOrganizerService,
  FileInfo,
  OrganizationSuggestion,
} from "../ai-file-organizer.service";
import { Request } from "express";

describe("AiFileOrganizerController", () => {
  let controller: AiFileOrganizerController;
  let organizerService: jest.Mocked<AiFileOrganizerService>;

  const mockFileInfo: FileInfo = {
    id: "file-1",
    name: "report.pdf",
    type: "PDF",
    size: 1024,
    content: "Some content",
  } as unknown as FileInfo;

  const mockSuggestion: OrganizationSuggestion = {
    resourceId: "file-1",
    suggestedCategory: "Research",
    suggestedTags: ["AI", "Report"],
    confidence: 0.9,
  } as unknown as OrganizationSuggestion;

  const mockBatchResult = {
    success: true,
    suggestions: [mockSuggestion],
    totalFiles: 1,
    processedFiles: 1,
    errors: [],
  };

  const mockReq = { user: { id: "user-1" } } as unknown as Request & {
    user?: { id: string };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiFileOrganizerController],
      providers: [
        {
          provide: AiFileOrganizerService,
          useValue: {
            batchAnalyze: jest.fn().mockResolvedValue(mockBatchResult),
            analyzeFile: jest.fn().mockResolvedValue(mockSuggestion),
            applySuggestion: jest.fn().mockResolvedValue(undefined),
            getExistingCategories: jest
              .fn()
              .mockResolvedValue(["Research", "Development"]),
            getExistingTags: jest
              .fn()
              .mockResolvedValue(["AI", "Report", "Tech"]),
            findRelatedFiles: jest.fn().mockResolvedValue([mockFileInfo]),
          },
        },
      ],
    }).compile();

    controller = module.get<AiFileOrganizerController>(
      AiFileOrganizerController,
    );
    organizerService = module.get(AiFileOrganizerService);
  });

  describe("analyzeFiles", () => {
    it("should return analysis results for multiple files", async () => {
      const dto = { files: [mockFileInfo] };
      const result = await controller.analyzeFiles(mockReq, dto);

      expect(organizerService.batchAnalyze).toHaveBeenCalledWith([
        mockFileInfo,
      ]);
      expect(result).toEqual({
        suggestions: mockSuggestion ? [mockSuggestion] : [],
        totalFiles: 1,
        processedFiles: 1,
        errors: [],
      });
    });

    it("should throw BadRequestException when batchAnalyze fails", async () => {
      organizerService.batchAnalyze.mockResolvedValue({
        success: false,
        suggestions: [],
        totalFiles: 1,
        processedFiles: 0,
        errors: ["Timeout", "Invalid file"],
      });

      const dto = { files: [mockFileInfo] };

      await expect(controller.analyzeFiles(mockReq, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException with default message when no errors array", async () => {
      organizerService.batchAnalyze.mockResolvedValue({
        success: false,
        suggestions: [],
        totalFiles: 1,
        processedFiles: 0,
        errors: undefined,
      });

      const dto = { files: [mockFileInfo] };

      await expect(controller.analyzeFiles(mockReq, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("analyzeSingleFile", () => {
    it("should return suggestion for a single file", async () => {
      const result = await controller.analyzeSingleFile(mockReq, mockFileInfo);

      expect(organizerService.analyzeFile).toHaveBeenCalledWith(mockFileInfo);
      expect(result).toEqual({ suggestion: mockSuggestion });
    });
  });

  describe("applySuggestion", () => {
    it("should apply a suggestion and return success message", async () => {
      const dto = {
        resourceId: "file-1",
        suggestion: { suggestedCategory: "Research" },
      };

      const result = await controller.applySuggestion(mockReq, dto);

      expect(organizerService.applySuggestion).toHaveBeenCalledWith("file-1", {
        suggestedCategory: "Research",
      });
      expect(result).toEqual({ message: "Suggestion applied successfully" });
    });
  });

  describe("getCategories", () => {
    it("should return list of existing categories", async () => {
      const result = await controller.getCategories();

      expect(organizerService.getExistingCategories).toHaveBeenCalled();
      expect(result).toEqual({ categories: ["Research", "Development"] });
    });
  });

  describe("getTags", () => {
    it("should return list of existing tags", async () => {
      const result = await controller.getTags();

      expect(organizerService.getExistingTags).toHaveBeenCalled();
      expect(result).toEqual({ tags: ["AI", "Report", "Tech"] });
    });
  });

  describe("findRelatedFiles", () => {
    it("should return related files", async () => {
      const result = await controller.findRelatedFiles(
        mockReq,
        "file-1",
        mockFileInfo,
      );

      expect(organizerService.findRelatedFiles).toHaveBeenCalledWith(
        mockFileInfo,
      );
      expect(result).toEqual({ relatedFiles: [mockFileInfo] });
    });
  });
});
