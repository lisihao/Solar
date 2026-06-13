import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import axios, { AxiosRequestHeaders } from "axios";

interface ExternalProvider {
  id: string;
  name: string;
  description?: string;
  category?: string;
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  headers?: string;
  isDefault?: boolean;
}

@Injectable()
export class ExternalDataService {
  private readonly logger = new Logger(ExternalDataService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async loadProviders(): Promise<ExternalProvider[]> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: "external.providers" },
    });
    if (!setting) return [];
    try {
      const parsed = setting.value ? JSON.parse(setting.value) : null;
      if (!Array.isArray(parsed)) return [];

      // CRITICAL: Filter out invalid providers
      // Only return providers with valid configuration
      const validProviders = parsed.filter((p: ExternalProvider) => {
        const hasId = p.id?.trim();
        const hasName = p.name?.trim();
        const hasBaseUrl = p.baseUrl?.trim();
        const hasApiKey = p.apiKey?.trim();

        const isValid = hasId && hasName && (hasBaseUrl || hasApiKey);

        if (!isValid) {
          this.logger.warn(
            `[ExternalData] Skipping invalid provider: ${p.id || "unknown"} (name=${p.name}, category=${p.category})`,
          );
        }

        return isValid;
      });

      this.logger.log(
        `[ExternalData] Loaded ${validProviders.length} valid providers (filtered from ${parsed.length} total)`,
      );

      return validProviders as ExternalProvider[];
    } catch {
      return [];
    }
  }

  /**
   * Fetch data from configured external provider.
   * If baseUrl is missing or disabled, return null with reason.
   */
  async getSnapshot(
    categories: string[] = ["market", "finance", "news", "regulation"],
  ) {
    const results = await Promise.all(
      categories.map(async (category) => {
        const res = await this.fetchFromProvider(category);
        return { category, res };
      }),
    );
    const snapshot: Record<string, unknown> = {};
    const evidence: Array<{
      category: string;
      provider: string;
      endpoint?: string;
      ok: boolean;
      error?: string;
      timestamp: string;
    }> = [];

    results.forEach(({ category, res }) => {
      // 始终使用category名作为key，确保前端能正确识别
      snapshot[category] = res.ok ? res.data : { error: res.error };
      evidence.push({
        category,
        provider: res.providerId,
        endpoint: res.endpoint,
        ok: res.ok,
        error: res.error,
        timestamp: new Date().toISOString(),
      });
    });

    return { snapshot, evidence };
  }

  async fetchFromProvider(
    categoryOrProviderId: string,
    path?: string,
    query?: Record<string, string>,
  ): Promise<{
    ok: boolean;
    providerId: string;
    data?: unknown;
    error?: string;
    endpoint?: string;
  }> {
    const providers = await this.loadProviders();

    // Try to find provider by exact ID first
    let provider = providers.find((p) => p.id === categoryOrProviderId);

    // If not found by ID, treat as category and find enabled provider
    if (!provider) {
      // Find all providers for this category
      const categoryProviders = providers.filter(
        (p) => p.category === categoryOrProviderId,
      );

      if (categoryProviders.length === 0) {
        return {
          ok: false,
          providerId: categoryOrProviderId,
          error: "provider_not_configured",
        };
      }

      // Prioritize: 1) default + enabled, 2) any enabled, 3) first one
      provider =
        categoryProviders.find((p) => p.isDefault && p.enabled) ||
        categoryProviders.find((p) => p.enabled) ||
        categoryProviders[0];

      this.logger.log(
        `[ExternalData] Category ${categoryOrProviderId} using provider: ${provider.id} (enabled=${provider.enabled}, isDefault=${provider.isDefault})`,
      );
    }

    if (!provider) {
      return {
        ok: false,
        providerId: categoryOrProviderId,
        error: "provider_not_configured",
      };
    }
    if (!provider.enabled) {
      return {
        ok: false,
        providerId: provider.id,
        error: "provider_disabled",
      };
    }
    if (!provider.baseUrl) {
      return {
        ok: false,
        providerId: provider.id,
        error: "missing_base_url",
      };
    }

    // 构建endpoint：检测URL是否需要拼接API Key
    let endpoint = provider.baseUrl.replace(/\/+$/, "");

    // 检测URL中是否有API Key占位符（如 apiKey=, key=, token= 等结尾）
    const apiKeyPatterns =
      /[?&](apiKey|apikey|api_key|key|token|access_token)=$/i;
    const needsUrlApiKey = apiKeyPatterns.test(endpoint);

    if (needsUrlApiKey && provider.apiKey) {
      // API Key需要拼接到URL参数中
      endpoint = endpoint + provider.apiKey;
      this.logger.log(`[ExternalData] Using URL-param auth for ${provider.id}`);
    }

    if (path) {
      endpoint = endpoint + `/${path.replace(/^\/+/, "")}`;
    }

    const headers: Record<string, string> = {};
    // 只有当URL中没有API Key占位符时，才使用Bearer认证
    if (provider.apiKey && !needsUrlApiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }
    if (provider.headers) {
      try {
        const parsed = JSON.parse(provider.headers);
        Object.assign(headers, parsed);
      } catch (err) {
        this.logger.warn(
          `Invalid headers JSON for provider ${provider.id}: ${err}`,
        );
      }
    }

    try {
      const res = await axios.get(endpoint, {
        params: query,
        headers: headers as AxiosRequestHeaders,
        timeout: 15000,
      });
      return {
        ok: true,
        providerId: provider.id,
        data: res.data,
        endpoint,
      };
    } catch (error: unknown) {
      this.logger.error(
        `External fetch failed [${provider.id}] ${endpoint}: ${(error as Error).message}`,
      );
      const axiosError = error as {
        response?: { status: number };
        message?: string;
      };
      return {
        ok: false,
        providerId: provider.id,
        error: axiosError.response?.status
          ? `HTTP_${axiosError.response.status}`
          : axiosError.message || "fetch_failed",
        endpoint,
      };
    }
  }

  /**
   * Test a provider configuration
   * @param provider - Provider configuration to test
   */
  async testProvider(provider: {
    id: string;
    name: string;
    baseUrl?: string;
    apiKey?: string;
    headers?: string;
    enabled?: boolean;
  }): Promise<{
    ok: boolean;
    providerId: string;
    data?: unknown;
    error?: string;
    endpoint?: string;
  }> {
    const apiKey = provider.apiKey;
    const baseUrl = provider.baseUrl;
    const headers = provider.headers;

    if (!baseUrl) {
      return {
        ok: false,
        providerId: provider.id,
        error: "missing_base_url",
      };
    }

    // 构建endpoint：检测URL是否需要拼接API Key
    let endpoint = baseUrl.replace(/\/+$/, "");

    // 检测URL中是否有API Key占位符（如 apiKey=, key=, token= 等结尾）
    const apiKeyPatterns =
      /[?&](apiKey|apikey|api_key|key|token|access_token)=$/i;
    const needsUrlApiKey = apiKeyPatterns.test(endpoint);

    if (needsUrlApiKey && apiKey) {
      // API Key需要拼接到URL参数中
      endpoint = endpoint + apiKey;
      this.logger.log(
        `[ExternalData] Test using URL-param auth for ${provider.id}`,
      );
    }

    const reqHeaders: Record<string, string> = {};

    // 只有当URL中没有API Key占位符时，才使用Bearer认证
    if (apiKey && !needsUrlApiKey) {
      reqHeaders.Authorization = `Bearer ${apiKey}`;
    }

    if (headers) {
      try {
        const parsed = JSON.parse(headers);
        Object.assign(reqHeaders, parsed);
      } catch (err) {
        this.logger.warn(
          `Invalid headers JSON for provider ${provider.id}: ${err}`,
        );
      }
    }

    try {
      const res = await axios.get(endpoint, {
        headers: reqHeaders as AxiosRequestHeaders,
        timeout: 15000,
      });
      return {
        ok: true,
        providerId: provider.id,
        data: res.data,
        endpoint: endpoint.replace(apiKey || "", "***"),
      };
    } catch (error: unknown) {
      this.logger.error(
        `Test provider failed [${provider.id}] ${endpoint.replace(apiKey || "", "***")}: ${(error as Error).message}`,
      );
      const axiosError = error as {
        response?: { status: number };
        message?: string;
      };
      return {
        ok: false,
        providerId: provider.id,
        error: axiosError.response?.status
          ? `HTTP_${axiosError.response.status}`
          : axiosError.message || "fetch_failed",
        endpoint: endpoint.replace(apiKey || "", "***"),
      };
    }
  }
}
