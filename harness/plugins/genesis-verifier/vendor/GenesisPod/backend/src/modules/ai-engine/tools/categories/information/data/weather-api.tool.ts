/**
 * Weather API Tool
 * 天气数据工具 - 获取当前天气和天气预报
 *
 * API 文档: https://openweathermap.org/api
 * 需要 API Key（OpenWeatherMap）
 * 免费限速: 60 req/min, 1000 req/day
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { PolicyDataService } from "../policy/policy-data.service";

// ============================================================================
// Types
// ============================================================================

/**
 * 查询类型
 */
export type WeatherQueryType = "current" | "forecast";

/**
 * 温度单位
 */
export type WeatherUnits = "metric" | "imperial" | "standard";

/**
 * 输入参数
 */
export interface WeatherApiInput {
  /** 查询类型 */
  queryType: WeatherQueryType;
  /** 城市名称 (e.g. "Beijing", "London,UK") */
  city?: string;
  /** 纬度 */
  lat?: number;
  /** 经度 */
  lon?: number;
  /** 温度单位，默认 metric */
  units?: WeatherUnits;
  /** 语言，默认 zh_cn */
  lang?: string;
}

/**
 * 单条天气数据
 */
export interface WeatherData {
  /** ISO date string */
  date: string;
  temp: number;
  tempMin: number;
  tempMax: number;
  feelsLike: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windDeg: number;
  description: string;
  icon: string;
  /** 云量百分比 */
  clouds: number;
  visibility?: number;
}

/**
 * 输出结果
 */
