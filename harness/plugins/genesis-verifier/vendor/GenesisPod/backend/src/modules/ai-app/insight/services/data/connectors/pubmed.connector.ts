/**
 * PubMed Connector
 *
 * P0: 实时数据源接入
 * 接入 NCBI PubMed E-Utilities API 获取生物医学文献
 * API: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
export class PubMedConnector implements IDataSourceConnector {
  private readonly logger = new Logger(PubMedConnector.name);
  readonly sourceType = DataSourceType.PUBMED;
  readonly displayName = "PubMed";
  readonly requiresApiKey = false;

  private readonly baseUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  private readonly apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>("NCBI_API_KEY");
  }

  async search(
    query: string,
    maxResults: number,
    options?: ConnectorSearchOptions,
  ): Promise<DataSourceResult[]> {
    this.logger.log(`[search] query="${query}", maxResults=${maxResults}`);

    try {
      // Step 1: ESearch - 获取 PMID 列表
      const pmids = await this.searchPmids(query, maxResults, options);
      if (pmids.length === 0) return [];

      // Step 2: ESummary - 获取文章摘要
      return await this.fetchSummaries(pmids);
    } catch (error) {
      this.logger.error(`[search] Failed: ${error}`);
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/einfo.fcgi?db=pubmed&retmode=json`,
        { signal: AbortSignal.timeout(5000) },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<ConnectorHealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(
        `${this.baseUrl}/einfo.fcgi?db=pubmed&retmode=json`,
        { signal: AbortSignal.timeout(5000) },
      );

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

  private async searchPmids(
    query: string,
    maxResults: number,
    options?: ConnectorSearchOptions,
  ): Promise<string[]> {
    const params = new URLSearchParams({
      db: "pubmed",
      term: query,
      retmax: String(Math.min(maxResults, 50)),
      retmode: "json",
      sort: options?.sortBy === "date" ? "pub_date" : "relevance",
    });

    if (this.apiKey) {
      params.set("api_key", this.apiKey);
    }

    if (options?.since) {
      const minDate = options.since
        .toISOString()
        .split("T")[0]
        .replace(/-/g, "/");
      params.set("mindate", minDate);
      params.set("datetype", "pdat");
    }

    const response = await fetch(
      `${this.baseUrl}/esearch.fcgi?${params.toString()}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!response.ok) {
      this.logger.warn(`[searchPmids] API returned ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      esearchresult?: { idlist?: string[] };
    };
    return data.esearchresult?.idlist || [];
  }

  private async fetchSummaries(pmids: string[]): Promise<DataSourceResult[]> {
    const params = new URLSearchParams({
      db: "pubmed",
      id: pmids.join(","),
      retmode: "json",
    });

    if (this.apiKey) {
      params.set("api_key", this.apiKey);
    }

    const response = await fetch(
      `${this.baseUrl}/esummary.fcgi?${params.toString()}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      result?: Record<string, PubMedSummary>;
    };

    if (!data.result) return [];

    const results: DataSourceResult[] = [];
    for (const pmid of pmids) {
      const article = data.result[pmid];
      if (!article?.title) continue;

      results.push({
        sourceType: DataSourceType.PUBMED,
        title: article.title,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        snippet: this.buildSnippet(article),
        publishedAt: article.pubdate
          ? this.parsePubDate(article.pubdate)
          : undefined,
        domain: "pubmed.ncbi.nlm.nih.gov",
        metadata: {
          pmid,
          authors: article.authors?.map((a: { name: string }) => a.name),
          journal: article.fulljournalname || article.source,
          doi: article.elocationid,
          sourceConnector: "pubmed",
        },
      });
    }

    return results;
  }

  private buildSnippet(article: PubMedSummary): string {
    const authors =
      article.authors?.map((a: { name: string }) => a.name).join(", ") || "";
    const journal = article.fulljournalname || article.source || "";
    return `${authors}. ${article.title} ${journal} (${article.pubdate || ""})`.trim();
  }

  private parsePubDate(dateStr: string): Date | undefined {
    try {
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? undefined : date;
    } catch {
      return undefined;
    }
  }
}

interface PubMedSummary {
  title: string;
  pubdate?: string;
  source?: string;
  fulljournalname?: string;
  elocationid?: string;
  authors?: Array<{ name: string }>;
}
