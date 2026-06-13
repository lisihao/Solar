/**
 * URL Fetch Service for Knowledge Base
 * Handles fetching and extracting content from web URLs
 */

import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { KnowledgeBaseService } from "./knowledge-base.service";

export interface UrlFetchResult {
  url: string;
  title: string;
  content: string;
  wordCount: number;
  metadata: {
    author?: string;
    publishDate?: string;
    siteName?: string;
    description?: string;
    language?: string;
  };
}

export interface UrlImportResult {
  success: number;
  failed: Array<{ url: string; error: string }>;
  documents: Array<{ id: string; title: string; url: string }>;
}

@Injectable()
export class UrlFetchService {
  private readonly logger = new Logger(UrlFetchService.name);
  private readonly maxContentSize = 500 * 1024; // 500KB text limit
  private readonly fetchTimeout = 30000; // 30 seconds

  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  /**
   * Fetch and extract content from a single URL
   */
  async fetchUrl(url: string): Promise<UrlFetchResult> {
    this.logger.log(`Fetching URL: ${url}`);

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Only HTTP and HTTPS URLs are supported");
      }
    } catch (error) {
      throw new BadRequestException(
        `Invalid URL format: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    try {
      // Fetch with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.fetchTimeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new BadRequestException(
          `Failed to fetch URL: HTTP ${response.status}`,
        );
      }

      const html = await response.text();

      // Check content size
      if (html.length > this.maxContentSize) {
        this.logger.warn(
          `Content too large (${html.length} bytes), truncating...`,
        );
      }

      // Extract content
      const extracted = this.extractContent(html, parsedUrl);

      this.logger.log(
        `Extracted: "${extracted.title}" (${extracted.wordCount} words)`,
      );

      return {
        url,
        ...extracted,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : "Unknown fetch error";
      this.logger.error(`Failed to fetch URL ${url}: ${message}`);

      // Check for common error types
      if (message.includes("aborted")) {
        throw new BadRequestException(
          `Request timeout: The page took too long to respond (>${this.fetchTimeout / 1000}s)`,
        );
      }
      if (message.includes("ENOTFOUND") || message.includes("getaddrinfo")) {
        throw new BadRequestException(
          `Cannot reach URL: Domain not found or network error`,
        );
      }
      if (message.includes("ECONNREFUSED")) {
        throw new BadRequestException(
          `Connection refused: The server is not accepting connections`,
        );
      }

      throw new BadRequestException(`Failed to fetch URL: ${message}`);
    }
  }

  /**
   * Extract main content from HTML
   */
  private extractContent(html: string, url: URL): Omit<UrlFetchResult, "url"> {
    // Extract title
    const titleMatch =
      html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
      html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    const title = titleMatch ? this.cleanText(titleMatch[1]) : url.hostname;

    // Extract meta description
    const descMatch =
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
    const description = descMatch ? this.cleanText(descMatch[1]) : undefined;

    // Extract author
    const authorMatch =
      html.match(/<meta[^>]+name="author"[^>]+content="([^"]+)"/i) ||
      html.match(/<meta[^>]+property="article:author"[^>]+content="([^"]+)"/i);
    const author = authorMatch ? this.cleanText(authorMatch[1]) : undefined;

    // Extract publish date
    const dateMatch =
      html.match(
        /<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i,
      ) || html.match(/<time[^>]+datetime="([^"]+)"/i);
    const publishDate = dateMatch ? dateMatch[1] : undefined;

    // Extract site name
    const siteMatch = html.match(
      /<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i,
    );
    const siteName = siteMatch ? this.cleanText(siteMatch[1]) : url.hostname;

    // Extract main content - try various common selectors
    let content = this.extractMainContent(html);

    // If content extraction failed, use description as fallback
    if (!content && description) {
      content = description;
    }

    // Count words
    const wordCount = content
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    return {
      title,
      content,
      wordCount,
      metadata: {
        author,
        publishDate,
        siteName,
        description,
      },
    };
  }

  /**
   * Extract main content from HTML, removing navigation, ads, etc.
   */
  private extractMainContent(html: string): string {
    // Remove scripts, styles, nav, header, footer, aside
    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
      .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");

    // Try to find main content area
    const mainMatch =
      cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
      cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
      cleaned.match(
        /<div[^>]+(?:class|id)="[^"]*(?:content|main|article|post|entry)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      );

    if (mainMatch) {
      cleaned = mainMatch[1];
    } else {
      // Fallback: try to get body content
      const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        cleaned = bodyMatch[1];
      }
    }

    // Remove all HTML tags and clean up whitespace
    const text = cleaned
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    return text;
  }

  /**
   * Clean text by removing extra whitespace and HTML entities
   */
  private cleanText(text: string): string {
    return text
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Import a single URL to a knowledge base
   */
  async importUrl(
    knowledgeBaseId: string,
    url: string,
  ): Promise<{ id: string; title: string; url: string }> {
    const fetched = await this.fetchUrl(url);

    const doc = await this.knowledgeBaseService.addDocument(knowledgeBaseId, {
      title: fetched.title,
      content: fetched.content,
      sourceType: "URL",
      sourceUrl: url,
      mimeType: "text/html",
      metadata: fetched.metadata,
    });

    this.logger.log(
      `Imported URL "${fetched.title}" to KB ${knowledgeBaseId} as doc ${doc.id}`,
    );

    return {
      id: doc.id,
      title: fetched.title,
      url,
    };
  }

  /**
   * Batch import multiple URLs to a knowledge base
   */
  async importUrls(
    knowledgeBaseId: string,
    urls: string[],
  ): Promise<UrlImportResult> {
    this.logger.log(
      `Batch importing ${urls.length} URLs to KB ${knowledgeBaseId}`,
    );

    const result: UrlImportResult = {
      success: 0,
      failed: [],
      documents: [],
    };

    // Process URLs sequentially to avoid overwhelming servers
    for (const url of urls) {
      try {
        const doc = await this.importUrl(knowledgeBaseId, url);
        result.success++;
        result.documents.push(doc);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.warn(`Failed to import URL ${url}: ${message}`);
        result.failed.push({ url, error: message });
      }
    }

    this.logger.log(
      `Batch import complete: ${result.success} success, ${result.failed.length} failed`,
    );

    return result;
  }
}
