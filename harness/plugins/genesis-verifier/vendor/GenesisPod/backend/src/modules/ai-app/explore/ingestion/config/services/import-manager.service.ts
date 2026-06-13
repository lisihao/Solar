import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { ResourceType, ImportTaskStatus, Prisma } from "@prisma/client";
import { getErrorMessage } from "../../../../../../common/utils/error.utils";
import {
  MetadataExtractorService,
  ParsedUrlMetadata,
} from "./metadata-extractor.service";
import { DuplicateDetectorService } from "./duplicate-detector.service";
import { PaperMetadataExtractorService } from "./paper-metadata-extractor.service";

export interface ParseUrlResult {
  domain: string;
  title?: string;
  description?: string;
  authors?: string[];
  publishedDate?: string;
  imageUrl?: string;
  pdfUrl?: string;
  language?: string;
  contentType?: string;
}

interface CreateImportTaskDto {
  resourceType: ResourceType;
  sourceUrl: string;
  title?: string;
  ruleId?: string;
}

/**
 * Import Manager Service
 * 负责处理URL解析、导入任务创建和管理
 */
@Injectable()
export class ImportManagerService {
  private readonly logger = new Logger(ImportManagerService.name);

  constructor(
    private prisma: PrismaService,
    private rawData: RawDataService,
    private metadataExtractor: MetadataExtractorService,
    private duplicateDetector: DuplicateDetectorService,
    private paperMetadataExtractor: PaperMetadataExtractorService,
  ) {}

