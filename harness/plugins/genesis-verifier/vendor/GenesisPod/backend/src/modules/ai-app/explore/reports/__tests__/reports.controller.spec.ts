import { Test, TestingModule } from "@nestjs/testing";
import { ReportsController } from "../reports.controller";
import { ReportsService } from "../reports.service";
import { GenerateReportDto } from "../dto/generate-report.dto";
import { Response } from "express";

describe("ReportsController", () => {
  let controller: ReportsController;
  let reportsService: jest.Mocked<ReportsService>;

  const mockReport = {
    id: "report-1",
    title: "AI Research Report",
    content: "Report content",
    userId: "user-1",
    createdAt: new Date(),
  };

  const mockPaginatedReports = {
    data: [mockReport],
    total: 1,
    page: 1,
    limit: 20,
  };

  const mockRes = () => {
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    return res as unknown as Response;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        {
          provide: ReportsService,
          useValue: {
            generateReport: jest.fn().mockResolvedValue(mockReport),
            chatWithResources: jest.fn().mockResolvedValue(undefined),
            findOne: jest.fn().mockResolvedValue(mockReport),
            findByUser: jest.fn().mockResolvedValue(mockPaginatedReports),
            delete: jest.fn().mockResolvedValue({ success: true }),
            exportDocument: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<ReportsController>(ReportsController);
    reportsService = module.get(ReportsService);
  });

  describe("generateReport", () => {
    it("should generate a report and return it", async () => {
      const dto: GenerateReportDto = {
        resourceIds: ["res-1", "res-2"],
        title: "AI Research",
        userId: "user-1",
      } as unknown as GenerateReportDto;

      const result = await controller.generateReport(dto);
      expect(reportsService.generateReport).toHaveBeenCalledWith(dto);
      expect(result).toBe(mockReport);
    });
  });

  describe("chatWithResources", () => {
    it("should delegate chat to service and pass response object", async () => {
      const res = mockRes();
      const dto = { resourceIds: ["res-1"], question: "What is AI?" };

      await controller.chatWithResources(dto, res);
      expect(reportsService.chatWithResources).toHaveBeenCalledWith(dto, res);
    });
  });

  describe("getReport", () => {
    it("should return a report by id", async () => {
      const result = await controller.getReport("report-1");
      expect(reportsService.findOne).toHaveBeenCalledWith(
        "report-1",
        undefined,
      );
      expect(result).toBe(mockReport);
    });

    it("should pass userId query param to service", async () => {
      const result = await controller.getReport("report-1", "user-1");
      expect(reportsService.findOne).toHaveBeenCalledWith("report-1", "user-1");
      expect(result).toBe(mockReport);
    });
  });

  describe("getUserReports", () => {
    it("should return paginated reports for user with defaults", async () => {
      const result = await controller.getUserReports("user-1");
      expect(reportsService.findByUser).toHaveBeenCalledWith("user-1", 1, 20);
      expect(result).toBe(mockPaginatedReports);
    });

    it("should parse page and limit from query strings", async () => {
      const result = await controller.getUserReports("user-1", "2", "10");
      expect(reportsService.findByUser).toHaveBeenCalledWith("user-1", 2, 10);
      expect(result).toBe(mockPaginatedReports);
    });
  });

  describe("deleteReport", () => {
    it("should delete a report for a user", async () => {
      const result = await controller.deleteReport("report-1", "user-1");
      expect(reportsService.delete).toHaveBeenCalledWith("report-1", "user-1");
      expect(result).toEqual({ success: true });
    });
  });

  describe("exportDocument", () => {
    it("should export document and pass response object to service", async () => {
      const res = mockRes();
      const dto = {
        format: "pdf",
        content: "Report content",
        title: "My Report",
        userId: "user-1",
      };

      await controller.exportDocument(dto, res);
      expect(reportsService.exportDocument).toHaveBeenCalledWith(
        dto,
        res,
        "user-1",
      );
    });

    it("should use system as default userId when not provided", async () => {
      const res = mockRes();
      const dto = {
        format: "pdf",
        content: "Report content",
        title: "My Report",
      };

      await controller.exportDocument(dto, res);
      expect(reportsService.exportDocument).toHaveBeenCalledWith(
        dto,
        res,
        "system",
      );
    });
  });
});
