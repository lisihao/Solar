import { Injectable, Logger } from "@nestjs/common";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

/**
 * 提取结果数据结构
 */
export interface ExtractionResult {
  success: boolean;
  title: string;
  content: string; // 清洁的HTML
  textContent: string; // 纯文本
  excerpt: string;
  byline: string;
  siteName: string;
  length: number;
  plan: "readability" | "dom" | "regex" | "fallback"; // 使用的提取方案
  confidence: number; // 0-100 置信度
  message?: string; // 备注信息
}

/**
 * 高级内容提取服务
 *
 * 实现4层容错机制，确保即使主方案失败也能提取内容：
 * 1. Plan A: Readability（针对通用文章，成功率~70-80%）
 * 2. Plan B: DOM节点提取（针对Readability失败的情况）
 * 3. Plan C: 正则表达式提取（针对结构化内容）
 * 4. Plan D: 基础HTML降级（最后的安全网）
 */
@Injectable()
export class AdvancedExtractorService {
  private readonly logger = new Logger(AdvancedExtractorService.name);

  /**
   * 主入口：智能选择提取方案
   *
   * 按优先级尝试多个提取方案，确保最大化成功率
   */
  async extract(
    html: string,
    url: string,
    timeout: number = 30000,
  ): Promise<ExtractionResult> {
    this.logger.log(`Starting advanced extraction for URL: ${url}`);

    // Plan A: 尝试Readability（最优方案，通过率最高）
    try {
      const result = await this.planA_Readability(html, url, timeout);
      if (result.success && result.length > 500) {
        // 如果内容足够长，说明提取成功
        this.logger.log(
          `Plan A (Readability) succeeded: ${result.length} characters extracted`,
        );
        return result;
      }
    } catch (err) {
      this.logger.warn(
        `Plan A (Readability) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Plan B: 尝试DOM节点提取
    try {
      const result = await this.planB_DOM(html, url);
      if (result.success && result.length > 300) {
        this.logger.log(
          `Plan B (DOM) succeeded: ${result.length} characters extracted`,
        );
        return result;
      }
    } catch (err) {
      this.logger.warn(
        `Plan B (DOM) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Plan C: 尝试正则表达式提取
    try {
      const result = await this.planC_Regex(html, url);
      if (result.success && result.length > 200) {
        this.logger.log(
          `Plan C (Regex) succeeded: ${result.length} characters extracted`,
        );
        return result;
      }
    } catch (err) {
      this.logger.warn(
        `Plan C (Regex) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Plan D: 基础HTML降级提取
    try {
      const result = await this.planD_Fallback(html, url);
      this.logger.log(
        `Plan D (Fallback) used: ${result.length} characters extracted`,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `All extraction plans failed: ${err instanceof Error ? err.message : String(err)}`,
      );

      // 最后的救命稻草：返回空内容但标记为失败
      return {
        success: false,
        title: this.extractTitleFromURL(url),
        content: "",
        textContent: "",
        excerpt: "",
        byline: "",
        siteName: this.extractSiteNameFromURL(url),
        length: 0,
        plan: "fallback",
        confidence: 0,
        message: "All extraction plans failed",
      };
    }
  }

  /**
   * Plan A: Readability 提取
   *
   * 最优方案，针对新闻文章、博客、维基百科等结构清晰的内容
   * 成功率：70-80%
   * 优点：清洁输出，移除导航栏、侧栏等无关内容
   * 缺点：对某些特殊结构（如社交媒体、评论区）失效
   */
  private async planA_Readability(
    html: string,
    url: string,
    timeout: number,
  ): Promise<ExtractionResult> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(
        () => reject(new Error("Readability parsing timeout")),
        timeout,
      );

      try {
        const dom = new JSDOM(html, {
          url: url,
          pretendToBeVisual: true,
          storageQuota: 10 * 1024 * 1024,
        });

        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        clearTimeout(timeoutHandle);

        if (!article?.content) {
          reject(new Error("Readability returned no content"));
          return;
        }

        const textContent = article.textContent || "";
        const length = textContent.length;

        resolve({
          success: true,
          title: article.title || this.extractTitleFromURL(url),
          content: article.content,
          textContent: textContent,
          excerpt: article.excerpt || this.extractExcerpt(textContent),
          byline: article.byline || "",
          siteName: article.siteName || this.extractSiteNameFromURL(url),
          length: length,
          plan: "readability",
          confidence: length > 1000 ? 95 : length > 500 ? 85 : 70,
        });
      } catch (err) {
        clearTimeout(timeoutHandle);
        reject(err);
      }
    });
  }

  /**
   * Plan B: DOM 节点提取
   *
   * 当Readability失败时的备选方案
   * 通过识别常见的内容节点类名和ID来提取内容
   * 成功率：60-70%
   * 优点：对不同网站的通用性较好
   * 缺点：可能包含一些无关内容
   */
  private async planB_DOM(
    html: string,
    url: string,
  ): Promise<ExtractionResult> {
    const dom = new JSDOM(html, {
      url: url,
      pretendToBeVisual: true,
    });

    const doc = dom.window.document;

    // 常见的内容容器类名/ID（优先级从高到低）
    const contentSelectors = [
      // 通用容器
      "article",
      "[role='main']",
      ".article-content",
      ".post-content",
      ".entry-content",
      ".content",
      "main",
      ".main-content",
      ".article-body",
      ".post-body",
      ".page-content",
      "#content",
      "#main",
      ".container",
      // 社交媒体和特殊网站
      ".thread",
      ".feed",
      ".stream",
      ".timeline",
    ];

    let contentNode: Element | null = null;

    // 尝试找到最合适的内容容器
    for (const selector of contentSelectors) {
      contentNode = doc.querySelector(selector);
      if (contentNode) {
        this.logger.debug(`Found content node with selector: ${selector}`);
        break;
      }
    }

    // 如果没找到特定容器，使用 body
    if (!contentNode) {
      contentNode = doc.body;
    }

    // 清理节点
    this.cleanDOM(contentNode);

    // 提取标题
    const title = this.extractTitleFromDOM(doc);

    // 提取文本内容
    const textContent =
      contentNode.textContent?.trim() || doc.body.textContent?.trim() || "";
    const length = textContent.length;

    // 生成HTML内容
    const content = contentNode.innerHTML;

    return {
      success: true,
      title: title || this.extractTitleFromURL(url),
      content: content,
      textContent: textContent,
      excerpt: this.extractExcerpt(textContent),
      byline: "",
      siteName: this.extractSiteNameFromURL(url),
      length: length,
      plan: "dom",
      confidence: length > 1000 ? 75 : length > 500 ? 65 : 50,
      message: `Extracted from ${contentNode.nodeName} element`,
    };
  }

  /**
   * Plan C: 正则表达式提取
   *
   * 针对结构化内容（如新闻文章、商品描述等）
   * 使用启发式规则和正则表达式来识别和提取内容
   * 成功率：50-60%
   * 优点：快速、不需要DOM解析
   * 缺点：精准度较低，可能误删有用内容
   */
  private async planC_Regex(
    html: string,
    url: string,
  ): Promise<ExtractionResult> {
    // 移除脚本、样式、注释
    const cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");

    // 提取标题
    const title = this.extractTitleFromRegex(cleaned, html);

    // 提取最大的文本块（通常是主要内容）
    const paragraphs = cleaned.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
    const divs = cleaned.match(/<div[^>]*>[\s\S]*?<\/div>/gi) || [];
    const articles = cleaned.match(/<article[^>]*>[\s\S]*?<\/article>/gi) || [];

    // 合并所有内容
    const allBlocks = [...articles, ...paragraphs, ...divs];

    // 按大小排序，选择最大的块
    const largestBlocks = allBlocks
      .sort((a, b) => b.length - a.length)
      .slice(0, 5);

    const content = largestBlocks.join("\n");

    // 提取纯文本
    const textContent = this.stripHTML(content).replace(/\s+/g, " ").trim();

    const length = textContent.length;

    return {
      success: true,
      title: title,
      content: content,
      textContent: textContent,
      excerpt: this.extractExcerpt(textContent),
      byline: this.extractBylineFromRegex(cleaned),
      siteName: this.extractSiteNameFromURL(url),
      length: length,
      plan: "regex",
      confidence: length > 1000 ? 70 : length > 500 ? 60 : 45,
      message: `Extracted ${allBlocks.length} content blocks`,
    };
  }

  /**
   * Plan D: 基础HTML降级
   *
   * 最后的安全网，即使其他方案全部失败也能返回基本内容
   * 直接提取body中的所有文本
   * 成功率：>99%（除非HTML完全损坏）
   * 优点：无法失败
   * 缺点：可能包含大量噪声（导航栏、侧栏等）
   */
  private async planD_Fallback(
    html: string,
    url: string,
  ): Promise<ExtractionResult> {
    // 移除脚本和样式
    const cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

    // 简单的DOM解析
    const dom = new JSDOM(cleaned, { url });
    const doc = dom.window.document;

    // 清理导航、页脚等常见的无关内容
    const toRemove = doc.querySelectorAll(
      "nav, footer, header, .nav, .navigation, .sidebar, .ads, .advertisement, [role='navigation']",
    );
    toRemove.forEach((node) => node.remove());

    // 提取body中的所有文本
    const textContent = doc.body.textContent?.trim() || "";
    const length = textContent.length;

    return {
      success: true,
      title: this.extractTitleFromDOM(doc) || this.extractTitleFromURL(url),
      content: doc.body.innerHTML,
      textContent: textContent,
      excerpt: this.extractExcerpt(textContent),
      byline: "",
      siteName: this.extractSiteNameFromURL(url),
      length: length,
      plan: "fallback",
      confidence: length > 500 ? 40 : 20,
      message: "Using fallback extraction after all other plans failed",
    };
  }

  /**
   * 清理DOM节点：移除脚本、样式、广告等无关内容
   */
  private cleanDOM(node: Element): void {
    // 移除的标签
    const toRemove = node.querySelectorAll(
      "script, style, noscript, iframe, .ad, .advertisement, .sidebar, .nav, nav, footer, .comments",
    );
    toRemove.forEach((el) => el.remove());

    // 移除空的div/span
    const emptyElements = node.querySelectorAll(
      "div:empty, span:empty, p:empty",
    );
    emptyElements.forEach((el) => {
      if (!el.innerHTML || el.textContent?.trim() === "") {
        el.remove();
      }
    });
  }

  /**
   * 从DOM提取标题
   */
  private extractTitleFromDOM(doc: Document): string {
    // 尝试多个标题选择器
    const selectors = [
      "title",
      "h1",
      "h1.title",
      "h1.post-title",
      ".article-title",
      ".post-title",
      "meta[property='og:title']",
      "meta[name='twitter:title']",
    ];

    for (const selector of selectors) {
      if (selector.startsWith("meta")) {
        const meta = doc.querySelector(selector);
        if (meta) {
          const content = meta.getAttribute("content");
          if (content) return content;
        }
      } else {
        const el = doc.querySelector(selector);
        if (el && el.textContent?.trim()) {
          return el.textContent.trim();
        }
      }
    }

    return "";
  }

  /**
   * 从URL提取标题（备选）
   */
  private extractTitleFromURL(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathName = urlObj.pathname
        .split("/")
        .filter((p) => p)
        .pop();
      return pathName
        ? pathName.replace(/[-_]/g, " ").replace(/\.\w+$/, "")
        : urlObj.hostname;
    } catch {
      return "Untitled";
    }
  }

  /**
   * 从URL提取网站名
   */
  private extractSiteNameFromURL(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace("www.", "");
    } catch {
      return "";
    }
  }

  /**
   * 从正则表达式提取标题
   */
  private extractTitleFromRegex(html: string, originalHtml: string): string {
    // 优先使用 og:title
    const ogMatch = originalHtml.match(
      /<meta\s+property="og:title"\s+content="([^"]*)"/i,
    );
    if (ogMatch) return ogMatch[1];

    // 尝试 <title> 标签
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) return titleMatch[1].trim();

    // 尝试 h1
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) return h1Match[1].trim();

    return "";
  }

  /**
   * 从正则表达式提取作者
   */
  private extractBylineFromRegex(html: string): string {
    // 尝试 og:article:author
    const ogMatch = html.match(
      /<meta\s+property="og:article:author"\s+content="([^"]*)"/i,
    );
    if (ogMatch) return ogMatch[1];

    // 尝试 author meta
    const authorMatch = html.match(
      /<meta\s+name="author"\s+content="([^"]*)"/i,
    );
    if (authorMatch) return authorMatch[1];

    // 尝试常见的作者标签
    const bylineMatch = html.match(
      /<span[^>]*class="[^"]*by[^"]*"[^>]*>([^<]+)<\/span>/i,
    );
    if (bylineMatch) return bylineMatch[1].trim();

    return "";
  }

  /**
   * 提取摘要：取前200个字符
   */
  private extractExcerpt(text: string, length: number = 200): string {
    return (
      text.substring(0, length).trim() + (text.length > length ? "..." : "")
    );
  }

  /**
   * 移除HTML标签，保留纯文本
   */
  private stripHTML(html: string): string {
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }
}
