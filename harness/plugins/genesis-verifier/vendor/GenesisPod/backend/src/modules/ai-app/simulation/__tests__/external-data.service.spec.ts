jest.mock("axios");

import { Test, TestingModule } from "@nestjs/testing";
import axios from "axios";
import { ExternalDataService } from "../external-data.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";

const mockAxios = axios as jest.Mocked<typeof axios>;

describe("ExternalDataService", () => {
  let service: ExternalDataService;
  let prisma: jest.Mocked<PrismaService>;

  const mockProvider = {
    id: "market-data",
    name: "Market Data API",
    category: "market",
    enabled: true,
    baseUrl: "https://api.marketdata.com/v1",
    apiKey: "test-api-key",
    headers: null,
    isDefault: true,
  };

  beforeEach(async () => {
    const mockPrisma = {
      systemSetting: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExternalDataService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ExternalDataService>(ExternalDataService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockAxios.get.mockReset();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== loadProviders (via getSnapshot) ====================

  describe("getSnapshot", () => {
    it("should return empty snapshot when no providers configured", async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getSnapshot();

      expect(result).toHaveProperty("snapshot");
      expect(result).toHaveProperty("evidence");
      expect(result.evidence.every((e: any) => !e.ok)).toBe(true);
    });

    it("should return snapshot with data from all default categories", async () => {
      const providers = [mockProvider];
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify(providers),
      });
      mockAxios.get.mockResolvedValue({ data: { price: 100 } });

      const result = await service.getSnapshot(["market"]);

      expect(result.snapshot).toHaveProperty("market");
      expect(result.snapshot.market).toEqual({ price: 100 });
      expect(result.evidence[0].ok).toBe(true);
      expect(result.evidence[0].category).toBe("market");
    });

    it("should mark categories with errors", async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([mockProvider]),
      });
      mockAxios.get.mockRejectedValue(new Error("Network error"));

      const result = await service.getSnapshot(["market"]);

      expect(result.snapshot.market).toHaveProperty("error");
      expect(result.evidence[0].ok).toBe(false);
    });

    it("should handle provider with no configuration (returns provider_not_configured)", async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getSnapshot(["market"]);

      expect(result.evidence[0].ok).toBe(false);
      expect(result.evidence[0].error).toBe("provider_not_configured");
    });
  });

  // ==================== fetchFromProvider ====================

  describe("fetchFromProvider", () => {
    it("should return provider_not_configured when no providers set", async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.fetchFromProvider("market");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("provider_not_configured");
    });

    it("should return provider_not_configured when category has no providers", async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([{ ...mockProvider, category: "finance" }]),
      });

      const result = await service.fetchFromProvider("market");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("provider_not_configured");
    });

    it("should return provider_disabled when provider is disabled", async () => {
      const disabledProvider = { ...mockProvider, enabled: false };
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([disabledProvider]),
      });

      const result = await service.fetchFromProvider("market");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("provider_disabled");
    });

    it("should return missing_base_url when baseUrl not set", async () => {
      const noUrlProvider = { ...mockProvider, baseUrl: undefined };
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([noUrlProvider]),
      });

      const result = await service.fetchFromProvider("market");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("missing_base_url");
    });

    it("should fetch data successfully from provider", async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([mockProvider]),
      });
      mockAxios.get.mockResolvedValue({ data: { marketCap: 1000000 } });

      const result = await service.fetchFromProvider("market");

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ marketCap: 1000000 });
      expect(result.providerId).toBe("market-data");
    });

    it("should use Authorization header when apiKey provided without URL placeholder", async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([mockProvider]),
      });
      mockAxios.get.mockResolvedValue({ data: {} });

      await service.fetchFromProvider("market");

      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        }),
      );
    });

    it("should append API key to URL when URL has api key placeholder", async () => {
      const urlKeyProvider = {
        ...mockProvider,
        baseUrl: "https://api.example.com/data?apiKey=",
      };
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([urlKeyProvider]),
      });
      mockAxios.get.mockResolvedValue({ data: {} });

      await service.fetchFromProvider("market");

      expect(mockAxios.get).toHaveBeenCalledWith(
        "https://api.example.com/data?apiKey=test-api-key",
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.anything(),
          }),
        }),
      );
    });

    it("should append path when provided", async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([mockProvider]),
      });
      mockAxios.get.mockResolvedValue({ data: {} });

      await service.fetchFromProvider("market-data", "stocks/latest");

      expect(mockAxios.get).toHaveBeenCalledWith(
        "https://api.marketdata.com/v1/stocks/latest",
        expect.any(Object),
      );
    });

    it("should handle HTTP error response", async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([mockProvider]),
      });
      mockAxios.get.mockRejectedValue({
        response: { status: 401 },
        message: "Unauthorized",
      });

      const result = await service.fetchFromProvider("market");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("HTTP_401");
    });

    it("should handle network error", async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([mockProvider]),
      });
      mockAxios.get.mockRejectedValue({ message: "ECONNREFUSED" });

      const result = await service.fetchFromProvider("market");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("ECONNREFUSED");
    });

    it("should parse custom headers from JSON string", async () => {
      const providerWithHeaders = {
        ...mockProvider,
        headers: JSON.stringify({ "X-Custom-Header": "custom-value" }),
      };
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([providerWithHeaders]),
      });
      mockAxios.get.mockResolvedValue({ data: {} });

      await service.fetchFromProvider("market");

      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Custom-Header": "custom-value",
          }),
        }),
      );
    });

    it("should prioritize default enabled provider in category", async () => {
      const providers = [
        { ...mockProvider, id: "provider-1", isDefault: false, enabled: true },
        { ...mockProvider, id: "provider-2", isDefault: true, enabled: true },
        { ...mockProvider, id: "provider-3", isDefault: false, enabled: false },
      ];
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify(providers),
      });
      mockAxios.get.mockResolvedValue({ data: {} });

      const result = await service.fetchFromProvider("market");

      expect(result.providerId).toBe("provider-2");
    });

    it("should filter out invalid providers without id or name", async () => {
      const providers = [
        {
          id: "",
          name: "Missing ID",
          category: "market",
          enabled: true,
          baseUrl: "https://example.com",
          apiKey: "key",
        },
        {
          id: "valid",
          name: "Valid",
          category: "market",
          enabled: true,
          baseUrl: "https://valid.com",
          apiKey: "key",
        },
      ];
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify(providers),
      });
      mockAxios.get.mockResolvedValue({ data: {} });

      const result = await service.fetchFromProvider("market");

      expect(result.providerId).toBe("valid");
    });

    it("should return provider_not_configured when all providers are invalid", async () => {
      const providers = [
        { id: "", name: "No ID", category: "market", enabled: true },
      ];
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify(providers),
      });

      const result = await service.fetchFromProvider("market");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("provider_not_configured");
    });
  });

  // ==================== testProvider ====================

  describe("testProvider", () => {
    it("should return missing_base_url when no baseUrl", async () => {
      const result = await service.testProvider({
        id: "test",
        name: "Test Provider",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("missing_base_url");
    });

    it("should test provider successfully", async () => {
      mockAxios.get.mockResolvedValue({ data: { status: "ok" } });

      const result = await service.testProvider({
        id: "test",
        name: "Test Provider",
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ status: "ok" });
      expect(result.providerId).toBe("test");
    });

    it("should mask API key in returned endpoint", async () => {
      mockAxios.get.mockResolvedValue({ data: {} });

      const result = await service.testProvider({
        id: "test",
        name: "Test Provider",
        baseUrl: "https://api.example.com?apiKey=",
        apiKey: "secret-key-123",
      });

      expect(result.endpoint).not.toContain("secret-key-123");
      expect(result.endpoint).toContain("***");
    });

    it("should use Bearer auth when URL has no placeholder", async () => {
      mockAxios.get.mockResolvedValue({ data: {} });

      await service.testProvider({
        id: "test",
        name: "Test",
        baseUrl: "https://api.example.com",
        apiKey: "bearer-token",
      });

      expect(mockAxios.get).toHaveBeenCalledWith(
        "https://api.example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer bearer-token",
          }),
        }),
      );
    });

    it("should handle HTTP error from provider test", async () => {
      mockAxios.get.mockRejectedValue({
        response: { status: 403 },
        message: "Forbidden",
      });

      const result = await service.testProvider({
        id: "test",
        name: "Test",
        baseUrl: "https://api.example.com",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("HTTP_403");
    });

    it("should handle network failure in provider test", async () => {
      mockAxios.get.mockRejectedValue({ message: "ETIMEDOUT" });

      const result = await service.testProvider({
        id: "test",
        name: "Test",
        baseUrl: "https://api.example.com",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("ETIMEDOUT");
    });

    it("should parse custom headers for test provider", async () => {
      mockAxios.get.mockResolvedValue({ data: {} });

      await service.testProvider({
        id: "test",
        name: "Test",
        baseUrl: "https://api.example.com",
        headers: JSON.stringify({ "X-Tenant": "my-tenant" }),
      });

      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ "X-Tenant": "my-tenant" }),
        }),
      );
    });

    it("should warn on invalid headers JSON", async () => {
      mockAxios.get.mockResolvedValue({ data: {} });

      // Should not throw for invalid JSON headers
      await expect(
        service.testProvider({
          id: "test",
          name: "Test",
          baseUrl: "https://api.example.com",
          headers: "not-valid-json",
        }),
      ).resolves.toBeDefined();
    });
  });
});
