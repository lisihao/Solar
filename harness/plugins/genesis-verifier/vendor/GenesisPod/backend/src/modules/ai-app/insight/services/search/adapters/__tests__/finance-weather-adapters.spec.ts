/**
 * Finance and Weather Search Adapter Tests
 *
 * Covers FinanceSearchAdapter and WeatherSearchAdapter:
 * - sourceId, sourceType, concurrency, defaultTimeoutMs
 * - doSearch via executeToolSearch: tool not registered returns []
 * - doSearch: tool returns success with data, maps to DataSourceResult[]
 * - doSearch: tool returns success=false returns []
 * - doSearch: finance data mapping (name+symbol, symbol only, description, fallback)
 * - doSearch: weather data mapping (all key variations, publishedAt)
 * - doSearch: empty/non-array data returns []
 */

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  },
  AIModelType: { CHAT: "CHAT" },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  EntityHealthRegistry: class {},
  TaskCompletionType: {
    TIMEOUT: "TIMEOUT",
    API_ERROR: "API_ERROR",
    SUCCESS: "SUCCESS",
  },
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  EntityHealthRegistry: class {},
  TaskCompletionType: {
    TIMEOUT: "TIMEOUT",
    API_ERROR: "API_ERROR",
    SUCCESS: "SUCCESS",
  },
}));

jest.mock("@/common/utils/timeout.utils", () => ({
  withTimeout: jest.fn(async (promise: Promise<unknown>) => promise),
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: class {},
  ChatFacade: class {},
  RAGFacade: class {},
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: class {},
  ChatFacade: class {},
  RAGFacade: class {},
}));

import { Test, TestingModule } from "@nestjs/testing";
import { FinanceSearchAdapter } from "../finance-search.adapter";
import { WeatherSearchAdapter } from "../weather-search.adapter";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../../types/data-source.types";

// Helper to build a mock ToolRegistry
function buildMockToolRegistry(
  toolId: string,
  executeResult: {
    success: boolean;
    data?: Record<string, unknown>;
  } | null,
) {
  const mockTool =
    executeResult !== null
      ? { execute: jest.fn().mockResolvedValue(executeResult) }
      : null;

  return {
    tryGet: jest
      .fn()
      .mockImplementation((id: string) => (id === toolId ? mockTool : null)),
  };
}

