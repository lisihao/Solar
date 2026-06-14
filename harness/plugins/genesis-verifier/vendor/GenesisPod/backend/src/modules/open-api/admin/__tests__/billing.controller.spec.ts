import { Test, TestingModule } from "@nestjs/testing";
import { BillingController } from "../billing/billing.controller";
import { BillingService } from "../services/billing.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

jest.mock("../services/billing.service");

describe("BillingController", () => {
  let controller: BillingController;
  let service: jest.Mocked<BillingService>;

  const mockBillingOverview = {
    totalSpent: 1500.75,
    todaySpent: 25.5,
    monthSpent: 300.0,
    activeSpenders: 12,
    byModule: [
      { module: "AI_RESEARCH", spent: 500, count: 50 },
      { module: "AI_ASK", spent: 300, count: 100 },
    ],
    byModel: [{ model: "gpt-4", spent: 800, tokens: 100000, count: 80 }],
    dailyTrend: [
      { date: "2026-03-01", spent: 100 },
      { date: "2026-03-02", spent: 200 },
    ],
  };

  const mockDailyDetail = {
    date: "2026-03-01",
    totalSpent: 100,
    transactionCount: 10,
    transactions: [
      {
        id: "tx-1",
        amount: 10,
        module: "AI_RESEARCH",
        model: "gpt-4",
        description: "Research task",
        userEmail: "user@example.com",
        userName: "Test User",
        createdAt: new Date("2026-03-01"),
      },
    ],
    byModule: [{ module: "AI_RESEARCH", spent: 100, count: 10 }],
    byModel: [{ model: "gpt-4", spent: 100, count: 10 }],
  };

  const mockBillingService = {
    getBillingOverview: jest.fn(),
    getDailyDetail: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [{ provide: BillingService, useValue: mockBillingService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(BillingController);
    service = module.get(BillingService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getBillingOverview", () => {
    it("should call service.getBillingOverview and return result", async () => {
      mockBillingService.getBillingOverview.mockResolvedValue(
        mockBillingOverview,
      );

      const result = await controller.getBillingOverview();

      expect(service.getBillingOverview).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockBillingOverview);
    });

    it("should return overview with expected structure", async () => {
      mockBillingService.getBillingOverview.mockResolvedValue(
        mockBillingOverview,
      );

      const result = await controller.getBillingOverview();

      expect(result).toHaveProperty("totalSpent");
      expect(result).toHaveProperty("todaySpent");
      expect(result).toHaveProperty("monthSpent");
      expect(result).toHaveProperty("activeSpenders");
      expect(result).toHaveProperty("byModule");
      expect(result).toHaveProperty("byModel");
      expect(result).toHaveProperty("dailyTrend");
    });

    it("should propagate errors from service", async () => {
      mockBillingService.getBillingOverview.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(controller.getBillingOverview()).rejects.toThrow("DB error");
    });
  });

  describe("getDailyDetail", () => {
    it("should call service.getDailyDetail with date param and return result", async () => {
      mockBillingService.getDailyDetail.mockResolvedValue(mockDailyDetail);

      const result = await controller.getDailyDetail("2026-03-01");

      expect(service.getDailyDetail).toHaveBeenCalledWith("2026-03-01");
      expect(result).toEqual(mockDailyDetail);
    });

    it("should pass the date string to service as-is", async () => {
      mockBillingService.getDailyDetail.mockResolvedValue(mockDailyDetail);

      await controller.getDailyDetail("2026-02-28");

      expect(service.getDailyDetail).toHaveBeenCalledWith("2026-02-28");
    });

    it("should propagate BadRequestException from service for invalid date", async () => {
      const { BadRequestException } = await import("@nestjs/common");
      mockBillingService.getDailyDetail.mockRejectedValue(
        new BadRequestException("Invalid date format. Use YYYY-MM-DD"),
      );

      await expect(controller.getDailyDetail("invalid-date")).rejects.toThrow(
        "Invalid date format. Use YYYY-MM-DD",
      );
    });

    it("should propagate generic errors from service", async () => {
      mockBillingService.getDailyDetail.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(controller.getDailyDetail("2026-03-01")).rejects.toThrow(
        "DB error",
      );
    });
  });
});
