/**
 * Semantic Scholar Connector
 *
 * P0: 实时数据源接入
 * 接入 Semantic Scholar API 获取高质量学术论文
 * API: https://api.semanticscholar.org/graph/v1
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/facade";
import {
  ToolKeyResolverService,
  NoToolKeyError,
} from "@/modules/ai-engine/facade";
import { RequestContext } from "@/common/context/request-context";
import {
  IDataSourceConnector,
  ConnectorSearchOptions,
  ConnectorHealthStatus,
  SemanticScholarPaper,
} from "../../../types/data-source-connector.types";
import {
  DataSourceType,
  DataSourceResult,
} from "../../../types/data-source.types";

@Injectable()
export class SemanticScholarConnector implements IDataSourceConnector {
  private readonly logger = new Logger(SemanticScholarConnector.name);
  readonly sourceType = DataSourceType.SEMANTIC_SCHOLAR;
  readonly displayName = "Semantic Scholar";
  readonly requiresApiKey = false; // 免费 API，有速率限制

  private readonly baseUrl = "https://api.semanticscholar.org/graph/v1";
  private cachedApiKey?: string;
  private apiKeyLoadedAt = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly secretsService: SecretsService,
    private readonly toolKeyResolver: ToolKeyResolverService,
  ) {}

  /**
   * 获取 API Key。
   *
   * 2026-05-28 BYOK: 有用户上下文时走 ToolKeyResolver（用户 Key → 授权 →
   * strict/fallback）；无 userId（系统任务）走原有 admin 路径：
   *   ToolConfig.secretKey → SecretsService → env SEMANTIC_SCHOLAR_API_KEY。
   * 有 userId 时不走 5 min 缓存（每次用户请求都走解析器，由解析器内部缓存控制）。
   */
  private async getApiKey(): Promise<string | undefined> {
    const userId = RequestContext.getUserId();
    if (userId) {
      try {
        const resolved = await this.toolKeyResolver.resolveToolKey(
          "semantic-scholar",
          userId,
        );
        return resolved?.value ?? undefined;
      } catch (error) {
        if (error instanceof NoToolKeyError) return undefined;
        throw error;
      }
    }

    // No userId — admin/system path with 5-min cache
    const now = Date.now();
    if (this.cachedApiKey && now - this.apiKeyLoadedAt < 5 * 60 * 1000) {
      return this.cachedApiKey;
    }

    try {
      // 1. 从 ToolConfig.secretKey → SecretsService.getValue() 解密读取
      const toolConfig = await this.prisma.toolConfig.findUnique({
        where: { toolId: "semantic-scholar" },
        select: { secretKey: true },
      });

      if (toolConfig?.secretKey) {
        const decryptedValue = await this.secretsService.getValue(
          toolConfig.secretKey,
        );
        if (decryptedValue) {
          this.cachedApiKey = decryptedValue;
          this.apiKeyLoadedAt = now;
          return this.cachedApiKey;
        }
      }
    } catch {
      // DB/解密失败，回退到环境变量
    }

    // 2. 回退到环境变量
    this.cachedApiKey = this.configService.get<string>(
      "SEMANTIC_SCHOLAR_API_KEY",
    );
    this.apiKeyLoadedAt = now;
    return this.cachedApiKey;
  }

  async search(
    query: string,
    maxResults: number,
    options?: ConnectorSearchOptions,
  ): Promise<DataSourceResult[]> {
    this.logger.log(`[search] query="${query}", maxResults=${maxResults}`);

    try {
      const fields =
        "paperId,title,abstract,url,year,citationCount,authors,venue,fieldsOfStudy,isOpenAccess,publicationDate";
      const params = new URLSearchParams({
        query,
        limit: String(Math.min(maxResults, 100)),
        fields,
      });

      if (options?.sortBy === "citations") {
        params.set("sort", "citationCount:desc");
      }

      const apiKey = await this.getApiKey();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["x-api-key"] = apiKey;
      }

      const response = await fetch(
        `${this.baseUrl}/paper/search?${params.toString()}`,
        { headers, signal: AbortSignal.timeout(15000) },
      );

      if (!response.ok) {
        this.logger.warn(
          `[search] API returned ${response.status}: ${response.statusText}`,
        );
        return [];
      }

      const data = (await response.json()) as {
        data?: SemanticScholarPaper[];
        total?: number;
      };

      if (!data.data || data.data.length === 0) {
        return [];
      }

      return data.data.map((paper) => this.toDataSourceResult(paper));
    } catch (error) {
      this.logger.error(`[search] Failed: ${error}`);
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const apiKey = await this.getApiKey();
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["x-api-key"] = apiKey;
      }
      const response = await fetch(
        `${this.baseUrl}/paper/search?query=test&limit=1&fields=paperId`,
        { headers, signal: AbortSignal.timeout(5000) },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<ConnectorHealthStatus> {
    const start = Date.now();
    try {
      const apiKey = await this.getApiKey();
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["x-api-key"] = apiKey;
      }
      const response = await fetch(
        `${this.baseUrl}/paper/search?query=health&limit=1&fields=paperId`,
        { headers, signal: AbortSignal.timeout(5000) },
      );

      return {
        available: response.ok,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        error: response.ok ? undefined : `HTTP ${response.status}`,
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

  private toDataSourceResult(paper: SemanticScholarPaper): DataSourceResult {
    const authors = paper.authors?.map((a) => a.name).join(", ") || "Unknown";
    const snippet =
      paper.abstract?.slice(0, 500) ||
      `${paper.title} by ${authors}. Citations: ${paper.citationCount || 0}`;

    return {
      sourceType: DataSourceType.SEMANTIC_SCHOLAR,
      title: paper.title,
      url:
        paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
      snippet,
      publishedAt: paper.publicationDate
        ? new Date(paper.publicationDate)
        : paper.year
          ? new Date(`${paper.year}-01-01`)
          : undefined,
      domain: "semanticscholar.org",
      metadata: {
        paperId: paper.paperId,
        citationCount: paper.citationCount,
        authors: paper.authors?.map((a) => a.name),
        venue: paper.venue,
        fieldsOfStudy: paper.fieldsOfStudy,
        isOpenAccess: paper.isOpenAccess,
        sourceConnector: "semantic-scholar",
      },
    };
  }
}