export interface WeatherApiOutput {
  success: boolean;
  queryType: string;
  location: {
    name: string;
    country: string;
    lat: number;
    lon: number;
  };
  current?: WeatherData;
  forecast?: WeatherData[];
  error?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

interface OWMWeatherItem {
  description: string;
  icon: string;
}

interface OWMMain {
  temp: number;
  feels_like: number;
  temp_min: number;
  temp_max: number;
  pressure: number;
  humidity: number;
}

interface OWMWind {
  speed: number;
  deg: number;
}

interface OWMClouds {
  all: number;
}

interface OWMCurrentResponse {
  coord: { lon: number; lat: number };
  weather: OWMWeatherItem[];
  main: OWMMain;
  wind: OWMWind;
  clouds: OWMClouds;
  visibility?: number;
  name: string;
  sys: { country: string };
}

interface OWMForecastListItem {
  dt_txt: string;
  main: OWMMain;
  weather: OWMWeatherItem[];
  wind: OWMWind;
  clouds: OWMClouds;
  visibility?: number;
}

interface OWMForecastResponse {
  city: {
    name: string;
    country: string;
    coord: { lat: number; lon: number };
  };
  list: OWMForecastListItem[];
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class WeatherApiTool extends BaseTool<
  WeatherApiInput,
  WeatherApiOutput
> {
  private readonly logger = new Logger(WeatherApiTool.name);
  private static lastRequestTime = 0;
  private static readonly MIN_REQUEST_INTERVAL = 1500; // conservative ~0.7 req/s
  private static activeRequests = 0;
  private static readonly MAX_CONCURRENT = 2; // 60 req/min is generous
  private static readonly requestQueue: Array<() => void> = [];
  /** Global 429 cooldown — all requests wait until this timestamp */
  private static cooldownUntil = 0;

  readonly id = "weather-api";
  readonly sideEffect = "none" as const;
  readonly name = "Weather API";
  readonly description =
    "获取天气数据：当前天气、天气预报、温度、湿度、风速等。数据来源：OpenWeatherMap API（需 API Key）。适合天气相关研究和数据获取。";
  readonly category: ToolCategory = "information";
  readonly tags = ["weather", "climate", "forecast", "temperature"];
  readonly defaultTimeout = 15000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      queryType: {
        type: "string",
        enum: ["current", "forecast"],
        description:
          "查询类型：current=当前天气，forecast=5天预报（3小时间隔）",
      },
      city: {
        type: "string",
        description:
          '城市名称，例如 "Beijing"、"London,UK"、"New York,US"。与 lat/lon 二选一',
      },
      lat: {
        type: "number",
        description: "纬度，范围 -90 到 90。需与 lon 一起使用",
      },
      lon: {
        type: "number",
        description: "经度，范围 -180 到 180。需与 lat 一起使用",
      },
      units: {
        type: "string",
        enum: ["metric", "imperial", "standard"],
        description:
          "温度单位：metric=摄氏度，imperial=华氏度，standard=开尔文，默认 metric",
        default: "metric",
      },
      lang: {
        type: "string",
        description: "天气描述语言，默认 zh_cn（简体中文），支持 en、ja、fr 等",
        default: "zh_cn",
      },
    },
    required: ["queryType"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      queryType: { type: "string" },
      location: {
        type: "object",
        properties: {
          name: { type: "string" },
          country: { type: "string" },
          lat: { type: "number" },
          lon: { type: "number" },
        },
      },
      current: {
        type: "object",
        properties: {
          date: { type: "string" },
          temp: { type: "number" },
          tempMin: { type: "number" },
          tempMax: { type: "number" },
          feelsLike: { type: "number" },
          humidity: { type: "number" },
          pressure: { type: "number" },
          windSpeed: { type: "number" },
          windDeg: { type: "number" },
          description: { type: "string" },
          icon: { type: "string" },
          clouds: { type: "number" },
          visibility: { type: "number" },
        },
      },
      forecast: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" },
            temp: { type: "number" },
            tempMin: { type: "number" },
            tempMax: { type: "number" },
            feelsLike: { type: "number" },
            humidity: { type: "number" },
            pressure: { type: "number" },
            windSpeed: { type: "number" },
            windDeg: { type: "number" },
            description: { type: "string" },
            icon: { type: "string" },
            clouds: { type: "number" },
            visibility: { type: "number" },
          },
        },
      },
      error: { type: "string" },
    },
  };

  constructor(private readonly policyDataService: PolicyDataService) {
    super();
  }

  protected async doExecute(
    input: WeatherApiInput,
    _context: ToolContext,
  ): Promise<WeatherApiOutput> {
    const {
      queryType,
      city,
      lat,
      lon,
      units = "metric",
      lang = "zh_cn",
    } = input;

    this.logger.log(
      `[doExecute] Weather query: type=${queryType}, city=${city}, lat=${lat}, lon=${lon}`,
    );

    // 获取 API Key
    const apiKey = await this.policyDataService.getApiKey("weather-api");
    if (!apiKey) {
      return {
        success: false,
        queryType,
        location: { name: "", country: "", lat: 0, lon: 0 },
        error:
          "Weather API requires an API key. Configure it in Admin → Secrets.",
      };
    }

    try {
      let result: WeatherApiOutput;
      if (queryType === "current") {
        result = await this.fetchCurrentWeather(
          apiKey,
          city,
          lat,
          lon,
          units,
          lang,
        );
      } else {
        result = await this.fetchForecast(apiKey, city, lat, lon, units, lang);
      }

      // Mark key as healthy on success
      this.policyDataService.clearKeyFailure("weather-api", apiKey);

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[doExecute] Weather API error: ${error}`);

      // Track key failure for multi-key rotation
      const statusMatch = errorMessage.match(/\b(4\d{2}|5\d{2})\b/);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 500;
      this.policyDataService.markKeyFailed("weather-api", apiKey, statusCode);

      return {
        success: false,
        queryType,
        location: { name: "", country: "", lat: 0, lon: 0 },
        error: `天气数据获取失败: ${errorMessage}`,
      };
    }
  }

  /**
   * 获取当前天气
   */
  private async fetchCurrentWeather(
    apiKey: string,
    city?: string,
    lat?: number,
    lon?: number,
    units: WeatherUnits = "metric",
    lang = "zh_cn",
  ): Promise<WeatherApiOutput> {
    const baseUrl = "https://api.openweathermap.org/data/2.5/weather";
    const params = this.buildLocationParams(
      apiKey,
      city,
      lat,
      lon,
      units,
      lang,
    );

    await this.acquireSlot();
    let data: OWMCurrentResponse;
    try {
      data = await this.policyDataService.httpGet<OWMCurrentResponse>(
        baseUrl,
        params,
      );
    } finally {
      this.releaseSlot();
    }

    const weather = data.weather[0];
    const current: WeatherData = {
      date: new Date().toISOString(),
      temp: data.main.temp,
      tempMin: data.main.temp_min,
      tempMax: data.main.temp_max,
      feelsLike: data.main.feels_like,
      humidity: data.main.humidity,
      pressure: data.main.pressure,
      windSpeed: data.wind.speed,
      windDeg: data.wind.deg,
      description: weather?.description ?? "",
      icon: weather?.icon ?? "",
      clouds: data.clouds.all,
      visibility: data.visibility,
    };

    this.logger.log(
      `[fetchCurrentWeather] Success: ${data.name}, ${data.sys.country}, temp=${data.main.temp}`,
    );

    return {
      success: true,
      queryType: "current",
      location: {
        name: data.name,
        country: data.sys.country,
        lat: data.coord.lat,
        lon: data.coord.lon,
      },
      current,
    };
  }

  /**
   * 获取天气预报（5天 / 3小时间隔，最多40条）
   */
  private async fetchForecast(
    apiKey: string,
    city?: string,
    lat?: number,
    lon?: number,
    units: WeatherUnits = "metric",
    lang = "zh_cn",
  ): Promise<WeatherApiOutput> {
    const baseUrl = "https://api.openweathermap.org/data/2.5/forecast";
    const params = this.buildLocationParams(
      apiKey,
      city,
      lat,
      lon,
      units,
      lang,
    );

    await this.acquireSlot();
    let data: OWMForecastResponse;
    try {
      data = await this.policyDataService.httpGet<OWMForecastResponse>(
        baseUrl,
        params,
      );
    } finally {
      this.releaseSlot();
    }

    const forecast: WeatherData[] = data.list.map((item) => {
      const weather = item.weather[0];
      return {
        date: new Date(item.dt_txt).toISOString(),
        temp: item.main.temp,
        tempMin: item.main.temp_min,
        tempMax: item.main.temp_max,
        feelsLike: item.main.feels_like,
        humidity: item.main.humidity,
        pressure: item.main.pressure,
        windSpeed: item.wind.speed,
        windDeg: item.wind.deg,
        description: weather?.description ?? "",
        icon: weather?.icon ?? "",
        clouds: item.clouds.all,
        visibility: item.visibility,
      };
    });

    this.logger.log(
      `[fetchForecast] Success: ${data.city.name}, ${data.city.country}, ${forecast.length} intervals`,
    );

    return {
      success: true,
      queryType: "forecast",
      location: {
        name: data.city.name,
        country: data.city.country,
        lat: data.city.coord.lat,
        lon: data.city.coord.lon,
      },
      forecast,
    };
  }

  /**
   * 构建位置参数（城市名 或 经纬度）
   */
  private buildLocationParams(
    apiKey: string,
    city?: string,
    lat?: number,
    lon?: number,
    units: WeatherUnits = "metric",
    lang = "zh_cn",
  ): Record<string, string | number> {
    const params: Record<string, string | number> = {
      appid: apiKey,
      units,
      lang,
    };

    if (city) {
      params.q = city;
    } else if (lat !== undefined && lon !== undefined) {
      params.lat = lat;
      params.lon = lon;
    }

    return params;
  }

  /**
   * 获取并发槽位，等待全局冷却 + 最小请求间隔
   */
  private async acquireSlot(): Promise<void> {
    // 等待并发槽位
    while (WeatherApiTool.activeRequests >= WeatherApiTool.MAX_CONCURRENT) {
      await new Promise<void>((resolve) => {
        WeatherApiTool.requestQueue.push(resolve);
      });
    }
    WeatherApiTool.activeRequests++;

    // 等待全局 429 冷却结束
    const cooldownRemaining = WeatherApiTool.cooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
      this.logger.debug(
        `[acquireSlot] Waiting ${cooldownRemaining}ms for global 429 cooldown`,
      );
      await new Promise((resolve) => setTimeout(resolve, cooldownRemaining));
    }

    // 强制最小请求间隔
    const now = Date.now();
    const timeSinceLastRequest = now - WeatherApiTool.lastRequestTime;
    if (timeSinceLastRequest < WeatherApiTool.MIN_REQUEST_INTERVAL) {
      const waitTime =
        WeatherApiTool.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      this.logger.debug(`[acquireSlot] Waiting ${waitTime}ms for rate limit`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    WeatherApiTool.lastRequestTime = Date.now();
  }

  /**
   * 释放并发槽位，唤醒队列中下一个等待者
   */
  private releaseSlot(): void {
    WeatherApiTool.activeRequests--;
    const next = WeatherApiTool.requestQueue.shift();
    if (next) next();
  }

  validateInput(input: WeatherApiInput): boolean {
    // 必须提供城市名 或 同时提供经纬度
    const hasCity = !!input.city && input.city.trim().length > 0;
    const hasLatLon = input.lat !== undefined && input.lon !== undefined;
    return hasCity || hasLatLon;
  }
}