// ============================================================================
// FinanceSearchAdapter
// ============================================================================
describe("FinanceSearchAdapter", () => {
  let adapter: FinanceSearchAdapter;
  let toolRegistry: ReturnType<typeof buildMockToolRegistry>;

  beforeEach(async () => {
    toolRegistry = buildMockToolRegistry("finance-api", {
      success: true,
      data: { data: [] },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceSearchAdapter,
        { provide: ToolRegistry, useValue: toolRegistry },
      ],
    }).compile();

    adapter = module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("static properties", () => {
    it("should have sourceId = finance-api", () => {
      expect(adapter.sourceId).toBe("finance-api");
    });

    it("should have sourceType = FINANCE_API", () => {
      expect(adapter.sourceType).toBe(DataSourceType.FINANCE_API);
    });

    it("should have concurrency = 1", () => {
      expect(adapter.concurrency).toBe(1);
    });

    it("should have defaultTimeoutMs = 20000", () => {
      expect(adapter.defaultTimeoutMs).toBe(20000);
    });
  });

  describe("doSearch (via search())", () => {
    it("should return empty array when tool is not registered", async () => {
      const unregisteredRegistry = buildMockToolRegistry("other-tool", {
        success: true,
        data: {},
      });
      unregisteredRegistry.tryGet.mockReturnValue(null);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceSearchAdapter,
          { provide: ToolRegistry, useValue: unregisteredRegistry },
        ],
      }).compile();

      const adapterNoTool =
        module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
      const result = await adapterNoTool.search({
        query: "AAPL",
        maxResults: 5,
      });

      expect(result.items).toEqual([]);
    });

    it("should return empty array when tool execute returns success=false", async () => {
      const registry = buildMockToolRegistry("finance-api", {
        success: false,
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const adapterFail =
        module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
      const result = await adapterFail.search({ query: "TSLA", maxResults: 5 });

      expect(result.items).toEqual([]);
    });

    it("should return empty array when data is null", async () => {
      const registry = buildMockToolRegistry("finance-api", {
        success: true,
        data: { data: null },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
      const result = await a.search({ query: "GOOG", maxResults: 5 });
      expect(result.items).toEqual([]);
    });

    it("should return empty array when data is not an array", async () => {
      const registry = buildMockToolRegistry("finance-api", {
        success: true,
        data: { data: { something: "wrong" } },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
      const result = await a.search({ query: "GOOG", maxResults: 5 });
      expect(result.items).toEqual([]);
    });

    it("should map full record with name, symbol, description", async () => {
      const registry = buildMockToolRegistry("finance-api", {
        success: true,
        data: {
          data: [
            {
              symbol: "AAPL",
              name: "Apple Inc.",
              description: "Technology company",
              exchange: "NASDAQ",
              type: "Equity",
            },
          ],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
      const result = await a.search({ query: "Apple", maxResults: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe("AAPL - Apple Inc.");
      expect(result.items[0].url).toBe("https://finance.yahoo.com/quote/AAPL");
      expect(result.items[0].snippet).toBe("Technology company");
      expect(result.items[0].domain).toBe("finance.yahoo.com");
      expect(result.items[0].sourceType).toBe(DataSourceType.FINANCE_API);
      expect(result.items[0].metadata).toMatchObject({
        symbol: "AAPL",
        exchange: "NASDAQ",
        type: "Equity",
      });
    });

    it("should map record without name (symbol only)", async () => {
      const registry = buildMockToolRegistry("finance-api", {
        success: true,
        data: {
          data: [
            {
              symbol: "BTC-USD",
              exchange: "Crypto",
              type: "Cryptocurrency",
            },
          ],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
      const result = await a.search({ query: "Bitcoin", maxResults: 1 });

      expect(result.items[0].title).toBe("BTC-USD");
      expect(result.items[0].url).toBe(
        "https://finance.yahoo.com/quote/BTC-USD",
      );
    });

    it("should map record without symbol (empty url)", async () => {
      const registry = buildMockToolRegistry("finance-api", {
        success: true,
        data: {
          data: [
            {
              name: "Unknown Corp",
              exchange: "OTC",
              type: "Equity",
            },
          ],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
      const result = await a.search({ query: "unknown", maxResults: 1 });

      expect(result.items[0].title).toBe(" - Unknown Corp");
      expect(result.items[0].url).toBe("");
    });

    it("should use type + exchange as fallback snippet when description is absent", async () => {
      const registry = buildMockToolRegistry("finance-api", {
        success: true,
        data: {
          data: [
            {
              symbol: "XYZ",
              name: "XYZ Corp",
              exchange: "NYSE",
              type: "Equity",
            },
          ],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
      const result = await a.search({ query: "xyz", maxResults: 1 });

      expect(result.items[0].snippet).toBe("Equity on NYSE");
    });

    it("should handle empty data array", async () => {
      const registry = buildMockToolRegistry("finance-api", {
        success: true,
        data: { data: [] },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
      const result = await a.search({ query: "empty", maxResults: 5 });
      expect(result.items).toEqual([]);
    });

    it("should pass query and maxResults to the tool", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { data: [] },
        }),
      };
      const registry = { tryGet: jest.fn().mockReturnValue(mockTool) };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<FinanceSearchAdapter>(FinanceSearchAdapter);
      await a.search({ query: "MSFT", maxResults: 10 });

      expect(mockTool.execute).toHaveBeenCalledWith(
        { query: "MSFT", maxResults: 10 },
        expect.objectContaining({ toolId: "finance-api" }),
      );
    });
  });
});

// ============================================================================
// WeatherSearchAdapter
// ============================================================================
describe("WeatherSearchAdapter", () => {
  let adapter: WeatherSearchAdapter;

  beforeEach(async () => {
    const registry = buildMockToolRegistry("weather-api", {
      success: true,
      data: { results: [] },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeatherSearchAdapter,
        { provide: ToolRegistry, useValue: registry },
      ],
    }).compile();

    adapter = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
  });

  describe("static properties", () => {
    it("should have sourceId = weather-api", () => {
      expect(adapter.sourceId).toBe("weather-api");
    });

    it("should have sourceType = WEATHER_API", () => {
      expect(adapter.sourceType).toBe(DataSourceType.WEATHER_API);
    });

    it("should have concurrency = 1", () => {
      expect(adapter.concurrency).toBe(1);
    });

    it("should have defaultTimeoutMs = 10000", () => {
      expect(adapter.defaultTimeoutMs).toBe(10000);
    });
  });

  describe("doSearch (via search())", () => {
    it("should return empty array when tool is not registered", async () => {
      const registry = { tryGet: jest.fn().mockReturnValue(null) };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "London weather", maxResults: 5 });
      expect(result.items).toEqual([]);
    });

    it("should return empty array when tool returns success=false", async () => {
      const registry = buildMockToolRegistry("weather-api", {
        success: false,
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "Paris", maxResults: 3 });
      expect(result.items).toEqual([]);
    });

    it("should extract items from results key", async () => {
      const registry = buildMockToolRegistry("weather-api", {
        success: true,
        data: {
          results: [
            {
              location: "London",
              url: "https://open-meteo.com/london",
              description: "Partly cloudy",
              time: "2026-01-01T12:00:00Z",
            },
          ],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "London", maxResults: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe("London");
      expect(result.items[0].url).toBe("https://open-meteo.com/london");
      expect(result.items[0].snippet).toBe("Partly cloudy");
      expect(result.items[0].sourceType).toBe(DataSourceType.WEATHER_API);
      expect(result.items[0].domain).toBe("open-meteo.com");
      expect(result.items[0].publishedAt).toBeInstanceOf(Date);
    });

    it("should extract items from data key as fallback", async () => {
      const registry = buildMockToolRegistry("weather-api", {
        success: true,
        data: {
          data: [{ name: "Tokyo", description: "Sunny" }],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "Tokyo", maxResults: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe("Tokyo");
    });

    it("should extract items from forecasts key as fallback", async () => {
      const registry = buildMockToolRegistry("weather-api", {
        success: true,
        data: {
          forecasts: [{ title: "New York Forecast", summary: "Rain expected" }],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "NY", maxResults: 1 });

      expect(result.items[0].title).toBe("New York Forecast");
      expect(result.items[0].snippet).toBe("Rain expected");
    });

    it("should default title to Weather Data when no location/name/title", async () => {
      const registry = buildMockToolRegistry("weather-api", {
        success: true,
        data: {
          results: [{ description: "Unknown weather" }],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "unknown", maxResults: 1 });

      expect(result.items[0].title).toBe("Weather Data");
    });

    it("should default url to open-meteo.com when no url in record", async () => {
      const registry = buildMockToolRegistry("weather-api", {
        success: true,
        data: {
          results: [{ location: "Berlin" }],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "Berlin", maxResults: 1 });

      expect(result.items[0].url).toBe("https://open-meteo.com");
    });

    it("should use date key for publishedAt when time is absent", async () => {
      const registry = buildMockToolRegistry("weather-api", {
        success: true,
        data: {
          results: [
            {
              location: "Paris",
              date: "2026-03-01T00:00:00Z",
            },
          ],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "Paris", maxResults: 1 });

      expect(result.items[0].publishedAt).toBeInstanceOf(Date);
    });

    it("should set publishedAt to undefined when neither time nor date is present", async () => {
      const registry = buildMockToolRegistry("weather-api", {
        success: true,
        data: {
          results: [{ location: "Sydney" }],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "Sydney", maxResults: 1 });

      expect(result.items[0].publishedAt).toBeUndefined();
    });

    it("should store the full record in metadata", async () => {
      const record = {
        location: "Dubai",
        temperature: 35,
        humidity: 60,
      };
      const registry = buildMockToolRegistry("weather-api", {
        success: true,
        data: {
          results: [record],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "Dubai", maxResults: 1 });

      expect(result.items[0].metadata).toEqual(record);
    });

    it("should return empty when items list is not an array", async () => {
      const registry = buildMockToolRegistry("weather-api", {
        success: true,
        data: {
          results: "not-an-array",
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "test", maxResults: 1 });

      expect(result.items).toEqual([]);
    });

    it("should use snippet from content key when description and summary absent", async () => {
      const registry = buildMockToolRegistry("weather-api", {
        success: true,
        data: {
          results: [{ location: "Mumbai", content: "Hot and humid" }],
        },
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WeatherSearchAdapter,
          { provide: ToolRegistry, useValue: registry },
        ],
      }).compile();

      const a = module.get<WeatherSearchAdapter>(WeatherSearchAdapter);
      const result = await a.search({ query: "Mumbai", maxResults: 1 });

      expect(result.items[0].snippet).toBe("Hot and humid");
    });
  });
});
