import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { DeduplicationService } from "./deduplication.service";
import { getErrorStack } from "../../../../../common/utils/error.utils";
import axios from "axios";
import * as xml2js from "xml2js";

interface ArxivAuthor {
  name: string;
  "arxiv:affiliation"?: {
    $?: {
      "xmlns:arxiv"?: string;
    };
  };
}

interface ArxivCategory {
  $: {
    term: string;
    scheme: string;
  };
}

interface ArxivLink {
  $: {
    href: string;
    rel: string;
    type: string;
    title?: string;
  };
}

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  author: ArxivAuthor | ArxivAuthor[];
  published: string;
  updated: string;
  category?: ArxivCategory | ArxivCategory[];
  link?: ArxivLink | ArxivLink[];
  "arxiv:primary_category"?: {
    $?: {
      term?: string;
    };
  };
  "arxiv:doi"?: {
    $?: {
      doi?: string;
    };
  };
  "arxiv:comment"?: {
    $?: {
      "xmlns:arxiv"?: string;
    };
  };
  "arxiv:journal_ref"?: {
    $?: {
      "xmlns:arxiv"?: string;
    };
  };
}

interface ParsedAuthor {
  name: string;
  affiliation: string | null;
}

interface ParsedCategory {
  term: string;
  scheme: string;
}

interface ParsedLink {
  href: string;
  rel: string;
  type: string;
  title?: string;
}

interface ArxivRawData {
  externalId: string;
  id: string;
  title: string;
  summary: string;
  authors: ParsedAuthor[];
  published: string;
  updated: string;
  categories: ParsedCategory[];
  primaryCategory: string | null;
  links: ParsedLink[];
  pdfUrl: string | null;
  abstractUrl: string;
  doi: string | null;
  comment: string | null;
  journalRef: string | null;
  _raw: ArxivEntry;
  fetchedAt: string;
}

/**
 * arXiv 论文采集器
 *
 * 关键功能：
 * 1. 存储完整信息到 MongoDB raw_data 集合
 * 2. 建立 raw_data ↔ resource 的引用关系
 * 3. 实现去重逻辑（基于 arXiv ID）
 * 4. 解析所有字段（标题、作者、摘要、分类、PDF链接等）
 */
@Injectable()
export class ArxivService {
  private readonly logger = new Logger(ArxivService.name);
  private readonly ARXIV_API_URL = "http://export.arxiv.org/api/query";

  constructor(
    private prisma: PrismaService,
    private rawData: RawDataService,
    private dedup: DeduplicationService,
  ) {}

