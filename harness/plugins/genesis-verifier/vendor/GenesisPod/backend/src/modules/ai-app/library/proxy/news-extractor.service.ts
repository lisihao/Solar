import { Injectable, Logger } from "@nestjs/common";
import { JSDOM } from "jsdom";

/**
 * Meta Refresh 重定向检测结果
 */
export interface MetaRefreshResult {
  isRedirect: boolean;
  redirectUrl: string | null;
}

/**
 * 新闻内容提取结果
 */
export interface NewsExtractionResult {
  title: string;
  content: string;
  textContent: string;
  author: string;
  publishDate: Date | null;
  modifiedDate: Date | null;
  excerpt: string;
  imageUrl: string;
  siteName: string;
  paywalledIndicators: string[]; // 付费墙检测结果
  confidence: number; // 0-100 置信度
  source: "schemaorg" | "opengraph" | "twittercard" | "generic"; // 提取来源
}

/**
 * 新闻内容提取服务
 *
 * 专门针对新闻文章的优化提取，使用多种元数据格式：
 * 1. Schema.org/Article JSON-LD（最标准）
 * 2. Open Graph meta标签（常见）
 * 3. Twitter Card meta标签（社交媒体）
 * 4. Generic fallback（通用备选）
 *
 * 这个服务补充了 AdvancedExtractorService，为新闻内容提供额外的元数据提取
 */
@Injectable()
export class NewsExtractorService {
  private readonly logger = new Logger(NewsExtractorService.name);

