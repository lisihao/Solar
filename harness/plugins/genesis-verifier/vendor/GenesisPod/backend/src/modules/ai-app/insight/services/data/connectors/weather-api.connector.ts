/**
 * Weather API Connector
 *
 * P0: 实时数据源接入
 * 接入 Open-Meteo API（免费天气数据）
 * 支持天气相关研究的实时数据获取
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  IDataSourceConnector,
  ConnectorSearchOptions,
  ConnectorHealthStatus,
} from "../../../types/data-source-connector.types";
import {
  DataSourceType,
  DataSourceResult,
} from "../../../types/data-source.types";

@Injectable()
export class WeatherApiConnector implements IDataSourceConnector {
  private readonly logger = new Logger(WeatherApiConnector.name);
  readonly sourceType = DataSourceType.WEATHER_API;
  readonly displayName = "Weather Data API";
  readonly requiresApiKey = false;

  private readonly geocodingUrl =
    "https://geocoding-api.open-meteo.com/v1/search";
  private readonly weatherUrl = "https://api.open-meteo.com/v1/forecast";

  async search(
    query: string,
    maxResults: number,
    _options?: ConnectorSearchOptions,
  ): Promise<DataSourceResult[]> {
    this.logger.log(`[search] query="${query}", maxResults=${maxResults}`);

    try {
      // Step 1: 地理编码查找地点
      const locations = await this.geocode(query, Math.min(maxResults, 5));
      if (locations.length === 0) return [];

      // Step 2: 获取每个地点的天气数据
      const results: DataSourceResult[] = [];
      for (const location of locations) {
        const weather = await this.getWeather(location);
        if (weather) {
          results.push(weather);
        }
      }

      return results.slice(0, maxResults);
    } catch (error) {
      this.logger.error(`[search] Failed: ${error}`);
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.geocodingUrl}?name=London&count=1`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<ConnectorHealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.geocodingUrl}?name=test&count=1`, {
        signal: AbortSignal.timeout(5000),
      });

      return {
        available: response.ok,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        available: false,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        error: String(error),
      };
    }
  }

  private async geocode(query: string, count: number): Promise<GeoLocation[]> {
    const params = new URLSearchParams({
      name: query,
      count: String(count),
      language: "en",
    });

    const response = await fetch(`${this.geocodingUrl}?${params.toString()}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      results?: GeoLocation[];
    };
    return data.results || [];
  }

  private async getWeather(
    location: GeoLocation,
  ): Promise<DataSourceResult | null> {
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current:
        "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
      daily: "temperature_2m_max,temperature_2m_min,weather_code",
      forecast_days: "7",
      timezone: "auto",
    });

    try {
      const response = await fetch(`${this.weatherUrl}?${params.toString()}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as OpenMeteoResponse;

      const current = data.current;
      const snippet = current
        ? `Temperature: ${current.temperature_2m}°C, Humidity: ${current.relative_humidity_2m}%, Wind: ${current.wind_speed_10m} km/h`
        : `Weather data for ${location.name}`;

      return {
        sourceType: DataSourceType.WEATHER_API,
        title: `Weather: ${location.name}, ${location.country || ""}`.trim(),
        url: `https://open-meteo.com/en/docs#latitude=${location.latitude}&longitude=${location.longitude}`,
        snippet,
        domain: "open-meteo.com",
        metadata: {
          latitude: location.latitude,
          longitude: location.longitude,
          country: location.country,
          currentTemperature: current?.temperature_2m,
          currentHumidity: current?.relative_humidity_2m,
          currentWindSpeed: current?.wind_speed_10m,
          forecastDays: data.daily?.temperature_2m_max?.length || 0,
          sourceConnector: "weather-api",
        },
      };
    } catch {
      return null;
    }
  }
}

interface GeoLocation {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
  };
  daily?: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
  };
}
