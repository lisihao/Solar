/**
 * EventSourceParsingService
 *
 * 轻量服务：EVENT 类型创建后异步解析锚定文章。
 * - URL 输入：通过 fetch 抓取内容
 * - 粘贴内容/URL 抓取结果：LLM 提取标题、摘要、关键实体、事件类型
 * - 结果写入 topicConfig（供 Leader 规划使用）
 * - 解析失败不阻塞：降级为无锚定文章模式
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  BadGatewayException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { toPrismaJson } from "@/common/utils/prisma-json.utils";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import {
  assessSourceTier,
  extractDomain,
  truncateSourceContent,
} from "../../../utils/event-source-parser.utils";

@Injectable()
export class EventSourceParsingService {
  private readonly logger = new Logger(EventSourceParsingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 异步解析锚定文章（fire-and-forget，不阻塞创建响应）
   * 解析结果写入 topicConfig，失败静默降级
   */
  async parseEventSourceAsync(topicId: string): Promise<void> {
    try {
      const topic = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { id: true, topicConfig: true, type: true },
      });

      if (!topic || topic.type !== "EVENT") return;

      const topicConfig = (topic.topicConfig as Record<string, unknown>) ?? {};
      const sourceUrl = topicConfig.sourceUrl as string | undefined;
      const sourceContent = topicConfig.sourceContent as string | undefined;

      if (!sourceUrl && !sourceContent) {
        this.logger.warn(
          `[parseEventSource] Topic ${topicId}: no sourceUrl or sourceContent`,
        );
        return;
      }

      // Step 1: 如果是 URL 且没有内容，需要抓取
      let content = sourceContent ?? "";
      const domain = sourceUrl ? extractDomain(sourceUrl) : undefined;

      if (sourceUrl && !content) {
        try {
          content = await this.fetchUrlContent(sourceUrl);
          this.logger.log(
            `[parseEventSource] Fetched URL content: ${content.length} chars from ${domain}`,
          );
        } catch (err) {
          this.logger.warn(
            `[parseEventSource] URL fetch failed for ${sourceUrl}: ${err instanceof Error ? err.message : String(err)}`,
          );
          // URL 不可访问，无内容可解析，写入 domain 和 tier 后返回
          await this.updateTopicConfig(topicId, topicConfig, {
            sourceDomain: domain,
            sourceTier: domain ? assessSourceTier(sourceUrl) : 3,
          });
          return;
        }
      }

      // Step 2: 截取内容
      content = truncateSourceContent(content, 5000);

      // Step 3: LLM 提取实体和事件类型
      const extractionResult = await this.extractEventMetadata(content);

      // Step 4: 写入 topicConfig
      const updates: Record<string, unknown> = {
        sourceContent: content,
        sourceDomain:
          domain ?? extractDomain(sourceUrl ?? "") ?? "user-provided",
        sourceTier: sourceUrl ? assessSourceTier(sourceUrl) : 3,
      };

      if (extractionResult) {
        if (extractionResult.title)
          updates.sourceTitle = extractionResult.title;
        if (extractionResult.eventType)
          updates.eventType = extractionResult.eventType;
        if (extractionResult.keyEntities)
          updates.keyEntities = extractionResult.keyEntities;
        if (extractionResult.sourceDate)
          updates.sourceDate = extractionResult.sourceDate;
      }

      await this.updateTopicConfig(topicId, topicConfig, updates);

      this.logger.log(
        `[parseEventSource] Topic ${topicId} parsed: type=${extractionResult?.eventType ?? "unknown"}, ` +
          `title="${(extractionResult?.title ?? "").slice(0, 50)}", entities=${JSON.stringify(extractionResult?.keyEntities ?? {})}`,
      );
    } catch (err) {
      this.logger.error(
        `[parseEventSource] Failed for topic ${topicId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // 静默降级，不抛出
    }
  }

  /** 响应体大小上限 5MB，防止 OOM */
  private static readonly MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

  /**
   * 通过 fetch 抓取 URL 内容（轻量方案）
   * 微信公众号文章使用专用解析逻辑
   */
  private async fetchUrlContent(url: string): Promise<string> {
    this.validateFetchUrl(url);
    if (this.isWeChatUrl(url)) {
      return this.fetchWeChatContent(url);
    }
    return this.fetchGenericContent(url);
  }

  /**
   * SSRF 防护：拒绝内网 IP、非 HTTP(S) 协议、云元数据端点
   */
  private validateFetchUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException(`Invalid URL: ${url}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new BadRequestException(`Disallowed protocol: ${parsed.protocol}`);
    }
    const hostname = parsed.hostname;
    const blocklist = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^::1$/,
      /^0\.0\.0\.0$/,
      /^169\.254\./,
    ];
    if (blocklist.some((r) => r.test(hostname))) {
      throw new BadRequestException(
        `Blocked private/internal host: ${hostname}`,
      );
    }
  }

  /**
   * 安全读取响应体，限制大小防止 OOM
   */
  private async safeReadResponseText(response: Response): Promise<string> {
    const contentLength = response.headers.get("content-length");
    if (
      contentLength &&
      parseInt(contentLength, 10) > EventSourceParsingService.MAX_RESPONSE_BYTES
    ) {
      throw new BadRequestException(
        `Response too large: ${contentLength} bytes (limit ${EventSourceParsingService.MAX_RESPONSE_BYTES})`,
      );
    }

    // 流式读取，超限时中断
    const reader = response.body?.getReader();
    if (!reader) {
      return response.text();
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const decoder = new TextDecoder("utf-8");

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > EventSourceParsingService.MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new BadRequestException(
            `Response exceeded ${EventSourceParsingService.MAX_RESPONSE_BYTES} bytes during streaming`,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return decoder.decode(merged);
  }

  /**
   * 检测是否为微信公众号文章 URL
   */
  private isWeChatUrl(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return hostname === "mp.weixin.qq.com" || hostname === "weixin.qq.com";
    } catch {
      return false;
    }
  }

  /**
   * 微信公众号文章抓取
   *
   * 微信文章特征：
   * - 正文在 <div id="js_content"> 或 <div class="rich_media_content"> 中
   * - 标题在 <h1 class="rich_media_title"> 中
   * - 作者在 <span id="js_author_name"> 或 <a id="js_name"> 中
   * - 发布时间在 <em id="publish_time"> 中
   * - 需要浏览器级 User-Agent + Referer 才能获取完整内容
   */
  private async fetchWeChatContent(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Referer: "https://mp.weixin.qq.com/",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        throw new BadGatewayException(`WeChat HTTP ${response.status}`);
      }

      const html = await this.safeReadResponseText(response);

      // 检查是否被拦截（微信特征性拦截页）
      if (
        html.includes("环境异常") ||
        html.includes("请在微信客户端打开") ||
        html.includes("请完成验证") ||
        html.includes("weixin110.qq.com")
      ) {
        throw new ForbiddenException(
          "WeChat anti-scraping triggered — content blocked",
        );
      }

      // 提取微信文章结构化内容
      return this.parseWeChatHtml(html);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 解析微信公众号 HTML，提取正文、标题、元信息
   */
  private parseWeChatHtml(html: string): string {
    const parts: string[] = [];

    // 提取标题
    const titleMatch = html.match(
      /<h1[^>]*class="[^"]*rich_media_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
    );
    if (titleMatch) {
      const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
      if (title) parts.push(`标题: ${title}`);
    }

    // 提取公众号名称
    const accountMatch =
      html.match(/<a[^>]*id="js_name"[^>]*>([\s\S]*?)<\/a>/i) ||
      html.match(
        /<span[^>]*class="[^"]*rich_media_meta_nickname[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      );
    if (accountMatch) {
      const account = accountMatch[1].replace(/<[^>]+>/g, "").trim();
      if (account) parts.push(`公众号: ${account}`);
    }

    // 提取发布时间
    const timeMatch =
      html.match(/<em[^>]*id="publish_time"[^>]*>([\s\S]*?)<\/em>/i) ||
      html.match(/var ct\s*=\s*"(\d+)"/);
    if (timeMatch) {
      const raw = timeMatch[1].replace(/<[^>]+>/g, "").trim();
      if (raw) {
        // Unix 时间戳转可读日期
        const time = /^\d{10}$/.test(raw)
          ? new Date(parseInt(raw, 10) * 1000).toISOString().slice(0, 10)
          : raw;
        parts.push(`发布时间: ${time}`);
      }
    }

    // 提取正文内容（核心）— 使用平衡括号计数，避免正则在嵌套 div 中截断
    const bodyContent = this.extractWeChatBody(html);

    if (bodyContent) {
      const text = this.cleanWeChatContent(bodyContent);
      if (text.length > 100) {
        parts.push(`\n正文:\n${text}`);
      }
    }

    // 如果正文提取失败，降级为通用 HTML→text（保留已提取的元信息）
    if (!parts.some((p) => p.startsWith("\n正文:"))) {
      this.logger.warn(
        "[parseWeChatHtml] Structured body extraction failed, falling back to generic HTML strip",
      );
      const fallback = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      // 保留已提取的标题/时间等元信息
      if (parts.length > 0) {
        parts.push(`\n正文:\n${fallback}`);
        return parts.join("\n");
      }
      return fallback;
    }

    return parts.join("\n");
  }

  /**
   * 平衡括号计数法提取 js_content div 的完整内容
   * 避免正则在嵌套 div 时系统性截断
   */
  private extractWeChatBody(html: string): string | null {
    // 尝试 id="js_content"，再 fallback 到 class="rich_media_content"
    const markers = ['id="js_content"', 'class="rich_media_content"'];

    for (const marker of markers) {
      const markerIdx = html.indexOf(marker);
      if (markerIdx === -1) continue;

      // 找到该 div 的 > 闭合位置
      const divStart = html.indexOf(">", markerIdx);
      if (divStart === -1) continue;

      const contentStart = divStart + 1;
      let depth = 1;
      let i = contentStart;

      while (i < html.length && depth > 0) {
        const nextOpen = html.indexOf("<div", i);
        const nextClose = html.indexOf("</div>", i);

        if (nextClose === -1) break;

        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          i = nextOpen + 4;
        } else {
          depth--;
          if (depth === 0) {
            return html.slice(contentStart, nextClose);
          }
          i = nextClose + 6;
        }
      }
    }

    return null;
  }

  /**
   * 清理微信 HTML 正文为纯文本，保留段落结构
   */
  private cleanWeChatContent(rawContent: string): string {
    return rawContent
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<img[^>]*data-src="([^"]+)"[^>]*>/gi, "[图片]")
      .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, "[图片]")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_, code) =>
        String.fromCharCode(parseInt(code as string, 10)),
      )
      .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
        String.fromCharCode(parseInt(code as string, 16)),
      )
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  /**
   * 通用 URL 内容抓取
   */
  private async fetchGenericContent(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)",
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
      });

      if (!response.ok) {
        throw new BadGatewayException(`HTTP ${response.status}`);
      }

      const html = await this.safeReadResponseText(response);

      // 简单提取正文（去 HTML 标签）
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return text;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * LLM 提取事件元数据（标题、事件类型、关键实体）
   */
  private async extractEventMetadata(content: string): Promise<{
    title?: string;
    eventType?: string;
    sourceDate?: string;
    keyEntities?: {
      people: string[];
      organizations: string[];
      technologies: string[];
      locations: string[];
    };
  } | null> {
    try {
      const truncated = content.slice(0, 3000);

      const response = await this.chatFacade.chat({
        operationName: "事件解析",
        messages: [
          {
            role: "system",
            content: `你是新闻分析助手。从给定文章中提取结构化信息。输出 JSON 格式，不要输出其他内容。`,
          },
          {
            role: "user",
            content: `请分析以下文章内容，提取：

1. title: 事件标题（一句话概括事件，30字以内）
2. eventType: 事件类型，必须是以下之一：
   - acquisition（收购/并购）
   - policy（政策/法规）
   - product（产品发布）
   - funding（融资/IPO）
   - incident（安全事件/危机）
   - geopolitical（地缘/贸易）
   - leadership（人事变动）
   - tech_breakthrough（技术突破）
   - other（其他）
3. sourceDate: 文章日期（ISO 格式 YYYY-MM-DD，如无法确定填 null）
4. keyEntities: 关键实体
   - people: 涉及的人物姓名
   - organizations: 涉及的机构/公司
   - technologies: 涉及的技术/产品
   - locations: 涉及的地区/国家

文章内容：
${truncated}

输出严格 JSON 格式：
{"title":"...","eventType":"...","sourceDate":"...","keyEntities":{"people":[],"organizations":[],"technologies":[],"locations":[]}}`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "deterministic",
          outputLength: "short",
        },
      });

      const text = response.content?.trim() ?? "";

      // 提取 JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn(
          "[extractEventMetadata] No JSON found in LLM response",
        );
        return null;
      }

      return JSON.parse(jsonMatch[0]) as {
        title?: string;
        eventType?: string;
        sourceDate?: string;
        keyEntities?: {
          people: string[];
          organizations: string[];
          technologies: string[];
          locations: string[];
        };
      };
    } catch (err) {
      this.logger.warn(
        `[extractEventMetadata] LLM extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * 更新 topicConfig（合并新字段）
   */
  private async updateTopicConfig(
    topicId: string,
    existingConfig: Record<string, unknown>,
    updates: Record<string, unknown>,
  ): Promise<void> {
    const merged = { ...existingConfig, ...updates };
    await this.prisma.researchTopic.update({
      where: { id: topicId },
      data: { topicConfig: toPrismaJson(merged) },
    });
  }
}