  /**
   * 解析URL并提取完整元数据
   * 尝试提取标题、描述、作者、发布日期等信息
   * 优先处理论文网站（alphaxiv.org、arxiv.org）
   */
  async parseUrl(url: string): Promise<ParseUrlResult> {
    try {
      // 1. 验证URL格式并提取域名
      const urlObj = new URL(url);
      const domain = urlObj.hostname || "";

      // 2. 首先尝试作为论文网站处理（alphaxiv.org、arxiv.org）
      let paperMetadata = null;
      try {
        paperMetadata =
          await this.paperMetadataExtractor.extractPaperMetadata(url);
      } catch (error) {
        this.logger.debug(
          `Not a paper URL or extraction failed: ${getErrorMessage(error)}`,
        );
      }

      // 如果是论文网站，直接返回论文元数据
      if (paperMetadata) {
        return {
          domain,
          title: paperMetadata.title,
          description: paperMetadata.abstract,
          authors: paperMetadata.authors,
          publishedDate: paperMetadata.publishedDate,
          pdfUrl: paperMetadata.pdfUrl,
          contentType: "paper",
        };
      }

      // 3. 否则尝试提取通用网页元数据
      let metadata: ParsedUrlMetadata | null = null;
      try {
        metadata = await this.metadataExtractor.extractMetadata(url);
      } catch (error) {
        this.logger.warn(
          `Failed to extract full metadata for URL ${url}: ${getErrorMessage(error)}`,
        );
        // 不抛出错误，继续返回至少有域名的结果
      }

      // 4. 构建响应，包含提取到的所有可用元数据
      const result: ParseUrlResult = {
        domain,
      };

      if (metadata) {
        result.title = metadata.title;
        result.description = metadata.description;
        result.authors = metadata.authors;
        result.publishedDate = metadata.publishedDate
          ? new Date(metadata.publishedDate).toISOString()
          : undefined;
        result.imageUrl = metadata.imageUrl;
        result.language = metadata.language;
        result.contentType = metadata.contentType;
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to parse URL: ${getErrorMessage(error)}`);
      throw new Error(`Invalid URL format: ${getErrorMessage(error)}`);
    }
  }

  /**
   * 创建导入任务
   */
  async createImportTask(dto: CreateImportTaskDto) {
    try {
      // 提取域名
      const urlObj = new URL(dto.sourceUrl);
      const sourceDomain = urlObj.hostname;

      const task = await this.prisma.importTask.create({
        data: {
          resourceType: dto.resourceType,
          sourceUrl: dto.sourceUrl,
          sourceDomain,
          status: "PENDING" as ImportTaskStatus,
          ruleId: dto.ruleId,
          metadata: {
            title: dto.title,
            createdBy: "manual_import",
            timestamp: new Date().toISOString(),
          },
        },
      });

      this.logger.log(
        `Created import task: ${task.id} for ${dto.resourceType} from ${sourceDomain}`,
      );
      return task;
    } catch (error) {
      this.logger.error(
        `Failed to create import task: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取导入任务列表
   */
  async getImportTasks(
    resourceType?: ResourceType,
    status?: ImportTaskStatus,
    limit: number = 50,
    offset: number = 0,
  ) {
    try {
      const where: Prisma.ImportTaskWhereInput = {};

      if (resourceType) {
        where.resourceType = resourceType;
      }

      if (status) {
        where.status = status;
      }

      const [tasks, total] = await Promise.all([
        this.prisma.importTask.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        this.prisma.importTask.count({ where }),
      ]);

      return {
        data: tasks,
        total,
        limit,
        offset,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch import tasks: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取特定导入任务
   */
  async getImportTask(taskId: string) {
    try {
      const task = await this.prisma.importTask.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        this.logger.warn(`Import task not found: ${taskId}`);
        return null;
      }

      return task;
    } catch (error) {
      this.logger.error(
        `Failed to fetch import task: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 更新导入任务状态
   */
  async updateImportTaskStatus(
    taskId: string,
    status: ImportTaskStatus,
    updates?: {
      itemsProcessed?: number;
      itemsSaved?: number;
      itemsRejected?: number;
      duplicatesFound?: number;
      errorMessage?: string;
      executionTimeMs?: number;
    },
  ) {
    try {
      const now = new Date();
      const data: Prisma.ImportTaskUpdateInput = {
        status,
        updatedAt: now,
      };

      if (
        status === "SUCCESS" ||
        status === "FAILED" ||
        status === "CANCELLED"
      ) {
        data.completedAt = now;
      }

      if (status === "PROCESSING") {
        data.startedAt = now;
      }

      // 合并其他更新
      if (updates) {
        Object.assign(data, updates);
      }

      const task = await this.prisma.importTask.update({
        where: { id: taskId },
        data,
      });

      this.logger.log(`Updated import task ${taskId} status to ${status}`);
      return task;
    } catch (error) {
      this.logger.error(
        `Failed to update import task: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取数据质量指标
   */
  async getDataQualityMetrics(resourceType?: ResourceType) {
    try {
      const where: Prisma.DataQualityMetricWhereInput = {};

      if (resourceType) {
        where.resourceType = resourceType;
      }

      const [metrics, stats] = await Promise.all([
        this.prisma.dataQualityMetric.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        this.getQualityStats(resourceType),
      ]);

      return {
        data: metrics,
        stats,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch quality metrics: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取质量统计信息
   */
  private async getQualityStats(resourceType?: ResourceType) {
    try {
      const where: Prisma.DataQualityMetricWhereInput = {};

      if (resourceType) {
        where.resourceType = resourceType;
      }

      // Use aggregation for stats instead of loading all records
      const [totalItems, duplicates, avgQualityResult, needsReview] =
        await Promise.all([
          this.prisma.dataQualityMetric.count({ where }),
          this.prisma.dataQualityMetric.count({
            where: { ...where, isDuplicate: true },
          }),
          this.prisma.dataQualityMetric.aggregate({
            where,
            _avg: { qualityScore: true },
          }),
          this.prisma.dataQualityMetric.count({
            where: { ...where, reviewStatus: "NEEDS_REVIEW" },
          }),
        ]);

      if (totalItems === 0) {
        return {
          totalItems: 0,
          duplicates: 0,
          avgQuality: 0,
          needsReview: 0,
        };
      }

      const avgQuality = avgQualityResult._avg.qualityScore || 0;

      return {
        totalItems,
        duplicates,
        avgQuality: Math.round(avgQuality * 100) / 100,
        needsReview,
      };
    } catch (error) {
      this.logger.error(
        `Failed to calculate quality stats: ${getErrorMessage(error)}`,
      );
      return {
        totalItems: 0,
        duplicates: 0,
        avgQuality: 0,
        needsReview: 0,
      };
    }
  }

  /**
   * 创建或更新数据质量指标
   */
  async createOrUpdateQualityMetric(
    resourceType: ResourceType,
    resourceId: string,
    qualityData: {
      qualityScore?: number;
      completenessScore?: number;
      relevanceScore?: number;
      duplicateScore?: number;
      isDuplicate?: boolean;
      reviewStatus?: string;
      sourceUrl?: string;
      tags?: string[];
    },
  ) {
    try {
      const existing = await this.prisma.dataQualityMetric.findFirst({
        where: {
          resourceType,
          resourceId,
        },
      });

      if (existing) {
        return await this.prisma.dataQualityMetric.updateMany({
          where: {
            resourceType,
            resourceId,
          },
          data: {
            ...qualityData,
            updatedAt: new Date(),
          },
        });
      }

      return await this.prisma.dataQualityMetric.create({
        data: {
          resourceType,
          resourceId,
          ...qualityData,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create/update quality metric: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 解析URL并提取完整的元数据（包含重复检测）
   */
  async parseUrlFull(url: string, resourceType: ResourceType) {
    try {
      let metadata: ParsedUrlMetadata;

      // 首先尝试作为论文网站处理（alphaxiv.org、arxiv.org）
      if (resourceType === "PAPER") {
        try {
          const paperMetadata =
            await this.paperMetadataExtractor.extractPaperMetadata(url);
          if (paperMetadata) {
            // 将论文元数据转换为 ParsedUrlMetadata 格式
            const urlObj = new URL(url);
            metadata = {
              url,
              domain: urlObj.hostname || "",
              title: paperMetadata.title,
              description: paperMetadata.abstract,
              authors: paperMetadata.authors,
              publishedDate: paperMetadata.publishedDate
                ? new Date(paperMetadata.publishedDate)
                : undefined,
              language: "en",
              contentType: "paper",
              contentHash: "", // 将在下面填充
            };

            this.logger.debug(
              `Successfully extracted paper metadata from: ${url}`,
            );
          } else {
            // 如果论文提取失败，回退到通用提取器
            metadata = await this.metadataExtractor.extractMetadata(url);
          }
        } catch (error) {
          this.logger.debug(
            `Paper metadata extraction failed, falling back to generic extractor: ${getErrorMessage(error)}`,
          );
          // 回退到通用元数据提取器
          metadata = await this.metadataExtractor.extractMetadata(url);
        }
      } else {
        // 非论文类型，使用通用MetadataExtractor服务提取元数据
        metadata = await this.metadataExtractor.extractMetadata(url);
      }

      // 验证元数据的有效性
      const validation = this.metadataExtractor.validateMetadata(metadata);
      if (!validation.isValid) {
        throw new BadRequestException(
          `元数据验证失败: ${validation.errors?.join("; ")}`,
        );
      }

      // 使用DuplicateDetector服务检测重复
      const duplicateDetection = await this.duplicateDetector.detectDuplicates(
        resourceType,
        metadata,
      );

      this.logger.debug(
        `Successfully parsed URL and detected duplicates: ${url}`,
      );

      return { metadata, duplicateDetection };
    } catch (error) {
      this.logger.error(`Failed to parse URL full: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * 为论文URL生成PDF URL
   * 根据论文的来源网站自动生成相应的PDF下载链接或访问链接
   * 支持：arXiv、IEEE、ACM、Springer、Science Direct、Nature、PubMed、DOI等
   */
  private generatePdfUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname || "";
      const pathname = urlObj.pathname;
      const search = urlObj.search || "";

      // arXiv / AlphaXiv: 提取论文ID并生成PDF URL
      if (domain.includes("arxiv.org") || domain.includes("alphaxiv.org")) {
        const match = pathname.match(/\/(?:abs|pdf)\/(\d+\.\d+(?:v\d+)?)/);
        if (match) {
          return `https://arxiv.org/pdf/${match[1]}.pdf`;
        }
      }

      // IEEE Xplore: 论文通常在ieeexplore.ieee.org
      if (domain.includes("ieeexplore")) {
        // IEEE PDF通常可以通过 /stamp/stamp.jsp?tp=&arnumber=XXXXX 访问
        const docMatch = pathname.match(/\/document\/(\d+)/);
        if (docMatch) {
          return `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${docMatch[1]}`;
        }
      }

      // ACM Digital Library: /doi/10.1145/xxxx
      if (domain.includes("acm.org") || domain.includes("dl.acm.org")) {
        const doiMatch = (pathname + search).match(/(10\.1145\/[\w.]+)/);
        if (doiMatch) {
          // ACM通常提供PDF下载链接，使用DOI resolver
          return `https://doi.org/${doiMatch[1]}`;
        }
        // 对于ACM，URL本身通常包含PDF下载选项
        return url;
      }

      // Springer: /article/10.1007/xxxx 或其他DOI格式
      if (
        domain.includes("springer.com") ||
        domain.includes("link.springer.com")
      ) {
        const doiMatch = (pathname + search).match(/(10\.1007\/[\w.]+)/);
        if (doiMatch) {
          return `https://doi.org/${doiMatch[1]}`;
        }
        return url; // Springer通常在网页上提供PDF下载
      }

      // Science Direct: /science/article/pii/xxxx 或DOI格式
      if (domain.includes("sciencedirect.com")) {
        const doiMatch = (pathname + search).match(/(10\.1016\/[\w.]+)/);
        if (doiMatch) {
          return `https://doi.org/${doiMatch[1]}`;
        }
        const piiMatch = pathname.match(/pii\/(\w+)/);
        if (piiMatch) {
          return `https://sciencedirect.com/science/article/pii/${piiMatch[1]}`;
        }
        return url;
      }

      // Nature: /articles/xxxx 或DOI格式
      if (domain.includes("nature.com")) {
        const doiMatch = (pathname + search).match(/(10\.1038\/[\w.]+)/);
        if (doiMatch) {
          return `https://doi.org/${doiMatch[1]}`;
        }
        return url; // Nature通常提供PDF下载链接
      }

      // PubMed / NCBI: 医学文献数据库
      if (
        domain.includes("pubmed.ncbi.nlm.nih.gov") ||
        domain.includes("ncbi.nlm.nih.gov")
      ) {
        const pmidMatch = pathname.match(/\/(?:pmc\/)?articles\/(\w+)/);
        if (pmidMatch) {
          return url; // PubMed提供了PDF下载选项
        }
      }

      // JSTOR: 学术文献库
      if (domain.includes("jstor.org")) {
        return url; // JSTOR通常要求登录，使用原始URL
      }

      // Wiley Online Library
      if (
        domain.includes("wiley.com") ||
        domain.includes("onlinelibrary.wiley.com")
      ) {
        const doiMatch = (pathname + search).match(/(10\.1002\/[\w.]+)/);
        if (doiMatch) {
          return `https://doi.org/${doiMatch[1]}`;
        }
        return url;
      }

      // Elsevier
      if (domain.includes("elsevier.com")) {
        const doiMatch = (pathname + search).match(/(10\.\w+\/[\w.]+)/);
        if (doiMatch) {
          return `https://doi.org/${doiMatch[1]}`;
        }
        return url;
      }

      // OpenReview (学术会议论文)
      if (domain.includes("openreview.net")) {
        const forumMatch = search.match(/forum=([^&]+)/);
        if (forumMatch) {
          return `https://openreview.net/forum?id=${forumMatch[1]}`; // OpenReview通常提供PDF
        }
        return url;
      }

      // Papers with Code: 常有PDF链接
      if (domain.includes("paperswithcode.com")) {
        return url; // Papers with Code通常包含论文链接
      }

      // Research Gate
      if (domain.includes("researchgate.net")) {
        return url; // Research Gate包含PDF下载选项
      }

      // Generic DOI pattern: 适用于大多数学术数据库
      const doiMatch = (pathname + search).match(
        /(?:doi|DOI)[\s:\/]*([0-9.]+\/[\w.\/\-()]+)/,
      );
      if (doiMatch) {
        const doi = doiMatch[1];
        return `https://doi.org/${encodeURIComponent(doi)}`;
      }

      // 对于其他论文网站，返回原始URL
      // 用户可以在该页面下载PDF或访问论文
      return url;
    } catch (error) {
      this.logger.warn(
        `Failed to generate PDF URL for ${url}: ${getErrorMessage(error)}`,
      );
      return url; // 返回原始URL作为后备
    }
  }

  /**
   * 验证URL是否为真实的论文URL
   * 不限制特定网站，通过检查常见论文网站和URL模式来判断是否是真实论文链接
   * 支持的来源：arxiv.org, alphaxiv.org, ieee.org, acm.org, springer.com, sciencedirect.com, nature.com 等
   */
  private isPaperUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname || "";
      const pathname = urlObj.pathname;

      // 常见的论文网站域名列表
      const paperDomains = [
        "arxiv.org",
        "alphaxiv.org",
        "ieee.org",
        "acm.org",
        "springer.com",
        "sciencedirect.com",
        "nature.com",
        "scienceopen.com",
        "researchgate.net",
        "semanticscholar.org",
        "openreview.net",
        "paperswithcode.com",
        "arxiv-sanity.com",
        "scholar.google.com",
        "doaj.org",
        "ncbi.nlm.nih.gov",
        "pubmed.ncbi.nlm.nih.gov",
        "jstor.org",
        "wiley.com",
        "elsevier.com",
        "aaai.org",
        "icml.cc",
        "neurips.cc",
        "iccv",
        "cvpr",
        "eccv",
        "emnlp",
        "acl",
        "aclanthology.org",
        "proceedings.mlr.press",
      ];

      // 检查域名是否包含论文网站
      const isPaperDomain = paperDomains.some((paperDomain) =>
        domain.includes(paperDomain),
      );

      // 如果不在已知的论文网站列表中，检查URL模式
      if (!isPaperDomain) {
        // 检查URL是否包含常见论文标识模式
        const paperPatterns = [
          /\/abs\/\d+\.\d+/i, // arXiv模式：/abs/2511.10395
          /\/paper\/\d+/i, // 论文ID：/paper/123456
          /\/article\/\d+/i, // 文章ID：/article/123456
          /\/proceedings\/\d+/i, // 会议论文ID
          /\/10\.\d+\//i, // DOI模式：10.xxxxx/xxxxx
          /pdf\/[\w.]+\.pdf$/i, // PDF文件链接
        ];

        return paperPatterns.some((pattern) =>
          pattern.test(pathname + urlObj.search),
        );
      }

      return isPaperDomain;
    } catch (error) {
      return false;
    }
  }

  /**
   * 导入带有编辑后的元数据（用户可编辑）
   * 遵循正确的架构模式：
   * 1. 存储完整原始数据到 MongoDB
   * 2. 在 PostgreSQL 创建 Resource 记录，设置 rawDataId 引用
   * 3. 建立双向引用（MongoDB → PostgreSQL）
   * 4. 创建 ImportTask 记录用于审计
   * 5. 调用去重检测服务
   *
   * 对于Paper类型，必须验证是真实的论文URL
   */
  async importWithMetadata(
    url: string,
    resourceType: ResourceType,
    metadata: ParsedUrlMetadata,
    _skipDuplicateWarning?: boolean,
  ) {
    try {
      // 如果是PAPER类型，必须验证URL是真实的论文链接
      if (resourceType === "PAPER") {
        const isPaper = this.isPaperUrl(url);
        if (!isPaper) {
          throw new Error(
            "Invalid paper URL. Please provide a valid paper URL from known academic sources (arXiv, IEEE, ACM, Springer, Science Direct, etc.) or a URL with paper ID patterns.",
          );
        }
      }

      const title = metadata.title || url;
      const abstract = metadata.description || null;

      // 为论文和报告类型提取或生成PDF URL
      // 支持 PAPER、REPORT、POLICY 类型，或任何 URL 以 .pdf 结尾的资源
      let pdfUrl: string | null = null;
      if (metadata.pdfUrl) {
        // 如果元数据已有 pdfUrl，直接使用
        pdfUrl = metadata.pdfUrl;
      } else if (url.toLowerCase().endsWith(".pdf")) {
        // 如果 URL 本身就是 PDF，使用该 URL
        pdfUrl = url;
      } else if (resourceType === "PAPER") {
        // 仅对 PAPER 类型尝试生成 PDF URL（如 arXiv）
        pdfUrl = this.generatePdfUrl(url);
      }

      // 检查Resource是否已存在
      const existingResource = await this.prisma.resource.findFirst({
        where: { sourceUrl: url },
      });

      let resourceId: string;
      let rawDataId: string | null = null;

      if (existingResource) {
        // Resource 已存在 - 执行更新逻辑（如果重复，应该替换更新）
        this.logger.log(`Resource already exists for URL ${url}, updating...`);
        resourceId = existingResource.id;

        // 构建完整的原始数据
        const rawData = this.buildRawDataForManualImport(
          url,
          metadata,
          resourceType,
        );

        // 情形 1：Resource 没有 rawDataId（需要补充完整数据）
        if (!existingResource.rawDataId) {
          // 1. 存储完整原始数据到 MongoDB
          rawDataId = await this.rawData.insertRawData(
            "manual_import",
            rawData,
            resourceId,
          );
          this.logger.log(
            `Stored raw data in MongoDB: ${rawDataId} for existing resource ${resourceId}`,
          );

          // 2. 更新 Resource 记录，设置 rawDataId 和其他字段
          await this.prisma.resource.update({
            where: { id: resourceId },
            data: {
              type: resourceType, // ⚠️ 关键：更新资源类型
              title,
              abstract,
              pdfUrl: pdfUrl || existingResource.pdfUrl,
              rawDataId,
              publishedAt: metadata.publishedDate
                ? new Date(metadata.publishedDate)
                : existingResource.publishedAt,
            },
          });

          // 3. 建立双向引用（MongoDB → PostgreSQL）
          await this.rawData.linkResourceToRawData(rawDataId, resourceId);
          this.logger.log(
            `✅ Linked raw data ${rawDataId} to existing resource ${resourceId}`,
          );
        } else {
          // 情形 2：Resource 已有 rawDataId — 验证 raw_data 记录是否真的存在
          const rawDataExists = await this.prisma.rawData.findUnique({
            where: { id: existingResource.rawDataId },
            select: { id: true },
          });

          if (rawDataExists) {
            // 2a: raw_data 记录存在，更新它
            rawDataId = existingResource.rawDataId;
            await this.rawData.updateRawData(rawDataId, rawData, resourceId);
            this.logger.log(
              `Updated raw data: ${rawDataId} for existing resource ${resourceId}`,
            );
          } else {
            // 2b: rawDataId 是孤儿引用（如 MongoDB 迁移遗留），重新创建
            this.logger.warn(
              `Orphaned rawDataId ${existingResource.rawDataId} for resource ${resourceId}, re-creating`,
            );
            rawDataId = await this.rawData.insertRawData(
              "manual_import",
              rawData,
              resourceId,
            );
            await this.rawData.linkResourceToRawData(rawDataId, resourceId);
          }

          // 更新 PostgreSQL Resource 记录
          await this.prisma.resource.update({
            where: { id: resourceId },
            data: {
              type: resourceType,
              title,
              abstract,
              pdfUrl: pdfUrl || existingResource.pdfUrl,
              rawDataId,
              publishedAt: metadata.publishedDate
                ? new Date(metadata.publishedDate)
                : existingResource.publishedAt,
            },
          });

          this.logger.log(
            `✅ Updated existing resource ${resourceId} with new metadata (type: ${resourceType})`,
          );
        }
      } else {
        // 创建新的 Resource（按照正确的模式）

        // 1. 构建完整的原始数据
        const rawData = this.buildRawDataForManualImport(
          url,
          metadata,
          resourceType,
        );

        // 2. 存储完整原始数据到 MongoDB
        rawDataId = await this.rawData.insertRawData("manual_import", rawData);
        this.logger.log(`Stored raw data in MongoDB: ${rawDataId}`);

        // 3. 在 PostgreSQL 创建 Resource 记录，设置 rawDataId
        const resource = await this.prisma.resource.create({
          data: {
            type: resourceType,
            title,
            abstract,
            sourceUrl: url,
            pdfUrl,
            // ⚠️ 关键：设置 rawDataId 引用
            rawDataId,
            publishedAt: metadata.publishedDate
              ? new Date(metadata.publishedDate)
              : new Date(),
            // 默认值
            upvoteCount: 0,
            viewCount: 0,
            commentCount: 0,
            qualityScore: "0",
            trendingScore: 0,
          },
        });

        resourceId = resource.id;
        this.logger.log(
          `Created resource: ${resourceId} with rawDataId: ${rawDataId}`,
        );

        // 4. 建立双向引用（MongoDB → PostgreSQL）
        await this.rawData.linkResourceToRawData(rawDataId, resourceId);
        this.logger.log(
          `✅ Linked raw data ${rawDataId} ↔ PostgreSQL resource ${resourceId}`,
        );
      }

      // 5. 创建 ImportTask 记录用于审计
      const importTask = await this.createImportTask({
        resourceType,
        sourceUrl: url,
        title,
      });

      // 6. 更新 ImportTask 状态为成功
      await this.updateImportTaskStatus(importTask.id, "SUCCESS", {
        itemsProcessed: 1,
        itemsSaved: 1,
        executionTimeMs: 0,
      });

      // 7. 调用去重检测服务（用于数据质量指标）
      if (!_skipDuplicateWarning) {
        try {
          await this.duplicateDetector.detectDuplicates(resourceType, metadata);
        } catch (error) {
          this.logger.warn(
            `Duplicate detection failed: ${getErrorMessage(error)}`,
          );
          // 不阻塞导入，继续返回成功
        }
      }

      this.logger.log(
        `✅ Successfully imported resource: ${resourceId} (rawDataId: ${rawDataId})`,
      );

      return {
        id: resourceId,
        status: "SUCCESS" as const,
        resourceId,
        rawDataId,
        sourceUrl: url,
        itemsProcessed: 1,
        itemsSaved: 1,
        importTaskId: importTask.id,
      };
    } catch (error) {
      this.logger.error(
        `Failed to import with metadata: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 为手动导入构建完整的原始数据对象
   * 存储所有可用的元数据信息到 MongoDB
   */
  private buildRawDataForManualImport(
    url: string,
    metadata: ParsedUrlMetadata,
    resourceType: ResourceType,
  ): Record<string, unknown> {
    const rawData: Record<string, unknown> = {
      // 基础信息
      sourceUrl: url,
      title: metadata.title,
      description: metadata.description,
      language: metadata.language || "en",
      contentType: metadata.contentType || "html",

      // 作者信息
      authors: metadata.authors || [],

      // 发布信息
      publishedDate: metadata.publishedDate
        ? new Date(metadata.publishedDate).toISOString()
        : null,
      domain: metadata.domain,

      // 视觉资源
      imageUrl: metadata.imageUrl,
      pdfUrl: metadata.pdfUrl,
      favicon: metadata.favicon,
      siteName: metadata.siteName,
      canonicalUrl: metadata.canonicalUrl,

      // 内容指标
      wordCount: metadata.wordCount,
      contentHash: metadata.contentHash,

      // 论文特定字段（当 resourceType 为 PAPER 时）
      ...(resourceType === "PAPER" &&
        {
          // 这些字段由 PaperMetadataExtractorService 提供
          // 保存完整的论文元数据
        }),

      // 导入信息
      importMethod: "manual_import",
      importedAt: new Date().toISOString(),
      importedBy: "user",

      // 原始元数据（完整保存）
      _raw: metadata,
    };

    return rawData;
  }
}
