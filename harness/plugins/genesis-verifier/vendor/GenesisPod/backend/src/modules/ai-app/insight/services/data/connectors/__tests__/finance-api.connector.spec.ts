import { Test, TestingModule } from "@nestjs/testing";
import { FinanceApiConnector } from "../finance-api.connector";
import { DataSourceType } from "../../../../types/data-source.types";
import { SecretsService } from "@/modules/platform/facade";
import { ToolKeyResolverService } from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockSecretsService = {
  getValueInternal: jest.fn(),
};

const mockToolKeyResolver = {
  resolveToolKey: jest.fn().mockResolvedValue(null),
};

describe("FinanceApiConnector", () => {
  let connector: FinanceApiConnector;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSecretsService.getValueInternal.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceApiConnector,
        { provide: SecretsService, useValue: mockSecretsService },
        { provide: ToolKeyResolverService, useValue: mockToolKeyResolver },
      ],
    }).compile();

    connector = module.get<FinanceApiConnector>(FinanceApiConnector);
  });

  describe("connector metadata", () => {
    it("should have correct sourceType", () => {
      expect(connector.sourceType).toBe(DataSourceType.FINANCE_API);
    });

    it("should have correct displayName", () => {
      expect(connector.displayName).toBe("Finance Data API");
    });

    it("should require API key", () => {
      expect(connector.requiresApiKey).toBe(true);
    });
  });

  describe("search", () => {
    const mockAlphaVantageResponse = {
      bestMatches: [
        {
          "1. symbol": "AAPL",
          "2. name": "Apple Inc.",
          "3. type": "Equity",
          "4. region": "United States",
          "8. currency": "USD",
          "9. matchScore": "0.9500",
        },
        {
          "1. symbol": "AAPLU",
          "2. name": "Apple Inc Warrants",
          "3. type": "Equity",
          "4. region": "United States",
          "8. currency": "USD",
          "9. matchScore": "0.8000",
        },
      ],
    };

    it("should return results when API key is configured and search succeeds", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("test-api-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockAlphaVantageResponse),
      });

      const results = await connector.search("Apple", 10);

      expect(results).toHaveLength(2);
      expect(results[0].sourceType).toBe(DataSourceType.FINANCE_API);
      expect(results[0].title).toBe("Apple Inc. (AAPL)");
      expect(results[0].url).toBe("https://finance.yahoo.com/quote/AAPL");
      expect(results[0].domain).toBe("alphavantage.co");
      expect(results[0].snippet).toContain("Apple Inc.");
      expect(results[0].snippet).toContain("Equity");
      expect(results[0].snippet).toContain("United States");
      expect(results[0].snippet).toContain("USD");
      expect(results[0].metadata?.symbol).toBe("AAPL");
      expect(results[0].metadata?.name).toBe("Apple Inc.");
      expect(results[0].metadata?.type).toBe("Equity");
      expect(results[0].metadata?.region).toBe("United States");
      expect(results[0].metadata?.currency).toBe("USD");
      expect(results[0].metadata?.matchScore).toBe("0.9500");
      expect(results[0].metadata?.sourceConnector).toBe("finance-api");
    });

    it("should return empty array when no API key is configured", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);

      const results = await connector.search("Apple", 10);

      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should return empty array when bestMatches is missing from response", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("test-api-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ Information: "API limit reached" }),
      });

      const results = await connector.search("AAPL", 5);

      expect(results).toEqual([]);
    });

    it("should return empty array when API returns error status", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("test-api-key");
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const results = await connector.search("Apple", 5);

      expect(results).toEqual([]);
    });

    it("should return empty array on network error", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("test-api-key");
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const results = await connector.search("Apple", 5);

      expect(results).toEqual([]);
    });

    it("should limit results to maxResults", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("test-api-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockAlphaVantageResponse),
      });

      const results = await connector.search("Apple", 1);

      expect(results).toHaveLength(1);
    });

    it("should include API key in request URL", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("my-secret-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ bestMatches: [] }),
      });

      await connector.search("TSLA", 5);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("apikey=my-secret-key");
      expect(callUrl).toContain("function=SYMBOL_SEARCH");
      expect(callUrl).toContain("keywords=TSLA");
    });
  });

  describe("isAvailable", () => {
    it("should return true when API key is configured", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("test-api-key");

      const available = await connector.isAvailable();

      expect(available).toBe(true);
    });

    it("should return false when API key is not configured", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);

      const available = await connector.isAvailable();

      expect(available).toBe(false);
    });

    it("should return false when API key is empty string", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("");

      const available = await connector.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("healthCheck", () => {
    it("should return unavailable when no API key configured", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);

      const health = await connector.healthCheck();

      expect(health.available).toBe(false);
      expect(health.error).toBe("API key not configured");
      expect(health.lastChecked).toBeInstanceOf(Date);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should return available=true when API key is set and request succeeds", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("test-api-key");
      mockFetch.mockResolvedValueOnce({ ok: true });

      const health = await connector.healthCheck();

      expect(health.available).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.lastChecked).toBeInstanceOf(Date);
    });

    it("should include AAPL in health check URL", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("test-key");
      mockFetch.mockResolvedValueOnce({ ok: true });

      await connector.healthCheck();

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("keywords=AAPL");
      expect(callUrl).toContain("function=SYMBOL_SEARCH");
    });

    it("should return available=false when API request fails", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("test-api-key");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const health = await connector.healthCheck();

      expect(health.available).toBe(false);
      expect(health.lastChecked).toBeInstanceOf(Date);
    });

    it("should return error string when fetch throws", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("test-api-key");
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const health = await connector.healthCheck();

      expect(health.available).toBe(false);
      expect(health.error).toContain("Connection refused");
    });
  });
});
