/**
 * WeatherApiTool Unit Tests
 *
 * Tests the weather-api tool in isolation by mocking PolicyDataService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  WeatherApiTool,
  WeatherApiInput,
  WeatherApiOutput,
} from "../weather-api.tool";
import { PolicyDataService } from "../../policy/policy-data.service";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-weather-001",
    toolId: "weather-api",
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock responses
// ---------------------------------------------------------------------------

const MOCK_CURRENT_RESPONSE = {
  coord: { lon: -0.1257, lat: 51.5085 },
  weather: [{ description: "cloudy", icon: "04d" }],
  main: {
    temp: 15.2,
    feels_like: 14.8,
    temp_min: 13.0,
    temp_max: 17.0,
    pressure: 1013,
    humidity: 72,
  },
  wind: { speed: 5.2, deg: 230 },
  clouds: { all: 75 },
  visibility: 10000,
  name: "London",
  sys: { country: "GB" },
};

const MOCK_FORECAST_RESPONSE = {
  city: {
    name: "London",
    country: "GB",
    coord: { lat: 51.5085, lon: -0.1257 },
  },
  list: [
    {
      dt_txt: "2024-01-15 12:00:00",
      main: {
        temp: 15.2,
        feels_like: 14.8,
        temp_min: 13.0,
        temp_max: 17.0,
        pressure: 1013,
        humidity: 72,
      },
      weather: [{ description: "cloudy", icon: "04d" }],
      wind: { speed: 5.2, deg: 230 },
      clouds: { all: 75 },
      visibility: 10000,
    },
    {
      dt_txt: "2024-01-15 15:00:00",
      main: {
        temp: 14.0,
        feels_like: 13.5,
        temp_min: 12.0,
        temp_max: 15.0,
        pressure: 1012,
        humidity: 78,
      },
      weather: [{ description: "rain", icon: "10d" }],
      wind: { speed: 6.1, deg: 240 },
      clouds: { all: 90 },
      visibility: 8000,
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock PolicyDataService
// ---------------------------------------------------------------------------

type PolicyDataServiceMock = Pick<
  PolicyDataService,
  "httpGet" | "getApiKey" | "clearKeyFailure" | "markKeyFailed"
>;

function createMockPolicyDataService(): jest.Mocked<PolicyDataServiceMock> {
  return {
    httpGet: jest.fn(),
    getApiKey: jest.fn().mockResolvedValue(null),
    clearKeyFailure: jest.fn(),
    markKeyFailed: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("WeatherApiTool", () => {
  let tool: WeatherApiTool;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    // Reset static rate limiter state so tests don't interfere with each other
    (WeatherApiTool as any).lastRequestTime = 0;
    (WeatherApiTool as any).activeRequests = 0;
    (WeatherApiTool as any).cooldownUntil = 0;
    (WeatherApiTool as any).requestQueue.length = 0;

    mockPolicyDataService = createMockPolicyDataService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeatherApiTool,
        { provide: PolicyDataService, useValue: mockPolicyDataService },
      ],
    }).compile();

    tool = module.get<WeatherApiTool>(WeatherApiTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'weather-api'", () => {
      expect(tool.id).toBe("weather-api");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });

    it("should have weather-related tags", () => {
      expect(tool.tags).toContain("weather");
      expect(tool.tags).toContain("forecast");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true when city is provided", () => {
      const input: WeatherApiInput = { queryType: "current", city: "London" };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return true when lat and lon are provided", () => {
      const input: WeatherApiInput = {
        queryType: "current",
        lat: 51.5085,
        lon: -0.1257,
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return false when no location is provided", () => {
      const input: WeatherApiInput = { queryType: "current" };
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when city is an empty string", () => {
      const input: WeatherApiInput = { queryType: "current", city: "   " };
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when only lat is provided without lon", () => {
      const input: WeatherApiInput = { queryType: "current", lat: 51.5085 };
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when only lon is provided without lat", () => {
      const input: WeatherApiInput = { queryType: "current", lon: -0.1257 };
      expect(tool.validateInput(input)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // No API key
  // -------------------------------------------------------------------------

  describe("execute() - no API key", () => {
    it("should return error when no API key is configured", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);

      const input: WeatherApiInput = { queryType: "current", city: "London" };
      const result: ToolResult<WeatherApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Weather API requires an API key");
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Current weather
  // -------------------------------------------------------------------------

  describe("execute() - current weather", () => {
    beforeEach(() => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test-api-key");
      mockPolicyDataService.httpGet.mockResolvedValue(MOCK_CURRENT_RESPONSE);
    });

    it("should fetch current weather by city name", async () => {
      const input: WeatherApiInput = {
        queryType: "current",
        city: "London",
        units: "metric",
        lang: "en",
      };
      const result: ToolResult<WeatherApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.queryType).toBe("current");
      expect(result.data?.location?.name).toBe("London");
      expect(result.data?.location?.country).toBe("GB");
      expect(result.data?.location?.lat).toBe(51.5085);
      expect(result.data?.location?.lon).toBe(-0.1257);
      expect(result.data?.current).toBeDefined();
      expect(result.data?.forecast).toBeUndefined();
    });

    it("should map current weather fields correctly", async () => {
      const input: WeatherApiInput = { queryType: "current", city: "London" };
      const result = await tool.execute(input, makeContext());

      const current = result.data?.current;
      expect(current).toBeDefined();
      expect(current?.temp).toBe(15.2);
      expect(current?.feelsLike).toBe(14.8);
      expect(current?.tempMin).toBe(13.0);
      expect(current?.tempMax).toBe(17.0);
      expect(current?.pressure).toBe(1013);
      expect(current?.humidity).toBe(72);
      expect(current?.windSpeed).toBe(5.2);
      expect(current?.windDeg).toBe(230);
      expect(current?.description).toBe("cloudy");
      expect(current?.icon).toBe("04d");
      expect(current?.clouds).toBe(75);
      expect(current?.visibility).toBe(10000);
    });

    it("should call httpGet with the correct current weather URL", async () => {
      const input: WeatherApiInput = { queryType: "current", city: "London" };
      await tool.execute(input, makeContext());

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.openweathermap.org/data/2.5/weather",
        expect.objectContaining({ q: "London", appid: "test-api-key" }),
      );
    });

    it("should fetch current weather by coordinates", async () => {
      const input: WeatherApiInput = {
        queryType: "current",
        lat: 51.5085,
        lon: -0.1257,
      };
      const result: ToolResult<WeatherApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.current).toBeDefined();

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.openweathermap.org/data/2.5/weather",
        expect.objectContaining({ lat: 51.5085, lon: -0.1257 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Forecast
  // -------------------------------------------------------------------------

  describe("execute() - forecast", () => {
    beforeEach(() => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test-api-key");
      mockPolicyDataService.httpGet.mockResolvedValue(MOCK_FORECAST_RESPONSE);
    });

    it("should fetch 5-day forecast by city", async () => {
      const input: WeatherApiInput = {
        queryType: "forecast",
        city: "London",
        units: "metric",
      };
      const result: ToolResult<WeatherApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.queryType).toBe("forecast");
      expect(result.data?.location?.name).toBe("London");
      expect(result.data?.location?.country).toBe("GB");
      expect(result.data?.forecast).toHaveLength(2);
      expect(result.data?.current).toBeUndefined();
    });

    it("should map forecast items correctly", async () => {
      const input: WeatherApiInput = { queryType: "forecast", city: "London" };
      const result = await tool.execute(input, makeContext());

      const forecast = result.data?.forecast;
      expect(forecast).toBeDefined();

      const first = forecast![0];
      expect(first.temp).toBe(15.2);
      expect(first.description).toBe("cloudy");
      expect(first.icon).toBe("04d");
      expect(first.windSpeed).toBe(5.2);
      expect(first.clouds).toBe(75);
      expect(first.visibility).toBe(10000);

      const second = forecast![1];
      expect(second.temp).toBe(14.0);
      expect(second.description).toBe("rain");
      expect(second.icon).toBe("10d");
    });

    it("should call httpGet with the correct forecast URL", async () => {
      const input: WeatherApiInput = { queryType: "forecast", city: "London" };
      await tool.execute(input, makeContext());

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.openweathermap.org/data/2.5/forecast",
        expect.objectContaining({ q: "London", appid: "test-api-key" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("execute() - error handling", () => {
    it("should handle API error gracefully", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test-api-key");
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Network timeout"),
      );

      const input: WeatherApiInput = { queryType: "current", city: "London" };
      const result: ToolResult<WeatherApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Network timeout");
    });

    it("should include the original error message in the error field", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test-api-key");
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Connection refused"),
      );

      const input: WeatherApiInput = { queryType: "forecast", city: "Tokyo" };
      const result = await tool.execute(input, makeContext());

      expect(result.data?.error).toContain("Connection refused");
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("execute() - cancellation", () => {
    it("should return success:false immediately when signal is already aborted", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test-api-key");

      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        { queryType: "current", city: "London" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Result metadata
  // -------------------------------------------------------------------------

  describe("execute() - result metadata", () => {
    it("should include executionId and duration in result metadata", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test-api-key");
      mockPolicyDataService.httpGet.mockResolvedValue(MOCK_CURRENT_RESPONSE);

      const result = await tool.execute(
        { queryType: "current", city: "London" },
        makeContext(),
      );

      expect(result.metadata?.executionId).toBe("exec-weather-001");
      expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
