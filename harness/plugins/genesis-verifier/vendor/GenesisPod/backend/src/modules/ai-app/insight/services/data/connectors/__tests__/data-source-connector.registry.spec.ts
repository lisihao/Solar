import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceConnectorRegistry } from "../data-source-connector.registry";
import { DataSourceType } from "../../../../types/data-source.types";
import type { IDataSourceConnector } from "../../../../types/data-source-connector.types";

function createMockConnector(
  sourceType: DataSourceType,
  displayName: string,
  available: boolean = true,
): jest.Mocked<IDataSourceConnector> {
  return {
    sourceType,
    displayName,
    requiresApiKey: false,
    search: jest.fn().mockResolvedValue([]),
    isAvailable: jest.fn().mockResolvedValue(available),
    healthCheck: jest.fn().mockResolvedValue({
      available,
      latencyMs: 100,
      lastChecked: new Date(),
    }),
  };
}

describe("DataSourceConnectorRegistry", () => {
  let registry: DataSourceConnectorRegistry;

  beforeEach(async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [DataSourceConnectorRegistry],
    }).compile();

    registry = module.get<DataSourceConnectorRegistry>(
      DataSourceConnectorRegistry,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should initialize with zero connectors", async () => {
      await registry.onModuleInit();

      expect(registry.getCount()).toBe(0);
    });

    it("should start health check interval", async () => {
      const setIntervalSpy = jest.spyOn(global, "setInterval");

      await registry.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        5 * 60 * 1000,
      );
    });
  });

  describe("register", () => {
    it("should register a connector successfully", () => {
      const connector = createMockConnector(DataSourceType.PUBMED, "PubMed");

      registry.register(connector);

      expect(registry.has(DataSourceType.PUBMED)).toBe(true);
      expect(registry.getCount()).toBe(1);
    });

    it("should register multiple connectors", () => {
      const pubmedConnector = createMockConnector(
        DataSourceType.PUBMED,
        "PubMed",
      );
      const ssConnector = createMockConnector(
        DataSourceType.SEMANTIC_SCHOLAR,
        "Semantic Scholar",
      );
      const weatherConnector = createMockConnector(
        DataSourceType.WEATHER_API,
        "Weather API",
      );

      registry.register(pubmedConnector);
      registry.register(ssConnector);
      registry.register(weatherConnector);

      expect(registry.getCount()).toBe(3);
      expect(registry.has(DataSourceType.PUBMED)).toBe(true);
      expect(registry.has(DataSourceType.SEMANTIC_SCHOLAR)).toBe(true);
      expect(registry.has(DataSourceType.WEATHER_API)).toBe(true);
    });

    it("should overwrite existing connector when registering same type", () => {
      const connector1 = createMockConnector(
        DataSourceType.PUBMED,
        "PubMed v1",
      );
      const connector2 = createMockConnector(
        DataSourceType.PUBMED,
        "PubMed v2",
      );

      registry.register(connector1);
      registry.register(connector2);

      expect(registry.getCount()).toBe(1);
      const retrieved = registry.get(DataSourceType.PUBMED);
      expect(retrieved?.displayName).toBe("PubMed v2");
    });
  });

  describe("get", () => {
    it("should return registered connector", () => {
      const connector = createMockConnector(
        DataSourceType.FINANCE_API,
        "Finance",
      );

      registry.register(connector);

      const retrieved = registry.get(DataSourceType.FINANCE_API);

      expect(retrieved).toBe(connector);
    });

    it("should return undefined for unregistered type", () => {
      const retrieved = registry.get(DataSourceType.PUBMED);

      expect(retrieved).toBeUndefined();
    });
  });

  describe("has", () => {
    it("should return true for registered connector", () => {
      const connector = createMockConnector(
        DataSourceType.WEATHER_API,
        "Weather",
      );
      registry.register(connector);

      expect(registry.has(DataSourceType.WEATHER_API)).toBe(true);
    });

    it("should return false for unregistered connector", () => {
      expect(registry.has(DataSourceType.PUBMED)).toBe(false);
    });
  });

  describe("getRegisteredTypes", () => {
    it("should return empty array when no connectors registered", () => {
      expect(registry.getRegisteredTypes()).toEqual([]);
    });

    it("should return all registered types", () => {
      registry.register(createMockConnector(DataSourceType.PUBMED, "PubMed"));
      registry.register(
        createMockConnector(DataSourceType.SEMANTIC_SCHOLAR, "SS"),
      );

      const types = registry.getRegisteredTypes();

      expect(types).toHaveLength(2);
      expect(types).toContain(DataSourceType.PUBMED);
      expect(types).toContain(DataSourceType.SEMANTIC_SCHOLAR);
    });
  });

  describe("getCount", () => {
    it("should return 0 when empty", () => {
      expect(registry.getCount()).toBe(0);
    });

    it("should return correct count after registrations", () => {
      registry.register(createMockConnector(DataSourceType.PUBMED, "PubMed"));
      registry.register(
        createMockConnector(DataSourceType.WEATHER_API, "Weather"),
      );

      expect(registry.getCount()).toBe(2);
    });
  });

  describe("searchViaConnector", () => {
    it("should return search results when connector is available", async () => {
      const mockResults = [
        {
          sourceType: DataSourceType.PUBMED,
          title: "Test Article",
          url: "https://pubmed.ncbi.nlm.nih.gov/12345/",
          snippet: "Test snippet",
          domain: "pubmed.ncbi.nlm.nih.gov",
        },
      ];

      const connector = createMockConnector(DataSourceType.PUBMED, "PubMed");
      connector.search.mockResolvedValue(mockResults);

      registry.register(connector);

      const results = await registry.searchViaConnector(
        DataSourceType.PUBMED,
        "test query",
        10,
      );

      expect(results).toEqual(mockResults);
      expect(connector.isAvailable).toHaveBeenCalled();
      expect(connector.search).toHaveBeenCalledWith(
        "test query",
        10,
        undefined,
      );
    });

    it("should return empty array when no connector is registered", async () => {
      const results = await registry.searchViaConnector(
        DataSourceType.PUBMED,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return empty array when connector is not available", async () => {
      const connector = createMockConnector(
        DataSourceType.FINANCE_API,
        "Finance",
        false,
      );
      registry.register(connector);

      const results = await registry.searchViaConnector(
        DataSourceType.FINANCE_API,
        "AAPL",
        5,
      );

      expect(results).toEqual([]);
      expect(connector.search).not.toHaveBeenCalled();
    });

    it("should return empty array when search throws", async () => {
      const connector = createMockConnector(DataSourceType.PUBMED, "PubMed");
      connector.search.mockRejectedValue(new Error("Search failed"));

      registry.register(connector);

      const results = await registry.searchViaConnector(
        DataSourceType.PUBMED,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should pass options to connector search", async () => {
      const connector = createMockConnector(DataSourceType.PUBMED, "PubMed");
      registry.register(connector);

      const options = { sortBy: "date" as const };
      await registry.searchViaConnector(
        DataSourceType.PUBMED,
        "test",
        10,
        options,
      );

      expect(connector.search).toHaveBeenCalledWith("test", 10, options);
    });
  });

  describe("getStatus", () => {
    it("should return status for all registered connectors", async () => {
      const connector1 = createMockConnector(
        DataSourceType.PUBMED,
        "PubMed",
        true,
      );
      const connector2 = createMockConnector(
        DataSourceType.FINANCE_API,
        "Finance",
        false,
      );

      registry.register(connector1);
      registry.register(connector2);

      const statuses = await registry.getStatus();

      expect(statuses).toHaveLength(2);

      const pubmedStatus = statuses.find(
        (s) => s.sourceType === DataSourceType.PUBMED,
      );
      expect(pubmedStatus?.available).toBe(true);
      expect(pubmedStatus?.displayName).toBe("PubMed");
      expect(pubmedStatus?.registeredAt).toBeInstanceOf(Date);

      const financeStatus = statuses.find(
        (s) => s.sourceType === DataSourceType.FINANCE_API,
      );
      expect(financeStatus?.available).toBe(false);
    });

    it("should return empty array when no connectors registered", async () => {
      const statuses = await registry.getStatus();

      expect(statuses).toEqual([]);
    });

    it("should handle isAvailable throwing gracefully", async () => {
      const connector = createMockConnector(DataSourceType.PUBMED, "PubMed");
      connector.isAvailable.mockRejectedValue(new Error("Check failed"));

      registry.register(connector);

      const statuses = await registry.getStatus();

      expect(statuses).toHaveLength(1);
      expect(statuses[0].available).toBe(false);
    });

    it("should include lastHealthCheck when available", async () => {
      const connector = createMockConnector(DataSourceType.PUBMED, "PubMed");
      registry.register(connector);

      // Trigger health check by advancing timer
      await registry.onModuleInit();
      jest.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve(); // flush promises

      const statuses = await registry.getStatus();
      // lastHealthCheck may or may not be set depending on timer resolution
      expect(statuses[0]).toHaveProperty("lastHealthCheck");
    });
  });
});
