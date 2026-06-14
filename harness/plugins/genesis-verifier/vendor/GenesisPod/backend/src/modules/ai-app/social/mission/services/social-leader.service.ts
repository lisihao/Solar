import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ContentFetcherService } from "./content-fetcher.service";
import { ContentTransformerService } from "./content-transformer.service";
import { ContentCheckerService } from "./content-checker.service";
import { ContentVersionService } from "./content-version.service";
import { WechatArticleFormatterService } from "./wechat-article-formatter.service";
import { ProcessUrlDto } from "../../api/dto/process-url.dto";
import { ProcessSourceDto } from "../../api/dto/process-source.dto";
import {
  Prisma,
  SocialContentStatus,
  SocialContentSourceType,
  SocialContentType,
  SocialReviewStatus,
} from "@prisma/client";

// Helper to sanitize strings by removing problematic characters for PostgreSQL
function sanitizeString(str: string | undefined | null): string {
  if (!str) return "";

  let result: string;

  // Step 1: FIRST validate UTF-8 using Node.js Buffer (more reliable than TextEncoder)
  // Buffer.from with utf8 encoding handles malformed UTF-16 surrogates
  // by replacing them with the UTF-8 representation of U+FFFD
  try {
    const buffer = Buffer.from(str, "utf8");
    result = buffer.toString("utf8");
  } catch {
    // If Buffer operations fail, strip to ASCII as fallback
    return str.replace(/[^\x20-\x7E\n\t\r]/g, "");
  }

  // Step 2: Normalize Unicode to NFC form (combines characters)
  try {
    result = result.normalize("NFC");
  } catch {
    // Some strings can't be normalized, continue without
  }

  // Step 3: Remove null bytes
  result = result.replace(/\x00/g, "");

  // Step 4: Remove control characters except tab (\x09), LF (\x0A), CR (\x0D)
  result = result.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Step 5: Remove zero-width characters that can cause encoding issues
  result = result.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // Step 6: Remove private use area characters
  result = result.replace(/[\uE000-\uF8FF]/g, "");

  // Step 7: Normalize line endings to \n
  result = result.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Step 8: Remove any U+FFFD replacement characters (introduced by UTF-8 validation)
  // IMPORTANT: This must come AFTER UTF-8 validation, not before!
  result = result.replace(/\uFFFD/g, "");

  // Step 9: Final validation - ensure the string round-trips through Buffer cleanly
  try {
    const finalBuffer = Buffer.from(result, "utf8");
    const finalString = finalBuffer.toString("utf8");

    // If round-trip produced different string, there's still invalid data
    if (finalString !== result) {
      // Strip to safe ASCII + common CJK range as last resort
      return result.replace(/[^\x20-\x7E\n\t\u4E00-\u9FFF\u3000-\u303F]/g, "");
    }

    return finalString;
  } catch {
    // Ultimate fallback: ASCII only
    return result.replace(/[^\x20-\x7E\n\t]/g, "");
  }
}

// Helper to safely truncate strings for database fields
function truncateString(
  str: string | undefined | null,
  maxLength: number,
): string {
  if (!str) return "";
  const sanitized = sanitizeString(str);
  if (sanitized.length <= maxLength) return sanitized;
  // Truncate and add ellipsis, leaving room for "..."
  return sanitized.substring(0, maxLength - 3) + "...";
}

// Helper to safely convert data to JSON-serializable format
function safeJsonSerialize<T>(data: T, fallback: T): T {
  try {
    // Test if data can be serialized
    JSON.stringify(data);
    return data;
  } catch {
    return fallback;
  }
}

// Helper to ensure array is valid JSON array
function ensureJsonArray(data: unknown): string[] {
  if (!data) return [];
  if (!Array.isArray(data)) return [];
  // Filter out non-string items and ensure serializable
  return data
    .filter((item): item is string => typeof item === "string")
    .map((item) => truncateString(item, 500));
}

