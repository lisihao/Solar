import { Test, TestingModule } from "@nestjs/testing";
import { QualityController } from "../quality.controller";
import { QualityService } from "../quality.service";

describe("QualityController", () => {
  let controller: QualityController;
  let qualityService: jest.Mocked<QualityService>;

  const mockIssue = {
    id: "issue-1",
    resourceId: "res-1",
    severity: "HIGH",
    message: "Missing title",
    reviewStatus: "PENDING",
  };

  const mockStats = {
    total: 50,
    highSeverity: 10,
    mediumSeverity: 20,
    lowSeverity: 20,
    reviewed: 15,
  };

  const mockAssessmentResult = {
    resourceId: "res-1",
    score: 85,
    issues: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QualityController],
      providers: [
        {
          provide: QualityService,
          useValue: {
            getIssues: jest.fn().mockResolvedValue([mockIssue]),
            getStats: jest.fn().mockResolvedValue(mockStats),
            assessResourceQuality: jest
              .fn()
              .mockResolvedValue(mockAssessmentResult),
            batchAssessQuality: jest.fn().mockResolvedValue(50),
            updateReviewStatus: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<QualityController>(QualityController);
    qualityService = module.get(QualityService);
  });

  describe("getIssues", () => {
    it("should return quality issues with metadata", async () => {
      const result = await controller.getIssues();
      expect(qualityService.getIssues).toHaveBeenCalledWith({
        severity: undefined,
        reviewStatus: undefined,
        limit: undefined,
      });
      expect(result).toEqual({ data: [mockIssue], total: 1 });
    });

    it("should pass filters and parsed limit to service", async () => {
      qualityService.getIssues.mockResolvedValue([]);
      const result = await controller.getIssues("HIGH", "PENDING", "20");
      expect(qualityService.getIssues).toHaveBeenCalledWith({
        severity: "HIGH",
        reviewStatus: "PENDING",
        limit: 20,
      });
      expect(result).toEqual({ data: [], total: 0 });
    });
  });

  describe("getStats", () => {
    it("should return quality statistics", async () => {
      const result = await controller.getStats();
      expect(qualityService.getStats).toHaveBeenCalled();
      expect(result).toBe(mockStats);
    });
  });

  describe("assessQuality", () => {
    it("should assess quality for a resource and return result", async () => {
      const result = await controller.assessQuality("res-1");
      expect(qualityService.assessResourceQuality).toHaveBeenCalledWith(
        "res-1",
      );
      expect(result).toBe(mockAssessmentResult);
    });
  });

  describe("batchAssess", () => {
    it("should batch assess with default limit of 100", async () => {
      const result = await controller.batchAssess();
      expect(qualityService.batchAssessQuality).toHaveBeenCalledWith(100);
      expect(result).toEqual({
        message: "Assessed 50 resources",
        assessed: 50,
      });
    });

    it("should parse custom limit from query string", async () => {
      const result = await controller.batchAssess("200");
      expect(qualityService.batchAssessQuality).toHaveBeenCalledWith(200);
      expect(result).toEqual({
        message: "Assessed 50 resources",
        assessed: 50,
      });
    });
  });

  describe("updateReview", () => {
    it("should update review status and return success message", async () => {
      const body = { status: "APPROVED", note: "Looks good" };
      const result = await controller.updateReview("res-1", body);

      expect(qualityService.updateReviewStatus).toHaveBeenCalledWith(
        "res-1",
        "APPROVED",
        "Looks good",
      );
      expect(result).toEqual({ message: "Review status updated" });
    });

    it("should pass undefined note when not provided", async () => {
      const body = { status: "REJECTED" };
      await controller.updateReview("res-1", body);

      expect(qualityService.updateReviewStatus).toHaveBeenCalledWith(
        "res-1",
        "REJECTED",
        undefined,
      );
    });
  });
});
