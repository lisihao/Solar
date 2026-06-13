import { Test, TestingModule } from "@nestjs/testing";
import { WeatherApiConnector } from "../weather-api.connector";
import { DataSourceType } from "../../../../types/data-source.types";

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("WeatherApiConnector", () => {
  let connector: WeatherApiConnector;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [WeatherApiConnector],
    }).compile();

    connector = module.get<WeatherApiConnector>(WeatherApiConnector);
  });

  describe("connector metadata", () => {
    it("should have correct sourceType", () => {
      expect(connector.sourceType).toBe(DataSourceType.WEATHER_API);
    });

    it("should have correct displayName", () => {
      expect(connector.displayName).toBe("Weather Data API");
    });

    it("should not require API key", () => {
      expect(connector.requiresApiKey).toBe(false);
    });
  });

  describe("search", () => {
    const mockGeocodingResponse = {
      results: [
        {
          name: "London",
          latitude: 51.5074,
          longitude: -0.1278,
          country: "GB",
        },
        {
          name: "London",
          latitude: 42.9984,
          longitude: -81.2453,
          country: "CA",
        },
      ],
    };

    const mockWeatherResponse = {
      current: {
        temperature_2m: 15.5,
        relative_humidity_2m: 72,
        wind_speed_10m: 18.3,
        weather_code: 3,
      },
      daily: {
        temperature_2m_max: [16, 18, 20, 17, 15, 14, 16],
        temperature_2m_min: [10, 12, 13, 11, 9, 8, 10],
        weather_code: [3, 1, 0, 2, 3, 4, 3],
      },
    };

    it("should return weather results for found locations", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockGeocodingResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockWeatherResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockWeatherResponse),
        });

      const results = await connector.search("London", 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].sourceType).toBe(DataSourceType.WEATHER_API);
      expect(results[0].title).toContain("Weather: London");
      expect(results[0].domain).toBe("open-meteo.com");
      expect(results[0].url).toContain("open-meteo.com");
      expect(results[0].metadata?.latitude).toBe(51.5074);
      expect(results[0].metadata?.longitude).toBe(-0.1278);
      expect(results[0].metadata?.country).toBe("GB");
      expect(results[0].metadata?.sourceConnector).toBe("weather-api");
    });

    it("should include current weather data in snippet", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            results: [
              {
                name: "Paris",
                latitude: 48.8566,
                longitude: 2.3522,
                country: "FR",
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockWeatherResponse),
        });

      const results = await connector.search("Paris", 1);

      expect(results[0].snippet).toContain("Temperature: 15.5");
      expect(results[0].snippet).toContain("Humidity: 72");
      expect(results[0].snippet).toContain("Wind: 18.3");
    });

    it("should include forecast days count in metadata", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            results: [
              {
                name: "Tokyo",
                latitude: 35.6762,
                longitude: 139.6503,
                country: "JP",
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockWeatherResponse),
        });

      const results = await connector.search("Tokyo", 1);

      expect(results[0].metadata?.forecastDays).toBe(7);
    });

    it("should return empty array when geocoding finds no locations", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ results: [] }),
      });

      const results = await connector.search("xyz-invalid-location-123", 5);

      expect(results).toEqual([]);
    });

    it("should return empty array when geocoding response has no results field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      const results = await connector.search("test", 5);

      expect(results).toEqual([]);
    });

    it("should return empty array when geocoding API fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const results = await connector.search("London", 5);

      expect(results).toEqual([]);
    });

    it("should handle weather fetch failure gracefully (skip that location)", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            results: [
              {
                name: "London",
                latitude: 51.5074,
                longitude: -0.1278,
                country: "GB",
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      const results = await connector.search("London", 5);

      expect(results).toEqual([]);
    });

    it("should handle network error gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const results = await connector.search("London", 5);

      expect(results).toEqual([]);
    });

    it("should limit results to maxResults", async () => {
      // Geocoding returns 2 locations, maxResults is 1
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockGeocodingResponse),
        })
        .mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue(mockWeatherResponse),
        });

      const results = await connector.search("London", 1);

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("should cap geocoding count at 5 even if maxResults is larger", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ results: [] }),
      });

      await connector.search("London", 20);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("count=5");
    });

    it("should use fallback snippet when current weather is missing", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            results: [
              {
                name: "Berlin",
                latitude: 52.52,
                longitude: 13.405,
                country: "DE",
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ daily: {} }),
        });

      const results = await connector.search("Berlin", 1);

      expect(results[0].snippet).toContain("Berlin");
    });

    it("should include current weather metadata in result", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            results: [
              {
                name: "Sydney",
                latitude: -33.8688,
                longitude: 151.2093,
                country: "AU",
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockWeatherResponse),
        });

      const results = await connector.search("Sydney", 1);

      expect(results[0].metadata?.currentTemperature).toBe(15.5);
      expect(results[0].metadata?.currentHumidity).toBe(72);
      expect(results[0].metadata?.currentWindSpeed).toBe(18.3);
    });
  });

  describe("isAvailable", () => {
    it("should return true when geocoding API is reachable", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const available = await connector.isAvailable();

      expect(available).toBe(true);
    });

    it("should return false when API returns error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const available = await connector.isAvailable();

      expect(available).toBe(false);
    });

    it("should return false when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Timeout"));

      const available = await connector.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("healthCheck", () => {
    it("should return available=true on success", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const health = await connector.healthCheck();

      expect(health.available).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.lastChecked).toBeInstanceOf(Date);
    });

    it("should return available=false on API error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const health = await connector.healthCheck();

      expect(health.available).toBe(false);
      expect(health.lastChecked).toBeInstanceOf(Date);
    });

    it("should return error string when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const health = await connector.healthCheck();

      expect(health.available).toBe(false);
      expect(health.error).toContain("Connection refused");
    });
  });
});