/**
 * 选封面：images[0] > og:image > content 正文里第一张 <img>。
 *
 * 三级降级：
 *   1. images[0] — fetcher 抽出的正文图（图表/插图，跟内容直接相关）
 *   2. coverImage — og:image / Resource.thumbnail 兜底
 *   3. 正文里第一张 <img> — 兜底兜底：fetcher 漏掉但 HTML/markdown 自带的图
 *
 * 三级都空 → null，发布无封面（feed 列表无缩略图，仍可发）。
 */
function pickCoverImage(source: {
  coverImage?: string;
  images?: string[];
  content?: string;
}): string | null {
  const fromImages = source.images?.find(
    (img) => typeof img === "string" && img.trim().length > 0,
  );
  if (fromImages) return sanitizeString(fromImages) || null;

  const fromCover = sanitizeString(source.coverImage);
  if (fromCover) return fromCover;

  if (source.content) {
    const m = source.content.match(
      // 字符类禁 \s < > 防止 URL 跨行注入（Reviewer B4）
      /<img\b[^>\n]*\bsrc\s*=\s*["']([^"'\s<>]+)["']/i,
    );
    const url = m?.[1]?.trim();
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

// Retry helper for transient database errors (like connection pool issues)
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 500,
  logger?: Logger,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message;

      // Check if it's a transient error that can be retried
      // Be specific to avoid retrying non-transient errors like "Invalid connection string"
      const isTransientError =
        errorMessage.includes("08P01") || // PostgreSQL protocol error
        errorMessage.includes("insufficient data") ||
        errorMessage.includes("ECONNRESET") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("Connection terminated") ||
        errorMessage.includes("connection reset") ||
        errorMessage.includes("connection closed") ||
        errorMessage.includes("Can't reach database") ||
        errorMessage.includes("Server has closed the connection");

      if (isTransientError && attempt < maxRetries) {
        const delay = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
        logger?.warn(
          `Database operation failed (attempt ${attempt}/${maxRetries}), ` +
            `retrying in ${delay}ms: ${errorMessage.slice(0, 100)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw lastError;
      }
    }
  }
  throw lastError;
}

@Injectable()
export class SocialLeaderService {
  private readonly logger = new Logger(SocialLeaderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
    private readonly contentFetcher: ContentFetcherService,
    private readonly contentTransformer: ContentTransformerService,
    private readonly contentChecker: ContentCheckerService,
    private readonly contentVersionService: ContentVersionService,
    private readonly wechatFormatter: WechatArticleFormatterService,
  ) {}

  // Expose chat facade for advanced operations
  getChatFacade(): ChatFacade {
    return this.chatFacade;
  }

  /**
   * 处理外部URL，自动提取内容并转换为目标平台格式
   */
  async processUrl(userId: string, dto: ProcessUrlDto) {
    this.logger.log(`Processing URL: ${dto.url} for user ${userId}`);

    // 1. 获取URL内容
    const fetchedContent = await this.contentFetcher.fetchFromUrl(dto.url);

    // 2. AI 转换为目标平台格式（支持双语）
    const transformedContent = await this.contentTransformer.transform({
      sourceContent: fetchedContent.content,
      sourceTitle: fetchedContent.title,
      originalContent: fetchedContent.originalContent,
      translatedContent: fetchedContent.translatedContent,
      isBilingual: fetchedContent.isBilingual,
      targetType: dto.targetType,
      additionalInstructions: dto.additionalInstructions,
    });

    // 3. 验证转换后的内容有效性
    if (
      !transformedContent.content ||
      transformedContent.content.trim().length < 10
    ) {
      this.logger.error(
        `Invalid transformed content: length=${transformedContent.content?.length || 0}`,
      );
      throw new BadRequestException("内容转换结果无效，请重试");
    }

    // 4. 内容合规检测
    const checkResult = await this.contentChecker.check(
      transformedContent.content,
    );

    // 5. 创建内容记录 (truncate fields and validate JSON to fit database constraints)
    const safeImages = ensureJsonArray(fetchedContent.images);
    const safeTags = ensureJsonArray(transformedContent.tags);
    const safeComplianceCheck = safeJsonSerialize(checkResult, {
      passed: false,
      score: 0,
      issues: [],
      suggestions: ["Compliance check data was invalid"],
    });

    this.logger.debug(
      `Creating social content: title=${transformedContent.title?.slice(0, 50)}, ` +
        `contentLength=${transformedContent.content?.length}, ` +
        `imagesCount=${safeImages.length}, tagsCount=${safeTags.length}`,
    );

    // Sanitize content to remove problematic characters
    const safeContent = sanitizeString(transformedContent.content);
    const safeSourceUrl = sanitizeString(dto.url) || null;
    const safeCoverImageUrl = pickCoverImage(fetchedContent);

    this.logger.log(
      `[processUrl] Saving content: titleLen=${truncateString(transformedContent.title, 200).length}, ` +
        `contentLen=${safeContent.length}, imagesCount=${safeImages.length}, tagsCount=${safeTags.length}`,
    );

    // Use Prisma ORM with two-step approach to isolate 08P01 errors
    const safeTitle = truncateString(transformedContent.title, 200);
    const safeDigest = truncateString(transformedContent.digest, 200) || null;

    // Debug: Log byte lengths per field
    const fieldByteLengths = {
      userId: Buffer.byteLength(userId, "utf8"),
      title: Buffer.byteLength(safeTitle, "utf8"),
      content: Buffer.byteLength(safeContent, "utf8"),
      digest: safeDigest ? Buffer.byteLength(safeDigest, "utf8") : 0,
      sourceUrl: safeSourceUrl ? Buffer.byteLength(safeSourceUrl, "utf8") : 0,
      coverImageUrl: safeCoverImageUrl
        ? Buffer.byteLength(safeCoverImageUrl, "utf8")
        : 0,
      images: Buffer.byteLength(JSON.stringify(safeImages), "utf8"),
      tags: Buffer.byteLength(JSON.stringify(safeTags), "utf8"),
    };

    this.logger.log(
      `[processUrl] Field byte lengths: ${JSON.stringify(fieldByteLengths)}`,
    );

    try {
      // Single atomic create with all fields (avoids orphaned records from two-step approach)
      this.logger.log(`[processUrl] Creating content with all fields`);

      const updatedContent = await withRetry(
        async () => {
          return this.prisma.socialContent.create({
            data: {
              userId,
              contentType: dto.targetType,
              sourceType: SocialContentSourceType.EXTERNAL_URL,
              title: safeTitle,
              content: safeContent,
              status: SocialContentStatus.DRAFT,
              reviewStatus: SocialReviewStatus.PENDING,
              sourceUrl: safeSourceUrl,
              digest: safeDigest,
              coverImageUrl: safeCoverImageUrl,
              images: safeImages,
              tags: safeTags,
              complianceCheck:
                safeComplianceCheck as unknown as Prisma.InputJsonValue,
            },
          });
        },
        3,
        500,
        this.logger,
      );

      this.logger.log(`[processUrl] Created content ${updatedContent.id}`);

      // 6. 生成所有平台的适配版本（同步等待，告知用户结果）
      let versionGenerationFailed = false;
      let versionCount = 0;
      try {
        const versions = await this.contentVersionService.generateAllVersions(
          updatedContent.id,
        );
        versionCount = versions.length;
        this.logger.log(
          `[processUrl] Generated ${versionCount} platform versions for content ${updatedContent.id}`,
        );
      } catch (err) {
        versionGenerationFailed = true;
        this.logger.error(
          `[processUrl] Failed to generate platform versions: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }

      // 构建响应消息
      let message = checkResult.passed
        ? "内容已生成，请确认后发布"
        : "内容存在合规问题，请修改后再发布";

      if (versionGenerationFailed) {
        message += "（平台版本生成失败，可在编辑页面手动重试）";
      } else if (versionCount > 0) {
        message += `（已生成 ${versionCount} 个平台版本）`;
      }

      return {
        content: updatedContent,
        checkResult,
        message,
        versionCount,
        versionGenerationFailed,
      };
    } catch (error) {
      this.logger.error(`[processUrl] Insert failed: ${error}`);
      throw error;
    }
  }

  /**
   * 处理内部来源（AI Explore、Research、Office、Writing）
   */
  async processSource(userId: string, dto: ProcessSourceDto) {
    this.logger.log(
      `Processing source: ${dto.sourceType}/${dto.sourceId} for user ${userId}, keepFormat=${dto.keepFormat}, targetType=${dto.targetType}`,
    );

    // 1. 获取来源内容
    const sourceContent = await this.contentFetcher.fetchFromSource(
      dto.sourceType,
      dto.sourceId,
      userId,
    );

    // keepFormat 模式：保留原格式，跳过 AI 改写
    // Topic Insights 自动启用（报告格式必须保留），其他来源可通过 dto.keepFormat 手动启用
    const shouldKeepFormat =
      dto.sourceType === SocialContentSourceType.AI_TOPIC_INSIGHTS ||
      dto.keepFormat;
    if (
      shouldKeepFormat &&
      dto.targetType === SocialContentType.WECHAT_ARTICLE
    ) {
      this.logger.log(
        `[processSource] Using keepFormat mode for ${dto.sourceType}`,
      );
      return this.processKeepFormatSource(userId, dto, sourceContent);
    }

    // 2. AI 转换为目标平台格式（支持双语）
    const transformedContent = await this.contentTransformer.transform({
      sourceContent: sourceContent.content,
      sourceTitle: sourceContent.title,
      originalContent: sourceContent.originalContent,
      translatedContent: sourceContent.translatedContent,
      isBilingual: sourceContent.isBilingual,
      targetType: dto.targetType,
      additionalInstructions: dto.additionalInstructions,
    });

    // 3. 验证转换后的内容有效性
    if (
      !transformedContent.content ||
      transformedContent.content.trim().length < 10
    ) {
      this.logger.error(
        `Invalid transformed content from source: length=${transformedContent.content?.length || 0}`,
      );
      throw new BadRequestException("内容转换结果无效，请重试");
    }

    // 4. 内容合规检测
    const checkResult = await this.contentChecker.check(
      transformedContent.content,
    );

    // 5. 创建内容记录 (truncate fields and validate JSON to fit database constraints)
    const safeImages = ensureJsonArray(sourceContent.images);
    const safeTags = ensureJsonArray(transformedContent.tags);
    const safeComplianceCheck = safeJsonSerialize(checkResult, {
      passed: false,
      score: 0,
      issues: [],
      suggestions: ["Compliance check data was invalid"],
    });

    // Sanitize content to remove problematic characters
    const safeContent = sanitizeString(transformedContent.content);
    const safeTitle = truncateString(transformedContent.title, 200);
    const safeDigest = truncateString(transformedContent.digest, 200) || null;
    const safeSourceUrl = sanitizeString(sourceContent.url) || null;
    const safeCoverImageUrl = pickCoverImage(sourceContent);

    // Debug: Log byte lengths per field to identify encoding issues
    const fieldByteLengths = {
      userId: Buffer.byteLength(userId, "utf8"),
      title: Buffer.byteLength(safeTitle, "utf8"),
      content: Buffer.byteLength(safeContent, "utf8"),
      digest: safeDigest ? Buffer.byteLength(safeDigest, "utf8") : 0,
      sourceUrl: safeSourceUrl ? Buffer.byteLength(safeSourceUrl, "utf8") : 0,
      coverImageUrl: safeCoverImageUrl
        ? Buffer.byteLength(safeCoverImageUrl, "utf8")
        : 0,
      images: Buffer.byteLength(JSON.stringify(safeImages), "utf8"),
      tags: Buffer.byteLength(JSON.stringify(safeTags), "utf8"),
      complianceCheck: Buffer.byteLength(
        JSON.stringify(safeComplianceCheck),
        "utf8",
      ),
    };

    this.logger.log(
      `[processSource] Field byte lengths: ${JSON.stringify(fieldByteLengths)}`,
    );

    // Use Prisma $queryRaw to bypass ORM query builder
    // This tests if the issue is in Prisma's ORM layer vs binary protocol
    try {
      this.logger.log(`[processSource] Inserting via $queryRaw`);

      // Use $queryRaw with RETURNING to get the created record
      // Note: images and tags columns are text[] (PostgreSQL array), not jsonb
      // Use ARRAY() constructor with jsonb_array_elements_text to convert
      // Return all fields to avoid Prisma ORM type mismatch when reading back
      const results = await this.prisma.$queryRaw<
        Array<{
          id: string;
          user_id: string;
          content_type: string;
          source_type: string;
          source_id: string;
          title: string;
          content: string;
          digest: string | null;
          source_url: string | null;
          cover_image_url: string | null;
          images: string[];
          tags: string[];
          compliance_check: unknown;
          status: string;
          review_status: string;
          created_at: Date;
          updated_at: Date;
        }>
      >`
        INSERT INTO "social_contents" (
          "id", "user_id", "content_type", "source_type", "source_id",
          "title", "content", "digest", "source_url", "cover_image_url",
          "images", "tags", "compliance_check", "status", "review_status",
          "created_at", "updated_at"
        ) VALUES (
          gen_random_uuid(),
          ${userId}::uuid,
          ${dto.targetType}::"SocialContentType",
          ${dto.sourceType}::"SocialContentSourceType",
          ${dto.sourceId},
          ${safeTitle},
          ${safeContent},
          ${safeDigest},
          ${safeSourceUrl},
          ${safeCoverImageUrl},
          ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(safeImages)}::jsonb)),
          ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(safeTags)}::jsonb)),
          ${JSON.stringify(safeComplianceCheck)}::jsonb,
          'DRAFT'::"SocialContentStatus",
          'PENDING'::"SocialReviewStatus",
          NOW(),
          NOW()
        )
        RETURNING *
      `;

      const row = results[0];
      if (!row) {
        throw new Error("Insert succeeded but no data returned");
      }

      this.logger.log(`[processSource] $queryRaw insert success: ${row.id}`);

      // Map raw SQL result to expected format (avoiding Prisma ORM type mismatch)
      const content = {
        id: row.id,
        userId: row.user_id,
        contentType: row.content_type as SocialContentType,
        sourceType: row.source_type as SocialContentSourceType,
        sourceId: row.source_id,
        title: row.title,
        content: row.content,
        digest: row.digest,
        sourceUrl: row.source_url,
        coverImageUrl: row.cover_image_url,
        images: row.images,
        tags: row.tags,
        complianceCheck: row.compliance_check,
        status: row.status as SocialContentStatus,
        reviewStatus: row.review_status as SocialReviewStatus,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      // 6. 生成所有平台的适配版本（同步等待，告知用户结果）
      let versionGenerationFailed = false;
      let versionCount = 0;
      try {
        const versions = await this.contentVersionService.generateAllVersions(
          content.id,
        );
        versionCount = versions.length;
        this.logger.log(
          `[processSource] Generated ${versionCount} platform versions for content ${content.id}`,
        );
      } catch (err) {
        versionGenerationFailed = true;
        this.logger.error(
          `[processSource] Failed to generate platform versions: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }

      // 构建响应消息
      let message = checkResult.passed
        ? "内容已生成，请确认后发布"
        : "内容存在合规问题，请修改后再发布";

      if (versionGenerationFailed) {
        message += "（平台版本生成失败，可在编辑页面手动重试）";
      } else if (versionCount > 0) {
        message += `（已生成 ${versionCount} 个平台版本）`;
      }

      return {
        content,
        checkResult,
        message,
        versionCount,
        versionGenerationFailed,
      };
    } catch (error) {
      this.logger.error(`[processSource] Insert failed: ${error}`);
      throw error;
    }
  }

  /**
   * 保留原格式处理来源内容（跳过 AI 改写）
   * 用于将 Topic Insights 报告以原始格式发布到微信公众号
   * 当报告包含多个 ## 章节时，自动拆分为系列文章
   */
  private async processKeepFormatSource(
    userId: string,
    dto: ProcessSourceDto,
    sourceContent: {
      title: string;
      content: string;
      metadata?: Record<string, unknown>;
      images?: string[];
      coverImage?: string;
      url?: string;
    },
  ) {
    // 按 ## 标题拆分报告
    const sections = this.wechatFormatter.splitMarkdownIntoSections(
      sourceContent.content,
    );

    const isSeries = sections.length > 1;
    const seriesId = isSeries ? crypto.randomUUID() : null;

    this.logger.log(
      `[processKeepFormatSource] ${isSeries ? `Series mode: ${sections.length} parts, seriesId=${seriesId}` : "Single article mode"}`,
    );

    // Pre-compute all AI-dependent and pure-CPU values OUTSIDE the transaction.
    // The AI compliance check (contentChecker.check) is a network call and must
    // never hold a DB connection; compute it here before opening the transaction.
    type SectionInsertParams = {
      safeContent: string;
      safeTitle: string;
      safeDigest: string | null;
      safeSourceUrl: string | null;
      safeCoverImageUrl: string | null;
      safeImages: string[];
      safeTags: string[];
      safeComplianceCheck: unknown;
      seriesOrder: number | null;
    };

    let firstCheckResult: {
      passed: boolean;
      issues: unknown[];
      suggestions: unknown[];
    } = {
      passed: true,
      issues: [],
      suggestions: [],
    };

    const sectionParams: SectionInsertParams[] = [];
    const safeSourceUrl = sanitizeString(sourceContent.url) || null;
    const safeImages = ensureJsonArray(sourceContent.images);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];

      // 第一篇包含 Executive Summary
      const executiveSummary =
        i === 0
          ? (sourceContent.metadata?.executiveSummary as string | undefined)
          : undefined;

      // 将 section Markdown 转为微信 HTML（pure CPU）
      const wechatHtml = this.wechatFormatter.formatForWechat(
        section.markdown,
        {
          executiveSummary,
          charts: sourceContent.metadata?.charts as unknown[] | undefined,
          title: section.heading,
        },
      );

      // 生成标题（系列模式带序号，pure CPU）
      const sectionTitle = isSeries
        ? `${sourceContent.title}（${i + 1}/${sections.length}）${section.heading}`
        : sourceContent.title;

      // 生成摘要（pure CPU）
      const digest = this.wechatFormatter.generateDigest(section.markdown);

      // 内容合规检测（AI/network call）——只检测第一篇，避免重复消耗
      // This is a network call and MUST stay outside the transaction.
      const checkResult =
        i === 0
          ? await this.contentChecker.check(wechatHtml)
          : { passed: true, issues: [], suggestions: [] };

      if (i === 0) {
        firstCheckResult = checkResult;
      }

      sectionParams.push({
        safeContent: sanitizeString(wechatHtml),
        safeTitle: truncateString(sectionTitle, 200),
        safeDigest: truncateString(digest, 200) || null,
        safeSourceUrl,
        safeCoverImageUrl: i === 0 ? pickCoverImage(sourceContent) : null,
        safeImages,
        safeTags: [],
        safeComplianceCheck: safeJsonSerialize(checkResult, {
          passed: false,
          score: 0,
          issues: [],
          suggestions: ["Compliance check data was invalid"],
        }),
        seriesOrder: isSeries ? i + 1 : null,
      });
    }

    // All AI work is done. Open a single transaction containing ONLY pure DB INSERTs.
    // If any insert fails the whole transaction rolls back — no orphan DRAFT rows.
    const allContents: Array<{
      id: string;
      userId: string;
      contentType: string;
      sourceType: string;
      sourceId: string;
      title: string;
      content: string;
      digest: string | null;
      seriesId: string | null;
      seriesOrder: number | null;
      status: string;
      createdAt: Date;
    }> = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const rows: typeof allContents = [];
        for (let i = 0; i < sectionParams.length; i++) {
          const p = sectionParams[i];
          const results = await tx.$queryRaw<
            Array<{
              id: string;
              user_id: string;
              content_type: string;
              source_type: string;
              source_id: string;
              title: string;
              content: string;
              digest: string | null;
              series_id: string | null;
              series_order: number | null;
              status: string;
              created_at: Date;
            }>
          >`
            INSERT INTO "social_contents" (
              "id", "user_id", "content_type", "source_type", "source_id",
              "title", "content", "digest", "source_url", "cover_image_url",
              "images", "tags", "compliance_check", "status", "review_status",
              "series_id", "series_order",
              "created_at", "updated_at"
            ) VALUES (
              gen_random_uuid(),
              ${userId}::uuid,
              ${dto.targetType}::"SocialContentType",
              ${dto.sourceType}::"SocialContentSourceType",
              ${dto.sourceId},
              ${p.safeTitle},
              ${p.safeContent},
              ${p.safeDigest},
              ${p.safeSourceUrl},
              ${p.safeCoverImageUrl},
              ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(p.safeImages)}::jsonb)),
              ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(p.safeTags)}::jsonb)),
              ${JSON.stringify(p.safeComplianceCheck)}::jsonb,
              'DRAFT'::"SocialContentStatus",
              'PENDING'::"SocialReviewStatus",
              ${seriesId},
              ${p.seriesOrder}::integer,
              NOW(),
              NOW()
            )
            RETURNING id, user_id, content_type, source_type, source_id,
                      title, content, digest, series_id, series_order, status, created_at
          `;

          const row = results[0];
          if (!row) {
            throw new Error("Insert succeeded but no data returned");
          }

          this.logger.log(
            `[processKeepFormatSource] Created ${isSeries ? `part ${i + 1}/${sectionParams.length}` : "content"}: ${row.id}`,
          );

          rows.push({
            id: row.id,
            userId: row.user_id,
            contentType: row.content_type,
            sourceType: row.source_type,
            sourceId: row.source_id,
            title: row.title,
            content: row.content,
            digest: row.digest,
            seriesId: row.series_id,
            seriesOrder: row.series_order,
            status: row.status,
            createdAt: row.created_at,
          });
        }
        return rows;
      },
      { timeout: 30000 },
    );

    // Build response (first content for backward compatibility)
    const firstRow = allContents[0];
    const content = {
      id: firstRow.id,
      userId: firstRow.userId,
      contentType: firstRow.contentType as SocialContentType,
      sourceType: firstRow.sourceType as SocialContentSourceType,
      sourceId: firstRow.sourceId,
      title: firstRow.title,
      content: firstRow.content,
      digest: firstRow.digest,
      sourceUrl: sanitizeString(sourceContent.url) || null,
      coverImageUrl: pickCoverImage(sourceContent),
      images: ensureJsonArray(sourceContent.images),
      tags: [] as string[],
      complianceCheck: null,
      status: firstRow.status as SocialContentStatus,
      reviewStatus: "PENDING" as SocialReviewStatus,
      createdAt: firstRow.createdAt,
      updatedAt: firstRow.createdAt,
    };

    const message = isSeries
      ? `报告已拆分为 ${sections.length} 篇系列文章，请确认后发布`
      : "报告已转为微信公众号格式，请确认后发布";

    return {
      content,
      seriesId,
      seriesContents: isSeries
        ? allContents.map((row) => ({
            id: row.id,
            title: row.title,
            content: row.content,
            digest: row.digest,
            seriesOrder: row.seriesOrder,
            status: row.status,
          }))
        : undefined,
      checkResult: firstCheckResult,
      message,
      versionCount: 0,
      versionGenerationFailed: false,
    };
  }

  /**
   * 重新生成内容
   */
  async regenerateContent(userId: string, contentId: string) {
    // Use retry for database query in case of transient connection issues
    const existingContent = await withRetry(
      async () => {
        const result = await this.prisma.socialContent.findFirst({
          where: { id: contentId, userId },
        });
        return result as {
          sourceUrl?: string;
          sourceId?: string;
          sourceType?: SocialContentSourceType;
          contentType: SocialContentType;
        } | null;
      },
      3,
      500,
      this.logger,
    );

    if (!existingContent) {
      throw new NotFoundException("内容不存在");
    }

    // 根据原始来源重新获取和转换
    if (existingContent.sourceUrl) {
      return this.processUrl(userId, {
        url: existingContent.sourceUrl,
        targetType: existingContent.contentType,
      });
    }

    if (existingContent.sourceId && existingContent.sourceType) {
      return this.processSource(userId, {
        sourceType: existingContent.sourceType,
        sourceId: existingContent.sourceId,
        targetType: existingContent.contentType,
      });
    }

    throw new BadRequestException("无法确定原始内容来源");
  }
}