  /**
   * 检测 HTML 中的 Meta Refresh 重定向
   *
   * 一些网站（如 deepmind.google）使用 meta refresh 进行重定向，
   * 而不是 HTTP 301/302 重定向。axios 不会自动处理这种重定向。
   *
   * 检测格式：
   * - <meta http-equiv="refresh" content="0; url=https://...">
   * - <meta http-equiv="refresh" content="1;url=https://...">
   * - window.location.href = "https://..." (JavaScript重定向)
   */
  detectMetaRefreshRedirect(html: string, baseUrl: string): MetaRefreshResult {
    try {
      const dom = new JSDOM(html, { url: baseUrl });
      const doc = dom.window.document;

      // 1. 检查 meta refresh 标签
      const metaRefresh = doc.querySelector(
        'meta[http-equiv="refresh"], meta[http-equiv="Refresh"]',
      );

      if (metaRefresh) {
        const content = metaRefresh.getAttribute("content") || "";
        // 解析格式: "0; url=https://..." 或 "1;url=https://..."
        const urlMatch = content.match(/url=["']?([^"'\s>]+)/i);
        if (urlMatch && urlMatch[1]) {
          let redirectUrl = urlMatch[1];
          // 处理 HTML entities
          redirectUrl = redirectUrl.replace(/&amp;/g, "&");
          // 如果是相对 URL，转换为绝对 URL
          if (!redirectUrl.startsWith("http")) {
            const base = new URL(baseUrl);
            redirectUrl = new URL(redirectUrl, base).href;
          }
          this.logger.log(
            `Detected meta refresh redirect: ${baseUrl} -> ${redirectUrl}`,
          );
          return { isRedirect: true, redirectUrl };
        }
      }

      // 2. 检查 JavaScript 重定向 (window.location)
      const scripts = doc.querySelectorAll("script");
      for (const script of Array.from(scripts)) {
        const text = script.textContent || "";
        // 匹配 window.location.href = "..." 或 window.location = "..."
        const jsMatch = text.match(
          /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/,
        );
        if (jsMatch && jsMatch[1]) {
          let redirectUrl = jsMatch[1];
          redirectUrl = redirectUrl.replace(/&amp;/g, "&");
          if (!redirectUrl.startsWith("http")) {
            const base = new URL(baseUrl);
            redirectUrl = new URL(redirectUrl, base).href;
          }
          this.logger.log(
            `Detected JavaScript redirect: ${baseUrl} -> ${redirectUrl}`,
          );
          return { isRedirect: true, redirectUrl };
        }
      }

      // 3. 检查页面内容是否过短（可能是重定向页面）
      const bodyText = doc.body?.textContent?.trim() || "";
      if (bodyText.length < 200) {
        // 页面内容很短，可能是重定向页面但我们没能解析出 URL
        this.logger.debug(
          `Page content very short (${bodyText.length} chars), might be a redirect page`,
        );
      }

      return { isRedirect: false, redirectUrl: null };
    } catch (error) {
      this.logger.debug(
        `Meta refresh detection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { isRedirect: false, redirectUrl: null };
    }
  }

  /**
   * 智能新闻内容提取 - 按优先级尝试多个方法
   */
  async extractNews(html: string, url: string): Promise<NewsExtractionResult> {
    this.logger.log(`Extracting news content from: ${url}`);

    const dom = new JSDOM(html, {
      url,
      pretendToBeVisual: true,
    });

    const doc = dom.window.document;

    // 尝试按优先级提取
    let result: NewsExtractionResult | null = null;

    // 1. 尝试 Schema.org JSON-LD
    result = this.extractFromSchemaOrg(doc, url);
    if (result && this.isValidNews(result)) {
      this.logger.debug(`Extracted via Schema.org: ${result.title}`);
      return result;
    }

    // 2. 尝试 Open Graph
    result = this.extractFromOpenGraph(doc, url);
    if (result && this.isValidNews(result)) {
      this.logger.debug(`Extracted via Open Graph: ${result.title}`);
      return result;
    }

    // 3. 尝试 Twitter Card
    result = this.extractFromTwitterCard(doc, url);
    if (result && this.isValidNews(result)) {
      this.logger.debug(`Extracted via Twitter Card: ${result.title}`);
      return result;
    }

    // 4. 通用提取
    result = this.extractGeneric(doc, url);
    this.logger.debug(`Extracted via generic method: ${result.title}`);
    return result;
  }

  /**
   * 从 Schema.org Article JSON-LD 提取
   *
   * 这是最标准的新闻元数据格式
   * 成功率：70-80%（对于现代新闻网站）
   */
  private extractFromSchemaOrg(
    doc: Document,
    url: string,
  ): NewsExtractionResult | null {
    try {
      // 查找 JSON-LD script
      const scripts = doc.querySelectorAll(
        'script[type="application/ld+json"]',
      );
      let articleData = null;

      for (const script of Array.from(scripts)) {
        try {
          const data = JSON.parse(script.textContent || "{}");

          // 检查是否是 Article 类型
          if (
            data["@type"] === "NewsArticle" ||
            data["@type"] === "Article" ||
            (Array.isArray(data["@type"]) &&
              (data["@type"].includes("NewsArticle") ||
                data["@type"].includes("Article")))
          ) {
            articleData = data;
            break;
          }

          // 检查 @graph 结构
          if (data["@graph"]) {
            const found = data["@graph"].find(
              (item: Record<string, unknown>) =>
                item["@type"] === "NewsArticle" || item["@type"] === "Article",
            );
            if (found) {
              articleData = found;
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      if (!articleData) {
        return null;
      }

      const title = articleData.headline || articleData.title || "";
      const content = articleData.articleBody || "";
      const author = this.extractAuthor(articleData.author);
      const publishDate = articleData.datePublished
        ? new Date(articleData.datePublished)
        : null;
      const modifiedDate = articleData.dateModified
        ? new Date(articleData.dateModified)
        : null;
      const imageUrl =
        articleData.image?.url ||
        articleData.image ||
        articleData.thumbnail ||
        "";
      const siteName =
        articleData.publisher?.name ||
        new URL(url).hostname.replace("www.", "");

      return {
        title,
        content,
        textContent: content,
        author,
        publishDate,
        modifiedDate,
        excerpt: articleData.description || "",
        imageUrl,
        siteName,
        paywalledIndicators: this.detectPaywall(content),
        confidence: 95,
        source: "schemaorg",
      } as NewsExtractionResult;
    } catch (error) {
      this.logger.debug(
        `Schema.org extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * 从 Open Graph meta标签提取
   *
   * Open Graph 是社交媒体分享标准
   * 成功率：60-70%（大多数网站支持）
   */
  private extractFromOpenGraph(
    doc: Document,
    url: string,
  ): NewsExtractionResult | null {
    try {
      const getMeta = (property: string): string => {
        const element = doc.querySelector(`meta[property="${property}"]`);
        return element?.getAttribute("content") || "";
      };

      const title = getMeta("og:title");
      const excerpt = getMeta("og:description");
      const imageUrl = getMeta("og:image");
      const articleAuthor = getMeta("article:author");
      const publishDate = getMeta("article:published_time")
        ? new Date(getMeta("article:published_time"))
        : null;
      const modifiedDate = getMeta("article:modified_time")
        ? new Date(getMeta("article:modified_time"))
        : null;

      if (!title) {
        return null;
      }

      // Open Graph 不包含完整内容，需要从 body 中提取
      const bodyText = this.extractBodyText(doc);

      const siteName =
        getMeta("og:site_name") || new URL(url).hostname.replace("www.", "");

      return {
        title,
        content: bodyText,
        textContent: bodyText,
        author: articleAuthor,
        publishDate,
        modifiedDate,
        excerpt,
        imageUrl,
        siteName,
        paywalledIndicators: this.detectPaywall(bodyText),
        confidence: 75,
        source: "opengraph",
      } as NewsExtractionResult;
    } catch (error) {
      this.logger.debug(
        `Open Graph extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * 从 Twitter Card meta标签提取
   *
   * Twitter Card 用于推特分享
   * 成功率：50-60%（主要用于社交媒体）
   */
  private extractFromTwitterCard(
    doc: Document,
    url: string,
  ): NewsExtractionResult | null {
    try {
      const getMeta = (name: string): string => {
        const element = doc.querySelector(`meta[name="${name}"]`);
        return element?.getAttribute("content") || "";
      };

      const title = getMeta("twitter:title");
      const excerpt = getMeta("twitter:description");
      const imageUrl = getMeta("twitter:image");

      if (!title) {
        return null;
      }

      const bodyText = this.extractBodyText(doc);
      const siteName = new URL(url).hostname.replace("www.", "");

      return {
        title,
        content: bodyText,
        textContent: bodyText,
        author: "",
        publishDate: null,
        modifiedDate: null,
        excerpt,
        imageUrl,
        siteName,
        paywalledIndicators: this.detectPaywall(bodyText),
        confidence: 60,
        source: "twittercard",
      } as NewsExtractionResult;
    } catch (error) {
      this.logger.debug(
        `Twitter Card extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * 通用新闻提取方法
   *
   * 当上面的方法都失败时的备选方案
   * 使用启发式规则识别新闻元素
   */
  private extractGeneric(doc: Document, url: string): NewsExtractionResult {
    // 提取标题
    const title =
      doc.querySelector("h1")?.textContent?.trim() ||
      doc.querySelector("title")?.textContent?.trim() ||
      "Untitled";

    // 提取内容
    const bodyText = this.extractBodyText(doc);

    // 提取日期（常见模式）
    const datePattern =
      /(\d{4}-\d{2}-\d{2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;
    const dateMatch = doc.body.textContent?.match(datePattern);
    const publishDate = dateMatch ? this.parseDate(dateMatch[0]) : null;

    // 提取作者（常见模式）
    const authorElement = doc.querySelector(
      "[class*='author'], [class*='byline'], [rel='author']",
    );
    const author = authorElement?.textContent?.trim() || "";

    // 提取图片
    const imageElement = doc.querySelector(
      "img[src*='article'], img[src*='content'], article img",
    ) as HTMLImageElement;
    const imageUrl = imageElement?.src || "";

    const siteName = new URL(url).hostname.replace("www.", "");

    return {
      title,
      content: bodyText,
      textContent: bodyText,
      author,
      publishDate,
      modifiedDate: null,
      excerpt: bodyText.substring(0, 200),
      imageUrl,
      siteName,
      paywalledIndicators: this.detectPaywall(bodyText),
      confidence: 50,
      source: "generic",
    };
  }

  /**
   * 检测付费墙 - 识别可能被付费阻挡的文章
   *
   * 返回检测到的指标列表
   */
  private detectPaywall(content: string): string[] {
    const indicators: string[] = [];

    // 检查常见的付费墙关键词
    const paywallKeywords = [
      "subscribe",
      "membership",
      "paywall",
      "premium content",
      "login required",
      "sign in to read",
      "limited articles",
    ];

    const lowerContent = content.toLowerCase();
    for (const keyword of paywallKeywords) {
      if (lowerContent.includes(keyword)) {
        indicators.push(keyword);
      }
    }

    return indicators;
  }

  /**
   * 从 body 中提取文本内容
   *
   * 移除脚本、样式、导航等无关内容
   */
  private extractBodyText(doc: Document): string {
    const clone = doc.cloneNode(true) as Document;

    // 移除无关元素
    const toRemove = clone.querySelectorAll(
      "script, style, nav, footer, .sidebar, .ads, .advertisement, .comments, .related-articles",
    );
    toRemove.forEach((el) => el.remove());

    // 尽可能从 article 或 main 标签中提取
    let textElement: Element | null = clone.querySelector("article");
    if (!textElement) {
      textElement = clone.querySelector("main");
    }
    if (!textElement) {
      textElement = clone.querySelector("[role='main']");
    }
    if (!textElement) {
      textElement = clone.body;
    }

    return textElement?.textContent?.trim() || "";
  }

  /**
   * 解析日期字符串
   */
  private parseDate(dateStr: string): Date | null {
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 提取作者信息
   *
   * 处理多种格式：字符串、对象、数组
   */
  private extractAuthor(author: unknown): string {
    if (!author) {
      return "";
    }

    if (typeof author === "string") {
      return author;
    }

    if (Array.isArray(author)) {
      if (author.length === 0) {
        return "";
      }
      const firstAuthor = author[0];
      if (typeof firstAuthor === "string") {
        return firstAuthor;
      }
      if (
        typeof firstAuthor === "object" &&
        (firstAuthor as Record<string, unknown>).name
      ) {
        return (firstAuthor as Record<string, unknown>).name as string;
      }
    }

    if (
      typeof author === "object" &&
      (author as Record<string, unknown>).name
    ) {
      return (author as Record<string, unknown>).name as string;
    }

    return "";
  }

  /**
   * 验证提取的新闻信息是否有效
   *
   * 必须至少有标题和内容
   */
  private isValidNews(result: NewsExtractionResult): boolean {
    return result.title.length > 5 && result.content.length > 100;
  }
}