  /**
   * 采集最新的 arXiv 论文
   * @param maxResults 最大结果数
   * @param category 分类（可选）如 'cs.AI', 'cs.LG' 等
   */
  async fetchLatestPapers(maxResults = 10, category?: string): Promise<number> {
    this.logger.log(
      `Fetching latest arXiv papers (max: ${maxResults}, category: ${category || "all"})`,
    );

    try {
      // 构建查询参数
      let searchQuery = "all";
      if (category) {
        searchQuery = `cat:${category}`;
      }

      const params = {
        search_query: searchQuery,
        start: 0,
        max_results: maxResults,
        sortBy: "submittedDate",
        sortOrder: "descending",
      };

      // 调用 arXiv API
      const response = await axios.get(this.ARXIV_API_URL, {
        params,
        timeout: 30000, // 30秒超时
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/atom+xml, application/xml, text/xml, */*",
        },
      });
      const xmlData = response.data;

      // 解析 XML
      const parser = new xml2js.Parser({ explicitArray: false });
      const result = await parser.parseStringPromise(xmlData);

      if (!result.feed?.entry) {
        this.logger.warn("No entries found in arXiv response");
        return 0;
      }

      // 处理单个或多个 entry
      const entries = Array.isArray(result.feed.entry)
        ? result.feed.entry
        : [result.feed.entry];

      this.logger.log(`Parsed ${entries.length} papers from arXiv`);

      // 处理每个论文
      let successCount = 0;
      for (const entry of entries) {
        try {
          await this.processPaper(entry);
          successCount++;
        } catch (error) {
          this.logger.error(
            `Failed to process paper: ${entry.title}`,
            getErrorStack(error),
          );
        }
      }

      this.logger.log(
        `Successfully processed ${successCount}/${entries.length} papers`,
      );
      return successCount;
    } catch (error) {
      this.logger.error("Failed to fetch arXiv papers", getErrorStack(error));
      throw error;
    }
  }

  /**
   * 处理单个论文
   */
  private async processPaper(entry: ArxivEntry): Promise<void> {
    // 提取 arXiv ID（用于去重）
    const arxivId = this.extractArxivId(entry.id);

    if (!arxivId) {
      this.logger.warn(`Failed to extract arXiv ID from: ${entry.id}`);
      return;
    }

    // 层级1去重：检查同源是否已存在（arXiv 内部去重）
    const existingRawData = await this.rawData.findRawDataByExternalId(
      "arxiv",
      arxivId,
    );

    if (existingRawData) {
      this.logger.debug(`Paper already exists in arXiv source: ${arxivId}`);
      return;
    }

    // 层级2去重：跨源检查 - 使用 externalId（防止同一论文从不同源采集）
    const crossSourceDuplicate =
      await this.rawData.findRawDataByExternalIdAcrossAllSources(arxivId);

    if (crossSourceDuplicate) {
      const source = (crossSourceDuplicate as { source?: string }).source;
      this.logger.debug(
        `Paper already exists from another source: ${arxivId} (source: ${source})`,
      );
      return;
    }

    // 层级3去重：URL 去重（防止同一链接从不同源采集）
    const title = this.dedup.cleanText(entry.title);
    const abstractUrl = entry.id?.replace("http://", "https://");

    if (abstractUrl) {
      const normalizedUrl = this.dedup.normalizeUrl(abstractUrl);
      const urlDuplicate =
        await this.rawData.findRawDataByUrlAcrossAllSources(normalizedUrl);

      if (urlDuplicate) {
        const source = (urlDuplicate as { source?: string }).source;
        this.logger.debug(
          `Paper already exists with same URL: ${normalizedUrl} (source: ${source})`,
        );
        return;
      }
    }

    // 层级4去重：标题相似度检查（防止同一内容以不同标题从不同源采集）
    const similarTitles =
      await this.rawData.findRawDataByTitleAcrossAllSources(title);

    for (const similar of similarTitles) {
      const similarData = similar as {
        data?: { title?: unknown };
        source?: string;
      };
      const similarTitle =
        typeof similarData.data?.title === "string"
          ? similarData.data.title
          : "";
      if (this.dedup.areTitlesSimilar(title, similarTitle, 0.9)) {
        this.logger.debug(
          `Paper already exists with similar title: "${similarTitle}" (source: ${similarData.source}, similarity threshold: 0.9)`,
        );
        return;
      }
    }

    // 解析完整的原始数据
    const rawData = this.parseRawData(entry, arxivId);

    // 1. 存储完整原始数据到 MongoDB
    const rawDataId = await this.rawData.insertRawData(
      "arxiv",
      rawData as unknown as Record<string, unknown>,
    );

    this.logger.log(`Stored raw data in MongoDB: ${arxivId} -> ${rawDataId}`);

    // 2. 提取结构化数据并存储到 PostgreSQL
    const resourceData = this.extractResourceData(rawData, rawDataId);

    const resource = await this.prisma.resource.create({
      data: resourceData as Prisma.ResourceCreateInput,
    });

    this.logger.log(
      `Created resource in PostgreSQL: ${resource.id} with rawDataId: ${rawDataId}`,
    );

    // 3. ⚠️ 关键：建立双向引用
    // 3.1 MongoDB → PostgreSQL (resourceId)
    await this.rawData.linkResourceToRawData(rawDataId, resource.id);

    // 3.2 验证引用同步成功
    const linkedRawData = await this.rawData.findRawDataById(rawDataId);
    const linkedResourceId = (linkedRawData as { resourceId?: string })
      ?.resourceId;
    if (linkedResourceId !== resource.id) {
      this.logger.error(
        `Reference sync failed for paper ${arxivId}: MongoDB resourceId=${linkedResourceId}, expected ${resource.id}`,
      );
      throw new Error(
        `Failed to establish bi-directional reference for resource ${resource.id}`,
      );
    }

    this.logger.log(
      `✅ Reference sync completed: MongoDB(${rawDataId}) ↔ PostgreSQL(${resource.id})`,
    );
  }

  /**
   * 提取 arXiv ID
   */
  private extractArxivId(url: string): string | null {
    // arXiv ID 格式: http://arxiv.org/abs/2311.12345v1
    const match = url.match(/arxiv\.org\/abs\/(\d+\.\d+(?:v\d+)?)/);
    return match ? match[1] : null;
  }

  /**
   * 解析完整的原始数据（存储到 MongoDB）
   *
   * ⚠️ 关键：存储所有字段，不仅仅是基本信息！
   */
  private parseRawData(entry: ArxivEntry, arxivId: string): ArxivRawData {
    // 解析作者
    const authors = this.parseAuthors(entry.author);

    // 解析分类
    const categories = this.parseCategories(entry.category);

    // 解析链接
    const links = this.parseLinks(entry.link);

    // 完整的原始数据对象
    return {
      // 外部 ID（用于去重）
      externalId: arxivId,

      // 基础信息
      id: entry.id,
      title: this.dedup.cleanText(entry.title),
      summary: this.dedup.cleanText(entry.summary),

      // 作者信息（完整）
      authors: authors,

      // 时间信息
      published: entry.published,
      updated: entry.updated,

      // 分类信息（完整）
      categories: categories,
      primaryCategory:
        entry["arxiv:primary_category"]?.$?.term || categories[0]?.term || null,

      // 链接信息（完整）
      links: links,
      pdfUrl: this.extractPdfUrl(links, entry.id),
      abstractUrl: entry.id?.replace("http://", "https://"),

      // DOI（如果有）
      doi: entry["arxiv:doi"]?.$?.["doi"] || null,

      // 评论（如果有）
      comment: entry["arxiv:comment"]?.$?.["xmlns:arxiv"] || null,

      // 期刊引用（如果有）
      journalRef: entry["arxiv:journal_ref"]?.$?.["xmlns:arxiv"] || null,

      // 原始 entry（完整保存，以防未来需要）
      _raw: entry,

      // 采集时间
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * 解析作者列表（完整信息）
   */
  private parseAuthors(
    authorData: ArxivAuthor | ArxivAuthor[] | undefined,
  ): ParsedAuthor[] {
    if (!authorData) return [];

    const authors = Array.isArray(authorData) ? authorData : [authorData];

    return authors.map((author) => ({
      name: author.name,
      affiliation: author["arxiv:affiliation"]?.$?.["xmlns:arxiv"] || null,
    }));
  }

  /**
   * 解析分类列表
   */
  private parseCategories(
    categoryData: ArxivCategory | ArxivCategory[] | undefined,
  ): ParsedCategory[] {
    if (!categoryData) return [];

    const categories = Array.isArray(categoryData)
      ? categoryData
      : [categoryData];

    return categories.map((cat) => ({
      term: cat.$.term,
      scheme: cat.$.scheme,
    }));
  }

  /**
   * 解析链接列表
   */
  private parseLinks(
    linkData: ArxivLink | ArxivLink[] | undefined,
  ): ParsedLink[] {
    if (!linkData) return [];

    const links = Array.isArray(linkData) ? linkData : [linkData];

    return links.map((link) => ({
      href: link.$.href,
      rel: link.$.rel,
      type: link.$.type,
      title: link.$.title,
    }));
  }

  /**
   * 提取 PDF URL（多策略）
   * 1. 优先查找 type === "application/pdf" 的链接
   * 2. 其次查找 title === "pdf" 的链接
   * 3. 最后从 abstract URL 构造 PDF URL
   */
  private extractPdfUrl(
    links: ParsedLink[],
    abstractUrl: string,
  ): string | null {
    // 策略 1: 查找 type 为 application/pdf 的链接
    let pdfLink = links.find((l) => l.type === "application/pdf");
    if (pdfLink?.href) {
      return pdfLink.href.replace("http://", "https://");
    }

    // 策略 2: 查找 title 为 pdf 的链接
    pdfLink = links.find((l) => l.title === "pdf");
    if (pdfLink?.href) {
      return pdfLink.href.replace("http://", "https://");
    }

    // 策略 3: 从 abstract URL 构造 PDF URL
    // 例如: https://arxiv.org/abs/2311.12345v1 -> https://arxiv.org/pdf/2311.12345v1.pdf
    if (abstractUrl) {
      const arxivIdMatch = abstractUrl.match(/arxiv\.org\/abs\/(.+)/);
      if (arxivIdMatch) {
        return `https://arxiv.org/pdf/${arxivIdMatch[1]}.pdf`;
      }
    }

    return null;
  }

  /**
   * 从原始数据提取结构化数据（存储到 PostgreSQL）
   *
   * ⚠️ 关键：建立 rawDataId 引用关系！
   */
  private extractResourceData(
    rawData: ArxivRawData,
    rawDataId: string,
  ): Record<string, unknown> {
    return {
      type: "PAPER",

      // 基础信息
      title: rawData.title,
      abstract: rawData.summary,
      sourceUrl: rawData.abstractUrl,
      pdfUrl: rawData.pdfUrl,

      // 作者信息（JSON 格式）
      authors: rawData.authors as unknown as Prisma.InputJsonValue,

      // 发布时间
      publishedAt: new Date(rawData.published),

      // 分类
      primaryCategory: rawData.primaryCategory,
      categories: rawData.categories.map((c) => c.term),
      tags: rawData.categories.map((c) => c.term),

      // 元数据
      metadata: {
        arxivId: rawData.externalId,
        doi: rawData.doi,
        comment: rawData.comment,
        journalRef: rawData.journalRef,
        updated: rawData.updated,
      } as Prisma.InputJsonValue,

      // ⚠️ 关键！MongoDB 原始数据引用
      rawDataId: rawDataId,

      // 初始评分
      qualityScore: 0,
      trendingScore: 0,
    };
  }

  /**
   * 搜索特定主题的论文
   */
  async searchPapers(query: string, maxResults = 10): Promise<number> {
    this.logger.log(`Searching arXiv papers: "${query}"`);

    try {
      const params = {
        search_query: `all:${query}`,
        start: 0,
        max_results: maxResults,
        sortBy: "relevance",
        sortOrder: "descending",
      };

      const response = await axios.get(this.ARXIV_API_URL, {
        params,
        timeout: 30000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/atom+xml, application/xml, text/xml, */*",
        },
      });
      const xmlData = response.data;

      const parser = new xml2js.Parser({ explicitArray: false });
      const result = await parser.parseStringPromise(xmlData);

      if (!result.feed?.entry) {
        this.logger.warn("No entries found");
        return 0;
      }

      const entries = Array.isArray(result.feed.entry)
        ? result.feed.entry
        : [result.feed.entry];

      let successCount = 0;
      for (const entry of entries) {
        try {
          await this.processPaper(entry);
          successCount++;
        } catch (error) {
          this.logger.error(`Failed to process paper`, getErrorStack(error));
        }
      }

      return successCount;
    } catch (error) {
      this.logger.error("Search failed", getErrorStack(error));
      throw error;
    }
  }
}
