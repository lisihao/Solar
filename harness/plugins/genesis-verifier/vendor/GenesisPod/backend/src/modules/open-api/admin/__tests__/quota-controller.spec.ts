import { Test, TestingModule } from "@nestjs/testing";
import { QuotaController } from "../quota/quota.controller";
import { QuotaService } from "../quota/quota.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import {
  ProviderQuota,
  QuotaType,
  QuotaUnit,
  QuotaPeriod,
  QuotaStatus,
  QuotaDataSource,
} from "../quota/quota.types";

jest.mock("../quota/quota.service");

describe("QuotaController", () => {
  let controller: QuotaController;
  let service: jest.Mocked<QuotaService>;

  const mockProviderQuota: ProviderQuota = {
    provider: "openai",
    providerDisplayName: "OpenAI",
    providerIcon: "/icons/ai/openai.svg",
    quotaType: QuotaType.TOKENS,
    usage: 500000,
    limit: 1000000,
    remaining: 500000,
    usagePercentage: 50,
    unit: QuotaUnit.TOKENS,
    period: QuotaPeriod.MONTHLY,
    status: QuotaStatus.NORMAL,
    statusMessage: "Normal usage",
    lastUpdated: new Date("2026-03-01"),
    dataSource: QuotaDataSource.API,
    consoleUrl: "https://platform.openai.com/usage",
  };

  const mockAnthropicQuota: ProviderQuota = {
    provider: "anthropic",
    providerDisplayName: "Anthropic (Claude)",
    providerIcon: "/icons/ai/claude.svg",
    quotaType: QuotaType.TOKENS,
    usage: 200000,
    limit: 500000,
    remaining: 300000,
    usagePercentage: 40,
    unit: QuotaUnit.TOKENS,
    period: QuotaPeriod.MONTHLY,
    status: QuotaStatus.NORMAL,
    statusMessage: "Normal usage",
    lastUpdated: new Date("2026-03-01"),
    dataSource: QuotaDataSource.ESTIMATED,
    consoleUrl: "https://console.anthropic.com/settings/usage",
  };

  const mockQuotaService = {
    getAllQuotas: jest.fn(),
    getLastGlobalUpdate: jest.fn(),
    refreshAllQuotas: jest.fn(),
    refreshProviderQuota: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuotaController],
      providers: [{ provide: QuotaService, useValue: mockQuotaService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(QuotaController);
    service = module.get(QuotaService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getAllQuotas", () => {
    it("should return quotas and lastUpdated", async () => {
      const lastUpdated = new Date("2026-03-01T10:00:00Z");
      mockQuotaService.getAllQuotas.mockResolvedValue([
        mockProviderQuota,
        mockAnthropicQuota,
      ]);
      mockQuotaService.getLastGlobalUpdate.mockResolvedValue(lastUpdated);

      const result = await controller.getAllQuotas();

      expect(service.getAllQuotas).toHaveBeenCalledTimes(1);
      expect(service.getLastGlobalUpdate).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        quotas: [mockProviderQuota, mockAnthropicQuota],
        lastUpdated,
      });
    });

    it("should run getAllQuotas and getLastGlobalUpdate in parallel", async () => {
      mockQuotaService.getAllQuotas.mockResolvedValue([]);
      mockQuotaService.getLastGlobalUpdate.mockResolvedValue(null);

      await controller.getAllQuotas();

      // Both should have been called exactly once
      expect(service.getAllQuotas).toHaveBeenCalledTimes(1);
      expect(service.getLastGlobalUpdate).toHaveBeenCalledTimes(1);
    });

    it("should return null lastUpdated when no quotas have been refreshed", async () => {
      mockQuotaService.getAllQuotas.mockResolvedValue([]);
      mockQuotaService.getLastGlobalUpdate.mockResolvedValue(null);

      const result = await controller.getAllQuotas();

      expect(result.lastUpdated).toBeNull();
      expect(result.quotas).toEqual([]);
    });

    it("should return empty quotas array when no providers configured", async () => {
      mockQuotaService.getAllQuotas.mockResolvedValue([]);
      mockQuotaService.getLastGlobalUpdate.mockResolvedValue(null);

      const result = await controller.getAllQuotas();

      expect(result.quotas).toHaveLength(0);
    });

    it("should propagate errors from getAllQuotas service", async () => {
      mockQuotaService.getAllQuotas.mockRejectedValue(
        new Error("Quota fetch failed"),
      );
      mockQuotaService.getLastGlobalUpdate.mockResolvedValue(null);

      await expect(controller.getAllQuotas()).rejects.toThrow(
        "Quota fetch failed",
      );
    });
  });

  describe("refreshAllQuotas", () => {
    it("should call service.refreshAllQuotas and return quotas with lastUpdated", async () => {
      mockQuotaService.refreshAllQuotas.mockResolvedValue([mockProviderQuota]);

      const before = new Date();
      const result = await controller.refreshAllQuotas();
      const after = new Date();

      expect(service.refreshAllQuotas).toHaveBeenCalledTimes(1);
      expect(result.quotas).toEqual([mockProviderQuota]);
      expect(result.lastUpdated).toBeInstanceOf(Date);
      expect(result.lastUpdated.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(result.lastUpdated.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should return empty quotas array when no providers available", async () => {
      mockQuotaService.refreshAllQuotas.mockResolvedValue([]);

      const result = await controller.refreshAllQuotas();

      expect(result.quotas).toEqual([]);
      expect(result.lastUpdated).toBeInstanceOf(Date);
    });

    it("should return multiple provider quotas", async () => {
      mockQuotaService.refreshAllQuotas.mockResolvedValue([
        mockProviderQuota,
        mockAnthropicQuota,
      ]);

      const result = await controller.refreshAllQuotas();

      expect(result.quotas).toHaveLength(2);
    });

    it("should propagate errors from service", async () => {
      mockQuotaService.refreshAllQuotas.mockRejectedValue(
        new Error("Refresh failed"),
      );

      await expect(controller.refreshAllQuotas()).rejects.toThrow(
        "Refresh failed",
      );
    });
  });

  describe("refreshProviderQuota", () => {
    it("should call service.refreshProviderQuota with provider param and return result", async () => {
      mockQuotaService.refreshProviderQuota.mockResolvedValue(
        mockProviderQuota,
      );

      const result = await controller.refreshProviderQuota("openai");

      expect(service.refreshProviderQuota).toHaveBeenCalledWith("openai");
      expect(result).toEqual(mockProviderQuota);
    });

    it("should return the correct quota for the requested provider", async () => {
      mockQuotaService.refreshProviderQuota.mockResolvedValue(
        mockAnthropicQuota,
      );

      const result = await controller.refreshProviderQuota("anthropic");

      expect(service.refreshProviderQuota).toHaveBeenCalledWith("anthropic");
      expect(result.provider).toBe("anthropic");
    });

    it("should propagate errors from service", async () => {
      mockQuotaService.refreshProviderQuota.mockRejectedValue(
        new Error("Provider refresh failed"),
      );

      await expect(controller.refreshProviderQuota("openai")).rejects.toThrow(
        "Provider refresh failed",
      );
    });

    it("should handle unknown provider gracefully by returning unavailable quota", async () => {
      const unavailableQuota: ProviderQuota = {
        ...mockProviderQuota,
        provider: "unknown",
        status: QuotaStatus.UNAVAILABLE,
        dataSource: QuotaDataSource.UNAVAILABLE,
      };
      mockQuotaService.refreshProviderQuota.mockResolvedValue(unavailableQuota);

      const result = await controller.refreshProviderQuota("unknown");

      expect(result.status).toBe(QuotaStatus.UNAVAILABLE);
    });
  });
});
